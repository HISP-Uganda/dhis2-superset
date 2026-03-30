ATTACH TABLE _ UUID '604def74-767c-48e2-911c-835086333ddf'
(
    `national` LowCardinality(String),
    `district` LowCardinality(String),
    `chiefdom` LowCardinality(String),
    `facility` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
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
ORDER BY (period, ou_level, national, district, chiefdom, facility)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
