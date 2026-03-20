ATTACH TABLE _ UUID 'f61c7c27-19ce-4cd0-8e43-8e13c9b89723'
(
    `organisation_unit` Nullable(String),
    `period` Nullable(String)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
