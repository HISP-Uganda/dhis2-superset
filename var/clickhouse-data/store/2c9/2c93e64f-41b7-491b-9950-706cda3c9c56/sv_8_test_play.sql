ATTACH TABLE _ UUID 'f8cb95a8-e965-4334-a91f-ddeb1ff3d1c7'
(
    `national` Nullable(String),
    `district` Nullable(String),
    `chiefdom` Nullable(String),
    `period` Nullable(String),
    `anc_1st_visit` Nullable(Float64),
    `anc_2nd_visit` Nullable(Float64),
    `anc_3rd_visit` Nullable(Float64),
    `anc_4th_or_more_visits` Nullable(Float64),
    `albendazole_given_at_anc_2nd_trimester` Nullable(Float64),
    `iron_folate_given_at_anc_3rd` Nullable(Float64),
    `llitn_given_at_anc_1st` Nullable(Float64),
    `mch_anc_visit` Nullable(String),
    `mnch_anc_attendance` Nullable(Float64),
    `mnch_anc_registrants` Nullable(Float64),
    `mnch_cases_of_anaemia_during_anc` Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY tuple()
SETTINGS index_granularity = 8192
