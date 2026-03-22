ATTACH TABLE _ UUID '47230d6c-6b82-4bbf-b4d3-264017436bae'
(
    `source_instance_id` Int32,
    `source_instance_name` LowCardinality(String),
    `dx_uid` String,
    `dx_name` Nullable(String),
    `dx_type` LowCardinality(String),
    `pe` LowCardinality(String),
    `ou` String,
    `ou_name` Nullable(String),
    `ou_level` Nullable(UInt16),
    `value` Nullable(String),
    `value_numeric` Nullable(Float64),
    `co_uid` Nullable(String),
    `co_name` Nullable(String),
    `aoc_uid` Nullable(String),
    `synced_at` DateTime DEFAULT now(),
    `sync_job_id` Nullable(Int32)
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(pe, ''), '[^0-9]', ''), 1, 4))
ORDER BY (source_instance_id, pe, dx_uid, ou)
SETTINGS index_granularity = 8192
