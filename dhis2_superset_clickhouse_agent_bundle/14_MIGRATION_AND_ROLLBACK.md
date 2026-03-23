# Migration and Rollback Plan

## Migration goals
- Move from Python-driven serving materialization to ClickHouse-native serving refresh.
- Preserve existing data and dashboard functionality.
- Allow staged rollout and verification.

## Required migration steps
1. Introduce new ClickHouse schemas and serving marts.
2. Backfill serving marts from staging.
3. Validate row counts and sample query parity.
4. Repoint Superset datasets to new marts or views.
5. Disable old serving rebuild hot path.
6. Monitor sync and dashboard behavior.
7. Remove legacy path after successful validation window.

## Rollback requirements
- Ability to revert dataset bindings if required.
- Ability to disable new refresh path via config or operational control.
- Ability to preserve old-good serving data during rollback.
- Rollback procedure must be documented in plain steps.
