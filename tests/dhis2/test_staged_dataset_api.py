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


class _NullCache:
    def get(self, _key):
        return None

    def set(self, _key, _value, timeout=None):
        return True


class _FakeEngine:
    def __init__(
        self,
        *,
        staging_table_ref: str = "dhis2_staging.ds_5_anc",
        serving_table_ref: str = "dhis2_staging.sv_5_anc",
        serving_database_id: int = 13,
        serving_database_name: str = "main",
        serving_column_names: list[str] | None = None,
    ):
        self._staging_table_ref = staging_table_ref
        self._serving_table_ref = serving_table_ref
        self._serving_database = SimpleNamespace(
            id=serving_database_id,
            name=serving_database_name,
        )
        self._serving_column_names = serving_column_names or []

    def get_superset_sql_table_ref(self, _dataset):
        return self._staging_table_ref

    def get_serving_sql_table_ref(self, _dataset):
        return self._serving_table_ref

    def get_or_create_superset_database(self):
        return self._serving_database

    def get_serving_table_columns(self, _dataset):
        return self._serving_column_names


def _make_test_app() -> Flask:
    app = Flask(__name__)
    app.appbuilder = SimpleNamespace(  # type: ignore[attr-defined]
        sm=SimpleNamespace(is_item_public=lambda *args, **kwargs: True)
    )
    return app


def test_dataset_to_dict_includes_local_serving_database():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    dataset = SimpleNamespace(
        id=5,
        database_id=9,
        staging_table_name="ds_5_anc",
        serving_superset_dataset_id=None,
        to_json=lambda: {"id": 5, "database_id": 9, "name": "ANC"},
    )

    with patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api._get_engine",
        return_value=_FakeEngine(),
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
        "superset.dhis2.staged_dataset_api.svc.get_serving_columns",
        return_value=[],
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staging_stats",
        return_value={"total_rows": 11},
    ):
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
        staging_table_name="ds_5_anc",
        serving_superset_dataset_id=None,
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
        "superset.dhis2.staged_dataset_api._get_engine",
        return_value=_FakeEngine(serving_column_names=["period"]),
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.ensure_serving_table",
        return_value=("dhis2_staging.sv_5_anc", []),
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_serving_columns",
        return_value=[],
    ):
        payload = DHIS2StagedDatasetApi()._dataset_to_dict(
            5,
            include_dataset_config=False,
        )

    assert "dataset_config" not in payload


def test_dataset_to_dict_skips_serving_table_build_when_definition_is_omitted():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    dataset = SimpleNamespace(
        id=5,
        database_id=9,
        staging_table_name="ds_5_anc",
        serving_superset_dataset_id=None,
        to_json=lambda: {"id": 5, "database_id": 9, "name": "ANC"},
    )
    ensure_mock = patch(
        "superset.dhis2.staged_dataset_api.svc.ensure_serving_table",
        side_effect=AssertionError("ensure_serving_table should not be called"),
    )

    with patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api._get_engine",
        return_value=_FakeEngine(serving_column_names=["period"]),
    ), ensure_mock, patch(
        "superset.dhis2.staged_dataset_api.svc.get_serving_columns",
        return_value=[
            {
                "column_name": "period",
                "verbose_name": "Period",
                "type": "STRING",
                "is_dttm": False,
                "filterable": True,
                "groupby": True,
                "is_active": True,
            },
            {
                "column_name": "legacy_column",
                "verbose_name": "Legacy Column",
                "type": "STRING",
                "is_dttm": False,
                "filterable": True,
                "groupby": True,
                "is_active": True,
            },
        ],
    ):
        payload = DHIS2StagedDatasetApi()._dataset_to_dict(
            5,
            include_serving_definition=False,
        )

    assert payload is not None
    assert payload["serving_table_ref"] == "dhis2_staging.sv_5_anc"
    assert [column["column_name"] for column in payload["serving_columns"]] == [
        "period"
    ]


def test_list_datasets_returns_lightweight_payload_without_dataset_config():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = _make_test_app()
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
        include_serving_definition=False,
    )
    assert response.status_code == 200
    assert response.get_json()["result"][0]["stats"]["total_rows"] == 11


def test_create_dataset_returns_400_for_non_serializable_dataset_config():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = _make_test_app()

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/",
        method="POST",
        json={
            "database_id": 9,
            "name": "ANC",
            "dataset_config": {"configured_connection_ids": [1, 2]},
        },
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset_by_name",
        return_value=None,
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.create_staged_dataset",
        side_effect=ValueError("'dataset_config' must be JSON serializable"),
    ):
        response = DHIS2StagedDatasetApi().create_dataset()

    assert response.status_code == 400
    assert response.get_json()["message"] == "'dataset_config' must be JSON serializable"


def test_create_dataset_returns_immediately_and_queues_background_sync():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = _make_test_app()
    dataset = SimpleNamespace(id=11)

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/",
        method="POST",
        json={
            "database_id": 9,
            "name": "ANC",
            "dataset_config": {"configured_connection_ids": [1]},
            "variables": [
                {
                    "instance_id": 1,
                    "variable_id": "abc123",
                    "variable_type": "dataElement",
                    "variable_name": "ANC 1st Visit",
                }
            ],
        },
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset_by_name",
        return_value=None,
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.create_staged_dataset",
        return_value=dataset,
    ) as create_mock, patch(
        "superset.dhis2.staged_dataset_api.svc.get_dataset_variables",
        return_value=[],
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.add_variable",
    ) as add_variable_mock, patch.object(
        DHIS2StagedDatasetApi,
        "_dataset_to_dict",
        return_value={"id": 11, "name": "ANC"},
    ) as dataset_to_dict_mock, patch(
        "superset.dhis2.staged_dataset_api.schedule_staged_dataset_sync",
        return_value={"scheduled": True, "mode": "thread", "job_id": 91},
    ) as schedule_mock, patch(
        "superset.dhis2.staged_dataset_api.svc.ensure_serving_table",
        side_effect=AssertionError("ensure_serving_table should not be called"),
    ):
        response = DHIS2StagedDatasetApi().create_dataset()

    create_mock.assert_called_once()
    add_variable_mock.assert_called_once_with(
        11,
        {
            "instance_id": 1,
            "variable_id": "abc123",
            "variable_type": "dataElement",
            "variable_name": "ANC 1st Visit",
        },
    )
    dataset_to_dict_mock.assert_called_once_with(
        11,
        include_variables=True,
        include_stats=False,
        include_serving_definition=False,
    )
    schedule_mock.assert_called_once_with(
        11,
        job_type="scheduled",
        prefer_immediate=False,
    )
    assert response.status_code == 201
    assert response.get_json()["sync_schedule"]["mode"] == "thread"


def test_update_dataset_returns_immediately_and_queues_background_sync():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = _make_test_app()
    dataset = SimpleNamespace(id=11)

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/11",
        method="PUT",
        json={
            "name": "ANC Updated",
            "dataset_config": {"configured_connection_ids": [1]},
            "variables": [
                {
                    "instance_id": 1,
                    "variable_id": "abc123",
                    "variable_type": "dataElement",
                    "variable_name": "ANC 1st Visit",
                }
            ],
        },
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.update_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_dataset_variables",
        return_value=[SimpleNamespace(id=7)],
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.remove_variable",
    ) as remove_variable_mock, patch(
        "superset.dhis2.staged_dataset_api.svc.add_variable",
    ) as add_variable_mock, patch.object(
        DHIS2StagedDatasetApi,
        "_dataset_to_dict",
        return_value={"id": 11, "name": "ANC Updated"},
    ) as dataset_to_dict_mock, patch(
        "superset.dhis2.staged_dataset_api.schedule_staged_dataset_sync",
        return_value={"scheduled": True, "mode": "thread", "job_id": 92},
    ) as schedule_mock, patch(
        "superset.dhis2.staged_dataset_api.svc.ensure_serving_table",
        side_effect=AssertionError("ensure_serving_table should not be called"),
    ):
        response = DHIS2StagedDatasetApi().update_dataset(11)

    remove_variable_mock.assert_called_once_with(7)
    add_variable_mock.assert_called_once_with(
        11,
        {
            "instance_id": 1,
            "variable_id": "abc123",
            "variable_type": "dataElement",
            "variable_name": "ANC 1st Visit",
        },
    )
    dataset_to_dict_mock.assert_called_once_with(
        11,
        include_variables=True,
        include_stats=False,
        include_serving_definition=False,
    )
    schedule_mock.assert_called_once_with(
        11,
        job_type="scheduled",
        prefer_immediate=False,
    )
    assert response.status_code == 200
    assert response.get_json()["sync_schedule"]["mode"] == "thread"


def test_query_preview_returns_filtered_local_rows():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = _make_test_app()
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
        "superset.dhis2.staged_dataset_api._data_cache",
        return_value=_NullCache(),
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
        count_rows=False,
    )
    assert response.status_code == 200
    assert response.json["result"]["rows"][0]["anc_1st_visit"] == 12


def test_query_preview_forwards_grouped_aggregation():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = _make_test_app()
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
        "superset.dhis2.staged_dataset_api._data_cache",
        return_value=_NullCache(),
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
        count_rows=False,
    )
    assert response.status_code == 200
    assert response.json["result"]["rows"][0]["district_city"] == "Kitgum District"


def test_get_local_filter_options_returns_hierarchy_and_period_choices():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = _make_test_app()
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

    app = _make_test_app()
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

    app = _make_test_app()
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


def test_list_variables_includes_dimension_availability_metadata():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = _make_test_app()
    dataset = SimpleNamespace(id=5)
    variable = SimpleNamespace(
        to_json=lambda: {
            "id": 99,
            "variable_id": "abc123",
            "variable_type": "dataElement",
            "dimension_availability": [
                {
                    "dimension_key": "age_group",
                    "dimension_scope": "groupby",
                }
            ],
        },
        instance=SimpleNamespace(to_json=lambda: {"id": 7, "name": "HMIS"}),
    )

    with app.test_request_context(
        "/api/v1/dhis2/staged-datasets/5/variables",
        method="GET",
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_api.svc.get_dataset_variables",
        return_value=[variable],
    ):
        response = DHIS2StagedDatasetApi().list_variables(5)

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["result"][0]["dimension_availability"] == [
        {
            "dimension_key": "age_group",
            "dimension_scope": "groupby",
        }
    ]


def test_cleanup_dataset_returns_success_response():
    from superset.dhis2.staged_dataset_api import DHIS2StagedDatasetApi

    app = _make_test_app()

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
    assert response.status_code == 200
    assert response.get_json()["result"]["dataset_id"] == 11
