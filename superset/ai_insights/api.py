from __future__ import annotations

from flask import Response, request
from flask_appbuilder.api import expose, protect, safe
from marshmallow import Schema, fields, ValidationError

from superset.ai_insights.config import (
    AI_INSIGHTS_FEATURE_FLAG,
    AI_MODE_CHART,
    AI_MODE_DASHBOARD,
    AI_MODE_SQL,
)
from superset.ai_insights.service import AIInsightError, AIInsightService
from superset.extensions import event_logger
from superset.views.base_api import (
    BaseSupersetApi,
    requires_json,
    statsd_metrics,
    validate_feature_flags,
)


class ConversationMessageSchema(Schema):
    role = fields.String(required=True)
    content = fields.String(required=True)


class AIRequestSchema(Schema):
    provider_id = fields.String(load_default=None, allow_none=True)
    model = fields.String(load_default=None, allow_none=True)
    question = fields.String(load_default="", allow_none=True)
    conversation = fields.List(
        fields.Nested(ConversationMessageSchema),
        load_default=list,
    )
    context = fields.Dict(load_default=dict)
    current_sql = fields.String(load_default=None, allow_none=True)
    schema = fields.String(load_default=None, allow_none=True)
    database_id = fields.Integer(load_default=None, allow_none=True)
    execute = fields.Boolean(load_default=False)


class AIChartRestApi(BaseSupersetApi):
    allow_browser_login = True
    class_permission_name = "Chart"
    resource_name = "ai/chart"
    openapi_spec_tag = "AI"
    request_schema = AIRequestSchema()

    @expose("/capabilities", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def capabilities(self) -> Response:
        service = AIInsightService()
        try:
            return self.response(200, result=service.get_capabilities(AI_MODE_CHART))
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)

    @expose("/<int:chart_id>/insight", methods=("POST",))
    @protect()
    @safe
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.insight",
        log_to_statsd=False,
    )
    def insight(self, chart_id: int) -> Response:
        try:
            payload = self.request_schema.load(request.json or {})
            result = AIInsightService().generate_chart_insight(chart_id, payload)
            return self.response(200, result=result)
        except ValidationError as ex:
            return self.response_400(message=ex.messages)
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)


class AIDashboardRestApi(BaseSupersetApi):
    allow_browser_login = True
    class_permission_name = "Dashboard"
    resource_name = "ai/dashboard"
    openapi_spec_tag = "AI"
    request_schema = AIRequestSchema()

    @expose("/capabilities", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def capabilities(self) -> Response:
        try:
            return self.response(
                200, result=AIInsightService().get_capabilities(AI_MODE_DASHBOARD)
            )
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)

    @expose("/<dashboard_id>/insight", methods=("POST",))
    @protect()
    @safe
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def insight(self, dashboard_id: str) -> Response:
        try:
            payload = self.request_schema.load(request.json or {})
            result = AIInsightService().generate_dashboard_insight(dashboard_id, payload)
            return self.response(200, result=result)
        except ValidationError as ex:
            return self.response_400(message=ex.messages)
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)


class AISqlRestApi(BaseSupersetApi):
    allow_browser_login = True
    class_permission_name = "SQLLab"
    resource_name = "ai/sql"
    openapi_spec_tag = "AI"
    request_schema = AIRequestSchema()

    @expose("/capabilities", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def capabilities(self) -> Response:
        try:
            return self.response(200, result=AIInsightService().get_capabilities(AI_MODE_SQL))
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)

    @expose("/assistant", methods=("POST",))
    @protect()
    @safe
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def assistant(self) -> Response:
        try:
            payload = self.request_schema.load(request.json or {})
            result = AIInsightService().assist_sql(payload)
            return self.response(200, result=result)
        except ValidationError as ex:
            return self.response_400(message=ex.messages)
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)
