from __future__ import annotations

from urllib.parse import quote

from flask import Blueprint, current_app, g, redirect, request
from flask_appbuilder import BaseView, expose, has_access

from superset.constants import MODEL_VIEW_RW_METHOD_PERMISSION_MAP
from superset.superset_typing import FlaskResponse
from superset.views.base import BaseSupersetView


class AIManagementView(BaseView):
    route_base = "/aimanagement"
    default_view = "list"
    class_permission_name = "AIManagement"
    method_permission_name = MODEL_VIEW_RW_METHOD_PERMISSION_MAP

    def _frontend_path(self, path: str) -> str:
        app_root = (current_app.config.get("APPLICATION_ROOT") or "").rstrip("/")
        return f"{app_root}{path}" if app_root else path

    @expose("/list/")
    @has_access
    def list(self) -> object:
        return redirect(self._frontend_path("/superset/ai-management/"))


ai_management_frontend_blueprint = Blueprint(
    "ai_management_frontend",
    __name__,
    url_prefix="/superset/ai-management",
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


@ai_management_frontend_blueprint.route("/")
def ai_management() -> FlaskResponse:
    return _render_authenticated_shell()
