from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any

from flask import request
from flask_appbuilder.api import expose, protect, safe
from flask_appbuilder.security.decorators import permission_name
from marshmallow import INCLUDE, Schema, ValidationError, fields
from sqlalchemy import func

from superset.ai_insights.config import get_ai_insights_config
from superset.ai_insights.models import AIUsageLog
from superset.ai_insights.providers import AIProviderError, ProviderRegistry
from superset.ai_insights.settings import (
    build_ai_management_payload,
    save_ai_management_settings,
)
from superset.constants import MODEL_API_RW_METHOD_PERMISSION_MAP, PASSWORD_MASK
from superset.extensions import db
from superset.views.base_api import BaseSupersetApi


class AIManagementSettingsSchema(Schema):
    class Meta:
        unknown = INCLUDE

    enabled = fields.Bool(load_default=False)
    allow_sql_execution = fields.Bool(load_default=False)
    max_context_rows = fields.Int(load_default=20)
    max_context_columns = fields.Int(load_default=25)
    max_dashboard_charts = fields.Int(load_default=12)
    max_follow_up_messages = fields.Int(load_default=6)
    max_generated_sql_rows = fields.Int(load_default=200)
    request_timeout_seconds = fields.Int(load_default=30)
    max_tokens = fields.Int(load_default=1200)
    temperature = fields.Float(load_default=0.1)
    default_provider = fields.Str(load_default=None, allow_none=True)
    default_model = fields.Str(load_default=None, allow_none=True)
    allowed_roles = fields.List(fields.Str(), load_default=list)
    mode_roles = fields.Dict(load_default=dict)
    providers = fields.Dict(load_default=dict)


class AIProviderTestSchema(Schema):
    class Meta:
        unknown = INCLUDE

    provider_id = fields.Str(required=True)
    model = fields.Str(load_default=None, allow_none=True)
    prompt = fields.Str(load_default="Reply with OK only.")
    provider = fields.Dict(load_default=dict)


class AIManagementRestApi(BaseSupersetApi):
    allow_browser_login = True
    csrf_exempt = False
    class_permission_name = "AIManagement"
    method_permission_name = {
        **MODEL_API_RW_METHOD_PERMISSION_MAP,
        "get_settings": "read",
        "update_settings": "write",
        "test_provider": "write",
        "usage_stats": "read",
        "usage_log": "read",
    }
    resource_name = "ai-management"
    openapi_spec_tag = "AI"

    settings_schema = AIManagementSettingsSchema()
    test_schema = AIProviderTestSchema()

    @expose("/settings", methods=("GET",))
    @protect()
    @safe
    def get_settings(self) -> Any:
        return self.response(200, result=build_ai_management_payload())

    @expose("/settings", methods=("PUT",))
    @protect()
    @safe
    @permission_name("write")
    def update_settings(self) -> Any:
        try:
            payload = self.settings_schema.load(request.json or {})
        except ValidationError as ex:
            return self.response_400(message=ex.messages)

        try:
            return self.response(200, result=save_ai_management_settings(payload))
        except Exception as ex:  # pylint: disable=broad-except
            return self.response_500(message=str(ex))

    @expose("/test-provider", methods=("POST",))
    @protect()
    @safe
    @permission_name("write")
    def test_provider(self) -> Any:
        try:
            payload = self.test_schema.load(request.json or {})
        except ValidationError as ex:
            return self.response_400(message=ex.messages)

        provider_id = str(payload["provider_id"])
        current_config = get_ai_insights_config()
        current_provider = deepcopy((current_config.get("providers") or {}).get(provider_id) or {})
        submitted_provider = deepcopy(payload.get("provider") or {})
        if submitted_provider.get("api_key") == PASSWORD_MASK and current_provider.get("api_key"):
            submitted_provider["api_key"] = current_provider["api_key"]
        merged_provider = {**current_provider, **submitted_provider}

        temp_config = {
            **deepcopy(current_config),
            "providers": {provider_id: merged_provider},
            "default_provider": provider_id,
            "default_model": str(payload.get("model") or merged_provider.get("default_model") or "").strip()
            or None,
        }
        registry = ProviderRegistry(config=temp_config)

        try:
            result = registry.generate(
                provider_id=provider_id,
                model=payload.get("model"),
                messages=[
                    {
                        "role": "system",
                        "content": "You are an availability probe. Reply with OK only.",
                    },
                    {"role": "user", "content": str(payload.get("prompt") or "OK")},
                ],
            )
        except AIProviderError as ex:
            return self.response(400, message=str(ex))
        except Exception as ex:  # pylint: disable=broad-except
            return self.response_500(message=str(ex))

        return self.response(
            200,
            result={
                "provider": result.provider_id,
                "model": result.model,
                "text": result.text,
                "duration_ms": result.duration_ms,
            },
        )

    @expose("/usage/stats", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def usage_stats(self) -> Any:
        """Aggregate usage stats for the AI insights admin dashboard."""
        days = int(request.args.get("days", 30))
        since = datetime.utcnow() - timedelta(days=days)

        base_q = db.session.query(AIUsageLog).filter(AIUsageLog.created_on >= since)

        total_requests = base_q.count()
        successful = base_q.filter(AIUsageLog.status == "success").count()
        errors = base_q.filter(AIUsageLog.status != "success").count()

        avg_duration = (
            db.session.query(func.avg(AIUsageLog.duration_ms))
            .filter(AIUsageLog.created_on >= since, AIUsageLog.status == "success")
            .scalar()
        ) or 0

        # Breakdown by mode
        by_mode = (
            db.session.query(AIUsageLog.mode, func.count(AIUsageLog.id))
            .filter(AIUsageLog.created_on >= since)
            .group_by(AIUsageLog.mode)
            .all()
        )

        # Breakdown by provider
        by_provider = (
            db.session.query(AIUsageLog.provider_id, func.count(AIUsageLog.id))
            .filter(AIUsageLog.created_on >= since)
            .group_by(AIUsageLog.provider_id)
            .all()
        )

        # Daily request counts
        daily = (
            db.session.query(
                func.date(AIUsageLog.created_on).label("date"),
                func.count(AIUsageLog.id),
            )
            .filter(AIUsageLog.created_on >= since)
            .group_by(func.date(AIUsageLog.created_on))
            .order_by(func.date(AIUsageLog.created_on))
            .all()
        )

        # Top users
        top_users = (
            db.session.query(AIUsageLog.user_id, func.count(AIUsageLog.id))
            .filter(AIUsageLog.created_on >= since)
            .group_by(AIUsageLog.user_id)
            .order_by(func.count(AIUsageLog.id).desc())
            .limit(10)
            .all()
        )

        return self.response(
            200,
            result={
                "period_days": days,
                "total_requests": total_requests,
                "successful": successful,
                "errors": errors,
                "avg_duration_ms": round(float(avg_duration), 1),
                "by_mode": {mode: count for mode, count in by_mode},
                "by_provider": {pid: count for pid, count in by_provider},
                "daily": [
                    {"date": str(d), "count": c} for d, c in daily
                ],
                "top_users": [
                    {"user_id": uid, "count": c} for uid, c in top_users
                ],
            },
        )

    @expose("/usage/log", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def usage_log(self) -> Any:
        """Recent usage log entries."""
        limit = min(int(request.args.get("limit", 50)), 500)
        offset = int(request.args.get("offset", 0))
        mode = request.args.get("mode")
        status = request.args.get("status")

        query = db.session.query(AIUsageLog)
        if mode:
            query = query.filter(AIUsageLog.mode == mode)
        if status:
            query = query.filter(AIUsageLog.status == status)

        entries = (
            query.order_by(AIUsageLog.created_on.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return self.response(
            200,
            result=[
                {
                    "id": e.id,
                    "user_id": e.user_id,
                    "mode": e.mode,
                    "provider_id": e.provider_id,
                    "model_name": e.model_name,
                    "question_length": e.question_length,
                    "response_length": e.response_length,
                    "duration_ms": e.duration_ms,
                    "status": e.status,
                    "error_message": e.error_message,
                    "target_id": e.target_id,
                    "created_on": e.created_on.isoformat() if e.created_on else None,
                }
                for e in entries
            ],
        )
