# Tests

Add a comprehensive automated test suite for the new DHIS2 staging and serving model.

## Cover

1. metadata ingestion
2. fact ingestion
3. org unit hierarchy derivation
4. period hierarchy derivation
5. COC/AOC preservation
6. category-combo-driven dimension availability
7. serving-table correctness
8. accurate chart query generation / correctness
9. geojson loading / map compatibility where applicable

## Test scenarios

- default CC data element
- DE with 2-dimension CC such as age+sex
- same DE/PE/OU with two different COCs
- AOC-present scenario
- multi-level org unit hierarchy
- monthly periods rolled to quarter/year labels
- serving table rows remain unique at DE+PE+OU+COC+AOC grain
- Superset-friendly columns are populated
- chart queries remain accurate under hierarchy filters
- geojson joins/load correctly for org units that support mapping

For each test:
- define fixture data
- expected outputs
- why the test matters

## Mandatory rule

Before moving to the next prompt, ALL tests MUST pass.
If any fail, fix the implementation and rerun until they all pass.

## Completion gate

At the end:
- list every test run
- report pass/fail
- summarize what was fixed
- write `STATUS: COMPLETE`

## Test runs

- `./venv/bin/pytest tests/dhis2/test_models.py tests/dhis2/test_metadata_staging_service.py tests/dhis2/test_staged_dataset_service.py tests/dhis2/test_staged_dataset_api.py`
- `./venv/bin/pytest tests/dhis2/test_dhis2_preloader.py`
- `./venv/bin/pytest tests/dhis2/test_diagnostics_service.py tests/dhis2/test_generic_staging_models.py tests/dhis2/test_instance_service.py tests/dhis2/test_staging_compat_integration.py tests/dhis2/test_staging_database_service.py`
- `./venv/bin/pytest tests/dhis2 tests/unit_tests/dhis2/test_staging_engine.py tests/integration_tests/dhis2/test_boundaries.py tests/unit_tests/databases/api_test.py`
- `env NODE_ENV=test NODE_OPTIONS='--max-old-space-size=8192' ./node_modules/.bin/jest --runInBand --silent src/features/datasets/AddDataset/DHIS2DatasetWizard/steps/StepDataElements.test.tsx -t 'toggles the disaggregation dimension setting in wizard state'`

## Report

- backend final target: `345 passed, 1 skipped`
- frontend DHIS2 wizard regression: `1 passed`

## What was fixed

- dimension availability metadata and API exposure
- raw fact-grain preservation for `COC/AOC`
- safe handling of lightweight compatibility/test doubles in staging and DHIS2 service layers
- staged GeoJSON and public metadata stability
- test isolation leaks that were contaminating unrelated database API and integration suites

STATUS: COMPLETE
