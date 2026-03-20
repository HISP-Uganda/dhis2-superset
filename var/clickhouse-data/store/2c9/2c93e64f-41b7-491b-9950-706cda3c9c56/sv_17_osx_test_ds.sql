ATTACH TABLE _ UUID '45bb318e-6895-4b30-80f6-2487bbe970fe'
(
    `national` Nullable(String),
    `district` Nullable(String),
    `chiefdom` Nullable(String),
    `period` Nullable(String),
    `accute_flaccid_paralysis_deaths_5_yrs` Nullable(Float64),
    `acute_flaccid_paralysis_afp_follow_up` Nullable(Float64),
    `acute_flaccid_paralysis_afp_referrals` Nullable(Float64),
    `acute_flaccid_paralysis_afp_new` Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
