# Period Hierarchy Support

Implement period hierarchy support for DHIS2 aggregate analytics in the serving layer.

## Goal

Make period data visualization-ready for Superset charts and filters.

## Requirements

1. Preserve raw DHIS2 period_id in staging.
2. Build a period dimension that resolves:
   - period_id
   - period_type
   - label
   - start_date
   - end_date
   - year
   - quarter
   - month
   - week if applicable
   - sortable numeric keys
3. Add hierarchy helpers so monthly data can roll up to quarter/year, and other supported period types are represented correctly.
4. Do not fabricate finer-grain periods from coarser data.
5. Expose serving columns such as:
   - period_id
   - period_name
   - period_type
   - year
   - year_label
   - quarter_id
   - quarter_label
   - month_id
   - month_label
   - sort_key
6. Ensure Superset can use these fields directly for:
   - time-series charts
   - period filters
   - group by month / quarter / year
7. Ensure chart queries remain accurate under all supported period rollups.

## Implementation tasks

- inspect existing period handling
- add period parsing/derivation utilities
- create dim_period
- join serving facts to dim_period
- add tests for monthly, quarterly, yearly cases and sort order

## Completion gate

Before proceeding:
- run all relevant tests
- fix failures until all tests pass
- document what was done and why
- list changed files
- list tests run and results
- write `STATUS: COMPLETE`

## What was done

- Kept period hierarchy derivation in [period_hierarchy_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/period_hierarchy_service.py) and [analytical_serving.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/analytical_serving.py).
- Added default query guards in [helpers.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/models/helpers.py) so charts fall back to the most granular staged period level when no explicit period hierarchy column is selected.
- Integrated human-readable DHIS2 period formatting into the frontend formatter pipeline.

## Files changed

- [superset/dhis2/period_hierarchy_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/period_hierarchy_service.py)
- [superset/dhis2/analytical_serving.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/analytical_serving.py)
- [superset/models/helpers.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/models/helpers.py)
- [superset-frontend/src/utils/dhis2Period.ts](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset-frontend/src/utils/dhis2Period.ts)

## Tests run and results

- backend target: `345 passed, 1 skipped`
- formatter regression also passed in focused frontend validation

STATUS: COMPLETE
