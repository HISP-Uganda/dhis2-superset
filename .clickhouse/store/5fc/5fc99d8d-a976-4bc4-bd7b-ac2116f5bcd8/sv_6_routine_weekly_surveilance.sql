ATTACH TABLE _ UUID '21d67173-ddb2-4930-88d0-b3d00e91d3f2'
(
    `national` LowCardinality(String),
    `region` LowCardinality(String),
    `district_city` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
    `c_033b_ma01_suspected_malaria_fever` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_tr08_malaria_rapid_diagnostic_tests` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_tr01_artemether_lumefantrine_20_120_mg_tablet` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_tr06_artesunate_60_mg_vial` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_cd01a_malaria_confirmed_cases` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_cd01b_malaria_confirmed_deaths` Nullable(Float64) CODEC(ZSTD(3)),
    `_manifest_build_v5` Nullable(Int64)
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(period, ''), '[^0-9]', ''), 1, 4))
ORDER BY (period, ou_level, national, region, district_city)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
