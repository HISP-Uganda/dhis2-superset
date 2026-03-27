ATTACH TABLE _ UUID 'b5775f1f-1518-4d7c-9400-f120bdd2bead'
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
