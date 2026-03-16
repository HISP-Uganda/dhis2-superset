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
"""Auto-register DHIS2 serving tables as Superset virtual (SqlaTable) datasets.

After a serving table is materialized, we register it with Superset's dataset
registry so users can immediately find and chart it without navigating to
Settings > Datasets manually.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _parse_table_ref(table_ref: str) -> tuple[str | None, str]:
    """Split ``schema.table_name`` or bare ``table_name`` into parts."""
    if "." in table_ref:
        schema, table_name = table_ref.split(".", 1)
        # Strip surrounding quotes
        schema = schema.strip('"')
        table_name = table_name.strip('"')
        return schema, table_name
    return None, table_ref.strip('"')


def register_serving_table_as_superset_dataset(
    dataset_id: int,
    dataset_name: str,
    serving_table_ref: str,
    serving_columns: list[dict[str, Any]],
    serving_database_id: int,
) -> int:
    """Create or update a Superset SqlaTable for the DHIS2 serving table.

    Parameters
    ----------
    dataset_id:
        The ``DHIS2StagedDataset.id`` — stored in the ``extra`` JSON of the
        SqlaTable so we can find it later.
    dataset_name:
        Human-readable name for the virtual dataset.
    serving_table_ref:
        Schema-qualified table reference, e.g. ``dhis2_staging.sv_1_malaria``.
    serving_columns:
        Column definitions from ``build_serving_manifest()["columns"]``.
    serving_database_id:
        The Superset ``Database.id`` that owns the staging schema.

    Returns
    -------
    int
        The ``SqlaTable.id`` of the created or updated virtual dataset.
    """
    from superset import db
    from superset.connectors.sqla.models import SqlaTable, TableColumn
    from superset.models.core import Database

    schema, table_name = _parse_table_ref(serving_table_ref)

    # Look up the serving database
    serving_db = db.session.get(Database, serving_database_id)
    if serving_db is None:
        raise ValueError(f"Serving database id={serving_database_id} not found")

    # Check for an existing registration
    existing = (
        db.session.query(SqlaTable)
        .filter_by(
            database_id=serving_database_id,
            schema=schema,
            table_name=table_name,
        )
        .first()
    )

    if existing is not None:
        # Update column list on the existing registration
        _sync_columns(existing, serving_columns)
        db.session.commit()
        logger.info(
            "superset_dataset_service: updated existing SqlaTable id=%d for '%s'",
            existing.id,
            table_name,
        )
        return existing.id

    # Create a new SqlaTable virtual dataset
    sqla_table = SqlaTable(
        table_name=table_name,
        schema=schema,
        database_id=serving_database_id,
        database=serving_db,
        is_managed_externally=True,
        extra=json.dumps({"dhis2_staged_dataset_id": dataset_id}),
    )
    # Set a friendly verbose name
    sqla_table.verbose_map = {}  # will be overwritten by column names

    _sync_columns(sqla_table, serving_columns)

    db.session.add(sqla_table)
    db.session.flush()  # get id

    logger.info(
        "superset_dataset_service: registered new SqlaTable id=%d name='%s' for DHIS2 dataset_id=%d",
        sqla_table.id,
        table_name,
        dataset_id,
    )
    db.session.commit()
    return sqla_table.id


def _sync_columns(sqla_table: Any, serving_columns: list[dict[str, Any]]) -> None:
    """Add or update columns on a SqlaTable from a serving manifest column list."""
    from superset.connectors.sqla.models import TableColumn

    existing_by_name = {col.column_name: col for col in sqla_table.columns}
    seen: set[str] = set()

    for col_spec in serving_columns:
        col_name: str = col_spec.get("column_name") or col_spec.get("name") or ""
        if not col_name:
            continue
        seen.add(col_name)

        col_type: str = str(col_spec.get("type") or "VARCHAR")
        verbose_name: str = col_spec.get("verbose_name") or col_name
        extra_meta: dict = col_spec.get("extra") or {}

        # Determine flags from column metadata
        is_dttm = bool(col_spec.get("is_dttm") or extra_meta.get("is_dttm"))
        is_period = bool(extra_meta.get("dhis2_is_period"))
        is_metric = col_type.upper() in ("FLOAT", "DOUBLE", "NUMERIC", "DECIMAL", "INTEGER", "BIGINT")
        is_dimension = not is_metric or is_period or bool(extra_meta.get("dhis2_is_ou_hierarchy"))

        if col_name in existing_by_name:
            tc = existing_by_name[col_name]
            tc.type = col_type
            tc.verbose_name = verbose_name
            tc.is_dttm = is_dttm
            tc.filterable = True
            tc.groupby = is_dimension
        else:
            tc = TableColumn(
                column_name=col_name,
                type=col_type,
                verbose_name=verbose_name,
                is_dttm=is_dttm,
                filterable=True,
                groupby=is_dimension,
                expression="",
            )
            sqla_table.columns.append(tc)

    # Remove columns that no longer exist in the serving table
    to_remove = [
        col for col in sqla_table.columns if col.column_name not in seen
    ]
    for col in to_remove:
        sqla_table.columns.remove(col)
