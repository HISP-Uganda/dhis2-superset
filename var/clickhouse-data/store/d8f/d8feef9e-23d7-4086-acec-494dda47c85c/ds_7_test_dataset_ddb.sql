ATTACH TABLE _ UUID '9c8c77fc-3314-4376-b02e-9dc4b78d9672'
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
