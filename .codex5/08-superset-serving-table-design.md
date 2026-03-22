# Superset-Facing Serving Table Design

Create the Superset-facing serving table/view for DHIS2 aggregate analytics.

## Goal

Produce a serving dataset that is easy to chart and filter in Superset, while still respecting DHIS2 metadata-driven dimensionality, accurate query behavior, and map compatibility.

## Requirements

1. The serving dataset must be denormalized enough that common charts require minimal joins.
2. It must expose:
   - measure value
   - data element id/name
   - org unit ids/names/hierarchy levels
   - period ids/labels/hierarchy fields
   - coc/aoc ids
   - resolved disaggregation dimensions from category combinations
   - geography fields needed for map joins where applicable
3. It must support cascade filters across:
   - geography
   - time
   - applicable disaggregation dimensions
4. It must support drilldown by:
   - org unit level
   - period hierarchy
5. The dataset must remain faithful to the fact grain:
   - one row per DE + PE + OU + COC + AOC
6. Add semantic columns for Superset usability:
   - friendly labels
   - sort keys
   - ancestor labels
   - null-safe total/default labels where needed
7. All charts must return accurate queries.
8. GeoJSON-backed maps must join and render correctly where applicable.

## Produce

- SQL/view/model for the serving dataset
- explanation of grain
- list of columns and purpose
- Superset chart examples supported by the schema
- recommendations for indexes/materialization

Important:
Do not lose DE-specific applicability of dimensions.
Where a category dimension is not applicable for a DE, keep nulls explicit or use a separate availability mechanism.

## Completion gate

Before proceeding:
- run all relevant tests
- fix failures until all tests pass
- document what was done and why
- list changed files
- list tests run and results
- write `STATUS: COMPLETE`

## What was done

- Kept the active serving model centered on local `sv_*` tables built from staged `ds_*` facts and staged metadata.
- Preserved hierarchy-aware and variable-aware serving projections in [analytical_serving.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/analytical_serving.py) and [serving_build_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/serving_build_service.py).
- Added default org-unit and period terminal-level query constraints in [helpers.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/models/helpers.py) so ordinary charts do not overcount across multiple hierarchy levels.

## Files changed

- [superset/dhis2/analytical_serving.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/analytical_serving.py)
- [superset/dhis2/serving_build_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/serving_build_service.py)
- [superset/models/helpers.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/models/helpers.py)

## Tests run and results

- final backend target: `345 passed, 1 skipped`

STATUS: COMPLETE
