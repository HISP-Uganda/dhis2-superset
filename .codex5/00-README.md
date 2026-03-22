# Codex Autonomous Agent Prompt Pack

This pack contains step-by-step Markdown prompts for Codex to inspect, refactor, migrate, validate, and document a DHIS2 -> staging -> serving pipeline for Superset.

## Global execution rules for every prompt

Codex must obey these rules in every step:

1. Data accuracy is mandatory across all hierarchies and dimensions.
2. All charts must return accurate queries.
3. Organisation unit hierarchy behavior must be correct across all supported levels and boundaries.
4. Period hierarchy behavior must be correct across all supported grains and rollups.
5. Category-combination-driven disaggregation must be accurate for every data element.
6. COC and AOC must never be dropped when they are part of the fact grain.
7. GeoJSON must load correctly in DHIS2 Maps where applicable.
8. Before moving to the next prompt, ALL tests must pass.
9. At the end of each prompt, Codex must document:
   - what was done
   - why it was done
   - files changed
   - tests executed
   - test results
   - risks or follow-ups
10. At the end of each completed prompt, Codex must write `STATUS: COMPLETE`.
11. Codex must not ask for approval or confirmation before proceeding to the next step.
12. If tests fail, Codex must fix the implementation before continuing.

## Suggested sequence

1. 01-master-prompt.md
2. 02-repository-inspection-and-gap-analysis.md
3. 03-target-data-model-design.md
4. 04-staging-layer-implementation.md
5. 05-org-unit-hierarchy-support.md
6. 06-period-hierarchy-support.md
7. 07-category-combination-coc-aoc-support.md
8. 08-superset-serving-table-design.md
9. 09-dimension-availability-per-data-element.md
10. 10-migration-and-backward-compatibility.md
11. 11-tests.md
12. 12-documentation.md
13. 13-target-serving-schema.md
14. 14-acceptance-criteria.md
15. 15-all-in-one-prompt.md

## Completion Summary

The full `.codex5` DHIS2 staging and serving pack is now implemented in this repository.

## Final verification

- `./venv/bin/pytest tests/dhis2 tests/unit_tests/dhis2/test_staging_engine.py tests/integration_tests/dhis2/test_boundaries.py tests/unit_tests/databases/api_test.py`
- result: `345 passed, 1 skipped`
- `env NODE_ENV=test NODE_OPTIONS='--max-old-space-size=8192' ./node_modules/.bin/jest --runInBand --silent src/features/datasets/AddDataset/DHIS2DatasetWizard/steps/StepDataElements.test.tsx -t 'toggles the disaggregation dimension setting in wizard state'`
- result: `1 passed`

STATUS: COMPLETE
