# Context and Goals

## Repository under change

- `https://github.com/HISP-Uganda/dhis2-superset` or this local git repo (`./`)

## Context

The current system integrates DHIS2 with Superset and uses ClickHouse for local staging. Based on the reviewed code paths, the current implementation likely performs too much work in Python during serving-table builds and may also repeat expensive rebuild operations and use ClickHouse-unfriendly mutation patterns.

## High-level goals

1. Keep DHIS2 synchronization correct.
2. Make ClickHouse fast for ingestion, transformation, and query serving.
3. Make Superset fast for charts, maps, and dashboards.
4. Ensure public dashboards are also optimized.
5. Reduce write amplification and redundant data persistence.
6. Improve operational reliability and visibility.

## Non-goals

- Rebuilding the entire product from scratch.
- Replacing Superset.
- Using PostgreSQL as an analytics warehouse.
- Leaving critical performance work inside dashboard SQL.
