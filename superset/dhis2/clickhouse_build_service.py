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
"""ClickHouse-native serving build service."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Iterable

from superset.dhis2.analytical_serving import build_serving_manifest, dataset_columns_payload
from superset.dhis2.org_unit_hierarchy_service import OrgUnitHierarchyService
from superset.dhis2.period_hierarchy_service import PeriodHierarchyService
from superset.dhis2.serving_build_service import ServingBuildResult
from superset.local_staging.engine_factory import get_active_staging_engine

logger = logging.getLogger(__name__)


def build_serving_table_clickhouse(
    dataset: Any,
    *,
    engine: Any | None = None,
    refresh_scope: Iterable[str] | None = None,
) -> ServingBuildResult:
    """Build serving table entirely within ClickHouse using INSERT ... SELECT."""
    resolved_engine = engine or get_active_staging_engine(dataset.database_id)
    if resolved_engine.engine_name != "clickhouse":
        raise ValueError(f"Engine {resolved_engine.engine_name} is not supported by ClickHouse builder")

    manifest = build_serving_manifest(dataset)
    build_id = str(uuid.uuid4())[:8]
    
    ou_map_table = ""
    pe_map_table = ""
    ou_cols: set[str] = set()
    pe_cols: set[str] = set()

    try:
        # 1. Prepare Hierarchy Maps
        ou_map_table, ou_cols = _upload_org_unit_map(dataset, resolved_engine, manifest, build_id)
        pe_map_table, pe_cols = _upload_period_map(dataset, resolved_engine, manifest, build_id)

        # 1.5 Prune empty columns from maps
        active_ou_cols = _prune_empty_columns(resolved_engine, ou_map_table, ou_cols)
        
        # Update manifest columns to remove those we are dropping
        dropped_cols = ou_cols - active_ou_cols
        if dropped_cols:
             manifest["columns"] = [
                 c for c in manifest["columns"] 
                 if c["column_name"] not in dropped_cols
             ]
             logger.info("Pruned empty hierarchy columns: %s", dropped_cols)

        # 2. Generate SELECT SQL
        select_sql = _generate_serving_sql(
            dataset,
            resolved_engine,
            manifest,
            ou_map_table,
            active_ou_cols,
            pe_map_table,
            pe_cols,
            refresh_scope=refresh_scope,
        )

        # 3. Execute Build (Full or Incremental)
        if refresh_scope:
            # Incremental via Partition Replacement
            # Note: This assumes the table is partitioned by year or similar
            # For now, let's stick to full exchange for simplicity, but 
            # execute_serving_build_sql could be extended.
            # Actually, let's implement the specialized logic here if scope is provided.
            serving_name = _execute_incremental_build(
                dataset,
                resolved_engine,
                select_sql,
                manifest["columns"],
                refresh_scope,
            )
        else:
            # Full Exchange
            serving_name = resolved_engine.execute_serving_build_sql(
                dataset,
                select_sql,
                manifest["columns"],
            )
        
        # 4. Specialized Marts (KPI, Map)
        built_marts = _build_specialized_marts(dataset, resolved_engine, serving_name, manifest)

        # 5. Diagnostics
        source_count = resolved_engine._table_row_count(resolved_engine.get_superset_sql_table_ref(dataset))
        serving_count = resolved_engine._table_row_count(resolved_engine.get_serving_sql_table_ref(dataset))

        diagnostics = {
            "mode": "clickhouse_native",
            "incremental": bool(refresh_scope),
            "refresh_scope": list(refresh_scope) if refresh_scope else None,
            "ou_map_table": ou_map_table,
            "pe_map_table": pe_map_table,
            "columns": len(manifest["columns"]),
            "serving_table_ref": resolved_engine.get_serving_sql_table_ref(dataset),
            "source_row_count": source_count,
            "live_serving_row_count": serving_count,
            "built_marts": built_marts,
        }
        
        return ServingBuildResult(
            serving_table_ref=resolved_engine.get_serving_sql_table_ref(dataset),
            serving_columns=dataset_columns_payload(manifest["columns"]),
            diagnostics=diagnostics,
        )

    finally:
        if ou_map_table:
            resolved_engine.drop_temp_table(ou_map_table.split(".")[-1].strip("`"))
        if pe_map_table:
            resolved_engine.drop_temp_table(pe_map_table.split(".")[-1].strip("`"))


def _execute_incremental_build(
    dataset: Any,
    engine: Any,
    select_sql: str,
    columns_config: list[dict[str, Any]],
    refresh_scope: Iterable[str],
) -> str:
    """Build specific partitions and replace them in the live table."""
    serving_db = engine._serving_database
    serving_name = engine.get_serving_table_name(dataset)
    target_ref = f"`{serving_db}`.`{serving_name}`"
    
    # Ensure target table exists (do a full build if it doesn't)
    # Check existence via system.tables
    exists = engine._qry(f"SELECT count() FROM system.tables WHERE database = '{serving_db}' AND name = '{serving_name}'").result_rows[0][0]
    if not exists:
        logger.info("Target serving table %s does not exist; falling back to full build", target_ref)
        return engine.execute_serving_build_sql(dataset, select_sql, columns_config)

    # 1. Create a temporary loading table with same structure as live
    # We can use CREATE TABLE ... AS ...
    temp_name = f"{serving_name}__inc_{uuid.uuid4().int % 10**9}"
    temp_ref = f"`{serving_db}`.`{temp_name}`"
    engine._cmd(f"CREATE TABLE {temp_ref} AS {target_ref}")
    
    try:
        # 2. Insert the new data into the temp table
        engine._cmd(f"INSERT INTO {temp_ref} {select_sql}")
        
        # 3. Replace partitions for each period in the scope
        # In DHIS2, we partition by year (usually). We need to extract the years from refresh_scope.
        # This is a bit simplified; real logic needs to match the partition key.
        years = set()
        for pe in refresh_scope:
            if len(pe) >= 4 and pe[:4].isdigit():
                years.add(pe[:4])
        
        for year in sorted(years):
            engine.replace_partition(serving_name, temp_name, year)
            
        return serving_name
    finally:
        engine._cmd(f"DROP TABLE IF EXISTS {temp_ref}")


def _build_specialized_marts(dataset: Any, engine: Any, serving_name: str, manifest: dict[str, Any]) -> list[str]:
    """Create a single consolidated _mart table from the main serving table.

    The mart includes the full OU hierarchy (geographic breakdown) plus all
    measure/indicator columns aggregated with the appropriate function.
    Returns a list of mart table names that were successfully built.
    Individual mart failures are logged and skipped so a broken mart never
    prevents the main serving build from completing.
    """
    serving_db = engine._serving_database
    source_ref = f"`{serving_db}`.`{serving_name}`"
    built: list[str] = []

    # Identify variable columns and their aggregation requirement
    var_cols = []
    for c in manifest["columns"]:
        if not c.get("variable_id"):
            continue

        extra = c.get("extra") or {}
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except Exception:  # pylint: disable=broad-except
                extra = {}

        # Indicators (rates/percentages) must use AVG to avoid inflating values
        # when aggregating across periods or organization units.
        # String/text type data elements cannot use sum — use max instead.
        is_indicator = extra.get("dhis2_is_indicator") is True
        col_type = str(c.get("type") or "").upper()
        is_string = col_type in ("STRING", "TEXT", "VARCHAR")
        if is_indicator:
            agg_func = "avgOrNull"
        elif is_string:
            agg_func = "max"
        else:
            agg_func = "sumOrNull"
        var_cols.append({"name": f"`{c['column_name']}`", "agg": agg_func})

    if not var_cols:
        return built

    period_col = manifest.get("period_column_name")
    instance_col = (manifest.get("dimension_column_names") or [None])[0] if manifest.get("include_instance_name") else None

    # Find period hierarchy columns (year, quarter, etc.)
    period_hierarchy_cols = []
    for c in manifest["columns"]:
        extra = c.get("extra") or {}
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except Exception:  # pylint: disable=broad-except
                extra = {}
        if extra.get("dhis2_is_period_hierarchy"):
            period_hierarchy_cols.append(f"`{c['column_name']}`")

    common_group_cols = []
    if instance_col:
        common_group_cols.append(f"`{instance_col}`")
    if period_col:
        common_group_cols.append(f"`{period_col}`")
    # Add hierarchy levels to grouping to allow trend analysis at different grains
    common_group_cols.extend(period_hierarchy_cols)

    # Find OU hierarchy columns (full geographic breakdown)
    ou_hierarchy_cols = []
    for c in manifest["columns"]:
        extra = c.get("extra") or {}
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except Exception:  # pylint: disable=broad-except
                extra = {}
        if extra.get("dhis2_is_ou_hierarchy"):
            ou_hierarchy_cols.append(f"`{c['column_name']}`")

    # Add OU level column if present in manifest
    ou_level_col = manifest.get("ou_level_column_name")
    if ou_level_col:
        ou_hierarchy_cols.append(f"`{ou_level_col}`")

    # Include COC (Category Option Combo) dimension columns in the mart when the
    # manifest exposes them.  This preserves disaggregation grain so users can
    # group and filter charts by disaggregation without losing row fidelity.
    # When no COC columns are present the mart collapses across all COCs,
    # which is the correct total-only behaviour for "total" disaggregation mode.
    coc_dimension_cols: list[str] = []
    coc_uid_col = manifest.get("coc_uid_column_name")
    coc_name_col = manifest.get("coc_name_column_name")
    if coc_uid_col:
        coc_dimension_cols.append(f"`{coc_uid_col}`")
    if coc_name_col:
        coc_dimension_cols.append(f"`{coc_name_col}`")

    # Single consolidated mart: instance + period + full OU hierarchy + COC (opt-in)
    # This is a superset of the old KPI grouping and includes geographic dimensions
    # needed for maps, KPI charts, pivots, and dashboard filters.
    mart_group_cols = list(dict.fromkeys(common_group_cols + ou_hierarchy_cols + coc_dimension_cols))
    if not mart_group_cols:
        if ou_level_col:
            mart_group_cols = [f"`{ou_level_col}`"]
        elif instance_col:
            mart_group_cols = [f"`{instance_col}`"]
        elif period_col:
            mart_group_cols = [f"`{period_col}`"]

    if not mart_group_cols:
        return built

    # Define optimal ClickHouse primary key / sort order
    def _get_pk_cols(grouping: list[str]) -> list[str]:
        pk = []
        if instance_col and f"`{instance_col}`" in grouping:
            pk.append(f"`{instance_col}`")
        if period_col and f"`{period_col}`" in grouping:
            pk.append(f"`{period_col}`")
        if ou_level_col and f"`{ou_level_col}`" in grouping:
            pk.append(f"`{ou_level_col}`")
        seen = set(pk)
        for c in grouping:
            if c not in seen:
                pk.append(c)
        return pk

    # Single _mart table (replaces separate _kpi and _map tables)
    mart_name = f"{serving_name}_mart"
    mart_ref = f"`{serving_db}`.`{mart_name}`"
    mart_pk = _get_pk_cols(mart_group_cols)
    try:
        select_exprs = mart_group_cols + [f"{c['agg']}({c['name']}) AS {c['name']}" for c in var_cols]

        engine._cmd(f"DROP TABLE IF EXISTS {mart_ref}")
        engine._cmd(
            f"CREATE TABLE {mart_ref} ENGINE = MergeTree() ORDER BY ({', '.join(mart_pk)}) "
            f"SETTINGS allow_nullable_key = 1 "
            f"AS SELECT {', '.join(select_exprs)} FROM {source_ref} GROUP BY {', '.join(mart_group_cols)}"
        )
        logger.info("ClickHouse: built consolidated mart %s (groups=%d)", mart_ref, len(mart_group_cols))
        built.append(mart_name)

        # Drop legacy _kpi and _map tables if they still exist from the old architecture
        for legacy_suffix in ("_kpi", "_map"):
            legacy_name = f"{serving_name}{legacy_suffix}"
            legacy_ref = f"`{serving_db}`.`{legacy_name}`"
            try:
                engine._cmd(f"DROP TABLE IF EXISTS {legacy_ref}")
                logger.info("ClickHouse: dropped legacy mart %s", legacy_ref)
            except Exception:  # pylint: disable=broad-except
                logger.debug("ClickHouse: could not drop legacy mart %s (may not exist)", legacy_ref)
    except Exception:  # pylint: disable=broad-except
        logger.exception(
            "ClickHouse: failed to build consolidated mart %s — skipping",
            mart_ref,
        )

    return built


def _upload_org_unit_map(
    dataset: Any,
    engine: Any,
    manifest: dict[str, Any],
    build_id: str,
) -> tuple[str, set[str]]:
    hierarchy_lookup = manifest.get("hierarchy_lookup") or {}
    if not hierarchy_lookup:
        return "", set()

    hierarchy_cols = set()
    for level_values in hierarchy_lookup.values():
        hierarchy_cols.update(level_values.keys())
    
    sorted_cols = sorted(hierarchy_cols)
    table_name = f"tmp_ou_map_{dataset.id}_{build_id}"
    
    columns_ddl = {
        "source_instance_id": "Int32",
        "org_unit_id": "String",
    }
    for col in sorted_cols:
        columns_ddl[col] = "Nullable(String)"

    engine.create_temp_table(table_name, columns_ddl)
    
    rows = []
    for (inst_id, ou_id), values in hierarchy_lookup.items():
        row = {
            "source_instance_id": inst_id,
            "org_unit_id": ou_id,
        }
        row.update(values)
        rows.append(row)
    
    col_names = ["source_instance_id", "org_unit_id"] + sorted_cols
    engine.insert_temp_rows(table_name, rows, col_names)
    
    return f"`{engine._serving_database}`.`{table_name}`", set(sorted_cols)


def _upload_period_map(
    dataset: Any,
    engine: Any,
    manifest: dict[str, Any],
    build_id: str,
) -> tuple[str, set[str]]:
    periods = engine.get_distinct_periods(dataset, use_serving=False)
    if not periods:
        return "", set()

    service = PeriodHierarchyService()
    col_map = manifest.get("period_column_names_by_key") or {}
    
    target_cols = set(col_map.values())
    primary_period_col = manifest.get("period_column_name")
    if primary_period_col:
        target_cols.add(primary_period_col)

    table_name = f"tmp_pe_map_{dataset.id}_{build_id}"
    columns_ddl = {"pe": "String"}
    for col in target_cols:
        columns_ddl[col] = "Nullable(String)"
        
    engine.create_temp_table(table_name, columns_ddl)
    
    rows = []
    for pe in periods:
        normalized = service.normalize_period(pe)
        row = {"pe": pe}
        for key, target_col in col_map.items():
            val = normalized.get(key)
            if val:
                row[target_col] = str(val)
        if primary_period_col and primary_period_col not in row:
             row[primary_period_col] = pe
        rows.append(row)

    col_names = ["pe"] + list(target_cols)
    engine.insert_temp_rows(table_name, rows, col_names)
    
    return f"`{engine._serving_database}`.`{table_name}`", target_cols


def _generate_serving_sql(
    dataset: Any,
    engine: Any,
    manifest: dict[str, Any],
    ou_map_table: str,
    ou_cols: set[str],
    pe_map_table: str,
    pe_cols: set[str],
    refresh_scope: Iterable[str] | None = None,
) -> str:
    staging_ref = engine.get_superset_sql_table_ref(dataset)
    columns = manifest["columns"]
    
    select_exprs = []
    group_by_exprs = []
    
    for col in columns:
        col_name = col["column_name"]
        col_type = col.get("type", "TEXT")
        
        # 1. Variable Columns (Pivoted)
        var_id = col.get("variable_id")
        if var_id:
            coc_uid = col.get("coc_uid")
            # instance_id scopes the CASE predicate to a single source connection,
            # preventing rows from different DHIS2 instances that share the same
            # dx_uid from being summed into the same column.
            instance_id = col.get("instance_id")
            val_col = "value_numeric" if col_type in ("FLOAT", "DOUBLE", "INTEGER", "BIGINT", "NUMERIC") else "value"

            staged_dataset_id = col.get("staged_dataset_id")
            preds = [f"s.dx_uid = '{var_id}'"]
            if staged_dataset_id is not None:
                preds.append(f"s.staged_dataset_id = {int(staged_dataset_id)}")
            if instance_id is not None:
                preds.append(f"s.source_instance_id = {int(instance_id)}")
            if coc_uid:
                preds.append(f"s.co_uid = '{coc_uid}'")
            predicate = " AND ".join(preds)

            if val_col == "value_numeric":
                expr = f"sumOrNull(CASE WHEN {predicate} THEN s.{val_col} ELSE NULL END)"
            else:
                expr = f"max(CASE WHEN {predicate} THEN s.{val_col} ELSE NULL END)"

            select_exprs.append(f"{expr} AS `{col_name}`")
            continue

        # 2. Dimension Columns
        expr = "NULL"
        
        _dim_cols = manifest.get("dimension_column_names") or []
        if _dim_cols and col_name == _dim_cols[0] and manifest.get("include_instance_name"):
            expr = "s.source_instance_name"
        elif ou_map_table and col_name in ou_cols:
            expr = f"ou_map.`{col_name}`"
        elif col_name == manifest.get("fallback_org_unit_column"):
            expr = "coalesce(s.ou_name, s.ou)"
        elif pe_map_table and col_name in pe_cols:
            expr = f"pe_map.`{col_name}`"
        elif col_name == manifest.get("ou_level_column_name"):
            # Derive ou_level as the count of non-null ancestor hierarchy columns.
            # DHIS2 analytics metadata rarely includes 'level' in metaData.items,
            # so s.ou_level is usually 0 (ClickHouse UInt16 default).
            # Non-null hierarchy entries correspond to the ancestors that were
            # populated, so counting them gives the correct level depth.
            if ou_map_table and ou_cols:
                level_exprs = [f"isNotNull(ou_map.`{c}`)" for c in sorted(ou_cols)]
                expr = f"({' + '.join(level_exprs)})" if level_exprs else "s.ou_level"
            else:
                expr = "s.ou_level"
        elif col_name == manifest.get("coc_uid_column_name"):
            expr = "s.co_uid"
        elif col_name == manifest.get("coc_name_column_name"):
            expr = "s.co_name"
        elif isinstance(col.get("extra"), dict) and col["extra"].get("dhis2_manifest_build_version"):
            # Sentinel column: stores the manifest build version as a constant.
            # Its column *name* encodes the version so _serving_table_needs_rebuild
            # detects stale serving tables after a manifest version bump.
            # Use toUInt8() to avoid ClickHouse treating a bare integer in GROUP BY
            # as a positional column index.
            ver = int(col["extra"]["dhis2_manifest_build_version"])
            expr = f"toUInt8({ver})"

        select_exprs.append(f"{expr} AS `{col_name}`")
        group_by_exprs.append(expr)

    joins = []
    if ou_map_table:
        joins.append(f"LEFT JOIN {ou_map_table} ou_map ON s.source_instance_id = ou_map.source_instance_id AND s.ou = ou_map.org_unit_id")
    if pe_map_table:
        joins.append(f"LEFT JOIN {pe_map_table} pe_map ON s.pe = pe_map.pe")

    where_parts = []
    if refresh_scope:
        scope_list = ", ".join(f"'{p}'" for p in refresh_scope)
        where_parts.append(f"s.pe IN ({scope_list})")

    where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    sql = f"""
        SELECT
            {', '.join(select_exprs)}
        FROM {staging_ref} s
        {' '.join(joins)}
        {where_clause}
        GROUP BY
            {', '.join(group_by_exprs)}
    """
    return sql


def _prune_empty_columns(engine: Any, table_ref: str, candidates: set[str]) -> set[str]:
    if not candidates or not table_ref:
        return set()

    sorted_candidates = sorted(list(candidates))
    exprs = [f"count(if(length(trim(ifNull(`{c}`, ''))) > 0, 1, NULL))" for c in sorted_candidates]

    try:
        sql = f"SELECT {', '.join(exprs)} FROM {table_ref}"
        result = engine._qry(sql)
        if not result.result_rows:
            return set()

        counts = result.result_rows[0]
        keep = set()
        for col, count in zip(sorted_candidates, counts):
            if count > 0:
                keep.add(col)
        return keep
    except Exception:
        logger.exception("Failed to prune empty columns for %s", table_ref)
        return candidates  # Fallback: keep all
