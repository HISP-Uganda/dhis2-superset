# Configuration and Deployment Requirements

## Required configuration guarantees
- ClickHouse must be explicitly configured as active analytical engine.
- Unsafe defaults that fall back away from ClickHouse must be removed or loudly validated.
- PostgreSQL must remain metadata-only.

## Required Superset runtime support
- Redis-backed cache
- Celery workers
- result backend for async workloads where applicable
- production-safe web worker configuration

## Required environment documentation
- ClickHouse connection variables
- PostgreSQL metadata variables
- Redis variables
- Celery variables
- engine selection variables
- sync tuning variables
- map-serving related variables if any

## Deployment requirements
- schema creation or migration steps must be documented
- zero-downtime or controlled-downtime path must be documented
- rollback process must be documented
- verification steps after deployment must be documented
