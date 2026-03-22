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
"""Unit tests for DHIS2 multi-instance data models.

These tests exercise pure-Python helper methods on ORM model classes.
No database connection is required; we build transient (unsaved) instances
by directly populating __dict__ to bypass column descriptors.
"""

from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

import base64
import json
from datetime import datetime

import pytest

from superset.dhis2.models import (
    DHIS2DatasetVariable,
    DHIS2Instance,
    DHIS2StagedDataset,
    DHIS2SyncJob,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _inst(**kw) -> DHIS2Instance:
    i = DHIS2Instance.__new__(DHIS2Instance)
    i.__dict__.update(dict(
        id=None, database_id=None, name=None, url=None,
        logical_database_id=None,
        auth_type="basic", username=None, password=None,
        access_token=None, is_active=True, description=None,
        display_order=0,
        last_test_status=None, last_test_message=None,
        last_test_response_time_ms=None, last_tested_on=None,
        created_by_fk=None, changed_by_fk=None,
        created_on=None, changed_on=None,
    ))
    i.__dict__.update(kw)
    return i


def _ds(**kw) -> DHIS2StagedDataset:
    d = DHIS2StagedDataset.__new__(DHIS2StagedDataset)
    d.__dict__.update(dict(
        id=None, database_id=None, name=None, description=None,
        logical_database_id=None, generic_dataset_id=None,
        staging_table_name=None, schedule_cron=None, schedule_timezone="UTC",
        is_active=True, auto_refresh_enabled=True,
        last_sync_at=None, last_sync_status=None, last_sync_rows=None,
        serving_superset_dataset_id=None,
        dataset_config=None, created_by_fk=None, changed_by_fk=None,
        created_on=None, changed_on=None,
    ))
    d.__dict__.update(kw)
    return d


def _job(**kw) -> DHIS2SyncJob:
    j = DHIS2SyncJob.__new__(DHIS2SyncJob)
    j.__dict__.update(dict(
        id=None, staged_dataset_id=None, job_type="manual", status="pending",
        generic_sync_job_id=None, task_id=None, cancel_requested=False,
        started_at=None, completed_at=None, rows_loaded=None, rows_failed=None,
        total_units=None, completed_units=None, failed_units=None,
        percent_complete=None, current_step=None, current_item=None,
        rows_extracted=None, rows_staged=None, rows_merged=None,
        error_summary=None,
        error_message=None, instance_results=None, created_on=None, changed_on=None,
    ))
    j.__dict__.update(kw)
    return j


def _var(**kw) -> DHIS2DatasetVariable:
    v = DHIS2DatasetVariable.__new__(DHIS2DatasetVariable)
    v.__dict__.update(
        dict(
            id=None,
            staged_dataset_id=None,
            instance_id=None,
            generic_field_id=None,
            variable_id=None,
            variable_type=None,
            variable_name=None,
            alias=None,
            extra_params=None,
            dimension_availability_json=None,
            created_on=None,
        )
    )
    v.__dict__.update(kw)
    return v


# ---------------------------------------------------------------------------
# DHIS2Instance
# ---------------------------------------------------------------------------

class TestDHIS2Instance:

    def test_get_auth_headers_basic(self):
        i = _inst(auth_type="basic", username="admin", password="district")
        h = i.get_auth_headers()
        assert h["Authorization"].startswith("Basic ")
        decoded = base64.b64decode(h["Authorization"].split(" ", 1)[1]).decode()
        assert decoded == "admin:district"

    def test_get_auth_headers_pat(self):
        i = _inst(auth_type="pat", access_token="tok123")
        assert i.get_auth_headers() == {"Authorization": "ApiToken tok123"}

    def test_get_auth_headers_empty_when_no_credentials(self):
        i = _inst(auth_type="basic")
        assert i.get_auth_headers() == {}

    def test_get_auth_headers_pat_without_token(self):
        i = _inst(auth_type="pat", access_token=None)
        assert i.get_auth_headers() == {}

    def test_is_single_instance_compat_true(self):
        assert _inst(name="default").is_single_instance_compat is True

    def test_is_single_instance_compat_false(self):
        assert _inst(name="Uganda HMIS").is_single_instance_compat is False

    def test_is_single_instance_compat_case_sensitive(self):
        assert _inst(name="Default").is_single_instance_compat is False

    def test_to_json_redacts_password(self):
        i = _inst(id=1, database_id=2, name="t", url="u", password="secret")
        result = i.to_json()
        assert result["password"] != "secret"

    def test_to_json_redacts_access_token(self):
        i = _inst(id=1, database_id=2, name="t", url="u", access_token="tok")
        result = i.to_json()
        assert result["access_token"] != "tok"

    def test_to_json_exposes_username(self):
        i = _inst(id=1, database_id=2, name="t", url="u", username="admin", password="x")
        assert i.to_json()["username"] == "admin"

    def test_to_json_none_credentials_stay_none(self):
        i = _inst(id=1, database_id=2, name="t", url="u")
        r = i.to_json()
        assert r["password"] is None
        assert r["access_token"] is None

    def test_to_json_includes_display_order_and_last_test_result(self):
        tested_on = datetime(2024, 6, 1, 12, 15, 0)
        i = _inst(
            id=1,
            database_id=2,
            name="t",
            url="u",
            display_order=7,
            last_test_status="success",
            last_test_message="Connected successfully (HTTP 200)",
            last_test_response_time_ms=87.4,
            last_tested_on=tested_on,
        )
        result = i.to_json()
        assert result["display_order"] == 7
        assert result["last_test_result"] == {
            "status": "success",
            "message": "Connected successfully (HTTP 200)",
            "response_time_ms": 87.4,
            "tested_on": tested_on.isoformat(),
        }

    def test_repr(self):
        i = _inst(id=5, name="MyInst", url="http://x.org")
        r = repr(i)
        assert "DHIS2Instance" in r
        assert "MyInst" in r


# ---------------------------------------------------------------------------
# DHIS2StagedDataset
# ---------------------------------------------------------------------------

class TestDHIS2StagedDataset:

    def test_auto_refresh_enabled_default(self):
        assert _ds().auto_refresh_enabled is True

    def test_get_dataset_config_empty_when_none(self):
        assert _ds(dataset_config=None).get_dataset_config() == {}

    def test_get_dataset_config_parses_valid_json(self):
        cfg = {"periods": ["2024Q1"], "org_units": ["abc"]}
        assert _ds(dataset_config=json.dumps(cfg)).get_dataset_config() == cfg

    def test_get_dataset_config_reads_descriptor_backed_value(self, monkeypatch):
        cfg = {"periods": ["2024Q1"], "org_units": ["abc"]}
        dataset = _ds()
        dataset.__dict__.pop("dataset_config", None)
        monkeypatch.setattr(
            DHIS2StagedDataset,
            "dataset_config",
            property(lambda self: json.dumps(cfg)),
        )
        assert dataset.get_dataset_config() == cfg

    def test_get_dataset_config_returns_empty_for_invalid_json(self):
        assert _ds(dataset_config="not-valid{{{").get_dataset_config() == {}

    def test_get_dataset_config_returns_empty_for_empty_string(self):
        assert _ds(dataset_config="").get_dataset_config() == {}

    def test_to_json_dataset_config_parsed(self):
        cfg = {"periods": ["2024Q1"]}
        d = _ds(id=1, database_id=2, name="ds1", dataset_config=json.dumps(cfg))
        assert d.to_json()["dataset_config"] == cfg

    def test_to_json_includes_sync_fields(self):
        now = datetime(2024, 6, 1, 12, 0, 0)
        d = _ds(id=1, database_id=2, name="ds1",
                last_sync_at=now, last_sync_status="success", last_sync_rows=500)
        r = d.to_json()
        assert r["last_sync_status"] == "success"
        assert r["last_sync_rows"] == 500
        assert "2024-06-01" in r["last_sync_at"]

    def test_repr(self):
        d = _ds(id=3, name="MyDataset", database_id=7)
        assert "DHIS2StagedDataset" in repr(d)


class TestDHIS2DatasetVariable:

    def test_get_dimension_availability_empty_when_none(self):
        assert _var(dimension_availability_json=None).get_dimension_availability() == []

    def test_get_dimension_availability_parses_valid_json(self):
        dims = [{"dimension_key": "age_group", "dimension_scope": "groupby"}]
        assert _var(
            dimension_availability_json=json.dumps(dims)
        ).get_dimension_availability() == dims

    def test_get_dimension_availability_returns_empty_for_invalid_json(self):
        assert _var(dimension_availability_json="not-json").get_dimension_availability() == []

    def test_to_json_includes_dimension_availability(self):
        dims = [{"dimension_key": "sex", "dimension_scope": "filter_only"}]
        payload = _var(id=7, dimension_availability_json=json.dumps(dims)).to_json()
        assert payload["dimension_availability"] == dims


# ---------------------------------------------------------------------------
# DHIS2SyncJob
# ---------------------------------------------------------------------------

class TestDHIS2SyncJob:

    def test_duration_seconds_calculated(self):
        j = _job(started_at=datetime(2024, 1, 1, 10, 0, 0),
                 completed_at=datetime(2024, 1, 1, 10, 5, 30))
        assert j.duration_seconds == 330.0

    def test_duration_seconds_none_when_not_completed(self):
        j = _job(started_at=datetime(2024, 1, 1), completed_at=None)
        assert j.duration_seconds is None

    def test_duration_seconds_none_when_not_started(self):
        j = _job(started_at=None, completed_at=datetime(2024, 1, 1))
        assert j.duration_seconds is None

    def test_duration_seconds_zero(self):
        t = datetime(2024, 1, 1, 10, 0, 0)
        assert _job(started_at=t, completed_at=t).duration_seconds == 0.0

    def test_get_instance_results_empty_when_none(self):
        assert _job(instance_results=None).get_instance_results() == {}

    def test_get_instance_results_parses_json(self):
        data = {"1": {"status": "success", "rows": 100}}
        assert _job(instance_results=json.dumps(data)).get_instance_results() == data

    def test_get_instance_results_returns_empty_for_invalid_json(self):
        assert _job(instance_results="bad{json").get_instance_results() == {}

    def test_to_json_includes_duration(self):
        j = _job(id=1, staged_dataset_id=2,
                 started_at=datetime(2024, 1, 1, 10, 0, 0),
                 completed_at=datetime(2024, 1, 1, 10, 1, 0))
        assert j.to_json()["duration_seconds"] == 60.0

    def test_to_json_duration_none_when_incomplete(self):
        j = _job(id=1, staged_dataset_id=2,
                 started_at=datetime(2024, 1, 1), completed_at=None)
        assert j.to_json()["duration_seconds"] is None

    def test_repr(self):
        j = _job(id=9, status="running", staged_dataset_id=3)
        assert "DHIS2SyncJob" in repr(j)
        assert "running" in repr(j)
