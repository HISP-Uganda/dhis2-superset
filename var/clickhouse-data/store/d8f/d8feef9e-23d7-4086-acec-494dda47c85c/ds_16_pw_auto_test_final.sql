ATTACH TABLE _ UUID '8bf9fc6c-ace9-4efd-a279-3e29f441e10e'
(
    `id` Nullable(Int64),
    `source_instance_id` Nullable(Int32),
    `source_instance_name` Nullable(String),
    `dx_uid` Nullable(String),
    `dx_name` Nullable(String),
    `dx_type` Nullable(String),
    `pe` Nullable(String),
    `ou` Nullable(String),
    `ou_name` Nullable(String),
    `ou_level` Nullable(Int32),
    `value` Nullable(String),
    `value_numeric` Nullable(Float64),
    `co_uid` Nullable(String),
    `co_name` Nullable(String),
    `aoc_uid` Nullable(String),
    `synced_at` Nullable(DateTime),
    `sync_job_id` Nullable(Int32)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
