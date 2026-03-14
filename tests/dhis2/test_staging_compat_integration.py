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
"""Compatibility tests for the generic staging metadata hooks."""

from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

import json
from unittest.mock import MagicMock, patch

import superset

from superset.dhis2.models import (
    DHIS2DatasetVariable,
    DHIS2Instance,
    DHIS2StagedDataset,
    DHIS2SyncJob,
)


def _instance(**kw) -> DHIS2Instance:
    instance = DHIS2Instance.__new__(DHIS2Instance)
    instance.__dict__.update(
        dict(
            id=1,
            database_id=7,
            logical_database_id=None,
            name="Uganda HMIS",
            url="https://example.org",
            auth_type="basic",
            username="admin",
            password="district",
            access_token=None,
            is_active=True,
            description=None,
            created_by_fk=None,
            changed_by_fk=None,
            created_on=None,
            changed_on=None,
        )
    )
    instance.__dict__.update(kw)
    return instance


def _dataset(**kw) -> DHIS2StagedDataset:
    dataset = DHIS2StagedDataset.__new__(DHIS2StagedDataset)
    dataset.__dict__.update(
        dict(
            id=2,
            database_id=7,
            logical_database_id=None,
            generic_dataset_id=None,
            name="ANC Coverage",
            description=None,
            staging_table_name="ds_2_anc_coverage",
            schedule_cron="0 2 * * *",
            schedule_timezone="Africa/Kampala",
            is_active=True,
            auto_refresh_enabled=True,
            last_sync_at=None,
            last_sync_status=None,
            last_sync_rows=None,
            dataset_config=json.dumps({"periods": ["LAST_12_MONTHS"]}),
            created_by_fk=None,
            changed_by_fk=None,
            created_on=None,
            changed_on=None,
            generic_dataset=None,
        )
    )
    dataset.__dict__.update(kw)
    dataset.get_dataset_config = lambda: json.loads(dataset.dataset_config or "{}")
    return dataset


def _variable(**kw) -> DHIS2DatasetVariable:
    variable = DHIS2DatasetVariable.__new__(DHIS2DatasetVariable)
    variable.__dict__.update(
        dict(
            id=3,
            staged_dataset_id=2,
            instance_id=1,
            generic_field_id=None,
            variable_id="fbfJHSPpUQD",
            variable_type="dataElement",
            variable_name="ANC 1st visit",
            alias="anc_first_visit",
            extra_params=json.dumps({"aggregation_type": "sum"}),
            created_on=None,
        )
    )
    variable.__dict__.update(kw)
    variable.get_extra_params = lambda: json.loads(variable.extra_params or "{}")
    variable.staged_dataset = _dataset(id=variable.staged_dataset_id)
    return variable


def _job(**kw) -> DHIS2SyncJob:
    job = DHIS2SyncJob.__new__(DHIS2SyncJob)
    job.__dict__.update(
        dict(
            id=5,
            staged_dataset_id=2,
            generic_sync_job_id=None,
            job_type="manual",
            status="pending",
            started_at=None,
            completed_at=None,
            rows_loaded=None,
            rows_failed=None,
            error_message=None,
            instance_results=None,
            created_on=None,
            changed_on=None,
        )
    )
    job.__dict__.update(kw)
    job.staged_dataset = _dataset(id=job.staged_dataset_id)
    job.get_instance_results = lambda: json.loads(job.instance_results or "{}")
    return job


class TestInstanceServiceCompatibility:

    def test_create_instance_calls_generic_sync(self):
        from superset.dhis2 import instance_service

        superset.db.session.add = MagicMock()
        superset.db.session.commit = MagicMock()
        with patch("superset.dhis2.instance_service.sync_dhis2_instance") as sync_mock:
            instance = instance_service.create_instance(
                7,
                {
                    "name": "Uganda HMIS",
                    "url": "https://example.org",
                    "username": "admin",
                    "password": "district",
                },
            )
        sync_mock.assert_called_once_with(instance)


class TestDatasetServiceCompatibility:

    def test_create_staged_dataset_calls_generic_sync(self):
        from superset.dhis2 import staged_dataset_service

        engine = MagicMock()
        engine.get_staging_table_name.return_value = "ds_2_anc_coverage"
        superset.db.session.add = MagicMock()
        superset.db.session.flush = MagicMock()
        superset.db.session.commit = MagicMock()
        with patch("superset.dhis2.staged_dataset_service._get_engine", return_value=engine):
            with patch("superset.dhis2.staged_dataset_service.sync_dhis2_staged_dataset") as sync_mock:
                dataset = staged_dataset_service.create_staged_dataset(
                    7,
                    {
                        "name": "ANC Coverage",
                        "dataset_config": {"periods": ["LAST_12_MONTHS"]},
                    },
                )
        sync_mock.assert_called_once_with(dataset)

    def test_add_variable_calls_generic_sync(self):
        from superset.dhis2 import staged_dataset_service

        superset.db.session.add = MagicMock()
        superset.db.session.flush = MagicMock()
        superset.db.session.commit = MagicMock()
        with patch("superset.dhis2.staged_dataset_service.get_staged_dataset", return_value=_dataset()):
            with patch("superset.dhis2.staged_dataset_service.sync_dhis2_dataset_variable") as sync_mock:
                variable = staged_dataset_service.add_variable(
                    2,
                    {
                        "instance_id": 1,
                        "variable_id": "fbfJHSPpUQD",
                        "variable_type": "dataElement",
                        "alias": "anc_first_visit",
                    },
                )
        sync_mock.assert_called_once_with(variable)


class TestSyncServiceCompatibility:

    def test_create_sync_job_calls_generic_sync(self):
        from superset.dhis2.sync_service import DHIS2SyncService

        superset.db.session.add = MagicMock()
        superset.db.session.flush = MagicMock()
        superset.db.session.commit = MagicMock()
        with patch("superset.dhis2.sync_service.sync_dhis2_sync_job") as sync_mock:
            job = DHIS2SyncService().create_sync_job(2, job_type="manual")
        sync_mock.assert_called_once_with(job, None)

    def test_update_job_status_calls_generic_sync(self):
        from superset.dhis2.sync_service import DHIS2SyncService

        superset.db.session.commit = MagicMock()
        job = _job()
        with patch("superset.dhis2.sync_service.sync_dhis2_sync_job") as sync_mock:
            DHIS2SyncService().update_job_status(
                job,
                status="partial",
                rows_loaded=12,
                rows_failed=1,
                instance_results={"1": {"status": "failed", "rows": 0}},
            )
        sync_mock.assert_called_once()
        payload = sync_mock.call_args.args[1]
        assert payload["status"] == "partial"
        assert payload["rows_loaded"] == 12

    def test_sync_staged_dataset_updates_generic_dataset_status(self):
        from superset.dhis2.sync_service import DHIS2SyncService

        dataset_query = MagicMock()
        dataset_query.filter_by.return_value.first.return_value = _dataset()
        variable_query = MagicMock()
        variable_query.filter_by.return_value.all.return_value = []
        superset.db.session.query = MagicMock(side_effect=[dataset_query, variable_query])
        superset.db.session.commit = MagicMock()
        with patch("superset.dhis2.sync_service.sync_dhis2_staged_dataset") as sync_dataset_mock:
            result = DHIS2SyncService().sync_staged_dataset(2)
        assert result["status"] == "success"
        sync_dataset_mock.assert_called_once()
