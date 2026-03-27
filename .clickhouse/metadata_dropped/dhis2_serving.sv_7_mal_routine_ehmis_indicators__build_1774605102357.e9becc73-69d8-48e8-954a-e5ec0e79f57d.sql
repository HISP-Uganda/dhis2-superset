ATTACH TABLE _ UUID 'e9becc73-69d8-48e8-954a-e5ec0e79f57d'
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
