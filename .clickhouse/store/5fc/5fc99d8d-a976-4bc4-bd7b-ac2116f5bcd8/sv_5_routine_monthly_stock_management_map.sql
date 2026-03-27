ATTACH TABLE _ UUID '4555b253-03ca-49ce-b43d-9293ee2d0a97'
(
    `period` LowCardinality(String),
    `national` LowCardinality(String),
    `region` LowCardinality(String),
    `district_city` LowCardinality(String),
    `ou_level` UInt16,
    `c_105_ss01a_artemether_lumefantrine_120_20_mg_quantity_consumed` Nullable(Float64),
    `c_105_ss01b_artemether_lumefantrine_120_20_mg_days_out_of_stock` Nullable(Float64),
    `c_105_ss01c_artemether_lumefantrine_120_20_mg_stock_on_hand` Nullable(Float64),
    `c_105_ss01d_artemether_lumefantrine_120_20_mg_quantity_expired` Nullable(Float64),
    `c_105_ss02a_artesunate_60mg_quantity_consumed` Nullable(Float64),
    `c_105_ss02b_artesunate_60mg_days_out_of_stock` Nullable(Float64),
    `c_105_ss02c_artesunate_60mg_stock_on_hand` Nullable(Float64),
    `c_105_ss02d_artesunate_60mg_quantity_expired` Nullable(Float64),
    `c_105_ss03a_long_lasting_insecticidal_nets_llins_quantity_consumed` Nullable(Float64),
    `c_105_ss03b_long_lasting_insecticidal_nets_llins_days_out_of_stock` Nullable(Float64),
    `c_105_ss03c_long_lasting_insecticidal_nets_llins_stock_on_hand` Nullable(Float64),
    `c_105_ss03d_long_lasting_insecticidal_nets_llins_quantity_expired` Nullable(Float64),
    `c_105_ss34a_malaria_rapid_diagnostic_tests_quantity_consumed` Nullable(Float64),
    `c_105_ss34b_malaria_rapid_diagnostic_tests_days_out_of_stock` Nullable(Float64),
    `c_105_ss34c_malaria_rapid_diagnostic_tests_stock_on_hand` Nullable(Float64),
    `c_105_ss34d_malaria_rapid_diagnostic_tests_quantity_expired` Nullable(Float64),
    `c_105_wt12a_malaria_opening_balance` Nullable(Float64),
    `c_105_wt12b_malaria_received` Nullable(Float64),
    `c_105_wt12c_malaria_closing_balance` Nullable(Float64),
    `c_105_wt12d_malaria_doses_wasted` Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (period, ou_level, national, region, district_city)
SETTINGS allow_nullable_key = 1, index_granularity = 8192
