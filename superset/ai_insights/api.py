from __future__ import annotations

import json

from flask import Response, request, stream_with_context
from flask_appbuilder.api import expose, protect, safe
from marshmallow import Schema, fields, ValidationError

from superset import db
from superset.ai_insights.config import (
    AI_INSIGHTS_FEATURE_FLAG,
    AI_MODE_CHART,
    AI_MODE_DASHBOARD,
    AI_MODE_PUBLIC_DASHBOARD,
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


def _sse_response(stream_gen) -> Response:
    """Wrap a StreamChunk generator as a text/event-stream Flask Response."""

    @stream_with_context
    def _generate():
        try:
            for chunk in stream_gen:
                payload = json.dumps({"text": chunk.text, "done": chunk.done})
                yield f"data: {payload}\n\n"
        except AIInsightError as ex:
            yield f"data: {json.dumps({'error': ex.message, 'done': True})}\n\n"
        except Exception as ex:  # pylint: disable=broad-except
            yield f"data: {json.dumps({'error': str(ex), 'done': True})}\n\n"

    return Response(
        _generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
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
    conversation_id = fields.Integer(load_default=None, allow_none=True)
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

    @expose("/<int:chart_id>/insight/stream", methods=("POST",))
    @protect()
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def insight_stream(self, chart_id: int) -> Response:
        try:
            payload = self.request_schema.load(request.json or {})
            stream = AIInsightService().stream_chart_insight(chart_id, payload)
            return _sse_response(stream)
        except ValidationError as ex:
            return self.response_400(message=ex.messages)
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)


class AIChartGenerateSchema(Schema):
    provider_id = fields.String(load_default=None, allow_none=True)
    model = fields.String(load_default=None, allow_none=True)
    dataset_id = fields.Integer(load_default=None, allow_none=True)
    prompt = fields.String(load_default=None, allow_none=True)
    num_charts = fields.Integer(load_default=6)
    save = fields.Boolean(load_default=False)


class AltVizTypeSchema(Schema):
    viz_type = fields.String(required=True)
    label = fields.String(load_default="")
    reason = fields.String(load_default="")


class ConfirmChartSchema(Schema):
    slice_name = fields.String(required=True)
    viz_type = fields.String(required=True)
    description = fields.String(load_default="")
    datasource_id = fields.Integer(required=True)
    datasource_type = fields.String(load_default="table")
    params = fields.Dict(required=True)


class SaveConfirmedChartsSchema(Schema):
    charts = fields.List(fields.Nested(ConfirmChartSchema), required=True)


class AIChartGenerateRestApi(BaseSupersetApi):
    allow_browser_login = True
    class_permission_name = "Chart"
    resource_name = "ai/chart-generate"
    openapi_spec_tag = "AI"
    generate_schema = AIChartGenerateSchema()

    @expose("/", methods=("POST",))
    @protect()
    @safe
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def generate(self) -> Response:
        """Generate and optionally save chart configurations using AI.

        Accepts either:
        - ``dataset_id`` to target a specific MART dataset
        - ``prompt`` (free text) to let AI pick the right dataset(s)
        - both, to combine dataset selection with custom instructions
        """
        try:
            payload = self.generate_schema.load(request.json or {})
        except ValidationError as ex:
            return self.response_400(message=ex.messages)

        try:
            service = AIInsightService()
            charts = service.generate_chart_configs(payload)

            if payload.get("save", True):
                saved = service.save_generated_charts(charts)
                return self.response(200, result={"charts": saved, "generated": len(charts)})

            return self.response(200, result={"charts": charts, "generated": len(charts)})
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)
        except Exception as ex:  # pylint: disable=broad-except
            return self.response_500(message=str(ex))

    @expose("/save", methods=("POST",))
    @protect()
    @safe
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def save_confirmed(self) -> Response:
        """Save user-confirmed chart configurations.

        Accepts an array of chart configs (potentially with user-modified
        viz_types from the review step) and persists them.
        """
        try:
            payload = SaveConfirmedChartsSchema().load(request.json or {})
        except ValidationError as ex:
            return self.response_400(message=ex.messages)

        try:
            service = AIInsightService()
            charts = payload["charts"]
            # Normalize: ensure params has correct viz_type and datasource
            for chart in charts:
                params = chart.get("params") or {}
                params["viz_type"] = chart["viz_type"]
                params["datasource"] = f"{chart['datasource_id']}__table"
                chart["params"] = params

            saved = service.save_generated_charts(charts)
            return self.response(
                200, result={"charts": saved, "generated": len(charts)}
            )
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)
        except Exception as ex:  # pylint: disable=broad-except
            return self.response_500(message=str(ex))

    @expose("/mart-datasets", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def list_mart_datasets(self) -> Response:
        """List all MART datasets available for chart generation."""
        from superset.ai_insights.sql import is_mart_table
        from superset.connectors.sqla.models import SqlaTable

        datasets = db.session.query(SqlaTable).all()
        result = []
        for ds in datasets:
            if not is_mart_table(ds):
                continue
            result.append({
                "id": ds.id,
                "table_name": ds.table_name,
                "schema": ds.schema,
                "database_name": getattr(ds.database, "database_name", None),
                "description": (ds.description or "")[:200],
                "column_count": len(ds.columns or []),
            })
        result.sort(key=lambda d: d["table_name"])
        return self.response(200, result=result)


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

    @expose("/<dashboard_id>/insight/stream", methods=("POST",))
    @protect()
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def insight_stream(self, dashboard_id: str) -> Response:
        try:
            payload = self.request_schema.load(request.json or {})
            stream = AIInsightService().stream_dashboard_insight(dashboard_id, payload)
            return _sse_response(stream)
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

    @expose("/mart-tables", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def list_mart_tables_endpoint(self) -> Response:
        """List all MART tables available for SQL queries."""
        from superset.ai_insights.sql import (
            _resolve_dataset_table_ref,
            list_all_mart_tables,
        )

        database_id = request.args.get("database_id", type=int)
        if database_id:
            from superset.ai_insights.sql import list_mart_tables

            tables = list_mart_tables(database_id)
        else:
            tables = list_all_mart_tables()

        result = []
        for table in tables[:50]:
            resolved_schema, resolved_table = _resolve_dataset_table_ref(table)
            cols = [
                {
                    "name": col.column_name,
                    "type": str(col.type or ""),
                }
                for col in (table.columns or [])[:30]
            ]
            result.append({
                "dataset_id": table.id,
                "table_name": resolved_table,
                "dataset_name": table.table_name,
                "schema": resolved_schema,
                "description": (table.description or "")[:200],
                "columns": cols,
                "column_count": len(table.columns or []),
            })
        return self.response(200, result=result)


class AIPublicDashboardRestApi(BaseSupersetApi):
    """AI endpoints accessible by guest/embedded dashboard users.

    Uses the same dashboard insight service but validates access via
    guest token and applies public-specific limits (fewer tokens, rate limiting).
    """

    allow_browser_login = True
    class_permission_name = "Dashboard"
    resource_name = "ai/public/dashboard"
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
                200,
                result=AIInsightService().get_capabilities(AI_MODE_PUBLIC_DASHBOARD),
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
            result = AIInsightService().generate_dashboard_insight(
                dashboard_id, payload, public_mode=True
            )
            return self.response(200, result=result)
        except ValidationError as ex:
            return self.response_400(message=ex.messages)
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)

    @expose("/<dashboard_id>/insight/stream", methods=("POST",))
    @protect()
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def insight_stream(self, dashboard_id: str) -> Response:
        try:
            payload = self.request_schema.load(request.json or {})
            stream = AIInsightService().stream_dashboard_insight(
                dashboard_id, payload, public_mode=True
            )
            return _sse_response(stream)
        except ValidationError as ex:
            return self.response_400(message=ex.messages)
        except AIInsightError as ex:
            return self.response(ex.status_code, message=ex.message)
