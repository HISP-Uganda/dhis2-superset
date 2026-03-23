# Complete Implementation Plan

## Phase 1. Audit and discovery
- Identify every current code path that materializes serving rows in Python.
- Identify all serving rebuild triggers.
- Identify every ClickHouse mutation-based refresh path.
- Identify all duplicate writes into metadata-side storage.
- Identify current Superset dataset dependencies.
- Identify current map query paths.

## Phase 2. Schema design
Create explicit ClickHouse layers:

### Raw landing tables
Requirements:
- append-oriented
- typed columns
- load metadata columns
- replay-safe

### Normalized staging tables
Requirements:
- MergeTree family
- practical partitioning
- ORDER BY aligned with actual filters
- typed dimensions and metrics
- minimal nullability

### Serving marts
Requirements:
- physically materialized
- narrow
- dashboard-specific
- pre-aggregated where practical
- optimized for Superset filters and group-bys

## Phase 3. Native ClickHouse transformation design
- Replace Python serving materialization with ClickHouse SQL.
- Use incremental transforms where feasible.
- Use partition-aware or version-aware refresh strategies.
- Ensure promotion to active serving state is safe.

## Phase 4. Orchestration refactor
- Keep Python orchestration only.
- Track sync job lifecycle.
- Compute changed scope.
- Trigger ClickHouse-native refresh jobs.
- Record row counts and validation results.

## Phase 5. Superset dataset refactor
- Map dashboards to serving marts.
- Remove heavy runtime SQL where practical.
- Create dedicated datasets for maps, KPIs, trends, and public dashboards.

## Phase 6. Runtime and config hardening
- Enforce ClickHouse as active analytical engine.
- Ensure Redis-backed caching is configured.
- Ensure Celery workers are used.
- Remove heavy production reliance on thread fallback.

## Phase 7. Testing and benchmarking
- Add correctness tests.
- Add sync retry and failure tests.
- Add performance smoke tests.
- Validate cold and warm dashboard behavior.

## Phase 8. Migration and release
- Add migration path from old serving logic.
- Add rollback strategy.
- Document deployment and operations.
