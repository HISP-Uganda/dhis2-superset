ATTACH TABLE _ UUID '778d4596-c410-4624-a49d-c675f4211013'
(
    `national` LowCardinality(String),
    `district` LowCardinality(String),
    `chiefdom` LowCardinality(String),
    `facility` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
    `co_uid` LowCardinality(String),
    `disaggregation` LowCardinality(String),
    `aoc_uid` LowCardinality(String),
    `attribute_option_combo` LowCardinality(String),
    `under_5_5_and_above_of_age` LowCardinality(String),
    `referrals_age` LowCardinality(String),
    `morbidity_age` LowCardinality(String),
    `inpatient_malaria_cases` Nullable(Float64) CODEC(ZSTD(3)),
    `inpatient_malaria_deaths` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_deaths_5_yrs` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_deaths_5_yrs_narrative` Nullable(String) CODEC(ZSTD(3)),
    `malaria_cases` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_outbreak_threshold` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_referrals` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_at_phu_with_act_24_hrs_f_up` Nullable(Float64) CODEC(ZSTD(3)),
    `_manifest_build_v7` Nullable(Int64)
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(period, ''), '[^0-9]', ''), 1, 4))
ORDER BY (period, ou_level, co_uid, disaggregation, national, district, chiefdom, facility)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
