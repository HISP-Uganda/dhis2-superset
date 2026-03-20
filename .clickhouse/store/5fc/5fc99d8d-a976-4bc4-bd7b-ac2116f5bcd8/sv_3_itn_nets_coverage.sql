ATTACH TABLE _ UUID 'e9b8b042-5c42-4028-a6b0-8ead728cd430'
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
    `itn_number_of_net_distributed` Float64,
    `itn_number_of_net_planned` Float64,
    `itn_number_of_nets_allocated` Float64
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
