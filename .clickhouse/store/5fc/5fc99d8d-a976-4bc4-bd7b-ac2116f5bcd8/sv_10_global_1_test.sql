ATTACH TABLE _ UUID '731d506f-feba-400e-9f5a-1270d3258123'
(
    `national` LowCardinality(String),
    `district` LowCardinality(String),
    `chiefdom` LowCardinality(String),
    `facility` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
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
ORDER BY (period, ou_level, national, district, chiefdom, facility)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
