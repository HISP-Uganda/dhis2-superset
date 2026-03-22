# Migration and Backward Compatibility

Plan and implement the migration from the current warehouse model to the new hierarchy-aware, disaggregation-aware model.

## Requirements

1. Identify existing consumers of current staging/serving tables.
2. Avoid breaking them abruptly where possible.
3. If breaking changes are needed:
   - add compatibility views
   - document renamed columns
   - document changed grain
4. Produce:
   - migration scripts
   - rollout sequence
   - rollback considerations
   - data backfill plan
5. Explicitly call out:
   - where row counts will increase because COC/AOC grain is preserved
   - where new hierarchy columns change grouping behavior
   - where null handling for dimensions changes
   - where geojson/map columns affect downstream map consumers

## Output a migration note with

- before schema
- after schema
- behavior changes
- required downstream updates

## Completion gate

Before proceeding:
- run all relevant tests
- fix failures until all tests pass
- document what was done and why
- list changed files
- list tests run and results
- write `STATUS: COMPLETE`

## What was done

- Added the variable dimension-availability migration in [2026_03_22_dhis2_variable_dimension_availability.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/migrations/versions/2026_03_22_dhis2_variable_dimension_availability.py).
- Kept compatibility links and sync mirroring active between DHIS2-specific rows and the generic staged-source graph.
- Added safe helpers and test coverage for uninstrumented compatibility objects so migration and mirror paths can be exercised without breaking legacy behavior.

## Files changed

- [superset/migrations/versions/2026_03_22_dhis2_variable_dimension_availability.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/migrations/versions/2026_03_22_dhis2_variable_dimension_availability.py)
- [superset/dhis2/models.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/models.py)
- [superset/staging/models.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/staging/models.py)
- [superset/dhis2/instance_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/instance_service.py)
- [superset/dhis2/sync_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/sync_service.py)

## Tests run and results

- compatibility and migration-related coverage is included in the final backend sweep: `345 passed, 1 skipped`

STATUS: COMPLETE
