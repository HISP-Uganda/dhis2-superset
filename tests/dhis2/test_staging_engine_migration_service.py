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
"""Tests for the staging-engine migration service."""

from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from types import SimpleNamespace

from superset.dhis2.staging_engine_migration_service import (
    StagingEngineMigrationService,
)


def test_plan_migration_reports_source_and_target_counts(mocker) -> None:
    service = StagingEngineMigrationService()
    dataset = SimpleNamespace(
        id=7,
        name="EP-Malaria",
        database_id=9,
        serving_superset_dataset_id=15,
    )
    source_engine = mocker.MagicMock()
    source_engine.table_exists.return_value = True
    source_engine.get_staging_table_stats.return_value = {"row_count": 15}
    source_engine.get_superset_sql_table_ref.return_value = "legacy.ds_7_ep_malaria"

    target_engine = mocker.MagicMock()
    target_engine.table_exists.return_value = True
    target_engine.get_staging_table_stats.return_value = {"row_count": 0}
    target_engine.get_superset_sql_table_ref.return_value = "dhis2_staging.ds_7_ep_malaria"
    target_engine.get_serving_sql_table_ref.return_value = "dhis2_serving.sv_7_ep_malaria"

    mocker.patch.object(service, "_load_datasets", return_value=[dataset])
    resolve_engine = mocker.patch.object(service, "_resolve_engine")
    resolve_engine.side_effect = [source_engine, target_engine]

    result = service.plan_migration("superset_db", "clickhouse")

    assert result["count"] == 1
    assert result["result"] == [
        {
            "dataset_id": 7,
            "dataset_name": "EP-Malaria",
            "source_backend": "superset_db",
            "target_backend": "clickhouse",
            "source_table": "legacy.ds_7_ep_malaria",
            "target_table": "dhis2_staging.ds_7_ep_malaria",
            "source_exists": True,
            "target_exists": True,
            "source_rows": 15,
            "target_rows": 0,
            "needs_migration": True,
            "serving_target": "dhis2_serving.sv_7_ep_malaria",
            "serving_superset_dataset_id": 15,
        }
    ]


def test_migrate_staging_objects_imports_rows_and_builds_serving(mocker) -> None:
    service = StagingEngineMigrationService()
    dataset = SimpleNamespace(
        id=7,
        name="EP-Malaria",
        database_id=9,
        serving_superset_dataset_id=15,
    )
    source_engine = mocker.MagicMock()
    source_engine.table_exists.return_value = True
    source_engine.get_staging_table_stats.return_value = {"row_count": 3}
    source_engine.fetch_staging_rows.side_effect = [
        [
            {
                "source_instance_id": 101,
                "source_instance_name": "National eHMIS DHIS2",
                "dx_uid": "de_1",
            },
            {
                "source_instance_id": 101,
                "source_instance_name": "National eHMIS DHIS2",
                "dx_uid": "de_2",
            },
            {
                "source_instance_id": 102,
                "source_instance_name": "Non Routine DHIS2",
                "dx_uid": "de_3",
            },
        ],
        [],
    ]

    target_engine = mocker.MagicMock()
    target_engine.table_exists.return_value = False
    target_engine.get_staging_table_stats.return_value = {"row_count": 3}

    mocker.patch.object(service, "_load_datasets", return_value=[dataset])
    resolve_engine = mocker.patch.object(service, "_resolve_engine")
    resolve_engine.side_effect = [source_engine, target_engine]
    mocker.patch(
        "superset.dhis2.staging_engine_migration_service.build_serving_table",
        return_value=SimpleNamespace(
            diagnostics={"live_serving_row_count": 3},
            serving_table_ref="dhis2_serving.sv_7_ep_malaria",
        ),
    )
    repair = mocker.patch.object(
        service,
        "repair_superset_dataset_references",
        return_value={"result": [{"dataset_id": 7, "repaired_charts": 0}]},
    )
    target_engine.insert_rows.side_effect = (
        lambda _dataset, _instance_id, _instance_name, rows: len(rows)
    )

    result = service.migrate_staging_objects(
        source_backend="superset_db",
        target_backend="clickhouse",
        dataset_ids=[7],
    )

    target_engine.create_staging_table.assert_called_once_with(dataset)
    assert target_engine.insert_rows.call_count == 2
    repair.assert_called_once_with(target_backend="clickhouse", dataset_ids=[7])
    assert result["result"] == [
        {
            "dataset_id": 7,
            "dataset_name": "EP-Malaria",
            "status": "ok",
            "source_rows": 3,
            "imported": 3,
            "target_rows": 3,
            "serving_rows": 3,
            "serving_table": "dhis2_serving.sv_7_ep_malaria",
        }
    ]
