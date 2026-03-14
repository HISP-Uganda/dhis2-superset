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
"""Tests for staged metadata cache persistence helpers."""

from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import tests.dhis2._bootstrap  # noqa: F401 - must be first


def test_set_cached_metadata_payload_retries_sqlite_lock(mocker) -> None:
    from superset.staging import metadata_cache_service as svc

    source = SimpleNamespace(id=5)
    entry = SimpleNamespace(metadata_json="{}", refreshed_at=None, expires_at=None)
    query = mocker.MagicMock(name="query")
    filtered_query = mocker.MagicMock(name="filtered_query")
    query.filter.return_value = filtered_query
    filtered_query.one_or_none.return_value = entry

    mocker.patch(
        "superset.staging.metadata_cache_service.ensure_source_for_database",
        return_value=(source, {}),
    )
    mocker.patch.object(svc.db.session, "query", return_value=query)
    commit = mocker.patch.object(
        svc.db.session,
        "commit",
        side_effect=[sqlite3.OperationalError("database is locked"), None],
    )
    rollback = mocker.patch.object(svc.db.session, "rollback")
    sleep = mocker.patch("superset.staging.metadata_cache_service.time.sleep")

    payload = svc.set_cached_metadata_payload(
        9,
        "dhis2_snapshot:geoJSON",
        {"instance_id": 101},
        {"status": "success", "result": {"features": []}},
        ttl_seconds=None,
    )

    assert commit.call_count == 2
    rollback.assert_called_once()
    sleep.assert_called_once()
    assert payload["cached"] is False

