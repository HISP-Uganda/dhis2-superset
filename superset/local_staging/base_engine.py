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
Abstract base class for local staging engine adapters.

All engine implementations must subclass :class:`LocalStagingEngineBase` and
implement every abstract method.  Concrete adapters are:

* :class:`~superset.local_staging.superset_db_engine.SupersetDBStagingEngine`
* :class:`~superset.local_staging.duckdb_engine.DuckDBStagingEngine`
* :class:`~superset.local_staging.clickhouse_engine.ClickHouseStagingEngine`
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Iterator


class LocalStagingEngineBase(ABC):
    """Contract that every storage-engine adapter must satisfy."""

    # ------------------------------------------------------------------
    # Engine identity
    # ------------------------------------------------------------------

    @property
    @abstractmethod
    def engine_name(self) -> str:
        """Short human-readable name, e.g. ``'superset_db'``."""

    # ------------------------------------------------------------------
    # Health / connectivity
    # ------------------------------------------------------------------

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        """Return a dict with at least ``{"ok": bool, "message": str}``.

        Called by the admin UI to show current engine status.
        """

    # ------------------------------------------------------------------
    # Schema / table lifecycle
    # ------------------------------------------------------------------

    @abstractmethod
    def ensure_schema_exists(self, conn: Any) -> None:
        """Create the staging schema if it does not yet exist."""

    @abstractmethod
    def get_staging_table_name(self, staged_dataset: Any) -> str:
        """Return the bare (unqualified) staging table name for *staged_dataset*."""

    @abstractmethod
    def get_serving_table_name(self, staged_dataset: Any) -> str:
        """Return the bare (unqualified) serving table name for *staged_dataset*."""

    @abstractmethod
    def get_serving_sql_table_ref(self, staged_dataset: Any) -> str:
        """Return a SQL-ready fully-qualified table reference for queries."""

    @abstractmethod
    def get_superset_sql_table_ref(self, staged_dataset: Any) -> str:
        """Return the Superset virtual-dataset SQL reference (may include schema)."""

    @abstractmethod
    def create_staging_table(self, staged_dataset: Any) -> str:
        """Create (or validate) the physical staging table; return its name."""

    @abstractmethod
    def drop_staging_table(self, staged_dataset: Any) -> None:
        """Drop the staging table and all associated artefacts."""

    @abstractmethod
    def drop_serving_table(self, staged_dataset: Any) -> None:
        """Drop the serving table and all associated artefacts."""

    @abstractmethod
    def truncate_staging_table(self, staged_dataset: Any) -> None:
        """Remove all rows from the staging table."""

    @abstractmethod
    def table_exists(self, staged_dataset: Any) -> bool:
        """Return True if the staging table exists."""

    @abstractmethod
    def serving_table_exists(self, staged_dataset: Any) -> bool:
        """Return True if the serving table exists."""

    # ------------------------------------------------------------------
    # Data ingestion
    # ------------------------------------------------------------------

    @abstractmethod
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
        """Bulk-replace rows for *instance_id* / optional *periods*.

        Returns ``{"deleted": int, "inserted": int}``.
        """

    @abstractmethod
    def insert_rows(
        self,
        staged_dataset: Any,
        instance_id: int,
        instance_name: str,
        rows: list[dict[str, Any]],
        *,
        sync_job_id: int | None = None,
    ) -> int:
        """Append *rows* without deduplication; returns inserted count."""

    @abstractmethod
    def get_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
    ) -> list[str]:
        """Return all distinct period values for *instance_id*."""

    @abstractmethod
    def delete_rows_for_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
        periods: list[str],
    ) -> int:
        """Delete rows matching instance + periods; return deleted count."""

    # ------------------------------------------------------------------
    # Serving table
    # ------------------------------------------------------------------

    @abstractmethod
    def create_or_replace_serving_table(
        self,
        staged_dataset: Any,
        columns_config: list[dict[str, Any]] | None = None,
        *,
        instance_id: int | None = None,
        columns: list[dict[str, Any]] | None = None,
        rows: list[dict[str, Any]] | None = None,
    ) -> str:
        """Materialise the serving table from staging data; return table name."""

    @abstractmethod
    def get_serving_table_columns(
        self,
        staged_dataset: Any,
    ) -> list[dict[str, Any]]:
        """Return column metadata for the serving table."""

    @abstractmethod
    def fetch_staging_rows(
        self,
        staged_dataset: Any,
        instance_id: int | None = None,
        limit: int = 1000,
        offset: int = 0,
        filters: list[dict[str, Any]] | None = None,
        ou_filter: "dict | None" = None,
    ) -> Iterator[dict[str, Any]]:
        """Yield rows from the staging table (used for preview / export)."""

    @abstractmethod
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
        table_name_override: str | None = None,
    ) -> dict[str, Any]:
        """Execute a structured query against the serving table."""

    @abstractmethod
    def get_staging_table_stats(self, staged_dataset: Any) -> dict[str, Any]:
        """Return row count, size, last-sync info, etc."""

    @abstractmethod
    def get_staging_table_preview(
        self,
        staged_dataset: Any,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Return a bounded preview sampled directly from the staging table."""

    # ------------------------------------------------------------------
    # Superset Database registration
    # ------------------------------------------------------------------

    @abstractmethod
    def get_or_create_superset_database(self) -> Any:
        """Return (or create) the Superset ``Database`` object for this engine."""

    # ------------------------------------------------------------------
    # Explorer (admin UI table browser / SQL runner)
    # ------------------------------------------------------------------

    def get_distinct_periods(
        self,
        staged_dataset: Any,
        *,
        use_serving: bool = True,
    ) -> list[str]:
        """Return sorted distinct period values from the serving or staging table.

        The default implementation queries via Superset's ``db.engine`` (suitable
        for the superset_db engine).  DuckDB and ClickHouse engines override this
        to use their own connections.
        """
        from sqlalchemy import text as _text
        from superset import db as _db
        from superset.dhis2.staging_engine import DHIS2StagingEngine  # local import

        if use_serving:
            full_name = self.get_serving_sql_table_ref(staged_dataset)
            period_col = "period"
        else:
            full_name = self.get_superset_sql_table_ref(staged_dataset)
            period_col = "pe"

        sql = (
            f'SELECT DISTINCT "{period_col}" AS p FROM {full_name} '
            f'WHERE "{period_col}" IS NOT NULL '
            f'ORDER BY "{period_col}"'
        )
        try:
            with _db.engine.connect() as conn:
                DHIS2StagingEngine.apply_connection_optimizations(
                    conn, str(getattr(_db.engine.dialect, "name", "") or "")
                )
                rows = conn.execute(_text(sql)).fetchall()
                return [str(r[0]) for r in rows if r[0]]
        except Exception:  # pylint: disable=broad-except
            return []

    def list_tables(self) -> list[dict[str, Any]]:
        """Return a list of tables available in the staging engine.

        Default implementation returns an empty list; engines that support
        the Explorer UI override this.
        """
        return []

    def run_explorer_query(self, sql: str, *, limit: int = 500) -> dict[str, Any]:
        """Execute a read-only SELECT and return columns + rows.

        Raises ``NotImplementedError`` for engines that do not implement the
        Explorer.  The API layer catches this and returns a 400.
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support the Explorer query runner"
        )

    def preview_table(
        self,
        schema: str,
        table_name: str,
        *,
        limit: int = 100,
    ) -> dict[str, Any]:
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support previewing explorer tables"
        )

    def truncate_table(self, schema: str, table_name: str) -> dict[str, Any]:
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support truncating explorer tables"
        )

    def drop_table(self, schema: str, table_name: str) -> dict[str, Any]:
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support dropping explorer tables"
        )

    def optimize_table(self, schema: str, table_name: str) -> dict[str, Any]:
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support optimizing explorer tables"
        )
