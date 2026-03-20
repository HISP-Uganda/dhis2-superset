ATTACH TABLE _ UUID '8b7dde53-806b-49b5-924b-03c40b063c80'
(
    `organisation_unit` Nullable(String),
    `period` Nullable(String)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
