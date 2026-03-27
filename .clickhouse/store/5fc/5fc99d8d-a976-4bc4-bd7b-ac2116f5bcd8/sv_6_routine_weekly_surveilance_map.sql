ATTACH TABLE _ UUID '27f578eb-3fef-408f-9f9e-c2cc7ec88f60'
(
    `period` LowCardinality(String),
    `national` LowCardinality(String),
    `region` LowCardinality(String),
    `district_city` LowCardinality(String),
    `ou_level` UInt16,
    `c_033b_ma01_suspected_malaria_fever` Nullable(Float64),
    `c_033b_tr08_malaria_rapid_diagnostic_tests` Nullable(Float64),
    `c_033b_tr01_artemether_lumefantrine_20_120_mg_tablet` Nullable(Float64),
    `c_033b_tr06_artesunate_60_mg_vial` Nullable(Float64),
    `c_033b_cd01a_malaria_confirmed_cases` Nullable(Float64),
    `c_033b_cd01b_malaria_confirmed_deaths` Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (period, ou_level, national, region, district_city)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
