ATTACH TABLE _ UUID '8ed7bee9-1346-489a-9e98-12779b3d3002'
(
    `dhis2_instance` LowCardinality(String),
    `national` LowCardinality(String),
    `region` LowCardinality(String),
    `district_city` LowCardinality(String),
    `dlg_municipality_city_council` LowCardinality(String),
    `sub_county_town_council_division` LowCardinality(String),
    `health_facility` LowCardinality(String),
    `ward_department` LowCardinality(String),
    `schools` LowCardinality(String),
    `period` LowCardinality(String),
    `ou_level` UInt16,
    `c_004_dn02_names_of_deceased` String
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(period, ''), '[^0-9]', ''), 1, 4))
ORDER BY (dhis2_instance, period, ou_level, national, region, district_city, dlg_municipality_city_council, sub_county_town_council_division, health_facility, ward_department, schools)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
