ATTACH TABLE _ UUID '6ebdfc9d-b589-4f0c-aebc-2dd30736698b'
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
    `inpatient_malaria_cases` Nullable(Float64),
    `inpatient_malaria_deaths` Nullable(Float64),
    `malaria_deaths_5_yrs` Nullable(Float64),
    `malaria_deaths_5_yrs_narrative` Nullable(String),
    `malaria_cases` Nullable(Float64),
    `malaria_outbreak_threshold` Nullable(Float64),
    `malaria_referrals` Nullable(Float64),
    `malaria_treated_at_phu_with_act_24_hrs_f_up` Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (period, ou_level, national, district, chiefdom, facility, co_uid, disaggregation, aoc_uid, attribute_option_combo, under_5_5_and_above_of_age, referrals_age, morbidity_age)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
