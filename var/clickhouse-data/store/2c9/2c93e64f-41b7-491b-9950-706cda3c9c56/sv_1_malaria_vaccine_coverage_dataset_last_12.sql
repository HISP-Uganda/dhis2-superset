ATTACH TABLE _ UUID 'e908cf52-c636-4026-8305-b9fdb5c27ffe'
(
    `dhis2_instance` Nullable(String),
    `national` Nullable(String),
    `region` Nullable(String),
    `district_city` Nullable(String),
    `period` Nullable(String),
    `ou_level` Nullable(Int64),
    `mal_malaria_1_to_malaria_3_dropout_rate` Nullable(Float64),
    `mal_malaria_1_coverage_1_year` Nullable(Float64),
    `mal_malaria_3_coverage_1_year` Nullable(Float64),
    `mal_malaria_vaccine_all_outreach` Nullable(Float64),
    `mal_malaria_vaccine_all_static` Nullable(Float64),
    `c_105_cl19_malaria_1` Nullable(Float64),
    `c_105_cl20_malaria_2` Nullable(Float64),
    `c_105_cl21_malaria_3` Nullable(Float64),
    `c_105_cl26_malaria_4` Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
