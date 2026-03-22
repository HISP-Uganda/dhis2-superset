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
"""Unit tests for generic staged-source capability helpers."""

from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import superset


def _database(**kw):
    payload = dict(
        id=7,
        database_name="analytics_db",
        backend="postgresql",
    )
    payload.update(kw)
    return SimpleNamespace(**payload)


def _source(**kw):
    payload = dict(
        id=10,
        source_type="sql_database",
        source_connection_id=7,
        source_name="analytics_db",
    )
    payload.update(kw)
    payload["to_json"] = lambda: {
        "id": payload["id"],
        "source_type": payload["source_type"],
        "source_connection_id": payload["source_connection_id"],
        "source_name": payload["source_name"],
    }
    return SimpleNamespace(**payload)


@pytest.fixture(autouse=True)
def _restore_session_methods():
    session = superset.db.session
    method_names = ("query", "get", "add", "delete", "commit", "flush", "rollback")
    originals = {name: getattr(session, name) for name in method_names if hasattr(session, name)}
    yield
    for name, value in originals.items():
        setattr(session, name, value)


class TestSourceService:

    def _svc(self):
        from superset.staging import source_service

        return source_service

    def test_classify_database_source_maps_dhis2(self):
        assert self._svc().classify_database_source(_database(backend="dhis2")) == "dhis2"

    def test_get_database_staging_capabilities_for_sql_database(self):
        superset.db.session.get = MagicMock(return_value=_database())
        result = self._svc().get_database_staging_capabilities(7)
        assert result["source_type"] == "sql_database"
        assert result["builder_mode"] == "sql_table"
        assert result["background_refresh_forced"] is True

    def test_get_database_staging_capabilities_for_dhis2_database(self):
        superset.db.session.get = MagicMock(return_value=_database(backend="dhis2"))
        result = self._svc().get_database_staging_capabilities(7)
        assert result["source_type"] == "dhis2"
        assert result["builder_mode"] == "dhis2_federated"
        assert result["requires_instance_selection"] is False
        assert result["supports_connection_scoping"] is True

    def test_ensure_source_for_sql_database_calls_generic_registry(self):
        database = _database()
        source = _source()
        superset.db.session.get = MagicMock(return_value=database)
        with patch("superset.staging.source_service.ensure_staged_source", return_value=source) as ensure_mock:
            ensured_source, capabilities = self._svc().ensure_source_for_database(7)
        ensure_mock.assert_called_once()
        assert ensured_source is source
        assert capabilities["source_type"] == "sql_database"

    def test_ensure_source_for_dhis2_uses_logical_database_registry(self):
        database = _database(backend="dhis2", database_name="Uganda HMIS")
        logical_database = SimpleNamespace(id=4, staged_source_id=9)
        source = _source(id=9, source_type="dhis2", source_name="Uganda HMIS")
        superset.db.session.get = MagicMock(side_effect=[database, database, source])
        with patch(
            "superset.staging.source_service.ensure_dhis2_logical_database",
            return_value=logical_database,
        ) as ensure_mock:
            ensured_source, capabilities = self._svc().ensure_source_for_database(7)
        ensure_mock.assert_called_once()
        assert ensured_source.id == 9
        assert capabilities["source_type"] == "dhis2"

    def test_get_source_for_database_returns_none_when_no_dhis2_logical_source(self):
        database = _database(backend="dhis2")
        superset.db.session.get = MagicMock(return_value=database)
        query = MagicMock()
        query.filter.return_value.one_or_none.return_value = None
        superset.db.session.query = MagicMock(return_value=query)
        assert self._svc().get_source_for_database(7) is None
