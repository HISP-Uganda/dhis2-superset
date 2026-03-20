ATTACH TABLE _ UUID '0548718c-d53a-4752-9cf4-71df1b1214c8'
(
    `dhis2_instance` Nullable(String),
    `national` Nullable(String),
    `region` Nullable(String),
    `district_city` Nullable(String),
    `dlg_municipality_city_council` Nullable(String),
    `sub_county_town_council_division` Nullable(String),
    `health_facility` Nullable(String),
    `ward_department` Nullable(String),
    `schools` Nullable(String),
    `period` Nullable(String),
    `c_105_ep01a_suspected_malaria_fever` Nullable(Float32),
    `c_105_ep01b_malaria_tested_b_s_rdt` Nullable(Float32),
    `c_105_ep01c_malaria_confirmed_b_s_rdt` Nullable(Float32),
    `c_105_ep01d_confirmed_malaria_cases_treated` Nullable(Float32),
    `c_105_ep01e_total_malaria_cases_treated` Nullable(Float32),
    `itn_number_of_net_distributed` Nullable(Float32),
    `itn_number_of_nets_allocated` Nullable(Float32),
    `itn_number_of_net_planned` Nullable(Float32),
    `total_malaria_cases_confirmed_presumed_expected_reports` Nullable(Float32),
    `mal_targeted_households_given_nets` Nullable(Float32)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
