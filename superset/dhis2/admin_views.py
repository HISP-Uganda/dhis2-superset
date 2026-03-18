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
"""
DHIS2 Admin Views

Provides Flask-AppBuilder admin UI for DHIS2 multi-instance diagnostics.

The views here are intentionally thin: they redirect to the React frontend
that surfaces the full management UI.  Flask-AppBuilder is used only to
integrate with Superset's ``@has_access`` permission machinery and to
register menu entries that admin users can discover.
"""

from __future__ import annotations

from urllib.parse import quote

from flask import Blueprint, current_app, g, redirect, request
from flask_appbuilder import BaseView, expose, has_access

from superset.superset_typing import FlaskResponse
from superset.views.base import BaseSupersetView


class DHIS2AdminView(BaseView):
    """Admin view for DHIS2 multi-instance federation monitoring.

    Mounted at ``/dhis2admin/`` by Flask-AppBuilder; all routes redirect
    to the React-powered pages served at ``/dhis2/*``.
    """

    route_base = "/dhis2admin"
    default_view = "list"

    def _frontend_path(self, path: str) -> str:
        app_root = (current_app.config.get("APPLICATION_ROOT") or "").rstrip("/")
        return f"{app_root}{path}" if app_root else path

    @expose("/list/")
    @has_access
    def list(self) -> object:
        """Redirect to the React instance management page."""
        return redirect(self._frontend_path("/superset/dhis2/instances/"))

    @expose("/health/")
    @has_access
    def health(self) -> object:
        """Redirect to the React federation health page."""
        return redirect(self._frontend_path("/superset/dhis2/health/"))

    @expose("/sync-history/")
    @has_access
    def sync_history(self) -> object:
        """Redirect to the React sync history page."""
        return redirect(self._frontend_path("/superset/dhis2/sync-history/"))

    @expose("/local-metadata/")
    @has_access
    def local_metadata(self) -> object:
        """Redirect to the React local metadata page."""
        return redirect(self._frontend_path("/superset/dhis2/local-metadata/"))

    @expose("/local-data/")
    @has_access
    def local_data(self) -> object:
        """Redirect to the React local staged data page."""
        return redirect(self._frontend_path("/superset/dhis2/local-data/"))

    @expose("/downloads/")
    @has_access
    def downloads(self) -> object:
        """Redirect to the React download datasets page."""
        return redirect(self._frontend_path("/superset/dhis2/downloads/"))

dhis2_frontend_blueprint = Blueprint(
    "dhis2_frontend",
    __name__,
    url_prefix="/superset/dhis2",
)


def _render_authenticated_shell() -> FlaskResponse:
    user = getattr(g, "user", None)
    if user is None or getattr(user, "is_anonymous", True):
        next_target = quote(request.full_path.rstrip("?"))
        return redirect(f"/login/?next={next_target}")
    from superset.extensions import appbuilder

    view = BaseSupersetView()
    view.appbuilder = appbuilder
    return view.render_app_template()


@dhis2_frontend_blueprint.route("/instances/")
def dhis2_instances() -> FlaskResponse:
    return _render_authenticated_shell()


@dhis2_frontend_blueprint.route("/health/")
def dhis2_health() -> FlaskResponse:
    return _render_authenticated_shell()


@dhis2_frontend_blueprint.route("/sync-history/")
def dhis2_sync_history() -> FlaskResponse:
    return _render_authenticated_shell()


@dhis2_frontend_blueprint.route("/local-metadata/")
def dhis2_local_metadata() -> FlaskResponse:
    return _render_authenticated_shell()


@dhis2_frontend_blueprint.route("/local-data/")
def dhis2_local_data() -> FlaskResponse:
    return _render_authenticated_shell()


@dhis2_frontend_blueprint.route("/downloads/")
def dhis2_downloads() -> FlaskResponse:
    return _render_authenticated_shell()


local_staging_blueprint = Blueprint(
    "local_staging_frontend",
    __name__,
    url_prefix="/superset/local-staging",
)


@local_staging_blueprint.route("/")
def local_staging_settings() -> FlaskResponse:
    return _render_authenticated_shell()
