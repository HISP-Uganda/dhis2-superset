ATTACH TABLE _ UUID '2e3b700d-d969-4377-ad88-3091df5a2daf'
(
    `staged_dataset_id` Int32 DEFAULT 0,
    `source_instance_id` Int32,
    `source_instance_name` LowCardinality(String),
    `dx_uid` LowCardinality(String) CODEC(ZSTD(3)),
    `dx_name` String DEFAULT '' CODEC(ZSTD(3)),
    `dx_type` LowCardinality(String),
    `pe` LowCardinality(String),
    `ou` LowCardinality(String) CODEC(ZSTD(3)),
    `ou_name` String DEFAULT '' CODEC(ZSTD(3)),
    `ou_level` UInt16,
    `value` String DEFAULT '' CODEC(ZSTD(3)),
    `value_numeric` Float64 DEFAULT 0 CODEC(ZSTD(3)),
    `co_uid` LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    `co_name` String DEFAULT '' CODEC(ZSTD(3)),
    `aoc_uid` LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    `synced_at` DateTime DEFAULT now(),
    `sync_job_id` Nullable(Int32)
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(pe, ''), '[^0-9]', ''), 1, 4))
ORDER BY (source_instance_id, pe, dx_uid, ou)
SETTINGS index_granularity = 8192
