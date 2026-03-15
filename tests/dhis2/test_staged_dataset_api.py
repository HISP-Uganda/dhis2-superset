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
"""Unit tests for staged dataset API serialization."""

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from flask import Flask
from types import SimpleNamespace
from unittest.mock import patch


def test_dataset_to_dict_includes_local_serving_database():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    dataset = SimpleNamespace(
        id=5,
        database_id=9,
        to_json=lambda: {"id": 5, "database_id": 9, "name": "ANC"},
    )

    with patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api.get_staging_database",
        return_value=SimpleNamespace(id=13, name="main"),
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.ensure_serving_table",
        return_value=(
            "dhis2_staging.sv_5_anc",
            [
                {
                    "column_name": "period",
                    "verbose_name": "Period",
                    "type": "STRING",
                    "is_dttm": False,
                    "filterable": True,
                    "groupby": True,
                    "is_active": True,
                }
            ],
        ),
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staging_stats",
        return_value={"total_rows": 11},
    ), patch(
        "superset.dhis2.staged_dataset_api.DHIS2StagingEngine"
    ) as engine_cls:
        engine_cls.return_value.get_superset_sql_table_ref.return_value = (
            "dhis2_staging.ds_5_anc"
        )
        payload = DHIS2StagedDatasetApi()._dataset_to_dict(5, include_stats=True)

    assert payload == {
        "id": 5,
        "database_id": 9,
        "name": "ANC",
        "staging_table_ref": "dhis2_staging.ds_5_anc",
        "serving_table_ref": "dhis2_staging.sv_5_anc",
        "serving_columns": [
            {
                "column_name": "period",
                "verbose_name": "Period",
                "type": "STRING",
                "is_dttm": False,
                "filterable": True,
                "groupby": True,
                "is_active": True,
            }
        ],
        "serving_database_id": 13,
        "serving_database_name": "main",
        "stats": {"total_rows": 11},
    }


def test_dataset_to_dict_can_omit_heavy_dataset_config_for_list_views():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    dataset = SimpleNamespace(
        id=5,
        database_id=9,
        to_json=lambda: {
            "id": 5,
            "database_id": 9,
            "name": "ANC",
            "dataset_config": {
                "org_unit_details": [{"id": "ou-a"}],
            },
        },
    )

    with patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api.get_staging_database",
        return_value=SimpleNamespace(id=13, name="main"),
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.ensure_serving_table",
        return_value=("dhis2_staging.sv_5_anc", []),
    ), patch(
        "superset.dhis2.staged_dataset_api.DHIS2StagingEngine"
    ) as engine_cls:
        engine_cls.return_value.get_superset_sql_table_ref.return_value = (
            "dhis2_staging.ds_5_anc"
        )
        payload = DHIS2StagedDatasetApi()._dataset_to_dict(
            5,
            include_dataset_config=False,
        )

    assert "dataset_config" not in payload


def test_list_datasets_returns_lightweight_payload_without_dataset_config():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = Flask(__name__)
    dataset = SimpleNamespace(id=5, to_json=lambda: {"id": 5, "name": "ANC"})

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/?database_id=9&include_stats=true",
        method="GET",
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.list_staged_datasets",
        return_value=[dataset],
    ), patch.object(
        DHIS2StagedDatasetApi,
        "_dataset_to_dict",
        return_value={"id": 5, "name": "ANC", "stats": {"total_rows": 11}},
    ) as dataset_to_dict:
        response = DHIS2StagedDatasetApi().list_datasets()

    dataset_to_dict.assert_called_once_with(
        5,
        include_stats=True,
        include_dataset_config=False,
    )
    assert response["status"] == 200
    assert response["result"][0]["stats"]["total_rows"] == 11


def test_query_preview_returns_filtered_local_rows():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = Flask(__name__)
    app.appbuilder = SimpleNamespace(  # type: ignore[attr-defined]
        sm=SimpleNamespace(is_item_public=lambda *args, **kwargs: True)
    )
    dataset = SimpleNamespace(id=11, database_id=9, name="ANC")

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/11/query",
        method="POST",
        json={
            "columns": ["period", "anc_1st_visit"],
            "filters": [{"column": "period", "operator": "eq", "value": "2024Q1"}],
            "limit": 25,
            "page": 2,
        },
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.query_serving_data",
        return_value={
            "columns": ["period", "anc_1st_visit"],
            "rows": [{"period": "2024Q1", "anc_1st_visit": 12}],
            "limit": 25,
            "page": 2,
            "total_pages": 4,
            "total_rows": 1,
            "serving_table_ref": "dhis2_staging.sv_11_anc",
            "sql_preview": 'SELECT "period" FROM dhis2_staging.sv_11_anc LIMIT 25 OFFSET 25',
        },
    ) as query_mock:
        response = DHIS2StagedDatasetApi().query_preview(11)

    query_mock.assert_called_once_with(
        11,
        selected_columns=["period", "anc_1st_visit"],
        filters=[{"column": "period", "operator": "eq", "value": "2024Q1"}],
        limit=25,
        page=2,
        group_by_columns=None,
        metric_column=None,
        metric_alias=None,
        aggregation_method=None,
    )
    assert response.status_code == 200
    assert response.json["result"]["rows"][0]["anc_1st_visit"] == 12


def test_query_preview_forwards_grouped_aggregation():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = Flask(__name__)
    app.appbuilder = SimpleNamespace(  # type: ignore[attr-defined]
        sm=SimpleNamespace(is_item_public=lambda *args, **kwargs: True)
    )
    dataset = SimpleNamespace(id=11, database_id=9, name="ANC")

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/11/query",
        method="POST",
        json={
            "filters": [{"column": "region", "operator": "eq", "value": "Acholi"}],
            "limit": 500,
            "page": 1,
            "group_by": ["district_city"],
            "metric_column": "c_105_ep01b_malaria_tested_b_s_rdt",
            "metric_alias": "SUM(c_105_ep01b_malaria_tested_b_s_rdt)",
            "aggregation_method": "sum",
        },
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.query_serving_data",
        return_value={
            "columns": [
                "district_city",
                "SUM(c_105_ep01b_malaria_tested_b_s_rdt)",
            ],
            "rows": [
                {
                    "district_city": "Kitgum District",
                    "SUM(c_105_ep01b_malaria_tested_b_s_rdt)": 1205,
                }
            ],
            "limit": 500,
            "page": 1,
            "total_pages": 1,
            "total_rows": 1,
            "serving_table_ref": "dhis2_staging.sv_11_anc",
            "sql_preview": 'SELECT "district_city" FROM dhis2_staging.sv_11_anc LIMIT 500',
        },
    ) as query_mock:
        response = DHIS2StagedDatasetApi().query_preview(11)

    query_mock.assert_called_once_with(
        11,
        selected_columns=None,
        filters=[{"column": "region", "operator": "eq", "value": "Acholi"}],
        limit=500,
        page=1,
        group_by_columns=["district_city"],
        metric_column="c_105_ep01b_malaria_tested_b_s_rdt",
        metric_alias="SUM(c_105_ep01b_malaria_tested_b_s_rdt)",
        aggregation_method="sum",
    )
    assert response.status_code == 200
    assert response.json["result"]["rows"][0]["district_city"] == "Kitgum District"


def test_get_local_filter_options_returns_hierarchy_and_period_choices():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = Flask(__name__)
    app.appbuilder = SimpleNamespace(  # type: ignore[attr-defined]
        sm=SimpleNamespace(is_item_public=lambda *args, **kwargs: True)
    )
    dataset = SimpleNamespace(id=11, database_id=9, name="ANC")

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/11/filters",
        method="POST",
        json={
            "filters": [{"column": "region", "operator": "eq", "value": "Acholi"}],
        },
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_local_filter_options",
        return_value={
            "org_unit_filters": [
                {
                    "column_name": "region",
                    "verbose_name": "Region",
                    "level": 2,
                    "options": [
                        {"label": "Acholi", "value": "Acholi", "row_count": 12}
                    ],
                }
            ],
            "period_filter": {
                "column_name": "period",
                "verbose_name": "Period",
                "options": [
                    {"label": "2024Q1", "value": "2024Q1", "row_count": 12}
                ],
            },
        },
    ) as filter_mock:
        response = DHIS2StagedDatasetApi().get_local_filter_options(11)

    filter_mock.assert_called_once_with(
        11,
        filters=[{"column": "region", "operator": "eq", "value": "Acholi"}],
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["result"]["org_unit_filters"][0]["options"][0]["value"] == "Acholi"
    assert payload["result"]["period_filter"]["options"][0]["value"] == "2024Q1"


def test_get_local_filter_options_accepts_get_requests():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = Flask(__name__)
    app.appbuilder = SimpleNamespace(  # type: ignore[attr-defined]
        sm=SimpleNamespace(is_item_public=lambda *args, **kwargs: True)
    )
    dataset = SimpleNamespace(id=11, database_id=9, name="ANC")

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/11/filters",
        method="GET",
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_local_filter_options",
        return_value={
            "org_unit_filters": [],
            "period_filter": {
                "column_name": "period",
                "verbose_name": "Period",
                "options": [
                    {"label": "2024Q1", "value": "2024Q1", "row_count": 12}
                ],
            },
        },
    ) as filter_mock:
        response = DHIS2StagedDatasetApi().get_local_filter_options(11)

    filter_mock.assert_called_once_with(11, filters=None)
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["result"]["period_filter"]["options"][0]["value"] == "2024Q1"


def test_download_query_returns_csv_attachment():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = Flask(__name__)
    dataset = SimpleNamespace(id=11, database_id=9, name="ANC Coverage")

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/11/download",
        method="POST",
        json={
            "columns": ["period", "anc_1st_visit"],
            "limit": 100,
        },
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.export_serving_data_csv",
        return_value=("period,anc_1st_visit\r\n2024Q1,12\r\n", "dhis2_staging.sv_11_anc"),
    ) as export_mock:
        response = DHIS2StagedDatasetApi().download_query(11)

    export_mock.assert_called_once_with(
        11,
        selected_columns=["period", "anc_1st_visit"],
        filters=None,
        limit=100,
    )
    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/csv")
    assert "anc_coverage_local_data.csv" in response.headers["Content-Disposition"]


def test_merge_dataset_lineage_persists_variable_instance_mappings():
    from superset.dhis2.staged_dataset_api import _merge_dataset_lineage

    payload = _merge_dataset_lineage(
        {
            "dataset_config": {
                "periods": ["LAST_12_MONTHS"],
            }
        },
        [
            {
                "instance_id": "5",
                "variable_id": "abc123",
                "variable_type": "dataElement",
                "variable_name": "ANC 1st Visit",
            },
            {
                "instance_id": 7,
                "variable_id": "def456",
                "variable_type": "indicator",
            },
        ],
    )

    assert payload["dataset_config"]["configured_connection_ids"] == [5, 7]
    assert payload["dataset_config"]["variable_mappings"] == [
        {
            "instance_id": 5,
            "variable_id": "abc123",
            "variable_type": "dataElement",
            "variable_name": "ANC 1st Visit",
        },
        {
            "instance_id": 7,
            "variable_id": "def456",
            "variable_type": "indicator",
        },
    ]


def test_cleanup_dataset_returns_success_response():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = Flask(__name__)

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/11/cleanup",
        method="POST",
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.clear_staged_dataset_data",
        return_value={
            "dataset_id": 11,
            "total_rows": 0,
            "staging_table_ref": "dhis2_staging.ds_11_anc",
            "serving_table_ref": "dhis2_staging.sv_11_anc",
        },
    ) as cleanup_mock:
        response = DHIS2StagedDatasetApi().cleanup_dataset(11)

    cleanup_mock.assert_called_once_with(11)
    assert response["status"] == 200
    assert response["result"]["dataset_id"] == 11
