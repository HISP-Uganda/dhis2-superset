# Status Report: DHIS2-to-Superset ClickHouse Pipeline Refactor

## Current phase
**Phase 8: Cross-Source Isolation Hardening** (Complete)

## What was completed
- **ClickHouse-Native Serving Build**: Implemented `clickhouse_build_service.py` using `INSERT INTO ... SELECT` logic, moving all heavy analytical transformations into ClickHouse.
- **Incremental Refresh**: Added support for `REPLACE PARTITION` in ClickHouse, allowing sub-second updates for specific time periods during sync.
- **Specialized Analytical Marts**:
    - **KPI Mart**: Automatic creation of period-aggregated tables for high-level metrics.
    - **Map Marts**: Automatic creation of level-specific aggregated tables (L1, L2, L3...) for fast geospatial visualization.
- **Auto-Registration**: Enhanced Superset dataset service to automatically detect and register these marts as virtual datasets.
- **Architectural Cleanup**: Removed `record_dhis2_stage_rows` call for ClickHouse engines, eliminating redundant write amplification and metadata-side storage bloat.
- **Observability**: Added detailed diagnostics for row counts, build modes, and pruned columns.
- **Documentation**: Created `CLICKHOUSE_ARCHITECTURE.md` and a performance benchmarking script.

## What remains
- **End-to-End Integration Testing**: Verify the full loop with a live ClickHouse instance (unit tests for SQL generation are complete).
- **Public Dashboard Marts**: Formalize a "Public" view or mart if specifically required by downstream consumers (current wide marts are accessible).
- **Refinement of Partition Keys**: Currently uses year-based partitioning for incremental logic; may need to adapt to custom dataset partitioning schemes.

## Bug fixes applied (2026-03-23)
- **`_parse_table_ref` backtick stripping**: Fixed malformed mart table names like `` `sv_1_...`_kpi `` that resulted from ClickHouse backtick-quoted serving refs. Function now strips both `"` and `` ` `` delimiters.
- **Dataset registration fallback bug**: Removed `all_candidates[0]` fallback in `register_serving_table_as_superset_dataset` that was overwriting the main serving dataset's SQL with the last registered mart's table ref on every serving build.
- **`json` import missing** in `clickhouse_build_service.py`: Added `import json` to fix `NameError` in `_build_specialized_marts`.
- **`int(uuid.uuid4())` TypeError** in `_execute_incremental_build`: Fixed to `uuid.uuid4().int % 10**9`.
- **`engine._serving_table_name` → `engine.get_serving_table_name`** in `_execute_incremental_build`.
- **Analytics timeout increased**: `_REQUEST_TIMEOUT` raised from `(30, 120)` to `(30, 300)` to match dataValueSets extractor and accommodate slow test servers (hmis-tests.health.go.ug).
- **Retry with sleep for transient timeouts**: Added Strategy 0 (sleep 5s, retry once) for `requests.Timeout`/`ConnectionError` before escalating to expensive page-size splitting.
- **DB repair**: Fixed corrupt SqlaTable SQL (`_map_l5` suffix), re-linked charts (datasource_id=8→1), confirmed embedded dashboard UUID.

## Current risks
- **Schema Evolution**: Adding new Data Elements requires a full rebuild of the serving table (though this is now fast).
- **Resource Contention**: Heavy concurrent builds on a single ClickHouse node could impact dashboard query latency if not managed by ClickHouse resource groups.

## Validation results so far
- **Unit Tests**: `tests/dhis2/clickhouse_build_service_test.py` passes (SQL generation for both full and incremental builds is correct).
- **Playwright verified**: Charts return HTTP 200, `available_charts` populated, public portal functional.

## Bug fixes applied (2026-03-23, session 2)
- **`ou_level` None serialization error**: Removed `ou_level` from `insert_rows` explicit INSERT in `clickhouse_engine.py`. DHIS2 analytics API never populates `level` in metadata, so `ou_level` was always `None`. Omitting it lets ClickHouse fill the `UInt16` column with its implicit default (0), eliminating the "Error serializing column ou_level into data type UInt16" TypeError.
- **Cross-source metric collision (data bleed)**: Fixed `_generate_serving_sql` in `clickhouse_build_service.py` — CASE WHEN predicates now include `s.source_instance_id = {instance_id}` for each variable column, preventing rows from different DHIS2 instances with the same `dx_uid` from aggregating into the same column.
- **`instance_id` added to variable column specs**: `analytical_serving.py`'s `_make_variable_column` now stores `instance_id` in the column dict. This enables the SQL generator to emit source-scoped predicates.
- **`variable_lookup` key upgraded**: Changed from `(dx_uid, coc_uid)` to `(instance_id, dx_uid, coc_uid)`. `materialize_serving_rows` (non-ClickHouse path) updated with same scoping plus legacy fallback.
- **`_load_distinct_cocs_for_variable` scoped by instance**: Now accepts `instance_id` param and adds `source_instance_id` filter to avoid discovering COCs from the wrong instance.
- **Manifest build version sentinel**: Added `_MANIFEST_BUILD_VERSION = 2` to `analytical_serving.py`. A `_manifest_build_v2` column is included in every manifest. When `_serving_table_needs_rebuild` compares physical column names to expected names, the absence of this column (in tables built before the fix) forces a rebuild automatically.
- **Tests added**: `test_generate_serving_sql_cross_instance_isolation`, `test_generate_serving_sql_manifest_build_version_sentinel` in `clickhouse_build_service_test.py`.

## Bug fixes applied (2026-03-24)
- **KPI mart not rebuilt after ClickHouse wipe**: `_serving_table_needs_rebuild` only checked the main serving table — if it already existed with correct columns, no rebuild was triggered and the KPI mart was never created. Fixed by adding `_specialized_marts_need_rebuild()` which duck-types `kpi_mart_exists` on the engine. When the KPI mart is absent and the manifest has indicator columns, a full rebuild is forced.
- **`_build_specialized_marts` IndexError**: `manifest.get("dimension_column_names", [])[0]` raised `IndexError` when the list was empty (datasets with no dimension columns). Fixed with safe `_dim_cols[0]` guard.
- **Fault-tolerant mart building**: Each mart (KPI, per-level map) is now wrapped in its own `try/except`. A failed mart is logged and skipped; it never aborts the main serving build. `ServingBuildResult.diagnostics["built_marts"]` lists which marts were successfully created.
- **`named_table_exists_in_serving` / `kpi_mart_exists`**: Added to `ClickHouseLocalStagingEngine` for programmatic mart existence checks.
- **Phase 3 — Immediate sync history visibility**: `sync_staged_dataset` now writes `current_step="initializing — {dataset.name}"` immediately upon entry (before any config loading), then `current_step="preparing — N instance(s), M variable(s)"` once the plan is resolved. Operators see the dataset name within milliseconds of the sync starting.

## Tests added (2026-03-24)
- `test_specialized_marts_need_rebuild_returns_false_for_non_clickhouse_engine`
- `test_specialized_marts_need_rebuild_returns_false_when_no_indicators`
- `test_specialized_marts_need_rebuild_returns_true_when_kpi_missing`
- `test_specialized_marts_need_rebuild_returns_false_when_kpi_exists`
- `test_specialized_marts_need_rebuild_swallows_exception`
- `test_ensure_serving_table_triggers_rebuild_when_kpi_mart_missing`

## Blocking issues
None.

## Next action
Run a live full sync against a populated DHIS2 instance to confirm ClickHouse serving tables receive data end-to-end with correct per-instance aggregation, and verify the KPI mart is now rebuilt automatically after a ClickHouse data wipe.
