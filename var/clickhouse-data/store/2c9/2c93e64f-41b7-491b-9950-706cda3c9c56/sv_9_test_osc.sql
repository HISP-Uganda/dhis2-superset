ATTACH TABLE _ UUID 'd5be3f5b-2daf-4f06-b7fd-90419f7fb1fa'
(
    `national` Nullable(String),
    `district` Nullable(String),
    `chiefdom` Nullable(String),
    `period` Nullable(String),
    `anc_1st_visit` Nullable(Float64),
    `anc_2nd_visit` Nullable(Float64),
    `anc_4th_or_more_visits` Nullable(Float64),
    `anc_3rd_visit` Nullable(Float64),
    `cmc_fp_and_cac_procedure_rooms_have_adequate_lighting_for_the_performance_of_all_procedures` Nullable(Float64),
    `distance_of_inhabitants_with_malaria_from_breeding_site` Nullable(String)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
