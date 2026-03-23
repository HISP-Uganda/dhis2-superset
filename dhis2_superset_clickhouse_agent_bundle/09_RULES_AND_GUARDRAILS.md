# Rules and Guardrails

## Architectural rules
- PostgreSQL is metadata-only.
- ClickHouse is the analytical engine.
- Superset queries serving marts only.
- Python is orchestration-only for heavy serving logic.

## Data rules
- No large analytical row bodies in metadata-side storage hot path.
- No repeated full serving rebuilds unless explicitly requested.
- No per-instance serving rebuild loops in the default path.
- No row-by-row analytical transformations in Python.

## Safety rules
- Never expose partially refreshed serving data.
- Never break idempotency.
- Never sacrifice correctness for speed.
- Never leave fallback behavior undocumented.

## Operational rules
- Configuration must clearly enforce ClickHouse as the active engine.
- Production must use worker-based async execution.
- Cache configuration must be explicit.
- Metrics and logs must be added for new critical paths.

## Documentation rules
- Every serving mart must be documented.
- Every refresh strategy must be documented.
- Migration and rollback must be documented.
