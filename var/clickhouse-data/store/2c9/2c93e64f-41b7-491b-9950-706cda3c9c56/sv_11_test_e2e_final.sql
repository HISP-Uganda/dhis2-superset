ATTACH TABLE _ UUID 'e36cb6df-84ee-451d-8086-ade39b7ede77'
(
    `organisation_unit` Nullable(String),
    `period` Nullable(String)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
