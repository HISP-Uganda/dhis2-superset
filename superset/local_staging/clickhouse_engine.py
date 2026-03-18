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
        "database": "dhis2_staging",
        "user": "default",
        "password": "",
        "secure": false,
        "verify": true,
        "connect_timeout": 10,
        "send_receive_timeout": 300
    }

Tables use the ``MergeTree`` engine with ``ORDER BY (source_instance_id, dx_uid, pe, ou)``
so common filter/aggregation patterns are co-located on disk.

Dependencies
------------
Install with::

    pip install clickhouse-connect

``clickhouse-connect`` provides the native binary protocol client.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Iterator

from superset.local_staging.base_engine import LocalStagingEngineBase
from superset.local_staging.exceptions import (
    EngineNotConfiguredError,
    EngineUnavailableError,
)

logger = logging.getLogger(__name__)

_PG_IDENT_MAX = 63
_SERVING_PREFIX = "sv"

# ClickHouse column definitions for the staging table
_CH_STAGING_COLUMNS = [
    ("source_instance_id", "Int32"),
    ("source_instance_name", "String"),
    ("dx_uid", "String"),
    ("dx_name", "Nullable(String)"),
    ("dx_type", "String"),
    ("pe", "String"),
    ("ou", "String"),
    ("ou_name", "Nullable(String)"),
    ("ou_level", "Nullable(Int32)"),
    ("value", "Nullable(String)"),
    ("value_numeric", "Nullable(Float64)"),
    ("co_uid", "Nullable(String)"),
    ("co_name", "Nullable(String)"),
    ("aoc_uid", "Nullable(String)"),
    ("synced_at", "DateTime DEFAULT now()"),
    ("sync_job_id", "Nullable(Int32)"),
]


def _sanitize_name(name: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()
    return sanitized[:40] if sanitized else "dataset"


def _staging_table_name(staged_dataset: Any) -> str:
    sanitized = _sanitize_name(staged_dataset.name)
    return f"ds_{staged_dataset.id}_{sanitized}"[:_PG_IDENT_MAX]


def _serving_table_name(staged_dataset: Any) -> str:
    sanitized = _sanitize_name(staged_dataset.name)
    return f"{_SERVING_PREFIX}_{staged_dataset.id}_{sanitized}"[:_PG_IDENT_MAX]


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
        return self._config.get("database", "dhis2_staging")

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def _connect(self) -> Any:
        """Return (or create) the clickhouse-connect client."""
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
            self._client = clickhouse_connect.get_client(
                host=host,
                port=int(self._config.get("port", 9000)),
                database=self._database,
                username=self._config.get("user", "default"),
                password=self._config.get("password", ""),
                secure=bool(self._config.get("secure", False)),
                verify=bool(self._config.get("verify", True)),
                connect_timeout=int(self._config.get("connect_timeout", 10)),
                send_receive_timeout=int(
                    self._config.get("send_receive_timeout", 300)
                ),
            )
        return self._client

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    def health_check(self) -> dict[str, Any]:
        try:
            client = self._connect()
            result = client.query("SELECT version()")
            version = result.result_rows[0][0] if result.result_rows else "?"
            return {
                "ok": True,
                "message": f"ClickHouse {version} at {self._config.get('host')}",
                "engine": "clickhouse",
                "host": self._config.get("host"),
                "database": self._database,
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
        client = self._connect()
        client.command(
            f"CREATE DATABASE IF NOT EXISTS {self._database}"
        )

    def get_staging_table_name(self, staged_dataset: Any) -> str:
        return _staging_table_name(staged_dataset)

    def get_serving_table_name(self, staged_dataset: Any) -> str:
        return _serving_table_name(staged_dataset)

    def get_serving_sql_table_ref(self, staged_dataset: Any) -> str:
        return f"{self._database}.{_serving_table_name(staged_dataset)}"

    def get_superset_sql_table_ref(self, staged_dataset: Any) -> str:
        table = (
            staged_dataset.staging_table_name
            or _staging_table_name(staged_dataset)
        )
        return f"{self._database}.{table}"

    def create_staging_table(self, staged_dataset: Any) -> str:
        client = self._connect()
        table = _staging_table_name(staged_dataset)
        cols_ddl = ",\n    ".join(
            f"`{col}` {dtype}" for col, dtype in _CH_STAGING_COLUMNS
        )
        client.command(f"""
            CREATE TABLE IF NOT EXISTS {self._database}.{table} (
                {cols_ddl}
            ) ENGINE = MergeTree()
            ORDER BY (source_instance_id, dx_uid, pe, ou)
            SETTINGS index_granularity = 8192
        """)
        logger.info("ClickHouse: created staging table %s.%s", self._database, table)
        return table

    def drop_staging_table(self, staged_dataset: Any) -> None:
        client = self._connect()
        table = _staging_table_name(staged_dataset)
        client.command(f"DROP TABLE IF EXISTS {self._database}.{table}")
        logger.info("ClickHouse: dropped staging table %s.%s", self._database, table)

    def truncate_staging_table(self, staged_dataset: Any) -> None:
        client = self._connect()
        table = _staging_table_name(staged_dataset)
        client.command(f"TRUNCATE TABLE {self._database}.{table}")

    def table_exists(self, staged_dataset: Any) -> bool:
        client = self._connect()
        table = _staging_table_name(staged_dataset)
        result = client.query(
            "SELECT count() FROM system.tables WHERE database = {db:String} AND name = {tbl:String}",
            parameters={"db": self._database, "tbl": table},
        )
        count = result.result_rows[0][0] if result.result_rows else 0
        return count > 0

    def serving_table_exists(self, staged_dataset: Any) -> bool:
        client = self._connect()
        table = _serving_table_name(staged_dataset)
        result = client.query(
            "SELECT count() FROM system.tables WHERE database = {db:String} AND name = {tbl:String}",
            parameters={"db": self._database, "tbl": table},
        )
        count = result.result_rows[0][0] if result.result_rows else 0
        return count > 0

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
        client = self._connect()
        table = f"{self._database}.{_staging_table_name(staged_dataset)}"
        deleted = 0
        if replace_all:
            client.command(
                f"ALTER TABLE {table} DELETE WHERE source_instance_id = {{id:Int32}}",
                parameters={"id": instance_id},
            )
            deleted = -1  # ClickHouse doesn't return row count for mutations
        elif periods:
            periods_list = ", ".join(f"'{p}'" for p in periods)
            client.command(
                f"ALTER TABLE {table} DELETE "
                f"WHERE source_instance_id = {{id:Int32}} AND pe IN ({periods_list})",
                parameters={"id": instance_id},
            )
            deleted = -1

        inserted = self.insert_rows(
            staged_dataset,
            instance_id,
            instance_name,
            rows,
            sync_job_id=sync_job_id,
        )
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
        client = self._connect()
        table = f"{self._database}.{_staging_table_name(staged_dataset)}"
        _ROW_COLS = (
            "dx_uid", "dx_name", "dx_type", "pe", "ou", "ou_name",
            "ou_level", "value", "value_numeric", "co_uid", "co_name", "aoc_uid",
        )
        col_names = [
            "source_instance_id", "source_instance_name", "sync_job_id",
            *_ROW_COLS,
        ]
        from datetime import datetime, timezone
        data = []
        for row in rows:
            data.append([
                instance_id,
                instance_name,
                sync_job_id,
                *(row.get(col) for col in _ROW_COLS),
            ])
        client.insert(table, data, column_names=col_names)
        return len(rows)

    def get_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
    ) -> list[str]:
        client = self._connect()
        table = f"{self._database}.{_staging_table_name(staged_dataset)}"
        result = client.query(
            f"SELECT DISTINCT pe FROM {table} "
            f"WHERE source_instance_id = {{id:Int32}} ORDER BY pe",
            parameters={"id": instance_id},
        )
        return [r[0] for r in result.result_rows if r[0]]

    def delete_rows_for_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
        periods: list[str],
    ) -> int:
        if not periods:
            return 0
        client = self._connect()
        table = f"{self._database}.{_staging_table_name(staged_dataset)}"
        periods_list = ", ".join(f"'{p}'" for p in periods)
        client.command(
            f"ALTER TABLE {table} DELETE "
            f"WHERE source_instance_id = {{id:Int32}} AND pe IN ({periods_list})",
            parameters={"id": instance_id},
        )
        return -1  # ClickHouse async mutations don't return counts

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
        client = self._connect()
        staging = f"{self._database}.{_staging_table_name(staged_dataset)}"
        serving = f"{self._database}.{_serving_table_name(staged_dataset)}"
        client.command(f"DROP TABLE IF EXISTS {serving}")
        where = (
            f"WHERE source_instance_id = {int(instance_id)}"
            if instance_id is not None
            else ""
        )
        client.command(
            f"CREATE TABLE {serving} ENGINE = MergeTree() "
            f"ORDER BY (source_instance_id, dx_uid, pe, ou) "
            f"AS SELECT * FROM {staging} {where}"
        )
        logger.info("ClickHouse: created serving table %s", serving)
        return _serving_table_name(staged_dataset)

    def get_serving_table_columns(self, staged_dataset: Any) -> list[dict[str, Any]]:
        client = self._connect()
        table = _serving_table_name(staged_dataset)
        result = client.query(
            "SELECT name, type FROM system.columns "
            "WHERE database = {db:String} AND table = {tbl:String} ORDER BY position",
            parameters={"db": self._database, "tbl": table},
        )
        return [
            {"column_name": r[0], "type": r[1]} for r in result.result_rows
        ]

    def fetch_staging_rows(
        self,
        staged_dataset: Any,
        instance_id: int | None = None,
        limit: int = 1000,
        offset: int = 0,
        filters: list[dict[str, Any]] | None = None,
        ou_filter: "dict | None" = None,
    ) -> Iterator[dict[str, Any]]:
        client = self._connect()
        table = f"{self._database}.{_staging_table_name(staged_dataset)}"
        where = ""
        if instance_id is not None:
            where = f"WHERE source_instance_id = {int(instance_id)}"
        result = client.query(
            f"SELECT * FROM {table} {where} LIMIT {limit} OFFSET {offset}"
        )
        cols = result.column_names
        for row in result.result_rows:
            yield dict(zip(cols, row))

    def query_serving_table(
        self,
        staged_dataset: Any,
        *,
        columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        aggregation: str | None = None,
        group_by: list[str] | None = None,
        order_by: list[str] | None = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> dict[str, Any]:
        client = self._connect()
        table = f"{self._database}.{_serving_table_name(staged_dataset)}"
        col_list = ", ".join(columns) if columns else "*"
        result = client.query(
            f"SELECT {col_list} FROM {table} LIMIT {limit} OFFSET {offset}"
        )
        cols = result.column_names
        return {
            "columns": list(cols),
            "rows": [dict(zip(cols, r)) for r in result.result_rows],
            "rowcount": len(result.result_rows),
        }

    def get_staging_table_stats(self, staged_dataset: Any) -> dict[str, Any]:
        client = self._connect()
        table = _staging_table_name(staged_dataset)
        try:
            result = client.query(
                "SELECT count(), max(synced_at) FROM {db:Identifier}.{tbl:Identifier}",
                parameters={"db": self._database, "tbl": table},
            )
            row = result.result_rows[0] if result.result_rows else (0, None)
            count, last_sync = row
            size_result = client.query(
                "SELECT sum(bytes_on_disk) FROM system.parts "
                "WHERE database = {db:String} AND table = {tbl:String} AND active",
                parameters={"db": self._database, "tbl": table},
            )
            size = (
                size_result.result_rows[0][0] if size_result.result_rows else 0
            )
            return {
                "row_count": int(count or 0),
                "last_synced_at": str(last_sync) if last_sync else None,
                "disk_bytes": int(size or 0),
                "engine": "clickhouse",
                "host": self._config.get("host"),
                "database": self._database,
            }
        except Exception as exc:  # pylint: disable=broad-except
            return {"row_count": 0, "error": str(exc), "engine": "clickhouse"}

    # ------------------------------------------------------------------
    # Superset database registration
    # ------------------------------------------------------------------

    def get_or_create_superset_database(self) -> Any:
        """Return or create the Superset ``Database`` record for this ClickHouse."""
        from superset import db as superset_db  # local import
        from superset.models.core import Database  # local import

        host = self._config.get("host", "localhost")
        port = self._config.get("port", 9000)
        database = self._database
        user = self._config.get("user", "default")
        password = self._config.get("password", "")
        secure = self._config.get("secure", False)
        scheme = "clickhouse+native" if not secure else "clickhouse+native"
        uri = f"{scheme}://{user}:{password}@{host}:{port}/{database}"

        existing = (
            superset_db.session.query(Database)
            .filter(Database.sqlalchemy_uri == uri)
            .first()
        )
        if existing:
            return existing

        new_db = Database(
            database_name="DHIS2 Staging (ClickHouse)",
            sqlalchemy_uri=uri,
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
