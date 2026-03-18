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
Superset-DB staging engine adapter.

Wraps the existing :class:`~superset.dhis2.staging_engine.DHIS2StagingEngine`
so it satisfies the :class:`~superset.local_staging.base_engine.LocalStagingEngineBase`
interface.  This adapter is the default (zero-migration) engine; it requires
no additional infrastructure.
"""

from __future__ import annotations

from typing import Any, Iterator

from superset.dhis2.staging_engine import DHIS2StagingEngine
from superset.local_staging.base_engine import LocalStagingEngineBase


class SupersetDBStagingEngine(LocalStagingEngineBase):
    """Delegates all operations to :class:`DHIS2StagingEngine`.

    This is a thin adapter: every method simply forwards to the underlying
    DHIS2StagingEngine instance.  It exists so the factory can return a typed
    :class:`LocalStagingEngineBase` regardless of which engine is active.
    """

    def __init__(self, database_id: int) -> None:
        self._inner = DHIS2StagingEngine(database_id)
        self.database_id = database_id

    # ------------------------------------------------------------------
    # Engine identity
    # ------------------------------------------------------------------

    @property
    def engine_name(self) -> str:
        return "superset_db"

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    def health_check(self) -> dict[str, Any]:
        from superset import db  # local import to avoid circular

        try:
            db.session.execute(db.text("SELECT 1"))
            dialect = str(getattr(db.engine.dialect, "name", "unknown"))
            return {
                "ok": True,
                "message": f"Connected to Superset metadata DB ({dialect})",
                "engine": "superset_db",
                "dialect": dialect,
            }
        except Exception as exc:  # pylint: disable=broad-except
            return {
                "ok": False,
                "message": f"Superset metadata DB unreachable: {exc}",
                "engine": "superset_db",
            }

    # ------------------------------------------------------------------
    # Schema / table lifecycle — delegate to inner engine
    # ------------------------------------------------------------------

    def ensure_schema_exists(self, conn: Any) -> None:
        self._inner.ensure_schema_exists(conn)

    def get_staging_table_name(self, staged_dataset: Any) -> str:
        return self._inner.get_staging_table_name(staged_dataset)

    def get_serving_table_name(self, staged_dataset: Any) -> str:
        return self._inner.get_serving_table_name(staged_dataset)

    def get_serving_sql_table_ref(self, staged_dataset: Any) -> str:
        return self._inner.get_serving_sql_table_ref(staged_dataset)

    def get_superset_sql_table_ref(self, staged_dataset: Any) -> str:
        return self._inner.get_superset_sql_table_ref(staged_dataset)

    def create_staging_table(self, staged_dataset: Any) -> str:
        return self._inner.create_staging_table(staged_dataset)

    def drop_staging_table(self, staged_dataset: Any) -> None:
        self._inner.drop_staging_table(staged_dataset)

    def truncate_staging_table(self, staged_dataset: Any) -> None:
        self._inner.truncate_staging_table(staged_dataset)

    def table_exists(self, staged_dataset: Any) -> bool:
        return self._inner.table_exists(staged_dataset)

    def serving_table_exists(self, staged_dataset: Any) -> bool:
        return self._inner.serving_table_exists(staged_dataset)

    # ------------------------------------------------------------------
    # Data ingestion — delegate
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
        return self._inner.replace_rows_for_instance(
            staged_dataset,
            instance_id,
            instance_name,
            rows,
            periods=periods,
            sync_job_id=sync_job_id,
            replace_all=replace_all,
        )

    def insert_rows(
        self,
        staged_dataset: Any,
        instance_id: int,
        instance_name: str,
        rows: list[dict[str, Any]],
        *,
        sync_job_id: int | None = None,
    ) -> int:
        return self._inner.insert_rows(
            staged_dataset,
            instance_id,
            instance_name,
            rows,
            sync_job_id=sync_job_id,
        )

    def get_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
    ) -> list[str]:
        return self._inner.get_instance_periods(staged_dataset, instance_id)

    def delete_rows_for_instance_periods(
        self,
        staged_dataset: Any,
        instance_id: int,
        periods: list[str],
    ) -> int:
        return self._inner.delete_rows_for_instance_periods(
            staged_dataset, instance_id, periods
        )

    # ------------------------------------------------------------------
    # Serving table — delegate
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
        return self._inner.create_or_replace_serving_table(
            staged_dataset,
            columns_config,
            instance_id=instance_id,
            columns=columns,
            rows=rows,
        )

    def get_serving_table_columns(self, staged_dataset: Any) -> list[dict[str, Any]]:
        return self._inner.get_serving_table_columns(staged_dataset)

    def fetch_staging_rows(
        self,
        staged_dataset: Any,
        instance_id: int | None = None,
        limit: int = 1000,
        offset: int = 0,
        filters: list[dict[str, Any]] | None = None,
        ou_filter: "dict | None" = None,
    ) -> Iterator[dict[str, Any]]:
        return self._inner.fetch_staging_rows(
            staged_dataset,
            instance_id=instance_id,
            limit=limit,
            offset=offset,
            filters=filters,
            ou_filter=ou_filter,
        )

    def query_serving_table(
        self,
        staged_dataset: Any,
        *,
        columns: list[str] | None = None,
        selected_columns: list[str] | None = None,
        filters: list[dict[str, Any]] | None = None,
        aggregation: str | None = None,
        aggregation_method: str | None = None,
        group_by: list[str] | None = None,
        group_by_columns: list[str] | None = None,
        order_by: list[str] | None = None,
        limit: int = 1000,
        offset: int = 0,
        page: int | None = None,
        metric_column: str | None = None,
        metric_alias: str | None = None,
        count_rows: bool = True,
    ) -> dict[str, Any]:
        return self._inner.query_serving_table(
            staged_dataset,
            selected_columns=selected_columns or columns,
            filters=filters,
            aggregation_method=aggregation_method or aggregation,
            group_by_columns=group_by_columns or group_by,
            limit=limit,
            page=page,
            metric_column=metric_column,
            metric_alias=metric_alias,
            count_rows=count_rows,
        )

    def get_staging_table_stats(self, staged_dataset: Any) -> dict[str, Any]:
        return self._inner.get_staging_table_stats(staged_dataset)

    # ------------------------------------------------------------------
    # Superset database registration
    # ------------------------------------------------------------------

    def get_or_create_superset_database(self) -> Any:
        """The superset_db engine uses the Superset metadata DB directly.

        Returns the first ``Database`` object whose ``sqlalchemy_uri`` matches
        the metadata DB, or None (callers using this engine don't need a
        separate Database object).
        """
        from superset import db  # local import
        from superset.models.core import Database  # local import

        metadata_uri = str(db.engine.url)
        existing = (
            db.session.query(Database)
            .filter(Database.sqlalchemy_uri == metadata_uri)
            .first()
        )
        return existing

    # ------------------------------------------------------------------
    # Pass-through attribute access so code that calls inner methods
    # not declared in the ABC (e.g. truncate_for_instance, upsert_rows…)
    # still works transparently.
    # ------------------------------------------------------------------

    def __getattr__(self, name: str) -> Any:
        # Only called when the attribute is not found on this class.
        return getattr(self._inner, name)
