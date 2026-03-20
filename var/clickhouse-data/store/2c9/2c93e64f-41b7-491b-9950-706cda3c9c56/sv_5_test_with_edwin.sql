ATTACH TABLE _ UUID '74602d98-647b-472d-973a-13d4c392b8e8'
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
    `c_105_ep01b_2019_malaria_total` Nullable(Float32),
    `c_105_ep01a_suspected_fever` Nullable(Float32),
    `c_105_ep01b_malaria_total` Nullable(Float32),
    `c_105_ep01c_malaria_confirmed_b_s_and_rdt_positive` Nullable(Float32)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
