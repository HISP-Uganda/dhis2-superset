# Mandatory Requirements

## 1. ClickHouse must be the analytical engine
- ClickHouse must store raw landing data.
- ClickHouse must store normalized staging data.
- ClickHouse must store serving marts.
- PostgreSQL must not be used as analytical staging or serving.

## 2. Python must be removed from serving hot path
Python may orchestrate jobs only.
Python must not:
- fetch all staging rows into memory to build serving data
- compute large serving tables row-by-row
- repeatedly recreate serving tables from in-memory transformed data

## 3. Serving refresh must be incremental
The system must refresh only affected scope where feasible:
- changed periods
- changed org units
- changed indicators or data elements
- changed source instances
- changed dataset slices

## 4. Refresh must be safe and atomic
Users must never see partially refreshed serving data.
Allowed patterns include:
- table swap
- partition replacement
- versioned serving views
- serving promotion from build tables

## 5. ClickHouse-unfriendly delete mutation patterns must be removed from normal sync flows
Frequent row-level delete mutation must not remain the main refresh mechanism.

## 6. Serving marts must be dashboard-specific
At minimum, implement dedicated marts for:
- KPI summaries
- trend charts
- org unit breakdowns
- period summaries
- map data
- category breakdowns
- public dashboards

## 7. Map performance must be explicitly addressed
Map-serving structures must include pre-resolved geographic fields and precomputed metrics at the correct geographic grain.

## 8. Synchronization correctness must be preserved
The implementation must support:
- idempotent sync behavior
- deterministic refresh outcomes
- retry safety
- partial failure handling
- reconciliation checks
- row count validation

## 9. Superset must query serving marts only
Production dashboards must not depend on:
- raw staging tables
- heavy virtual datasets
- runtime transformations for core workloads

## 10. Production readiness must be included
Must validate and document:
- Redis-backed caching
- Celery workers
- active ClickHouse engine enforcement
- no heavy thread fallback in production

## 11. Testing and documentation are mandatory
The implementation must include:
- tests
- migration notes
- operational guidance
- architecture documentation
