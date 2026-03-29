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
                    ),
                    lazyload(SqlaTable.columns),
                    lazyload(SqlaTable.metrics),
                )
            )

            # Filter by catalog and schema if provided
            if self._catalog_name:
                datasets_query = datasets_query.filter(SqlaTable.catalog == self._catalog_name)

            datasets = datasets_query.all()

            # Map virtual datasets to options
            dataset_options = [
                {
                    "id": ds.id,
                    "label": ds.table_name,
                    "value": _resolve_dataset_table_ref(ds)[1],
                    "type": "dataset",
                    "extra": ds.extra_dict,
                    "sql": ds.sql,
                }
                for ds in datasets
                if ds.sql
                and (
                    requested_schema is None
                    or _resolve_dataset_table_ref(ds)[0] == requested_schema
                )
            ]

            options_by_value: dict[str, dict[str, Any]] = {}
            for table in tables:
                options_by_value.setdefault(
                    table.table,
                    {
                        "value": table.table,
                        "type": "table",
                    },
                )
            for view in views:
                options_by_value.setdefault(
                    view.table,
                    {
                        "value": view.table,
                        "type": "view",
                    },
                )
            for mv in materialized_views:
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
