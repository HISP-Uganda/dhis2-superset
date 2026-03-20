ATTACH TABLE _ UUID '1e732554-100e-4749-8da1-19ed5a03b954'
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
    `mal_malaria_1_to_malaria_3_dropout_rate` Float64,
    `mal_malaria_1_coverage_1_year` Float64,
    `mal_malaria_3_coverage_1_year` Float64,
    `mal_malaria_vaccine_all_outreach` Float64,
    `mal_malaria_vaccine_all_static` Float64,
    `c_105_cl19_malaria_1` Float64,
    `c_105_cl20_malaria_2` Float64,
    `c_105_cl21_malaria_3` Float64,
    `c_105_cl26_malaria_4` Float64
)
ENGINE = MergeTree
ORDER BY (dhis2_instance, period, period_year, period_quarter, period_month, period_week, period_parent, ou_level, national, region, district_city, dlg_municipality_city_council, sub_county_town_council_division, health_facility, ward_department, schools)
SETTINGS index_granularity = 8192
