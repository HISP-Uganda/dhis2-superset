# Target Data Model Design

Design a target DHIS2 aggregate analytics warehouse model for this codebase.

## Goal

Create a normalized staging model and a Superset-friendly serving model that preserve source fidelity while enabling analysis by hierarchy, disaggregation, accurate charting, and geoJSON compatibility for map-related outputs.

## Design these layers

1. Metadata staging
   - stg_dhis2_data_elements
   - stg_dhis2_category_combos
   - stg_dhis2_categories
   - stg_dhis2_category_options
   - stg_dhis2_category_option_combos
   - stg_dhis2_attribute_option_combos
   - stg_dhis2_org_units
   - stg_dhis2_periods or derived period dimension
   - join tables required to map DE -> CC -> categories -> options -> COC
   - geojson-supporting org unit geometry metadata if present

2. Fact staging
   - stg_dhis2_aggregate_values at the most faithful grain possible

3. Serving dimensions
   - dim_org_unit
   - dim_period
   - dim_data_element
   - dim_category_option_combo
   - dim_attribute_option_combo
   - optional bridge tables for category-combo expansion

4. Serving facts
   - fct_dhis2_aggregate_analytics or equivalent Superset-facing table/view

## Required design rules

- The staging fact grain must preserve:
  - data element
  - period
  - org unit
  - category option combo
  - attribute option combo
  - value
- The serving fact must expose resolved dimensions for analysis.
- Organisation unit serving dimension must contain:
  - id
  - code
  - name
  - short_name if available
  - level
  - parent_id
  - path
  - ancestor columns or a bridge for rollup
  - geometry / geojson-related fields where applicable
- Period serving dimension must contain:
  - period id
  - label
  - period type
  - start date
  - end date
  - month / quarter / year fields
  - parent rollup fields where meaningful
- Data element serving dimension must include:
  - assigned category combo
  - flags describing which disaggregation dimensions are applicable
- COC/AOC must be retained as IDs and human-readable labels.
- Category-combo dimensions must be resolvable into explicit analysis columns.
- All chart queries must remain accurate under the proposed grain.

## Outputs required

- table-by-table schema proposal
- grain statement for each table
- key relationships
- rationale for staging vs serving separation
- recommendation on whether serving layer should be a physical table or view
- migration strategy from the current implementation

## Completion gate

At the end:
- validate design consistency against existing code/tests where possible
- document what was done and why
- list files changed
- list tests run and results
- write `STATUS: COMPLETE`

Do not proceed until all tests for this stage pass.

---

## Execution Output

### Proposed target model

The codebase already has the right separation points:

- staged DHIS2 metadata in `source_metadata_cache`
- raw staged facts in `dhis2_staging.ds_*`
- chart-facing serving tables in `dhis2_staging.sv_*`
- generic lineage tables in `stage_*` and `dataset_*`

The recommended target model keeps that shape but makes the logical dimensions explicit and enforces the raw fact grain as:

`source_instance_id + dx_uid + pe + ou + co_uid + aoc_uid`

### Table-by-table schema proposal

| Layer | Table / object | Grain | Key columns | Notes |
| --- | --- | --- | --- | --- |
| Metadata staging | `source_metadata_cache` namespace `dhis2_snapshot:dataElements` | one metadata snapshot per instance | `instance_id`, `id` | source of DE metadata, value type, category combo assignment |
| Metadata staging | `source_metadata_cache` namespace `dhis2_snapshot:categoryCombos` | one CC snapshot per instance | `instance_id`, `id` | identifies which categories apply to a DE |
| Metadata staging | `source_metadata_cache` namespace `dhis2_snapshot:categoryOptionCombos` | one COC snapshot per instance | `instance_id`, `id` | carries COC labels and combo linkage |
| Metadata staging | `source_metadata_cache` namespace `dhis2_snapshot:organisationUnits` | one OU snapshot per instance | `instance_id`, `id` | source OU names, level, parent, path |
| Metadata staging | `source_metadata_cache` namespace `dhis2_snapshot:organisationUnitLevels` | one OU level snapshot per instance | `instance_id`, `level` | source labels for hierarchy columns |
| Metadata staging | `source_metadata_cache` namespace `dhis2_snapshot:geoJSON` | one GeoJSON collection snapshot per instance | `instance_id` | map geometry payload |
| Metadata staging | `source_metadata_cache` namespace `dhis2_snapshot:orgUnitHierarchy` | one hierarchy snapshot per instance | `instance_id`, `org_unit_id` | ancestor chain, path, level lookup |
| Fact staging | `dhis2_staging.ds_*` | faithful DHIS2 aggregate fact grain | `source_instance_id`, `dx_uid`, `pe`, `ou`, `co_uid`, `aoc_uid` | retain raw ids plus names and numeric/text value |
| Serving dimension | logical `dim_org_unit` derived from staged hierarchy | one OU per source instance | `source_instance_id`, `org_unit_id` | expose id, code, name, short name, level, parent, path, ancestor labels, geometry refs |
| Serving dimension | logical `dim_period` derived from period parser | one period code | `period_id` | expose label, period type, parent rollups, year/half/quarter/month/week fields |
| Serving dimension | logical `dim_data_element` from staged metadata | one DE per source instance | `source_instance_id`, `data_element_id` | include category combo id and flags for applicable dimensions |
| Serving dimension | logical `dim_category_option_combo` | one COC per source instance | `source_instance_id`, `coc_id` | include label, category combo id, category selections |
| Serving dimension | logical `dim_attribute_option_combo` | one AOC per source instance | `source_instance_id`, `aoc_id` | include label where available |
| Serving bridge | logical `bridge_data_element_category_combo` | one DE-to-CC mapping | `source_instance_id`, `data_element_id`, `category_combo_id` | supports dimension availability rules |
| Serving bridge | logical `bridge_category_combo_categories` | one CC-to-category mapping | `source_instance_id`, `category_combo_id`, `category_id` | needed to expand analysis dimensions |
| Serving fact | `dhis2_staging.sv_*` | one row per selected serving dimensions | dataset-specific dimension tuple | physical, dataset-scoped analytical table for Superset charts |

### Key relationships

- `dim_data_element.category_combo_id -> category combo metadata`
- `bridge_data_element_category_combo` constrains which disaggregation dimensions a DE may expose
- `bridge_category_combo_categories` and `dim_category_option_combo` resolve COC labels back to category/category-option meaning
- `dim_org_unit` is sourced from staged `organisationUnits`, `organisationUnitLevels`, `orgUnitHierarchy`, and `geoJSON`
- `dim_period` is derived from the DHIS2 period code through [superset/dhis2/period_hierarchy_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/period_hierarchy_service.py)
- `sv_*` is a materialized projection from `ds_*` joined to staged metadata lookups

### Rationale for staging vs serving separation

- Staging must preserve raw DHIS2 fidelity and source lineage. That means raw ids stay intact, COC/AOC remain part of the stored grain, and the table is not pre-pivoted around dashboard assumptions.
- Serving should optimize for Superset control panels, filter discovery, and query correctness. That means explicit hierarchy columns, normalized period rollups, stable labels, and optionally pivoted variable columns.
- Keeping `ds_*` faithful and `sv_*` purpose-built prevents chart design concerns from forcing lossy upstream storage.

### Recommendation on physical table vs view

- Keep the serving layer as a physical local table, not a live view.
- Reason:
  - hierarchy and period derivation are metadata-dependent and benefit from precomputation
  - map and chart workloads need fast scans/group-bys without repeated JSON/snapshot joins
  - staged local serving keeps dashboards independent from live DHIS2 latency
- If a future engine supports cheap materialized views, the equivalent is acceptable, but the current repository shape favors physical `sv_*` tables.

### Migration strategy from the current implementation

1. Preserve the current `source_metadata_cache` namespaces as the authoritative staged metadata source.
2. Continue writing raw analytics into `ds_*`, but enforce the widened fact grain including `co_uid` and `aoc_uid`.
3. Add logical extraction helpers that read staged metadata into explicit DE/CC/category/COC/AOC structures during serving-manifest build time.
4. Materialize `sv_*` with explicit hierarchy and period columns, plus optional disaggregation dimensions and/or COC-expanded measure columns.
5. Rebuild existing staged datasets so any historical rows that were previously collapsed by the narrower conflict key are restaged.
6. Keep generic staged-source mirrors in sync so non-DHIS2 staging architecture remains compatible.

### Consistency check against current code

- Consistent with current raw/serving split in [superset/dhis2/staging_engine.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/staging_engine.py) and [superset/dhis2/serving_build_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/serving_build_service.py)
- Consistent with current staged metadata flow in [superset/dhis2/metadata_staging_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/metadata_staging_service.py)
- Consistent with current hierarchy builders in [superset/dhis2/org_unit_hierarchy_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/org_unit_hierarchy_service.py) and [superset/dhis2/period_hierarchy_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/period_hierarchy_service.py)
- Validated against the DHIS2-focused regression suite listed below

### What was done

- Converted the audit findings into a concrete target warehouse model for this repo.
- Anchored the design to the current staged metadata, `ds_*`, `sv_*`, and generic lineage abstractions instead of proposing a disconnected replacement.

### Why it was done

- The repository already implements most of the required pipeline in code; the design stage needed to clarify the intended grain and the logical dimensions/bridges that the remaining prompts should build around.

### Files changed

- [/.codex5/03-target-data-model-design.md](/Users/stephocay/projects/hispuganda/ss_latest/superset/.codex5/03-target-data-model-design.md)

### Tests executed

- `./venv/bin/pytest -q tests/unit_tests/dhis2/test_staging_engine.py tests/dhis2/test_analytical_serving.py tests/dhis2/test_sync_service.py tests/dhis2/test_metadata_staging_service.py tests/dhis2/test_staged_dataset_service.py tests/dhis2/test_staging_database_service.py tests/integration_tests/dhis2/test_boundaries.py tests/unit_tests/local_staging/test_admin_tools.py`

### Test results

- `106 passed in 0.93s`

### Risks or follow-ups

- The design is logical-first: explicit `dim_*` and bridge tables may remain derived/materialized objects rather than immediately becoming standalone persisted tables.
- Category-combo decomposition is still only partially surfaced in the live code and should be the next implementation focus.
- Existing datasets should be rebuilt after the fact-grain key change so staged facts and serving tables are fully aligned.

STATUS: COMPLETE
