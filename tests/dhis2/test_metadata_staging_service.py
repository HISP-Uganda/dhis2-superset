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
"""Tests for DHIS2 staged metadata refresh and serving."""

from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from types import SimpleNamespace

import superset

from superset.dhis2.metadata_staging_service import MetadataContext


def _database(**kwargs: object) -> SimpleNamespace:
    values = {
        "id": 9,
        "backend": "dhis2",
        "database_name": "Malaria Repository Multiple Sources",
        "sqlalchemy_uri_decrypted": "dhis2://admin:district@national.example.org/api",
    }
    values.update(kwargs)
    return SimpleNamespace(**values)


def test_prepare_metadata_item_normalizes_dhis2_legend_definition() -> None:
    from superset.dhis2.metadata_staging_service import _prepare_metadata_item

    prepared = _prepare_metadata_item(
        "dataElements",
        {
            "id": "de_cases",
            "displayName": "Malaria Cases",
            "valueType": "NUMBER",
            "legendSet": {
                "id": "legend_set_1",
                "displayName": "Malaria Burden",
                "legends": [
                    {
                        "id": "legend_2",
                        "displayName": "Alert",
                        "startValue": 100,
                        "endValue": 500,
                        "color": "#ffcc00",
                    },
                    {
                        "id": "legend_1",
                        "displayName": "Normal",
                        "startValue": 0,
                        "endValue": 100,
                        "color": "#2ca25f",
                    },
                ],
            },
        },
    )

    assert prepared["legendDefinition"] == {
        "source": "dhis2",
        "setId": "legend_set_1",
        "setName": "Malaria Burden",
        "min": 0.0,
        "max": 500.0,
        "items": [
            {
                "id": "legend_1",
                "label": "Normal",
                "startValue": 0.0,
                "endValue": 100.0,
                "color": "#2ca25f",
            },
            {
                "id": "legend_2",
                "label": "Alert",
                "startValue": 100.0,
                "endValue": 500.0,
                "color": "#ffcc00",
            },
        ],
    }


def test_prepare_metadata_item_normalizes_top_level_legend_set() -> None:
    from superset.dhis2.metadata_staging_service import _prepare_metadata_item

    prepared = _prepare_metadata_item(
        "legendSets",
        {
            "id": "legend_set_2",
            "displayName": "Admissions Legend",
            "legends": [
                {
                    "id": "legend_1",
                    "displayName": "Low",
                    "startValue": 0,
                    "endValue": 10,
                    "color": "#2ca25f",
                },
                {
                    "id": "legend_2",
                    "displayName": "High",
                    "startValue": 10,
                    "endValue": 100,
                    "color": "#de2d26",
                },
            ],
        },
    )

    assert prepared["legendDefinition"] == {
        "source": "dhis2",
        "setId": "legend_set_2",
        "setName": "Admissions Legend",
        "min": 0.0,
        "max": 100.0,
        "items": [
            {
                "id": "legend_1",
                "label": "Low",
                "startValue": 0.0,
                "endValue": 10.0,
                "color": "#2ca25f",
            },
            {
                "id": "legend_2",
                "label": "High",
                "startValue": 10.0,
                "endValue": 100.0,
                "color": "#de2d26",
            },
        ],
    }


def test_merge_org_unit_level_items_preserves_per_instance_level_names() -> None:
    from superset.dhis2.org_unit_level_metadata import merge_org_unit_level_items

    merged = merge_org_unit_level_items(
        [
            {
                "level": 1,
                "displayName": "National",
                "source_instance_id": 101,
                "source_instance_name": "National eHMIS DHIS2",
            },
            {
                "level": 1,
                "displayName": "Country",
                "source_instance_id": 102,
                "source_instance_name": "Non Routine DHIS2",
            },
            {
                "level": 2,
                "displayName": "District",
                "source_instance_id": 101,
                "source_instance_name": "National eHMIS DHIS2",
            },
        ]
    )

    assert merged == [
        {
            "level": 1,
            "displayName": "National",
            "name": None,
            "source_instance_ids": [101, 102],
            "source_instance_names": [
                "National eHMIS DHIS2",
                "Non Routine DHIS2",
            ],
            "instance_level_names": {
                "101": "National",
                "102": "Country",
            },
        },
        {
            "level": 2,
            "displayName": "District",
            "name": None,
            "source_instance_ids": [101],
            "source_instance_names": ["National eHMIS DHIS2"],
            "instance_level_names": {"101": "District"},
            "source_instance_id": 101,
            "source_instance_name": "National eHMIS DHIS2",
        },
    ]


def test_refresh_database_metadata_stores_snapshots(mocker) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database()
    superset.db.session.get = mocker.MagicMock(return_value=database)
    mocker.patch(
        "superset.dhis2.metadata_staging_service.ensure_source_for_database",
        return_value=(SimpleNamespace(id=5), {}),
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[],
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service.resolve_metadata_contexts",
        return_value=[
            MetadataContext(
                instance_id=101,
                instance_name="National eHMIS DHIS2",
                base_url="https://national.example.org/api",
                auth=None,
                headers={},
            ),
            MetadataContext(
                instance_id=102,
                instance_name="Non Routine DHIS2",
                base_url="https://non-routine.example.org/api",
                auth=None,
                headers={},
            ),
        ],
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service._fetch_context_metadata_items",
        side_effect=lambda *, context, metadata_type: [
            {
                "id": f"{metadata_type}-{context.instance_id}",
                "displayName": f"{metadata_type}-{context.instance_name}",
            }
        ],
    )
    cache_set = mocker.patch(
        "superset.staging.metadata_cache_service.set_cached_metadata_payload"
    )
    cache_clear = mocker.patch(
        "superset.staging.metadata_cache_service.clear_cached_metadata_prefix"
    )

    result = svc.refresh_database_metadata(
        9,
        metadata_types=["dataElements", "organisationUnits"],
        reason="unit_test",
    )

    assert result["database_id"] == 9
    assert len(result["instance_results"]) == 2
    snapshot_calls = [
        call
        for call in cache_set.call_args_list
        if call.args[1].startswith("dhis2_snapshot:")
    ]
    assert len(snapshot_calls) == 4
    for call in snapshot_calls:
        assert call.kwargs["ttl_seconds"] is None
        assert call.args[3]["status"] == "success"
    cache_clear.assert_called_once_with(9, namespace_prefix="dhis2_metadata:")


def test_refresh_database_metadata_defaults_to_active_configured_instances(
    mocker,
) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database(sqlalchemy_uri_decrypted="dhis2://")
    superset.db.session.get = mocker.MagicMock(return_value=database)
    mocker.patch(
        "superset.dhis2.metadata_staging_service.ensure_source_for_database",
        return_value=(SimpleNamespace(id=5), {}),
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[
            SimpleNamespace(id=101, name="National eHMIS DHIS2"),
            SimpleNamespace(id=102, name="Non Routine DHIS2"),
        ],
    )
    resolve_contexts = mocker.patch(
        "superset.dhis2.metadata_staging_service.resolve_metadata_contexts",
        return_value=[],
    )
    mocker.patch("superset.staging.metadata_cache_service.set_cached_metadata_payload")
    cache_clear = mocker.patch(
        "superset.staging.metadata_cache_service.clear_cached_metadata_prefix"
    )

    result = svc.refresh_database_metadata(
        9,
        metadata_types=["dataElements"],
        reason="unit_test",
    )

    resolve_contexts.assert_called_once_with(
        database,
        instance_id=None,
        requested_instance_ids=[101, 102],
        federated=True,
    )
    assert result["instance_results"] == []
    cache_clear.assert_called_once_with(9, namespace_prefix="dhis2_metadata:")


def test_get_staged_metadata_payload_returns_pending_and_schedules_refresh(mocker) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database()
    mocker.patch(
        "superset.dhis2.metadata_staging_service.resolve_metadata_contexts",
        return_value=[
            MetadataContext(
                instance_id=101,
                instance_name="National eHMIS DHIS2",
                base_url="https://national.example.org/api",
                auth=None,
                headers={},
            )
        ],
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        return_value=None,
    )
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )

    payload = svc.get_staged_metadata_payload(
        database=database,
        metadata_type="dataElements",
        requested_instance_ids=[101],
        federated=True,
    )

    assert payload["status"] == "pending"
    assert payload["result"] == []
    assert "prepared in local staging" in payload["message"]
    assert payload["instance_results"] == [
        {
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "pending",
            "count": 0,
            "error": "Metadata snapshot not ready yet.",
        }
    ]
    schedule.assert_called_once()


def test_get_staged_metadata_payload_live_rehydrates_legend_sets(mocker) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database()
    context = MetadataContext(
        instance_id=101,
        instance_name="National eHMIS DHIS2",
        base_url="https://national.example.org/api",
        auth=None,
        headers={},
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service._resolve_staged_contexts",
        return_value=[context],
    )
    get_cached_payload = mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        return_value=None,
    )
    set_cached_payload = mocker.patch(
        "superset.staging.metadata_cache_service.set_cached_metadata_payload"
    )
    fetch_items = mocker.patch(
        "superset.dhis2.metadata_staging_service._fetch_context_metadata_items",
        return_value=[
            {
                "id": "legend_set_1",
                "displayName": "Malaria Burden",
                "legendDefinition": {
                    "source": "dhis2",
                    "setId": "legend_set_1",
                    "setName": "Malaria Burden",
                    "min": 0.0,
                    "max": 100.0,
                    "items": [
                        {
                            "id": "legend_1",
                            "label": "Low",
                            "startValue": 0.0,
                            "endValue": 100.0,
                            "color": "#2ca25f",
                        }
                    ],
                },
            }
        ],
    )
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )

    payload = svc.get_staged_metadata_payload(
        database=database,
        metadata_type="legendSets",
        requested_instance_ids=[101],
        federated=True,
    )

    assert payload["status"] == "success"
    assert payload["result"] == [
        {
            "id": "legend_set_1",
            "displayName": "Malaria Burden",
            "legendDefinition": {
                "source": "dhis2",
                "setId": "legend_set_1",
                "setName": "Malaria Burden",
                "min": 0.0,
                "max": 100.0,
                "items": [
                    {
                        "id": "legend_1",
                        "label": "Low",
                        "startValue": 0.0,
                        "endValue": 100.0,
                        "color": "#2ca25f",
                    }
                ],
            },
            "source_instance_id": 101,
            "source_instance_name": "National eHMIS DHIS2",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
        }
    ]
    assert payload["instance_results"] == [
        {
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
            "count": 1,
            "load_source": "live_fallback",
        }
    ]
    fetch_items.assert_called_once_with(
        context=context,
        metadata_type="legendSets",
    )
    assert get_cached_payload.call_count >= 1
    set_cached_payload.assert_called_once()
    schedule.assert_not_called()


def test_schedule_database_metadata_refresh_after_commit_uses_current_session(
    mocker,
) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    session = mocker.MagicMock(name="session")
    listen = mocker.patch("superset.dhis2.metadata_staging_service.event.listen")
    remove = mocker.patch("superset.dhis2.metadata_staging_service.event.remove")
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )
    mocker.patch.object(svc.db, "session", mocker.MagicMock(return_value=session))

    svc.schedule_database_metadata_refresh_after_commit(
        9,
        instance_ids=[101],
        metadata_types=["dataElements"],
        reason="database_created",
    )

    callbacks = {call.args[1]: call.args[2] for call in listen.call_args_list}
    assert listen.call_count == 2
    for call in listen.call_args_list:
        assert call.args[0] is session
        assert call.kwargs["once"] is True

    callbacks["after_commit"](session)

    schedule.assert_called_once_with(
        9,
        instance_ids=[101],
        metadata_types=["dataElements"],
        reason="database_created",
    )
    remove.assert_called_once_with(session, "after_rollback", callbacks["after_rollback"])


def test_schedule_database_metadata_refresh_after_commit_swallows_scheduler_failures(
    mocker,
) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    session = mocker.MagicMock(name="session")
    listen = mocker.patch("superset.dhis2.metadata_staging_service.event.listen")
    remove = mocker.patch("superset.dhis2.metadata_staging_service.event.remove")
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh",
        side_effect=RuntimeError("scheduler unavailable"),
    )
    logger = mocker.patch("superset.dhis2.metadata_staging_service.logger")
    mocker.patch.object(svc.db, "session", mocker.MagicMock(return_value=session))

    svc.schedule_database_metadata_refresh_after_commit(9, reason="database_created")

    callbacks = {call.args[1]: call.args[2] for call in listen.call_args_list}
    callbacks["after_commit"](session)

    schedule.assert_called_once()
    logger.warning.assert_called_once()
    remove.assert_called_once_with(session, "after_rollback", callbacks["after_rollback"])


def test_refresh_database_metadata_marks_unsupported_event_data_items_as_non_fatal(
    mocker,
) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database()
    superset.db.session.get = mocker.MagicMock(return_value=database)
    mocker.patch(
        "superset.dhis2.metadata_staging_service.ensure_source_for_database",
        return_value=(SimpleNamespace(id=5), {}),
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[],
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service.resolve_metadata_contexts",
        return_value=[
            MetadataContext(
                instance_id=101,
                instance_name="National eHMIS DHIS2",
                base_url="https://national.example.org/api",
                auth=None,
                headers={},
            )
        ],
    )

    def _fetch(*, context, metadata_type):
        if metadata_type == "eventDataItems":
            raise svc.UnsupportedMetadataError(
                "This DHIS2 instance does not expose event data items."
            )
        return [{"id": f"{metadata_type}-{context.instance_id}", "displayName": metadata_type}]

    mocker.patch(
        "superset.dhis2.metadata_staging_service._fetch_context_metadata_items",
        side_effect=_fetch,
    )
    cache_set = mocker.patch(
        "superset.staging.metadata_cache_service.set_cached_metadata_payload"
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.clear_cached_metadata_prefix"
    )

    result = svc.refresh_database_metadata(
        9,
        metadata_types=["dataElements", "eventDataItems"],
        reason="unit_test",
    )

    assert result["instance_results"] == [
        {
            "instance_id": 101,
            "instance_name": "National eHMIS DHIS2",
            "metadata": {
                "dataElements": {"status": "success", "count": 1},
                "eventDataItems": {
                    "status": "unsupported",
                    "count": 0,
                    "message": "This DHIS2 instance does not expose event data items.",
                },
            },
        }
    ]
    snapshot_calls = [
        call
        for call in cache_set.call_args_list
        if call.args[1].startswith("dhis2_snapshot:")
    ]
    event_snapshot = next(
        call for call in snapshot_calls if call.args[1] == "dhis2_snapshot:eventDataItems"
    )
    assert event_snapshot.args[3]["status"] == "unsupported"


def test_refresh_all_dhis2_metadata_includes_boundary_metadata_types(mocker) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    databases = [
        _database(id=9),
        _database(id=10, database_name="Cross Border Repository"),
    ]
    query = mocker.MagicMock(name="database_query")
    query.all.return_value = databases
    mocker.patch.object(svc.db.session, "query", return_value=query)
    refresh = mocker.patch(
        "superset.dhis2.metadata_staging_service.refresh_database_metadata",
        return_value={"database_id": 9},
    )

    result = svc.refresh_all_dhis2_metadata(
        metadata_types=["dataElements"],
        reason="scheduled_refresh",
    )

    assert result["database_count"] == 2
    assert refresh.call_count == 2
    for call in refresh.call_args_list:
        metadata_types = call.kwargs["metadata_types"]
        assert "dataElements" in metadata_types
        assert "organisationUnitLevels" in metadata_types
        assert "organisationUnits" in metadata_types
        assert "legendSets" in metadata_types
        assert "geoJSON" in metadata_types
        assert "orgUnitHierarchy" in metadata_types


def test_get_staged_metadata_payload_treats_unsupported_snapshots_as_ready(
    mocker,
) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database()
    mocker.patch(
        "superset.dhis2.metadata_staging_service.resolve_metadata_contexts",
        return_value=[
            MetadataContext(
                instance_id=101,
                instance_name="National eHMIS DHIS2",
                base_url="https://national.example.org/api",
                auth=None,
                headers={},
            )
        ],
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        return_value={
            "status": "unsupported",
            "result": [],
            "count": 0,
            "message": "This DHIS2 instance does not expose event data items.",
        },
    )
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )

    payload = svc.get_staged_metadata_payload(
        database=database,
        metadata_type="eventDataItems",
        requested_instance_ids=[101],
        federated=True,
    )

    assert payload["status"] == "success"
    assert payload["result"] == []
    assert payload["instance_results"] == [
        {
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
            "count": 0,
            "warning": "This DHIS2 instance does not expose event data items.",
        }
    ]
    schedule.assert_not_called()


def test_get_staged_metadata_payload_filters_and_tags_snapshots(mocker) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database()
    mocker.patch(
        "superset.dhis2.metadata_staging_service.resolve_metadata_contexts",
        return_value=[
            MetadataContext(
                instance_id=101,
                instance_name="National eHMIS DHIS2",
                base_url="https://national.example.org/api",
                auth=None,
                headers={},
            ),
            MetadataContext(
                instance_id=102,
                instance_name="Non Routine DHIS2",
                base_url="https://non-routine.example.org/api",
                auth=None,
                headers={},
            ),
        ],
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: (
            {
                "status": "success",
                "result": [
                    {
                        "id": "de1",
                        "displayName": "ANC Visits",
                        "domainType": "AGGREGATE",
                        "valueType": "NUMBER",
                        "aggregationType": "SUM",
                    }
                ],
            }
            if namespace == "dhis2_snapshot:dataElements"
            and key_parts.get("instance_id") == 101
            else {
                "status": "success",
                "result": [
                    {
                        "id": "de2",
                        "displayName": "Malaria Cases",
                        "domainType": "AGGREGATE",
                        "valueType": "INTEGER",
                        "aggregationType": "SUM",
                    }
                ],
            }
            if namespace == "dhis2_snapshot:dataElements"
            and key_parts.get("instance_id") == 102
            else None
        ),
    )
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )

    payload = svc.get_staged_metadata_payload(
        database=database,
        metadata_type="dataElements",
        requested_instance_ids=[101, 102],
        federated=True,
        table_name="analytics",
    )

    assert payload["status"] == "success"
    assert payload["message"] is None
    assert payload["instance_results"] == [
        {
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
            "count": 1,
        },
        {
            "id": 102,
            "name": "Non Routine DHIS2",
            "status": "success",
            "count": 1,
        },
    ]
    assert payload["result"] == [
        {
            "id": "de1",
            "displayName": "ANC Visits",
            "domainType": "AGGREGATE",
            "valueType": "NUMBER",
            "aggregationType": "SUM",
            "category": "Aggregatable Data Elements",
            "typeInfo": "NUMBER (SUM)",
            "source_instance_id": 101,
            "source_instance_name": "National eHMIS DHIS2",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
        },
        {
            "id": "de2",
            "displayName": "Malaria Cases",
            "domainType": "AGGREGATE",
            "valueType": "INTEGER",
            "aggregationType": "SUM",
            "category": "Aggregatable Data Elements",
            "typeInfo": "INTEGER (SUM)",
            "source_instance_id": 102,
            "source_instance_name": "Non Routine DHIS2",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
        },
    ]
    schedule.assert_not_called()


def test_filter_metadata_items_supports_group_and_program_search() -> None:
    from superset.dhis2.metadata_staging_service import filter_metadata_items

    data_elements = filter_metadata_items(
        metadata_type="dataElements",
        items=[
            {
                "id": "de_1",
                "displayName": "ANC Visits",
                "groups": [{"displayName": "Maternal Health"}],
            },
            {
                "id": "de_2",
                "displayName": "Malaria Cases",
                "groups": [{"displayName": "Malaria"}],
            },
        ],
        group_search="maternal",
    )
    assert [item["id"] for item in data_elements] == ["de_1"]
    assert data_elements[0]["groupLabels"] == ["Maternal Health"]

    program_indicators = filter_metadata_items(
        metadata_type="programIndicators",
        items=[
            {
                "id": "pi_1",
                "displayName": "ANC Enrolment Rate",
                "program": {"displayName": "ANC Program"},
            },
            {
                "id": "pi_2",
                "displayName": "Malaria Follow-up",
                "program": {"displayName": "Malaria Program"},
            },
        ],
        group_search="anc",
    )
    assert [item["id"] for item in program_indicators] == ["pi_1"]

    event_data_items = filter_metadata_items(
        metadata_type="eventDataItems",
        items=[
            {
                "id": "edi_1",
                "displayName": "ANC Referral",
                "programStage": {
                    "displayName": "ANC Stage",
                    "program": {"displayName": "ANC Program"},
                },
                "dataElement": {
                    "displayName": "Referral Count",
                    "groups": [{"displayName": "Referral"}],
                },
            },
            {
                "id": "edi_2",
                "displayName": "Malaria Test",
                "programStage": {
                    "displayName": "Lab Stage",
                    "program": {"displayName": "Malaria Program"},
                },
                "dataElement": {
                    "displayName": "Positive Tests",
                    "groups": [{"displayName": "Lab"}],
                },
            },
        ],
        group_search="referral",
    )
    assert [item["id"] for item in event_data_items] == ["edi_1"]


def test_filter_metadata_items_supports_advanced_variable_filters() -> None:
    from superset.dhis2.metadata_staging_service import filter_metadata_items

    indicator_items = filter_metadata_items(
        metadata_type="indicators",
        items=[
            {
                "id": "ind_1",
                "displayName": "ANC Coverage",
                "valueType": "PERCENTAGE",
                "indicatorType": {"id": "ity_1", "displayName": "Percent"},
                "groups": [{"id": "grp_1", "displayName": "Maternal Health"}],
            },
            {
                "id": "ind_2",
                "displayName": "Malaria Tests",
                "valueType": "NUMBER",
                "indicatorType": {"id": "ity_2", "displayName": "Count"},
                "groups": [{"id": "grp_2", "displayName": "Malaria"}],
            },
        ],
        indicator_type_id="ity_1",
        group_id="grp_1",
    )
    assert [item["id"] for item in indicator_items] == ["ind_1"]

    program_indicator_items = filter_metadata_items(
        metadata_type="programIndicators",
        items=[
            {
                "id": "pi_1",
                "displayName": "ANC Enrolment Rate",
                "program": {"id": "prog_1", "displayName": "ANC Program"},
                "analyticsType": "ENROLLMENT",
            },
            {
                "id": "pi_2",
                "displayName": "Follow-up Visit Rate",
                "program": {"id": "prog_1", "displayName": "ANC Program"},
                "analyticsType": "EVENT",
            },
        ],
        program_id="prog_1",
        analytics_type="EVENT",
    )
    assert [item["id"] for item in program_indicator_items] == ["pi_2"]

    event_data_items = filter_metadata_items(
        metadata_type="eventDataItems",
        items=[
            {
                "id": "edi_1",
                "displayName": "ANC Referral",
                "programStage": {
                    "id": "stage_1",
                    "displayName": "ANC Stage",
                    "program": {"id": "prog_1", "displayName": "ANC Program"},
                },
                "dataElement": {
                    "displayName": "Referral Count",
                    "valueType": "INTEGER",
                    "domainType": "TRACKER",
                    "groups": [{"id": "grp_1", "displayName": "Referral"}],
                },
            },
            {
                "id": "edi_2",
                "displayName": "Malaria Test",
                "programStage": {
                    "id": "stage_2",
                    "displayName": "Lab Stage",
                    "program": {"id": "prog_2", "displayName": "Malaria Program"},
                },
                "dataElement": {
                    "displayName": "Positive Tests",
                    "valueType": "NUMBER",
                    "domainType": "TRACKER",
                    "groups": [{"id": "grp_2", "displayName": "Lab"}],
                },
            },
        ],
        program_id="prog_1",
        program_stage_id="stage_1",
        value_type="INTEGER",
        domain_type="TRACKER",
        group_id="grp_1",
    )
    assert [item["id"] for item in event_data_items] == ["edi_1"]


def test_get_staged_metadata_payload_supports_group_sets_and_pagination(mocker) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database()
    mocker.patch(
        "superset.dhis2.metadata_staging_service._resolve_staged_contexts",
        return_value=[
            MetadataContext(
                instance_id=101,
                instance_name="National eHMIS DHIS2",
                base_url="https://national.example.org/api",
                auth=None,
                headers={},
            )
        ],
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda database_id, namespace, key_parts: (
            {
                "status": "success",
                "result": [
                    {
                        "id": "de1",
                        "displayName": "ANC Visits",
                        "domainType": "AGGREGATE",
                        "valueType": "NUMBER",
                        "aggregationType": "SUM",
                        "groups": [{"id": "grp_1", "displayName": "Maternal Health"}],
                    },
                    {
                        "id": "de2",
                        "displayName": "Malaria Cases",
                        "domainType": "AGGREGATE",
                        "valueType": "INTEGER",
                        "aggregationType": "SUM",
                        "groups": [{"id": "grp_2", "displayName": "Malaria"}],
                    },
                ],
            }
            if namespace == "dhis2_snapshot:dataElements"
            else {
                "status": "success",
                "result": [
                    {
                        "id": "gs_1",
                        "displayName": "Clinical Domains",
                        "dataElementGroups": [
                            {"id": "grp_1", "displayName": "Maternal Health"}
                        ],
                    }
                ],
            }
            if namespace == "dhis2_snapshot:dataElementGroupSets"
            else None
        ),
    )
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )

    payload = svc.get_staged_metadata_payload(
        database=database,
        metadata_type="dataElements",
        requested_instance_ids=[101],
        federated=True,
        group_set_id="gs_1",
        page=1,
        page_size=1,
    )

    assert payload["status"] == "success"
    assert payload["result"] == [
        {
            "id": "de1",
            "displayName": "ANC Visits",
            "domainType": "AGGREGATE",
            "valueType": "NUMBER",
            "aggregationType": "SUM",
            "groups": [{"id": "grp_1", "displayName": "Maternal Health"}],
            "groupLabels": ["Maternal Health"],
            "source_instance_id": 101,
            "source_instance_name": "National eHMIS DHIS2",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
        }
    ]
    assert payload["pagination"] == {
        "page": 1,
        "page_size": 1,
        "total": 1,
        "total_pages": 1,
        "has_next": False,
        "has_previous": False,
    }
    schedule.assert_not_called()


def test_get_staged_metadata_payload_filters_by_group_id_using_group_labels_fallback(
    mocker,
) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database()
    mocker.patch(
        "superset.dhis2.metadata_staging_service._resolve_staged_contexts",
        return_value=[
            MetadataContext(
                instance_id=101,
                instance_name="National eHMIS DHIS2",
                base_url="https://national.example.org/api",
                auth=None,
                headers={},
            )
        ],
    )

    def get_cached_payload(database_id, namespace, key_parts):
        if namespace == "dhis2_snapshot:dataElements":
            return {
                "status": "success",
                "result": [
                    {
                        "id": "de1",
                        "displayName": "ANC Visits",
                        "groupLabels": ["Maternal Health"],
                    },
                    {
                        "id": "de2",
                        "displayName": "Malaria Cases",
                        "groupLabels": ["Malaria"],
                    },
                ],
            }
        if namespace == "dhis2_snapshot:dataElementGroups":
            return {
                "status": "success",
                "result": [
                    {
                        "id": "grp_1",
                        "displayName": "Maternal Health",
                    }
                ],
            }
        return None

    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        side_effect=get_cached_payload,
    )
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )

    payload = svc.get_staged_metadata_payload(
        database=database,
        metadata_type="dataElements",
        requested_instance_ids=[101],
        federated=True,
        group_id="grp_1",
    )

    assert payload["status"] == "success"
    assert [item["id"] for item in payload["result"]] == ["de1"]
    assert payload["result"][0]["source_instance_name"] == "National eHMIS DHIS2"
    schedule.assert_not_called()


def test_refresh_database_metadata_stages_geojson_and_hierarchy(mocker) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database(sqlalchemy_uri_decrypted="dhis2://")
    superset.db.session.get = mocker.MagicMock(return_value=database)
    mocker.patch(
        "superset.dhis2.metadata_staging_service.ensure_source_for_database",
        return_value=(SimpleNamespace(id=5), {}),
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[SimpleNamespace(id=101, name="National eHMIS DHIS2")],
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service._resolve_staged_contexts",
        return_value=[
            MetadataContext(
                instance_id=101,
                instance_name="National eHMIS DHIS2",
                base_url="https://national.example.org/api",
                auth=None,
                headers={},
            )
        ],
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service._fetch_context_metadata_items",
        side_effect=lambda *, context, metadata_type: (
            [
                {
                    "id": "OU_1",
                    "displayName": "Kampala",
                    "level": 2,
                    "parentId": "ROOT",
                    "path": "/ROOT/OU_1",
                }
            ]
            if metadata_type == "organisationUnits"
            else []
        ),
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service._fetch_context_geojson_feature_collection",
        return_value={
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": "OU_1",
                    "geometry": {"type": "Polygon", "coordinates": [[[32.5, 0.3]]]},
                    "properties": {
                        "id": "OU_1",
                        "name": "Kampala",
                        "level": 2,
                        "parentId": "ROOT",
                        "path": "/ROOT/OU_1",
                    },
                }
            ],
        },
    )
    cache_set = mocker.patch(
        "superset.staging.metadata_cache_service.set_cached_metadata_payload"
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.clear_cached_metadata_prefix"
    )

    svc.refresh_database_metadata(
        9,
        metadata_types=[
            "organisationUnits",
            svc.GEOJSON_METADATA_TYPE,
            svc.ORG_UNIT_HIERARCHY_METADATA_TYPE,
        ],
        reason="unit_test",
    )

    payloads = {
        call.args[1]: call.args[3]
        for call in cache_set.call_args_list
        if call.args[1].startswith("dhis2_snapshot:")
    }
    assert payloads["dhis2_snapshot:geoJSON"]["count"] == 1
    assert payloads["dhis2_snapshot:geoJSON"]["result"]["features"][0]["id"] == "OU_1"
    hierarchy_node = payloads["dhis2_snapshot:orgUnitHierarchy"]["result"][0]
    assert hierarchy_node["id"] == "OU_1"
    assert hierarchy_node["ancestorIds"] == ["ROOT"]
    assert hierarchy_node["hasGeometry"] is True


def test_get_staged_geo_payload_filters_and_tags_feature_collections(mocker) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database(sqlalchemy_uri_decrypted="dhis2://")
    mocker.patch(
        "superset.dhis2.metadata_staging_service._resolve_staged_contexts",
        return_value=[
            MetadataContext(
                instance_id=101,
                instance_name="National eHMIS DHIS2",
                base_url="https://national.example.org/api",
                auth=None,
                headers={},
            ),
            MetadataContext(
                instance_id=102,
                instance_name="Non Routine DHIS2",
                base_url="https://non-routine.example.org/api",
                auth=None,
                headers={},
            ),
        ],
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        side_effect=[
            {
                "status": "success",
                "result": {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "id": "OU_1",
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [[[32.5, 0.3]]],
                            },
                            "properties": {
                                "id": "OU_1",
                                "name": "Kampala",
                                "level": 2,
                                "parentId": "ROOT",
                                "path": "/ROOT/OU_1",
                            },
                        },
                        {
                            "type": "Feature",
                            "id": "OU_1A",
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [[[32.6, 0.4]]],
                            },
                            "properties": {
                                "id": "OU_1A",
                                "name": "Makindye",
                                "level": 3,
                                "parentId": "OU_1",
                                "path": "/ROOT/OU_1/OU_1A",
                            },
                        },
                    ],
                },
            },
            {
                "status": "success",
                "result": {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "id": "OU_2",
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [[[31.7, 0.5]]],
                            },
                            "properties": {
                                "id": "OU_2",
                                "name": "Gulu",
                                "level": 2,
                                "parentId": "ROOT",
                                "path": "/ROOT/OU_2",
                            },
                        }
                    ],
                },
            },
            {
                "status": "success",
                "result": {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "id": "OU_1",
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [[[32.5, 0.3]]],
                            },
                            "properties": {
                                "id": "OU_1",
                                "name": "Kampala",
                                "level": 2,
                                "parentId": "ROOT",
                                "path": "/ROOT/OU_1",
                            },
                        }
                    ],
                },
            },
            {
                "status": "success",
                "result": {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "id": "OU_2",
                            "geometry": {
                                "type": "MultiPolygon",
                                "coordinates": [[[[31.7, 0.5]]]],
                            },
                            "properties": {
                                "id": "OU_2",
                                "name": "Gulu",
                                "level": 2,
                                "parentId": "ROOT",
                                "path": "/ROOT/OU_2",
                            },
                        }
                    ],
                },
            },
        ],
    )
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )

    geojson_payload = svc.get_staged_geo_payload(
        database=database,
        metadata_type="geoJSON",
        requested_instance_ids=[101, 102],
        federated=True,
        levels=["2"],
        parent_ids=["ROOT"],
    )

    assert geojson_payload["status"] == "success"
    assert [feature["id"] for feature in geojson_payload["result"]["features"]] == [
        "OU_1",
        "OU_2",
    ]
    assert geojson_payload["result"]["features"][0]["properties"]["source_instance_id"] == 101
    assert geojson_payload["result"]["features"][1]["properties"]["source_instance_id"] == 102

    geo_features_payload = svc.get_staged_geo_payload(
        database=database,
        metadata_type="geoFeatures",
        requested_instance_ids=[101, 102],
        federated=True,
        levels=["2"],
        parent_ids=["ROOT"],
    )

    assert geo_features_payload["status"] == "success"
    assert [feature["id"] for feature in geo_features_payload["result"]] == [
        "OU_1",
        "OU_2",
    ]
    assert geo_features_payload["result"][0]["ty"] == 2
    assert geo_features_payload["result"][1]["ty"] == 3
    schedule.assert_not_called()


def test_get_staged_geo_payload_live_fallback_persists_missing_snapshots(mocker) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database(sqlalchemy_uri_decrypted="dhis2://")
    context = MetadataContext(
        instance_id=101,
        instance_name="National eHMIS DHIS2",
        base_url="https://national.example.org/api",
        auth=None,
        headers={},
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service._resolve_staged_contexts",
        return_value=[context],
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        side_effect=[
            None,
            None,
        ],
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service._fetch_context_metadata_items",
        return_value=[
            {
                "id": "OU_1",
                "displayName": "Kampala",
                "level": 2,
                "parentId": "ROOT",
                "path": "/ROOT/OU_1",
            }
        ],
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service._fetch_context_geojson_feature_collection",
        return_value={
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": "OU_1",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[32.5, 0.3]]],
                    },
                    "properties": {
                        "id": "OU_1",
                        "name": "Kampala",
                        "level": 2,
                        "parentId": "ROOT",
                        "path": "/ROOT/OU_1",
                    },
                }
            ],
        },
    )
    cache_set = mocker.patch(
        "superset.staging.metadata_cache_service.set_cached_metadata_payload"
    )
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )

    payload = svc.get_staged_geo_payload(
        database=database,
        metadata_type="geoJSON",
        requested_instance_ids=[101],
        federated=True,
        levels=["2"],
        parent_ids=["ROOT"],
        allow_live_fallback=True,
    )

    assert payload["status"] == "success"
    assert payload["count"] == 1
    assert payload["result"]["features"][0]["id"] == "OU_1"
    assert payload["instance_results"] == [
        {
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
            "count": 1,
            "load_source": "live_fallback",
        }
    ]
    assert [
        call.args[1]
        for call in cache_set.call_args_list
        if call.args[1].startswith("dhis2_snapshot:")
    ] == [
        "dhis2_snapshot:organisationUnits",
        "dhis2_snapshot:geoJSON",
        "dhis2_snapshot:orgUnitHierarchy",
    ]
    schedule.assert_not_called()


def test_fetch_context_geojson_feature_collection_falls_back_to_geo_features_for_incomplete_geojson(
    mocker,
) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    context = MetadataContext(
        instance_id=101,
        instance_name="National eHMIS DHIS2",
        base_url="https://national.example.org/api",
        auth=None,
        headers={},
    )
    org_unit_items = [
        {
            "id": "ROOT",
            "displayName": "MOH - Uganda",
            "level": 1,
            "path": "/ROOT",
        },
        {
            "id": "OU_1",
            "displayName": "Acholi",
            "level": 2,
            "parentId": "ROOT",
            "path": "/ROOT/OU_1",
        },
    ]
    geojson_response = mocker.MagicMock(status_code=200)
    geojson_response.json.return_value = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": "ROOT",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[30.0, 0.0], [31.0, 0.0], [31.0, 1.0], [30.0, 0.0]]],
                },
                "properties": {
                    "id": "ROOT",
                    "name": "MOH - Uganda",
                    "level": 1,
                    "path": "/ROOT",
                },
            }
        ],
    }
    geo_features_level_1 = mocker.MagicMock(status_code=200)
    geo_features_level_1.json.return_value = [
        {
            "id": "ROOT",
            "na": "MOH - Uganda",
            "le": 1,
            "ty": 2,
            "co": "[[[30.0,0.0],[31.0,0.0],[31.0,1.0],[30.0,0.0]]]",
        }
    ]
    geo_features_level_2 = mocker.MagicMock(status_code=200)
    geo_features_level_2.json.return_value = [
        {
            "id": "OU_1",
            "na": "Acholi",
            "le": 2,
            "ty": 2,
            "pi": "ROOT",
            "pn": "MOH - Uganda",
            "co": "[[[32.0,1.0],[33.0,1.0],[33.0,2.0],[32.0,1.0]]]",
        },
    ]
    requests_get = mocker.patch(
        "superset.dhis2.metadata_staging_service.requests.get",
        side_effect=[geojson_response, geo_features_level_1, geo_features_level_2],
    )

    payload = svc._fetch_context_geojson_feature_collection(
        context=context,
        org_unit_items=org_unit_items,
    )

    assert [feature["id"] for feature in payload["features"]] == ["ROOT", "OU_1"]
    assert payload["features"][1]["properties"]["level"] == 2
    assert requests_get.call_count == 3
    assert requests_get.call_args_list[1].kwargs["params"] == {"ou": "ou:LEVEL-1"}
    assert requests_get.call_args_list[2].kwargs["params"] == {"ou": "ou:LEVEL-2"}


def test_get_staged_geo_payload_rehydrates_incomplete_success_snapshot_when_requested_level_is_missing(
    mocker,
) -> None:
    from superset.dhis2 import metadata_staging_service as svc

    database = _database(sqlalchemy_uri_decrypted="dhis2://")
    context = MetadataContext(
        instance_id=101,
        instance_name="National eHMIS DHIS2",
        base_url="https://national.example.org/api",
        auth=None,
        headers={},
    )
    mocker.patch(
        "superset.dhis2.metadata_staging_service._resolve_staged_contexts",
        return_value=[context],
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        return_value={
            "status": "success",
            "result": {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "id": "ROOT",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[30.0, 0.0], [31.0, 0.0], [31.0, 1.0], [30.0, 0.0]]],
                        },
                        "properties": {
                            "id": "ROOT",
                            "name": "MOH - Uganda",
                            "level": 1,
                        },
                    }
                ],
            },
        },
    )
    hydrate = mocker.patch(
        "superset.dhis2.metadata_staging_service._hydrate_geo_snapshots_from_live",
        return_value={
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": "OU_1",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[32.5, 0.3]]],
                    },
                    "properties": {
                        "id": "OU_1",
                        "name": "Kampala",
                        "level": 2,
                        "parentId": "ROOT",
                        "path": "/ROOT/OU_1",
                    },
                }
            ],
        },
    )
    schedule = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )

    payload = svc.get_staged_geo_payload(
        database=database,
        metadata_type="geoJSON",
        requested_instance_ids=[101],
        federated=True,
        levels=["2"],
        parent_ids=["ROOT"],
        allow_live_fallback=True,
    )

    assert payload["status"] == "success"
    assert payload["count"] == 1
    assert payload["result"]["features"][0]["id"] == "OU_1"
    assert payload["instance_results"] == [
        {
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
            "count": 1,
            "load_source": "live_fallback",
        }
    ]
    hydrate.assert_called_once_with(database=database, context=context)
    schedule.assert_not_called()
