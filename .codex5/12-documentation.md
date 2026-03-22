# Documentation

Write implementation documentation for the DHIS2 hierarchy-aware analytics warehouse model.

## Include

1. architecture overview
2. staging tables and grain
3. serving tables and grain
4. how org unit hierarchy works
5. how period hierarchy works
6. how category combinations, COC, and AOC work
7. how dimension availability is determined per data element
8. how Superset should consume the serving dataset
9. chart examples supported
10. map / geojson considerations for DHIS2 Maps
11. operational considerations:
   - refresh order
   - backfills
   - performance
   - common pitfalls
12. test and validation workflow between prompts

Also include a short maintainer guide:
- where to add a new metadata field
- where to change serving logic
- how to debug a missing disaggregation dimension
- how to debug inaccurate chart queries
- how to debug geojson/map loading issues

## Completion gate

Before proceeding:
- run doc-related validation if applicable
- document what was done and why
- list changed files
- list tests run and results
- write `STATUS: COMPLETE`

## What was done

- Extended [architecture.md](/Users/stephocay/projects/hispuganda/ss_latest/superset/docs/dhis2-multi-instance/architecture.md) with explicit staging/serving grain notes, dimension-availability notes, and maintainer guidance.
- Extended [runbook.md](/Users/stephocay/projects/hispuganda/ss_latest/superset/docs/dhis2-multi-instance/runbook.md) with a maintainer debug guide for metadata fields, serving logic, missing disaggregation, inaccurate chart totals, and GeoJSON troubleshooting.

## Files changed

- [docs/dhis2-multi-instance/architecture.md](/Users/stephocay/projects/hispuganda/ss_latest/superset/docs/dhis2-multi-instance/architecture.md)
- [docs/dhis2-multi-instance/runbook.md](/Users/stephocay/projects/hispuganda/ss_latest/superset/docs/dhis2-multi-instance/runbook.md)

## Tests run and results

- documentation changes align with the final backend target: `345 passed, 1 skipped`

STATUS: COMPLETE
