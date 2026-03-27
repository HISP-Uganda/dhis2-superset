ATTACH TABLE _ UUID 'f4b02988-afac-4d6a-b5e1-6c12a302d124'
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
