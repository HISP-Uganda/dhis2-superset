ATTACH TABLE _ UUID '26578800-0599-4cbc-888b-332158cb5f8c'
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
