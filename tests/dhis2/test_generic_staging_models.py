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
"""Unit tests for the generic staged-source metadata models."""

from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

import json
from datetime import datetime

from superset.staging.models import (
    SchedulePolicy,
    SourceMetadataCache,
    StagedDataset,
    StagedDatasetField,
    StagedSource,
    SyncJob,
)


def _source(**kw) -> StagedSource:
    source = StagedSource.__new__(StagedSource)
    source.__dict__.update(
        dict(
            id=None,
            source_type="dhis2",
            source_connection_id=1,
            source_name="DHIS2 database 1",
            connection_key="db:1",
            config_json=None,
            is_active=True,
            created_at=None,
            updated_at=None,
        )
    )
    source.__dict__.update(kw)
    return source


def _policy(**kw) -> SchedulePolicy:
    policy = SchedulePolicy.__new__(SchedulePolicy)
    policy.__dict__.update(
        dict(
            id=None,
            schedule_type="cron",
            cron_expression="0 2 * * *",
            timezone="UTC",
            refresh_enabled=True,
            refresh_scope="full",
            max_runtime_seconds=None,
            is_managed=True,
            config_json=None,
            created_at=None,
            updated_at=None,
        )
    )
    policy.__dict__.update(kw)
    return policy


def _dataset(**kw) -> StagedDataset:
    dataset = StagedDataset.__new__(StagedDataset)
    dataset.__dict__.update(
        dict(
            id=None,
            source_type="dhis2",
            staged_source_id=1,
            dhis2_logical_database_id=1,
            name="ANC Coverage",
            slug="anc-coverage",
            description=None,
            dataset_mode="dhis2_analytics_stage",
            stage_schema_name="dhis2_staging",
            primary_serving_object_name="ds_1_anc_coverage",
            refresh_enabled=True,
            schedule_policy_id=1,
            created_by_fk=None,
            changed_by_fk=None,
            created_at=None,
            updated_at=None,
            last_successful_sync_at=None,
            last_partial_sync_at=None,
            last_failed_sync_at=None,
            last_sync_status=None,
            config_json=None,
        )
    )
    dataset.__dict__.update(kw)
    return dataset


def _field(**kw) -> StagedDatasetField:
    field = StagedDatasetField.__new__(StagedDatasetField)
    field.__dict__.update(
        dict(
            id=None,
            dataset_id=1,
            field_kind="dhis2_variable",
            source_instance_id=1,
            staged_source_id=1,
            source_object_name="dataElement",
            source_field_name="ANC 1st visit",
            source_field_id="fbfJHSPpUQD",
            source_field_code=None,
            source_field_label="ANC 1st visit",
            dataset_alias="anc_first_visit",
            canonical_metric_key="anc_first_visit",
            comparison_group="instance:1",
            value_type="number",
            aggregation_type="sum",
            is_required=False,
            is_active=True,
            display_order=1,
            config_json=None,
            created_at=None,
            updated_at=None,
        )
    )
    field.__dict__.update(kw)
    return field


def _job(**kw) -> SyncJob:
    job = SyncJob.__new__(SyncJob)
    job.__dict__.update(
        dict(
            id=None,
            dataset_id=1,
            job_type="manual",
            status="pending",
            refresh_scope="full",
            refresh_mode="replace",
            started_at=None,
            completed_at=None,
            rows_inserted=None,
            rows_updated=None,
            rows_skipped=None,
            rows_deleted=None,
            rows_failed=None,
            error_message=None,
            result_json=None,
            created_at=None,
            updated_at=None,
        )
    )
    job.__dict__.update(kw)
    return job


class TestStagedSource:

    def test_get_config_parses_json(self):
        source = _source(config_json=json.dumps({"database_id": 1}))
        assert source.get_config() == {"database_id": 1}

    def test_to_json_includes_connection_key(self):
        source = _source(id=5, source_name="Main DHIS2")
        payload = source.to_json()
        assert payload["id"] == 5
        assert payload["source_name"] == "Main DHIS2"
        assert payload["connection_key"] == "db:1"


class TestSchedulePolicy:

    def test_to_json_includes_refresh_flags(self):
        policy = _policy(id=4, config_json=json.dumps({"auto_enabled": True}))
        payload = policy.to_json()
        assert payload["refresh_enabled"] is True
        assert payload["config"] == {"auto_enabled": True}


class TestStagedDataset:

    def test_sync_slug_generates_slug(self):
        dataset = _dataset(name="ANC Coverage 2024", slug=None)
        dataset.sync_slug()
        assert dataset.slug == "anc-coverage-2024"

    def test_mark_sync_updates_success_timestamp(self):
        now = datetime(2026, 1, 2, 10, 0, 0)
        dataset = _dataset()
        dataset.mark_sync("success", now)
        assert dataset.last_sync_status == "success"
        assert dataset.last_successful_sync_at == now

    def test_mark_sync_updates_partial_timestamp(self):
        now = datetime(2026, 1, 2, 10, 0, 0)
        dataset = _dataset()
        dataset.mark_sync("partial", now)
        assert dataset.last_partial_sync_at == now

    def test_to_json_includes_config(self):
        dataset = _dataset(config_json=json.dumps({"periods": ["LAST_12_MONTHS"]}))
        payload = dataset.to_json()
        assert payload["config"] == {"periods": ["LAST_12_MONTHS"]}
        assert payload["stage_schema_name"] == "dhis2_staging"


class TestStagedDatasetField:

    def test_to_json_exposes_lineage_fields(self):
        field = _field()
        payload = field.to_json()
        assert payload["source_instance_id"] == 1
        assert payload["canonical_metric_key"] == "anc_first_visit"
        assert payload["dataset_alias"] == "anc_first_visit"


class TestSyncJob:

    def test_get_result_parses_json(self):
        job = _job(result_json=json.dumps({"instances": {"1": {"status": "success"}}}))
        assert job.get_result() == {"instances": {"1": {"status": "success"}}}

    def test_to_json_includes_row_counters(self):
        job = _job(id=9, rows_inserted=25, rows_failed=1)
        payload = job.to_json()
        assert payload["rows_inserted"] == 25
        assert payload["rows_failed"] == 1


class TestSourceMetadataCache:

    def test_get_metadata_parses_json(self):
        cache = SourceMetadataCache.__new__(SourceMetadataCache)
        cache.__dict__.update(metadata_json=json.dumps({"items": ["ou", "pe"]}))
        assert cache.get_metadata() == {"items": ["ou", "pe"]}
