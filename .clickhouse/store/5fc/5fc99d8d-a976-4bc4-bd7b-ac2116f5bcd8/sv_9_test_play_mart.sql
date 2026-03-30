ATTACH TABLE _ UUID '2c5dfe3d-491a-489b-8b86-3922a340e61b'
(
    `national` LowCardinality(String),
    `district` LowCardinality(String),
    `chiefdom` LowCardinality(String),
    `facility` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
    `malaria_treated_at_phu_with_act_24_hrs_new` Nullable(Float64),
    `malaria_treated_at_phu_with_act_24_hrs_f_up` Nullable(Float64),
    `malaria_treated_at_phu_without_act_24_hrs_new` Nullable(Float64),
    `rapid_diagnostic_test_for_malaria_negative` Nullable(Float64),
    `malaria_treated_in_community_with_act_24_hrs_f_up` Nullable(Float64),
    `malaria_cases_confirmed` Nullable(Float64),
    `malaria_deaths_5_yrs_narrative` Nullable(String),
    `malaria_treated_at_phu_with_act_24_hrs_f_up_2` Nullable(Float64),
    `malaria_treated_at_phu_with_act_24_hrs_new_2` Nullable(Float64),
    `malaria_referrals` Nullable(Float64),
    `malaria_treated_at_phu_without_act_24_hrs_f_up` Nullable(Float64),
    `malaria_treated_in_community_with_act_24_hrs_new` Nullable(Float64),
    `malaria_outbreak_threshold` Nullable(Float64),
    `malaria_treated_at_phu_without_act_24_hrs_new_2` Nullable(Float64),
    `inpatient_malaria_cases` Nullable(Float64),
    `malaria_treated_at_phu_without_act_24_hrs_f_up_2` Nullable(Float64),
    `malaria_deaths_5_yrs` Nullable(Float64),
    `malaria_cases` Nullable(Float64),
    `malaria_treated_in_community_with_act_24_hrs_f_up_2` Nullable(Float64),
    `inpatient_malaria_deaths` Nullable(Float64),
    `rapid_diagnostic_test_for_malaria_positive` Nullable(Float64),
    `malaria_treated_in_community_with_act_24_hrs_new_2` Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (period, ou_level, national, district, chiefdom, facility)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
