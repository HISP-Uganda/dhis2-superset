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
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, call

import pytest
import tests.dhis2._bootstrap  # noqa: F401 - must be first


@pytest.fixture(autouse=True)
def _restore_session_methods():
    import superset

    session = superset.db.session
    method_names = ("query", "get", "add", "delete", "commit", "flush", "rollback")
    originals = {name: getattr(session, name) for name in method_names if hasattr(session, name)}
    yield
    for name, value in originals.items():
        setattr(session, name, value)


def test_delete_staged_dataset_cascades_to_sqla_table():
    import superset
    from superset.dhis2 import staged_dataset_service as svc

    # Setup mocks
    session = superset.db.session
    session.query = MagicMock()
    session.delete = MagicMock()
    session.commit = MagicMock()

    generic_dataset = MagicMock()
    staged_dataset = MagicMock()
    staged_dataset.id = 11
    staged_dataset.database_id = 10
    staged_dataset.serving_superset_dataset_id = 22
    staged_dataset.generic_dataset = generic_dataset
    
    sqla_table = MagicMock()
    sqla_table.id = 22

    with patch(
        "superset.dhis2.staged_dataset_service.get_staged_dataset",
        return_value=staged_dataset,
    ), patch(
        "superset.dhis2.staged_dataset_service._get_engine",
    ) as mock_get_engine:
        mock_engine = MagicMock()
        mock_get_engine.return_value = mock_engine
        
        # session.query(SqlaTable).get(22)
        session.query.return_value.get.return_value = sqla_table

        svc.delete_staged_dataset(11)

    # Verify physical tables dropped
    mock_engine.drop_staging_table.assert_called_once_with(staged_dataset)
    
    # Verify models deleted
    session.delete.assert_has_calls([
        call(sqla_table),
        call(staged_dataset),
        call(generic_dataset)
    ], any_order=True)
    session.commit.assert_called_once()


def test_after_sqla_table_delete_listener():
    from superset.dhis2.listeners import _after_sqla_table_delete
    from superset.dhis2.models import DHIS2StagedDataset
    import superset

    session = superset.db.session
    session.query = MagicMock()
    session.delete = MagicMock()

    sqla_table = SimpleNamespace(
        id=22,
        table_name="sv_test",
        extra=json.dumps({
            "dhis2_staged_local": True,
            "dhis2_staged_dataset_id": 11
        })
    )
    
    staged_dataset = DHIS2StagedDataset(id=11, name="Test Staged")
    session.query.return_value.get.return_value = staged_dataset

    # Trigger listener
    _after_sqla_table_delete(None, None, sqla_table)

    # Verify it attempted to delete the staged dataset
    session.query.return_value.get.assert_called_with(11)
    session.delete.assert_called_once_with(staged_dataset)


def test_before_dhis2_staged_dataset_delete_listener():
    from superset.dhis2.listeners import _before_dhis2_staged_dataset_delete
    from superset.dhis2.models import DHIS2StagedDataset

    staged_dataset = DHIS2StagedDataset(id=11, name="Test Staged", database_id=10)

    with patch(
        "superset.dhis2.listeners._get_engine",
    ) as mock_get_engine:
        mock_engine = MagicMock()
        mock_get_engine.return_value = mock_engine

        # Trigger listener
        _before_dhis2_staged_dataset_delete(None, None, staged_dataset)

        # Verify physical tables dropped
        mock_engine.drop_staging_table.assert_called_once_with(staged_dataset)
