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
"""Unit tests for the DHIS2 diagnostics service."""

from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


def _dataset(**kw):
    from superset.dhis2.models import DHIS2StagedDataset

    dataset = DHIS2StagedDataset.__new__(DHIS2StagedDataset)
    dataset.__dict__.update(
        dict(
            id=11,
            database_id=7,
            name="ANC Coverage",
            staging_table_name="ds_11_anc_coverage",
            last_sync_at=None,
            last_sync_status=None,
            last_sync_rows=None,
        )
    )
    dataset.__dict__.update(kw)
    return dataset


def _job(**kw):
    from superset.dhis2.models import DHIS2SyncJob

    job = DHIS2SyncJob.__new__(DHIS2SyncJob)
    job.__dict__.update(
        dict(
            id=91,
            staged_dataset_id=11,
            job_type="manual",
            status="partial",
            started_at=None,
            completed_at=None,
            rows_loaded=120,
            rows_failed=10,
            error_message="Timeout",
            instance_results=json.dumps({"1": {"status": "success"}}),
            created_on=None,
            changed_on=None,
        )
    )
    job.__dict__.update(kw)
    return job


def test_staging_table_info_handles_engine_errors_gracefully():
    from superset.dhis2.diagnostics import DHIS2DiagnosticsService

    service = DHIS2DiagnosticsService()
    dataset = _dataset()

    with patch(
        "superset.dhis2.staging_engine.DHIS2StagingEngine"
    ) as mock_engine_cls:
        mock_engine_cls.return_value.table_exists.side_effect = RuntimeError("boom")

        assert service._staging_table_info(dataset) == (False, None)


def test_get_sync_history_includes_staged_dataset_name():
    import superset
    from superset.dhis2.diagnostics import DHIS2DiagnosticsService

    datasets_query = MagicMock()
    datasets_query.filter.return_value.all.return_value = [(11, "ANC Coverage")]

    jobs_query = MagicMock()
    jobs_query.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
        SimpleNamespace(
            staged_dataset_id=11,
            to_json=lambda: {
                "id": 91,
                "staged_dataset_id": 11,
                "job_type": "manual",
                "status": "partial",
            },
        )
    ]

    superset.db.session.query = MagicMock(
        side_effect=[datasets_query, jobs_query]
    )

    service = DHIS2DiagnosticsService()
    history = service.get_sync_history(7, limit=20)

    assert history[0]["staged_dataset_id"] == 11
    assert history[0]["staged_dataset_name"] == "ANC Coverage"


def test_get_federation_health_includes_persisted_instance_test_metadata():
    import superset
    from superset.dhis2.diagnostics import DHIS2DiagnosticsService

    instance = SimpleNamespace(
        id=101,
        name="National eHMIS DHIS2",
        url="https://national.example.org",
        is_active=True,
        display_order=2,
        last_test_status="success",
        last_test_message="Connected successfully (HTTP 200)",
        last_test_response_time_ms=84.5,
        last_tested_on=SimpleNamespace(
            isoformat=lambda: "2026-03-13T09:00:00",
        ),
    )
    instances_query = MagicMock()
    instances_query.filter.return_value.order_by.return_value.all.return_value = [instance]

    datasets_query = MagicMock()
    datasets_query.filter.return_value.order_by.return_value.all.return_value = []

    count_query = MagicMock()
    count_query.filter.return_value.distinct.return_value.count.return_value = 0

    superset.db.session.query = MagicMock(
        side_effect=[instances_query, datasets_query, count_query]
    )

    health = DHIS2DiagnosticsService().get_federation_health(7)

    assert health["instances"] == [
        {
            "id": 101,
            "name": "National eHMIS DHIS2",
            "url": "https://national.example.org",
            "is_active": True,
            "display_order": 2,
            "last_test_result": {
                "status": "success",
                "message": "Connected successfully (HTTP 200)",
                "response_time_ms": 84.5,
                "tested_on": "2026-03-13T09:00:00",
            },
            "staged_dataset_count": 0,
        }
    ]


def test_get_metadata_status_summarizes_snapshot_health(mocker):
    import superset
    from superset.dhis2.diagnostics import DHIS2DiagnosticsService

    database = SimpleNamespace(
        id=7,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    instance = SimpleNamespace(
        id=101,
        name="National eHMIS DHIS2",
    )
    mocker.patch.object(superset.db.session, "get", return_value=database)
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[instance],
    )
    cache_lookup = mocker.patch(
        "superset.dhis2.diagnostics.metadata_cache_service.get_cached_metadata_payload",
        side_effect=[
            {
                "status": "success",
                "count": 12,
                "cache_refreshed_at": "2026-03-13T10:00:00",
            },
            {
                "status": "success",
                "count": 4,
                "cache_refreshed_at": "2026-03-13T10:00:00",
            },
            {
                "status": "success",
                "count": 1,
                "cache_refreshed_at": "2026-03-13T10:00:00",
            },
            {
                "status": "success",
                "count": 250,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 6,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 0,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 3,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 14,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 7,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 11,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 5,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            None,
        ],
    )

    result = DHIS2DiagnosticsService().get_metadata_status(7)

    assert cache_lookup.call_count == 12
    assert result["overall_status"] == "ready"
    assert result["active_instance_count"] == 1
    assert result["variables"]["status"] == "ready"
    assert result["variables"]["count"] == 273
    assert result["legend_sets"]["status"] == "ready"
    assert result["legend_sets"]["count"] == 0
    assert result["org_units"]["status"] == "ready"
    assert result["org_units"]["count"] == 40
    assert result["last_refreshed_at"] == "2026-03-13T10:01:00"
    assert result["refresh_progress"] is None


def test_get_metadata_status_treats_unsupported_snapshots_as_ready(mocker):
    import superset
    from superset.dhis2.diagnostics import DHIS2DiagnosticsService

    database = SimpleNamespace(
        id=7,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    instance = SimpleNamespace(
        id=101,
        name="National eHMIS DHIS2",
    )
    mocker.patch.object(superset.db.session, "get", return_value=database)
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[instance],
    )
    mocker.patch(
        "superset.dhis2.diagnostics.metadata_cache_service.get_cached_metadata_payload",
        side_effect=[
            {
                "status": "success",
                "count": 12,
                "cache_refreshed_at": "2026-03-13T10:00:00",
            },
            {
                "status": "success",
                "count": 4,
                "cache_refreshed_at": "2026-03-13T10:00:00",
            },
            {
                "status": "success",
                "count": 1,
                "cache_refreshed_at": "2026-03-13T10:00:00",
            },
            {
                "status": "success",
                "count": 6,
                "cache_refreshed_at": "2026-03-13T10:00:00",
            },
            {
                "status": "unsupported",
                "count": 0,
                "message": "This DHIS2 instance does not expose event data items.",
                "cache_refreshed_at": "2026-03-13T10:00:00",
            },
            {
                "status": "success",
                "count": 5,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 250,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 6,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 3,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 14,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            {
                "status": "success",
                "count": 8,
                "cache_refreshed_at": "2026-03-13T10:01:00",
            },
            None,
        ],
    )

    result = DHIS2DiagnosticsService().get_metadata_status(7)

    assert result["variables"]["status"] == "ready"
    assert result["legend_sets"]["status"] == "ready"
    assert result["legend_sets"]["count"] == 5
    assert result["variables"]["instances"][0]["status"] == "ready"
    assert result["overall_status"] == "ready"


def test_get_metadata_status_includes_refresh_progress(mocker):
    import superset
    from superset.dhis2.diagnostics import DHIS2DiagnosticsService

    database = SimpleNamespace(
        id=7,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    instance = SimpleNamespace(
        id=101,
        name="National eHMIS DHIS2",
    )
    mocker.patch.object(superset.db.session, "get", return_value=database)
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[instance],
    )
    mocker.patch(
        "superset.dhis2.diagnostics.metadata_cache_service.get_cached_metadata_payload",
        side_effect=[
            {"status": "success", "count": 10, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 4, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 1, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 6, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 2, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 12, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 15, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 3, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 1, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 2, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {"status": "success", "count": 5, "cache_refreshed_at": "2026-03-13T10:00:00"},
            {
                "status": "running",
                "overall": {
                    "completed_units": 3,
                    "total_units": 18,
                    "percent_complete": 17,
                },
                "variables": {
                    "status": "running",
                    "loaded_count": 252363,
                    "total_count_estimate": 2836389,
                    "completed_units": 2,
                    "total_units": 13,
                    "percent_complete": 15,
                    "instances": [
                        {
                            "id": 101,
                            "name": "National eHMIS DHIS2",
                            "status": "running",
                            "loaded_count": 252363,
                            "total_count_estimate": 2836389,
                            "completed_units": 2,
                            "total_units": 13,
                            "percent_complete": 15,
                        }
                    ],
                },
                "org_units": {
                    "status": "queued",
                    "loaded_count": 0,
                    "total_count_estimate": 12000,
                    "completed_units": 0,
                    "total_units": 5,
                    "percent_complete": 0,
                    "instances": [
                        {
                            "id": 101,
                            "name": "National eHMIS DHIS2",
                            "status": "queued",
                            "loaded_count": 0,
                            "total_count_estimate": 12000,
                            "completed_units": 0,
                            "total_units": 5,
                            "percent_complete": 0,
                        }
                    ],
                },
            },
        ],
    )

    result = DHIS2DiagnosticsService().get_metadata_status(7)

    assert result["refresh_progress"]["status"] == "running"
    assert result["refresh_progress"]["variables"]["loaded_count"] == 252363
    assert result["refresh_progress"]["variables"]["total_count_estimate"] == 2836389
    assert result["refresh_progress"]["org_units"]["percent_complete"] == 0


def test_request_metadata_refresh_targets_active_instances(mocker):
    import superset
    from superset.dhis2.diagnostics import DHIS2DiagnosticsService

    database = SimpleNamespace(
        id=7,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch.object(superset.db.session, "get", return_value=database)
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[
            SimpleNamespace(id=101),
            SimpleNamespace(id=102),
        ],
    )
    schedule = mocker.patch(
        "superset.dhis2.diagnostics.schedule_database_metadata_refresh",
        return_value={"scheduled": True, "mode": "thread", "task_id": None},
    )

    result = DHIS2DiagnosticsService().request_metadata_refresh(7)

    schedule.assert_called_once()
    assert schedule.call_args.kwargs["instance_ids"] == [101, 102]
    assert result["refresh"]["scheduled"] is True
