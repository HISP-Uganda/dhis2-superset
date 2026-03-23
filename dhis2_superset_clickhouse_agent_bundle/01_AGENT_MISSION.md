# Agent Mission

## Mission statement

Refactor the `dhis2-superset` repository so that DHIS2 synchronization is correct, resilient, and auditable while ClickHouse becomes the native high-performance engine for both staging and serving, and Superset dashboards, charts, and maps load as fast as possible.

## The mission must achieve all of the following

- Remove Python from the serving-table build hot path.
- Preserve all synchronization guarantees.
- Keep PostgreSQL only for Superset metadata.
- Move heavy transformations and materialization into ClickHouse.
- Ensure serving refreshes are incremental and safe.
- Ensure dashboards query optimized serving marts.
- Ensure public and authenticated dashboards are fast.
- Improve observability, testing, and operational safety.

## Success definition

The implementation is successful only if:

- ClickHouse is used as the true analytical engine.
- Superset does not depend on Python-driven serving materialization.
- Staging and serving are clearly separated within ClickHouse.
- Charts, maps, and dashboards consistently query serving marts.
- Synchronization remains correct under retries, partial failures, and incremental updates.
