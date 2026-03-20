ATTACH TABLE _ UUID '7e9b53eb-3827-4a54-8260-88f284101593'
(
    `organisation_unit` Nullable(String),
    `period` Nullable(String)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
