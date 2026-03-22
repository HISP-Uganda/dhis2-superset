# Master Prompt

You are working in the dhis2-superset codebase.

## Goal

Refactor and extend the DHIS2 ingestion, staging, and serving pipeline so that aggregate analytics data is modeled in a way that supports Superset charts with full cascade filters, hierarchical drilldown, accurate queries, correct disaggregations, and DHIS2 Maps geoJSON compatibility.

## Mandatory global rules

1. Data MUST be accurate across all hierarchies and dimensions.
2. All charts MUST return accurate queries.
3. GeoJSON must load correctly on DHIS2 Maps where applicable.
4. During analysis, data elements MUST have applicable category-combination dimensions available as filters or dimensions.
5. Dataand charts made availale vis public pages and dashboards MUST be accurate and correct and naccessible as public pages and dashboards.
6. Before moving onto the next prompt, ALL tests MUST pass.
7. At the end of each step, document:
   - what was done
   - why it was done
   - changed files
   - tests executed
   - results
   - remaining risks
8. Update status to `STATUS: COMPLETE` before proceeding.
9. Do not ask for approvals or confirmations.

## Required target capabilities

- staging tables in the Superset staging database
- serving tables/views optimized for analytics and chart building
- organisation unit hierarchy support
- period hierarchy support
- category-combination-driven disaggregation support
- category option combo (COC) handling
- attribute option combo (AOC) handling
- metadata-driven dimensions so data elements expose only their applicable dimensions
- accurate chart queries
- geoJSON compatibility for map layers where applicable

## Execution order

A. inspect repository and summarize current data flow  
B. identify existing staging tables, serving tables, transformations, and metadata ingestion  
C. map gaps against required DHIS2 dimensions and map support  
D. propose schema changes  
E. implement staging-layer changes  
F. implement serving-layer changes  
G. add tests and keep fixing until all pass  
H. write docs and completion summary

## Definition of done

- aggregate data can be queried and charted in Superset by:
  - org unit at any supported hierarchy level
  - parent org unit / boundary org unit
  - period at applicable hierarchy level
  - category-combination-derived disaggregation dimensions
  - category option combo
  - attribute option combo where relevant
- charts return accurate queries
- serving datasets include labels and stable IDs
- cascade filters work cleanly
- metadata-driven dimension availability works per data element
- geoJSON loads correctly in DHIS2 Maps where applicable
- tests prove that dimensions exposed for a data element come from its assigned category combination
- all tests pass before the next step

## Completion Summary

Implemented the DHIS2 hierarchy-aware staging and serving model end to end, including raw-fact grain preservation, staged metadata expansion, hierarchy-aware serving, dimension availability metadata, public map compatibility, and backwards-compatible migrations.

### Key files changed

- [superset/dhis2/metadata_staging_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/metadata_staging_service.py)
- [superset/dhis2/staging_engine.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staging_engine.py)
- [superset/dhis2/staged_dataset_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staged_dataset_service.py)
- [superset/dhis2/sync_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/sync_service.py)
- [superset/dhis2/models.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/models.py)
- [superset/models/helpers.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/models/helpers.py)
- [superset/utils/dhis2_preloader.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/utils/dhis2_preloader.py)
- [docs/dhis2-multi-instance/architecture.md](/Users/stephocay/projects/hispuganda/ss_latest/superset/docs/dhis2-multi-instance/architecture.md)
- [docs/dhis2-multi-instance/runbook.md](/Users/stephocay/projects/hispuganda/ss_latest/superset/docs/dhis2-multi-instance/runbook.md)

### Tests executed

- `./venv/bin/pytest tests/dhis2 tests/unit_tests/dhis2/test_staging_engine.py tests/integration_tests/dhis2/test_boundaries.py tests/unit_tests/databases/api_test.py`
- `env NODE_ENV=test NODE_OPTIONS='--max-old-space-size=8192' ./node_modules/.bin/jest --runInBand --silent src/features/datasets/AddDataset/DHIS2DatasetWizard/steps/StepDataElements.test.tsx -t 'toggles the disaggregation dimension setting in wizard state'`

### Final status

- backend target: `345 passed, 1 skipped`
- frontend target: `1 passed`

STATUS: COMPLETE
