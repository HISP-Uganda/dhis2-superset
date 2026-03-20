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
DuckDB local staging engine adapter.

Stores all DHIS2 staged data in an embedded DuckDB database file instead of
Superset's metadata DB.  This is optimal for analytical workloads on mid-scale
datasets (up to a few hundred million rows).

Configuration (stored in ``local_staging_settings.duckdb_config`` as JSON)::

    {
        "db_path": "/var/lib/superset/dhis2_staging.duckdb",
        "read_only": false,
        "memory_limit": "2GB",
        "threads": 4
    }

The database file is created automatically on first use.  A matching Superset
``Database`` object (with ``sqlalchemy_uri = "duckdb:///…"``) is created or
updated so Superset can query the serving tables directly.

Dependencies
------------
Install with::

    pip install duckdb duckdb-engine

``duckdb-engine`` provides the SQLAlchemy dialect (``duckdb://``).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Iterator

from superset.local_staging.base_engine import LocalStagingEngineBase
from superset.local_staging.exceptions import (
    EngineNotConfiguredError,
    EngineUnavailableError,
)

logger = logging.getLogger(__name__)

# Standard columns present in every staging table
_STAGING_COLUMNS = [
    ("id", "BIGINT"),
    ("source_instance_id", "INTEGER NOT NULL"),
    ("source_instance_name", "TEXT NOT NULL"),
    ("dx_uid", "TEXT NOT NULL"),
    ("dx_name", "TEXT"),
    ("dx_type", "TEXT NOT NULL"),
    ("pe", "TEXT NOT NULL"),
    ("ou", "TEXT NOT NULL"),
    ("ou_name", "TEXT"),
    ("ou_level", "INTEGER"),
    ("value", "TEXT"),
    ("value_numeric", "DOUBLE"),
    ("co_uid", "TEXT"),
    ("co_name", "TEXT"),
    ("aoc_uid", "TEXT"),
    ("synced_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"),
    ("sync_job_id", "INTEGER"),
]

_PG_IDENT_MAX = 63
_SERVING_PREFIX = "sv"


def _sanitize_name(name: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()
    return sanitized[:40] if sanitized else "dataset"


def _staging_table_name(staged_dataset: Any) -> str:
    sanitized = _sanitize_name(staged_dataset.name)
    return f"ds_{staged_dataset.id}_{sanitized}"[:_PG_IDENT_MAX]


def _serving_table_name(staged_dataset: Any) -> str:
    sanitized = _sanitize_name(staged_dataset.name)
    return f"{_SERVING_PREFIX}_{staged_dataset.id}_{sanitized}"[:_PG_IDENT_MAX]


class DuckDBStagingEngine(LocalStagingEngineBase):
    """DuckDB-backed staging engine.

    Args:
        database_id: Superset Database PK (kept for audit; DuckDB stores data
            in its own file, not in the Superset metadata DB).
        config: Engine configuration dict (see module docstring).
    """

    STAGING_SCHEMA = "main"

    def __init__(self, database_id: int, config: dict[str, Any]) -> None:
        self.database_id = database_id
        self._config = config
        self._conn: Any = None  # lazy DuckDB connection

    # ------------------------------------------------------------------
    # Engine identity
    # ------------------------------------------------------------------

    @property
    def engine_name(self) -> str:
        return "duckdb"

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    @property
    def _db_path(self) -> str:
        path = self._config.get("db_path", "")
        if not path:
            raise EngineNotConfiguredError(
                "DuckDB engine requires 'db_path' in configuration"
            )
        return path

    def _connect(self) -> Any:
        """Return (or create) the write DuckDB connection.

        Only for write paths (insert, upsert, create table, etc.).  Always
        call ``self.close()`` immediately after every write operation so other
        processes are not blocked waiting for the lock.
        """
        try:
            import duckdb  # type: ignore[import]
        except ImportError as exc:
            raise EngineUnavailableError(
                "duckdb package is not installed. Run: pip install duckdb duckdb-engine"
            ) from exc

        if self._conn is None:
            db_path = self._db_path
            # Ensure parent directory exists — raise a clear configured error
            # (not a raw PermissionError) when the directory isn't accessible.
            parent_dir = os.path.dirname(os.path.abspath(db_path))
            try:
                os.makedirs(parent_dir, exist_ok=True)
            except PermissionError as exc:
                raise EngineNotConfiguredError(
                    f"DuckDB data directory is not writable: {parent_dir}. "
                    f"Update LOCAL_STAGING_SETTINGS.duckdb_config.db_path to a "
                    f"writable location (e.g. a path under the Superset home dir)."
                ) from exc
            memory_limit = self._config.get("memory_limit", "1GB")
            threads = self._config.get("threads", 2)
            logger.debug(
                "DuckDB: opening WRITE connection pid=%d path=%s",
                os.getpid(), db_path,
            )
            self._conn = duckdb.connect(db_path)
            self._conn.execute(f"SET memory_limit='{memory_limit}'")
            self._conn.execute(f"SET threads={threads}")
            # Ensure schema exists
            self._conn.execute(f"CREATE SCHEMA IF NOT EXISTS {self.STAGING_SCHEMA}")
        return self._conn

    def _connect_read_only(self) -> Any:
        """Open and return a short-lived read-only DuckDB connection.

        DuckDB allows unlimited simultaneous read-only connections even while a
        write connection is open, so this never produces a "Conflicting lock"
        error.  The caller is responsible for closing the returned connection.
        """
        try:
            import duckdb  # type: ignore[import]
        except ImportError as exc:
            raise EngineUnavailableError(
                "duckdb package is not installed. Run: pip install duckdb duckdb-engine"
            ) from exc

        db_path = self._db_path
        if not os.path.exists(db_path):
            raise EngineNotConfiguredError(
                f"DuckDB file not found: {db_path}. Run the first data sync to "
                f"initialise the staging database."
            )
        logger.debug(
            "DuckDB: opening READ-ONLY connection pid=%d path=%s",
            os.getpid(), db_path,
        )
        return duckdb.connect(db_path, read_only=True)

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the DuckDB connection and release the write lock.

        Called automatically after every write operation (insert, upsert,
        truncate, create-serving-table) so that SQLAlchemy chart queries can
        open the same DuckDB file without hitting a lock conflict.
        """
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:  # pylint: disable=broad-except
                pass
            self._conn = None

    def health_check(self) -> dict[str, Any]:
        conn = None
        try:
            conn = self._connect_read_only()
            conn.execute("SELECT 1")
            return {
                "ok": True,
                "message": f"DuckDB connected at {self._db_path}",
                "engine": "duckdb",
                "db_path": self._db_path,
            }
        except EngineNotConfiguredError as exc:
            return {"ok": False, "message": str(exc), "engine": "duckdb"}
        except EngineUnavailableError as exc:
            return {"ok": False, "message": str(exc), "engine": "duckdb"}
        except Exception as exc:  # pylint: disable=broad-except
            return {
                "ok": False,
                "message": f"DuckDB error: {exc}",
                "engine": "duckdb",
            }
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:  # pylint: disable=broad-except
                    pass

    # ------------------------------------------------------------------
    # Schema / table lifecycle
    # ------------------------------------------------------------------

    def ensure_schema_exists(self, conn: Any) -> None:
        # conn is ignored; DuckDB schema is created in _connect()
        self._connect().execute(
            f"CREATE SCHEMA IF NOT EXISTS {self.STAGING_SCHEMA}"
        )

    def get_staging_table_name(self, staged_dataset: Any) -> str:
        return _staging_table_name(staged_dataset)

    def get_serving_table_name(self, staged_dataset: Any) -> str:
        return _serving_table_name(staged_dataset)

    def get_serving_sql_table_ref(self, staged_dataset: Any) -> str:
        return f"{self.STAGING_SCHEMA}.{_serving_table_name(staged_dataset)}"

    def get_superset_sql_table_ref(self, staged_dataset: Any) -> str:
        table_name = (
            staged_dataset.staging_table_name
            or _staging_table_name(staged_dataset)
        )
        return f"{self.STAGING_SCHEMA}.{table_name}"

    def create_staging_table(self, staged_dataset: Any) -> str:
        conn = self._connect()
        table = _staging_table_name(staged_dataset)
        qualified = f"{self.STAGING_SCHEMA}.{table}"
        cols_ddl = ",\n  ".join(f"{col} {dtype}" for col, dtype in _STAGING_COLUMNS)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {qualified} (
              {cols_ddl},
              PRIMARY KEY (id)
            )
        """)
        # Sequence for id
        conn.execute(f"""
            CREATE SEQUENCE IF NOT EXISTS {self.STAGING_SCHEMA}.seq_{table}
            START 1 INCREMENT 1
        """)
        # Common indexes
        for idx_suffix, idx_col in [
            ("instance", "source_instance_id"),
            ("dx", "dx_uid"),
            ("pe", "pe"),
            ("ou", "ou"),
        ]:
            conn.execute(f"""
                CREATE INDEX IF NOT EXISTS ix_{table}_{idx_suffix}
                ON {qualified} ({idx_col})
            """)
        logger.info("DuckDB: created staging table %s", qualified)
        return table

    def drop_staging_table(self, staged_dataset: Any) -> None:
        conn = self._connect()
        table = _staging_table_name(staged_dataset)
        qualified = f"{self.STAGING_SCHEMA}.{table}"
        conn.execute(f"DROP TABLE IF EXISTS {qualified}")
        conn.execute(
            f"DROP SEQUENCE IF EXISTS {self.STAGING_SCHEMA}.seq_{table}"
        )
        logger.info("DuckDB: dropped staging table %s", qualified)

    def truncate_staging_table(self, staged_dataset: Any) -> None:
        conn = self._connect()
        qualified = (
            f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"
        )
        conn.execute(f"DELETE FROM {qualified}")
        self.close()

    def table_exists(self, staged_dataset: Any) -> bool:
        conn = None
        try:
            conn = self._connect_read_only()
        except (EngineNotConfiguredError, EngineUnavailableError):
            return False
        try:
            table = _staging_table_name(staged_dataset)
            result = conn.execute(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = ? AND table_name = ?",
                [self.STAGING_SCHEMA, table],
            ).fetchone()
            return bool(result and result[0] > 0)
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass

    def serving_table_exists(self, staged_dataset: Any) -> bool:
        conn = None
        try:
            conn = self._connect_read_only()
        except (EngineNotConfiguredError, EngineUnavailableError):
            return False
        try:
            table = _serving_table_name(staged_dataset)
            result = conn.execute(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = ? AND table_name = ?",
                [self.STAGING_SCHEMA, table],
            ).fetchone()
            return bool(result and result[0] > 0)
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass

    # ------------------------------------------------------------------
    # Data ingestion
    # ------------------------------------------------------------------

    def replace_rows_for_instance(
        self,
        staged_dataset: Any,
        instance_id: int,
        instance_name: str,
        rows: list[dict[str, Any]],
        *,
        periods: list[str] | None = None,
        sync_job_id: int | None = None,
        replace_all: bool = False,
    ) -> dict[str, int]:
        conn = self._connect()
        qualified = (
            f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"
        )
        deleted = 0
        if replace_all:
            result = conn.execute(
                f"DELETE FROM {qualified} WHERE source_instance_id = ?",
                [instance_id],
            )
            deleted = result.rowcount or 0
        elif periods:
            placeholders = ", ".join("?" for _ in periods)
            result = conn.execute(
                f"DELETE FROM {qualified} "
                f"WHERE source_instance_id = ? AND pe IN ({placeholders})",
                [instance_id, *periods],
            )
            deleted = result.rowcount or 0

        inserted = self.insert_rows(
            staged_dataset,
            instance_id,
            instance_name,
            rows,
            sync_job_id=sync_job_id,
        )
        self.close()
        return {"deleted": deleted, "inserted": inserted}

    def insert_rows(
        self,
        staged_dataset: Any,
        instance_id: int,
        instance_name: str,
        rows: list[dict[str, Any]],
        *,
        sync_job_id: int | None = None,
    ) -> int:
        if not rows:
            return 0
        conn = self._connect()
        table = _staging_table_name(staged_dataset)
        qualified = f"{self.STAGING_SCHEMA}.{table}"
        _ROW_COLS = (
            "dx_uid", "dx_name", "dx_type", "pe", "ou", "ou_name",
            "ou_level", "value", "value_numeric", "co_uid", "co_name", "aoc_uid",
        )
        seq_name = f"{self.STAGING_SCHEMA}.seq_{table}"
        # Ensure sequence exists (guards against tables created before seq was added)
        conn.execute(
            f"CREATE SEQUENCE IF NOT EXISTS {seq_name} START 1 INCREMENT 1"
        )
        col_list = (
            "id, source_instance_id, source_instance_name, sync_job_id, synced_at, "
            + ", ".join(_ROW_COLS)
        )
        # nextval() is a SQL expression for the id; remaining columns use ? params
        placeholders = f"nextval('{seq_name}'), " + ", ".join(
            "?" for _ in range(4 + len(_ROW_COLS))
        )
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        batch: list[tuple] = []
        for row in rows:
            batch.append((
                instance_id,
                instance_name,
                sync_job_id,
                now,
                *(row.get(col) for col in _ROW_COLS),
            ))
            if len(batch) >= 1000:
                conn.executemany(
                    f"INSERT INTO {qualified} ({col_list}) VALUES ({placeholders})",
                    batch,
                )
                batch = []
        if batch:
            conn.executemany(
                f"INSERT INTO {qualified} ({col_list}) VALUES ({placeholders})",
                batch,
            )
        return len(rows)

    def upsert_rows_for_instance(
        self,
        staged_dataset: Any,
        instance_id: int,
        instance_name: str,
        rows: list[dict[str, Any]],
        *,
        sync_job_id: int | None = None,
    ) -> int:
        """Upsert rows into the DuckDB staging table for a single instance.

        DuckDB's staging table uses a surrogate ``id`` primary key without a
        unique constraint on the natural key ``(source_instance_id, dx_uid,
        pe, ou)``, so a true SQL upsert is unavailable.  We emulate it with a
        DELETE-then-INSERT: delete any existing rows whose natural key matches
        the incoming batch, then bulk-insert the new rows.  This guarantees
        idempotency without requiring schema changes.
        """
        if not rows:
            return 0

        conn = self._connect()
        qualified = f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"

        # Collect unique (dx_uid, pe, ou) triples in the incoming batch so we
        # can delete stale rows in one pass before re-inserting.
        keys: set[tuple[str, str, str]] = set()
        for row in rows:
            dx = row.get("dx_uid") or ""
            pe = row.get("pe") or ""
            ou = row.get("ou") or ""
            if dx and pe and ou:
                keys.add((dx, pe, ou))

        if keys:
            # DuckDB does not support row-tuple IN (VALUES …).  Concatenate
            # the three key columns with a null-byte separator (safe because
            # DHIS2 UIDs never contain \x00) and use a flat IN list instead.
            composite = [f"{dx}\x00{pe}\x00{ou}" for dx, pe, ou in keys]
            placeholders = ", ".join("?" for _ in composite)
            conn.execute(
                f"DELETE FROM {qualified} "
                f"WHERE source_instance_id = ? "
                f"AND (dx_uid || chr(0) || pe || chr(0) || ou) IN ({placeholders})",
                [instance_id, *composite],
            )

        result = self.insert_rows(
            staged_dataset,
            instance_id,
            instance_name,
            rows,
            sync_job_id=sync_job_id,
        )
        self.close()
        return result

    def get_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
    ) -> list[str]:
        conn = None
        try:
            conn = self._connect_read_only()
            qualified = (
                f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"
            )
            rows = conn.execute(
                f"SELECT DISTINCT pe FROM {qualified} WHERE source_instance_id = ? ORDER BY pe",
                [instance_id],
            ).fetchall()
            return [r[0] for r in rows if r[0]]
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:  # pylint: disable=broad-except
                    pass

    def delete_rows_for_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
        periods: list[str],
    ) -> int:
        if not periods:
            return 0
        conn = self._connect()
        qualified = (
            f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"
        )
        placeholders = ", ".join("?" for _ in periods)
        result = conn.execute(
            f"DELETE FROM {qualified} "
            f"WHERE source_instance_id = ? AND pe IN ({placeholders})",
            [instance_id, *periods],
        )
        deleted = result.rowcount or 0
        self.close()
        return deleted

    # ------------------------------------------------------------------
    # Serving table
    # ------------------------------------------------------------------

    def create_or_replace_serving_table(
        self,
        staged_dataset: Any,
        columns_config: list[dict[str, Any]] | None = None,
        *,
        instance_id: int | None = None,
        columns: list[dict[str, Any]] | None = None,
        rows: list[dict[str, Any]] | None = None,
    ) -> str:
        """Materialise the serving table using a safe temp-then-swap pattern.

        Data is loaded into a ``<serving>__loading`` staging table first.
        Once fully loaded, the old live table is dropped and the loading table
        is atomically renamed to the live name.  UI reads continue hitting the
        last good live table throughout the load; they only see a brief ~1ms
        gap between DROP and RENAME (within the same write connection).

        When *columns* and *rows* are supplied (from
        ``ensure_serving_table``'s materialized output) they are used to
        build the serving table so that hierarchy / metric columns match the
        manifest schema exactly.  Without them we fall back to copying the
        raw staging table.
        """
        conn = self._connect()
        serving_name = _serving_table_name(staged_dataset)
        serving = f"{self.STAGING_SCHEMA}.{serving_name}"
        loading_name = f"{serving_name}__loading"
        loading = f"{self.STAGING_SCHEMA}.{loading_name}"

        # Always start clean — drop any abandoned loading table from a previous run
        conn.execute(f"DROP TABLE IF EXISTS {loading}")

        effective_cols = columns or columns_config
        try:
            if effective_cols:
                # Build typed DDL from column spec
                col_ddl_parts: list[str] = []
                col_names: list[str] = []
                for col in effective_cols:
                    col_name = str(col.get("column_name") or "").strip()
                    if not col_name:
                        continue
                    col_type = str(col.get("type") or "TEXT").upper()
                    # Map Superset / analytical_serving types → DuckDB types
                    if col_type in ("FLOAT", "DOUBLE", "NUMERIC", "DECIMAL", "NUMBER"):
                        duckdb_type = "DOUBLE"
                    elif col_type in ("INT", "INTEGER", "BIGINT", "SMALLINT"):
                        duckdb_type = "BIGINT"
                    elif col_type in ("BOOLEAN", "BOOL"):
                        duckdb_type = "BOOLEAN"
                    elif col_type in ("DATE",):
                        duckdb_type = "DATE"
                    elif col_type in ("TIMESTAMP", "DATETIME"):
                        duckdb_type = "TIMESTAMP"
                    else:
                        duckdb_type = "TEXT"
                    col_ddl_parts.append(f'"{col_name}" {duckdb_type}')
                    col_names.append(col_name)

                if col_ddl_parts:
                    conn.execute(
                        f"CREATE TABLE {loading} ({', '.join(col_ddl_parts)})"
                    )
                    if rows:
                        placeholders = ", ".join("?" for _ in col_names)
                        col_list_sql = ", ".join(f'"{c}"' for c in col_names)
                        batch: list[tuple] = []
                        for row in rows:
                            batch.append(tuple(row.get(c) for c in col_names))
                            if len(batch) >= 1000:
                                conn.executemany(
                                    f"INSERT INTO {loading} ({col_list_sql}) "
                                    f"VALUES ({placeholders})",
                                    batch,
                                )
                                batch = []
                        if batch:
                            conn.executemany(
                                f"INSERT INTO {loading} ({col_list_sql}) "
                                f"VALUES ({placeholders})",
                                batch,
                            )
                    logger.info(
                        "DuckDB: loaded %d rows into loading table %s; promoting to live",
                        len(rows) if rows else 0, loading,
                    )
                    # Atomic promote: drop old live, rename loading → live
                    conn.execute(f"DROP TABLE IF EXISTS {serving}")
                    conn.execute(
                        f"ALTER TABLE {loading} RENAME TO {serving_name}"
                    )
                    logger.info("DuckDB: promoted %s → %s", loading, serving)
                    self.close()
                    return serving_name
        except Exception:
            # Load failed — clean up the loading table, preserve the old live table
            try:
                conn.execute(f"DROP TABLE IF EXISTS {loading}")
            except Exception:  # pylint: disable=broad-except
                pass
            self.close()
            raise

        # Fallback: copy raw staging table
        staging = f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"
        where = (
            f"WHERE source_instance_id = {int(instance_id)}"
            if instance_id is not None
            else ""
        )
        conn.execute(f"CREATE TABLE {loading} AS SELECT * FROM {staging} {where}")
        logger.info("DuckDB: loaded staging copy into %s; promoting to live", loading)
        conn.execute(f"DROP TABLE IF EXISTS {serving}")
        conn.execute(f"ALTER TABLE {loading} RENAME TO {serving_name}")
        logger.info("DuckDB: promoted %s → %s (staging copy)", loading, serving)
        self.close()
        return serving_name

    def get_serving_table_columns(self, staged_dataset: Any) -> list[str]:
        """Return ordered column names of the serving table (strings, not dicts).

        Must return ``list[str]`` so that
        ``staged_dataset_service._serving_table_needs_rebuild`` can compare
        directly against the manifest's expected column-name list.
        """
        conn = None
        try:
            conn = self._connect_read_only()
        except (EngineNotConfiguredError, EngineUnavailableError):
            return []
        try:
            table = _serving_table_name(staged_dataset)
            rows = conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
                [self.STAGING_SCHEMA, table],
            ).fetchall()
            return [r[0] for r in rows]
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass

    def fetch_staging_rows(
        self,
        staged_dataset: Any,
        instance_id: int | None = None,
        limit: int = 1000,
        offset: int = 0,
        filters: list[dict[str, Any]] | None = None,
        ou_filter: "dict[int, Any] | None" = None,
    ) -> Iterator[dict[str, Any]]:
        conn = None
        try:
            conn = self._connect_read_only()
            qualified = (
                f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"
            )
            where_parts: list[str] = []
            params: list[Any] = []
            if instance_id is not None:
                where_parts.append("source_instance_id = ?")
                params.append(instance_id)
            # Apply ou_filter: per-instance OU allowlist
            if ou_filter:
                ou_clauses: list[str] = []
                for inst_id, ou_set in ou_filter.items():
                    if ou_set is None:
                        # Include all rows for this instance
                        ou_clauses.append("source_instance_id = ?")
                        params.append(int(inst_id))
                    elif ou_set:
                        placeholders = ", ".join("?" for _ in ou_set)
                        ou_clauses.append(
                            f"(source_instance_id = ? AND ou IN ({placeholders}))"
                        )
                        params.append(int(inst_id))
                        params.extend(ou_set)
                    # ou_set == empty frozenset → exclude this instance entirely
                if ou_clauses:
                    where_parts.append(f"({' OR '.join(ou_clauses)})")
            where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
            # limit=0 means no limit (fetch all rows)
            if limit and limit > 0:
                sql = f"SELECT * FROM {qualified} {where_clause} LIMIT ? OFFSET ?"
                rows = conn.execute(sql, [*params, limit, offset]).fetchall()
            else:
                sql = f"SELECT * FROM {qualified} {where_clause}"
                if offset:
                    sql += " OFFSET ?"
                    rows = conn.execute(sql, [*params, offset]).fetchall()
                else:
                    rows = conn.execute(sql, params).fetchall()
            cols = [
                d[0]
                for d in conn.execute(
                    f"SELECT * FROM {qualified} LIMIT 0"
                ).description
            ]
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:  # pylint: disable=broad-except
                    pass
        for row in rows:
            yield dict(zip(cols, row))

    _AGGREGATION_FN_MAP = {
        "sum": "SUM",
        "avg": "AVG",
        "average": "AVG",
        "max": "MAX",
        "min": "MIN",
        "count": "COUNT",
    }

    def query_serving_table(
        self,
        staged_dataset: Any,
        *,
        # Accept both the base-class param names and the DHIS2StagingEngine param names
        columns: list[str] | None = None,
        selected_columns: list[str] | None = None,  # alias used by staged_dataset_service
        filters: list[dict[str, Any]] | None = None,
        aggregation: str | None = None,
        group_by: list[str] | None = None,
        order_by: list[str] | None = None,
        limit: int = 1000,
        offset: int = 0,
        # Extra kwargs from staged_dataset_service
        page: int | None = None,
        group_by_columns: list[str] | None = None,
        metric_column: str | None = None,
        metric_alias: str | None = None,
        aggregation_method: str | None = None,
        count_rows: bool = True,
    ) -> dict[str, Any]:
        conn = self._connect_read_only()
        serving = f"{self.STAGING_SCHEMA}.{_serving_table_name(staged_dataset)}"
        # Resolve page-based offset
        effective_limit = int(limit or 1000)
        safe_page = max(1, int(page or 1))
        effective_offset = int(offset or (safe_page - 1) * effective_limit)

        # Build WHERE clause from filters
        where_parts: list[str] = []
        params: list[Any] = []
        for filt in list(filters or []):
            if not isinstance(filt, dict):
                continue
            col = str(filt.get("column") or "").strip()
            val = filt.get("value")
            if col and val is not None:
                if isinstance(val, (list, tuple)):
                    placeholders = ", ".join("?" for _ in val)
                    where_parts.append(f'"{col}" IN ({placeholders})')
                    params.extend(val)
                else:
                    where_parts.append(f'"{col}" = ?')
                    params.append(val)
        where_sql = f" WHERE {' AND '.join(where_parts)}" if where_parts else ""

        # Resolve aggregation: prefer aggregation_method/group_by_columns (new API)
        # over aggregation/group_by (old base-class API).
        eff_agg = aggregation_method or aggregation
        eff_group = group_by_columns or group_by
        eff_metric = metric_column
        eff_alias = metric_alias

        if eff_agg and eff_group and eff_metric:
            agg_fn = self._AGGREGATION_FN_MAP.get(
                str(eff_agg).strip().lower(), "SUM"
            )
            quoted_group = ", ".join(f'"{c}"' for c in eff_group)
            quoted_metric = f'"{eff_metric}"'
            if eff_agg.lower() == "count":
                agg_expr = f"COUNT(*)"
            else:
                agg_expr = f"{agg_fn}(COALESCE({quoted_metric}, 0))"
            alias = eff_alias or f"{agg_fn}_{eff_metric}"
            quoted_alias = f'"{alias}"'
            select_sql = (
                f"SELECT {quoted_group}, {agg_expr} AS {quoted_alias} "
                f"FROM {serving}{where_sql} GROUP BY {quoted_group}"
            )
            resolved_columns = list(eff_group) + [alias]
        else:
            # Simple column select
            effective_cols = selected_columns or columns
            if effective_cols:
                col_list = ", ".join(f'"{c}"' for c in effective_cols)
                resolved_columns = list(effective_cols)
            else:
                col_list = "*"
                resolved_columns = []
            select_sql = f"SELECT {col_list} FROM {serving}{where_sql}"

        paginated_sql = f"{select_sql} LIMIT {effective_limit} OFFSET {effective_offset}"

        try:
            try:
                rows_raw = conn.execute(paginated_sql, params).fetchall()
                if not resolved_columns:
                    desc = conn.execute(f"SELECT * FROM {serving} LIMIT 0").description
                    resolved_columns = [d[0] for d in desc]
            except Exception:  # pylint: disable=broad-except
                return {
                    "columns": [],
                    "rows": [],
                    "limit": effective_limit,
                    "page": safe_page,
                    "total_pages": 0,
                    "total_rows": 0,
                    "serving_table_ref": serving,
                    "sql_preview": paginated_sql,
                }

            rows = [dict(zip(resolved_columns, r)) for r in rows_raw]

            total_rows_int = len(rows)
            if count_rows:
                try:
                    count_row = conn.execute(
                        f"SELECT COUNT(*) FROM ({select_sql}) AS _cnt", params
                    ).fetchone()
                    total_rows_int = int(count_row[0] if count_row else 0)
                except Exception:  # pylint: disable=broad-except
                    total_rows_int = len(rows)

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
                "serving_table_ref": serving,
                "sql_preview": paginated_sql,
            }
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass

    def get_staging_table_stats(self, staged_dataset: Any) -> dict[str, Any]:
        conn = None
        try:
            conn = self._connect_read_only()
            qualified = (
                f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"
            )
            row = conn.execute(
                f"SELECT COUNT(*), MAX(synced_at) FROM {qualified}"
            ).fetchone()
            count, last_sync = (row or (0, None))
            db_path = self._db_path
            file_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0
            row_count = count or 0
            return {
                "row_count": row_count,
                "total_rows": row_count,  # alias used by the Data Workspace UI
                "last_synced_at": str(last_sync) if last_sync else None,
                "db_path": db_path,
                "file_size_bytes": file_size,
                "engine": "duckdb",
            }
        except Exception as exc:  # pylint: disable=broad-except
            return {"row_count": 0, "total_rows": 0, "error": str(exc), "engine": "duckdb"}
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:  # pylint: disable=broad-except
                    pass

    def get_staging_table_preview(
        self,
        staged_dataset: Any,
        limit: int = 50,
    ) -> dict[str, Any]:
        conn = None
        safe_limit = max(1, min(int(limit or 50), 500))
        staging_ref = self.get_superset_sql_table_ref(staged_dataset)
        serving_ref = self.get_serving_sql_table_ref(staged_dataset)
        try:
            conn = self._connect_read_only()
            qualified = (
                f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"
            )
            row_count = int(
                (conn.execute(f"SELECT COUNT(*) FROM {qualified}").fetchone() or [0])[0]
                or 0
            )
            preview_sql = (
                f"SELECT * FROM {qualified} "
                "ORDER BY source_instance_id, pe, dx_uid, ou "
                f"LIMIT {safe_limit}"
            )
            result = conn.execute(preview_sql).fetchall()
            columns = [
                d[0]
                for d in conn.execute(f"SELECT * FROM {qualified} LIMIT 0").description
            ]
            rows = [dict(zip(columns, row)) for row in result]
            return {
                "columns": columns,
                "rows": rows,
                "limit": safe_limit,
                "staging_table_ref": staging_ref,
                "serving_table_ref": serving_ref,
                "diagnostics": {
                    "table_exists": True,
                    "row_count": row_count,
                    "sql_preview": preview_sql,
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
        except Exception as exc:  # pylint: disable=broad-except
            return {
                "columns": [],
                "rows": [],
                "limit": safe_limit,
                "staging_table_ref": staging_ref,
                "serving_table_ref": serving_ref,
                "diagnostics": {
                    "table_exists": False,
                    "row_count": 0,
                    "sql_preview": f"SELECT * FROM {staging_ref} LIMIT {safe_limit}",
                    "rows_returned": 0,
                    "error": str(exc),
                    "org_unit_columns": [],
                    "period_columns": [],
                },
            }
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:  # pylint: disable=broad-except
                    pass

    # ------------------------------------------------------------------
    # Filter options (for local cascade filters in the Data Workspace)
    # ------------------------------------------------------------------

    def get_serving_filter_options(
        self,
        staged_dataset: Any,
        *,
        columns: list[dict[str, Any]] | None = None,
        filters: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Return distinct org-unit hierarchy and period values from the serving table.

        Mirrors ``DHIS2StagingEngine.get_serving_filter_options`` but queries
        DuckDB directly instead of Superset's metadata DB.
        """
        import json as _json  # pylint: disable=import-outside-toplevel

        serving = f"{self.STAGING_SCHEMA}.{_serving_table_name(staged_dataset)}"
        available_col_names = set(self.get_serving_table_columns(staged_dataset))
        if not available_col_names:
            return {"org_unit_filters": [], "period_filter": None}

        # Parse column metadata to identify hierarchy / period columns
        hierarchy_columns: list[dict[str, Any]] = []
        period_filter: dict[str, Any] | None = None
        for col_spec in list(columns or []):
            col_name = str(col_spec.get("column_name") or "").strip()
            if not col_name or col_name not in available_col_names:
                continue
            raw_extra = col_spec.get("extra") or {}
            if isinstance(raw_extra, str):
                try:
                    raw_extra = _json.loads(raw_extra) or {}
                except Exception:  # pylint: disable=broad-except
                    raw_extra = {}
            extra = raw_extra if isinstance(raw_extra, dict) else {}

            if extra.get("dhis2_is_ou_hierarchy") is True:
                try:
                    level = int(extra.get("dhis2_ou_level"))
                except (TypeError, ValueError):
                    continue
                hierarchy_columns.append({
                    "column_name": col_name,
                    "verbose_name": col_spec.get("verbose_name") or col_name,
                    "level": level,
                })
            elif extra.get("dhis2_is_period") is True and period_filter is None:
                period_filter = {
                    "column_name": col_name,
                    "verbose_name": col_spec.get("verbose_name") or col_name,
                }

        hierarchy_columns.sort(key=lambda c: int(c["level"]))
        normalized_filters = [f for f in list(filters or []) if isinstance(f, dict)]
        conn = self._connect_read_only()

        def _fetch_options(col_name: str, scoped_filters: list[dict[str, Any]]) -> list[dict[str, Any]]:
            where_parts = [
                f"LENGTH(TRIM(COALESCE(CAST(\"{col_name}\" AS VARCHAR), ''))) > 0"
            ]
            params: list[Any] = []
            for filt in scoped_filters:
                fcol = str(filt.get("column") or "").strip()
                fval = filt.get("value")
                if fcol and fcol in available_col_names and fval is not None:
                    if isinstance(fval, (list, tuple)):
                        placeholders = ", ".join("?" for _ in fval)
                        where_parts.append(f'"{fcol}" IN ({placeholders})')
                        params.extend(fval)
                    else:
                        where_parts.append(f'"{fcol}" = ?')
                        params.append(fval)
            where_sql = f" WHERE {' AND '.join(where_parts)}"
            sql = (
                f'SELECT "{col_name}" AS option_value, COUNT(*) AS row_count '
                f"FROM {serving}{where_sql} "
                f'GROUP BY "{col_name}" ORDER BY "{col_name}"'
            )
            try:
                rows = conn.execute(sql, params).fetchall()
            except Exception:  # pylint: disable=broad-except
                return []
            return [
                {"label": str(r[0] or ""), "value": str(r[0] or ""), "row_count": int(r[1] or 0)}
                for r in rows
                if str(r[0] or "").strip()
            ]

        try:
            org_unit_filters = []
            for col in hierarchy_columns:
                cname = str(col["column_name"])
                scoped = [f for f in normalized_filters if str(f.get("column") or "") != cname]
                org_unit_filters.append({**col, "options": _fetch_options(cname, scoped)})

            if period_filter is not None:
                pcol = str(period_filter["column_name"])
                scoped_p = [f for f in normalized_filters if str(f.get("column") or "") != pcol]
                period_filter = {**period_filter, "options": _fetch_options(pcol, scoped_p)}

            return {"org_unit_filters": org_unit_filters, "period_filter": period_filter}
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass

    # ------------------------------------------------------------------
    # Period helper — uses DuckDB connection, not Superset's db.engine
    # ------------------------------------------------------------------

    def get_distinct_periods(
        self,
        staged_dataset: Any,
        *,
        use_serving: bool = True,
    ) -> list[str]:
        conn = None
        try:
            conn = self._connect_read_only()
        except (EngineNotConfiguredError, EngineUnavailableError):
            return []

        if use_serving:
            full_name = self.get_serving_sql_table_ref(staged_dataset)
            period_col = "period"
        else:
            full_name = self.get_superset_sql_table_ref(staged_dataset)
            period_col = "pe"

        try:
            rows = conn.execute(
                f'SELECT DISTINCT "{period_col}" FROM {full_name} '
                f'WHERE "{period_col}" IS NOT NULL '
                f'ORDER BY "{period_col}"'
            ).fetchall()
            return [str(r[0]) for r in rows if r[0]]
        except Exception:  # pylint: disable=broad-except
            return []
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass

    # ------------------------------------------------------------------
    # Export helpers  (mirrors DHIS2StagingEngine.export_serving_table_*)
    # These are called by staged_dataset_service.export_serving_data_* and
    # must use the DuckDB native connection — NOT db.engine (PostgreSQL).
    # ------------------------------------------------------------------

    def _build_export_query(
        self,
        staged_dataset: Any,
        selected_columns: list[str] | None,
        filters: list[dict[str, Any]] | None,
        limit: int | None,
    ) -> tuple[str, list[str]]:
        """Return (sql_statement, resolved_column_names) for an export query."""
        full_name = self.get_serving_sql_table_ref(staged_dataset)

        conn = self._connect_read_only()
        try:
            desc = conn.execute(f"DESCRIBE {full_name}").fetchall()
            all_columns = [str(row[0]) for row in desc]
        except Exception:  # pylint: disable=broad-except
            all_columns = []
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass

        if selected_columns:
            resolved = [c for c in selected_columns if c in all_columns] or all_columns
        else:
            resolved = all_columns

        col_sql = ", ".join(f'"{c}"' for c in resolved)
        where_clauses: list[str] = []
        if filters:
            for f in filters:
                col = str(f.get("column") or "").strip()
                op = str(f.get("op") or "eq").lower()
                val = f.get("value")
                if not col or col not in all_columns:
                    continue
                if op in ("eq", "equals", "="):
                    where_clauses.append(f'"{col}" = \'{val}\'')
                elif op in ("neq", "!=", "<>"):
                    where_clauses.append(f'"{col}" != \'{val}\'')
                elif op in ("contains", "like"):
                    where_clauses.append(f'"{col}" ILIKE \'%{val}%\'')
                elif op in ("starts_with",):
                    where_clauses.append(f'"{col}" ILIKE \'{val}%\'')
                elif op == "gt":
                    where_clauses.append(f'"{col}" > {val}')
                elif op == "gte":
                    where_clauses.append(f'"{col}" >= {val}')
                elif op == "lt":
                    where_clauses.append(f'"{col}" < {val}')
                elif op == "lte":
                    where_clauses.append(f'"{col}" <= {val}')
                elif op == "in":
                    vals_sql = ", ".join(f"'{v}'" for v in (val if isinstance(val, list) else [val]))
                    where_clauses.append(f'"{col}" IN ({vals_sql})')

        sql = f"SELECT {col_sql} FROM {full_name}"
        if where_clauses:
            sql += " WHERE " + " AND ".join(where_clauses)
        if limit and int(limit) > 0:
            sql += f" LIMIT {int(limit)}"
        return sql, resolved

    def export_serving_table_csv(
        self,
        staged_dataset: Any,
        *,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        limit: int | None = None,
    ) -> tuple[str, str]:
        import csv
        from io import StringIO

        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            return "", full_name

        sql, resolved = self._build_export_query(
            staged_dataset, selected_columns, filters, limit
        )
        conn = self._connect_read_only()
        try:
            rows = [dict(zip(resolved, row)) for row in conn.execute(sql).fetchall()]
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass
        output = StringIO()
        writer = csv.DictWriter(output, fieldnames=resolved)
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue(), full_name

    def export_serving_table_tsv(
        self,
        staged_dataset: Any,
        *,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        limit: int | None = None,
    ) -> tuple[str, str]:
        import csv
        from io import StringIO

        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            return "", full_name

        sql, resolved = self._build_export_query(
            staged_dataset, selected_columns, filters, limit
        )
        conn = self._connect_read_only()
        try:
            rows = [dict(zip(resolved, row)) for row in conn.execute(sql).fetchall()]
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass
        output = StringIO()
        writer = csv.DictWriter(output, fieldnames=resolved, delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue(), full_name

    def export_serving_table_json(
        self,
        staged_dataset: Any,
        *,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        limit: int | None = None,
    ) -> tuple[str, str]:
        import json as _json

        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            return _json.dumps([]), full_name

        sql, resolved = self._build_export_query(
            staged_dataset, selected_columns, filters, limit
        )
        conn = self._connect_read_only()
        try:
            rows = [dict(zip(resolved, row)) for row in conn.execute(sql).fetchall()]
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass
        # Convert non-serializable types (e.g. date, Decimal) to strings
        serialisable = []
        for row in rows:
            serialisable.append(
                {k: (v if isinstance(v, (int, float, bool, str, type(None))) else str(v))
                 for k, v in row.items()}
            )
        return _json.dumps(serialisable, ensure_ascii=False), full_name

    # ------------------------------------------------------------------
    # Migration from superset_db (dhis2_staging schema)
    # ------------------------------------------------------------------

    def import_from_superset_db(
        self,
        staged_dataset: Any,
        *,
        batch_size: int = 5000,
    ) -> dict[str, Any]:
        """Copy rows from a legacy superset_db staging table into DuckDB.

        When the active engine is switched from superset_db to DuckDB, existing
        ``dhis2_staging.ds_*`` tables remain in Superset's metadata DB.  This
        method reads those rows in batches and inserts them into the matching
        DuckDB staging table, then rebuilds the serving table.

        Returns a dict with ``imported``, ``skipped``, and ``error`` keys.
        """
        from sqlalchemy import text as _text
        from superset import db as _db
        from superset.dhis2.staging_engine import DHIS2StagingEngine as _OldEngine

        old_engine = _OldEngine(getattr(staged_dataset, "database_id", 0))
        old_ref = old_engine.get_superset_sql_table_ref(staged_dataset)

        # Check whether the source table exists in the metadata DB
        dialect = str(getattr(_db.engine.dialect, "name", "") or "").lower()
        schema = old_engine.STAGING_SCHEMA if dialect != "sqlite" else None
        table_name = old_engine._get_physical_table_name(staged_dataset)
        from sqlalchemy import inspect as _inspect
        inspector = _inspect(_db.engine)
        if not inspector.has_table(table_name, schema=schema):
            return {"imported": 0, "skipped": 0, "error": f"Source table {old_ref} not found in metadata DB"}

        # Ensure DuckDB staging table exists
        self.create_staging_table(staged_dataset)

        _ROW_COLS = (
            "source_instance_id", "source_instance_name",
            "dx_uid", "dx_name", "dx_type",
            "pe", "ou", "ou_name", "ou_level",
            "value", "value_numeric",
            "co_uid", "co_name", "aoc_uid",
            "synced_at", "sync_job_id",
        )
        select_cols = ", ".join(f'"{c}"' for c in _ROW_COLS)

        total_imported = 0
        total_skipped = 0
        offset = 0

        try:
            with _db.engine.connect() as src_conn:
                while True:
                    rows = src_conn.execute(
                        _text(
                            f"SELECT {select_cols} FROM {old_ref} "
                            f"LIMIT {batch_size} OFFSET {offset}"
                        )
                    ).fetchall()
                    if not rows:
                        break

                    duckdb_conn = self._connect()
                    duck_table = (
                        f"{self.STAGING_SCHEMA}.{_staging_table_name(staged_dataset)}"
                    )
                    seq_name = f"{self.STAGING_SCHEMA}.seq_{_staging_table_name(staged_dataset)}"
                    duckdb_conn.execute(
                        f"CREATE SEQUENCE IF NOT EXISTS {seq_name} START 1 INCREMENT 1"
                    )
                    col_list_sql = (
                        "id, " + ", ".join(f'"{c}"' for c in _ROW_COLS)
                    )
                    placeholders = (
                        f"nextval('{seq_name}'), "
                        + ", ".join("?" for _ in _ROW_COLS)
                    )
                    batch = [tuple(r) for r in rows]
                    duckdb_conn.executemany(
                        f"INSERT INTO {duck_table} ({col_list_sql}) VALUES ({placeholders})",
                        batch,
                    )
                    total_imported += len(rows)
                    offset += batch_size
                    if len(rows) < batch_size:
                        break
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "import_from_superset_db: failed for dataset id=%s",
                getattr(staged_dataset, "id", None),
            )
            return {"imported": total_imported, "skipped": total_skipped, "error": str(exc)}

        self.close()
        logger.info(
            "DuckDB: imported %d rows from superset_db for dataset id=%s",
            total_imported,
            getattr(staged_dataset, "id", None),
        )
        return {"imported": total_imported, "skipped": total_skipped, "error": None}

    # ------------------------------------------------------------------
    # Explorer (admin UI table browser / SQL runner)
    # ------------------------------------------------------------------

    def list_tables(self) -> list[dict[str, Any]]:
        """Return all user tables in the DuckDB staging file."""
        conn = None
        try:
            conn = self._connect_read_only()
        except (EngineNotConfiguredError, EngineUnavailableError) as exc:
            return [{"error": str(exc)}]
        try:
            rows = conn.execute(
                "SELECT table_schema, table_name, table_type "
                "FROM information_schema.tables "
                "WHERE table_schema NOT IN ('information_schema', 'pg_catalog') "
                "ORDER BY table_schema, table_name"
            ).fetchall()
            tables = []
            for schema, name, ttype in rows:
                try:
                    count_row = conn.execute(
                        f'SELECT COUNT(*) FROM "{schema}"."{name}"'
                    ).fetchone()
                    row_count = int(count_row[0]) if count_row else 0
                except Exception:  # pylint: disable=broad-except
                    row_count = None
                tables.append({
                    "schema": schema,
                    "name": name,
                    "type": ttype,
                    "row_count": row_count,
                })
            return tables
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass

    def run_explorer_query(self, sql: str, *, limit: int = 500) -> dict[str, Any]:
        """Execute a read-only SELECT against DuckDB and return columns + rows."""
        conn = None
        try:
            conn = self._connect_read_only()
        except (EngineNotConfiguredError, EngineUnavailableError) as exc:
            raise RuntimeError(str(exc)) from exc

        # Inject a LIMIT if the query doesn't already have one
        sql_stripped = sql.rstrip("; \t\n")
        upper = sql_stripped.upper()
        if " LIMIT " not in upper:
            limited_sql = f"SELECT * FROM ({sql_stripped}) __q LIMIT {int(limit)}"
        else:
            limited_sql = sql_stripped

        try:
            result = conn.execute(limited_sql)
            col_names = [d[0] for d in result.description]
            rows = result.fetchall()
            return {
                "columns": col_names,
                "rows": [dict(zip(col_names, r)) for r in rows],
                "rowcount": len(rows),
            }
        finally:
            try:
                conn.close()
            except Exception:  # pylint: disable=broad-except
                pass

    # ------------------------------------------------------------------
    # Superset database registration
    # ------------------------------------------------------------------

    def get_or_create_superset_database(self) -> Any:
        """Return or create the Superset ``Database`` record for this DuckDB file.

        The Database is registered with ``read_only=True`` connect args so that
        Superset chart queries open DuckDB as a reader.  DuckDB allows multiple
        simultaneous read-only connections even while the staging engine holds the
        one write connection, preventing the "Conflicting lock" IO error.
        """
        import json as _json

        from superset import db as superset_db  # local import
        from superset.models.core import Database  # local import

        db_path = self._db_path
        uri = f"duckdb:///{db_path}"
        # connect_args passed to SQLAlchemy create_engine for chart/SQL-Lab queries
        extra_json = _json.dumps(
            {
                "engine_params": {"connect_args": {"read_only": True}},
                "dhis2_staging_internal": True,
                "is_dataset_source": False,
            }
        )

        existing = (
            superset_db.session.query(Database)
            .filter(Database.sqlalchemy_uri == uri)
            .first()
        )
        if existing:
            # Patch the connect_args on existing records so already-created
            # databases also get read_only=True without requiring a DB reset.
            try:
                current_extra = _json.loads(existing.extra or "{}")
            except Exception:  # pylint: disable=broad-except
                current_extra = {}
            if (
                current_extra.get("engine_params", {}).get("connect_args", {}).get(
                    "read_only"
                )
                is not True
            ):
                current_extra.setdefault("engine_params", {}).setdefault(
                    "connect_args", {}
                )["read_only"] = True
                existing.extra = _json.dumps(current_extra)
                superset_db.session.commit()
                logger.info(
                    "DuckDB: patched Database id=%s to use read_only=True", existing.id
                )
            needs_flag_patch = False
            if current_extra.get("dhis2_staging_internal") is not True:
                current_extra["dhis2_staging_internal"] = True
                needs_flag_patch = True
            if current_extra.get("is_dataset_source") is not False:
                current_extra["is_dataset_source"] = False
                needs_flag_patch = True
            if needs_flag_patch:
                existing.extra = _json.dumps(current_extra)
                superset_db.session.commit()
                logger.info(
                    "DuckDB: patched Database id=%s with dataset-source visibility flags",
                    existing.id,
                )
            return existing

        new_db = Database(
            database_name="DHIS2 Staging (DuckDB)",
            sqlalchemy_uri=uri,
            extra=extra_json,
            # Internal-only: not visible in SQL Lab or the database list.
            # The DHIS2 integration accesses this database directly via the
            # DuckDB Python library; regular users should not interact with it.
            expose_in_sqllab=False,
            allow_run_async=False,
            allow_ctas=False,
            allow_cvas=False,
            allow_dml=False,
        )
        superset_db.session.add(new_db)
        superset_db.session.commit()
        logger.info("DuckDB: created Superset Database record id=%s", new_db.id)
        return new_db
