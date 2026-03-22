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
"""Unit tests for the DHIS2 staged dataset service."""

from __future__ import annotations

import json
from types import SimpleNamespace
import tests.dhis2._bootstrap  # noqa: F401 - must be first

from unittest.mock import MagicMock, patch

import pytest


class _FakeEngine:
    def get_staging_table_name(self, dataset):
        return "ds_1_test"

    def create_staging_table(self, dataset):
        return "dhis2_staging.ds_1_test"


def _dataset(**kw):
    ds = SimpleNamespace(
        id=1,
        database_id=10,
        name="dataset",
        description=None,
        staging_table_name=None,
        schedule_cron=None,
        schedule_timezone="UTC",
        is_active=True,
        auto_refresh_enabled=True,
        dataset_config=None,
    )
    for key, value in kw.items():
        setattr(ds, key, value)
    return ds


@pytest.fixture(autouse=True)
def _restore_session_methods():
    import superset

    session = superset.db.session
    method_names = ("query", "get", "add", "delete", "commit", "flush", "rollback")
    originals = {name: getattr(session, name) for name in method_names if hasattr(session, name)}
    yield
    for name, value in originals.items():
        setattr(session, name, value)


def test_create_staged_dataset_forces_auto_refresh_enabled():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    superset.db.session.add = MagicMock()
    superset.db.session.flush = MagicMock()
    superset.db.session.commit = MagicMock()

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset_by_name",
        return_value=None,
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=_FakeEngine(),
    ):
        dataset = svc.create_staged_dataset(
            10,
            {
                "name": "ANC Coverage",
                "auto_refresh_enabled": False,
            },
        )

    assert dataset.auto_refresh_enabled is True


def test_create_staged_dataset_serializes_dataset_config_dict():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    superset.db.session.add = MagicMock()
    superset.db.session.flush = MagicMock()
    superset.db.session.commit = MagicMock()

    config = {
        "configured_connection_ids": [1, 2],
        "org_units": ["akV6429SUqu"],
        "level_mapping": {
            "enabled": True,
            "rows": [
                {
                    "merged_level": 1,
                    "label": "National",
                    "instance_levels": {"1": 1, "2": 1},
                }
            ],
        },
    }

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset_by_name",
        return_value=None,
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=_FakeEngine(),
    ), patch(
        "superset.dhis2.staged_dataset_service._sync_compat_dataset",
    ):
        dataset = svc.create_staged_dataset(
            10,
            {
                "name": "ANC Coverage",
                "dataset_config": config,
            },
        )

    assert isinstance(dataset.dataset_config, str)
    assert json.loads(dataset.dataset_config) == config


def test_create_staged_dataset_rejects_non_json_serializable_dataset_config():
    from superset.dhis2 import staged_dataset_service as svc

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset_by_name",
        return_value=None,
    ), pytest.raises(
        ValueError,
        match="'dataset_config' must be JSON serializable",
    ):
        svc.create_staged_dataset(
            10,
            {
                "name": "ANC Coverage",
                "dataset_config": {"bad": object()},
            },
        )


def test_create_staged_dataset_reuses_existing_name_and_keeps_table():
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(id=7, name="ANC Coverage", staging_table_name=None)

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset_by_name",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service.update_staged_dataset",
        return_value=dataset,
    ) as update_mock, patch(
        "superset.dhis2.staged_dataset_service.ensure_staging_table",
    ) as ensure_mock:
        reused = svc.create_staged_dataset(
            10,
            {
                "name": "  ANC Coverage  ",
                "description": "updated",
            },
        )

    assert reused is dataset
    update_mock.assert_called_once_with(
        dataset.id,
        {"name": "ANC Coverage", "description": "updated"},
    )
    ensure_mock.assert_called_once_with(dataset.id)


def test_update_staged_dataset_keeps_auto_refresh_enabled():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    superset.db.session.commit = MagicMock()
    dataset = _dataset(auto_refresh_enabled=True)

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ):
        updated = svc.update_staged_dataset(
            dataset.id,
            {"description": "updated", "auto_refresh_enabled": False},
        )

    assert updated.description == "updated"
    assert updated.auto_refresh_enabled is True


def test_ensure_staging_table_persists_computed_table_name():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    superset.db.session.commit = MagicMock()
    dataset = _dataset(staging_table_name=None)
    engine = _FakeEngine()

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=engine,
    ):
        table_ref = svc.ensure_staging_table(dataset.id)

    assert table_ref == "dhis2_staging.ds_1_test"
    assert dataset.staging_table_name == "ds_1_test"
    superset.db.session.commit.assert_called_once()


def test_clear_staged_dataset_data_truncates_local_rows_and_preserves_mappings():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    superset.db.session.commit = MagicMock()
    dataset = _dataset(
        dataset_config='{"variable_mappings":[{"instance_id":2,"variable_id":"abc123","variable_type":"dataElement"}]}',
        last_sync_at="yesterday",
        last_sync_status="success",
        last_sync_rows=44,
    )
    engine = MagicMock()

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=engine,
    ), patch(
        "superset.dhis2.staged_dataset_service.build_serving_manifest",
        return_value={
            "columns": [
                {
                    "column_name": "period",
                    "verbose_name": "Period",
                    "sql_type": "TEXT",
                }
            ]
        },
    ), patch(
        "superset.dhis2.staged_dataset_service.dataset_columns_payload",
        return_value=[
            {
                "column_name": "period",
                "verbose_name": "Period",
            }
        ],
    ), patch(
        "superset.dhis2.staged_dataset_service._sync_compat_dataset",
    ):
        result = svc.clear_staged_dataset_data(dataset.id)

    engine.create_staging_table.assert_called_once_with(dataset)
    engine.truncate_staging_table.assert_called_once_with(dataset)
    engine.create_or_replace_serving_table.assert_called_once_with(
        dataset,
        columns=[
            {
                "column_name": "period",
                "verbose_name": "Period",
                "sql_type": "TEXT",
            }
        ],
        rows=[],
    )
    assert dataset.last_sync_at is None
    assert dataset.last_sync_status is None
    assert dataset.last_sync_rows == 0
    assert result["dataset_id"] == dataset.id
    assert result["total_rows"] == 0
    superset.db.session.commit.assert_called_once()


def test_get_staging_preview_uses_local_staging_engine():
    from superset.dhis2 import staged_dataset_service as svc

    preview = {
        "columns": ["dx_uid", "value"],
        "rows": [{"dx_uid": "abc", "value": "12"}],
        "limit": 25,
        "staging_table_ref": "dhis2_staging.ds_1_test",
    }
    preview_service = MagicMock()
    preview_service.preview_dataset.return_value = preview

    with patch(
        "superset.dhis2.staged_preview_service.StagedPreviewService",
        return_value=preview_service,
    ):
        result = svc.get_staging_preview(1, limit=25)

    assert result == preview
    preview_service.preview_dataset.assert_called_once_with(1, limit=25)


def test_query_serving_data_uses_local_serving_engine():
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(database_id=10)
    query_result = {
        "columns": ["period", "anc_1st_visit"],
        "rows": [{"period": "2024Q1", "anc_1st_visit": 12}],
        "limit": 100,
        "page": 2,
        "total_pages": 3,
        "total_rows": 1,
        "serving_table_ref": "dhis2_staging.sv_1_dataset",
        "sql_preview": 'SELECT "period", "anc_1st_visit" FROM dhis2_staging.sv_1_dataset LIMIT 100 OFFSET 100',
    }
    engine = MagicMock()
    engine.query_serving_table.return_value = query_result

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service.ensure_serving_table",
        return_value=("dhis2_staging.sv_1_dataset", []),
    ) as ensure_mock, patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=engine,
    ):
        result = svc.query_serving_data(
            dataset.id,
            selected_columns=["period", "anc_1st_visit"],
            filters=[{"column": "period", "operator": "eq", "value": "2024Q1"}],
            limit=100,
            page=2,
        )

    assert result == query_result
    ensure_mock.assert_called_once_with(dataset.id)
    engine.query_serving_table.assert_called_once_with(
        dataset,
        selected_columns=["period", "anc_1st_visit"],
        filters=[{"column": "period", "operator": "eq", "value": "2024Q1"}],
        limit=100,
        page=2,
        group_by_columns=None,
        metric_column=None,
        metric_alias=None,
        aggregation_method=None,
        count_rows=True,
    )


def test_query_serving_data_forwards_grouped_aggregation():
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(database_id=10)
    query_result = {
        "columns": ["district_city", "SUM(c_105_ep01b_malaria_tested_b_s_rdt)"],
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
        "serving_table_ref": "dhis2_staging.sv_1_dataset",
        "sql_preview": 'SELECT "district_city" FROM dhis2_staging.sv_1_dataset LIMIT 500',
    }
    engine = MagicMock()
    engine.query_serving_table.return_value = query_result

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service.ensure_serving_table",
        return_value=("dhis2_staging.sv_1_dataset", []),
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=engine,
    ):
        result = svc.query_serving_data(
            dataset.id,
            filters=[{"column": "region", "operator": "eq", "value": "Acholi"}],
            limit=500,
            page=1,
            group_by_columns=["district_city"],
            metric_column="c_105_ep01b_malaria_tested_b_s_rdt",
            metric_alias="SUM(c_105_ep01b_malaria_tested_b_s_rdt)",
            aggregation_method="sum",
        )

    assert result == query_result
    engine.query_serving_table.assert_called_once_with(
        dataset,
        selected_columns=None,
        filters=[{"column": "region", "operator": "eq", "value": "Acholi"}],
        limit=500,
        page=1,
        group_by_columns=["district_city"],
        metric_column="c_105_ep01b_malaria_tested_b_s_rdt",
        metric_alias="SUM(c_105_ep01b_malaria_tested_b_s_rdt)",
        aggregation_method="sum",
        count_rows=True,
    )


def test_get_local_filter_options_uses_local_serving_engine():
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(database_id=10)
    filter_result = {
        "org_unit_filters": [
            {
                "column_name": "region",
                "verbose_name": "Region",
                "level": 2,
                "options": [{"label": "Acholi", "value": "Acholi", "row_count": 12}],
            }
        ],
        "period_filter": {
            "column_name": "period",
            "verbose_name": "Period",
            "options": [{"label": "2024Q1", "value": "2024Q1", "row_count": 12}],
        },
    }
    engine = MagicMock()
    engine.get_serving_filter_options.return_value = filter_result

    serving_columns = [
        {
            "column_name": "region",
            "verbose_name": "Region",
            "extra": '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 2}',
        },
        {
            "column_name": "period",
            "verbose_name": "Period",
            "extra": '{"dhis2_is_period": true}',
        },
    ]

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service.ensure_serving_table",
        return_value=("dhis2_staging.sv_1_dataset", serving_columns),
    ) as ensure_mock, patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=engine,
    ):
        result = svc.get_local_filter_options(
            dataset.id,
            filters=[{"column": "region", "operator": "eq", "value": "Acholi"}],
        )

    assert result == filter_result
    ensure_mock.assert_called_once_with(dataset.id)
    engine.get_serving_filter_options.assert_called_once_with(
        dataset,
        columns=serving_columns,
        filters=[{"column": "region", "operator": "eq", "value": "Acholi"}],
    )


def test_export_serving_data_csv_uses_local_serving_engine():
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(database_id=10)
    engine = MagicMock()
    engine.export_serving_table_csv.return_value = (
        "period,anc_1st_visit\r\n2024Q1,12\r\n",
        "dhis2_staging.sv_1_dataset",
    )

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service.ensure_serving_table",
        return_value=("dhis2_staging.sv_1_dataset", []),
    ) as ensure_mock, patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=engine,
    ):
        csv_text, table_ref = svc.export_serving_data_csv(
            dataset.id,
            selected_columns=["period", "anc_1st_visit"],
            filters=[{"column": "period", "operator": "eq", "value": "2024Q1"}],
            limit=500,
        )

    assert csv_text.startswith("period,anc_1st_visit")
    assert table_ref == "dhis2_staging.sv_1_dataset"
    ensure_mock.assert_called_once_with(dataset.id)
    engine.export_serving_table_csv.assert_called_once_with(
        dataset,
        selected_columns=["period", "anc_1st_visit"],
        filters=[{"column": "period", "operator": "eq", "value": "2024Q1"}],
        limit=500,
    )


def test_ensure_serving_table_rebuilds_existing_legacy_org_unit_projection():
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(database_id=10)
    engine = MagicMock()
    engine.serving_table_exists.return_value = True
    engine.get_serving_table_columns.return_value = [
        "dhis2_instance",
        "organisation_unit",
        "period",
        "anc_1st_visit",
    ]
    engine.fetch_staging_rows.return_value = [
        {
            "source_instance_id": 1,
            "source_instance_name": "HMIS-Test",
            "dx_uid": "abc123",
            "pe": "2024Q1",
            "ou": "OU_DISTRICT",
            "ou_name": "Kampala",
            "value": "12",
            "value_numeric": 12.0,
        }
    ]
    engine.get_staging_table_stats.return_value = {"total_rows": 1}
    engine.query_serving_table.return_value = {"total_rows": 0}
    manifest = {
        "columns": [
            {"column_name": "dhis2_instance", "sql_type": "TEXT"},
            {"column_name": "national", "sql_type": "TEXT"},
            {"column_name": "region", "sql_type": "TEXT"},
            {"column_name": "district", "sql_type": "TEXT"},
            {"column_name": "period", "sql_type": "TEXT"},
            {"column_name": "anc_1st_visit", "sql_type": "REAL"},
        ]
    }
    rebuilt_columns = manifest["columns"]
    rebuilt_rows = [
        {
            "dhis2_instance": "HMIS-Test",
            "national": "Uganda",
            "region": "Central",
            "district": "Kampala",
            "period": "2024Q1",
            "anc_1st_visit": 12.0,
        }
    ]

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=engine,
    ), patch(
        "superset.dhis2.staged_dataset_service.build_serving_manifest",
        return_value=manifest,
    ), patch(
        "superset.dhis2.staged_dataset_service.build_serving_table",
        return_value=SimpleNamespace(
            serving_columns=[{"column_name": column["column_name"]} for column in rebuilt_columns],
            diagnostics={
                "source_row_count": 1,
                "live_serving_row_count": 1,
            },
        ),
    ) as build_mock, patch(
        "superset.dhis2.staged_dataset_service.dataset_columns_payload",
        return_value=[{"column_name": column["column_name"]} for column in rebuilt_columns],
    ):
        table_ref, serving_columns = svc.ensure_serving_table(dataset.id)

    assert table_ref == engine.get_serving_sql_table_ref.return_value
    assert [column["column_name"] for column in serving_columns] == [
        "dhis2_instance",
        "national",
        "region",
        "district",
        "period",
        "anc_1st_visit",
    ]
    build_mock.assert_called_once_with(dataset, engine=engine)


def test_add_variable_coerces_instance_id_to_integer():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(id=1, database_id=10)
    instance = SimpleNamespace(id=2, database_id=10)

    superset.db.session.get = MagicMock(return_value=instance)
    superset.db.session.add = MagicMock()
    superset.db.session.flush = MagicMock()
    superset.db.session.commit = MagicMock()

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service._refresh_variable_dimension_availability",
    ), patch(
        "superset.dhis2.staged_dataset_service._sync_compat_variable",
    ):
        variable = svc.add_variable(
            1,
            {
                "instance_id": "2",
                "variable_id": "abc123",
                "variable_type": "dataElement",
                "variable_name": "ANC 1st Visit",
            },
        )

    assert variable.instance_id == 2


def test_add_variable_persists_dimension_availability_for_data_elements():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(id=1, database_id=10)
    instance = SimpleNamespace(id=2, database_id=10)

    superset.db.session.get = MagicMock(return_value=instance)
    superset.db.session.add = MagicMock()
    superset.db.session.flush = MagicMock()
    superset.db.session.commit = MagicMock()

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.metadata_staging_service.get_dimension_availability_for_variable",
        return_value=[
            {
                "dimension_key": "age_group",
                "dimension_label": "Age Group",
                "dimension_scope": "groupby",
                "is_groupable": True,
                "is_filterable": True,
            }
        ],
    ), patch(
        "superset.dhis2.staged_dataset_service._sync_compat_variable",
    ):
        variable = svc.add_variable(
            1,
            {
                "instance_id": 2,
                "variable_id": "abc123",
                "variable_type": "dataElement",
                "variable_name": "ANC 1st Visit",
            },
        )

    assert variable.get_dimension_availability() == [
        {
            "dimension_key": "age_group",
            "dimension_label": "Age Group",
            "dimension_scope": "groupby",
            "is_groupable": True,
            "is_filterable": True,
        }
    ]


def test_add_variable_rejects_instance_from_other_database():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(id=1, database_id=10)
    foreign_instance = SimpleNamespace(id=3, database_id=11)

    superset.db.session.get = MagicMock(return_value=foreign_instance)

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service._refresh_variable_dimension_availability",
    ):
        with pytest.raises(ValueError, match="does not belong to the dataset database"):
            svc.add_variable(
                1,
                {
                    "instance_id": 3,
                    "variable_id": "abc123",
                    "variable_type": "dataElement",
                },
            )
