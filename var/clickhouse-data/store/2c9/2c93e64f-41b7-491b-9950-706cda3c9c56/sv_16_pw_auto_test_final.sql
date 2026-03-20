ATTACH TABLE _ UUID '13fb38ff-67fc-4b77-83f1-3853988c3e3f'
(
    `national` Nullable(String),
    `district` Nullable(String),
    `chiefdom` Nullable(String),
    `facility` Nullable(String),
    `period` Nullable(String),
    `accute_flaccid_paralysis_deaths_5_yrs` Nullable(Float64),
    `acute_flaccid_paralysis_afp_follow_up` Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
