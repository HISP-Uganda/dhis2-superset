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
                get_extra_params=lambda: {},
            ),
            SimpleNamespace(
                instance_id=2,
                variable_id="ind_reporting",
                variable_type="indicator",
                variable_name="Reporting Rate",
                alias=None,
                instance=SimpleNamespace(id=2, name="Non Routine DHIS2"),
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1, 2],
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
        "ANC 1st Visit",
        "Reporting Rate",
    ]
    assert [column["type"] for column in columns[-2:]] == ["FLOAT", "FLOAT"]
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
        "anc_1st_visit",
        "reporting_rate",
    ]
    assert rows == [
        {
            "dhis2_instance": "HMIS-Test",
            "region": "Central",
            "district": "Kampala",
            "period": "2024Q1",
            "ou_level": None,
            "anc_1st_visit": 12.0,
            "reporting_rate": None,
        },
        {
            "dhis2_instance": "Non Routine DHIS2",
            "region": "Eastern",
            "district": "Mbale",
            "period": "2024Q1",
            "ou_level": None,
            "reporting_rate": 95.3,
            "anc_1st_visit": None,
        },
    ]


def test_build_serving_manifest_keeps_all_ancestor_org_unit_levels_for_selected_stop_level():
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
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1],
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
        "National",
        "Region",
        "District",
        "Period",
        "OU Level",
        "Malaria Cases",
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
                get_extra_params=lambda: {},
            ),
        ],
        get_dataset_config=lambda: {
            "configured_connection_ids": [1],
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
        "National",
        "Region",
        "District",
        "Subcounty",
        "Period",
        "OU Level",
        "Malaria Cases",
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
    ), patch(
        "superset.dhis2.analytical_serving.db.engine.connect",
    ):
        manifest = build_serving_manifest(dataset)

    col_names = [c["column_name"] for c in manifest["columns"]]
    assert "co_uid" not in col_names
    assert "disaggregation" not in col_names
    assert manifest["coc_uid_column_name"] is None
    assert manifest["coc_name_column_name"] is None


def test_build_serving_manifest_with_coc_dimension_adds_co_columns():
    """include_disaggregation_dimension=True must expose co_uid and disaggregation columns."""
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
        "superset.dhis2.analytical_serving.db.engine.connect",
    ):
        manifest = build_serving_manifest(dataset)

    col_names = [c["column_name"] for c in manifest["columns"]]
    verbose_names = [c["verbose_name"] for c in manifest["columns"]]

    assert "co_uid" in col_names
    assert "disaggregation" in col_names
    assert "Category Option Combo (UID)" in verbose_names
    assert "Disaggregation" in verbose_names

    # Both must be in dimension_column_names
    assert "co_uid" in manifest["dimension_column_names"]
    assert "disaggregation" in manifest["dimension_column_names"]

    # Manifest returns the column name references
    assert manifest["coc_uid_column_name"] == "co_uid"
    assert manifest["coc_name_column_name"] == "disaggregation"

    # Extra metadata must carry the right keys
    co_uid_col = next(c for c in manifest["columns"] if c["column_name"] == "co_uid")
    co_name_col = next(c for c in manifest["columns"] if c["column_name"] == "disaggregation")
    assert co_uid_col["extra"].get(_DHIS2_COC_UID_EXTRA_KEY) is True
    assert co_name_col["extra"].get(_DHIS2_COC_EXTRA_KEY) is True


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
        "superset.dhis2.analytical_serving.db.engine.connect",
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
    ), patch(
        "superset.dhis2.analytical_serving.db.engine.connect",
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
        "superset.dhis2.analytical_serving.db.engine.connect",
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
