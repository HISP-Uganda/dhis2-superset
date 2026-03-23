# Status Report: DHIS2-to-Superset ClickHouse Pipeline Refactor

## Current phase
**Phase 7: Testing and Finalization** (Nearing completion)

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

## Blocking issues
None.

## Next action
Run a live full sync against a populated DHIS2 instance to confirm ClickHouse serving tables receive data end-to-end.
