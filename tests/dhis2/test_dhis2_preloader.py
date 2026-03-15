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
"""Tests for DHIS2 background preloader wiring."""

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from flask import Flask, current_app

from superset.utils import dhis2_preloader


def test_preload_all_data_uses_configured_app_context():
    app = Flask("dhis2-preloader-test")
    preloader = dhis2_preloader.DHIS2Preloader(app=app)
    seen: dict[str, str] = {}

    def fake_get_dhis2_databases():
        seen["app_name"] = current_app.name
        return []

    preloader._get_dhis2_databases = fake_get_dhis2_databases  # type: ignore[method-assign]

    preloader._preload_all_data()

    assert seen["app_name"] == app.name


def test_get_dhis2_preloader_updates_singleton_configuration(monkeypatch):
    monkeypatch.setattr(dhis2_preloader, "_global_preloader", None)

    app_one = Flask("dhis2-preloader-one")
    app_two = Flask("dhis2-preloader-two")

    preloader = dhis2_preloader.get_dhis2_preloader(
        refresh_interval=10,
        app=app_one,
    )
    same_preloader = dhis2_preloader.get_dhis2_preloader(
        refresh_interval=20,
        app=app_two,
    )

    assert same_preloader is preloader
    assert same_preloader._app is app_two
    assert same_preloader._refresh_interval == 20


def test_requested_refreshes_use_metadata_staging_service(mocker):
    app = Flask("dhis2-preloader-requests")
    preloader = dhis2_preloader.DHIS2Preloader(app=app)
    refresh = mocker.patch(
        "superset.dhis2.metadata_staging_service.refresh_database_metadata"
    )

    preloader.request_refresh(
        database_id=9,
        instance_ids=[101, 102],
        metadata_types=["dataElements"],
        reason="database_created",
    )
    preloader._process_requested_refreshes()

    refresh.assert_called_once()
    assert refresh.call_args.args == (9,)
    assert refresh.call_args.kwargs["instance_ids"] == [101, 102]
    assert refresh.call_args.kwargs["reason"] == "database_created"
    assert "dataElements" in refresh.call_args.kwargs["metadata_types"]
    assert "organisationUnitLevels" in refresh.call_args.kwargs["metadata_types"]
    assert "organisationUnits" in refresh.call_args.kwargs["metadata_types"]
    assert "legendSets" in refresh.call_args.kwargs["metadata_types"]
    assert "geoJSON" in refresh.call_args.kwargs["metadata_types"]
    assert "orgUnitHierarchy" in refresh.call_args.kwargs["metadata_types"]
