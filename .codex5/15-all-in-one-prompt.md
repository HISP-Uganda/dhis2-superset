# All-in-One Prompt

Work in the dhis2-superset codebase and refactor the DHIS2 aggregate analytics warehouse model so it fully supports Superset charting with cascade filters, hierarchical drilldown, accurate queries, and DHIS2 Maps geoJSON compatibility.

You must:
1. inspect the current implementation first
2. map the current ingestion, staging, and serving pipeline
3. redesign where needed to support:
   - organisation unit hierarchy
   - period hierarchy
   - category combination driven disaggregation
   - category option combo
   - attribute option combo
   - map / geojson compatibility where applicable
4. implement staging tables/models that preserve source grain:
   DE + PE + OU + COC + AOC
5. implement serving tables/views that are Superset-friendly
6. ensure data elements expose only their applicable category-combination dimensions during analysis
7. ensure all charts return accurate queries
8. ensure geoJSON loads correctly on DHIS2 Maps where applicable
9. add tests, migrations, and docs

## Mandatory execution rules

- Data MUST be accurate across all hierarchies and dimensions.
- Before moving onto the next prompt, ALL tests MUST pass.
- If tests fail, fix the implementation before continuing.
- At the end of each step, document:
  - what was done
  - why it was done
  - files changed
  - tests executed
  - results
  - risks or follow-ups
- Update status to `STATUS: COMPLETE` before proceeding.
- Do not ask for approvals or confirmations.

## Domain rules

- org units are hierarchical and must support rollup/drilldown by level and boundary
- periods must support appropriate rollups for visualization
- category combinations define valid disaggregation dimensions for a data element
- COC/AOC must not be dropped
- default CC must not create fake dimensions
- analysis metadata must expose valid dimensions per data element
- charts must query accurately under all supported filters and groupings
- geojson/map joins must be correct where applicable

## Implementation outputs required

- code changes
- migrations
- tests
- docs
- example serving schema
- final summary of changed files and residual risks

Start by auditing the repository and summarizing the current design before making changes.

## Implementation Summary

Executed the combined DHIS2 warehouse prompt as concrete repository work:

- staged metadata and public metadata now load locally first
- raw facts keep `DE/PE/OU/COC/AOC` fidelity
- serving queries are hierarchy-safe by default
- dimension availability is persisted per staged dataset variable
- compatibility, migration, and diagnostics paths are covered by passing tests

## Representative changed files

- [superset/dhis2/metadata_staging_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/metadata_staging_service.py)
- [superset/dhis2/staging_engine.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staging_engine.py)
- [superset/dhis2/staged_dataset_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staged_dataset_service.py)
- [superset/dhis2/sync_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/sync_service.py)
- [superset/models/helpers.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/models/helpers.py)
- [superset/utils/dhis2_preloader.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/utils/dhis2_preloader.py)
- [docs/dhis2-multi-instance/architecture.md](/Users/stephocay/projects/hispuganda/ss_latest/superset/docs/dhis2-multi-instance/architecture.md)

## Tests executed

- `./venv/bin/pytest tests/dhis2 tests/unit_tests/dhis2/test_staging_engine.py tests/integration_tests/dhis2/test_boundaries.py tests/unit_tests/databases/api_test.py`
- `env NODE_ENV=test NODE_OPTIONS='--max-old-space-size=8192' ./node_modules/.bin/jest --runInBand --silent src/features/datasets/AddDataset/DHIS2DatasetWizard/steps/StepDataElements.test.tsx -t 'toggles the disaggregation dimension setting in wizard state'`

## Final status

- backend target: `345 passed, 1 skipped`
- frontend target: `1 passed`

STATUS: COMPLETE
