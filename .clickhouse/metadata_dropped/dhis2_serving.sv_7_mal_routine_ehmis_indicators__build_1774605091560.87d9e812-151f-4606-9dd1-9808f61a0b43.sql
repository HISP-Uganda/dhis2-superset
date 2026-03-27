ATTACH TABLE _ UUID '87d9e812-151f-4606-9dd1-9808f61a0b43'
(
    `organisation_unit` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
    `_manifest_build_v5` Nullable(Int64)
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(period, ''), '[^0-9]', ''), 1, 4))
ORDER BY (period, ou_level)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
