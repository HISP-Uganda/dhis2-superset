ATTACH TABLE _ UUID '1e2a995a-cf3c-4b29-99d0-762af7bba968'
(
    `dhis2_instance` String,
    `national` String,
    `region` String,
    `district_city` String,
    `dlg_municipality_city_council` String,
    `sub_county_town_council_division` String,
    `health_facility` String,
    `ward_department` String,
    `schools` String,
    `period` String,
    `ou_level` Int64,
    `period_level` String,
    `period_parent` String,
    `period_year` String,
    `period_half` String,
    `period_quarter` String,
    `period_month` String,
    `period_week` String,
    `period_biweek` String,
    `period_bimonth` String,
    `period_variant` String,
    `c_004_dn02_names_of_deceased` String,
    `c_004_dn03_inpatient_number` String,
    `c_004_dn04_village_of_residence_lc_i` String
)
ENGINE = MergeTree
ORDER BY (dhis2_instance, period, period_year, period_quarter, period_month, period_week, period_parent, ou_level, national, region, district_city, dlg_municipality_city_council, sub_county_town_council_division, health_facility, ward_department, schools)
SETTINGS index_granularity = 8192
