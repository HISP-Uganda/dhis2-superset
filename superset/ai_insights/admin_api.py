from __future__ import annotations

import logging
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any

from flask import request

logger = logging.getLogger(__name__)
from flask_appbuilder.api import expose, protect, safe
from flask_appbuilder.security.decorators import permission_name
from marshmallow import INCLUDE, Schema, ValidationError, fields
from sqlalchemy import func

from superset.ai_insights.config import get_ai_insights_config
from superset.ai_insights.models import AIUsageLog
from superset.ai_insights.providers import AIProviderError, ProviderRegistry
from superset.ai_insights.settings import (
    _ensure_provider_defaults,
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
    request_timeout_seconds = fields.Int(load_default=60)
    max_tokens = fields.Int(load_default=4096)
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
        # Apply preset defaults (base_url, type, models) and force enabled
        # so the test works even before the provider has been saved.
        merged_provider = _ensure_provider_defaults(provider_id, merged_provider)
        merged_provider["enabled"] = True

        temp_config = {
            **deepcopy(current_config),
            "providers": {provider_id: merged_provider},
            "default_provider": provider_id,
            "default_model": str(payload.get("model") or merged_provider.get("default_model") or "").strip()
            or None,
        }
        registry = ProviderRegistry(config=temp_config)

        logger.info(
            "test-provider %s: type=%s base_url=%s has_key=%s model=%s",
            provider_id,
            merged_provider.get("type"),
            merged_provider.get("base_url"),
            bool(merged_provider.get("api_key") or merged_provider.get("api_key_env")),
            payload.get("model") or merged_provider.get("default_model"),
        )

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
            error_str = str(ex)
            # A 429 means the API key and endpoint are valid — just rate-limited.
            if "429" in error_str:
                logger.info("test-provider %s: connection OK (rate-limited)", provider_id)
                return self.response(
                    200,
                    result={
                        "provider": provider_id,
                        "model": temp_config.get("default_model"),
                        "text": "Connection verified (rate-limited by provider — try again shortly)",
                        "duration_ms": 0,
                    },
                )
            # A 503 means the model is unavailable or doesn't exist.
            if "503" in error_str:
                model_name = temp_config.get("default_model") or "unknown"
                logger.warning("test-provider %s: model %s unavailable (503)", provider_id, model_name)
                return self.response(
                    400,
                    message=f"Model '{model_name}' is not available. "
                    "It may not exist, be disabled, or not yet released. "
                    "Please select a different model.",
                )
            logger.warning("test-provider %s failed: %s", provider_id, ex)
            return self.response(400, message=error_str)
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("test-provider %s error", provider_id)
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
        from superset.ai_insights.models import AIConversation
        from superset.extensions import security_manager

        days = int(request.args.get("days", 30))
        since = datetime.utcnow() - timedelta(days=days)
        prev_since = since - timedelta(days=days)

        # Build system config info (always available, even without usage data)
        config = get_ai_insights_config()
        providers_config = config.get("providers") or {}
        configured_providers = []
        configured_models = []
        for pid, prov in providers_config.items():
            if not isinstance(prov, dict):
                continue
            enabled = bool(prov.get("enabled"))
            configured_providers.append({
                "provider_id": pid,
                "type": prov.get("type", ""),
                "label": prov.get("label", pid),
                "enabled": enabled,
                "model_count": len(prov.get("models") or []),
                "default_model": prov.get("default_model"),
            })
            for model in (prov.get("models") or []):
                configured_models.append({
                    "provider_id": pid,
                    "model": model,
                    "is_default": model == prov.get("default_model"),
                    "provider_enabled": enabled,
                })

        system_config = {
            "ai_enabled": bool(config.get("enabled")),
            "default_provider": config.get("default_provider"),
            "default_model": config.get("default_model"),
            "max_tokens": config.get("max_tokens", 4096),
            "temperature": config.get("temperature", 0.1),
            "request_timeout_seconds": config.get("request_timeout_seconds", 60),
            "configured_providers": configured_providers,
            "configured_models": configured_models,
            "total_providers": len(configured_providers),
            "enabled_providers": sum(1 for p in configured_providers if p["enabled"]),
            "total_models": len(configured_models),
        }

        # Try to get usage stats from the log table
        try:
            return self._build_usage_stats(
                days, since, prev_since, system_config, security_manager,
            )
        except Exception as ex:
            logger.warning("Usage stats query failed (table may not exist): %s", ex)
            # Return system config with empty usage data
            return self.response(200, result={
                "period_days": days,
                "total_requests": 0, "successful": 0, "errors": 0,
                "error_rate": 0, "avg_duration_ms": 0,
                "total_question_chars": 0, "total_response_chars": 0,
                "avg_response_length": 0, "active_users": 0,
                "total_conversations": 0, "trend_pct": 0,
                "percentiles": {}, "by_mode": {}, "by_provider": [],
                "by_model": [], "daily": [], "top_users": [],
                "recent_errors": [],
                "system": system_config,
            })

    def _build_usage_stats(
        self,
        days: int,
        since: datetime,
        prev_since: datetime,
        system_config: dict,
        security_manager: Any,
    ) -> Any:
        from superset.ai_insights.models import AIConversation

        base_q = db.session.query(AIUsageLog).filter(AIUsageLog.created_on >= since)
        prev_q = db.session.query(AIUsageLog).filter(
            AIUsageLog.created_on >= prev_since,
            AIUsageLog.created_on < since,
        )

        total_requests = base_q.count()
        successful = base_q.filter(AIUsageLog.status == "success").count()
        errors = base_q.filter(AIUsageLog.status != "success").count()
        prev_total = prev_q.count()

        avg_duration = (
            db.session.query(func.avg(AIUsageLog.duration_ms))
            .filter(AIUsageLog.created_on >= since, AIUsageLog.status == "success")
            .scalar()
        ) or 0

        # Token / content size totals
        total_question_chars = (
            db.session.query(func.sum(AIUsageLog.question_length))
            .filter(AIUsageLog.created_on >= since)
            .scalar()
        ) or 0
        total_response_chars = (
            db.session.query(func.sum(AIUsageLog.response_length))
            .filter(AIUsageLog.created_on >= since)
            .scalar()
        ) or 0

        avg_response_len = (
            db.session.query(func.avg(AIUsageLog.response_length))
            .filter(AIUsageLog.created_on >= since, AIUsageLog.status == "success")
            .scalar()
        ) or 0

        # Unique active users
        active_users = (
            db.session.query(func.count(func.distinct(AIUsageLog.user_id)))
            .filter(AIUsageLog.created_on >= since)
            .scalar()
        ) or 0

        # Conversations count
        total_conversations = (
            db.session.query(func.count(AIConversation.id))
            .filter(AIConversation.created_on >= since)
            .scalar()
        ) or 0

        # Breakdown by mode (with success/error counts)
        by_mode_raw = (
            db.session.query(
                AIUsageLog.mode,
                AIUsageLog.status,
                func.count(AIUsageLog.id),
            )
            .filter(AIUsageLog.created_on >= since)
            .group_by(AIUsageLog.mode, AIUsageLog.status)
            .all()
        )
        by_mode: dict[str, dict[str, int]] = {}
        for mode, status, count in by_mode_raw:
            if mode not in by_mode:
                by_mode[mode] = {"total": 0, "success": 0, "error": 0}
            by_mode[mode]["total"] += count
            if status == "success":
                by_mode[mode]["success"] += count
            else:
                by_mode[mode]["error"] += count

        # Breakdown by provider (with avg duration)
        by_provider_raw = (
            db.session.query(
                AIUsageLog.provider_id,
                func.count(AIUsageLog.id),
                func.avg(AIUsageLog.duration_ms),
            )
            .filter(AIUsageLog.created_on >= since)
            .group_by(AIUsageLog.provider_id)
            .all()
        )
        by_provider = [
            {
                "provider_id": pid,
                "count": count,
                "avg_duration_ms": round(float(avg_d or 0), 1),
            }
            for pid, count, avg_d in by_provider_raw
        ]

        # Breakdown by model
        by_model = (
            db.session.query(
                AIUsageLog.model_name,
                func.count(AIUsageLog.id),
            )
            .filter(AIUsageLog.created_on >= since)
            .group_by(AIUsageLog.model_name)
            .order_by(func.count(AIUsageLog.id).desc())
            .all()
        )

        # Daily request counts (with success/error split)
        daily_raw = (
            db.session.query(
                func.date(AIUsageLog.created_on).label("date"),
                AIUsageLog.status,
                func.count(AIUsageLog.id),
            )
            .filter(AIUsageLog.created_on >= since)
            .group_by(func.date(AIUsageLog.created_on), AIUsageLog.status)
            .order_by(func.date(AIUsageLog.created_on))
            .all()
        )
        daily_map: dict[str, dict[str, int]] = {}
        for d, status, count in daily_raw:
            ds = str(d)
            if ds not in daily_map:
                daily_map[ds] = {"date": ds, "success": 0, "error": 0, "total": 0}
            daily_map[ds]["total"] += count
            if status == "success":
                daily_map[ds]["success"] += count
            else:
                daily_map[ds]["error"] += count
        daily = list(daily_map.values())

        # Top users with usernames
        top_users_raw = (
            db.session.query(
                AIUsageLog.user_id,
                func.count(AIUsageLog.id),
                func.avg(AIUsageLog.duration_ms),
            )
            .filter(AIUsageLog.created_on >= since)
            .group_by(AIUsageLog.user_id)
            .order_by(func.count(AIUsageLog.id).desc())
            .limit(10)
            .all()
        )
        user_model = security_manager.user_model
        user_ids = [uid for uid, _, _ in top_users_raw if uid]
        user_names: dict[int, str] = {}
        if user_ids:
            users = (
                db.session.query(user_model.id, user_model.first_name, user_model.last_name, user_model.username)
                .filter(user_model.id.in_(user_ids))
                .all()
            )
            for u in users:
                display = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username
                user_names[u.id] = display

        top_users = [
            {
                "user_id": uid,
                "username": user_names.get(uid, f"User {uid}"),
                "count": count,
                "avg_duration_ms": round(float(avg_d or 0), 1),
            }
            for uid, count, avg_d in top_users_raw
        ]

        # Recent errors
        recent_errors = (
            db.session.query(AIUsageLog)
            .filter(AIUsageLog.created_on >= since, AIUsageLog.status != "success")
            .order_by(AIUsageLog.created_on.desc())
            .limit(10)
            .all()
        )

        # Response time percentiles (p50, p90, p99)
        durations = (
            db.session.query(AIUsageLog.duration_ms)
            .filter(
                AIUsageLog.created_on >= since,
                AIUsageLog.status == "success",
                AIUsageLog.duration_ms.isnot(None),
            )
            .order_by(AIUsageLog.duration_ms)
            .all()
        )
        sorted_durations = [d[0] for d in durations if d[0] is not None]
        percentiles = {}
        if sorted_durations:
            n = len(sorted_durations)
            percentiles = {
                "p50": sorted_durations[int(n * 0.5)],
                "p90": sorted_durations[min(int(n * 0.9), n - 1)],
                "p99": sorted_durations[min(int(n * 0.99), n - 1)],
                "max": sorted_durations[-1],
            }

        # Error rate
        error_rate = round(errors / total_requests * 100, 1) if total_requests > 0 else 0
        # Trend (vs previous period)
        trend_pct = (
            round((total_requests - prev_total) / prev_total * 100, 1)
            if prev_total > 0
            else (100.0 if total_requests > 0 else 0)
        )

        return self.response(
            200,
            result={
                "period_days": days,
                "total_requests": total_requests,
                "successful": successful,
                "errors": errors,
                "error_rate": error_rate,
                "avg_duration_ms": round(float(avg_duration), 1),
                "total_question_chars": total_question_chars,
                "total_response_chars": total_response_chars,
                "avg_response_length": round(float(avg_response_len)),
                "active_users": active_users,
                "total_conversations": total_conversations,
                "trend_pct": trend_pct,
                "percentiles": percentiles,
                "by_mode": by_mode,
                "by_provider": by_provider,
                "by_model": [
                    {"model": m, "count": c} for m, c in by_model
                ],
                "daily": daily,
                "top_users": top_users,
                "recent_errors": [
                    {
                        "id": e.id,
                        "mode": e.mode,
                        "provider_id": e.provider_id,
                        "model_name": e.model_name,
                        "error_message": (e.error_message or "")[:200],
                        "created_on": e.created_on.isoformat() if e.created_on else None,
                    }
                    for e in recent_errors
                ],
                "system": system_config,
            },
        )

    @expose("/usage/log", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def usage_log(self) -> Any:
        """Recent usage log entries."""
        from superset.extensions import security_manager

        limit = min(int(request.args.get("limit", 100)), 500)
        offset = int(request.args.get("offset", 0))
        mode = request.args.get("mode")
        status = request.args.get("status")
        provider = request.args.get("provider")
        model = request.args.get("model")
        search = request.args.get("search", "").strip()

        query = db.session.query(AIUsageLog)
        if mode:
            query = query.filter(AIUsageLog.mode == mode)
        if status:
            query = query.filter(AIUsageLog.status == status)
        if provider:
            query = query.filter(AIUsageLog.provider_id == provider)
        if model:
            query = query.filter(AIUsageLog.model_name == model)

        total = query.count()
        entries = (
            query.order_by(AIUsageLog.created_on.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        # Resolve usernames
        user_model = security_manager.user_model
        user_ids = list({e.user_id for e in entries if e.user_id})
        user_names: dict[int, str] = {}
        if user_ids:
            users = (
                db.session.query(user_model.id, user_model.first_name, user_model.last_name, user_model.username)
                .filter(user_model.id.in_(user_ids))
                .all()
            )
            for u in users:
                display = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username
                user_names[u.id] = display

        return self.response(
            200,
            result={
                "entries": [
                    {
                        "id": e.id,
                        "user_id": e.user_id,
                        "username": user_names.get(e.user_id, f"User {e.user_id}"),
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
                "total": total,
            },
        )
