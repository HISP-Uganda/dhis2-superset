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
        serving_superset_dataset_id=None,
        variables=[],
        database=SimpleNamespace(repository_org_unit_config={}),
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


def test_repair_staged_dataset_definition_restores_missing_legacy_metadata():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    class _FakeVariable:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    superset.db.session.add = MagicMock()
    superset.db.session.flush = MagicMock()
    superset.db.session.commit = MagicMock()

    dataset = _dataset(
        id=7,
        database_id=5,
        name="MAL - Routine eHMIS Indicators",
        staging_table_name=None,
        dataset_config=None,
        max_orgunit_level=None,
        org_unit_scope=None,
        org_unit_source_mode=None,
        primary_instance_id=None,
    )
    dataset.get_dataset_config = lambda: {}

    fake_engine = MagicMock()
    fake_engine.get_staging_table_name.return_value = "ds_7_mal_routine_ehmis_indicators"

    inferred_level_mapping = {
        "enabled": True,
        "rows": [{"merged_level": 1, "label": "National", "instance_levels": {"4": 1}}],
    }
    inferred_root = [
        {
            "selectionKey": "akV6429SUqu",
            "sourceOrgUnitId": "akV6429SUqu",
            "displayName": "MOH - Uganda",
            "level": 1,
        }
    ]
    inferred_variables = [
        {
            "instance_id": 4,
            "variable_id": "abc123def45",
            "variable_type": "indicator",
            "variable_name": "Mal test positivity rate",
        }
    ]

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service.get_dataset_variables",
        return_value=[],
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=fake_engine,
    ), patch(
        "superset.dhis2.staged_dataset_service._infer_configured_instance_ids_from_related_sqla_tables",
        return_value=[4],
    ), patch(
        "superset.dhis2.staged_dataset_service._infer_default_period_config",
        return_value={
            "periods": [],
            "periods_auto_detect": True,
            "default_period_range_type": "relative",
            "default_relative_period": "LAST_12_MONTHS",
        },
    ), patch(
        "superset.dhis2.staged_dataset_service._infer_root_org_unit_details",
        return_value=inferred_root,
    ), patch(
        "superset.dhis2.staged_dataset_service._infer_level_mapping_config",
        return_value=(inferred_level_mapping, 7),
    ), patch(
        "superset.dhis2.staged_dataset_service._select_sqla_table_for_definition_repair",
        return_value=object(),
    ), patch(
        "superset.dhis2.staged_dataset_service._infer_variable_payloads_from_sqla_table",
        return_value=inferred_variables,
    ), patch(
        "superset.dhis2.staged_dataset_service._sync_compat_dataset",
    ) as sync_dataset, patch(
        "superset.dhis2.staged_dataset_service._sync_compat_variable",
    ) as sync_variable, patch(
        "superset.dhis2.staged_dataset_service.DHIS2DatasetVariable",
        _FakeVariable,
    ):
        result = svc.repair_staged_dataset_definition(dataset.id)

    repaired_config = json.loads(dataset.dataset_config)
    assert result["repaired"] is True
    assert result["variables_added"] == 1
    assert dataset.staging_table_name == "ds_7_mal_routine_ehmis_indicators"
    assert repaired_config["configured_connection_ids"] == [4]
    assert repaired_config["org_units"] == ["akV6429SUqu"]
    assert repaired_config["org_unit_scope"] == "all_levels"
    assert repaired_config["level_mapping"] == inferred_level_mapping
    assert repaired_config["variable_mappings"] == inferred_variables
    assert dataset.max_orgunit_level == 7
    assert dataset.primary_instance_id == 4
    sync_variable.assert_called_once()
    sync_dataset.assert_called_once_with(dataset)
    superset.db.session.commit.assert_called_once()


def test_infer_variable_payloads_from_sqla_table_uses_column_extra_directly():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    class _FakeColumn:
        column_name = "mal_test_positivity_rate"
        verbose_name = "MAL Test Positivity Rate"

        @staticmethod
        def get_extra_dict():
            return {
                "dhis2_variable_id": "ScLQeTJOITd",
                "dhis2_variable_type": "indicator",
                "dhis2_source_instance_id": 4,
            }

    class _FakeQuery:
        def filter(self, *_args, **_kwargs):
            return self

        def order_by(self, *_args, **_kwargs):
            return self

        def all(self):
            return [_FakeColumn()]

    superset.db.session.query = MagicMock(return_value=_FakeQuery())
    dataset = _dataset(id=7, database_id=5, name="MAL - Routine eHMIS Indicators")

    with patch(
        "superset.dhis2.staged_dataset_service._build_metadata_repair_lookup",
        return_value={},
    ):
        payloads = svc._infer_variable_payloads_from_sqla_table(
            dataset,
            sqla_table=SimpleNamespace(id=23),
            instance_ids=[4],
        )

    assert payloads == [
        {
            "instance_id": 4,
            "variable_id": "ScLQeTJOITd",
            "variable_type": "indicator",
            "variable_name": "MAL Test Positivity Rate",
            "alias": "mal_test_positivity_rate",
        }
    ]


def test_recover_missing_staged_datasets_from_sqla_tables_recreates_parent_rows():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    class _FakeQuery:
        def __init__(self, rows):
            self._rows = rows

        def filter(self, *_args, **_kwargs):
            return self

        def all(self):
            return list(self._rows)

    metadata_sqla = SimpleNamespace(
        id=31,
        table_name="MAL - Routine eHMIS Indicators",
        database_id=5,
        schema=None,
        dataset_role="METADATA",
        extra=json.dumps(
            {
                "dhis2_staged_dataset_id": 7,
                "dhis2_dataset_display_name": "MAL - Routine eHMIS Indicators",
                "dhis2_source_database_id": 5,
                "dhis2_source_database_name": "UG Malaria Repository",
                "dhis2_source_instance_ids": [4],
            }
        ),
    )
    source_sqla = SimpleNamespace(
        id=23,
        table_name="sv_7_mal_routine_ehmis_indicators",
        database_id=4,
        schema="dhis2_serving",
        dataset_role="DHIS2_SOURCE_DATASET",
        extra=json.dumps(
            {
                "dhis2_staged_dataset_id": 7,
                "dhis2_dataset_display_name": "MAL - Routine eHMIS Indicators",
                "dhis2_source_database_id": 5,
                "dhis2_source_database_name": "UG Malaria Repository",
                "dhis2_source_instance_ids": [4],
            }
        ),
    )

    superset.db.session.query = MagicMock(
        return_value=_FakeQuery([metadata_sqla, source_sqla]),
    )
    superset.db.session.get = MagicMock(return_value=None)
    superset.db.session.add = MagicMock()
    superset.db.session.flush = MagicMock()
    superset.db.session.commit = MagicMock()

    with patch(
        "superset.dhis2.staged_dataset_service.ensure_dhis2_logical_database",
        return_value=SimpleNamespace(id=1),
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=SimpleNamespace(
            get_staging_table_name=lambda dataset: "ds_7_mal_routine_ehmis_indicators",
        ),
    ), patch(
        "superset.dhis2.staged_dataset_service._sync_compat_dataset",
    ) as sync_dataset:
        recovered_ids = svc.recover_missing_staged_datasets_from_sqla_tables(
            database_id=5,
        )

    added_dataset = superset.db.session.add.call_args[0][0]
    assert recovered_ids == [7]
    assert added_dataset.id == 7
    assert added_dataset.database_id == 5
    assert added_dataset.logical_database_id == 1
    assert added_dataset.name == "MAL - Routine eHMIS Indicators"
    assert added_dataset.primary_instance_id == 4
    assert added_dataset.org_unit_source_mode == "primary"
    assert added_dataset.org_unit_scope == "all_levels"
    assert added_dataset.serving_superset_dataset_id == 31
    assert added_dataset.staging_table_name == "ds_7_mal_routine_ehmis_indicators"
    assert json.loads(added_dataset.dataset_config)["configured_connection_ids"] == [4]
    sync_dataset.assert_called_once_with(added_dataset)
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


def test_get_local_data_stats_keeps_raw_totals_and_exposes_serving_totals():
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(database_id=10)
    engine = MagicMock()
    engine.get_staging_table_stats.return_value = {"total_rows": 0, "engine": "clickhouse"}
    engine.serving_table_exists.return_value = True
    engine.query_serving_table.return_value = {"total_rows": 8364}
    engine.get_superset_sql_table_ref.return_value = "dhis2_staging.ds_7_indicators"
    engine.get_serving_sql_table_ref.return_value = "dhis2_serving.sv_7_indicators"

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
        return_value=engine,
    ):
        stats = svc.get_local_data_stats(dataset.id)

    assert stats["total_rows"] == 0
    assert stats["staging_total_rows"] == 0
    assert stats["serving_total_rows"] == 8364
    assert stats["available_total_rows"] == 8364
    assert stats["row_source"] == "staging"
    assert stats["staging_table_ref"] == "dhis2_staging.ds_7_indicators"
    assert stats["serving_table_ref"] == "dhis2_serving.sv_7_indicators"


def test_get_serving_columns_prefers_registered_sqla_columns():
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(id=7, database_id=10)
    registered_columns = [
        {
            "column_name": "period",
            "verbose_name": "Period",
            "type": "STRING",
            "is_dttm": False,
            "filterable": True,
            "groupby": True,
            "is_active": True,
            "extra": '{"dhis2_is_period": true}',
        }
    ]

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service._get_registered_serving_columns",
        return_value=registered_columns,
    ), patch(
        "superset.dhis2.staged_dataset_service._get_manifest_serving_columns",
        side_effect=AssertionError("manifest fallback should not run"),
    ):
        serving_columns = svc.get_serving_columns(dataset.id)

    assert serving_columns == registered_columns


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
        table_name_override=None,
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
    engine = MagicMock(spec=["query_serving_table"])
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
        table_name_override=None,
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
    ), patch(
        "superset.dhis2.staged_dataset_service.get_serving_columns",
        return_value=[],
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
    build_mock.assert_called_once_with(dataset, engine=engine, refresh_scope=None)


def test_ensure_serving_table_keeps_live_columns_when_staging_is_empty():
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(database_id=10)

    class _StaticEngine:
        def serving_table_exists(self, _dataset):
            return True

        def get_staging_table_stats(self, _dataset):
            return {"total_rows": 0}

        def get_serving_table_columns(self, _dataset):
            return ["period", "region", "malaria_cases"]

        def get_serving_sql_table_ref(self, _dataset):
            return "dhis2_serving.sv_1_dataset"

    engine = _StaticEngine()
    manifest = {
        "columns": [
            {"column_name": "period"},
            {"column_name": "ou_level"},
            {"column_name": "malaria_cases"},
            {"column_name": "_manifest_build_v7"},
        ]
    }
    registered_columns = [
        {"column_name": "period"},
        {"column_name": "region"},
        {"column_name": "malaria_cases"},
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
        "superset.dhis2.staged_dataset_service.get_serving_columns",
        return_value=registered_columns,
    ), patch(
        "superset.dhis2.staged_dataset_service.build_serving_table",
        side_effect=AssertionError("build_serving_table should not run"),
    ):
        table_ref, serving_columns = svc.ensure_serving_table(dataset.id)

    assert table_ref == "dhis2_serving.sv_1_dataset"
    assert serving_columns == registered_columns

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


# ---------------------------------------------------------------------------
# _specialized_marts_need_rebuild tests
# ---------------------------------------------------------------------------

def test_specialized_marts_need_rebuild_returns_false_for_non_clickhouse_engine():
    from superset.dhis2.staged_dataset_service import _specialized_marts_need_rebuild

    engine = MagicMock(spec=[])  # no kpi_mart_exists attribute
    dataset = _dataset()
    manifest = {"columns": [{"column_name": "malaria_cases", "variable_id": "abc123"}]}

    result = _specialized_marts_need_rebuild(engine, dataset, manifest)

    assert result is False


def test_specialized_marts_need_rebuild_returns_false_when_no_indicators():
    from superset.dhis2.staged_dataset_service import _specialized_marts_need_rebuild

    engine = MagicMock()
    engine.kpi_mart_exists.return_value = False  # would return True if checked
    dataset = _dataset()
    manifest = {
        "columns": [
            {"column_name": "period"},  # no variable_id
            {"column_name": "ou_region"},
        ]
    }

    result = _specialized_marts_need_rebuild(engine, dataset, manifest)

    assert result is False
    engine.mart_exists.assert_not_called()


def test_specialized_marts_need_rebuild_returns_true_when_kpi_missing():
    from superset.dhis2.staged_dataset_service import _specialized_marts_need_rebuild

    engine = MagicMock()
    engine.mart_exists.return_value = False
    dataset = _dataset()
    manifest = {
        "columns": [
            {"column_name": "malaria_cases", "variable_id": "abc123", "instance_id": 1, "staged_dataset_id": 1},
        ]
    }

    result = _specialized_marts_need_rebuild(engine, dataset, manifest)

    assert result is True
    engine.mart_exists.assert_called_once_with(dataset)


def test_specialized_marts_need_rebuild_returns_false_when_kpi_exists():
    from superset.dhis2.staged_dataset_service import _specialized_marts_need_rebuild

    engine = MagicMock()
    engine.mart_exists.return_value = True
    dataset = _dataset()
    manifest = {
        "columns": [
            {"column_name": "malaria_cases", "variable_id": "abc123", "instance_id": 1, "staged_dataset_id": 1},
        ]
    }

    result = _specialized_marts_need_rebuild(engine, dataset, manifest)

    assert result is False


def test_specialized_marts_need_rebuild_swallows_exception():
    from superset.dhis2.staged_dataset_service import _specialized_marts_need_rebuild

    engine = MagicMock()
    engine.mart_exists.side_effect = RuntimeError("ClickHouse down")
    dataset = _dataset()
    manifest = {
        "columns": [{"column_name": "malaria_cases", "variable_id": "abc123"}]
    }

    # Should not raise — returns False on error
    result = _specialized_marts_need_rebuild(engine, dataset, manifest)

    assert result is False


def test_ensure_serving_table_triggers_rebuild_when_kpi_mart_missing():
    """ensure_serving_table calls build_serving_table when KPI mart is absent."""
    from superset.dhis2 import staged_dataset_service as svc

    dataset = _dataset(database_id=10)
    engine = MagicMock()
    engine.serving_table_exists.return_value = True
    # Columns match manifest — main table does NOT need rebuild
    engine.get_serving_table_columns.return_value = ["period", "malaria_cases"]
    engine.get_staging_table_stats.return_value = {"total_rows": 5}
    engine.query_serving_table.return_value = {"total_rows": 5}
    # Consolidated mart is missing
    engine.mart_exists.return_value = False

    manifest = {
        "columns": [
            {"column_name": "period"},
            {
                "column_name": "malaria_cases",
                "variable_id": "abc123",
                "instance_id": 1,
                "staged_dataset_id": 1,
            },
        ],
        "dimension_column_names": [],
    }

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
            serving_columns=[{"column_name": "period"}, {"column_name": "malaria_cases"}],
            diagnostics={"source_row_count": 5, "live_serving_row_count": 5},
        ),
    ) as build_mock, patch(
        "superset.dhis2.staged_dataset_service.dataset_columns_payload",
        return_value=[{"column_name": "period"}, {"column_name": "malaria_cases"}],
    ), patch(
        "superset.dhis2.staged_dataset_service.get_serving_columns",
        return_value=[],
    ):
        svc.ensure_serving_table(dataset.id)

    build_mock.assert_called_once_with(dataset, engine=engine, refresh_scope=None)
