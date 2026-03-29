# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""Tests for DHIS2 analytical serving column projection."""

from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from types import SimpleNamespace
from unittest.mock import patch


def _make_dataset():
    return SimpleNamespace(
        id=8,
        database_id=10,
        variables=[
            SimpleNamespace(
                instance_id=1,
                variable_id="de_anc",
                variable_type="dataElement",
                variable_name="ANC 1st Visit",
                alias=None,
                instance=SimpleNamespace(id=1, name="HMIS-Test"),
                staged_dataset_id=None,
                get_extra_params=lambda: {},
            ),
            SimpleNamespace(
                instance_id=2,
                variable_id="ind_reporting",
                variable_type="indicator",
                variable_name="Reporting Rate",
                alias=None,
                instance=SimpleNamespace(id=2, name="Non Routine DHIS2"),
                staged_dataset_id=None,
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1, 2],
            "periods": ["2024Q1"],
            "org_unit_scope": "children",
            "org_unit_details": [
                {
                    "id": "root-a",
                    "source_org_unit_id": "root-a",
                    "level": 1,
                    "source_instance_ids": [1],
                },
                {
                    "id": "root-b",
                    "source_org_unit_id": "root-b",
                    "level": 1,
                    "source_instance_ids": [2],
                },
            ],
        },
    )


def _metadata_payloads():
    return {
        ("dhis2_snapshot:organisationUnitLevels", 1): {
            "status": "success",
            "result": [
                {"level": 1, "displayName": "Region"},
                {"level": 2, "displayName": "District"},
            ],
        },
        ("dhis2_snapshot:organisationUnitLevels", 2): {
            "status": "success",
            "result": [
                {"level": 1, "displayName": "Region"},
                {"level": 2, "displayName": "District"},
            ],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 1): {
            "status": "success",
            "result": [
                {
                    "id": "root-a",
                    "name": "Central",
                    "displayName": "Central",
                    "level": 1,
                    "path": "/root-a",
                },
                {
                    "id": "ou-a",
                    "name": "Kampala",
                    "displayName": "Kampala",
                    "level": 2,
                    "path": "/root-a/ou-a",
                },
            ],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 2): {
            "status": "success",
            "result": [
                {
                    "id": "root-b",
                    "name": "Eastern",
                    "displayName": "Eastern",
                    "level": 1,
                    "path": "/root-b",
                },
                {
                    "id": "ou-b",
                    "name": "Mbale",
                    "displayName": "Mbale",
                    "level": 2,
                    "path": "/root-b/ou-b",
                },
            ],
        },
        ("dhis2_snapshot:dataElements", 1): {
            "status": "success",
            "result": [
                {
                    "id": "de_anc",
                    "displayName": "ANC 1st Visit",
                    "valueType": "NUMBER",
                }
            ],
        },
        ("dhis2_snapshot:indicators", 2): {
            "status": "success",
            "result": [
                {
                    "id": "ind_reporting",
                    "displayName": "Reporting Rate",
                    "valueType": "PERCENTAGE",
                }
            ],
        },
    }


def test_build_serving_manifest_uses_user_facing_dimensions_and_variables():
    from superset.dhis2.analytical_serving import build_serving_manifest

    payloads = _metadata_payloads()

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(_make_dataset())

    columns = manifest["columns"]
    verbose_names = [column["verbose_name"] for column in columns]

    assert verbose_names == [
        "DHIS2 Instance",
        "Region",
        "District",
        "Period",
        "OU Level",
        "Period Year",
        "Period Half",
        "Period Quarter",
        "ANC 1st Visit",
        "Reporting Rate",
        "Manifest Build Version",
    ]
    assert [column["type"] for column in columns[-3:-1]] == ["FLOAT", "FLOAT"]
    assert manifest["dimension_column_names"] == [
        "dhis2_instance",
        "region",
        "district",
        "period",
        "ou_level",
    ]


def test_build_serving_manifest_carries_staged_dhis2_legend_on_metric_columns():
    from superset.dhis2.analytical_serving import build_serving_manifest

    payloads = _metadata_payloads()
    payloads[("dhis2_snapshot:dataElements", 1)]["result"][0]["legendDefinition"] = {
        "source": "dhis2",
        "setId": "legend_set_1",
        "setName": "ANC Thresholds",
        "min": 0.0,
        "max": 500.0,
        "items": [
            {
                "id": "legend_1",
                "label": "Low",
                "startValue": 0.0,
                "endValue": 100.0,
                "color": "#2ca25f",
            },
            {
                "id": "legend_2",
                "label": "High",
                "startValue": 100.0,
                "endValue": 500.0,
                "color": "#de2d26",
            },
        ],
    }

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(_make_dataset())

    anc_column = next(
        column
        for column in manifest["columns"]
        if column["column_name"] == "anc_1st_visit"
    )
    assert anc_column["extra"]["dhis2_variable_id"] == "de_anc"
    assert anc_column["extra"]["dhis2_source_instance_id"] == 1
    assert anc_column["extra"]["dhis2_legend"]["setName"] == "ANC Thresholds"
    assert anc_column["extra"]["dhis2_legend"]["items"][1]["color"] == "#de2d26"


def test_materialize_serving_rows_pivots_local_rows_into_chart_ready_columns():
    from superset.dhis2.analytical_serving import (
        build_serving_manifest,
        materialize_serving_rows,
    )

    dataset = _make_dataset()
    payloads = _metadata_payloads()
    raw_rows = [
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS-Test",
            "dx_uid": "de_anc",
            "pe": "2024Q1",
            "ou": "ou-a",
            "ou_name": "Kampala",
            "value": "12",
            "value_numeric": 12.0,
        },
        {
            "source_instance_id": 2,
            "source_instance_name": "Non Routine DHIS2",
            "dx_uid": "ind_reporting",
            "pe": "2024Q1",
            "ou": "ou-b",
            "ou_name": "Mbale",
            "value": "95.3",
            "value_numeric": 95.3,
        },
    ]

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)
        columns, rows = materialize_serving_rows(dataset, raw_rows, manifest)

    assert [column["column_name"] for column in columns] == [
        "dhis2_instance",
        "region",
        "district",
        "period",
        "ou_level",
        "period_year",
        "period_half",
        "period_quarter",
        "anc_1st_visit",
        "reporting_rate",
        "_manifest_build_v7",
    ]
    assert rows == [
        {
            "dhis2_instance": "HMIS-Test",
            "region": "Central",
            "district": "Kampala",
            "period": "2024Q1",
            "ou_level": None,
            "period_year": "2024",
            "period_half": "2024S1",
            "period_quarter": "2024Q1",
            "anc_1st_visit": 12.0,
            "reporting_rate": None,
            "_manifest_build_v7": None,
        },
        {
            "dhis2_instance": "Non Routine DHIS2",
            "region": "Eastern",
            "district": "Mbale",
            "period": "2024Q1",
            "ou_level": None,
            "period_year": "2024",
            "period_half": "2024S1",
            "period_quarter": "2024Q1",
            "reporting_rate": 95.3,
            "anc_1st_visit": None,
            "_manifest_build_v7": None,
        },
    ]


def test_build_serving_manifest_applies_repository_enabled_dimensions():
    from superset.dhis2.analytical_serving import (
        build_serving_manifest,
        materialize_serving_rows,
    )

    dataset = SimpleNamespace(
        id=21,
        database_id=10,
        database=SimpleNamespace(
            repository_org_unit_config={
                "enabled_dimensions": {
                    "levels": [
                        {
                            "key": "level:2",
                            "label": "District",
                            "repository_level": 2,
                            "source_refs": [{"instance_id": 1, "source_level": 2}],
                        }
                    ],
                    "groups": [
                        {
                            "key": "g_urban",
                            "label": "Urban",
                            "source_refs": [{"instance_id": 1, "source_id": "g_urban"}],
                        }
                    ],
                    "group_sets": [
                        {
                            "key": "gs_ownership",
                            "label": "Ownership",
                            "source_refs": [
                                {"instance_id": 1, "source_id": "gs_ownership"}
                            ],
                        }
                    ],
                }
            }
        ),
        variables=[
            SimpleNamespace(
                instance_id=1,
                variable_id="de_cases",
                variable_type="dataElement",
                variable_name="Cases",
                alias=None,
                instance=SimpleNamespace(id=1, name="HMIS-Test"),
                staged_dataset_id=None,
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1],
            "periods": ["2024Q1"],
            "org_unit_scope": "children",
            "org_unit_details": [
                {
                    "id": "root-a",
                    "source_org_unit_id": "root-a",
                    "level": 1,
                    "source_instance_ids": [1],
                }
            ],
        },
    )
    payloads = {
        ("dhis2_snapshot:organisationUnitLevels", 1): {
            "status": "success",
            "result": [
                {"level": 1, "displayName": "Region"},
                {"level": 2, "displayName": "District"},
            ],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 1): {
            "status": "success",
            "result": [
                {
                    "id": "root-a",
                    "name": "Central",
                    "displayName": "Central",
                    "level": 1,
                    "path": "/root-a",
                },
                {
                    "id": "ou-a",
                    "name": "Kampala",
                    "displayName": "Kampala",
                    "level": 2,
                    "path": "/root-a/ou-a",
                },
            ],
        },
        ("dhis2_snapshot:organisationUnitGroups", 1): {
            "status": "success",
            "result": [
                {
                    "id": "g_urban",
                    "displayName": "Urban",
                    "organisationUnits": [{"id": "ou-a"}],
                },
                {
                    "id": "g_public",
                    "displayName": "Public",
                    "organisationUnits": [{"id": "ou-a"}],
                },
            ],
        },
        ("dhis2_snapshot:organisationUnitGroupSets", 1): {
            "status": "success",
            "result": [
                {
                    "id": "gs_ownership",
                    "displayName": "Ownership",
                    "organisationUnitGroups": [
                        {"id": "g_public", "displayName": "Public"}
                    ],
                }
            ],
        },
        ("dhis2_snapshot:dataElements", 1): {
            "status": "success",
            "result": [
                {
                    "id": "de_cases",
                    "displayName": "Cases",
                    "valueType": "NUMBER",
                }
            ],
        },
    }
    raw_rows = [
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS-Test",
            "dx_uid": "de_cases",
            "pe": "2024Q1",
            "ou": "ou-a",
            "ou_name": "Kampala",
            "value": "12",
            "value_numeric": 12.0,
        }
    ]

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)
        _, rows = materialize_serving_rows(dataset, raw_rows, manifest)

    assert [column["verbose_name"] for column in manifest["columns"][:5]] == [
        "District",
        "Urban",
        "Ownership",
        "Period",
        "OU Level",
    ]
    assert manifest["dimension_column_names"][:3] == [
        "district",
        "urban",
        "ownership",
    ]
    assert rows == [
        {
            "district": "Kampala",
            "urban": "Urban",
            "ownership": "Public",
            "period": "2024Q1",
            "ou_level": None,
            "period_year": "2024",
            "period_half": "2024S1",
            "period_quarter": "2024Q1",
            "cases": 12.0,
            "_manifest_build_v7": None,
        }
    ]


def test_build_serving_manifest_respects_dataset_specific_repository_dimension_subset():
    from superset.dhis2.analytical_serving import (
        build_serving_manifest,
        materialize_serving_rows,
    )

    dataset = SimpleNamespace(
        id=21,
        database_id=10,
        database=SimpleNamespace(
            repository_org_unit_config={
                "enabled_dimensions": {
                    "levels": [
                        {
                            "key": "level:2",
                            "label": "District",
                            "repository_level": 2,
                            "source_refs": [{"instance_id": 1, "source_level": 2}],
                        }
                    ],
                    "groups": [
                        {
                            "key": "g_urban",
                            "label": "Urban",
                            "source_refs": [{"instance_id": 1, "source_id": "g_urban"}],
                        }
                    ],
                    "group_sets": [
                        {
                            "key": "gs_ownership",
                            "label": "Ownership",
                            "source_refs": [
                                {"instance_id": 1, "source_id": "gs_ownership"}
                            ],
                        }
                    ],
                }
            }
        ),
        variables=[
            SimpleNamespace(
                instance_id=1,
                variable_id="de_cases",
                variable_type="dataElement",
                variable_name="Cases",
                alias=None,
                instance=SimpleNamespace(id=1, name="HMIS-Test"),
                staged_dataset_id=None,
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1],
            "periods": ["2024Q1"],
            "org_unit_scope": "children",
            "repository_enabled_dimensions": {
                "levels": ["level:2"],
                "groups": [],
                "group_sets": ["gs_ownership"],
            },
            "org_unit_details": [
                {
                    "id": "root-a",
                    "source_org_unit_id": "root-a",
                    "level": 1,
                    "source_instance_ids": [1],
                }
            ],
        },
    )
    payloads = {
        ("dhis2_snapshot:organisationUnitLevels", 1): {
            "status": "success",
            "result": [
                {"level": 1, "displayName": "Region"},
                {"level": 2, "displayName": "District"},
            ],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 1): {
            "status": "success",
            "result": [
                {
                    "id": "root-a",
                    "name": "Central",
                    "displayName": "Central",
                    "level": 1,
                    "path": "/root-a",
                },
                {
                    "id": "ou-a",
                    "name": "Kampala",
                    "displayName": "Kampala",
                    "level": 2,
                    "path": "/root-a/ou-a",
                },
            ],
        },
        ("dhis2_snapshot:organisationUnitGroups", 1): {
            "status": "success",
            "result": [
                {
                    "id": "g_urban",
                    "displayName": "Urban",
                    "organisationUnits": [{"id": "ou-a"}],
                },
                {
                    "id": "g_public",
                    "displayName": "Public",
                    "organisationUnits": [{"id": "ou-a"}],
                },
            ],
        },
        ("dhis2_snapshot:organisationUnitGroupSets", 1): {
            "status": "success",
            "result": [
                {
                    "id": "gs_ownership",
                    "displayName": "Ownership",
                    "organisationUnitGroups": [
                        {"id": "g_public", "displayName": "Public"}
                    ],
                }
            ],
        },
        ("dhis2_snapshot:dataElements", 1): {
            "status": "success",
            "result": [
                {
                    "id": "de_cases",
                    "displayName": "Cases",
                    "valueType": "NUMBER",
                }
            ],
        },
    }
    raw_rows = [
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS-Test",
            "dx_uid": "de_cases",
            "pe": "2024Q1",
            "ou": "ou-a",
            "ou_name": "Kampala",
            "value": "12",
            "value_numeric": 12.0,
        }
    ]

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)
        _, rows = materialize_serving_rows(dataset, raw_rows, manifest)

    assert manifest["dimension_column_names"][:2] == [
        "district",
        "ownership",
    ]
    assert "urban" not in manifest["dimension_column_names"]
    assert rows == [
        {
            "district": "Kampala",
            "ownership": "Public",
            "period": "2024Q1",
            "ou_level": None,
            "period_year": "2024",
            "period_half": "2024S1",
            "period_quarter": "2024Q1",
            "cases": 12.0,
            "_manifest_build_v7": None,
        }
    ]


def test_build_serving_manifest_defaults_all_org_unit_groups_and_group_sets():
    from superset.dhis2.analytical_serving import (
        build_serving_manifest,
        materialize_serving_rows,
    )

    dataset = SimpleNamespace(
        id=22,
        database_id=10,
        database=SimpleNamespace(repository_org_unit_config={}),
        variables=[
            SimpleNamespace(
                instance_id=1,
                variable_id="de_cases",
                variable_type="dataElement",
                variable_name="Cases",
                alias=None,
                instance=SimpleNamespace(id=1, name="HMIS-Test"),
                staged_dataset_id=None,
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1],
            "periods": ["2024Q1"],
            "org_unit_scope": "children",
            "org_unit_details": [
                {
                    "id": "root-a",
                    "source_org_unit_id": "root-a",
                    "level": 1,
                    "source_instance_ids": [1],
                }
            ],
        },
    )
    payloads = {
        ("dhis2_snapshot:organisationUnitLevels", 1): {
            "status": "success",
            "result": [
                {"level": 1, "displayName": "Region"},
                {"level": 2, "displayName": "District"},
            ],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 1): {
            "status": "success",
            "result": [
                {
                    "id": "root-a",
                    "name": "Central",
                    "displayName": "Central",
                    "level": 1,
                    "path": "/root-a",
                },
                {
                    "id": "ou-a",
                    "name": "Kampala",
                    "displayName": "Kampala",
                    "level": 2,
                    "path": "/root-a/ou-a",
                },
            ],
        },
        ("dhis2_snapshot:organisationUnitGroups", 1): {
            "status": "success",
            "result": [
                {
                    "id": "g_urban",
                    "displayName": "Urban",
                    "organisationUnits": [{"id": "ou-a"}],
                },
                {
                    "id": "g_public",
                    "displayName": "Public",
                    "organisationUnits": [{"id": "ou-a"}],
                },
            ],
        },
        ("dhis2_snapshot:organisationUnitGroupSets", 1): {
            "status": "success",
            "result": [
                {
                    "id": "gs_ownership",
                    "displayName": "Ownership",
                    "organisationUnitGroups": [
                        {"id": "g_public", "displayName": "Public"}
                    ],
                }
            ],
        },
        ("dhis2_snapshot:dataElements", 1): {
            "status": "success",
            "result": [
                {
                    "id": "de_cases",
                    "displayName": "Cases",
                    "valueType": "NUMBER",
                }
            ],
        },
    }
    raw_rows = [
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS-Test",
            "dx_uid": "de_cases",
            "pe": "2024Q1",
            "ou": "ou-a",
            "ou_name": "Kampala",
            "value": "12",
            "value_numeric": 12.0,
        }
    ]

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)
        _, rows = materialize_serving_rows(dataset, raw_rows, manifest)

    assert manifest["dimension_column_names"][:5] == [
        "region",
        "district",
        "urban",
        "public",
        "ownership",
    ]
    assert rows == [
        {
            "region": "Central",
            "district": "Kampala",
            "urban": "Urban",
            "public": "Public",
            "ownership": "Public",
            "period": "2024Q1",
            "ou_level": None,
            "period_year": "2024",
            "period_half": "2024S1",
            "period_quarter": "2024Q1",
            "cases": 12.0,
            "_manifest_build_v7": None,
        }
    ]


def test_build_serving_manifest_materializes_only_selected_org_unit_levels():
    from superset.dhis2.analytical_serving import build_serving_manifest

    dataset = SimpleNamespace(
        id=9,
        database_id=10,
        variables=[
            SimpleNamespace(
                instance_id=1,
                variable_id="de_cases",
                variable_type="dataElement",
                variable_name="Malaria Cases",
                alias=None,
                instance=SimpleNamespace(id=1, name="HMIS-Test"),
                staged_dataset_id=None,
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1],
            "periods": ["2024Q1"],
            "org_unit_scope": "selected",
            "org_unit_details": [
                {
                    "id": "ou-district",
                    "source_org_unit_id": "ou-district",
                    "level": 3,
                    "source_instance_ids": [1],
                }
            ],
        },
    )
    payloads = {
        ("dhis2_snapshot:organisationUnitLevels", 1): {
            "status": "success",
            "result": [
                {"level": 1, "displayName": "National"},
                {"level": 2, "displayName": "Region"},
                {"level": 3, "displayName": "District"},
                {"level": 4, "displayName": "Facility"},
            ],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 1): {
            "status": "success",
            "result": [
                {
                    "id": "ou-national",
                    "displayName": "Uganda",
                    "level": 1,
                    "path": "/ou-national",
                },
                {
                    "id": "ou-region",
                    "displayName": "Central",
                    "level": 2,
                    "path": "/ou-national/ou-region",
                },
                {
                    "id": "ou-district",
                    "displayName": "Kampala",
                    "level": 3,
                    "path": "/ou-national/ou-region/ou-district",
                },
                {
                    "id": "ou-facility",
                    "displayName": "Mulago",
                    "level": 4,
                    "path": "/ou-national/ou-region/ou-district/ou-facility",
                },
            ],
        },
        ("dhis2_snapshot:dataElements", 1): {
            "status": "success",
            "result": [
                {
                    "id": "de_cases",
                    "displayName": "Malaria Cases",
                    "valueType": "NUMBER",
                }
            ],
        },
    }

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)

    assert [column["verbose_name"] for column in manifest["columns"]] == [
        "District",
        "Period",
        "OU Level",
        "Period Year",
        "Period Half",
        "Period Quarter",
        "Malaria Cases",
        "Manifest Build Version",
    ]


def test_build_serving_manifest_prunes_redundant_selected_descendants_for_level_range():
    from superset.dhis2.analytical_serving import build_serving_manifest

    dataset = SimpleNamespace(
        id=10,
        database_id=10,
        variables=[
            SimpleNamespace(
                instance_id=1,
                variable_id="de_cases",
                variable_type="dataElement",
                variable_name="Malaria Cases",
                alias=None,
                instance=SimpleNamespace(id=1, name="HMIS-Test"),
                staged_dataset_id=None,
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1],
            "periods": ["2024Q1"],
            "org_unit_scope": "grandchildren",
            "org_units": [
                "ou-region",
                "ou-district",
                "ou-subcounty",
                "ou-facility",
            ],
            "org_unit_details": [
                {
                    "id": "ou-region",
                    "selectionKey": "ou-region",
                    "sourceOrgUnitId": "ou-region",
                    "level": 2,
                    "path": "/ou-national/ou-region",
                    "sourceInstanceIds": [1],
                },
                {
                    "id": "ou-district",
                    "selectionKey": "ou-district",
                    "sourceOrgUnitId": "ou-district",
                    "level": 3,
                    "path": "/ou-national/ou-region/ou-district",
                    "sourceInstanceIds": [1],
                },
                {
                    "id": "ou-subcounty",
                    "selectionKey": "ou-subcounty",
                    "sourceOrgUnitId": "ou-subcounty",
                    "level": 4,
                    "path": "/ou-national/ou-region/ou-district/ou-subcounty",
                    "sourceInstanceIds": [1],
                },
                {
                    "id": "ou-facility",
                    "selectionKey": "ou-facility",
                    "sourceOrgUnitId": "ou-facility",
                    "level": 5,
                    "path": "/ou-national/ou-region/ou-district/ou-subcounty/ou-facility",
                    "sourceInstanceIds": [1],
                },
            ],
        },
    )
    payloads = {
        ("dhis2_snapshot:organisationUnitLevels", 1): {
            "status": "success",
            "result": [
                {"level": 1, "displayName": "National"},
                {"level": 2, "displayName": "Region"},
                {"level": 3, "displayName": "District"},
                {"level": 4, "displayName": "Subcounty"},
                {"level": 5, "displayName": "Facility"},
            ],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 1): {
            "status": "success",
            "result": [
                {"id": "ou-national", "displayName": "Uganda", "level": 1, "path": "/ou-national"},
                {"id": "ou-region", "displayName": "Acholi", "level": 2, "path": "/ou-national/ou-region"},
                {"id": "ou-district", "displayName": "Gulu", "level": 3, "path": "/ou-national/ou-region/ou-district"},
                {"id": "ou-subcounty", "displayName": "Pece", "level": 4, "path": "/ou-national/ou-region/ou-district/ou-subcounty"},
                {"id": "ou-facility", "displayName": "Health Centre IV", "level": 5, "path": "/ou-national/ou-region/ou-district/ou-subcounty/ou-facility"},
            ],
        },
        ("dhis2_snapshot:dataElements", 1): {
            "status": "success",
            "result": [
                {
                    "id": "de_cases",
                    "displayName": "Malaria Cases",
                    "valueType": "NUMBER",
                }
            ],
        },
    }

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)

    assert [column["verbose_name"] for column in manifest["columns"]] == [
        "Region",
        "District",
        "Subcounty",
        "Facility",
        "Period",
        "OU Level",
        "Period Year",
        "Period Half",
        "Period Quarter",
        "Malaria Cases",
        "Manifest Build Version",
    ]


def test_build_serving_manifest_honors_explicit_period_hierarchy_keys():
    from superset.dhis2.analytical_serving import build_serving_manifest

    dataset = SimpleNamespace(
        id=11,
        database_id=10,
        variables=[
            SimpleNamespace(
                instance_id=1,
                variable_id="de_cases",
                variable_type="dataElement",
                variable_name="Malaria Cases",
                alias=None,
                instance=SimpleNamespace(id=1, name="HMIS-Test"),
                staged_dataset_id=None,
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1],
            "periods": ["202401"],
            "period_hierarchy_keys": ["year", "month"],
            "org_unit_scope": "selected",
            "org_unit_details": [
                {
                    "id": "ou-district",
                    "source_org_unit_id": "ou-district",
                    "level": 3,
                    "source_instance_ids": [1],
                }
            ],
        },
    )
    payloads = {
        ("dhis2_snapshot:organisationUnitLevels", 1): {
            "status": "success",
            "result": [
                {"level": 1, "displayName": "National"},
                {"level": 2, "displayName": "Region"},
                {"level": 3, "displayName": "District"},
            ],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 1): {
            "status": "success",
            "result": [
                {
                    "id": "ou-district",
                    "displayName": "Kampala",
                    "level": 3,
                    "path": "/ou-national/ou-region/ou-district",
                },
            ],
        },
        ("dhis2_snapshot:dataElements", 1): {
            "status": "success",
            "result": [
                {
                    "id": "de_cases",
                    "displayName": "Malaria Cases",
                    "valueType": "NUMBER",
                }
            ],
        },
    }

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)

    assert [column["column_name"] for column in manifest["columns"]] == [
        "district",
        "period",
        "ou_level",
        "period_year",
        "period_month",
        "malaria_cases",
        "_manifest_build_v7",
    ]


def test_build_serving_manifest_keeps_all_explicit_selected_org_unit_levels():
    from superset.dhis2.analytical_serving import build_serving_manifest

    dataset = SimpleNamespace(
        id=12,
        database_id=10,
        variables=[
            SimpleNamespace(
                instance_id=1,
                variable_id="de_cases",
                variable_type="dataElement",
                variable_name="Malaria Cases",
                alias=None,
                instance=SimpleNamespace(id=1, name="HMIS-Test"),
                staged_dataset_id=None,
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1],
            "periods": ["2024Q1"],
            "org_unit_scope": "selected",
            "org_units": [
                "ou-national",
                "ou-region",
                "ou-district",
                "ou-subcounty",
                "ou-facility",
            ],
            "org_unit_details": [
                {
                    "id": "ou-national",
                    "selectionKey": "ou-national",
                    "sourceOrgUnitId": "ou-national",
                    "level": 1,
                    "path": "/ou-national",
                    "sourceInstanceIds": [1],
                },
                {
                    "id": "ou-region",
                    "selectionKey": "ou-region",
                    "sourceOrgUnitId": "ou-region",
                    "level": 2,
                    "path": "/ou-national/ou-region",
                    "sourceInstanceIds": [1],
                },
                {
                    "id": "ou-district",
                    "selectionKey": "ou-district",
                    "sourceOrgUnitId": "ou-district",
                    "level": 3,
                    "path": "/ou-national/ou-region/ou-district",
                    "sourceInstanceIds": [1],
                },
                {
                    "id": "ou-subcounty",
                    "selectionKey": "ou-subcounty",
                    "sourceOrgUnitId": "ou-subcounty",
                    "level": 4,
                    "path": "/ou-national/ou-region/ou-district/ou-subcounty",
                    "sourceInstanceIds": [1],
                },
                {
                    "id": "ou-facility",
                    "selectionKey": "ou-facility",
                    "sourceOrgUnitId": "ou-facility",
                    "level": 5,
                    "path": "/ou-national/ou-region/ou-district/ou-subcounty/ou-facility",
                    "sourceInstanceIds": [1],
                },
            ],
        },
    )
    payloads = {
        ("dhis2_snapshot:organisationUnitLevels", 1): {
            "status": "success",
            "result": [
                {"level": 1, "displayName": "National"},
                {"level": 2, "displayName": "Region"},
                {"level": 3, "displayName": "District"},
                {"level": 4, "displayName": "Subcounty"},
                {"level": 5, "displayName": "Facility"},
            ],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 1): {
            "status": "success",
            "result": [
                {"id": "ou-national", "displayName": "Uganda", "level": 1, "path": "/ou-national"},
                {"id": "ou-region", "displayName": "Acholi", "level": 2, "path": "/ou-national/ou-region"},
                {"id": "ou-district", "displayName": "Gulu", "level": 3, "path": "/ou-national/ou-region/ou-district"},
                {"id": "ou-subcounty", "displayName": "Pece", "level": 4, "path": "/ou-national/ou-region/ou-district/ou-subcounty"},
                {"id": "ou-facility", "displayName": "Health Centre IV", "level": 5, "path": "/ou-national/ou-region/ou-district/ou-subcounty/ou-facility"},
            ],
        },
        ("dhis2_snapshot:dataElements", 1): {
            "status": "success",
            "result": [
                {
                    "id": "de_cases",
                    "displayName": "Malaria Cases",
                    "valueType": "NUMBER",
                }
            ],
        },
    }

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)

    assert [column["verbose_name"] for column in manifest["columns"]] == [
        "National",
        "Region",
        "District",
        "Subcounty",
        "Facility",
        "Period",
        "OU Level",
        "Period Year",
        "Period Half",
        "Period Quarter",
        "Malaria Cases",
        "Manifest Build Version",
    ]


def test_terminal_level_helpers_include_only_rows_where_selected_level_is_last_populated():
    from superset.dhis2.analytical_serving import (
        build_terminal_hierarchy_sqla_predicate,
        get_dhis2_hierarchy_column_names,
        is_terminal_at_selected_level,
        resolve_terminal_hierarchy_column,
    )

    columns = [
        {
            "column_name": "level1",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
                "dhis2_ou_level": 1,
            },
        },
        {
            "column_name": "level2",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
                "dhis2_ou_level": 2,
            },
        },
        {
            "column_name": "level3",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
                "dhis2_ou_level": 3,
            },
        },
        {"column_name": "period"},
    ]

    hierarchy_column_names = get_dhis2_hierarchy_column_names(columns)

    assert hierarchy_column_names == ["level1", "level2", "level3"]
    assert (
        resolve_terminal_hierarchy_column(
            ["level1", "level2"],
            hierarchy_column_names,
        )
        == "level2"
    )
    assert (
        resolve_terminal_hierarchy_column(
            ["level1", "level2", "level3"],
            hierarchy_column_names,
            preferred_selected_column="level2",
        )
        == "level2"
    )
    assert is_terminal_at_selected_level(
        {
            "level1": "Uganda",
            "level2": "Kampala",
            "level3": "",
        },
        hierarchy_column_names,
        "level2",
    )
    assert not is_terminal_at_selected_level(
        {
            "level1": "Uganda",
            "level2": "Kampala",
            "level3": "Central Division",
        },
        hierarchy_column_names,
        "level2",
    )
    assert not is_terminal_at_selected_level(
        {
            "level1": "Uganda",
            "level2": None,
            "level3": "",
        },
        hierarchy_column_names,
        "level2",
    )

    predicate = build_terminal_hierarchy_sqla_predicate(
        "level2",
        hierarchy_column_names,
    )
    assert predicate is not None
    predicate_sql = str(predicate)
    assert "level2" in predicate_sql
    assert "level3" in predicate_sql
    assert "CAST(" not in predicate_sql


def test_hierarchy_helpers_fall_back_to_mart_column_order_when_level_metadata_is_missing():
    from superset.dhis2.analytical_serving import (
        build_terminal_hierarchy_sqla_predicate,
        get_dhis2_hierarchy_column_names,
        resolve_terminal_hierarchy_column,
    )

    columns = [
        {
            "column_name": "national",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
            },
        },
        {
            "column_name": "region",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
            },
        },
        {
            "column_name": "district_city",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
            },
        },
    ]

    hierarchy_column_names = get_dhis2_hierarchy_column_names(columns)

    assert hierarchy_column_names == ["national", "region", "district_city"]
    assert (
        resolve_terminal_hierarchy_column(
            ["district_city"],
            hierarchy_column_names,
        )
        == "district_city"
    )

    predicate = build_terminal_hierarchy_sqla_predicate(
        "district_city",
        hierarchy_column_names,
        terminal=False,
    )
    assert predicate is not None
    predicate_sql = str(predicate)
    assert "district_city" in predicate_sql


def test_hierarchy_helpers_ignore_mis_tagged_legacy_helper_columns_when_canonical_levels_exist():
    from superset.dhis2.analytical_serving import get_dhis2_hierarchy_column_names

    columns = [
        {
            "column_name": "period_variant",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
            },
        },
        {
            "column_name": "national",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
            },
        },
        {
            "column_name": "region",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
            },
        },
        {
            "column_name": "district_city",
            "extra": {
                "dhis2_is_ou_hierarchy": True,
            },
        },
    ]

    assert get_dhis2_hierarchy_column_names(columns) == [
        "national",
        "region",
        "district_city",
    ]


def test_period_hierarchy_helpers_ignore_raw_period_and_order_specific_levels():
    from superset.dhis2.analytical_serving import (
        build_terminal_hierarchy_sqla_predicate,
        get_dhis2_period_hierarchy_column_names,
        resolve_terminal_hierarchy_column,
    )

    columns = [
        {
            "column_name": "period",
            "extra": {
                "dhis2_is_period": True,
                "dhis2_is_period_hierarchy": True,
                "dhis2_period_key": "period",
            },
        },
        {
            "column_name": "period_year",
            "extra": {
                "dhis2_is_period_hierarchy": True,
                "dhis2_period_key": "period_year",
            },
        },
        {
            "column_name": "period_quarter",
            "extra": {
                "dhis2_is_period_hierarchy": True,
                "dhis2_period_key": "period_quarter",
            },
        },
        {
            "column_name": "period_month",
            "extra": {
                "dhis2_is_period_hierarchy": True,
                "dhis2_period_key": "period_month",
            },
        },
    ]

    period_column_names = get_dhis2_period_hierarchy_column_names(columns)

    assert period_column_names == [
        "period_year",
        "period_quarter",
        "period_month",
    ]
    assert (
        resolve_terminal_hierarchy_column(
            ["period_year"],
            period_column_names,
        )
        == "period_year"
    )

    predicate = build_terminal_hierarchy_sqla_predicate(
        "period_year",
        period_column_names,
    )
    assert predicate is not None
    predicate_sql = str(predicate)
    assert "period_year" in predicate_sql
    assert "period_quarter" in predicate_sql
    assert "period_month" in predicate_sql


# ── COC / disaggregation-dimension tests ──────────────────────────────────────


def _make_single_instance_dataset(extra_config=None):
    """Minimal single-instance dataset fixture."""
    config = {
        "configured_connection_ids": [1],
        "org_unit_scope": "selected",
        "org_unit_details": [
            {
                "id": "ou-national",
                "source_org_unit_id": "ou-national",
                "level": 1,
                "source_instance_ids": [1],
            }
        ],
    }
    if extra_config:
        config.update(extra_config)

    variable = SimpleNamespace(
        instance_id=1,
        variable_id="de_malaria",
        variable_type="dataElement",
        variable_name="Malaria Cases",
        alias=None,
        staged_dataset_id=None,
        instance=SimpleNamespace(id=1, name="HMIS"),
    )
    if not hasattr(variable, "get_extra_params"):
        variable.get_extra_params = lambda: {}

    return SimpleNamespace(
        id=20,
        database_id=10,
        variables=[variable],
        get_dataset_config=lambda: config,
    )


def _single_instance_payloads():
    return {
        ("dhis2_snapshot:organisationUnitLevels", 1): {
            "status": "success",
            "result": [{"level": 1, "displayName": "National"}],
        },
        ("dhis2_snapshot:orgUnitHierarchy", 1): {
            "status": "success",
            "result": [
                {
                    "id": "ou-national",
                    "displayName": "Uganda",
                    "level": 1,
                    "path": "/ou-national",
                }
            ],
        },
        ("dhis2_snapshot:dataElements", 1): {
            "status": "success",
            "result": [
                {
                    "id": "de_malaria",
                    "displayName": "Malaria Cases",
                    "valueType": "NUMBER",
                }
            ],
        },
    }


def test_selected_root_details_use_repository_structure_for_lineage_backed_nodes():
    from superset.dhis2.analytical_serving import _selected_root_details

    dataset_config = {
        "org_units": ["1:uganda", "1:uganda/2:kampala"],
        "org_unit_details": [
            {
                "id": "1:uganda",
                "selectionKey": "1:uganda",
                "sourceOrgUnitId": "1:uganda",
                "level": 1,
                "path": "1:uganda",
                "sourceInstanceIds": [101, 102],
                "lineage": [
                    {"instance_id": 101, "source_org_unit_uid": "OU_A_ROOT"},
                    {"instance_id": 102, "source_org_unit_uid": "OU_B_ROOT"},
                ],
            },
            {
                "id": "1:uganda/2:kampala",
                "selectionKey": "1:uganda/2:kampala",
                "sourceOrgUnitId": "1:uganda/2:kampala",
                "level": 2,
                "path": "1:uganda/2:kampala",
                "parentId": "1:uganda",
                "sourceInstanceIds": [101, 102],
                "lineage": [
                    {"instance_id": 101, "source_org_unit_uid": "OU_A_KLA"},
                    {"instance_id": 102, "source_org_unit_uid": "OU_B_KLA"},
                ],
            },
        ],
    }

    roots = _selected_root_details(dataset_config)

    assert [detail["selectionKey"] for detail in roots] == ["1:uganda"]


def test_build_serving_manifest_without_coc_dimension_has_no_co_columns():
    """Default (include_disaggregation_dimension=False) must not add CO columns."""
    from superset.dhis2.analytical_serving import build_serving_manifest

    dataset = _make_single_instance_dataset()
    payloads = _single_instance_payloads()

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)

    col_names = [c["column_name"] for c in manifest["columns"]]
    assert "co_uid" not in col_names
    assert "disaggregation" not in col_names
    assert "aoc_uid" not in col_names
    assert "attribute_option_combo" not in col_names
    assert manifest["coc_uid_column_name"] is None
    assert manifest["coc_name_column_name"] is None
    assert manifest["aoc_uid_column_name"] is None
    assert manifest["aoc_name_column_name"] is None


def test_build_serving_manifest_with_coc_dimension_adds_co_columns():
    """include_disaggregation_dimension=True must expose co_uid and disaggregation columns."""
    from superset.dhis2.analytical_serving import (
        _DHIS2_AOC_EXTRA_KEY,
        _DHIS2_AOC_UID_EXTRA_KEY,
        _DHIS2_COC_EXTRA_KEY,
        _DHIS2_COC_UID_EXTRA_KEY,
        build_serving_manifest,
    )

    dataset = _make_single_instance_dataset(
        extra_config={"include_disaggregation_dimension": True}
    )
    payloads = _single_instance_payloads()

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ), patch(
        "superset.dhis2.analytical_serving._load_distinct_cocs_for_variable",
        return_value=[
            {"co_uid": "coc-male", "co_name": "Male"},
            {"co_uid": "coc-female", "co_name": "Female"},
        ],
    ):
        manifest = build_serving_manifest(dataset)

    col_names = [c["column_name"] for c in manifest["columns"]]
    verbose_names = [c["verbose_name"] for c in manifest["columns"]]

    assert "co_uid" in col_names
    assert "disaggregation" in col_names
    assert "aoc_uid" in col_names
    assert "attribute_option_combo" in col_names
    assert "Category Option Combo (UID)" in verbose_names
    assert "Disaggregation" in verbose_names
    assert "Attribute Option Combo (UID)" in verbose_names
    assert "Attribute Option Combo" in verbose_names

    # Both must be in dimension_column_names
    assert "co_uid" in manifest["dimension_column_names"]
    assert "disaggregation" in manifest["dimension_column_names"]
    assert "aoc_uid" in manifest["dimension_column_names"]
    assert "attribute_option_combo" in manifest["dimension_column_names"]

    # Manifest returns the column name references
    assert manifest["coc_uid_column_name"] == "co_uid"
    assert manifest["coc_name_column_name"] == "disaggregation"
    assert manifest["aoc_uid_column_name"] == "aoc_uid"
    assert manifest["aoc_name_column_name"] == "attribute_option_combo"

    # Extra metadata must carry the right keys
    co_uid_col = next(c for c in manifest["columns"] if c["column_name"] == "co_uid")
    co_name_col = next(c for c in manifest["columns"] if c["column_name"] == "disaggregation")
    aoc_uid_col = next(c for c in manifest["columns"] if c["column_name"] == "aoc_uid")
    aoc_name_col = next(
        c for c in manifest["columns"] if c["column_name"] == "attribute_option_combo"
    )
    assert co_uid_col["extra"].get(_DHIS2_COC_UID_EXTRA_KEY) is True
    assert co_name_col["extra"].get(_DHIS2_COC_EXTRA_KEY) is True
    assert aoc_uid_col["extra"].get(_DHIS2_AOC_UID_EXTRA_KEY) is True
    assert aoc_name_col["extra"].get(_DHIS2_AOC_EXTRA_KEY) is True


def test_materialize_serving_rows_with_category_dimensions_resolves_coc_and_aoc_labels():
    from superset.dhis2.analytical_serving import (
        build_serving_manifest,
        materialize_serving_rows,
    )

    dataset = _make_single_instance_dataset(
        extra_config={"include_disaggregation_dimension": True}
    )
    dataset.variables[0].get_dimension_availability = lambda: [
        {
            "dimension_key": "sex",
            "dimension_label": "Sex",
            "category_id": "cat_sex",
            "category_combo_id": "cc_disagg",
            "data_dimension_type": "DISAGGREGATION",
            "display_order": 1,
            "options": [
                {"id": "opt_male", "displayName": "Male"},
                {"id": "opt_female", "displayName": "Female"},
            ],
        },
        {
            "dimension_key": "age_group",
            "dimension_label": "Age Group",
            "category_id": "cat_age",
            "category_combo_id": "cc_disagg",
            "data_dimension_type": "DISAGGREGATION",
            "display_order": 2,
            "options": [
                {"id": "opt_under_5", "displayName": "Under 5"},
                {"id": "opt_over_5", "displayName": "Over 5"},
            ],
        },
        {
            "dimension_key": "project",
            "dimension_label": "Project",
            "category_id": "cat_project",
            "category_combo_id": "cc_attribute",
            "data_dimension_type": "ATTRIBUTE",
            "display_order": 1,
            "options": [
                {"id": "opt_proj_a", "displayName": "Project A"},
                {"id": "opt_proj_b", "displayName": "Project B"},
            ],
        },
    ]
    payloads = _single_instance_payloads()
    payloads[("dhis2_snapshot:categoryCombos", 1)] = {
        "status": "success",
        "result": [
            {
                "id": "cc_disagg",
                "displayName": "Disaggregation",
                "categories": [
                    {
                        "id": "cat_sex",
                        "displayName": "Sex",
                        "categoryOptions": [
                            {"id": "opt_male", "displayName": "Male"},
                            {"id": "opt_female", "displayName": "Female"},
                        ],
                    },
                    {
                        "id": "cat_age",
                        "displayName": "Age Group",
                        "categoryOptions": [
                            {"id": "opt_under_5", "displayName": "Under 5"},
                            {"id": "opt_over_5", "displayName": "Over 5"},
                        ],
                    },
                ],
            },
            {
                "id": "cc_attribute",
                "displayName": "Attribute",
                "categories": [
                    {
                        "id": "cat_project",
                        "displayName": "Project",
                        "categoryOptions": [
                            {"id": "opt_proj_a", "displayName": "Project A"},
                            {"id": "opt_proj_b", "displayName": "Project B"},
                        ],
                    }
                ],
            },
        ],
    }
    payloads[("dhis2_snapshot:categoryOptionCombos", 1)] = {
        "status": "success",
        "result": [
            {
                "id": "coc_female_under_5",
                "displayName": "Female, Under 5",
                "categoryCombo": {"id": "cc_disagg", "displayName": "Disaggregation"},
                "categoryOptions": [
                    {"id": "opt_female", "displayName": "Female"},
                    {"id": "opt_under_5", "displayName": "Under 5"},
                ],
            },
            {
                "id": "aoc_project_a",
                "displayName": "Project A",
                "categoryCombo": {"id": "cc_attribute", "displayName": "Attribute"},
                "categoryOptions": [
                    {"id": "opt_proj_a", "displayName": "Project A"},
                ],
            },
        ],
    }

    raw_rows = [
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS",
            "dx_uid": "de_malaria",
            "pe": "2024",
            "ou": "ou-national",
            "ou_name": "Uganda",
            "ou_level": 1,
            "value": "9",
            "value_numeric": 9.0,
            "co_uid": "coc_female_under_5",
            "co_name": "Female, Under 5",
            "aoc_uid": "aoc_project_a",
            "aoc_name": "Project A",
        }
    ]

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)
        _, rows = materialize_serving_rows(dataset, raw_rows, manifest)

    assert "sex" in [column["column_name"] for column in manifest["columns"]]
    assert "age_group" in [column["column_name"] for column in manifest["columns"]]
    assert "project" in [column["column_name"] for column in manifest["columns"]]
    assert len(rows) == 1
    assert rows[0]["national"] == "Uganda"
    assert rows[0]["period"] == "2024"
    assert rows[0]["co_uid"] == "coc_female_under_5"
    assert rows[0]["disaggregation"] == "Female, Under 5"
    assert rows[0]["aoc_uid"] == "aoc_project_a"
    assert rows[0]["attribute_option_combo"] == "Project A"
    assert rows[0]["sex"] == "Female"
    assert rows[0]["age_group"] == "Under 5"
    assert rows[0]["project"] == "Project A"
    assert rows[0]["malaria_cases"] == 9.0
    assert rows[0]["_manifest_build_v7"] is None


def test_materialize_serving_rows_with_coc_dimension_keeps_rows_separate():
    """With include_disaggregation_dimension, rows for different COCs must not be merged."""
    from superset.dhis2.analytical_serving import (
        build_serving_manifest,
        materialize_serving_rows,
    )

    dataset = _make_single_instance_dataset(
        extra_config={"include_disaggregation_dimension": True}
    )
    payloads = _single_instance_payloads()

    raw_rows = [
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS",
            "dx_uid": "de_malaria",
            "pe": "2024",
            "ou": "ou-national",
            "ou_name": "Uganda",
            "ou_level": 1,
            "value": "120",
            "value_numeric": 120.0,
            "co_uid": "coc-male",
            "co_name": "Male",
        },
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS",
            "dx_uid": "de_malaria",
            "pe": "2024",
            "ou": "ou-national",
            "ou_name": "Uganda",
            "ou_level": 1,
            "value": "95",
            "value_numeric": 95.0,
            "co_uid": "coc-female",
            "co_name": "Female",
        },
    ]

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ), patch(
        "superset.dhis2.analytical_serving._load_distinct_cocs_for_variable",
        return_value=[
            {"co_uid": "coc-male", "co_name": "Male"},
            {"co_uid": "coc-female", "co_name": "Female"},
        ],
    ):
        manifest = build_serving_manifest(dataset)
        columns, rows = materialize_serving_rows(dataset, raw_rows, manifest)

    # Must produce two separate rows — one per COC
    assert len(rows) == 2, f"Expected 2 rows, got {len(rows)}: {rows}"

    by_coc = {r["disaggregation"]: r for r in rows}
    assert set(by_coc.keys()) == {"Male", "Female"}
    assert by_coc["Male"]["malaria_cases"] == 120.0
    assert by_coc["Female"]["malaria_cases"] == 95.0

    # co_uid must also be populated
    assert by_coc["Male"]["co_uid"] == "coc-male"
    assert by_coc["Female"]["co_uid"] == "coc-female"


def test_materialize_serving_rows_without_coc_dimension_merges_coc_rows():
    """Without include_disaggregation_dimension, rows with different COCs must be merged."""
    from superset.dhis2.analytical_serving import (
        build_serving_manifest,
        materialize_serving_rows,
    )

    dataset = _make_single_instance_dataset()  # no include_disaggregation_dimension
    payloads = _single_instance_payloads()

    raw_rows = [
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS",
            "dx_uid": "de_malaria",
            "pe": "2024",
            "ou": "ou-national",
            "ou_name": "Uganda",
            "ou_level": 1,
            "value": "120",
            "value_numeric": 120.0,
            "co_uid": "coc-male",
            "co_name": "Male",
        },
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS",
            "dx_uid": "de_malaria",
            "pe": "2024",
            "ou": "ou-national",
            "ou_name": "Uganda",
            "ou_level": 1,
            "value": "95",
            "value_numeric": 95.0,
            "co_uid": "coc-female",
            "co_name": "Female",
        },
    ]

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)
        columns, rows = materialize_serving_rows(dataset, raw_rows, manifest)

    # Without COC dimension the two rows share the same grouping key (same period/ou/ou_level)
    # The last written value wins — the important assertion is that we do NOT get two rows.
    assert len(rows) == 1, f"Expected 1 merged row, got {len(rows)}: {rows}"
    # No disaggregation or co_uid columns
    col_names = [c["column_name"] for c in columns]
    assert "disaggregation" not in col_names
    assert "co_uid" not in col_names


def test_coc_dimension_columns_have_correct_extra_metadata():
    """The extra metadata keys on CO columns must match what DHIS2ColumnTag expects."""
    from superset.dhis2.analytical_serving import (
        _DHIS2_COC_EXTRA_KEY,
        _DHIS2_COC_UID_EXTRA_KEY,
        build_serving_manifest,
    )

    dataset = _make_single_instance_dataset(
        extra_config={"include_disaggregation_dimension": True}
    )
    payloads = _single_instance_payloads()

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ), patch(
        "superset.dhis2.analytical_serving._load_distinct_cocs_for_variable",
        return_value=[
            {"co_uid": "coc-male", "co_name": "Male"},
            {"co_uid": "coc-female", "co_name": "Female"},
        ],
    ):
        manifest = build_serving_manifest(dataset)

    col_by_name = {c["column_name"]: c for c in manifest["columns"]}

    uid_col = col_by_name["co_uid"]
    assert uid_col["extra"][_DHIS2_COC_UID_EXTRA_KEY] is True
    assert uid_col["is_dimension"] is True
    assert uid_col["type"] == "STRING"

    name_col = col_by_name["disaggregation"]
    assert name_col["extra"][_DHIS2_COC_EXTRA_KEY] is True
    assert name_col["is_dimension"] is True
    assert name_col["verbose_name"] == "Disaggregation"


def test_build_serving_manifest_flags_indicators():
    """Variable columns for indicators must have dhis2_is_indicator: True in extra."""
    from superset.dhis2.analytical_serving import (
        _DHIS2_INDICATOR_EXTRA_KEY,
        build_serving_manifest,
    )

    dataset = _make_dataset()
    payloads = _metadata_payloads()

    with patch(
        "superset.dhis2.analytical_serving.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: payloads.get(
            (namespace, key_parts["instance_id"])
        ),
    ):
        manifest = build_serving_manifest(dataset)

    col_by_name = {c["verbose_name"]: c for c in manifest["columns"]}

    # de_anc is a dataElement
    anc_col = col_by_name["ANC 1st Visit"]
    assert _DHIS2_INDICATOR_EXTRA_KEY not in anc_col.get("extra", {})

    # ind_reporting is an indicator
    rep_col = col_by_name["Reporting Rate"]
    assert rep_col["extra"][_DHIS2_INDICATOR_EXTRA_KEY] is True


# ── dataset_columns_payload — aggregation expression tests ────────────────────

def _dcp_col(
    column_name: str,
    col_type: str = "FLOAT",
    is_indicator: bool = False,
    extra: dict | None = None,
) -> dict:
    """Build a minimal manifest column dict for dataset_columns_payload tests."""
    import json

    base_extra: dict = dict(extra or {})
    if is_indicator:
        base_extra["dhis2_is_indicator"] = True
    return {
        "column_name": column_name,
        "verbose_name": column_name.replace("_", " ").title(),
        "type": col_type,
        "is_dttm": False,
        "extra": json.dumps(base_extra) if base_extra else None,
    }


def test_dataset_columns_payload_data_element_uses_sum():
    """Numeric data elements must produce SUM(col) expressions."""
    import json
    from superset.dhis2.analytical_serving import dataset_columns_payload

    result = dataset_columns_payload([_dcp_col("bcg_doses", "FLOAT")])
    assert result[0]["expression"] == "SUM(`bcg_doses`)"
    extra = json.loads(result[0]["extra"])
    assert extra["dhis2_default_agg"] == "SUM"


def test_dataset_columns_payload_indicator_uses_bare_column():
    """Indicators must NOT be wrapped in AVG/SUM — bare column reference only."""
    import json
    from superset.dhis2.analytical_serving import dataset_columns_payload

    result = dataset_columns_payload([_dcp_col("malaria_incidence_rate", is_indicator=True)])
    expr = result[0]["expression"]
    assert expr == "`malaria_incidence_rate`", f"Expected bare col, got: {expr}"
    assert "AVG" not in expr
    assert "SUM" not in expr
    extra = json.loads(result[0]["extra"])
    assert extra["dhis2_default_agg"] == "NONE"


def test_dataset_columns_payload_string_has_no_expression():
    """Non-numeric columns are dimension-only: no expression, no default_agg."""
    import json
    from superset.dhis2.analytical_serving import dataset_columns_payload

    result = dataset_columns_payload([_dcp_col("org_unit_name", col_type="STRING")])
    assert result[0].get("expression") is None
    raw_extra = result[0].get("extra")
    if raw_extra:
        extra = json.loads(raw_extra)
        assert "dhis2_default_agg" not in extra


def test_dataset_columns_payload_preserves_existing_extra_keys():
    """dhis2_legend and other custom extra keys must survive enrichment."""
    import json
    from superset.dhis2.analytical_serving import dataset_columns_payload

    col = _dcp_col("malaria_rate", is_indicator=True, extra={"dhis2_legend": {"items": []}})
    result = dataset_columns_payload([col])
    extra = json.loads(result[0]["extra"])
    assert "dhis2_legend" in extra
    assert extra["dhis2_default_agg"] == "NONE"


def test_dataset_columns_payload_empty_input():
    from superset.dhis2.analytical_serving import dataset_columns_payload

    assert dataset_columns_payload([]) == []


def test_dataset_columns_payload_multiple_types():
    """Mixed column types all returned; correct aggregations assigned."""
    import json
    from superset.dhis2.analytical_serving import dataset_columns_payload

    cols = [
        _dcp_col("de_float", "FLOAT"),
        _dcp_col("de_int", "INTEGER"),
        _dcp_col("ind_rate", is_indicator=True),
        _dcp_col("ou_name", "STRING"),
    ]
    result = dataset_columns_payload(cols)
    assert len(result) == 4

    by_name = {r["column_name"]: r for r in result}
    assert by_name["de_float"]["expression"] == "SUM(`de_float`)"
    assert by_name["de_int"]["expression"] == "SUM(`de_int`)"
    assert by_name["ind_rate"]["expression"] == "`ind_rate`"
    assert by_name["ou_name"].get("expression") is None

    assert json.loads(by_name["de_float"]["extra"])["dhis2_default_agg"] == "SUM"
    assert json.loads(by_name["ind_rate"]["extra"])["dhis2_default_agg"] == "NONE"
