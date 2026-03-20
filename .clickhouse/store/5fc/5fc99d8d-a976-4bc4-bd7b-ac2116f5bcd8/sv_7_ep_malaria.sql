ATTACH TABLE _ UUID 'b2030498-22b1-4230-b13e-bc5af03c2d72'
(
    `dhis2_instance` String,
    `national` String,
    `region` String,
    `district_city` String,
    `dlg_municipality_city_council` String,
    `sub_county_town_council_division` Nullable(String),
    `health_facility` Nullable(String),
    `ward_department` Nullable(String),
    `period` String,
    `ou_level` Nullable(Int64),
    `period_level` String,
    `period_parent` String,
    `period_year` String,
    `period_half` String,
    `period_quarter` String,
    `period_month` String,
    `period_week` Nullable(String),
    `period_biweek` Nullable(String),
    `period_bimonth` Nullable(String),
    `period_variant` Nullable(String),
    `c_105_ep01a_suspected_malaria_fever` Nullable(Float64),
    `c_105_ep01b_2019_malaria_total` Nullable(Float64),
    `c_105_ep01b_malaria_tested_b_s_rdt` Nullable(Float64),
    `c_105_ep01c_malaria_confirmed_b_s_rdt` Nullable(Float64),
    `c_105_ep01d_confirmed_malaria_cases_treated` Nullable(Float64),
    `c_105_ep01e_total_malaria_cases_treated` Nullable(Float64),
    `c_105_ep01a_suspected_fever` Nullable(Float64),
    `c_105_ep01b_malaria_total` Nullable(Float64),
    `c_105_ep01c_malaria_confirmed_b_s_and_rdt_positive` Nullable(Float64),
    `c_105_ep01d_malaria_cases_treated` Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (dhis2_instance, period, period_year, period_quarter, period_month, period_week, period_parent, ou_level, national, region, district_city, dlg_municipality_city_council, sub_county_town_council_division, health_facility, ward_department)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
