ATTACH TABLE _ UUID 'c2bf405c-7aaa-44e1-b3c3-49786af564b6'
(
    `national` LowCardinality(String),
    `region` LowCardinality(String),
    `district_city` LowCardinality(String),
    `dlg_municipality_city_council` LowCardinality(String),
    `sub_county_town_council_division` LowCardinality(String),
    `health_facility` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
    `co_uid` LowCardinality(String),
    `disaggregation` LowCardinality(String),
    `aoc_uid` LowCardinality(String),
    `attribute_option_combo` LowCardinality(String),
    `c_033b_ma01_suspected_malaria_fever` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_tr01_artemether_lumefantrine_20_120_mg_tablet` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_tr08_malaria_rapid_diagnostic_tests` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_tr06_artesunate_60_mg_vial` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_cd01a_malaria_confirmed_cases` Nullable(Float64) CODEC(ZSTD(3)),
    `c_033b_cd01b_malaria_confirmed_deaths` Nullable(Float64) CODEC(ZSTD(3)),
    `_manifest_build_v7` Nullable(Int64)
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(period, ''), '[^0-9]', ''), 1, 4))
ORDER BY (period, ou_level, co_uid, disaggregation, national, region, district_city, dlg_municipality_city_council, sub_county_town_council_division, health_facility)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
