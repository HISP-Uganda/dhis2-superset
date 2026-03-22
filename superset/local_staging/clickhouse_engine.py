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
ClickHouse local staging engine adapter.

Routes all DHIS2 staged data to an external ClickHouse service instead of
Superset's metadata DB.  ClickHouse's columnar storage and parallel query
execution make it ideal for large-scale analytical workloads.

Configuration (stored in ``local_staging_settings.clickhouse_config`` as JSON)::

    {
        "host": "localhost",
        "port": 9000,
        "http_port": 8123,
        "database": "dhis2_staging",
        "serving_database": "dhis2_serving",
        "user": "default",
        "password": "",
        "secure": false,
        "verify": true,
        "connect_timeout": 10,
        "send_receive_timeout": 300
    }

Serving tables use a safe load-then-swap strategy powered by ClickHouse's
atomic ``EXCHANGE TABLES`` DDL.  The live table is never absent — all reads
target the previous good version until the new one is fully loaded and validated.

Dependencies
------------
Install with::

    pip install clickhouse-connect

``clickhouse-connect`` provides both the native binary protocol client and
the ``clickhousedb://`` SQLAlchemy dialect (HTTP port 8123).
"""

from __future__ import annotations

import csv
import json as _json
import logging
import re
import time
from io import StringIO
from typing import Any, Iterator

from superset.local_staging.admin_tools import (
    build_table_metadata,
    is_safe_identifier,
)
from superset.local_staging.base_engine import LocalStagingEngineBase
from superset.local_staging.exceptions import (
    EngineNotConfiguredError,
    EngineUnavailableError,
)

logger = logging.getLogger(__name__)

_IDENT_MAX = 63
_SERVING_PREFIX = "sv"

# ClickHouse column definitions for the staging table
_CH_STAGING_COLUMNS = [
    ("source_instance_id", "Int32"),
    ("source_instance_name", "LowCardinality(String)"),
    ("dx_uid", "String"),
    ("dx_name", "Nullable(String)"),
    ("dx_type", "LowCardinality(String)"),
    ("pe", "LowCardinality(String)"),
    ("ou", "String"),
    ("ou_name", "Nullable(String)"),
    ("ou_level", "Nullable(UInt16)"),
    ("value", "Nullable(String)"),
    ("value_numeric", "Nullable(Float64)"),
    ("co_uid", "Nullable(String)"),
    ("co_name", "Nullable(String)"),
    ("aoc_uid", "Nullable(String)"),
    ("synced_at", "DateTime DEFAULT now()"),
    ("sync_job_id", "Nullable(Int32)"),
]

# Superset/manifest type → ClickHouse type
_TYPE_MAP: dict[str, str] = {
    "FLOAT": "Float64",
    "DOUBLE": "Float64",
    "NUMERIC": "Float64",
    "DECIMAL": "Float64",
    "NUMBER": "Float64",
    "INT": "Int64",
    "INTEGER": "Int64",
    "BIGINT": "Int64",
    "SMALLINT": "Int32",
    "BOOLEAN": "UInt8",
    "BOOL": "UInt8",
    "DATE": "Date",
    "TIMESTAMP": "DateTime",
    "DATETIME": "DateTime",
}


def _sanitize_name(name: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()
    return sanitized[:40] if sanitized else "dataset"


def _staging_table_name(staged_dataset: Any) -> str:
    sanitized = _sanitize_name(staged_dataset.name)
    return f"ds_{staged_dataset.id}_{sanitized}"[:_IDENT_MAX]


def _serving_table_name(staged_dataset: Any) -> str:
    sanitized = _sanitize_name(staged_dataset.name)
    return f"{_SERVING_PREFIX}_{staged_dataset.id}_{sanitized}"[:_IDENT_MAX]


def _map_type(col_type: str) -> str:
    """Map a Superset/manifest type string to a ClickHouse type."""
    return _TYPE_MAP.get(col_type.upper().strip(), "String")


def _wrap_nullable_type(col_type: str) -> str:
    """Wrap a ClickHouse type in Nullable(...) when needed."""
    normalized = str(col_type or "").strip()
    if normalized.startswith("Nullable("):
        return normalized
    return f"Nullable({normalized})"


def _wrap_low_cardinality_type(col_type: str, *, nullable: bool) -> str:
    normalized = str(col_type or "").strip()
    if normalized == "String":
        return (
            "LowCardinality(Nullable(String))"
            if nullable
            else "LowCardinality(String)"
        )
    return _wrap_nullable_type(normalized) if nullable else normalized


def _quote_identifier(identifier: str) -> str:
    if not is_safe_identifier(identifier):
        raise ValueError(f"Unsafe identifier: {identifier!r}")
    return f"`{identifier}`"


class ClickHouseStagingEngine(LocalStagingEngineBase):
    """ClickHouse-backed staging engine.

    Args:
        database_id: Superset Database PK (for audit; ClickHouse manages its
            own storage independently of the Superset metadata DB).
        config: Engine configuration dict (see module docstring).
    """

    def __init__(self, database_id: int, config: dict[str, Any]) -> None:
        self.database_id = database_id
        self._config = config
        self._client: Any = None

    # ------------------------------------------------------------------
    # Engine identity
    # ------------------------------------------------------------------

    @property
    def engine_name(self) -> str:
        return "clickhouse"

    @property
    def _database(self) -> str:
        """Staging database (where raw ds_* tables live)."""
        return self._config.get("database", "dhis2_staging")

    @property
    def _serving_database(self) -> str:
        """Serving database (where sv_* live tables live).

        Defaults to the staging database so single-database deployments work
        without extra config.  Set ``serving_database`` in the config dict to
        keep staging and serving in separate ClickHouse databases.
        """
        return self._config.get("serving_database") or self._database

    @staticmethod
    def _load_column_extra(column: dict[str, Any]) -> dict[str, Any]:
        raw_extra = column.get("extra")
        if isinstance(raw_extra, dict):
            return raw_extra
        if isinstance(raw_extra, str) and raw_extra.strip():
            try:
                parsed = _json.loads(raw_extra)
            except Exception:  # pylint: disable=broad-except
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    def _table_row_count(self, table_ref: str) -> int:
        result = self._qry(f"SELECT count() FROM {table_ref}")
        return int(result.result_rows[0][0] if result.result_rows else 0)

    @staticmethod
    def _period_year_expression(column_name: str) -> str:
        return (
            "toUInt16OrZero("
            f"substring(replaceRegexpAll(ifNull(`{column_name}`, ''), '[^0-9]', ''), 1, 4)"
            ")"
        )

    def _staging_partition_by_sql(self) -> str:
        return self._period_year_expression("pe")

    def _serving_partition_by_sql(
        self,
        columns: list[dict[str, Any]] | None,
    ) -> str:
        if not columns:
            return "tuple()"

        named_columns = {
            str(column.get("column_name") or "").strip()
            for column in columns
            if str(column.get("column_name") or "").strip()
        }
        for column_name in (
            "period_month",
            "period_quarter",
            "period_half",
            "period_week",
            "period_biweek",
            "period_bimonth",
            "period_year",
            "period",
        ):
            if column_name in named_columns:
                return self._period_year_expression(column_name)
        return "tuple()"

    def _serving_column_type(
        self,
        column: dict[str, Any],
        *,
        nullable: bool,
    ) -> str:
        col_type = _map_type(str(column.get("type") or "TEXT"))
        extra = self._load_column_extra(column)

        if extra.get("dhis2_is_ou_level") is True:
            col_type = "UInt16"

        is_dimension = bool(column.get("is_dimension"))
        if col_type == "String" and is_dimension:
            return _wrap_low_cardinality_type(col_type, nullable=nullable)
        return _wrap_nullable_type(col_type) if nullable else col_type

    def _serving_order_by_sql(
        self,
        columns: list[dict[str, Any]] | None,
    ) -> str:
        if not columns:
            return "tuple()"

        priority_keys = [
            "dhis2_instance",
            "period_year",
            "period_quarter",
            "period_month",
            "period_week",
            "period_biweek",
            "period_bimonth",
            "period",
            "ou_level",
            "co_uid",
            "disaggregation",
        ]
        named_columns = [
            str(column.get("column_name") or "").strip()
            for column in columns
            if str(column.get("column_name") or "").strip()
        ]
        selected: list[str] = []
        for key in priority_keys:
            if key in named_columns and key not in selected:
                selected.append(key)

        hierarchy_columns: list[tuple[int, str]] = []
        for column in columns:
            column_name = str(column.get("column_name") or "").strip()
            if not column_name:
                continue
            extra = self._load_column_extra(column)
            if extra.get("dhis2_is_ou_hierarchy") is not True:
                continue
            try:
                hierarchy_columns.append(
                    (int(extra.get("dhis2_ou_level") or 0), column_name)
                )
            except (TypeError, ValueError):
                continue

        for _level, column_name in sorted(hierarchy_columns):
            if column_name not in selected:
                selected.append(column_name)

        if not selected:
            return "tuple()"
        return f"({', '.join(f'`{column}`' for column in selected)})"

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def _connect(self) -> Any:
        """Return (or create) the clickhouse-connect client.

        The client is reused across calls.  On connection error the cached
        client is cleared so the next call attempts a fresh connection.
        """
        try:
            import clickhouse_connect  # type: ignore[import]
        except ImportError as exc:
            raise EngineUnavailableError(
                "clickhouse-connect package is not installed. "
                "Run: pip install clickhouse-connect"
            ) from exc

        host = self._config.get("host", "")
        if not host:
            raise EngineNotConfiguredError(
                "ClickHouse engine requires 'host' in configuration"
            )
        if self._client is None:
            # clickhouse-connect uses the HTTP port (default 8123), not the
            # native TCP port (9000). Accept both 'http_port' (preferred) and
            # the legacy 'port' key, defaulting to 8123.
            http_port = int(
                self._config.get("http_port")
                or self._config.get("port")
                or 8123
            )
            self._client = clickhouse_connect.get_client(
                host=host,
                port=http_port,
                database=self._database,
                username=self._config.get("user", "default"),
                password=self._config.get("password", ""),
                secure=bool(self._config.get("secure", False)),
                verify=bool(self._config.get("verify", True)),
                connect_timeout=int(self._config.get("connect_timeout", 10)),
                send_receive_timeout=int(
                    self._config.get("send_receive_timeout", 300)
                ),
                settings={
                    "max_query_size": 104857600,  # 100MB (default is 256KB)
                },
            )
        return self._client

    def _reconnect(self) -> Any:
        """Force a fresh connection (use after transient errors)."""
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # pylint: disable=broad-except
                pass
            self._client = None
        return self._connect()

    def _cmd(self, sql: str, **kwargs: Any) -> None:
        """Execute a DDL/mutation command, reconnecting once on failure."""
        try:
            self._connect().command(sql, **kwargs)
        except Exception:  # pylint: disable=broad-except
            self._reconnect().command(sql, **kwargs)

    def _qry(self, sql: str, **kwargs: Any) -> Any:
        """Execute a SELECT query, reconnecting once on failure."""
        try:
            return self._connect().query(sql, **kwargs)
        except Exception:  # pylint: disable=broad-except
            return self._reconnect().query(sql, **kwargs)

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    def health_check(self) -> dict[str, Any]:
        try:
            result = self._qry("SELECT version()")
            version = result.result_rows[0][0] if result.result_rows else "?"
            return {
                "ok": True,
                "message": f"ClickHouse {version} at {self._config.get('host')}",
                "engine": "clickhouse",
                "host": self._config.get("host"),
                "database": self._database,
                "serving_database": self._serving_database,
            }
        except EngineNotConfiguredError as exc:
            return {"ok": False, "message": str(exc), "engine": "clickhouse"}
        except EngineUnavailableError as exc:
            return {"ok": False, "message": str(exc), "engine": "clickhouse"}
        except Exception as exc:  # pylint: disable=broad-except
            return {
                "ok": False,
                "message": f"ClickHouse error: {exc}",
                "engine": "clickhouse",
            }

    # ------------------------------------------------------------------
    # Schema / table lifecycle
    # ------------------------------------------------------------------

    def ensure_schema_exists(self, conn: Any) -> None:
        self._cmd(f"CREATE DATABASE IF NOT EXISTS `{self._database}`")
        if self._serving_database != self._database:
            self._cmd(f"CREATE DATABASE IF NOT EXISTS `{self._serving_database}`")

    def get_staging_table_name(self, staged_dataset: Any) -> str:
        return _staging_table_name(staged_dataset)

    def get_serving_table_name(self, staged_dataset: Any) -> str:
        return _serving_table_name(staged_dataset)

    def get_serving_sql_table_ref(self, staged_dataset: Any) -> str:
        return f"`{self._serving_database}`.`{_serving_table_name(staged_dataset)}`"

    def get_superset_sql_table_ref(self, staged_dataset: Any) -> str:
        table = (
            staged_dataset.staging_table_name
            or _staging_table_name(staged_dataset)
        )
        return f"`{self._database}`.`{table}`"

    def create_staging_table(self, staged_dataset: Any) -> str:
        self.ensure_schema_exists(None)
        table = _staging_table_name(staged_dataset)
        cols_ddl = ",\n    ".join(
            f"`{col}` {dtype}" for col, dtype in _CH_STAGING_COLUMNS
        )
        self._cmd(f"""
            CREATE TABLE IF NOT EXISTS `{self._database}`.`{table}` (
                {cols_ddl}
            ) ENGINE = MergeTree()
            PARTITION BY {self._staging_partition_by_sql()}
            ORDER BY (source_instance_id, pe, dx_uid, ou)
            SETTINGS index_granularity = 8192
        """)
        logger.info("ClickHouse: created staging table %s.%s", self._database, table)
        return table

    def drop_staging_table(self, staged_dataset: Any) -> None:
        table = _staging_table_name(staged_dataset)
        self._cmd(f"DROP TABLE IF EXISTS `{self._database}`.`{table}`")
        logger.info("ClickHouse: dropped staging table %s.%s", self._database, table)

    def truncate_staging_table(self, staged_dataset: Any) -> None:
        table = _staging_table_name(staged_dataset)
        self._cmd(f"TRUNCATE TABLE IF EXISTS `{self._database}`.`{table}`")

    def table_exists(self, staged_dataset: Any) -> bool:
        table = _staging_table_name(staged_dataset)
        result = self._qry(
            "SELECT count() FROM system.tables "
            "WHERE database = {db:String} AND name = {tbl:String}",
            parameters={"db": self._database, "tbl": table},
        )
        return bool(result.result_rows and result.result_rows[0][0] > 0)

    def serving_table_exists(self, staged_dataset: Any) -> bool:
        table = _serving_table_name(staged_dataset)
        result = self._qry(
            "SELECT count() FROM system.tables "
            "WHERE database = {db:String} AND name = {tbl:String}",
            parameters={"db": self._serving_database, "tbl": table},
        )
        return bool(result.result_rows and result.result_rows[0][0] > 0)

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
        table = f"`{self._database}`.`{_staging_table_name(staged_dataset)}`"
        if replace_all:
            self._cmd(
                f"ALTER TABLE {table} DELETE WHERE source_instance_id = {{id:Int32}}",
                parameters={"id": instance_id},
            )
        elif periods:
            periods_list = ", ".join(f"'{p}'" for p in periods)
            self._cmd(
                f"ALTER TABLE {table} DELETE "
                f"WHERE source_instance_id = {{id:Int32}} AND pe IN ({periods_list})",
                parameters={"id": instance_id},
            )

        inserted = self.insert_rows(
            staged_dataset,
            instance_id,
            instance_name,
            rows,
            sync_job_id=sync_job_id,
        )
        # ClickHouse async mutations don't return row counts for deletes
        return {"deleted": -1, "inserted": inserted}

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
        table = f"`{self._database}`.`{_staging_table_name(staged_dataset)}`"
        _ROW_COLS = (
            "dx_uid", "dx_name", "dx_type", "pe", "ou", "ou_name",
            "ou_level", "value", "value_numeric", "co_uid", "co_name", "aoc_uid",
        )
        col_names = [
            "source_instance_id", "source_instance_name", "sync_job_id",
            *_ROW_COLS,
        ]
        data = [
            [
                instance_id,
                instance_name,
                sync_job_id,
                *(row.get(col) for col in _ROW_COLS),
            ]
            for row in rows
        ]
        self._connect().insert(table, data, column_names=col_names)
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
        """Delete-then-insert to simulate upsert on the ClickHouse staging table.

        ClickHouse does not have SQL UPSERT semantics.  We delete any existing
        rows whose natural key ``(source_instance_id, dx_uid, pe, ou)`` matches
        the incoming batch, then bulk-insert the new rows.
        """
        if not rows:
            return 0

        table = f"`{self._database}`.`{_staging_table_name(staged_dataset)}`"
        keys: set[tuple[str, str, str]] = set()
        for row in rows:
            dx = row.get("dx_uid") or ""
            pe = row.get("pe") or ""
            ou = row.get("ou") or ""
            if dx and pe and ou:
                keys.add((dx, pe, ou))

        if keys:
            # Build a big IN-list of concat keys (safe sentinel \x00 separator)
            composite_vals = ", ".join(
                f"'{dx}\x00{pe}\x00{ou}'" for dx, pe, ou in keys
            )
            self._cmd(
                f"ALTER TABLE {table} DELETE "
                f"WHERE source_instance_id = {{id:Int32}} "
                f"AND concat(dx_uid, char(0), pe, char(0), ou) IN ({composite_vals})",
                parameters={"id": instance_id},
            )

        return self.insert_rows(
            staged_dataset, instance_id, instance_name, rows, sync_job_id=sync_job_id
        )

    def get_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
    ) -> list[str]:
        table = f"`{self._database}`.`{_staging_table_name(staged_dataset)}`"
        try:
            result = self._qry(
                f"SELECT DISTINCT pe FROM {table} "
                f"WHERE source_instance_id = {{id:Int32}} ORDER BY pe",
                parameters={"id": instance_id},
            )
            return [r[0] for r in result.result_rows if r[0]]
        except Exception as exc:
            # Code 60 = Unknown table
            if "Code: 60" in str(exc):
                return []
            raise

    def delete_rows_for_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
        periods: list[str],
    ) -> int:
        if not periods:
            return 0
        table = f"`{self._database}`.`{_staging_table_name(staged_dataset)}`"
        periods_list = ", ".join(f"'{p}'" for p in periods)
        self._cmd(
            f"ALTER TABLE {table} DELETE "
            f"WHERE source_instance_id = {{id:Int32}} AND pe IN ({periods_list})",
            parameters={"id": instance_id},
        )
        return -1  # async mutation — count not available

    # ------------------------------------------------------------------
    # Serving table — safe atomic swap via EXCHANGE TABLES
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
        """Materialise the serving table using an atomic load-then-swap pattern.

        Strategy
        --------
        1. Build schema from *columns* / *columns_config* (typed DDL) or fall
           back to a ``SELECT * FROM staging`` copy.
        2. Load all data into a ``<serving>__loading`` table.
        3. Atomically swap the live table and loading table with
           ``EXCHANGE TABLES`` (truly atomic in ClickHouse).
        4. Drop the post-swap loading table (which now holds old data).

        On first run (live table absent) ``RENAME TABLE`` is used instead of
        ``EXCHANGE TABLES`` since ClickHouse requires both tables to exist for
        the exchange.

        UI reads continue against the previous live table throughout the load.
        Only the instant of the exchange is "in-flight" (~microseconds).
        """
        self.ensure_schema_exists(None)
        serving_db = self._serving_database
        serving_name = _serving_table_name(staged_dataset)
        loading_name = f"{serving_name}__build_{int(time.time() * 1000)}"
        serving_ref = f"`{serving_db}`.`{serving_name}`"
        loading_ref = f"`{serving_db}`.`{loading_name}`"
        self._last_serving_build_name = loading_name

        # Drop any abandoned loading table from a previous failed run
        self._cmd(f"DROP TABLE IF EXISTS {loading_ref}")

        effective_cols = columns or columns_config

        try:
            if effective_cols:
                col_ddl_parts: list[str] = []
                col_names: list[str] = []
                nullable_column_names: set[str] = set()
                if rows:
                    for col in effective_cols:
                        col_name = str(col.get("column_name") or "").strip()
                        if col_name and any(row.get(col_name) is None for row in rows):
                            nullable_column_names.add(col_name)
                for col in effective_cols:
                    col_name = str(col.get("column_name") or "").strip()
                    if not col_name:
                        continue
                    col_type = self._serving_column_type(
                        col,
                        nullable=col_name in nullable_column_names,
                    )
                    col_ddl_parts.append(f"`{col_name}` {col_type}")
                    col_names.append(col_name)

                if col_ddl_parts:
                    order_by_sql = self._serving_order_by_sql(effective_cols)
                    partition_by_sql = self._serving_partition_by_sql(effective_cols)
                    self._cmd(
                        f"CREATE TABLE {loading_ref} "
                        f"({', '.join(col_ddl_parts)}) "
                        f"ENGINE = MergeTree() "
                        f"PARTITION BY {partition_by_sql} "
                        f"ORDER BY {order_by_sql} "
                        f"SETTINGS allow_nullable_key = 1, index_granularity = 8192"
                    )
                    if rows:
                        col_list = ", ".join(f"`{c}`" for c in col_names)
                        data = [
                            [row.get(c) for c in col_names]
                            for row in rows
                        ]
                        # Insert in moderately sized batches to reduce part
                        # pressure without creating oversized HTTP payloads.
                        batch_size = 25_000
                        client = self._connect()
                        for i in range(0, len(data), batch_size):
                            client.insert(
                                f"`{serving_db}`.`{loading_name}`",
                                data[i : i + batch_size],
                                column_names=col_names,
                            )
                    loaded_row_count = self._table_row_count(loading_ref)
                    if rows is not None and loaded_row_count != len(rows):
                        raise RuntimeError(
                            "ClickHouse serving build row-count mismatch: "
                            f"expected {len(rows)}, loaded {loaded_row_count}"
                        )
                    logger.info(
                        "ClickHouse: loaded %d rows into %s; promoting to live",
                        loaded_row_count,
                        loading_ref,
                    )
                    self._promote_loading_to_live(
                        serving_db, serving_name, loading_name
                    )
                    return serving_name

            # Fallback: copy from the raw staging table
            staging_db = self._database
            staging_name = _staging_table_name(staged_dataset)
            where = (
                f"WHERE source_instance_id = {int(instance_id)}"
                if instance_id is not None
                else ""
            )
            self._cmd(
                f"CREATE TABLE {loading_ref} "
                f"ENGINE = MergeTree() "
                f"PARTITION BY {self._staging_partition_by_sql()} "
                f"ORDER BY (source_instance_id, pe, dx_uid, ou) "
                f"AS SELECT * FROM `{staging_db}`.`{staging_name}` {where}"
            )
            logger.info(
                "ClickHouse: staged-copy build created %s with %s rows",
                loading_ref,
                self._table_row_count(loading_ref),
            )
            logger.info(
                "ClickHouse: loaded staging copy into %s; promoting to live",
                loading_ref,
            )
            self._promote_loading_to_live(serving_db, serving_name, loading_name)
            return serving_name

        except Exception:
            # Clean up failed loading table; old live table is untouched
            try:
                self._cmd(f"DROP TABLE IF EXISTS {loading_ref}")
            except Exception:  # pylint: disable=broad-except
                pass
            raise

    def _promote_loading_to_live(
        self,
        db: str,
        live_name: str,
        loading_name: str,
    ) -> None:
        """Atomically swap loading → live using EXCHANGE TABLES or RENAME.

        ``EXCHANGE TABLES`` requires both tables to exist.  On first deployment
        the live table doesn't exist yet, so we use RENAME instead.
        """
        live_ref = f"`{db}`.`{live_name}`"
        loading_ref = f"`{db}`.`{loading_name}`"

        live_exists_result = self._qry(
            "SELECT count() FROM system.tables "
            "WHERE database = {db:String} AND name = {tbl:String}",
            parameters={"db": db, "tbl": live_name},
        )
        live_exists = bool(
            live_exists_result.result_rows
            and live_exists_result.result_rows[0][0] > 0
        )

        if live_exists:
            # Atomic swap — old live goes into loading_ref, new data goes live
            self._cmd(f"EXCHANGE TABLES {live_ref} AND {loading_ref}")
            # Drop what is now the old data (in loading_ref)
            self._cmd(f"DROP TABLE IF EXISTS {loading_ref}")
            logger.info(
                "ClickHouse: EXCHANGE TABLES promoted %s → %s", loading_ref, live_ref
            )
        else:
            # First run: simple rename
            self._cmd(
                f"RENAME TABLE {loading_ref} TO `{db}`.`{live_name}`"
            )
            logger.info(
                "ClickHouse: RENAME promoted %s → %s", loading_ref, live_ref
            )

    def get_serving_table_columns(self, staged_dataset: Any) -> list[str]:
        """Return ordered column names of the serving table.

        Returns ``list[str]`` (bare column names) so callers comparing against
        the manifest column-name list work correctly.
        """
        table = _serving_table_name(staged_dataset)
        try:
            result = self._qry(
                "SELECT name FROM system.columns "
                "WHERE database = {db:String} AND table = {tbl:String} "
                "ORDER BY position",
                parameters={"db": self._serving_database, "tbl": table},
            )
            return [r[0] for r in result.result_rows]
        except Exception:  # pylint: disable=broad-except
            return []

    def fetch_staging_rows(
        self,
        staged_dataset: Any,
        instance_id: int | None = None,
        limit: int = 1000,
        offset: int = 0,
        filters: list[dict[str, Any]] | None = None,
        ou_filter: "dict | None" = None,
    ) -> Iterator[dict[str, Any]]:
        table = f"`{self._database}`.`{_staging_table_name(staged_dataset)}`"
        where_parts: list[str] = []
        params: dict[str, Any] = {}
        if instance_id is not None:
            where_parts.append("source_instance_id = {inst_id:Int32}")
            params["inst_id"] = instance_id
        if ou_filter:
            ou_clauses: list[str] = []
            for i, (inst_id, ou_set) in enumerate(ou_filter.items()):
                k = f"ou_inst_{i}"
                if ou_set is None:
                    ou_clauses.append(f"source_instance_id = {{{k}:Int32}}")
                    params[k] = int(inst_id)
                elif ou_set:
                    ou_vals = ", ".join(f"'{v}'" for v in ou_set)
                    ou_clauses.append(
                        f"(source_instance_id = {{{k}:Int32}} AND ou IN ({ou_vals}))"
                    )
                    params[k] = int(inst_id)
            if ou_clauses:
                where_parts.append(f"({' OR '.join(ou_clauses)})")
        where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        if limit and int(limit) > 0:
            sql = f"SELECT * FROM {table} {where} LIMIT {int(limit)} OFFSET {int(offset)}"
        else:
            sql = f"SELECT * FROM {table} {where}"
            if offset and int(offset) > 0:
                sql = f"{sql} LIMIT 18446744073709551615 OFFSET {int(offset)}"
        try:
            result = self._qry(sql, parameters=params if params else None)
            cols = result.column_names
            yield from (dict(zip(cols, r)) for r in result.result_rows)
        except Exception as exc:
            # Code 60 = Unknown table
            if "Code: 60" in str(exc):
                return
            raise

    def get_staging_table_preview(
        self,
        staged_dataset: Any,
        limit: int = 50,
    ) -> dict[str, Any]:
        safe_limit = max(1, min(int(limit or 50), 500))
        staging_ref = self.get_superset_sql_table_ref(staged_dataset)
        serving_ref = self.get_serving_sql_table_ref(staged_dataset)
        if not self.table_exists(staged_dataset):
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
                    "org_unit_columns": [],
                    "period_columns": [],
                },
            }

        preview_sql = (
            f"SELECT * FROM {staging_ref} "
            "ORDER BY source_instance_id, pe, dx_uid, ou "
            f"LIMIT {safe_limit}"
        )
        result = self._qry(preview_sql)
        columns = list(result.column_names)
        rows = [dict(zip(columns, record)) for record in result.result_rows]
        return {
            "columns": columns,
            "rows": rows,
            "limit": safe_limit,
            "staging_table_ref": staging_ref,
            "serving_table_ref": serving_ref,
            "diagnostics": {
                "table_exists": True,
                "row_count": self._table_row_count(staging_ref),
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

    _AGGREGATION_FN_MAP = {
        "sum": "sum",
        "avg": "avg",
        "average": "avg",
        "max": "max",
        "min": "min",
        "count": "count",
    }

    def query_serving_table(
        self,
        staged_dataset: Any,
        *,
        columns: list[str] | None = None,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        aggregation: str | None = None,
        group_by: list[str] | None = None,
        order_by: list[str] | None = None,
        limit: int = 1000,
        offset: int = 0,
        page: int | None = None,
        group_by_columns: list[str] | None = None,
        metric_column: str | None = None,
        metric_alias: str | None = None,
        aggregation_method: str | None = None,
        count_rows: bool = True,
    ) -> dict[str, Any]:
        table = (
            f"`{self._serving_database}`."
            f"`{_serving_table_name(staged_dataset)}`"
        )
        available_columns = self.get_serving_table_columns(staged_dataset)
        available_column_names = set(available_columns)
        effective_limit = int(limit or 1000)
        safe_page = max(1, int(page or 1))
        effective_offset = int(offset or (safe_page - 1) * effective_limit)

        # Build WHERE clause
        where_parts: list[str] = []
        for filt in list(filters or []):
            if not isinstance(filt, dict):
                continue
            col = str(filt.get("column") or "").strip()
            val = filt.get("value")
            if col and col in available_column_names and val is not None:
                if isinstance(val, (list, tuple)):
                    vals_sql = ", ".join(f"'{v}'" for v in val)
                    where_parts.append(f"`{col}` IN ({vals_sql})")
                else:
                    where_parts.append(f"`{col}` = '{val}'")
        where_sql = f" WHERE {' AND '.join(where_parts)}" if where_parts else ""

        # Resolve aggregation
        eff_agg = aggregation_method or aggregation
        eff_group = [
            column_name
            for column_name in list(group_by_columns or group_by or [])
            if column_name in available_column_names
        ]
        eff_metric = (
            metric_column if metric_column in available_column_names else None
        )
        eff_alias = metric_alias

        if eff_agg and eff_group and eff_metric:
            agg_fn = self._AGGREGATION_FN_MAP.get(
                str(eff_agg).strip().lower(), "sum"
            )
            quoted_group = ", ".join(f"`{c}`" for c in eff_group)
            if eff_agg.lower() == "count":
                agg_expr = "count(*)"
            else:
                agg_expr = f"{agg_fn}(ifNull(`{eff_metric}`, 0))"
            alias = eff_alias or f"{agg_fn}_{eff_metric}"
            select_sql = (
                f"SELECT {quoted_group}, {agg_expr} AS `{alias}` "
                f"FROM {table}{where_sql} GROUP BY {quoted_group}"
            )
            resolved_columns = list(eff_group) + [alias]
        else:
            effective_cols = [
                column_name
                for column_name in list(selected_columns or columns or [])
                if column_name in available_column_names
            ]
            if effective_cols:
                col_list = ", ".join(f"`{c}`" for c in effective_cols)
                resolved_columns = list(effective_cols)
            elif available_columns:
                col_list = ", ".join(f"`{c}`" for c in available_columns)
                resolved_columns = list(available_columns)
            else:
                col_list = "*"
                resolved_columns = []
            select_sql = f"SELECT {col_list} FROM {table}{where_sql}"

        paginated_sql = (
            f"{select_sql} LIMIT {effective_limit} OFFSET {effective_offset}"
        )

        try:
            result = self._qry(paginated_sql)
            rows_raw = result.result_rows
            if not resolved_columns:
                resolved_columns = list(result.column_names)
        except Exception:  # pylint: disable=broad-except
            return {
                "columns": [],
                "rows": [],
                "limit": effective_limit,
                "page": safe_page,
                "total_pages": 0,
                "total_rows": 0,
                "serving_table_ref": table,
                "sql_preview": paginated_sql,
            }

        rows = [dict(zip(resolved_columns, r)) for r in rows_raw]

        total_rows_int = len(rows)
        if count_rows:
            try:
                if eff_agg and eff_group and eff_metric:
                    quoted_group = ", ".join(f"`{c}`" for c in eff_group)
                    count_sql = (
                        f"SELECT count() FROM ("
                        f"SELECT {quoted_group} FROM {table}{where_sql} "
                        f"GROUP BY {quoted_group}"
                        f") AS _cnt"
                    )
                else:
                    count_sql = f"SELECT count() FROM {table}{where_sql}"
                cnt = self._qry(count_sql)
                total_rows_int = int(
                    cnt.result_rows[0][0] if cnt.result_rows else 0
                )
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
            "serving_table_ref": table,
            "sql_preview": paginated_sql,
        }

    def get_staging_table_stats(self, staged_dataset: Any) -> dict[str, Any]:
        table = _staging_table_name(staged_dataset)
        try:
            row_result = self._qry(
                "SELECT count(), max(synced_at) FROM {db:Identifier}.{tbl:Identifier}",
                parameters={"db": self._database, "tbl": table},
            )
            row = row_result.result_rows[0] if row_result.result_rows else (0, None)
            count, last_sync = row
            size_result = self._qry(
                "SELECT sum(bytes_on_disk) FROM system.parts "
                "WHERE database = {db:String} AND table = {tbl:String} AND active",
                parameters={"db": self._database, "tbl": table},
            )
            disk_bytes = int(
                size_result.result_rows[0][0]
                if size_result.result_rows and size_result.result_rows[0][0]
                else 0
            )
            return {
                "row_count": int(count or 0),
                "total_rows": int(count or 0),
                "last_synced_at": str(last_sync) if last_sync else None,
                "disk_bytes": disk_bytes,
                "engine": "clickhouse",
                "host": self._config.get("host"),
                "database": self._database,
            }
        except Exception as exc:  # pylint: disable=broad-except
            # Code 60 = Unknown table
            if "Code: 60" in str(exc):
                return {
                    "row_count": 0,
                    "total_rows": 0,
                    "engine": "clickhouse",
                    "host": self._config.get("host"),
                    "database": self._database,
                }
            return {
                "row_count": 0,
                "total_rows": 0,
                "error": str(exc),
                "engine": "clickhouse",
            }

    # ------------------------------------------------------------------
    # Filter options (for cascade filters in the Data Workspace)
    # ------------------------------------------------------------------

    def get_serving_filter_options(
        self,
        staged_dataset: Any,
        *,
        columns: list[dict[str, Any]] | None = None,
        filters: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Return distinct org-unit hierarchy and period values from the serving table."""
        serving_ref = self.get_serving_sql_table_ref(staged_dataset)
        available_col_names = set(self.get_serving_table_columns(staged_dataset))
        if not available_col_names:
            return {"org_unit_filters": [], "period_filter": None}

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

        def _fetch_options(
            col_name: str, scoped_filters: list[dict[str, Any]]
        ) -> list[dict[str, Any]]:
            where_parts = [
                f"length(trim(toString(ifNull(`{col_name}`, '')))) > 0"
            ]
            for filt in scoped_filters:
                fcol = str(filt.get("column") or "").strip()
                fval = filt.get("value")
                if fcol and fcol in available_col_names and fval is not None:
                    if isinstance(fval, (list, tuple)):
                        vals = ", ".join(f"'{v}'" for v in fval)
                        where_parts.append(f"`{fcol}` IN ({vals})")
                    else:
                        where_parts.append(f"`{fcol}` = '{fval}'")
            where_sql = f" WHERE {' AND '.join(where_parts)}"
            sql = (
                f"SELECT `{col_name}` AS option_value, count() AS row_count "
                f"FROM {serving_ref}{where_sql} "
                f"GROUP BY `{col_name}` ORDER BY `{col_name}`"
            )
            try:
                result = self._qry(sql)
                return [
                    {
                        "label": str(r[0] or ""),
                        "value": str(r[0] or ""),
                        "row_count": int(r[1] or 0),
                    }
                    for r in result.result_rows
                    if str(r[0] or "").strip()
                ]
            except Exception:  # pylint: disable=broad-except
                return []

        org_unit_filters = []
        for col in hierarchy_columns:
            cname = str(col["column_name"])
            scoped = [f for f in normalized_filters if str(f.get("column") or "") != cname]
            org_unit_filters.append({**col, "options": _fetch_options(cname, scoped)})

        if period_filter is not None:
            pcol = str(period_filter["column_name"])
            scoped_p = [
                f for f in normalized_filters if str(f.get("column") or "") != pcol
            ]
            period_filter = {**period_filter, "options": _fetch_options(pcol, scoped_p)}

        return {"org_unit_filters": org_unit_filters, "period_filter": period_filter}

    # ------------------------------------------------------------------
    # Period helper
    # ------------------------------------------------------------------

    def get_distinct_periods(
        self,
        staged_dataset: Any,
        *,
        use_serving: bool = True,
    ) -> list[str]:
        if use_serving:
            table_ref = self.get_serving_sql_table_ref(staged_dataset)
            period_col = "period"
        else:
            table_ref = self.get_superset_sql_table_ref(staged_dataset)
            period_col = "pe"
        try:
            result = self._qry(
                f"SELECT DISTINCT `{period_col}` FROM {table_ref} "
                f"WHERE isNotNull(`{period_col}`) ORDER BY `{period_col}`"
            )
            return [str(r[0]) for r in result.result_rows if r[0]]
        except Exception:  # pylint: disable=broad-except
            return []

    # ------------------------------------------------------------------
    # Export helpers
    # ------------------------------------------------------------------

    def _build_export_query(
        self,
        staged_dataset: Any,
        selected_columns: list[str] | None,
        filters: list[dict[str, Any]] | None,
        limit: int | None,
    ) -> tuple[str, list[str]]:
        serving_ref = self.get_serving_sql_table_ref(staged_dataset)
        all_columns = self.get_serving_table_columns(staged_dataset)
        if selected_columns:
            resolved = [c for c in selected_columns if c in all_columns] or all_columns
        else:
            resolved = all_columns

        col_sql = ", ".join(f"`{c}`" for c in resolved)
        where_clauses: list[str] = []
        for f in list(filters or []):
            col = str(f.get("column") or "").strip()
            op = str(f.get("op") or "eq").lower()
            val = f.get("value")
            if not col or col not in all_columns:
                continue
            if op in ("eq", "equals", "="):
                where_clauses.append(f"`{col}` = '{val}'")
            elif op in ("neq", "!=", "<>"):
                where_clauses.append(f"`{col}` != '{val}'")
            elif op in ("contains", "like"):
                where_clauses.append(f"`{col}` ILIKE '%{val}%'")
            elif op == "gt":
                where_clauses.append(f"`{col}` > {val}")
            elif op == "gte":
                where_clauses.append(f"`{col}` >= {val}")
            elif op == "lt":
                where_clauses.append(f"`{col}` < {val}")
            elif op == "lte":
                where_clauses.append(f"`{col}` <= {val}")
            elif op == "in":
                vals_sql = ", ".join(
                    f"'{v}'" for v in (val if isinstance(val, list) else [val])
                )
                where_clauses.append(f"`{col}` IN ({vals_sql})")

        sql = f"SELECT {col_sql} FROM {serving_ref}"
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
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            return "", full_name
        sql, resolved = self._build_export_query(
            staged_dataset, selected_columns, filters, limit
        )
        result = self._qry(sql)
        rows = [dict(zip(resolved, r)) for r in result.result_rows]
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
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            return "", full_name
        sql, resolved = self._build_export_query(
            staged_dataset, selected_columns, filters, limit
        )
        result = self._qry(sql)
        rows = [dict(zip(resolved, r)) for r in result.result_rows]
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
        full_name = self.get_serving_sql_table_ref(staged_dataset)
        if not self.serving_table_exists(staged_dataset):
            return _json.dumps([]), full_name
        sql, resolved = self._build_export_query(
            staged_dataset, selected_columns, filters, limit
        )
        result = self._qry(sql)
        rows = [dict(zip(resolved, r)) for r in result.result_rows]
        serialisable = [
            {
                k: (v if isinstance(v, (int, float, bool, str, type(None))) else str(v))
                for k, v in row.items()
            }
            for row in rows
        ]
        return _json.dumps(serialisable, ensure_ascii=False), full_name

    # ------------------------------------------------------------------
    # Explorer (admin UI table browser / SQL runner)
    # ------------------------------------------------------------------

    def list_tables(self) -> list[dict[str, Any]]:
        """Return all user tables in the staging and serving databases."""
        databases = list({self._database, self._serving_database})
        db_list = ", ".join(f"'{d}'" for d in databases)
        try:
            result = self._qry(
                f"SELECT database, name, engine, total_rows "
                f"FROM system.tables "
                f"WHERE database IN ({db_list}) "
                f"ORDER BY database, name"
            )
            return [
                build_table_metadata(
                    schema=str(r[0] or ""),
                    name=str(r[1] or ""),
                    table_type=str(r[2] or "table"),
                    row_count=int(r[3] or 0),
                )
                for r in result.result_rows
            ]
        except Exception as exc:  # pylint: disable=broad-except
            return [{"error": str(exc)}]

    def run_explorer_query(self, sql: str, *, limit: int = 500) -> dict[str, Any]:
        """Execute a read-only SELECT against ClickHouse and return columns + rows."""
        sql_stripped = sql.rstrip("; \t\n")
        upper = sql_stripped.upper()
        if "LIMIT" not in upper:
            limited_sql = (
                f"SELECT * FROM ({sql_stripped}) AS __q LIMIT {int(limit)}"
            )
        else:
            limited_sql = sql_stripped
        result = self._qry(limited_sql)
        col_names = list(result.column_names)
        return {
            "columns": col_names,
            "rows": [dict(zip(col_names, r)) for r in result.result_rows],
            "rowcount": len(result.result_rows),
        }

    def preview_table(
        self,
        schema: str,
        table_name: str,
        *,
        limit: int = 100,
    ) -> dict[str, Any]:
        table_ref = f"{_quote_identifier(schema)}.{_quote_identifier(table_name)}"
        result = self._qry(f"SELECT * FROM {table_ref} LIMIT {int(limit)}")
        count_result = self._qry(f"SELECT count() FROM {table_ref}")
        col_names = list(result.column_names)
        total_row_count = int(
            count_result.result_rows[0][0] if count_result.result_rows else 0
        )
        return {
            "columns": col_names,
            "rows": [dict(zip(col_names, row)) for row in result.result_rows],
            "rowcount": len(result.result_rows),
            "total_row_count": total_row_count,
            "table": build_table_metadata(
                schema=schema,
                name=table_name,
                table_type="table",
                row_count=total_row_count,
            ),
        }

    def truncate_table(self, schema: str, table_name: str) -> dict[str, Any]:
        table_ref = f"{_quote_identifier(schema)}.{_quote_identifier(table_name)}"
        self._cmd(f"TRUNCATE TABLE IF EXISTS {table_ref}")
        return {"message": f"Cleared rows from {schema}.{table_name}"}

    def drop_table(self, schema: str, table_name: str) -> dict[str, Any]:
        table_ref = f"{_quote_identifier(schema)}.{_quote_identifier(table_name)}"
        self._cmd(f"DROP TABLE IF EXISTS {table_ref}")
        return {"message": f"Dropped table {schema}.{table_name}"}

    def optimize_table(self, schema: str, table_name: str) -> dict[str, Any]:
        table_ref = f"{_quote_identifier(schema)}.{_quote_identifier(table_name)}"
        self._cmd(f"OPTIMIZE TABLE {table_ref} FINAL")
        return {"message": f"Optimized table {schema}.{table_name}"}

    # ------------------------------------------------------------------
    # Superset database registration
    # ------------------------------------------------------------------

    def get_or_create_superset_database(self) -> Any:
        """Return or create the Superset ``Database`` record for this ClickHouse.

        Uses the ``clickhousedb://`` SQLAlchemy dialect provided by
        ``clickhouse-connect`` (HTTP port 8123 by default), which is the
        recommended driver for Superset chart queries.
        """
        import json as _j

        from superset import db as superset_db  # local import
        from superset.models.core import Database  # local import

        host = self._config.get("host", "localhost")
        http_port = int(self._config.get("http_port", 8123))
        user = self._config.get("user", "default")
        password = self._config.get("password", "")
        secure = bool(self._config.get("secure", False))
        db_name_label = self._config.get(
            "superset_db_name", "DHIS2 Serving (ClickHouse)"
        )

        scheme = "clickhousedb+https" if secure else "clickhousedb"
        # Password is not embedded in the URI — stored in extra connect_args
        uri = f"{scheme}://{user}@{host}:{http_port}/{self._serving_database}"

        extra_json = _j.dumps({
            "engine_params": {
                "connect_args": {"password": password}
            },
            # Flag this DB as DHIS2-internal so the dataset wizard can hide it
            # from Step 1 (users should not pick staging/serving DBs directly).
            "dhis2_staging_internal": True,
            "is_dataset_source": False,
        })

        # Look up by URI first; fall back to name in case URI changed
        # (e.g. user/password updated — URI user component differs).
        existing = (
            superset_db.session.query(Database)
            .filter(Database.sqlalchemy_uri == uri)
            .first()
        )
        if existing is None:
            existing = (
                superset_db.session.query(Database)
                .filter(Database.database_name == db_name_label)
                .first()
            )
            if existing is not None:
                # URI changed (credentials update) — patch it in place
                existing.sqlalchemy_uri = uri
                logger.info(
                    "ClickHouse: updated Superset Database URI for %r", db_name_label
                )

        if existing:
            # Patch connect_args / extra if password changed
            try:
                current_extra = _j.loads(existing.extra or "{}")
            except Exception:  # pylint: disable=broad-except
                current_extra = {}
            current_extra.setdefault("engine_params", {}).setdefault(
                "connect_args", {}
            )["password"] = password
            current_extra["dhis2_staging_internal"] = True
            current_extra["is_dataset_source"] = False
            existing.extra = _j.dumps(current_extra)
            superset_db.session.commit()
            return existing

        new_db = Database(
            database_name=db_name_label,
            sqlalchemy_uri=uri,
            extra=extra_json,
            expose_in_sqllab=True,
            allow_run_async=True,
            allow_ctas=False,
            allow_cvas=False,
            allow_dml=False,
        )
        superset_db.session.add(new_db)
        superset_db.session.commit()
        logger.info(
            "ClickHouse: created Superset Database record id=%s", new_db.id
        )
        return new_db
