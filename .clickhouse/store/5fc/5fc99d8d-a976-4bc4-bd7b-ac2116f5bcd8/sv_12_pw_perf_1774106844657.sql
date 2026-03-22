ATTACH TABLE _ UUID '01b2ddda-3de9-4c04-8882-69c0d9afd187'
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
