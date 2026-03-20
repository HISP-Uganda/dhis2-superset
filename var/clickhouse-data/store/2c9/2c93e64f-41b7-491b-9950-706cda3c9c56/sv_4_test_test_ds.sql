ATTACH TABLE _ UUID '5679e7ca-eab0-46b8-9131-2a44ccb6b44b'
(
    `dhis2_instance` Nullable(String),
    `national` Nullable(String),
    `region` Nullable(String),
    `district_city` Nullable(String),
    `dlg_municipality_city_council` Nullable(String),
    `period` Nullable(String),
    `c_105_ep01a_suspected_malaria_fever` Nullable(Float32),
    `c_105_ep01b_2019_malaria_total` Nullable(Float32),
    `c_105_ep01b_malaria_tested_b_s_rdt` Nullable(Float32),
    `c_105_ep01c_malaria_confirmed_b_s_rdt` Nullable(Float32),
    `c_105_ep01d_confirmed_malaria_cases_treated` Nullable(Float32),
    `c_105_ep01e_total_malaria_cases_treated` Nullable(Float32),
    `c_105_ep01a_suspected_fever` Nullable(Float32)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
