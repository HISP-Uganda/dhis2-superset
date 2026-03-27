ATTACH TABLE _ UUID 'bc12c359-1200-4695-b18a-aa4e0a9ef225'
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
