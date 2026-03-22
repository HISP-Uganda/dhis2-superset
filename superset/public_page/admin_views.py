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
"""Thin frontend shell routes for public pages and authenticated CMS admin."""

from __future__ import annotations

from urllib.parse import quote

from flask import Blueprint, abort, g, redirect, request

from superset import security_manager
from superset.extensions import appbuilder
from superset.superset_typing import FlaskResponse
from superset.views.base import BaseSupersetView


def _render_shell(
    *,
    require_auth: bool = False,
    require_cms_permission: bool = False,
) -> FlaskResponse:
    user = getattr(g, "user", None)
    is_anonymous = user is None or getattr(user, "is_anonymous", True)

    if require_auth and is_anonymous:
        next_target = quote(request.full_path.rstrip("?"))
        return redirect(f"/login/?next={next_target}")

    if require_cms_permission and (
        is_anonymous or not security_manager.can_access("cms.pages.view", "CMS")
    ):
        abort(403)

    view = BaseSupersetView()
    view.appbuilder = appbuilder
    return view.render_app_template()


cms_frontend_blueprint = Blueprint(
    "cms_frontend",
    __name__,
    url_prefix="/superset/cms",
)


@cms_frontend_blueprint.route("/")
@cms_frontend_blueprint.route("/<path:subpath>/")
def cms_frontend(subpath: str | None = None) -> FlaskResponse:
    del subpath
    return _render_shell(require_auth=True, require_cms_permission=True)


public_page_frontend_blueprint = Blueprint(
    "public_page_frontend",
    __name__,
    url_prefix="/superset/public",
)


@public_page_frontend_blueprint.route("/<path:page_slug>/")
@public_page_frontend_blueprint.route("/<path:page_slug>")
@public_page_frontend_blueprint.route("/")
def public_page_slug(page_slug: str | None = None) -> FlaskResponse:
    del page_slug
    return _render_shell()
