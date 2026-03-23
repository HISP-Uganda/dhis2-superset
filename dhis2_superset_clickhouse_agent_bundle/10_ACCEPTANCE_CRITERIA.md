# Acceptance Criteria

The implementation is accepted only if all of the following are true.

## Engine and storage
- ClickHouse is active for staging and serving.
- PostgreSQL is used only for Superset metadata.

## Serving pipeline
- No full serving-table materialization remains in Python hot path.
- Serving refresh is native to ClickHouse.
- Incremental refresh is implemented for changed scope.
- Repeated serving rebuilds in a single sync cycle are removed from the normal path.

## Data correctness
- Syncs are idempotent.
- Retries are safe.
- Failures do not expose partial serving data.
- Validation and reconciliation exist.

## Dashboards
- Production Superset datasets point to serving marts or thin views.
- Charts, maps, and dashboards do not depend on raw staging tables for core workloads.
- Public dashboard-serving path is documented and optimized.

## Operations
- Redis cache is configured or clearly validated.
- Celery workers are configured or clearly validated.
- Active engine configuration is enforced and documented.
- Observability is present.

## Quality
- Tests are added or updated.
- Migration notes are added.
- Architecture documentation is added.
