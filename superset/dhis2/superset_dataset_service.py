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

from sqlalchemy.exc import IntegrityError

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
    *,
    source_database_id: int | None = None,
    source_instance_ids: list[int] | None = None,
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
    source_database_id:
        The Superset ``Database.id`` of the originating DHIS2 connection.
        Stored in ``extra`` so the DHIS2Map can route geo/metadata requests
        to the correct DHIS2 database instead of the local serving database.
    source_instance_ids:
        DHIS2 instance PKs associated with this dataset.  Stored in ``extra``
        so the map can request instance-specific metadata.

    Returns
    -------
    int
        The ``SqlaTable.id`` of the created or updated virtual dataset.
    """
    from superset import db
    from superset.connectors.sqla.models import SqlaTable, TableColumn
    from superset.models.core import Database

    schema, table_name = _parse_table_ref(serving_table_ref)
    friendly_name = dataset_name.strip() if dataset_name else table_name

    # Look up the serving database
    serving_db = db.session.get(Database, serving_database_id)
    if serving_db is None:
        raise ValueError(f"Serving database id={serving_database_id} not found")

    # --- Priority 1: find any SqlaTable on this database that already carries
    # dhis2_staged_dataset_id in its extra JSON — this picks up both the
    # friendly-named record created by the wizard (table_name=dataset_name,
    # schema=NULL) and any legacy sv_* record.  We prefer the friendly-named
    # record to avoid surfacing internal table refs in the UI. ---
    all_candidates = (
        db.session.query(SqlaTable)
        .filter(
            SqlaTable.database_id == serving_database_id,
            SqlaTable.extra.like(f'%"dhis2_staged_dataset_id": {dataset_id}%'),
        )
        .all()
    )
    # Also accept the variant without space after colon
    if not all_candidates:
        all_candidates = (
            db.session.query(SqlaTable)
            .filter(
                SqlaTable.database_id == serving_database_id,
                SqlaTable.extra.like(f'%"dhis2_staged_dataset_id":{dataset_id}%'),
            )
            .all()
        )

    existing = None
    stale_sv_records: list[Any] = []
    if all_candidates:
        # Prefer the friendly-named record; treat sv_* records as stale
        for c in all_candidates:
            if c.table_name == friendly_name:
                existing = c
            elif c.table_name == table_name:
                stale_sv_records.append(c)
        if existing is None:
            existing = all_candidates[0]

    # --- Priority 2: look up by friendly name ---
    if existing is None:
        existing = (
            db.session.query(SqlaTable)
            .filter_by(database_id=serving_database_id, table_name=friendly_name)
            .first()
        )

    # --- Priority 3: look up by sv_* raw table name (legacy) ---
    if existing is None:
        existing = (
            db.session.query(SqlaTable)
            .filter_by(
                database_id=serving_database_id,
                schema=schema,
                table_name=table_name,
            )
            .first()
        )
    if existing is None:
        existing = (
            db.session.query(SqlaTable)
            .filter_by(database_id=serving_database_id, table_name=table_name)
            .first()
        )
    if existing is None:
        # Last resort: match by table_name alone — handles stale database_id
        existing = (
            db.session.query(SqlaTable)
            .filter_by(table_name=friendly_name)
            .first()
        )
        if existing is not None:
            existing.database_id = serving_database_id
            existing.database = serving_db
            logger.info(
                "superset_dataset_service: migrated SqlaTable id=%d to serving database id=%d",
                existing.id,
                serving_database_id,
            )

    # Clean up stale sv_* records that are duplicates of the friendly-named one
    if existing is not None and stale_sv_records:
        for stale in stale_sv_records:
            if stale.id != existing.id:
                logger.info(
                    "superset_dataset_service: removing stale sv_* SqlaTable id=%d ('%s')",
                    stale.id,
                    stale.table_name,
                )
                db.session.delete(stale)

    if existing is not None:
        # Ensure dhis2_staged_dataset_id is present in extra so that the
        # datasource/api column-values endpoint can route to staging storage.
        # Also sync serving_database_id/name/table_ref so get_serving_database()
        # resolves correctly after engine migrations (e.g. DuckDB → ClickHouse).
        _ensure_dhis2_extra(
            existing,
            dataset_id,
            source_database_id=source_database_id,
            source_instance_ids=source_instance_ids,
            serving_database_id=serving_database_id,
            serving_database_name=serving_db.database_name,
            serving_table_ref=serving_table_ref,
        )
        _sync_columns(existing, serving_columns)
        db.session.commit()
        logger.info(
            "superset_dataset_service: updated existing SqlaTable id=%d for '%s'",
            existing.id,
            table_name,
        )
        return existing.id

    # Build initial extra with all DHIS2 routing metadata
    initial_extra: dict[str, Any] = {
        "dhis2_staged_dataset_id": dataset_id,
        "dhis2_staged_local": True,
        "dhis2_serving_database_id": serving_database_id,
        "dhis2_serving_database_name": serving_db.database_name,
        "dhis2_serving_table_ref": serving_table_ref,
    }
    if source_database_id is not None:
        initial_extra["dhis2_source_database_id"] = source_database_id
    if source_instance_ids:
        initial_extra["dhis2_source_instance_ids"] = source_instance_ids

    # Create a new SqlaTable virtual dataset using the human-friendly name.
    # Using friendly_name (e.g. "Malaria Vaccine Coverage Dataset...") instead
    # of the raw sv_* table name keeps the chart selector readable.
    # The SQL expression routes queries to the serving table directly.
    sql_expression = f"SELECT * FROM {serving_table_ref}"
    sqla_table = SqlaTable(
        table_name=friendly_name,
        schema=None,
        sql=sql_expression,
        database_id=serving_database_id,
        database=serving_db,
        is_managed_externally=False,
        extra=json.dumps(initial_extra),
    )

    _sync_columns(sqla_table, serving_columns)

    with db.session.no_autoflush:
        db.session.add(sqla_table)
        try:
            db.session.flush()  # get id
        except IntegrityError:
            # UNIQUE constraint on table_name fired — race condition or the
            # wizard's POST /api/v1/dataset/ already created the friendly record.
            db.session.rollback()
            existing = (
                db.session.query(SqlaTable)
                .filter_by(table_name=friendly_name)
                .first()
            )
            if existing is not None and existing.database_id != serving_database_id:
                existing.database_id = serving_database_id
                existing.database = serving_db
            if existing is None:
                raise  # genuinely unexpected — propagate
            _ensure_dhis2_extra(
                existing,
                dataset_id,
                source_database_id=source_database_id,
                source_instance_ids=source_instance_ids,
                serving_database_id=serving_database_id,
                serving_database_name=serving_db.database_name,
                serving_table_ref=serving_table_ref,
            )
            _sync_columns(existing, serving_columns)
            db.session.commit()
            logger.info(
                "superset_dataset_service: resolved race-condition; "
                "using existing SqlaTable id=%d for '%s'",
                existing.id,
                table_name,
            )
            return existing.id

    logger.info(
        "superset_dataset_service: registered new SqlaTable id=%d name='%s' for DHIS2 dataset_id=%d",
        sqla_table.id,
        table_name,
        dataset_id,
    )
    db.session.commit()
    return sqla_table.id


def _ensure_dhis2_extra(
    sqla_table: Any,
    dataset_id: int,
    *,
    source_database_id: int | None = None,
    source_instance_ids: list[int] | None = None,
    serving_database_id: int | None = None,
    serving_database_name: str | None = None,
    serving_table_ref: str | None = None,
) -> None:
    """Guarantee that SqlaTable.extra contains DHIS2 routing metadata.

    Idempotent — only writes when a field is absent or stale so we don't
    clobber other keys that may have been added by users.
    """
    try:
        raw = getattr(sqla_table, "extra", None) or "{}"
        extra: dict = json.loads(raw) if isinstance(raw, str) else dict(raw)
    except (json.JSONDecodeError, TypeError):
        extra = {}

    changed = False
    if extra.get("dhis2_staged_dataset_id") != dataset_id:
        extra["dhis2_staged_dataset_id"] = dataset_id
        changed = True
    if not extra.get("dhis2_staged_local"):
        extra["dhis2_staged_local"] = True
        changed = True
    if source_database_id is not None and extra.get("dhis2_source_database_id") != source_database_id:
        extra["dhis2_source_database_id"] = source_database_id
        changed = True
    if source_instance_ids and extra.get("dhis2_source_instance_ids") != source_instance_ids:
        extra["dhis2_source_instance_ids"] = source_instance_ids
        changed = True
    if serving_database_id is not None and extra.get("dhis2_serving_database_id") != serving_database_id:
        extra["dhis2_serving_database_id"] = serving_database_id
        changed = True
    if serving_database_name is not None and extra.get("dhis2_serving_database_name") != serving_database_name:
        extra["dhis2_serving_database_name"] = serving_database_name
        changed = True
    if serving_table_ref is not None and extra.get("dhis2_serving_table_ref") != serving_table_ref:
        extra["dhis2_serving_table_ref"] = serving_table_ref
        changed = True
    if changed:
        sqla_table.extra = json.dumps(extra)


def _sync_columns(sqla_table: Any, serving_columns: list[dict[str, Any]]) -> None:
    """Add or update columns on a SqlaTable from a serving manifest column list."""
    from superset.connectors.sqla.models import TableColumn

    existing_by_name = {col.column_name: col for col in sqla_table.columns}
    seen: set[str] = set()

    for col_spec in serving_columns:
        col_name: str = col_spec.get("column_name") or col_spec.get("name") or ""
        if not col_name:
            continue

        _extra_raw = col_spec.get("extra") or {}
        if isinstance(_extra_raw, str):
            try:
                import json as _json
                _extra_raw = _json.loads(_extra_raw) or {}
            except Exception:  # pylint: disable=broad-except
                _extra_raw = {}
        extra_meta: dict = _extra_raw if isinstance(_extra_raw, dict) else {}

        # Internal columns (e.g. dhis2_instance) exist in the serving table for
        # backend routing but must NOT appear in chart control panels or the
        # Explore sidebar.  Exclude them from TableColumn records entirely.
        # Not adding to `seen` means any existing stale TableColumn for this
        # name will be removed by the cleanup pass below.
        if extra_meta.get("dhis2_is_internal"):
            continue

        seen.add(col_name)

        col_type: str = str(col_spec.get("type") or "VARCHAR")
        verbose_name: str = col_spec.get("verbose_name") or col_name

        # Determine flags from column metadata
        is_dttm = bool(col_spec.get("is_dttm") or extra_meta.get("is_dttm"))
        is_period = bool(extra_meta.get("dhis2_is_period"))
        is_metric = col_type.upper() in ("FLOAT", "DOUBLE", "NUMERIC", "DECIMAL", "INTEGER", "BIGINT")
        is_dimension = not is_metric or is_period or bool(extra_meta.get("dhis2_is_ou_hierarchy"))

        # Persist DHIS2-specific metadata (dhis2_is_period, dhis2_is_ou_hierarchy,
        # etc.) into TableColumn.extra so DHIS2ColumnFilterControl and native
        # filter panels can read them without needing the staging API.
        extra_json = json.dumps(extra_meta) if extra_meta else None

        if col_name in existing_by_name:
            tc = existing_by_name[col_name]
            tc.type = col_type
            tc.verbose_name = verbose_name
            tc.is_dttm = is_dttm
            tc.filterable = True
            tc.groupby = is_dimension
            if extra_json is not None:
                tc.extra = extra_json
        else:
            tc = TableColumn(
                column_name=col_name,
                type=col_type,
                verbose_name=verbose_name,
                is_dttm=is_dttm,
                filterable=True,
                groupby=is_dimension,
                expression="",
                extra=extra_json or "",
            )
            sqla_table.columns.append(tc)

    # Remove columns that no longer exist in the serving table
    to_remove = [
        col for col in sqla_table.columns if col.column_name not in seen
    ]
    for col in to_remove:
        sqla_table.columns.remove(col)
