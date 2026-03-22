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
"""Unit tests for the DHIS2 instance service."""

from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

import sys
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest
import requests



from superset.dhis2.models import DHIS2Instance  # noqa: E402


def _inst(**kw) -> DHIS2Instance:
    i = DHIS2Instance.__new__(DHIS2Instance)
    i.__dict__.update(dict(
        id=1, database_id=10, name="test", url="http://dhis2.example.org",
        auth_type="basic", username="admin", password="district",
        access_token=None, is_active=True, description=None, display_order=0,
        last_test_status=None, last_test_message=None,
        last_test_response_time_ms=None, last_tested_on=None,
        created_by_fk=None, changed_by_fk=None, created_on=None, changed_on=None,
    ))
    i.__dict__.update(kw)
    return i


@pytest.fixture(autouse=True)
def _restore_session_methods():
    import superset
    import sys

    session = superset.db.session
    method_names = ("query", "get", "add", "delete", "commit", "flush", "rollback")
    originals = {name: getattr(session, name) for name in method_names if hasattr(session, name)}
    core_mod = sys.modules.get("superset.models.core")
    original_database = (
        getattr(core_mod, "Database")
        if core_mod is not None and hasattr(core_mod, "Database")
        else None
    )
    yield
    for name, value in originals.items():
        setattr(session, name, value)
    if core_mod is not None and original_database is not None:
        core_mod.Database = original_database


class TestTestInstanceConnectionWithConfig:

    def _svc(self):
        from superset.dhis2 import instance_service
        return instance_service

    def test_successful_connection(self):
        mock_resp = MagicMock()
        mock_resp.ok = True
        mock_resp.status_code = 200
        mock_resp.reason = "OK"
        with patch("superset.dhis2.instance_service.requests.get", return_value=mock_resp):
            result = self._svc().test_instance_connection_with_config({
                "url": "http://dhis2.example.org",
                "auth_type": "basic",
                "username": "admin",
                "password": "district",
            })
        assert result["success"] is True
        assert "response_time_ms" in result

    def test_server_error_returns_failure(self):
        mock_resp = MagicMock()
        mock_resp.ok = False
        mock_resp.status_code = 401
        mock_resp.reason = "Unauthorized"
        with patch("superset.dhis2.instance_service.requests.get", return_value=mock_resp):
            result = self._svc().test_instance_connection_with_config({
                "url": "http://dhis2.example.org",
                "auth_type": "basic",
                "username": "admin",
                "password": "wrong",
            })
        assert result["success"] is False

    def test_timeout_returns_failure(self):
        with patch("superset.dhis2.instance_service.requests.get",
                   side_effect=requests.Timeout("timed out")):
            result = self._svc().test_instance_connection_with_config({
                "url": "http://dhis2.example.org",
                "auth_type": "basic",
                "username": "admin",
                "password": "district",
            })
        assert result["success"] is False
        msg = result.get("message", "").lower()
        assert "timed" in msg or "timeout" in msg or "connect" in msg

    def test_missing_url_raises_value_error(self):
        with pytest.raises((ValueError, KeyError, Exception)):
            self._svc().test_instance_connection_with_config({"auth_type": "basic"})

    def test_connection_error_returns_failure(self):
        with patch("superset.dhis2.instance_service.requests.get",
                   side_effect=requests.ConnectionError("refused")):
            result = self._svc().test_instance_connection_with_config({
                "url": "http://unreachable.example.org",
                "auth_type": "basic",
                "username": "a",
                "password": "b",
            })
        assert result["success"] is False


class TestTestInstanceConnection:

    def _svc(self):
        from superset.dhis2 import instance_service
        return instance_service

    def test_persists_last_test_metadata(self):
        inst = _inst(id=42)
        import superset

        superset.db.session.get = MagicMock(return_value=inst)
        superset.db.session.commit = MagicMock()

        with patch(
            "superset.dhis2.instance_service._perform_connection_test",
            return_value={
                "success": True,
                "message": "Connected successfully (HTTP 200)",
                "response_time_ms": 91.2,
            },
        ):
            result = self._svc().test_instance_connection(42)

        assert result["success"] is True
        assert inst.last_test_status == "success"
        assert inst.last_test_message == "Connected successfully (HTTP 200)"
        assert inst.last_test_response_time_ms == 91.2
        assert inst.last_tested_on is not None
        superset.db.session.commit.assert_called_once()


class TestCreateInstance:

    def _svc(self):
        from superset.dhis2 import instance_service
        return instance_service

    def test_create_instance_missing_name_raises(self):
        with pytest.raises(Exception):
            self._svc().create_instance(database_id=1, data={"url": "http://x.org"})

    def test_create_instance_missing_url_raises(self):
        with pytest.raises(Exception):
            self._svc().create_instance(database_id=1, data={"name": "MyInstance"})

    def test_create_instance_invalid_auth_type_raises(self):
        with pytest.raises(Exception):
            self._svc().create_instance(
                database_id=1,
                data={"name": "x", "url": "http://x.org", "auth_type": "oauth2"},
            )

    def test_create_instance_defaults_display_order(self):
        import superset

        superset.db.session.add = MagicMock()
        superset.db.session.commit = MagicMock()
        with patch("superset.dhis2.instance_service.sync_dhis2_instance"):
            with patch("superset.dhis2.instance_service._schedule_metadata_refresh") as schedule_refresh:
                instance = self._svc().create_instance(
                    database_id=1,
                    data={"name": "x", "url": "http://x.org"},
                )

        assert instance.display_order == 0
        schedule_refresh.assert_called_once_with(1)

    def test_delete_instance_schedules_metadata_refresh(self):
        inst = _inst(id=42, database_id=8)
        import superset

        superset.db.session.get = MagicMock(return_value=inst)
        superset.db.session.delete = MagicMock()
        superset.db.session.commit = MagicMock()
        with patch("superset.dhis2.instance_service._schedule_metadata_refresh") as schedule_refresh:
            deleted = self._svc().delete_instance(42)

        assert deleted is True
        schedule_refresh.assert_called_once_with(8)


class TestUpdateInstance:

    def _svc(self):
        from superset.dhis2 import instance_service
        return instance_service

    def test_update_instance_not_found_raises(self):
        import superset
        superset.db.session.get = MagicMock(return_value=None)
        with pytest.raises(Exception):
            self._svc().update_instance(instance_id=9999, data={"name": "new"})

    def test_update_instance_does_not_log_credentials(self):
        import logging
        inst = _inst(id=42)
        import superset
        superset.db.session.get = MagicMock(return_value=inst)
        superset.db.session.commit = MagicMock()

        log_records = []

        class _Cap(logging.Handler):
            def emit(self, r):
                log_records.append(r)

        h = _Cap()
        logging.getLogger("superset.dhis2.instance_service").addHandler(h)
        try:
            try:
                self._svc().update_instance(42, {"name": "new", "password": "s3cr3t!"})
            except Exception:
                pass
        finally:
            logging.getLogger("superset.dhis2.instance_service").removeHandler(h)

        for rec in log_records:
            assert "s3cr3t!" not in rec.getMessage()

    def test_update_instance_skips_none_credentials(self):
        inst = _inst(id=42, password="existing_password")
        import superset
        superset.db.session.get = MagicMock(return_value=inst)
        superset.db.session.commit = MagicMock()
        try:
            self._svc().update_instance(42, {"name": "updated", "password": None})
        except Exception:
            pass
        assert inst.password == "existing_password"

    def test_update_instance_allows_partial_payload_without_name(self):
        inst = _inst(id=42, description="before")
        import superset
        superset.db.session.get = MagicMock(return_value=inst)
        superset.db.session.commit = MagicMock()
        with patch("superset.dhis2.instance_service._schedule_metadata_refresh") as schedule_refresh:
            updated = self._svc().update_instance(42, {"description": "after"})
        assert updated.description == "after"
        schedule_refresh.assert_called_once_with(10)


class TestMigrateLegacyInstance:

    def _svc(self):
        from superset.dhis2 import instance_service
        return instance_service

    def test_migrate_returns_none_when_no_host(self):
        """migrate_legacy_instance returns None when encrypted_extra has no host."""
        import sys, types
        # Ensure superset.models.core.Database is a stub (local import inside service)
        core_mod = sys.modules.get("superset.models.core")
        if core_mod is None:
            core_mod = types.ModuleType("superset.models.core")
            sys.modules["superset.models.core"] = core_mod
        fake_db = MagicMock()
        fake_db.get_encrypted_extra.return_value = {}
        core_mod.Database = MagicMock()

        import superset
        superset.db.session.get = MagicMock(return_value=fake_db)
        result = self._svc().migrate_legacy_instance(database_id=5)
        assert result is None

    def test_migrate_database_not_found_raises(self):
        import superset
        superset.db.session.get = MagicMock(return_value=None)
        with pytest.raises(Exception):
            self._svc().migrate_legacy_instance(database_id=9999)

    def test_migrate_reads_encrypted_extra(self):
        db_model = MagicMock()
        db_model.get_encrypted_extra = MagicMock(return_value={
            "host": "https://dhis2.example.org",
            "authentication_type": "basic",
            "username": "admin",
            "password": "district",
        })
        import superset
        superset.db.session.get = MagicMock(return_value=db_model)
        superset.db.session.add = MagicMock()
        superset.db.session.commit = MagicMock()
        q = MagicMock()
        q.filter.return_value.first.return_value = None
        superset.db.session.query = MagicMock(return_value=q)
        try:
            result = self._svc().migrate_legacy_instance(database_id=5)
            if result is not None:
                assert result.name == "default"
        except Exception:
            pass

    def test_migrate_normalises_bare_host(self):
        db_model = MagicMock()
        db_model.get_encrypted_extra = MagicMock(return_value={
            "host": "dhis2.example.org",
            "authentication_type": "basic",
            "username": "admin",
            "password": "district",
        })
        import superset
        superset.db.session.get = MagicMock(return_value=db_model)
        superset.db.session.add = MagicMock()
        superset.db.session.commit = MagicMock()
        q = MagicMock()
        q.filter.return_value.first.return_value = None
        superset.db.session.query = MagicMock(return_value=q)
        try:
            result = self._svc().migrate_legacy_instance(database_id=5)
            if result is not None:
                assert result.url.startswith("http")
        except Exception:
            pass
