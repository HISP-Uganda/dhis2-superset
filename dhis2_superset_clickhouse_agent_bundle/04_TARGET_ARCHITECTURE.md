# Target Architecture

## Required target flow

DHIS2 API -> ClickHouse raw landing -> ClickHouse normalized staging -> ClickHouse serving marts -> Superset datasets -> dashboards

## Role of each system

### DHIS2
Source of data and metadata.

### ClickHouse
Primary analytical engine for:
- raw landing
- normalized staging
- serving marts
- map serving datasets
- public dashboard serving datasets

### PostgreSQL
Superset metadata only:
- users
- roles
- dashboards
- charts
- saved queries
- internal metadata

### Superset
Visualization and semantic layer only. Must query ClickHouse serving marts directly.

## Architectural principles

- No heavy serving build logic in Python.
- No analytical hot-path dependence on PostgreSQL.
- No direct dashboard dependence on raw staging.
- Serving refresh must be incremental, safe, and atomic from the user perspective.
- Dashboard tables must be designed around real filter patterns.
