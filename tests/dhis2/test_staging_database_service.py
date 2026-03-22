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
"""Unit tests for staged DHIS2 serving database resolution."""

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask


def test_get_staging_database_defaults_to_main_metadata_database():
    from superset.dhis2.staging_database_service import get_staging_database

    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:////tmp/superset.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    query = MagicMock()
    query.filter_by.return_value.first.return_value = SimpleNamespace(
        id=7,
        database_name="main",
        name="main",
    )

    with app.app_context(), patch(
        "superset.dhis2.staging_database_service._get_duckdb_serving_uri",
        return_value=None,
    ), patch(
        "superset.dhis2.staging_database_service.db.session.query",
        return_value=query,
    ), patch(
        "superset.dhis2.staging_database_service.get_or_create_db",
        return_value=SimpleNamespace(id=7, database_name="main", name="main"),
    ) as get_or_create_db_mock:
        result = get_staging_database()

    assert result.id == 7
    get_or_create_db_mock.assert_called_once_with(
        "main",
        "sqlite:////tmp/superset.db",
        always_create=True,
    )


def test_get_staging_database_applies_custom_serving_database_config():
    from superset.dhis2.staging_database_service import get_staging_database

    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:////tmp/superset.db",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        DHIS2_STAGING_DATABASE_URI="duckdb:////tmp/dhis2_staging.duckdb",
        DHIS2_STAGING_DATABASE_NAME="DHIS2 Local Staging",
        DHIS2_STAGING_DATABASE_EXPOSE_IN_SQLLAB=False,
    )
    database = SimpleNamespace(
        id=9,
        database_name="DHIS2 Local Staging",
        name="DHIS2 Local Staging",
        expose_in_sqllab=True,
        allow_ctas=True,
        allow_cvas=True,
        allow_dml=True,
    )
    query = MagicMock()
    query.filter_by.return_value.first.return_value = database

    with app.app_context(), patch(
        "superset.dhis2.staging_database_service.db.session.query",
        return_value=query,
    ), patch(
        "superset.dhis2.staging_database_service.get_or_create_db",
        return_value=database,
    ) as get_or_create_db_mock, patch(
        "superset.dhis2.staging_database_service.db.session.flush",
        MagicMock(),
    ) as flush_mock:
        result = get_staging_database()

    assert result is database
    assert database.expose_in_sqllab is False
    assert database.allow_ctas is False
    assert database.allow_cvas is False
    assert database.allow_dml is False
    get_or_create_db_mock.assert_called_once_with(
        "DHIS2 Local Staging",
        "duckdb:////tmp/dhis2_staging.duckdb",
        always_create=True,
    )
    flush_mock.assert_called_once()
