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
    """Split ``schema.table_name`` or bare ``table_name`` into parts.

    Strips both double-quote and backtick delimiters so that ClickHouse
    table refs like ``\`dhis2_serving\`.\`sv_1_foo\``` are parsed cleanly
    into (``dhis2_serving``, ``sv_1_foo``) without stray backtick characters
    ending up inside the generated table names.
    """
    if "." in table_ref:
        schema, table_name = table_ref.split(".", 1)
        schema = schema.strip('"').strip("`")
        table_name = table_name.strip('"').strip("`")
        return schema, table_name
    return None, table_ref.strip('"').strip("`")


def register_serving_table_as_superset_dataset(
    dataset_id: int,
    dataset_name: str,
    serving_table_ref: str,
    serving_columns: list[dict[str, Any]],
    serving_database_id: int,
    *,
    source_database_id: int | None = None,
    source_instance_ids: list[int] | None = None,
    dataset_role: str | None = None,
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
    
    # Add [SOURCE] suffix if it's a main serving table and NOT a mart
    if not table_name.endswith("_mart") and not table_name.startswith("["):
        friendly_name = f"{dataset_name.strip()} [SOURCE]" if dataset_name else f"{table_name} [SOURCE]"
    else:
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
        # Prefer the record whose table_name matches the current friendly_name.
        # Each mart (KPI, Map L1, …) and the main dataset share the same
        # dhis2_staged_dataset_id, so all_candidates may contain several rows.
        # We must NOT fall back to all_candidates[0] when the name doesn't
        # match — that would overwrite the main dataset's SQL with a mart
        # table ref, corrupting the primary virtual dataset.
        for c in all_candidates:
            if c.table_name == friendly_name:
                existing = c
            elif c.table_name == table_name:
                stale_sv_records.append(c)
        # No name-based fallback here — proceed to priority-2 / priority-3.

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
        # Overwrite dataset_role only if the caller explicitly specifies one,
        # to avoid unintentionally resetting a role set by a previous repair.
        if dataset_role is not None:
            existing.dataset_role = dataset_role
        # Keep the virtual SQL pointing to the physical serving table so that
        # query engines use the correct underlying table (especially important
        # after migrating from _kpi/_map to _mart, or from raw sv_* to _mart).
        new_sql = f"SELECT * FROM {serving_table_ref}"
        if existing.sql != new_sql:
            existing.sql = new_sql
        _sync_columns(existing, serving_columns)
        db.session.commit()
        logger.info(
            "superset_dataset_service: updated existing SqlaTable id=%d for '%s' "
            "(dataset_role=%s)",
            existing.id,
            table_name,
            dataset_role,
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
    if dataset_role is not None:
        sqla_table.dataset_role = dataset_role

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
            if dataset_role is not None:
                existing.dataset_role = dataset_role
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


def ensure_specialized_marts_for_sqla_table(sqla_table: Any) -> None:
    """Guarantee that the DHIS2 physical table referenced by *sqla_table* exists.

    If the dataset is DHIS2-backed, this calls ensure_serving_table() which
    materializes the main serving table AND all specialized marts (KPI, Map).
    """
    try:
        raw = getattr(sqla_table, "extra", None) or "{}"
        extra: dict = json.loads(raw) if isinstance(raw, str) else dict(raw)
        staged_id = extra.get("dhis2_staged_dataset_id")
        if staged_id and isinstance(staged_id, int):
            from flask import current_app
            from superset.app import create_app
            from superset.dhis2.staged_dataset_service import ensure_serving_table
            
            # Ensure we have an app context for DB operations
            ctx = None
            if not current_app:
                app = create_app()
                ctx = app.app_context()
                ctx.push()
            
            try:
                # This triggers a build if tables are missing or stale
                ensure_serving_table(staged_id)
            finally:
                if ctx:
                    ctx.pop()
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "ensure_specialized_marts_for_sqla_table: failed for SqlaTable id=%s",
            getattr(sqla_table, "id", None),
            exc_info=True,
        )


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


def _cleanup_orphaned_mart_dataset(
    dataset_id: int, serving_database_id: int, table_ref: str
) -> None:
    """Delete Superset SqlaTable for a mart whose ClickHouse backing table no longer exists."""
    from superset.connectors.sqla.models import SqlaTable
    from superset import db

    _, table_name = _parse_table_ref(table_ref)
    existing = (
        db.session.query(SqlaTable)
        .filter(
            SqlaTable.database_id == serving_database_id,
            SqlaTable.table_name == table_name,
        )
        .first()
    )
    if existing is None:
        return
    try:
        extra = json.loads(existing.extra or "{}")
    except Exception:  # pylint: disable=broad-except
        extra = {}
    if extra.get("dhis2_staged_dataset_id") == dataset_id:
        logger.info(
            "Removing orphaned mart Superset dataset %s (id=%d) — ClickHouse table absent",
            table_name,
            existing.id,
        )
        db.session.delete(existing)
        db.session.commit()


def _cleanup_legacy_mart_datasets(dataset_id: int, serving_database_id: int) -> None:
    """Remove old [KPI] and [Map] Superset dataset records for a staged dataset.

    Called after migrating to the single _mart architecture to keep the dataset
    list clean.
    """
    from superset.connectors.sqla.models import SqlaTable
    from superset import db

    legacy_prefixes = ("[KPI] ", "[Map] ", "[Map L")
    candidates = (
        db.session.query(SqlaTable)
        .filter(SqlaTable.database_id == serving_database_id)
        .all()
    )
    for ds in candidates:
        name = ds.table_name or ""
        if not any(name.startswith(p) for p in legacy_prefixes):
            continue
        try:
            extra = json.loads(ds.extra or "{}")
            if extra.get("dhis2_staged_dataset_id") == dataset_id:
                logger.info(
                    "_cleanup_legacy_mart_datasets: removing legacy '%s' (id=%d)",
                    name, ds.id,
                )
                db.session.delete(ds)
        except Exception:  # pylint: disable=broad-except
            continue
    db.session.commit()


def register_specialized_marts_as_superset_datasets(
    dataset_id: int,
    dataset_name: str,
    serving_table_ref: str,
    serving_columns: list[dict[str, Any]],
    serving_database_id: int,
    *,
    source_database_id: int | None = None,
    source_instance_ids: list[int] | None = None,
    engine: Any = None,
    dataset: Any = None,
) -> None:
    """Register the single consolidated _mart dataset in Superset.

    Registers one mart per source dataset using the original friendly dataset
    name (no [KPI] / [Map] prefix). Cleans up any legacy [KPI] / [Map] records.
    """
    schema, base_table_name = _parse_table_ref(serving_table_ref)

    # Identify all non-internal columns for the mart
    mart_columns = [
        c for c in serving_columns
        if not (c.get("extra") and "dhis2_is_internal" in str(c.get("extra")))
    ]

    def _mart_exists_check(check_fn_name: str, table_ref: str) -> bool:
        if engine is None or dataset is None:
            return True  # no engine to verify — optimistic
        check_fn = getattr(engine, check_fn_name, None)
        if check_fn is None:
            return True
        try:
            return bool(check_fn(dataset))
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "register_specialized_marts: %s check raised an exception for %s "
                "(dataset_id=%s) — defaulting to optimistic registration. Error: %s",
                check_fn_name, table_ref, dataset_id, exc,
            )
            return True  # optimistic: attempt registration anyway

    from superset.datasets.policy import DatasetRole

    # Single consolidated _mart
    mart_table_name = f"{base_table_name}_mart"
    mart_ref = f"{schema}.{mart_table_name}" if schema else mart_table_name

    if _mart_exists_check("mart_exists", mart_ref):
        try:
            register_serving_table_as_superset_dataset(
                dataset_id=dataset_id,
                dataset_name=f"{dataset_name} [MART]",  # Add suffix to avoid collision with METADATA record
                serving_table_ref=mart_ref,
                serving_columns=mart_columns,
                serving_database_id=serving_database_id,
                source_database_id=source_database_id,
                source_instance_ids=source_instance_ids,
                # MART role so the record is hidden from the management list
                # but remains available in chart creation.
                dataset_role=DatasetRole.MART.value,
            )
            logger.info(
                "register_specialized_marts: mart registered for dataset id=%s (%s)",
                dataset_id, mart_ref,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.error(
                "register_specialized_marts: FAILED to register mart for dataset id=%s (%s): %s",
                dataset_id, mart_ref, exc,
            )
    else:
        logger.info(
            "register_specialized_marts: Skipping mart registration — "
            "ClickHouse table %s absent for dataset id=%s",
            mart_ref, dataset_id,
        )
        _cleanup_orphaned_mart_dataset(dataset_id, serving_database_id, mart_ref)

    # Cleanup legacy [KPI] and [Map] Superset records for this dataset
    _cleanup_legacy_mart_datasets(dataset_id, serving_database_id)


def cleanup_staged_dataset_superset_resources(
    dataset_id: int,
    serving_database_id: int | None = None,
) -> None:
    """Delete all Superset virtual datasets associated with a staged dataset.

    This includes the main thematic dataset and any specialized marts ([KPI],
    [Map], etc.) derived from it.
    """
    from superset import db
    from superset.connectors.sqla.models import SqlaTable

    # Find all SqlaTable records that reference this staged dataset id in their 'extra' JSON.
    # We use a LIKE filter on the 'extra' column to find them efficiently.
    query = db.session.query(SqlaTable).filter(
        SqlaTable.extra.like(f'%"dhis2_staged_dataset_id": {dataset_id}%')
    )
    if serving_database_id is not None:
        query = query.filter(SqlaTable.database_id == serving_database_id)

    datasets = query.all()
    for ds in datasets:
        logger.info(
            "cleanup_staged_dataset_superset_resources: deleting associated Superset dataset id=%d ('%s')",
            ds.id,
            ds.table_name,
        )
        db.session.delete(ds)

    db.session.commit()


def repair_dhis2_chart_references() -> dict[str, int]:
    """Re-point charts from deprecated [KPI]/[Map]/[Map L*] datasets to the single _mart dataset.

    When marts are consolidated, old dual-mart datasets are deleted.
    This function ensures existing charts are migrated to the new unified
    mart dataset instead of breaking.
    """
    from superset.datasets.policy import DatasetRole
    from superset import db
    from superset.models.slice import Slice
    from superset.connectors.sqla.models import SqlaTable

    all_datasets = db.session.query(SqlaTable).filter(
        SqlaTable.extra.like('%"dhis2_staged_dataset_id":%')
    ).all()

    # Build map: staged_id -> mart SqlaTable.id (single mart per dataset)
    mart_by_staged_id: dict[int, int] = {}
    legacy_ids: set[int] = set()
    legacy_prefixes = ("[KPI] ", "[Map] ", "[Map L")

    for ds in all_datasets:
        try:
            extra = json.loads(ds.extra or "{}")
            staged_id = extra.get("dhis2_staged_dataset_id")
            if not staged_id:
                continue
            name = ds.table_name or ""
            if any(name.startswith(p) for p in legacy_prefixes):
                legacy_ids.add(ds.id)
            elif ds.dataset_role == DatasetRole.MART.value:
                # Accept MART role for the consolidated mart dataset.
                mart_by_staged_id[staged_id] = ds.id
        except Exception:  # pylint: disable=broad-except
            continue

    if not legacy_ids:
        return {"repointed_charts": 0}

    charts = db.session.query(Slice).filter(
        Slice.datasource_id.in_(legacy_ids),
        Slice.datasource_type == "table",
    ).all()

    repointed_count = 0
    for chart in charts:
        dep_ds = db.session.get(SqlaTable, chart.datasource_id)
        if not dep_ds:
            continue
        try:
            extra = json.loads(dep_ds.extra or "{}")
            staged_id = extra.get("dhis2_staged_dataset_id")
            target_id = mart_by_staged_id.get(staged_id)
            if target_id and target_id != chart.datasource_id:
                logger.info(
                    "repair_charts: repointing chart id=%d ('%s') from legacy ds=%d to mart ds=%d",
                    chart.id, chart.slice_name, chart.datasource_id, target_id,
                )
                chart.datasource_id = target_id
                repointed_count += 1
        except Exception:  # pylint: disable=broad-except
            continue

    if repointed_count > 0:
        db.session.commit()
        logger.info("repair_charts: migrated %d charts to consolidated marts", repointed_count)

    return {"repointed_charts": repointed_count}


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
        expression = col_spec.get("expression") or ""

        if col_name in existing_by_name:
            tc = existing_by_name[col_name]
            tc.type = col_type
            tc.verbose_name = verbose_name
            tc.is_dttm = is_dttm
            tc.filterable = True
            tc.groupby = is_dimension
            tc.expression = expression
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
                expression=expression,
                extra=extra_json or "",
            )
            sqla_table.columns.append(tc)

    # Remove columns that no longer exist in the serving table
    to_remove = [
        col for col in sqla_table.columns if col.column_name not in seen
    ]
    for col in to_remove:
        sqla_table.columns.remove(col)
