ATTACH TABLE _ UUID 'a9055fbe-9cc8-4d3a-aac0-9b79b69ff8ee'
(
    `dhis2_instance` LowCardinality(String),
    `national` LowCardinality(String),
    `region` LowCardinality(String),
    `district_city` LowCardinality(String),
    `sub_county_town_council_division` LowCardinality(String),
    `health_facility` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
    `c_004_dn02_names_of_deceased` String,
    `c_004_dn03_inpatient_number` String,
    `c_004_dn04_village_of_residence_lc_i` String
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(period, ''), '[^0-9]', ''), 1, 4))
ORDER BY (dhis2_instance, period, ou_level, national, region, district_city, sub_county_town_council_division, health_facility)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
