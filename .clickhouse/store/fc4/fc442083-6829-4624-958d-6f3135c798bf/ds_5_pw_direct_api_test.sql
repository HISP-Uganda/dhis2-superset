ATTACH TABLE _ UUID '0ca7819d-900b-40d9-a137-98cf053902df'
(
    `source_instance_id` Int32,
    `source_instance_name` String,
    `dx_uid` String,
    `dx_name` Nullable(String),
    `dx_type` String,
    `pe` String,
    `ou` String,
    `ou_name` Nullable(String),
    `ou_level` Nullable(Int32),
    `value` Nullable(String),
    `value_numeric` Nullable(Float64),
    `co_uid` Nullable(String),
    `co_name` Nullable(String),
    `aoc_uid` Nullable(String),
    `synced_at` DateTime DEFAULT now(),
    `sync_job_id` Nullable(Int32)
)
ENGINE = MergeTree
ORDER BY (source_instance_id, dx_uid, pe, ou)
SETTINGS index_granularity = 8192
