ATTACH TABLE _ UUID '4fcf614f-90b9-4dc8-bf7c-47f0d67d93a3'
(
    `organisation_unit` Nullable(String),
    `period` Nullable(String)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
