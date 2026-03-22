# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""
DHIS2 Staging Engine

Manages PostgreSQL staging tables for materialised DHIS2 dataset data.
Each staged dataset gets its own table in the ``dhis2_staging`` schema with
indexes optimised for analytical querying.

Schema design
-------------
Table naming::

    dhis2_staging.ds_{staged_dataset_id}_{sanitized_name}

Standard columns present in every staging table:

* ``id``                  – BIGSERIAL PRIMARY KEY
* ``source_instance_id``  – INTEGER NOT NULL (references dhis2_instances.id)
* ``source_instance_name``– TEXT NOT NULL
* ``dx_uid``              – TEXT NOT NULL  (DHIS2 data element / indicator UID)
* ``dx_name``             – TEXT
* ``dx_type``             – TEXT NOT NULL  (dataElement | indicator | programIndicator | dataSet)
* ``pe``                  – TEXT NOT NULL  (period, e.g. '2024Q1', '202401', '2024')
* ``ou``                  – TEXT NOT NULL  (org unit UID)
* ``ou_name``             – TEXT
* ``ou_level``            – INTEGER
* ``value``               – TEXT           (stored as text, cast at query time)
* ``value_numeric``       – DOUBLE PRECISION
* ``co_uid``              – TEXT           (category option combo UID)
* ``co_name``             – TEXT
* ``aoc_uid``             – TEXT           (attribute option combo UID)
* ``synced_at``           – TIMESTAMP NOT NULL DEFAULT NOW()
* ``sync_job_id``         – INTEGER

Indexes created per table:

* ``ix_source_instance_id``  on (source_instance_id)
* ``ix_dx_uid``              on (dx_uid)
* ``ix_pe``                  on (pe)
* ``ix_ou``                  on (ou)
* ``ix_synced_at``           on (synced_at)
* ``ix_composite_key``       on (source_instance_id, dx_uid, pe, ou, co_uid, aoc_uid)
                             – fact-grain deduplication
* ``ix_pe_ou``               on (pe, ou)                               – common filter
* ``ix_dx_pe``               on (dx_uid, pe)                           – time-series
"""

from __future__ import annotations

from contextlib import contextmanager
import csv
from io import StringIO
import json
import logging
import os
import re
from typing import Any, Mapping

from sqlalchemy import inspect, text

from superset import db
from superset.dhis2.models import DHIS2StagedDataset

logger = logging.getLogger(__name__)

# Maximum identifier length for PostgreSQL (63 bytes).
_PG_IDENT_MAX = 63

# Row batch size for bulk inserts.
_INSERT_BATCH_SIZE = 1000

# Columns accepted from each incoming row dict; order matters for the INSERT.
_ROW_COLUMNS = (
    "dx_uid",
    "dx_name",
    "dx_type",
    "pe",
    "ou",
    "ou_name",
    "ou_level",
    "value",
    "value_numeric",
    "co_uid",
    "co_name",
    "aoc_uid",
)

_SERVING_IDENTIFIER_PREFIX = "sv"
_MAX_QUERY_LIMIT = 1000
_MAX_DOWNLOAD_LIMIT = 50000
_SUPPORTED_QUERY_OPERATORS = {
    "eq": "=",
    "neq": "!=",
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
}
_SUPPORTED_QUERY_AGGREGATIONS = {
    "sum": "SUM",
    "average": "AVG",
    "max": "MAX",
    "min": "MIN",
    "count": "COUNT",
}


def _isoformat_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return isoformat()
    return str(value)


def _sanitize_name(name: str) -> str:
    """Return a PostgreSQL-safe identifier fragment from an arbitrary string.

    Lowercases, replaces non-alphanumeric runs with underscores, strips
    leading/trailing underscores, and truncates to a reasonable length so the
    full table name stays within PostgreSQL's 63-byte identifier limit.
    """
    sanitized = re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()
    # Reserve space for the ``ds_{id}_`` prefix (up to ~15 chars) and keep
    # the name portion to 40 characters so the combined identifier is safe.
    return sanitized[:40] if sanitized else "dataset"


def _normalize_fact_grain_uid(value: Any) -> str:
    """Return a stable non-null value for nullable fact-grain combo identifiers."""
    normalized = str(value or "").strip()
    return normalized


class DHIS2StagingEngine:
    """Manages the physical PostgreSQL staging tables for DHIS2 staged datasets.

    This class is **not** Flask-request-scoped; instances may be created
    anywhere (views, Celery tasks, management commands).  All database
    operations go through ``superset.db.session`` which uses the Superset
    metadata database – not a DHIS2 connection.

    Args:
        database_id: The Superset ``Database`` primary key that owns the
            staged datasets managed by this engine instance.  Stored for
            logging / audit purposes; the engine itself always writes to the
            Superset metadata DB.
    """

    STAGING_SCHEMA = "dhis2_staging"

    def __init__(self, database_id: int) -> None:
        self.database_id = database_id

    @property
    def _dialect_name(self) -> str:
        return str(getattr(db.engine.dialect, "name", "") or "").lower()

    @property
    def _supports_schema(self) -> bool:
        return self._dialect_name not in {"sqlite"}

    def _qualify_table_name(self, table: str) -> str:
        if self._supports_schema:
            return f"{self.STAGING_SCHEMA}.{table}"
        return table

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return f'"{str(identifier).replace(chr(34), chr(34) * 2)}"'

    @contextmanager
    def _write_connection(self) -> Any:
        """Yield a connection suitable for staging writes.

        SQLite locks aggressively when a second write connection tries to run
        DDL while the scoped session already has an open transaction. Reuse the
        session-bound connection there so staged dataset creation can complete
        without tripping ``database is locked``.

        Applies dialect-specific session settings for maximum write throughput.
        """
        dialect = self._dialect_name
        if dialect == "sqlite":
            session = getattr(db, "session", None)
            connection_factory = getattr(session, "connection", None)
            if callable(connection_factory):
                conn = connection_factory()
                self.apply_connection_optimizations(conn, dialect, for_writes=True)
                yield conn
                return

        with db.engine.begin() as conn:
            self.apply_connection_optimizations(conn, dialect, for_writes=True)
            yield conn

    @staticmethod
    def apply_connection_optimizations(
        conn: Any,
        dialect_name: str,
        *,
        for_writes: bool = False,
    ) -> None:
        """Apply dialect-specific session settings to maximise staging I/O throughput.

        All settings are best-effort — failures are silently swallowed so a
        misconfigured hint never breaks an actual query.

        Supported backends
        ------------------
        * **SQLite** — WAL journal, normal sync, 64 MB page cache, RAM temp
          store, 256 MB mmap window.
        * **PostgreSQL** — 256 MB ``work_mem`` for sorts/hashes, SSD-tuned
          planner costs, async commit on write sessions.
        * **MySQL / MariaDB** — session-level sort, read, and join buffers set
          to 256 MB each.
        * **DuckDB** — auto-detected CPU thread count, 2 GB memory cap.
        * **ClickHouse** — 2 GB ``max_memory_usage``, auto-detected thread count.
        """
        _cpu = os.cpu_count() or 4
        try:
            d = str(dialect_name or "").lower()

            if d == "sqlite":
                # WAL mode: concurrent readers while a writer is active
                conn.execute(text("PRAGMA journal_mode=WAL"))
                # NORMAL sync: fsync only at checkpoints — safe, much faster
                conn.execute(text("PRAGMA synchronous=NORMAL"))
                # 64 MB page cache (negative value = kibibytes)
                conn.execute(text("PRAGMA cache_size=-65536"))
                # Sorts and indexes stay in RAM
                conn.execute(text("PRAGMA temp_store=MEMORY"))
                # 256 MB memory-mapped I/O
                conn.execute(text("PRAGMA mmap_size=268435456"))

            elif d == "postgresql":
                # Large in-memory sort/hash buffer for GROUP BY and ORDER BY
                conn.execute(text("SET LOCAL work_mem = '256MB'"))
                # Assume SSD — lower random-page cost so planner prefers indexes
                conn.execute(text("SET LOCAL random_page_cost = 1.1"))
                # Inform planner about OS page-cache size for cost estimates
                conn.execute(text("SET LOCAL effective_cache_size = '4GB'"))
                if for_writes:
                    # Async commit: WAL write queued, not flushed — safe for
                    # staging data where loss on crash is acceptable
                    conn.execute(text("SET LOCAL synchronous_commit = off"))

            elif d in ("mysql", "mariadb"):
                # Per-session sort, read, and join buffers (256 MB each)
                conn.execute(text("SET SESSION sort_buffer_size = 268435456"))
                conn.execute(text("SET SESSION read_buffer_size = 67108864"))
                conn.execute(text("SET SESSION join_buffer_size = 268435456"))
                if for_writes:
                    # Disable unique-key caching for faster bulk inserts
                    conn.execute(text("SET SESSION unique_checks = 0"))
                    conn.execute(text("SET SESSION foreign_key_checks = 0"))

            elif d == "duckdb":
                # Use all available CPU cores; cap memory for shared deployments
                conn.execute(text(f"SET threads TO {_cpu}"))
                conn.execute(text("SET memory_limit = '2GB'"))

            elif d == "clickhouse":
                # Per-query memory cap and thread count
                conn.execute(text("SET max_memory_usage = 2147483648"))
                conn.execute(text(f"SET max_threads = {_cpu}"))

        except Exception:  # pylint: disable=broad-except
            pass  # Optimizations are best-effort; never break real queries

    def _run_analyze(self, conn: Any, full_name: str) -> None:
        """Run the dialect-appropriate statistics-refresh command.

        Accurate statistics let the query planner choose better execution plans
        after a bulk load — critical for GROUP BY / ORDER BY performance on
        fresh staging tables.

        * SQLite / PostgreSQL — ``ANALYZE <table>``
        * MySQL / MariaDB     — ``ANALYZE TABLE <table>``
        * DuckDB              — ``ANALYZE`` (no per-table form in most releases)
        * ClickHouse          — ``OPTIMIZE TABLE <table> FINAL`` (materialises
          merges so subsequent reads are faster)
        """
        try:
            d = self._dialect_name
            if d in ("sqlite", "postgresql"):
                conn.execute(text(f"ANALYZE {full_name}"))
            elif d in ("mysql", "mariadb"):
                conn.execute(text(f"ANALYZE TABLE {full_name}"))
            elif d == "duckdb":
                conn.execute(text("ANALYZE"))
            elif d == "clickhouse":
                conn.execute(text(f"OPTIMIZE TABLE {full_name} FINAL"))
            # Other dialects: skip silently — statistics are auto-maintained
        except Exception:  # pylint: disable=broad-except
            pass

    def _create_serving_index(
        self,
        conn: Any,
        table_name: str,
        full_name: str,
        col_name: str,
    ) -> None:
        """Create a single serving-table index with dialect-aware DDL.

        Failures are swallowed individually so one unsupported index does not
        abort the rest of the index-creation loop.

        * SQLite / PostgreSQL / MySQL / MariaDB / DuckDB — standard
          ``CREATE INDEX IF NOT EXISTS``
        * ClickHouse — skipped; ClickHouse uses ``ORDER BY``-based physical
          ordering rather than secondary indexes, so there is nothing to create.
        """
        d = self._dialect_name
        if d == "clickhouse":
            return  # ClickHouse does not support CREATE INDEX

        safe_col = col_name.replace(" ", "_")[:40]
        idx_name = f"ix_{table_name}_{safe_col}"
        quoted_col = f'"{col_name}"'

        # MySQL does not support IF NOT EXISTS on CREATE INDEX before 8.0;
        # use a DROP/CREATE pattern for pre-8.0 compatibility.
        if d in ("mysql", "mariadb"):
            ddl = (
                f"CREATE INDEX {idx_name} ON {full_name} ({quoted_col})"
            )
        else:
            ddl = (
                f"CREATE INDEX IF NOT EXISTS {idx_name} ON {full_name} ({quoted_col})"
            )

        try:
            conn.execute(text(ddl))
        except Exception:  # pylint: disable=broad-except
            # Index may already exist (MySQL pre-8.0) or be unsupported — ignore
            pass

    # ------------------------------------------------------------------
    # Schema helpers
    # ------------------------------------------------------------------

    def ensure_schema_exists(self, conn: Any) -> None:
        """Create the ``dhis2_staging`` schema if it does not already exist.

        Executed inside the caller's transaction so it participates in any
        surrounding ``BEGIN`` / ``ROLLBACK`` block.

        Args:
            conn: An active SQLAlchemy connection (``engine.connect()`` or
                the raw DBAPI connection from ``db.session``).
        """
        if not self._supports_schema:
            return
        logger.debug("Ensuring schema '%s' exists", self.STAGING_SCHEMA)
        conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {self.STAGING_SCHEMA}"))

    # ------------------------------------------------------------------
    # Table-name helpers
    # ------------------------------------------------------------------

    def get_staging_table_name(self, staged_dataset: DHIS2StagedDataset) -> str:
        """Return the bare (unqualified) staging table name for *staged_dataset*.

        The name follows the pattern ``ds_{id}_{sanitized_name}`` and is
        guaranteed to be a valid PostgreSQL identifier.

        Args:
            staged_dataset: The :class:`~superset.dhis2.models.DHIS2StagedDataset`
                whose table name is required.

        Returns:
            A string such as ``ds_42_my_dataset``.
        """
        sanitized = _sanitize_name(staged_dataset.name)
        table_name = f"ds_{staged_dataset.id}_{sanitized}"
        # Truncate if somehow still too long (extremely long dataset names).
        return table_name[:_PG_IDENT_MAX]

    def _get_physical_table_name(self, staged_dataset: DHIS2StagedDataset) -> str:
        """Return the persisted staging table name when available.

        Dataset metadata stores the physical table name assigned at creation
        time. Reuse that value so later dataset renames do not accidentally
        point readers and writers at a different computed table name.
        """
        return staged_dataset.staging_table_name or self.get_staging_table_name(
            staged_dataset
        )

    def get_serving_table_name(self, staged_dataset: DHIS2StagedDataset) -> str:
        sanitized = _sanitize_name(staged_dataset.name)
        table_name = f"{_SERVING_IDENTIFIER_PREFIX}_{staged_dataset.id}_{sanitized}"
        return table_name[:_PG_IDENT_MAX]

    def get_serving_sql_table_ref(self, staged_dataset: DHIS2StagedDataset) -> str:
        return self._qualify_table_name(self.get_serving_table_name(staged_dataset))

    def get_superset_sql_table_ref(self, staged_dataset: DHIS2StagedDataset) -> str:
        """Return the fully-qualified SQL table reference for use in Superset.

        This is the string you would embed in a Superset virtual dataset SQL
        query, e.g. ``SELECT * FROM dhis2_staging.ds_42_my_dataset``.

        Args:
            staged_dataset: The staged dataset whose table reference is needed.

        Returns:
            A string like ``dhis2_staging.ds_42_my_dataset``.
        """
        return self._qualify_table_name(self._get_physical_table_name(staged_dataset))

    # ------------------------------------------------------------------
    # DDL helpers
    # ------------------------------------------------------------------

    def create_staging_table(self, staged_dataset: DHIS2StagedDataset) -> str:
        """Create the staging table and all indexes if they do not exist.

        All DDL is idempotent (``IF NOT EXISTS``).  The method commits the
        DDL immediately so that it is visible to subsequent sessions even if
        the calling transaction is later rolled back for business-logic
        reasons.

        Args:
            staged_dataset: The staged dataset for which to create the table.

        Returns:
            The fully-qualified table reference (``schema.table``).

        Raises:
            Exception: Propagates any SQLAlchemy / DBAPI error encountered
                during DDL execution.
        """
        table = self._get_physical_table_name(staged_dataset)
        full_name = self._qualify_table_name(table)

        logger.info(
            "Creating staging table %s for staged_dataset id=%s",
            full_name,
            staged_dataset.id,
        )

        with self._write_connection() as conn:
            self.ensure_schema_exists(conn)
            id_column = (
                "INTEGER PRIMARY KEY AUTOINCREMENT"
                if self._dialect_name == "sqlite"
                else "BIGSERIAL PRIMARY KEY"
            )

            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {full_name} (
                    id                  {id_column},
                    source_instance_id  INTEGER NOT NULL,
                    source_instance_name TEXT NOT NULL,
                    dx_uid              TEXT NOT NULL,
                    dx_name             TEXT,
                    dx_type             TEXT NOT NULL,
                    pe                  TEXT NOT NULL,
                    ou                  TEXT NOT NULL,
                    ou_name             TEXT,
                    ou_level            INTEGER,
                    value               TEXT,
                    value_numeric       DOUBLE PRECISION,
                    co_uid              TEXT,
                    co_name             TEXT,
                    aoc_uid             TEXT,
                    synced_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    sync_job_id         INTEGER
                )
            """))

            # Individual column indexes
            for ix_name, ix_cols in [
                (f"ix_{table}_source_instance_id", "source_instance_id"),
                (f"ix_{table}_dx_uid", "dx_uid"),
                (f"ix_{table}_pe", "pe"),
                (f"ix_{table}_ou", "ou"),
                (f"ix_{table}_synced_at", "synced_at"),
            ]:
                conn.execute(text(
                    f"CREATE INDEX IF NOT EXISTS {ix_name} "
                    f"ON {full_name} ({ix_cols})"
                ))

            # Composite indexes for common query patterns
            for ix_name, ix_cols, is_unique in [
                (
                    f"ux_{table}_composite_key",
                    "source_instance_id, dx_uid, pe, ou, co_uid, aoc_uid",
                    True,
                ),
                (f"ix_{table}_pe_ou", "pe, ou", False),
                (f"ix_{table}_dx_pe", "dx_uid, pe", False),
            ]:
                unique_sql = "UNIQUE " if is_unique else ""
                if is_unique:
                    try:
                        conn.execute(text(f"DROP INDEX IF EXISTS {ix_name}"))
                    except Exception:  # pylint: disable=broad-except
                        pass
                conn.execute(
                    text(
                        f"CREATE {unique_sql}INDEX IF NOT EXISTS {ix_name} "
                        f"ON {full_name} ({ix_cols})"
                    )
                )

        logger.info("Staging table %s is ready", full_name)
        return full_name

    def drop_staging_table(self, staged_dataset: DHIS2StagedDataset) -> None:
        """Drop the staging table for *staged_dataset*.

        Silently succeeds when the table does not exist (``IF EXISTS``).
        Called by :func:`~superset.dhis2.staged_dataset_service.delete_staged_dataset`
        before the metadata row is removed.

        Args:
            staged_dataset: The staged dataset whose physical table should be
                removed.
        """
        full_name = self.get_superset_sql_table_ref(staged_dataset)
        logger.info(
            "Dropping staging table %s for staged_dataset id=%s",
            full_name,
            staged_dataset.id,
        )
        with self._write_connection() as conn:
            conn.execute(text(f"DROP TABLE IF EXISTS {full_name}"))
            conn.execute(
                text(
                    f"DROP TABLE IF EXISTS {self.get_serving_sql_table_ref(staged_dataset)}"
                )
            )
        logger.info("Dropped staging table %s", full_name)

    def truncate_staging_table(self, staged_dataset: DHIS2StagedDataset) -> None:
        """Truncate (clear all rows from) the staging table without dropping it.

        Uses PostgreSQL ``TRUNCATE`` for efficiency.

        Args:
            staged_dataset: The staged dataset whose table should be cleared.
        """
        full_name = self.get_superset_sql_table_ref(staged_dataset)
        logger.info(
            "Truncating staging table %s for staged_dataset id=%s",
            full_name,
            staged_dataset.id,
        )
        with self._write_connection() as conn:
            if self._dialect_name == "sqlite":
                conn.execute(text(f"DELETE FROM {full_name}"))
            else:
                conn.execute(text(f"TRUNCATE TABLE {full_name}"))

    def truncate_for_instance(
        self,
        staged_dataset: DHIS2StagedDataset,
        instance_id: int,
    ) -> int:
        """Delete all rows that originated from a specific DHIS2 instance.

        More targeted than :meth:`truncate_staging_table`; useful during
        incremental re-syncs where only one instance's data is refreshed.

        Args:
            staged_dataset: The staged dataset to purge rows from.
            instance_id: The ``dhis2_instances.id`` value to filter on.

        Returns:
            The number of rows deleted.
        """
        full_name = self.get_superset_sql_table_ref(staged_dataset)
        logger.info(
            "Deleting rows for instance_id=%s from %s",
            instance_id,
            full_name,
        )
        with self._write_connection() as conn:
            result = conn.execute(
                text(
                    f"DELETE FROM {full_name} "  # noqa: S608
                    f"WHERE source_instance_id = :instance_id"
                ),
                {"instance_id": instance_id},
            )
            deleted = result.rowcount
        logger.info(
            "Deleted %d rows for instance_id=%s from %s",
            deleted,
            instance_id,
            full_name,
        )
        return deleted

    def get_instance_periods(
        self,
        staged_dataset: DHIS2StagedDataset,
        instance_id: int,
    ) -> list[str]:
        if not self.table_exists(staged_dataset):
            return []

        full_name = self.get_superset_sql_table_ref(staged_dataset)
        with db.engine.connect() as conn:
            result = conn.execute(
                text(
                    f"SELECT DISTINCT pe FROM {full_name} "  # noqa: S608
                    "WHERE source_instance_id = :instance_id "
                    "ORDER BY pe"
                ),
                {"instance_id": instance_id},
            )
            return [str(row[0]) for row in result.fetchall() if row[0] is not None]

    def delete_rows_for_instance_periods(
        self,
        staged_dataset: DHIS2StagedDataset,
        instance_id: int,
        periods: list[str],
    ) -> int:
        normalized_periods = [
            str(period).strip()
            for period in periods
            if str(period).strip()
        ]
        if not normalized_periods or not self.table_exists(staged_dataset):
            return 0

        full_name = self.get_superset_sql_table_ref(staged_dataset)
        placeholders = ", ".join(
            f":period_{index}" for index in range(len(normalized_periods))
        )
        params: dict[str, Any] = {"instance_id": instance_id}
        params.update(
            {
                f"period_{index}": period
                for index, period in enumerate(normalized_periods)
            }
        )
        with self._write_connection() as conn:
            result = conn.execute(
                text(
                    f"DELETE FROM {full_name} "  # noqa: S608
                    "WHERE source_instance_id = :instance_id "
                    f"AND pe IN ({placeholders})"
                ),
                params,
            )
        deleted = int(result.rowcount or 0)
        logger.info(
            "Deleted %d rows for instance_id=%s periods=%d from %s",
            deleted,
            instance_id,
            len(normalized_periods),
            full_name,
        )
        return deleted

    # ------------------------------------------------------------------
    # Data ingestion
    # ------------------------------------------------------------------

    def insert_rows(
        self,
        staged_dataset: DHIS2StagedDataset,
        instance_id: int,
        instance_name: str,
        rows: list[dict[str, Any]],
        sync_job_id: int | None = None,
    ) -> int:
        """Bulk-insert rows into the staging table.

        Rows are inserted in batches of :data:`_INSERT_BATCH_SIZE` (1 000)
        using ``executemany`` for performance.  Each batch runs in its own
        transaction so that a failure in a late batch does not roll back
        successfully inserted earlier batches.

        Caller is responsible for supplying deduplicated rows; the INSERT uses
        ``ON CONFLICT DO NOTHING`` against the ``(source_instance_id, dx_uid,
        pe, ou)`` composite index, so exact duplicates within a single sync
        are silently dropped.

        Args:
            staged_dataset: Target staged dataset.
            instance_id: ``dhis2_instances.id`` of the originating instance.
            instance_name: Human-readable name of the originating instance.
            rows: Sequence of dicts with keys matching :data:`_ROW_COLUMNS`.
                  Missing keys default to ``None``.
            sync_job_id: Optional sync-job primary key for audit traceability.

        Returns:
            Total number of rows actually inserted (excluding conflicts).
        """
        if not rows:
            return 0

        full_name = self.get_superset_sql_table_ref(staged_dataset)
        total_inserted = 0

        insert_sql = text(f"""
            INSERT INTO {full_name} (
                source_instance_id,
                source_instance_name,
                dx_uid,
                dx_name,
                dx_type,
                pe,
                ou,
                ou_name,
                ou_level,
                value,
                value_numeric,
                co_uid,
                co_name,
                aoc_uid,
                sync_job_id
            ) VALUES (
                :source_instance_id,
                :source_instance_name,
                :dx_uid,
                :dx_name,
                :dx_type,
                :pe,
                :ou,
                :ou_name,
                :ou_level,
                :value,
                :value_numeric,
                :co_uid,
                :co_name,
                :aoc_uid,
                :sync_job_id
            )
            ON CONFLICT DO NOTHING
        """)

        for batch_start in range(0, len(rows), _INSERT_BATCH_SIZE):
            batch = rows[batch_start : batch_start + _INSERT_BATCH_SIZE]
            params = []
            for row in batch:
                params.append(
                    {
                        "source_instance_id": instance_id,
                        "source_instance_name": instance_name,
                        "dx_uid": row.get("dx_uid"),
                        "dx_name": row.get("dx_name"),
                        "dx_type": row.get("dx_type"),
                        "pe": row.get("pe"),
                        "ou": row.get("ou"),
                        "ou_name": row.get("ou_name"),
                        "ou_level": row.get("ou_level"),
                        "value": row.get("value"),
                        "value_numeric": row.get("value_numeric"),
                        "co_uid": _normalize_fact_grain_uid(row.get("co_uid")),
                        "co_name": row.get("co_name"),
                        "aoc_uid": _normalize_fact_grain_uid(row.get("aoc_uid")),
                        "sync_job_id": sync_job_id,
                    }
                )

            with self._write_connection() as conn:
                result = conn.execute(insert_sql, params)
                # rowcount may be -1 on some drivers when executemany is used;
                # fall back to the batch length as an upper bound.
                batch_count = result.rowcount if result.rowcount >= 0 else len(batch)
                total_inserted += batch_count

            logger.debug(
                "Inserted batch of %d rows into %s (cumulative: %d)",
                len(batch),
                full_name,
                total_inserted,
            )

        logger.info(
            "Inserted %d rows into %s for instance_id=%s",
            total_inserted,
            full_name,
            instance_id,
        )
        return total_inserted

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def table_exists(self, staged_dataset: DHIS2StagedDataset) -> bool:
        """Return ``True`` when the staging table physically exists.

        Queries ``information_schema.tables`` so it works without needing
        superuser privileges.

        Args:
            staged_dataset: The staged dataset to check.

        Returns:
            ``True`` if the table exists, ``False`` otherwise.
        """
        table = self._get_physical_table_name(staged_dataset)
        schema = self.STAGING_SCHEMA if self._supports_schema else None
        inspector = inspect(db.engine)
        return bool(inspector.has_table(table, schema=schema))

    def serving_table_exists(self, staged_dataset: DHIS2StagedDataset) -> bool:
        table = self.get_serving_table_name(staged_dataset)
        schema = self.STAGING_SCHEMA if self._supports_schema else None
        inspector = inspect(db.engine)
        return bool(inspector.has_table(table, schema=schema))

    def get_serving_table_columns(
        self,
        staged_dataset: DHIS2StagedDataset,
    ) -> list[str]:
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            return []

        with db.engine.connect() as conn:
            result = conn.execute(text(f"SELECT * FROM {full_name} LIMIT 0"))
            return list(result.keys())

    def _coerce_query_limit(
        self,
        limit: int | None,
        *,
        for_download: bool = False,
    ) -> int:
        max_limit = _MAX_DOWNLOAD_LIMIT if for_download else _MAX_QUERY_LIMIT
        requested = int(limit or (1000 if for_download else 100))
        return max(1, min(requested, max_limit))

    @staticmethod
    def _load_column_extra(column: Mapping[str, Any]) -> dict[str, Any]:
        raw_extra = column.get("extra")
        if isinstance(raw_extra, dict):
            return raw_extra
        if isinstance(raw_extra, str) and raw_extra.strip():
            try:
                parsed = json.loads(raw_extra)
            except (TypeError, ValueError, json.JSONDecodeError):
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    def _render_preview_literal(self, value: Any) -> str:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
        escaped_value = str(value).replace("'", "''")
        return f"'{escaped_value}'"

    def _build_empty_value_expression(self, quoted_column: str) -> str:
        return (
            f"NULLIF(TRIM(COALESCE(CAST({quoted_column} AS TEXT), '')), '')"
        )

    def _build_filter_clauses(
        self,
        filters: list[dict[str, Any]] | None,
        available_columns: list[str],
    ) -> tuple[list[str], list[str], dict[str, Any]]:
        params: dict[str, Any] = {}
        where_clauses: list[str] = []
        preview_clauses: list[str] = []

        for index, filter_item in enumerate(list(filters or [])):
            if not isinstance(filter_item, dict):
                continue

            column = str(filter_item.get("column") or "").strip()
            operator = str(filter_item.get("operator") or "eq").strip().lower()
            raw_value = filter_item.get("value")
            if not column or column not in available_columns:
                continue

            quoted_column = self._quote_identifier(column)

            if operator in {"is_empty", "not_empty"}:
                empty_value_expression = self._build_empty_value_expression(
                    quoted_column
                )
                comparator = "IS NULL" if operator == "is_empty" else "IS NOT NULL"
                where_clauses.append(
                    f"{empty_value_expression} {comparator}"
                )
                preview_clauses.append(
                    f"{empty_value_expression} {comparator}"
                )
                continue

            if raw_value is None:
                continue

            if operator == "in":
                if not isinstance(raw_value, (list, tuple, set)):
                    continue
                normalized_values = [
                    item
                    for item in list(raw_value)
                    if item is not None and str(item).strip() != ""
                ]
                if not normalized_values:
                    continue

                value_param_names: list[str] = []
                preview_values: list[str] = []
                for value_index, value in enumerate(normalized_values):
                    param_name = f"filter_{index}_{value_index}"
                    params[param_name] = value
                    value_param_names.append(f":{param_name}")
                    preview_values.append(self._render_preview_literal(value))

                where_clauses.append(
                    f"{quoted_column} IN ({', '.join(value_param_names)})"
                )
                preview_clauses.append(
                    f"{quoted_column} IN ({', '.join(preview_values)})"
                )
                continue

            if str(raw_value).strip() == "":
                continue

            param_name = f"filter_{index}"
            value_text = str(raw_value)
            lowered_value = value_text.lower()
            escaped_lowered_value = lowered_value.replace("'", "''")

            if operator == "contains":
                where_clauses.append(
                    f"LOWER(CAST({quoted_column} AS TEXT)) LIKE :{param_name}"
                )
                params[param_name] = f"%{lowered_value}%"
                preview_clauses.append(
                    f"LOWER(CAST({quoted_column} AS TEXT)) LIKE '%{escaped_lowered_value}%'"
                )
                continue

            if operator == "starts_with":
                where_clauses.append(
                    f"LOWER(CAST({quoted_column} AS TEXT)) LIKE :{param_name}"
                )
                params[param_name] = f"{lowered_value}%"
                preview_clauses.append(
                    f"LOWER(CAST({quoted_column} AS TEXT)) LIKE '{escaped_lowered_value}%'"
                )
                continue

            sql_operator = _SUPPORTED_QUERY_OPERATORS.get(operator)
            if sql_operator is None:
                continue

            where_clauses.append(f"{quoted_column} {sql_operator} :{param_name}")
            params[param_name] = raw_value
            preview_clauses.append(
                f"{quoted_column} {sql_operator} {self._render_preview_literal(raw_value)}"
            )

        return where_clauses, preview_clauses, params

    def _normalize_query_aggregation(
        self,
        aggregation_method: str | None,
    ) -> str | None:
        normalized = str(aggregation_method or "").strip().lower()
        if not normalized:
            return None
        return normalized if normalized in _SUPPORTED_QUERY_AGGREGATIONS else None

    def _build_serving_query(
        self,
        staged_dataset: DHIS2StagedDataset,
        *,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        limit: int | None = None,
        page: int | None = None,
        group_by_columns: list[str] | None = None,
        metric_column: str | None = None,
        metric_alias: str | None = None,
        aggregation_method: str | None = None,
        for_download: bool = False,
    ) -> tuple[str, str, str, dict[str, Any], list[str], int]:
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        available_columns = self.get_serving_table_columns(staged_dataset)
        if not available_columns:
            return "", "", "", {}, [], 1

        where_clauses, preview_clauses, params = self._build_filter_clauses(
            filters,
            available_columns,
        )
        where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        preview_where_sql = (
            f" WHERE {' AND '.join(preview_clauses)}" if preview_clauses else ""
        )
        safe_limit = self._coerce_query_limit(limit, for_download=for_download)
        safe_page = max(1, int(page or 1))
        offset = 0 if for_download else (safe_page - 1) * safe_limit

        normalized_aggregation = self._normalize_query_aggregation(
            aggregation_method
        )
        if normalized_aggregation:
            resolved_group_by_columns = [
                column
                for column in list(group_by_columns or [])
                if column in available_columns
            ]
            resolved_metric_column = (
                str(metric_column or "").strip()
                if str(metric_column or "").strip() in available_columns
                else None
            )
            if not resolved_group_by_columns or not resolved_metric_column:
                return "", "", "", {}, [], safe_page

            resolved_metric_alias = str(metric_alias or "").strip() or (
                f"{normalized_aggregation.upper()}({resolved_metric_column})"
            )
            quoted_group_by_columns = [
                self._quote_identifier(column)
                for column in resolved_group_by_columns
            ]
            group_by_sql = ", ".join(quoted_group_by_columns)
            preview_group_by_sql = ", ".join(quoted_group_by_columns)
            quoted_metric_column = self._quote_identifier(resolved_metric_column)
            quoted_metric_alias = self._quote_identifier(resolved_metric_alias)

            if normalized_aggregation == "count":
                aggregate_sql = f"COUNT(*) AS {quoted_metric_alias}"
                preview_aggregate_sql = aggregate_sql
            else:
                metric_expression = f"COALESCE({quoted_metric_column}, 0)"
                aggregate_fn = _SUPPORTED_QUERY_AGGREGATIONS[normalized_aggregation]
                aggregate_sql = (
                    f"{aggregate_fn}({metric_expression}) AS {quoted_metric_alias}"
                )
                preview_aggregate_sql = aggregate_sql

            resolved_columns = [
                *resolved_group_by_columns,
                resolved_metric_alias,
            ]
            select_sql = (
                f"SELECT {group_by_sql}, {aggregate_sql} "
                f"FROM {full_name}{where_sql} "
                f"GROUP BY {group_by_sql}"
            )
            preview_sql = (
                f"SELECT {preview_group_by_sql}, {preview_aggregate_sql} "
                f"FROM {full_name}{preview_where_sql} "
                f"GROUP BY {preview_group_by_sql}"
            )
            count_sql = (
                "SELECT COUNT(*) FROM ("
                f"SELECT {group_by_sql} FROM {full_name}{where_sql} "
                f"GROUP BY {group_by_sql}"
                ") AS grouped_rows"
            )
        else:
            requested_columns = [
                column
                for column in list(selected_columns or [])
                if column in available_columns
            ]
            resolved_columns = requested_columns or available_columns
            selected_sql = ", ".join(
                self._quote_identifier(column) for column in resolved_columns
            )
            select_sql = f"SELECT {selected_sql} FROM {full_name}{where_sql}"
            preview_sql = f"SELECT {selected_sql} FROM {full_name}{preview_where_sql}"
            count_sql = f"SELECT COUNT(*) FROM {full_name}{where_sql}"

        select_sql = f"{select_sql} LIMIT :limit"
        preview_sql = f"{preview_sql} LIMIT {safe_limit}"
        if offset > 0:
            select_sql = f"{select_sql} OFFSET :offset"
            preview_sql = f"{preview_sql} OFFSET {offset}"
        params["limit"] = safe_limit
        if offset > 0:
            params["offset"] = offset

        return select_sql, count_sql, preview_sql, params, resolved_columns, safe_page

    def query_serving_table(
        self,
        staged_dataset: DHIS2StagedDataset,
        *,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        limit: int | None = None,
        page: int | None = None,
        group_by_columns: list[str] | None = None,
        metric_column: str | None = None,
        metric_alias: str | None = None,
        aggregation_method: str | None = None,
        count_rows: bool = True,
    ) -> dict[str, Any]:
        """Query the analytical serving table.

        Parameters
        ----------
        count_rows:
            When ``False`` the extra ``SELECT COUNT(*)`` query is skipped.
            Set this for chart renders where total row count is irrelevant;
            it eliminates a second full-table scan on every load.
        """
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        safe_limit = self._coerce_query_limit(limit)
        safe_page = max(1, int(page or 1))
        if not self.serving_table_exists(staged_dataset):
            return {
                "columns": [],
                "rows": [],
                "limit": safe_limit,
                "page": safe_page,
                "total_pages": 0,
                "total_rows": 0,
                "serving_table_ref": full_name,
                "sql_preview": f"SELECT * FROM {full_name} LIMIT {safe_limit}",
            }

        (
            select_sql,
            count_sql,
            preview_sql,
            params,
            resolved_columns,
            safe_page,
        ) = self._build_serving_query(
            staged_dataset,
            selected_columns=selected_columns,
            filters=filters,
            limit=limit,
            page=page,
            group_by_columns=group_by_columns,
            metric_column=metric_column,
            metric_alias=metric_alias,
            aggregation_method=aggregation_method,
        )
        if not resolved_columns:
            return {
                "columns": [],
                "rows": [],
                "limit": safe_limit,
                "page": safe_page,
                "total_pages": 0,
                "total_rows": 0,
                "serving_table_ref": full_name,
                "sql_preview": f"SELECT * FROM {full_name} LIMIT {safe_limit}",
            }

        effective_limit = params.get("limit", safe_limit)
        with db.engine.connect() as conn:
            self.apply_connection_optimizations(conn, self._dialect_name)
            result = conn.execute(text(select_sql), params)
            rows = [dict(row._mapping) for row in result]
            if count_rows:
                total_rows_int = int(
                    conn.execute(
                        text(count_sql),
                        {k: v for k, v in params.items() if k != "limit"},
                    ).scalar()
                    or 0
                )
            else:
                # Estimate from returned row count to avoid the extra scan
                total_rows_int = len(rows) if len(rows) < effective_limit else -1

        total_pages = (
            max(1, (total_rows_int + effective_limit - 1) // effective_limit)
            if total_rows_int > 0
            else (1 if rows else 0)
        )

        return {
            "columns": resolved_columns,
            "rows": rows,
            "limit": effective_limit,
            "page": safe_page,
            "total_pages": total_pages,
            "total_rows": total_rows_int,
            "serving_table_ref": full_name,
            "sql_preview": preview_sql,
        }

    def get_serving_filter_options(
        self,
        staged_dataset: DHIS2StagedDataset,
        *,
        columns: list[dict[str, Any]] | None = None,
        filters: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        available_columns = self.get_serving_table_columns(staged_dataset)
        if not available_columns:
            return {"org_unit_filters": [], "period_filter": None}

        column_specs = [
            column
            for column in list(columns or [])
            if isinstance(column, dict)
            and str(column.get("column_name") or "").strip() in available_columns
        ]

        hierarchy_columns: list[dict[str, Any]] = []
        period_filter: dict[str, Any] | None = None
        for column in column_specs:
            column_name = str(column.get("column_name") or "").strip()
            if not column_name:
                continue
            extra = self._load_column_extra(column)
            if extra.get("dhis2_is_ou_hierarchy") is True:
                try:
                    level = int(extra.get("dhis2_ou_level"))
                except (TypeError, ValueError):
                    continue
                hierarchy_columns.append(
                    {
                        "column_name": column_name,
                        "verbose_name": column.get("verbose_name") or column_name,
                        "level": level,
                    }
                )
                continue
            if extra.get("dhis2_is_period") is True and period_filter is None:
                period_filter = {
                    "column_name": column_name,
                    "verbose_name": column.get("verbose_name") or column_name,
                }

        hierarchy_columns.sort(key=lambda item: int(item["level"]))

        normalized_filters = [
            filter_item
            for filter_item in list(filters or [])
            if isinstance(filter_item, dict)
        ]

        def _fetch_options_for_column(
            conn: Any,
            column_name: str,
            scoped_filters: list[dict[str, Any]] | None = None,
        ) -> list[dict[str, Any]]:
            quoted_column = self._quote_identifier(column_name)
            where_clauses, _preview_clauses, params = self._build_filter_clauses(
                scoped_filters,
                available_columns,
            )
            where_clauses.append(
                f"LENGTH(TRIM(COALESCE(CAST({quoted_column} AS TEXT), ''))) > 0"
            )
            where_sql = f" WHERE {' AND '.join(where_clauses)}"
            sql = (
                f"SELECT {quoted_column} AS option_value, COUNT(*) AS row_count "
                f"FROM {full_name}{where_sql} "
                f"GROUP BY {quoted_column} "
                f"ORDER BY {quoted_column}"
            )
            result = conn.execute(text(sql), params)
            return [
                {
                    "label": str(row._mapping.get("option_value") or ""),
                    "value": str(row._mapping.get("option_value") or ""),
                    "row_count": int(row._mapping.get("row_count") or 0),
                }
                for row in result
                if str(row._mapping.get("option_value") or "").strip()
            ]

        # Reuse a single connection for all filter-option queries to avoid
        # opening one connection per hierarchy column (N+1 connection overhead).
        org_unit_filters = []
        with db.engine.connect() as shared_conn:
            self.apply_connection_optimizations(shared_conn, self._dialect_name)
            for column in hierarchy_columns:
                column_name = str(column["column_name"])
                scoped_filters = [
                    filter_item
                    for filter_item in normalized_filters
                    if str(filter_item.get("column") or "").strip() != column_name
                ]
                org_unit_filters.append(
                    {
                        **column,
                        "options": _fetch_options_for_column(shared_conn, column_name, scoped_filters),
                    }
                )

            if period_filter is not None:
                period_column_name = str(period_filter["column_name"])
                scoped_period_filters = [
                    filter_item
                    for filter_item in normalized_filters
                    if str(filter_item.get("column") or "").strip() != period_column_name
                ]
                period_filter = {
                    **period_filter,
                    "options": _fetch_options_for_column(
                        shared_conn,
                        period_column_name,
                        scoped_period_filters,
                    ),
                }

        return {
            "org_unit_filters": org_unit_filters,
            "period_filter": period_filter,
        }

    def export_serving_table_csv(
        self,
        staged_dataset: DHIS2StagedDataset,
        *,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        limit: int | None = None,
    ) -> tuple[str, str]:
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            output = StringIO()
            return output.getvalue(), full_name

        (
            select_sql,
            _count_sql,
            _preview_sql,
            params,
            resolved_columns,
            _safe_page,
        ) = self._build_serving_query(
            staged_dataset,
            selected_columns=selected_columns,
            filters=filters,
            limit=self._coerce_query_limit(limit, for_download=True),
            for_download=True,
        )

        with db.engine.connect() as conn:
            result = conn.execute(text(select_sql), params)
            rows = [dict(row._mapping) for row in result]

        output = StringIO()
        writer = csv.DictWriter(output, fieldnames=resolved_columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column) for column in resolved_columns})
        return output.getvalue(), full_name

    def export_serving_table_tsv(
        self,
        staged_dataset: DHIS2StagedDataset,
        *,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        limit: int | None = None,
    ) -> tuple[str, str]:
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            return "", full_name

        (
            select_sql,
            _count_sql,
            _preview_sql,
            params,
            resolved_columns,
            _safe_page,
        ) = self._build_serving_query(
            staged_dataset,
            selected_columns=selected_columns,
            filters=filters,
            limit=self._coerce_query_limit(limit, for_download=True),
            for_download=True,
        )

        with db.engine.connect() as conn:
            result = conn.execute(text(select_sql), params)
            rows = [dict(row._mapping) for row in result]

        output = StringIO()
        writer = csv.DictWriter(
            output, fieldnames=resolved_columns, delimiter="\t"
        )
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column) for column in resolved_columns})
        return output.getvalue(), full_name

    def export_serving_table_json(
        self,
        staged_dataset: DHIS2StagedDataset,
        *,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        limit: int | None = None,
    ) -> tuple[str, str]:
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            return json.dumps([]), full_name

        (
            select_sql,
            _count_sql,
            _preview_sql,
            params,
            resolved_columns,
            _safe_page,
        ) = self._build_serving_query(
            staged_dataset,
            selected_columns=selected_columns,
            filters=filters,
            limit=self._coerce_query_limit(limit, for_download=True),
            for_download=True,
        )

        with db.engine.connect() as conn:
            result = conn.execute(text(select_sql), params)
            rows = [
                {col: row._mapping.get(col) for col in resolved_columns}
                for row in result
            ]

        return json.dumps(rows, default=str), full_name

    def fetch_staging_rows(
        self,
        staged_dataset: DHIS2StagedDataset,
        ou_filter: "dict[int, frozenset[str] | None] | None" = None,
    ) -> list[dict[str, Any]]:
        """Fetch raw staging rows for serving-table materialization.

        Parameters
        ----------
        staged_dataset:
            The DHIS2StagedDataset whose staging table to read.
        ou_filter:
            Optional per-instance OU allowlist built by
            ``_build_ou_filter_for_dataset()``.  When supplied, rows for OUs
            outside the current dataset configuration are excluded so stale
            staging rows do not pollute the serving table.

            * ``None``            → no filtering (backward-compatible default)
            * ``{inst_id: None}`` → user-relative markers only; include ALL rows
              for this instance
            * ``{inst_id: frozenset}`` → include only rows whose ``ou`` value
              is in the frozenset for that instance.  Instances NOT present in
              the dict are excluded entirely.
        """
        full_name = self.get_superset_sql_table_ref(staged_dataset)
        if not self.table_exists(staged_dataset):
            return []

        base_select = (
            f"SELECT source_instance_id, source_instance_name, dx_uid, pe, ou, "  # noqa: S608
            f"ou_name, value, value_numeric, co_uid, co_name "
            f"FROM {full_name}"
        )

        params: dict[str, Any] = {}
        where_sql = ""

        if ou_filter is not None:
            where_parts: list[str] = []
            for idx, (inst_id, allowed_ous) in enumerate(ou_filter.items()):
                params[f"inst_{idx}"] = inst_id
                if allowed_ous is None:
                    # User-relative only — include all rows for this instance
                    where_parts.append(f"source_instance_id = :inst_{idx}")
                elif allowed_ous:
                    keys = [f"ou_{idx}_{i}" for i in range(len(allowed_ous))]
                    for k, v in zip(keys, allowed_ous):
                        params[k] = v
                    placeholders = ", ".join(f":{k}" for k in keys)
                    where_parts.append(
                        f"(source_instance_id = :inst_{idx} AND ou IN ({placeholders}))"
                    )
                # empty frozenset → exclude this instance entirely (don't add a clause)
            if where_parts:
                where_sql = " WHERE " + " OR ".join(where_parts)
            else:
                # All instances were empty-frozenset → return nothing
                return []

        full_sql = f"{base_select}{where_sql} ORDER BY source_instance_id, pe, ou, dx_uid"

        with db.engine.connect() as conn:
            result = conn.execute(text(full_sql), params)
            return [dict(row._mapping) for row in result]

    def create_or_replace_serving_table(
        self,
        staged_dataset: DHIS2StagedDataset,
        columns: list[dict[str, Any]],
        rows: list[dict[str, Any]],
    ) -> str:
        table_name = self.get_serving_table_name(staged_dataset)
        full_name = self.get_serving_sql_table_ref(staged_dataset)

        logger.info(
            "Creating analytical serving table %s for staged_dataset id=%s",
            full_name,
            staged_dataset.id,
        )

        if not columns:
            raise ValueError("Analytical serving table requires at least one column")

        with self._write_connection() as conn:
            self.ensure_schema_exists(conn)
            conn.execute(text(f"DROP TABLE IF EXISTS {full_name}"))

            column_ddl = ", ".join(
                f'"{column["column_name"]}" {column.get("sql_type") or "TEXT"}'
                for column in columns
            )
            conn.execute(text(f"CREATE TABLE {full_name} ({column_ddl})"))

            insert_columns = [column["column_name"] for column in columns]
            if rows:
                quoted_insert_columns = ", ".join(
                    f'"{column}"' for column in insert_columns
                )
                insert_placeholders = ", ".join(
                    f":{column}" for column in insert_columns
                )
                insert_sql = text(
                    f"INSERT INTO {full_name} ({quoted_insert_columns}) "
                    f"VALUES ({insert_placeholders})"
                )
                for batch_start in range(0, len(rows), _INSERT_BATCH_SIZE):
                    batch = rows[batch_start : batch_start + _INSERT_BATCH_SIZE]
                    params = [
                        {column: row.get(column) for column in insert_columns}
                        for row in batch
                    ]
                    conn.execute(insert_sql, params)

            # Index all dimension/filter columns — not just period and dhis2_instance.
            # Serving tables are read-heavy: dashboard filter selects do GROUP BY on
            # every hierarchy and period column, causing full table scans without indexes.
            _ALWAYS_INDEX = {"period", "dhis2_instance"}
            for column in columns:
                col_name = column["column_name"]
                col_extra: dict = {}
                try:
                    raw_extra = column.get("extra") or ""
                    if raw_extra:
                        col_extra = (
                            json.loads(raw_extra)
                            if isinstance(raw_extra, str)
                            else dict(raw_extra)
                        )
                except Exception:  # pylint: disable=broad-except
                    pass

                should_index = (
                    col_name in _ALWAYS_INDEX
                    or col_extra.get("dhis2_is_period")
                    or col_extra.get("dhis2_is_ou_hierarchy")
                    or col_extra.get("dhis2_is_dimension")
                )
                if should_index:
                    self._create_serving_index(conn, table_name, full_name, col_name)

            # Give the query planner accurate row statistics after bulk insert
            self._run_analyze(conn, full_name)

        return full_name

    def replace_rows_for_instance(
        self,
        staged_dataset: DHIS2StagedDataset,
        instance_id: int,
        instance_name: str,
        rows: list[dict[str, Any]],
        sync_job_id: int | None = None,
    ) -> int:
        """Atomically replace all staged rows for a single source instance.

        The delete and insert phases run inside one database transaction so a
        failed insert rolls back the delete and preserves the previous staged
        data for that instance.
        """
        self.create_staging_table(staged_dataset)

        full_name = self.get_superset_sql_table_ref(staged_dataset)
        insert_sql = text(f"""
            INSERT INTO {full_name} (
                source_instance_id,
                source_instance_name,
                dx_uid,
                dx_name,
                dx_type,
                pe,
                ou,
                ou_name,
                ou_level,
                value,
                value_numeric,
                co_uid,
                co_name,
                aoc_uid,
                sync_job_id
            ) VALUES (
                :source_instance_id,
                :source_instance_name,
                :dx_uid,
                :dx_name,
                :dx_type,
                :pe,
                :ou,
                :ou_name,
                :ou_level,
                :value,
                :value_numeric,
                :co_uid,
                :co_name,
                :aoc_uid,
                :sync_job_id
            )
            ON CONFLICT DO NOTHING
        """)

        total_inserted = 0
        with self._write_connection() as conn:
            conn.execute(
                text(
                    f"DELETE FROM {full_name} "  # noqa: S608
                    "WHERE source_instance_id = :instance_id"
                ),
                {"instance_id": instance_id},
            )

            for batch_start in range(0, len(rows), _INSERT_BATCH_SIZE):
                batch = rows[batch_start : batch_start + _INSERT_BATCH_SIZE]
                if not batch:
                    continue
                params = [
                    {
                        "source_instance_id": instance_id,
                        "source_instance_name": instance_name,
                        "dx_uid": row.get("dx_uid"),
                        "dx_name": row.get("dx_name"),
                        "dx_type": row.get("dx_type"),
                        "pe": row.get("pe"),
                        "ou": row.get("ou"),
                        "ou_name": row.get("ou_name"),
                        "ou_level": row.get("ou_level"),
                        "value": row.get("value"),
                        "value_numeric": row.get("value_numeric"),
                        "co_uid": _normalize_fact_grain_uid(row.get("co_uid")),
                        "co_name": row.get("co_name"),
                        "aoc_uid": _normalize_fact_grain_uid(row.get("aoc_uid")),
                        "sync_job_id": sync_job_id,
                    }
                    for row in batch
                ]
                result = conn.execute(insert_sql, params)
                batch_count = result.rowcount if result.rowcount >= 0 else len(batch)
                total_inserted += batch_count

        logger.info(
            "Replaced %d rows in %s for instance_id=%s",
            total_inserted,
            full_name,
            instance_id,
        )
        return total_inserted

    def upsert_rows_for_instance(
        self,
        staged_dataset: DHIS2StagedDataset,
        instance_id: int,
        instance_name: str,
        rows: list[dict[str, Any]],
        sync_job_id: int | None = None,
    ) -> int:
        if not rows:
            return 0

        self.create_staging_table(staged_dataset)
        full_name = self.get_superset_sql_table_ref(staged_dataset)
        insert_sql = text(f"""
            INSERT INTO {full_name} (
                source_instance_id,
                source_instance_name,
                dx_uid,
                dx_name,
                dx_type,
                pe,
                ou,
                ou_name,
                ou_level,
                value,
                value_numeric,
                co_uid,
                co_name,
                aoc_uid,
                sync_job_id
            ) VALUES (
                :source_instance_id,
                :source_instance_name,
                :dx_uid,
                :dx_name,
                :dx_type,
                :pe,
                :ou,
                :ou_name,
                :ou_level,
                :value,
                :value_numeric,
                :co_uid,
                :co_name,
                :aoc_uid,
                :sync_job_id
            )
            ON CONFLICT (source_instance_id, dx_uid, pe, ou, co_uid, aoc_uid)
            DO UPDATE SET
                source_instance_name = excluded.source_instance_name,
                dx_name = excluded.dx_name,
                dx_type = excluded.dx_type,
                ou_name = excluded.ou_name,
                ou_level = excluded.ou_level,
                value = excluded.value,
                value_numeric = excluded.value_numeric,
                co_uid = excluded.co_uid,
                co_name = excluded.co_name,
                aoc_uid = excluded.aoc_uid,
                sync_job_id = excluded.sync_job_id,
                synced_at = CURRENT_TIMESTAMP
        """)

        total_written = 0
        with self._write_connection() as conn:
            for batch_start in range(0, len(rows), _INSERT_BATCH_SIZE):
                batch = rows[batch_start : batch_start + _INSERT_BATCH_SIZE]
                if not batch:
                    continue
                params = [
                    {
                        "source_instance_id": instance_id,
                        "source_instance_name": instance_name,
                        "dx_uid": row.get("dx_uid"),
                        "dx_name": row.get("dx_name"),
                        "dx_type": row.get("dx_type"),
                        "pe": row.get("pe"),
                        "ou": row.get("ou"),
                        "ou_name": row.get("ou_name"),
                        "ou_level": row.get("ou_level"),
                        "value": row.get("value"),
                        "value_numeric": row.get("value_numeric"),
                        "co_uid": _normalize_fact_grain_uid(row.get("co_uid")),
                        "co_name": row.get("co_name"),
                        "aoc_uid": _normalize_fact_grain_uid(row.get("aoc_uid")),
                        "sync_job_id": sync_job_id,
                    }
                    for row in batch
                ]
                result = conn.execute(insert_sql, params)
                batch_count = result.rowcount if result.rowcount >= 0 else len(batch)
                total_written += batch_count

        logger.info(
            "Upserted %d rows in %s for instance_id=%s",
            total_written,
            full_name,
            instance_id,
        )
        return total_written

    def get_staging_table_stats(self, staged_dataset: DHIS2StagedDataset) -> dict[str, Any]:
        """Return diagnostic statistics about the staging table.

        Args:
            staged_dataset: The staged dataset to inspect.

        Returns:
            A dict with the following keys:

            ``total_rows``
                Total row count across all instances.
            ``rows_per_instance``
                Dict mapping ``source_instance_id`` (int) to row count.
            ``min_synced_at``
                ISO-formatted timestamp of the oldest row, or ``None``.
            ``max_synced_at``
                ISO-formatted timestamp of the newest row, or ``None``.
            ``table_size_bytes``
                Physical table size in bytes as reported by PostgreSQL, or
                ``None`` when the table does not exist.
        """
        full_name = self.get_superset_sql_table_ref(staged_dataset)

        if not self.table_exists(staged_dataset):
            return {
                "total_rows": 0,
                "rows_per_instance": {},
                "min_synced_at": None,
                "max_synced_at": None,
                "table_size_bytes": None,
            }

        with db.engine.connect() as conn:
            # Aggregate row counts and timestamp range.
            agg = conn.execute(
                text(
                    f"SELECT "  # noqa: S608
                    f"  COUNT(*) AS total_rows, "
                    f"  MIN(synced_at) AS min_synced_at, "
                    f"  MAX(synced_at) AS max_synced_at "
                    f"FROM {full_name}"
                )
            ).fetchone()

            # Per-instance breakdown.
            per_instance_rows = conn.execute(
                text(
                    f"SELECT source_instance_id, COUNT(*) AS cnt "  # noqa: S608
                    f"FROM {full_name} "
                    f"GROUP BY source_instance_id"
                )
            ).fetchall()

            # Physical table size.
            size_row = None
            if self._dialect_name == "postgresql":
                size_row = conn.execute(
                    text("SELECT pg_total_relation_size(:rel) AS bytes"),
                    {"rel": full_name},
                ).fetchone()

        rows_per_instance = {
            int(r[0]): int(r[1]) for r in per_instance_rows
        }

        return {
            "total_rows": int(agg[0]) if agg else 0,
            "rows_per_instance": rows_per_instance,
            "min_synced_at": _isoformat_timestamp(agg[1] if agg else None),
            "max_synced_at": _isoformat_timestamp(agg[2] if agg else None),
            "table_size_bytes": int(size_row[0]) if size_row and size_row[0] is not None else None,
        }

    def get_staging_table_preview(
        self,
        staged_dataset: DHIS2StagedDataset,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Return a preview of rows from a staged dataset's raw staging table."""
        safe_limit = max(1, min(int(limit or 50), 500))
        full_name = self.get_superset_sql_table_ref(staged_dataset)
        serving_ref = self.get_serving_sql_table_ref(staged_dataset)

        if not self.table_exists(staged_dataset):
            return {
                "columns": [],
                "rows": [],
                "limit": safe_limit,
                "staging_table_ref": full_name,
                "serving_table_ref": serving_ref,
                "diagnostics": {
                    "table_exists": False,
                    "row_count": 0,
                    "sql_preview": f"SELECT * FROM {full_name} LIMIT {safe_limit}",
                    "rows_returned": 0,
                    "org_unit_columns": ["ou", "ou_name", "ou_level"],
                    "period_columns": ["pe"],
                },
            }

        with db.engine.connect() as conn:
            row_count_result = conn.execute(
                text(f"SELECT COUNT(*) FROM {full_name}")  # noqa: S608
            ).fetchone()
            row_count = int(row_count_result[0]) if row_count_result else 0
            preview_sql = (
                f"SELECT * FROM {full_name} "  # noqa: S608
                'ORDER BY "source_instance_id", "pe", "dx_uid", "ou" '
                "LIMIT :limit"
            )
            result = conn.execute(
                text(preview_sql),
                {"limit": safe_limit},
            )
            columns = list(result.keys())
            rows = [dict(row._mapping) for row in result]

        return {
            "columns": columns,
            "rows": rows,
            "limit": safe_limit,
            "staging_table_ref": full_name,
            "serving_table_ref": serving_ref,
            "diagnostics": {
                "table_exists": True,
                "row_count": row_count,
                "sql_preview": preview_sql.replace(":limit", str(safe_limit)),
                "rows_returned": len(rows),
                "org_unit_columns": [
                    column_name
                    for column_name in ("ou", "ou_name", "ou_level")
                    if column_name in columns
                ],
                "period_columns": [
                    column_name for column_name in ("pe",) if column_name in columns
                ],
            },
        }
