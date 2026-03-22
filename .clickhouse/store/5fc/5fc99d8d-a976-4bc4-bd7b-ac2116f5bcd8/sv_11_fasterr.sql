ATTACH TABLE _ UUID '7b45716b-9127-4623-9921-d23ffc134f11'
(
    `dhis2_instance` LowCardinality(String),
    `national` LowCardinality(String),
    `region` LowCardinality(Nullable(String)),
    `district_city` LowCardinality(Nullable(String)),
    `sub_county_town_council_division` LowCardinality(Nullable(String)),
    `health_facility` LowCardinality(Nullable(String)),
    `period` LowCardinality(String),
    `ou_level` Nullable(UInt16),
    `c_033b_ap02_total_opd` Nullable(Float64),
    `c_033b_ap01_opd_new` Nullable(Float64),
    `c_033b_ap03_total_deaths` Nullable(Float64),
    `c_033b_ap04_expected_emtct_mothers_in_appt` Nullable(Float64),
    `c_033b_ap05_emtct_missed_appointments` Nullable(Float64)
)
ENGINE = MergeTree
PARTITION BY toUInt16OrZero(substring(replaceRegexpAll(ifNull(period, ''), '[^0-9]', ''), 1, 4))
ORDER BY (dhis2_instance, period, ou_level, national, region, district_city, sub_county_town_council_division, health_facility)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
