# Target Serving Schema

## Target serving fact grain

1 row per:
- data_element_id
- period_id
- org_unit_id
- coc_id
- aoc_id

## Suggested serving columns

### Identifiers
- data_element_id
- data_element_code
- data_element_name
- period_id
- org_unit_id
- coc_id
- aoc_id

### Measures
- value_numeric
- value_text if needed
- value_boolean if needed

### Org unit hierarchy
- org_unit_name
- org_unit_level
- parent_org_unit_id
- parent_org_unit_name
- org_unit_path
- org_unit_level_1_id
- org_unit_level_1_name
- org_unit_level_2_id
- org_unit_level_2_name
- org_unit_level_3_id
- org_unit_level_3_name
- ...

### Map support
- geometry_type where applicable
- geometry_json or geojson reference where applicable
- centroid / lat-lon helpers if the codebase uses them

### Period hierarchy
- period_name
- period_type
- period_start_date
- period_end_date
- year_id
- year_label
- quarter_id
- quarter_label
- month_id
- month_label
- sort_key

### Disaggregation
- category_combo_id
- category_combo_name
- category_option_combo_name
- attribute_option_combo_name
- disagg_<dimension_key_1>
- disagg_<dimension_key_2>
- ...
or a bridge-backed pattern if dynamic dimensions are preferred

### Metadata helpers
- applicable_dimension_keys
- has_disaggregation
- is_default_coc

## Rules

- charts must query accurately against this grain
- nulls for non-applicable dimensions must not imply false membership
- geojson/map joins must remain stable and accurate

## Completion Summary

- confirmed the active target schema remains:
  - raw `ds_*` at `source_instance_id + dx_uid + pe + ou + co_uid + aoc_uid`
  - serving `sv_*` with user-facing hierarchy, period, and variable columns
- added query safeguards in [helpers.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/models/helpers.py) so the serving schema is queried at the intended terminal hierarchy level by default
- serving projection remains anchored in [analytical_serving.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/analytical_serving.py) and [serving_build_service.py](/Users/stephocay/projects/hispuganda/ss_latest/superset/superset/dhis2/serving_build_service.py)

## Tests run and results

- final backend target: `345 passed, 1 skipped`

STATUS: COMPLETE
