ATTACH TABLE _ UUID '313976c7-5bf6-4c15-ac2a-a4257a2de5b6'
(
    `organisation_unit` Nullable(String),
    `period` Nullable(String)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
