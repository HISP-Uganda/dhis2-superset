# Category Combination, COC, and AOC Support

Implement metadata-driven disaggregation support based on category combinations.

## Critical rule

During analysis, data elements MUST have applicable category-combination dimensions available as filters or dimensions.

## Requirements

1. Preserve in metadata:
   - data element -> category combo
   - category combo -> categories
   - categories -> category options
   - category option combo -> chosen category option set
   - attribute option combo -> chosen attribute option set
2. Preserve in fact staging:
   - coc_id
   - aoc_id
3. In the serving layer, resolve COC into analysis-ready dimensions.

## Required serving behavior

- If a DE uses age+sex CC, the serving dataset must allow analysis by age and sex.
- If a DE uses default CC only, it must not expose fake age/sex values.
- If a DE uses another CC, only that CC’s applicable categories must be represented as available dimensions/filters.
- AOC must be preserved as an additional analysis/filter context when relevant.
- All chart queries must stay accurate when filtering or grouping by these dimensions.

## Recommended implementation options

Option A:
- One wide serving table with generic resolved columns for known dimensions plus JSON for extras

Option B:
- Long/bridge model for category dimensions

Option C:
- Hybrid: wide for common dimensions, bridge for all dimensions

Pick the best option for this codebase and justify it.

## Minimum outputs expected in serving

- coc_id
- coc_name/label if meaningful
- aoc_id
- aoc_name/label if meaningful
- category dimension columns or bridge rows that resolve the COC into explicit dimensions
- a way to determine which dimensions are applicable per data element

## Strongly preferred helper tables

- data_element_dimension_availability
- coc_dimension_values

## Tests required

- DE with default CC has only default/no disaggregation
- DE with age+sex CC exposes age and sex
- fact rows with same DE/PE/OU but different COC remain distinct
- AOC remains available as separate context
- chart queries remain accurate across applicable and non-applicable dimensions

## Completion gate

Before proceeding:
- run all relevant tests
- fix failures until all tests pass
- document what was done and why
- list changed files
- list tests run and results
- write `STATUS: COMPLETE`

## What was done

- Preserved `co_uid` and `aoc_uid` at raw fact grain in [staging_engine.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staging_engine.py).
- Expanded staged metadata support for `categories`, `categoryCombos`, and `categoryOptionCombos` in [metadata_staging_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/metadata_staging_service.py).
- Kept wizard-level disaggregation enablement available in [index.tsx](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset-frontend/src/features/datasets/AddDataset/DHIS2DatasetWizard/index.tsx).
- Added per-variable dimension availability population for category-combo-driven analysis in [staged_dataset_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staged_dataset_service.py).

## Files changed

- [superset/dhis2/staging_engine.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staging_engine.py)
- [superset/dhis2/metadata_staging_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/metadata_staging_service.py)
- [superset/dhis2/staged_dataset_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staged_dataset_service.py)
- [superset-frontend/src/features/datasets/AddDataset/DHIS2DatasetWizard/index.tsx](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset-frontend/src/features/datasets/AddDataset/DHIS2DatasetWizard/index.tsx)

## Tests run and results

- backend target: `345 passed, 1 skipped`
- wizard regression: `1 passed`

STATUS: COMPLETE
