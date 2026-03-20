ATTACH TABLE _ UUID '24a950d9-2e35-4a6c-b7ab-32b5460cf5c4'
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
