ATTACH TABLE _ UUID '9c71a6e6-6c73-4136-a5e8-7b73c4e32c7e'
(
    `dhis2_instance` LowCardinality(String),
    `organisation_unit` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
    `c_004_dn02_names_of_deceased` String
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(period, ''), '[^0-9]', ''), 1, 4))
ORDER BY (dhis2_instance, period, ou_level)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
