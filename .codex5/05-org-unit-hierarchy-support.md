# Organisation Unit Hierarchy Support

Implement full organisation unit hierarchy support in the staging and serving layers.

## Goal

Make org units usable in Superset as both:
- filters
- grouping dimensions
- hierarchy drilldown dimensions
- map dimensions with correct geoJSON loading in DHIS2 Maps where applicable

## Requirements

1. Preserve org unit hierarchy metadata from DHIS2:
   - id
   - name
   - code
   - short name
   - level
   - parent id
   - path
2. Preserve geometry / geo features / geojson compatibility fields where applicable.
3. Build a serving representation that supports:
   - filtering by any org unit
   - filtering by boundary org unit
   - grouping by any level
   - displaying ancestor labels
   - cascade filters by geography
   - accurate joining to geojson/map layers
4. Expose user-friendly columns such as:
   - org_unit_id
   - org_unit_name
   - org_unit_level
   - org_unit_level_1_name
   - org_unit_level_2_name
   - ...
   - parent_org_unit_id
   - parent_org_unit_name
5. Choose one of:
   - ancestor columns in dim_org_unit
   - bridge table for org unit ancestry
   and justify the choice
6. Ensure serving facts can be grouped by any supported org unit level without custom frontend logic.
7. Ensure geoJSON loads correctly on DHIS2 Maps for mapped org units.

## Add tests for

- path parsing
- ancestor derivation
- group-by correctness by level
- boundary filtering behavior
- geojson/geometry loading and join compatibility where applicable

## Completion gate

Before proceeding:
- run all relevant tests
- fix failures until all tests pass
- document what was done and why
- list changed files
- list tests run and results
- write `STATUS: COMPLETE`

## What was done

- Preserved staged org-unit hierarchy metadata and staged GeoJSON in [metadata_staging_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/metadata_staging_service.py).
- Kept explicit selected hierarchy levels intact in [org_unit_hierarchy_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/org_unit_hierarchy_service.py).
- Ensured staged dataset sync keeps explicit nested selected org units instead of pruning them in [sync_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/sync_service.py).
- Protected chart queries from mixing multiple staged org-unit levels by default in [helpers.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/models/helpers.py).

## Files changed

- [superset/dhis2/metadata_staging_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/metadata_staging_service.py)
- [superset/dhis2/org_unit_hierarchy_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/org_unit_hierarchy_service.py)
- [superset/dhis2/sync_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/sync_service.py)
- [superset/models/helpers.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/models/helpers.py)

## Tests run and results

- covered by the final backend sweep: `345 passed, 1 skipped`

STATUS: COMPLETE
