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

from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy.orm import lazyload, load_only

from superset.commands.base import BaseCommand
from superset.commands.database.exceptions import (
    DatabaseNotFoundError,
    DatabaseTablesUnexpectedError,
)
from superset.connectors.sqla.models import (
    SqlaTable,
    _resolve_dhis2_staged_local_table_ref,
)
from superset.daos.database import DatabaseDAO
from superset.exceptions import SupersetException
from superset.extensions import db, security_manager
from superset.models.core import Database
from superset.utils.core import DatasourceName

logger = logging.getLogger(__name__)


def _normalize_schema_name(schema_name: str | None) -> str | None:
    normalized = str(schema_name or "").strip()
    return normalized or None


def _resolve_dataset_table_ref(dataset: SqlaTable) -> tuple[str | None, str]:
    schema_name = _normalize_schema_name(dataset.schema)
    table_name = str(dataset.table_name or "").strip()

    extra = dataset.extra_dict
    if extra.get("dhis2_staged_local") or extra.get("dhis2StagedLocal"):
        if table_ref := _resolve_dhis2_staged_local_table_ref(extra, dataset.sql):
            schema_name, table_name = table_ref

    return schema_name, table_name


import re

_INTERNAL_STAGING_RE = re.compile(
    r"^(sv_\d+_|ds_\d+_)",
    re.IGNORECASE,
)


def _is_internal_staging_table(table_name: str) -> bool:
    """Return True for internal staging/serving physical tables.

    These follow the naming convention ``sv_{id}_{name}`` (serving) or
    ``ds_{id}_{name}`` (staging) and should not be exposed to end users
    in SQL Lab — users should query the friendly ``[MART]`` datasets
    instead.
    """
    return bool(_INTERNAL_STAGING_RE.match(table_name))


class TablesDatabaseCommand(BaseCommand):
    _model: Database

    def __init__(
        self,
        db_id: int,
        catalog_name: str | None,
        schema_name: str,
        force: bool,
    ):
        self._db_id = db_id
        self._catalog_name = catalog_name
        self._schema_name = schema_name
        self._force = force

    def run(self) -> dict[str, Any]:
        self.validate()
        self._catalog_name = self._catalog_name or self._model.get_default_catalog()
        requested_schema = _normalize_schema_name(self._schema_name)
        is_staging_db = getattr(self._model, "is_dhis2_staging_internal", False)
        try:
            tables = security_manager.get_datasources_accessible_by_user(
                database=self._model,
                catalog=self._catalog_name,
                schema=self._schema_name,
                datasource_names=sorted(
                    # get_all_table_names_in_schema may return raw (unserialized) cached
                    # results, so we wrap them as DatasourceName objects here instead of
                    # directly in the method to ensure consistency.
                    DatasourceName(*datasource_name)
                    for datasource_name in self._model.get_all_table_names_in_schema(
                        catalog=self._catalog_name,
                        schema=self._schema_name,
                        force=self._force,
                        cache=self._model.table_cache_enabled,
                        cache_timeout=self._model.table_cache_timeout,
                    )
                ),
            )

            views = security_manager.get_datasources_accessible_by_user(
                database=self._model,
                catalog=self._catalog_name,
                schema=self._schema_name,
                datasource_names=sorted(
                    # get_all_view_names_in_schema may return raw (unserialized) cached
                    # results, so we wrap them as DatasourceName objects here instead of
                    # directly in the method to ensure consistency.
                    DatasourceName(*datasource_name)
                    for datasource_name in self._model.get_all_view_names_in_schema(
                        catalog=self._catalog_name,
                        schema=self._schema_name,
                        force=self._force,
                        cache=self._model.table_cache_enabled,
                        cache_timeout=self._model.table_cache_timeout,
                    )
                ),
            )

            # Get materialized views if the database supports them
            materialized_views = security_manager.get_datasources_accessible_by_user(
                database=self._model,
                catalog=self._catalog_name,
                schema=self._schema_name,
                datasource_names=sorted(
                    DatasourceName(table.table, table.schema, table.catalog)
                    for table in (
                        self._model.get_all_materialized_view_names_in_schema(
                            catalog=self._catalog_name,
                            schema=self._schema_name,
                            force=self._force,
                            cache=self._model.table_cache_enabled,
                            cache_timeout=self._model.table_cache_timeout,
                        )
                    )
                ),
            )

            # Include all SqlaTable datasets associated with this database.
            # This allows virtual datasets (SQL-based) like DHIS2 MARTs to appear
            # in the SQL Lab side bar so users can query them as primary objects.
            datasets_query = (
                db.session.query(SqlaTable)
                .filter(SqlaTable.database_id == self._model.id)
                .options(
                    load_only(
                        SqlaTable.catalog,
                        SqlaTable.schema,
                        SqlaTable.table_name,
                        SqlaTable.extra,
                        SqlaTable.sql,
                        SqlaTable.dataset_role,
                    ),
                    lazyload(SqlaTable.columns),
                    lazyload(SqlaTable.metrics),
                )
            )

            # Filter by catalog and schema if provided
            if self._catalog_name:
                datasets_query = datasets_query.filter(SqlaTable.catalog == self._catalog_name)

            datasets = datasets_query.all()

            # Map virtual datasets to options.  On staging-internal
            # databases only expose MART-role datasets (not raw SOURCE
            # registrations) so users see the curated analytical tables.
            dataset_options = []
            for ds in datasets:
                if not ds.sql:
                    continue
                resolved_schema, resolved_table = _resolve_dataset_table_ref(ds)
                if requested_schema is not None and resolved_schema != requested_schema:
                    continue
                ds_role = str(getattr(ds, "dataset_role", "") or "").upper()
                if is_staging_db and ds_role == "SOURCE":
                    continue
                dataset_options.append(
                    {
                        "id": ds.id,
                        "label": ds.table_name,
                        "value": resolved_table,
                        "type": "dataset",
                        "extra": ds.extra_dict,
                        "sql": ds.sql,
                    }
                )

            # Collect the physical table names that are backing MART
            # datasets so they can be hidden from the sidebar when the
            # database is the staging-internal database.  Users should
            # interact with the friendly "[MART]" dataset names instead.
            dataset_backing_tables: set[str] = set()
            if is_staging_db:
                for opt in dataset_options:
                    dataset_backing_tables.add(opt["value"])

            options_by_value: dict[str, dict[str, Any]] = {}

            for table in tables:
                # On staging databases, hide raw physical tables that have
                # a registered MART dataset, as well as internal staging
                # tables (sv_*, ds_*) that users should never query directly.
                if is_staging_db and _is_internal_staging_table(table.table):
                    continue
                if table.table in dataset_backing_tables:
                    continue
                options_by_value.setdefault(
                    table.table,
                    {
                        "value": table.table,
                        "type": "table",
                    },
                )
            for view in views:
                if is_staging_db and _is_internal_staging_table(view.table):
                    continue
                options_by_value.setdefault(
                    view.table,
                    {
                        "value": view.table,
                        "type": "view",
                    },
                )
            for mv in materialized_views:
                if is_staging_db and _is_internal_staging_table(mv.table):
                    continue
                options_by_value.setdefault(
                    mv.table,
                    {
                        "value": mv.table,
                        "type": "materialized_view",
                    },
                )
            for dataset_option in dataset_options:
                options_by_value[dataset_option["value"]] = dataset_option

            options = sorted(
                options_by_value.values(),
                key=lambda item: str(item.get("label") or item["value"]).lower(),
            )

            payload = {
                "count": len(options),
                "result": options,
            }
            return payload
        except SupersetException:
            raise
        except Exception as ex:
            raise DatabaseTablesUnexpectedError(str(ex)) from ex

    def validate(self) -> None:
        self._model = cast(Database, DatabaseDAO.find_by_id(self._db_id))
        if not self._model:
            raise DatabaseNotFoundError()
