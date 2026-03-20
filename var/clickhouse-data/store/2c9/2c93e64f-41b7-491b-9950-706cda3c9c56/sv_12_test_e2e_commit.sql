ATTACH TABLE _ UUID '22210228-29d6-40ff-9548-6c5374c64208'
(
    `organisation_unit` Nullable(String),
    `period` Nullable(String)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
