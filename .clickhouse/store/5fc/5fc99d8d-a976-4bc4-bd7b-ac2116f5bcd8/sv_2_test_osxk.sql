ATTACH TABLE _ UUID '4a8e7d6f-34ce-4a99-8df2-7e877a4ee14a'
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
    `c_105_ep01a_suspected_malaria_fever` Float64,
    `c_105_ep01b_2019_malaria_total` Float64,
    `c_105_ep01b_malaria_tested_b_s_rdt` Float64,
    `c_105_ep01c_malaria_confirmed_b_s_rdt` Float64,
    `c_105_ep01d_confirmed_malaria_cases_treated` Float64,
    `c_105_ep01e_total_malaria_cases_treated` Float64,
    `c_105_ep01a_suspected_fever` Float64,
    `c_105_ep01b_malaria_total` Float64
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
