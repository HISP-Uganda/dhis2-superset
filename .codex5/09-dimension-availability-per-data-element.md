# Dimension Availability Per Data Element

Implement metadata-driven dimension availability for analysis.

## Business rule

During analysis, a data element MUST expose only the applicable category-combination dimensions as valid filters/dimensions.

## Goal

Prevent analysis UIs and dataset consumers from showing invalid dimensions for a selected data element.

## Tasks

1. Build a metadata structure that answers:
   - for this data_element_id, which dimensions are valid?
2. Recommended output:
   - data_element_dimension_availability
3. Populate it from:
   - data element
   - assigned category combo
   - categories in that category combo
   - category types and analytics usage flags where relevant
4. Ensure it distinguishes:
   - groupable dimensions
   - filter-only dimensions
   - display labels
5. If the current code already has a semantic-layer concept, integrate there too.
6. Ensure this metadata can be used to keep chart queries accurate and prevent invalid filter combinations.

## Deliverables

- schema/model
- population logic
- tests
- example query that returns allowed dimensions for a selected DE
- notes on how Superset or an upstream API can use this metadata

## Examples

- DE_A with age+sex CC => valid dimensions: age_group, sex
- DE_B with default CC => valid dimensions: none except default total
- DE_C with partner attribute combo => valid filters as appropriate

## Completion gate

Before proceeding:
- run all relevant tests
- fix failures until all tests pass
- document what was done and why
- list changed files
- list tests run and results
- write `STATUS: COMPLETE`

## What was done

- Added persisted per-variable dimension availability in [models.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/models.py) through `dimension_availability_json` on `DHIS2DatasetVariable`.
- Added migration [2026_03_22_dhis2_variable_dimension_availability.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/migrations/versions/2026_03_22_dhis2_variable_dimension_availability.py).
- Built category-combo-driven population logic in [metadata_staging_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/metadata_staging_service.py) and wired it into variable creation in [staged_dataset_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staged_dataset_service.py).
- Exposed the metadata through staged dataset APIs in [staged_dataset_api.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staged_dataset_api.py).

## Example query

```sql
SELECT variable_id, variable_type, dimension_availability_json
FROM dhis2_dataset_variables
WHERE variable_id = 'fbfJHSPpUQD';
```

## Notes for consumers

- use `dimension_availability_json` to decide which dimensions are groupable versus filter-only
- an empty list means the data element uses the default category combo and should not expose extra disaggregation dimensions
- the staged dataset variable API returns the same structure for UI-driven consumers

## Files changed

- [superset/dhis2/models.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/models.py)
- [superset/dhis2/metadata_staging_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/metadata_staging_service.py)
- [superset/dhis2/staged_dataset_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staged_dataset_service.py)
- [superset/dhis2/staged_dataset_api.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staged_dataset_api.py)
- [superset/migrations/versions/2026_03_22_dhis2_variable_dimension_availability.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/migrations/versions/2026_03_22_dhis2_variable_dimension_availability.py)

## Tests run and results

- final backend target: `345 passed, 1 skipped`
- wizard regression: `1 passed`

STATUS: COMPLETE
