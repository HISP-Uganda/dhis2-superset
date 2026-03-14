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
"""Tests for DHIS2 admin view helpers."""

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from flask import Flask

from superset.dhis2.admin_views import DHIS2AdminView


def test_frontend_path_respects_application_root():
    app = Flask(__name__)
    app.config["APPLICATION_ROOT"] = "/tenant"

    with app.app_context():
        assert (
            DHIS2AdminView()._frontend_path("/superset/dhis2/instances/")
            == "/tenant/superset/dhis2/instances/"
        )


def test_frontend_path_defaults_to_root_relative_path():
    app = Flask(__name__)
    app.config["APPLICATION_ROOT"] = "/"

    with app.app_context():
        assert (
            DHIS2AdminView()._frontend_path("/superset/dhis2/health/")
            == "/superset/dhis2/health/"
        )


def test_frontend_path_supports_local_staging_pages():
    app = Flask(__name__)
    app.config["APPLICATION_ROOT"] = "/tenant"

    with app.app_context():
        assert (
            DHIS2AdminView()._frontend_path("/superset/dhis2/local-data/")
            == "/tenant/superset/dhis2/local-data/"
        )
