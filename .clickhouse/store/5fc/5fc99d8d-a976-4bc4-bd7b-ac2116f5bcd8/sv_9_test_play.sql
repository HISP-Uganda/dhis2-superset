ATTACH TABLE _ UUID 'daebc2d5-1b71-412e-b0e1-e08d9f1a54de'
(
    `national` LowCardinality(String),
    `district` LowCardinality(String),
    `chiefdom` LowCardinality(String),
    `facility` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
    `malaria_treated_at_phu_with_act_24_hrs_new` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_at_phu_with_act_24_hrs_f_up` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_at_phu_without_act_24_hrs_new` Nullable(Float64) CODEC(ZSTD(3)),
    `rapid_diagnostic_test_for_malaria_negative` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_in_community_with_act_24_hrs_f_up` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_cases_confirmed` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_deaths_5_yrs_narrative` Nullable(String) CODEC(ZSTD(3)),
    `malaria_treated_at_phu_with_act_24_hrs_f_up_2` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_at_phu_with_act_24_hrs_new_2` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_referrals` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_at_phu_without_act_24_hrs_f_up` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_in_community_with_act_24_hrs_new` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_outbreak_threshold` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_at_phu_without_act_24_hrs_new_2` Nullable(Float64) CODEC(ZSTD(3)),
    `inpatient_malaria_cases` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_at_phu_without_act_24_hrs_f_up_2` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_deaths_5_yrs` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_cases` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_in_community_with_act_24_hrs_f_up_2` Nullable(Float64) CODEC(ZSTD(3)),
    `inpatient_malaria_deaths` Nullable(Float64) CODEC(ZSTD(3)),
    `rapid_diagnostic_test_for_malaria_positive` Nullable(Float64) CODEC(ZSTD(3)),
    `malaria_treated_in_community_with_act_24_hrs_new_2` Nullable(Float64) CODEC(ZSTD(3)),
    `_manifest_build_v7` Nullable(Int64)
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(period, ''), '[^0-9]', ''), 1, 4))
ORDER BY (period, ou_level, national, district, chiefdom, facility)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
