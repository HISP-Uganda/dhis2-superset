# EXECUTION-CONTRACT.md
## Formal Delivery Contract
### Project: Superset Local Staging Engines with DuckDB and ClickHouse

## 1. Binding scope

The implementation agent MUST deliver:
- DuckDB staging integration
- ClickHouse staging integration
- platform-wide single-active-engine selection
- dataset creation behavior that uses the active engine
- admin settings for engine selection and retention policies
- non-regressive integration
- migrations, tests, and documentation

## 2. Non-negotiable rules

1. Working features MUST NOT be broken
2. Only one staging engine may be active platform-wide at a time
3. The active platform-wide staging engine MUST be used during staged dataset creation and data loading
4. DuckDB MUST be embedded/in-process where possible
5. ClickHouse MUST be integrated cleanly as a supported staging engine even though it is not treated like DuckDB-style in-process embedding
6. Engine switching MUST be explicit and safe
7. Retention policies MUST be optional, configurable, and observable
8. No milestone may progress with failing tests
9. The agent MUST NOT ask for approval on already-defined requirements
10. The result MUST be production-grade

## 3. Required deliverables

- engine abstraction layer
- platform settings model and UI
- DuckDB engine adapter
- ClickHouse engine adapter
- dataset-loading integration with active engine
- retention policy model and cleanup jobs
- tests
- docs and runbooks

## 4. Failure conditions

The implementation is non-compliant if:
- engine selection is ambiguous
- dataset creation ignores the active engine
- working features regress
- retention can silently destroy current valid data without policy control
- tests are skipped or left failing
