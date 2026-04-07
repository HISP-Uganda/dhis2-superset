from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests as http_requests
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
    LOCALAI_DEFAULT_MODEL_ID,
    LOCALAI_TEXT_MODEL_CATALOG,
    _ensure_provider_defaults,
    build_ai_management_payload,
    ensure_localai_environment,
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
        "localai_gallery": "read",
        "localai_start": "write",
        "localai_stop": "write",
        "localai_installed": "read",
        "localai_install_model": "write",
        "localai_job_progress": "read",
        "localai_delete_model": "write",
        "localai_training_status": "read",
        "localai_training_evaluate": "write",
        "localai_training_prepare": "write",
    }
    resource_name = "ai-management"
    openapi_spec_tag = "AI"

    settings_schema = AIManagementSettingsSchema()
    test_schema = AIProviderTestSchema()

    @expose("/settings", methods=("GET",))
    @protect()
    @safe
    def get_settings(self) -> Any:
        ensure_localai_environment(write_env_file=True)
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
            if "backend not found" in error_str and provider_id == "localai":
                model_name = temp_config.get("default_model") or "unknown"
                logger.warning(
                    "test-provider %s: backend unavailable for model %s: %s",
                    provider_id,
                    model_name,
                    error_str,
                )
                return self.response(
                    400,
                    message=(
                        f"LocalAI backend is not available for model '{model_name}'. "
                        "This repo-managed model requires the 'llama-cpp' backend. "
                        "Restart LocalAI so it boots with LOCALAI_EXTERNAL_BACKENDS=llama-cpp, "
                        "or install the backend before testing again."
                    ),
                )
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

    # ── LocalAI Model Management ────────────────────────────────────────────

    def _localai_base_url(self) -> str | None:
        """Resolve the LocalAI base URL from config."""
        config = get_ai_insights_config()
        providers = config.get("providers") or {}
        localai = providers.get("localai") or {}
        return str(localai.get("base_url") or "").rstrip("/") or None

    @staticmethod
    def _localai_auth_headers() -> dict[str, str]:
        """Build auth headers for LocalAI API calls."""
        from superset.ai_insights.config import resolve_provider_secret

        config = get_ai_insights_config()
        providers = config.get("providers") or {}
        localai = providers.get("localai") or {}
        headers: dict[str, str] = {}
        secret = resolve_provider_secret(localai)
        if secret:
            headers["Authorization"] = f"Bearer {secret}"
        return headers

    @staticmethod
    def _trim_output(output: str, *, max_chars: int = 4000) -> str:
        text = str(output or "").strip()
        if len(text) <= max_chars:
            return text
        return f"{text[:max_chars]}…"

    @staticmethod
    def _localai_setup_script() -> Path:
        return Path(__file__).resolve().parents[2] / "scripts" / "setup_localai.sh"

    @staticmethod
    def _localai_repo_models_dir() -> Path:
        return Path(__file__).resolve().parents[2] / "localai" / "models"

    @staticmethod
    def _localai_runtime_models_dir() -> Path:
        base = os.environ.get("LOCALAI_MODELS_DIR")
        if base:
            return Path(base).expanduser()
        return Path.home() / ".local" / "share" / "localai" / "models"

    @classmethod
    def _localai_repo_model_files(cls, model_id: str) -> list[Path]:
        models_dir = cls._localai_repo_models_dir()
        if not models_dir.exists():
            return []
        return sorted(
            path for path in models_dir.glob(f"{model_id}*") if path.is_file()
        )

    @classmethod
    def _localai_runtime_model_files(cls, model_id: str) -> list[Path]:
        models_dir = cls._localai_runtime_models_dir()
        if not models_dir.exists():
            return []
        return sorted(
            path for path in models_dir.glob(f"{model_id}*") if path.is_file()
        )

    @staticmethod
    def _format_bytes(num_bytes: int) -> str:
        size = float(max(num_bytes, 0))
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if size < 1024 or unit == "TB":
                if unit == "B":
                    return f"{int(size)} {unit}"
                return f"{size:.1f} {unit}"
            size /= 1024
        return "0 B"

    @classmethod
    def _total_size(cls, paths: list[Path]) -> str:
        existing = [path for path in paths if path.exists() and path.is_file()]
        if not existing:
            return ""
        return cls._format_bytes(sum(path.stat().st_size for path in existing))

    @staticmethod
    def _is_repo_managed_localai_model(entry: dict[str, Any]) -> bool:
        return bool(entry.get("is_repo_managed"))

    def _persist_localai_recommended_defaults(self) -> None:
        ensure_localai_environment(write_env_file=True)
        payload = deepcopy(build_ai_management_payload()["settings"])
        providers = payload.setdefault("providers", {})
        localai = _ensure_provider_defaults("localai", providers.get("localai") or {})
        localai["enabled"] = True
        localai["models"] = [
            LOCALAI_DEFAULT_MODEL_ID,
            *[model for model in localai.get("models") or [] if model != LOCALAI_DEFAULT_MODEL_ID],
        ]
        localai["default_model"] = LOCALAI_DEFAULT_MODEL_ID
        providers["localai"] = localai

        if not str(payload.get("default_provider") or "").strip():
            payload["default_provider"] = "localai"
            payload["default_model"] = LOCALAI_DEFAULT_MODEL_ID
        elif payload.get("default_provider") == "localai":
            payload["default_model"] = LOCALAI_DEFAULT_MODEL_ID

        save_ai_management_settings(payload)

    def _run_localai_setup_command(self, command: str) -> dict[str, Any]:
        script_path = self._localai_setup_script()
        if not script_path.exists():
            raise FileNotFoundError(f"LocalAI setup script not found at {script_path}")

        completed = subprocess.run(  # noqa: S603
            ["bash", str(script_path), command],
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )
        return {
            "returncode": completed.returncode,
            "stdout": self._trim_output(completed.stdout),
            "stderr": self._trim_output(completed.stderr),
        }

    def _deploy_repo_managed_localai_model(self, model_id: str) -> dict[str, Any]:
        source_files = self._localai_repo_model_files(model_id)
        if not source_files:
            raise FileNotFoundError(
                f"No repo-managed LocalAI assets found for {model_id}"
            )

        target_dir = self._localai_runtime_models_dir()
        target_dir.mkdir(parents=True, exist_ok=True)
        copied_paths: list[Path] = []
        for source in source_files:
            target = target_dir / source.name
            shutil.copy2(source, target)
            copied_paths.append(target)
        return {
            "model_id": model_id,
            "copied_files": [str(path) for path in copied_paths],
            "file_size": self._total_size(copied_paths),
        }

    def _remove_repo_managed_localai_model(self, model_id: str) -> dict[str, Any]:
        target_files = self._localai_runtime_model_files(model_id)
        removed_files: list[str] = []
        for path in target_files:
            path.unlink(missing_ok=True)
            removed_files.append(str(path))
        return {
            "model_id": model_id,
            "removed_files": removed_files,
        }

    @classmethod
    def _read_repo_managed_model_yaml(cls, model_id: str) -> str:
        yaml_path = cls._localai_repo_models_dir() / f"{model_id}.yaml"
        if not yaml_path.exists():
            return ""
        return yaml_path.read_text(encoding="utf-8")

    @classmethod
    def _repo_managed_base_dependency(cls, model_id: str) -> dict[str, str]:
        yaml_text = cls._read_repo_managed_model_yaml(model_id)
        if not yaml_text:
            return {}

        base_match = re.search(r"^\s*model:\s*(.+?)\s*$", yaml_text, re.MULTILINE)
        lora_match = re.search(
            r"^\s*lora_adapter:\s*(.+?)\s*$", yaml_text, re.MULTILINE
        )
        base_model = base_match.group(1).strip().strip("'\"") if base_match else ""
        lora_adapter = lora_match.group(1).strip().strip("'\"") if lora_match else ""

        search_dirs = [
            cls._localai_runtime_models_dir(),
            cls._localai_repo_models_dir(),
        ]
        base_size = ""
        if base_model:
            candidate_paths = [
                directory / base_model
                for directory in search_dirs
                if (directory / base_model).exists()
            ]
            if candidate_paths:
                base_size = cls._total_size(candidate_paths)

        lora_size = ""
        if lora_adapter:
            candidate_paths = [
                directory / lora_adapter
                for directory in search_dirs
                if (directory / lora_adapter).exists()
            ]
            if candidate_paths:
                lora_size = cls._total_size(candidate_paths)

        return {
            "base_model": base_model,
            "base_model_file_size": base_size,
            "lora_adapter": lora_adapter,
            "lora_adapter_file_size": lora_size,
        }

    @classmethod
    def _check_model_dependencies(cls, model_id: str) -> dict[str, Any]:
        """Check if a repo-managed model has all required files.

        Returns a dict with:
        - ready: bool — True if the model can be loaded by LocalAI
        - missing: list of missing file descriptions
        - gguf_present: bool — whether the base GGUF exists
        - yaml_present: bool — whether the config YAML exists
        """
        entry = next(
            (e for e in LOCALAI_TEXT_MODEL_CATALOG if e.get("id") == model_id),
            None,
        )
        if not entry or not entry.get("is_repo_managed"):
            return {"ready": True, "missing": [], "gguf_present": True, "yaml_present": True}

        runtime_dir = cls._localai_runtime_models_dir()
        repo_dir = cls._localai_repo_models_dir()
        missing: list[str] = []

        # Check YAML config
        yaml_present = (runtime_dir / f"{model_id}.yaml").exists() or (
            repo_dir / f"{model_id}.yaml"
        ).exists()
        if not yaml_present:
            missing.append(f"{model_id}.yaml (model config)")

        # Check base GGUF
        gguf_name = str(entry.get("base_model_gguf") or "")
        if not gguf_name:
            dep = cls._repo_managed_base_dependency(model_id)
            gguf_name = dep.get("base_model", "")

        gguf_present = False
        if gguf_name:
            gguf_present = (runtime_dir / gguf_name).exists()
            if not gguf_present:
                missing.append(f"{gguf_name} (base model weights, ~4.6 GB)")

        return {
            "ready": len(missing) == 0,
            "missing": missing,
            "gguf_present": gguf_present,
            "yaml_present": yaml_present,
            "gguf_name": gguf_name,
            "gguf_url": str(entry.get("base_model_url") or ""),
        }

    @classmethod
    def _ensure_model_dependencies(cls, model_id: str) -> dict[str, Any]:
        """Ensure all dependencies for a repo-managed model are present.

        Copies the YAML config from the repo to the runtime dir if missing,
        and downloads the base GGUF from HuggingFace if missing.

        Returns a status dict with what was done.
        """
        deps = cls._check_model_dependencies(model_id)
        actions: list[str] = []

        if deps["ready"]:
            return {"ready": True, "actions": [], "deps": deps}

        runtime_dir = cls._localai_runtime_models_dir()
        runtime_dir.mkdir(parents=True, exist_ok=True)

        # Copy YAML from repo if missing in runtime
        if not deps["yaml_present"]:
            repo_yaml = cls._localai_repo_models_dir() / f"{model_id}.yaml"
            if repo_yaml.exists():
                shutil.copy2(repo_yaml, runtime_dir / f"{model_id}.yaml")
                actions.append(f"Copied {model_id}.yaml to runtime")

        # Download GGUF if missing
        gguf_name = deps.get("gguf_name", "")
        gguf_url = deps.get("gguf_url", "")
        if not deps["gguf_present"] and gguf_name and gguf_url:
            target = runtime_dir / gguf_name
            partial = runtime_dir / f"{gguf_name}.partial"
            try:
                logger.info(
                    "Downloading base GGUF for %s: %s", model_id, gguf_url
                )
                with http_requests.get(gguf_url, stream=True, timeout=30) as resp:
                    resp.raise_for_status()
                    with open(partial, "wb") as f:
                        for chunk in resp.iter_content(chunk_size=8 * 1024 * 1024):
                            f.write(chunk)
                partial.rename(target)
                actions.append(
                    f"Downloaded {gguf_name} ({cls._format_bytes(target.stat().st_size)})"
                )
            except Exception as exc:
                partial.unlink(missing_ok=True)
                logger.error("GGUF download failed for %s: %s", model_id, exc)
                return {
                    "ready": False,
                    "actions": actions,
                    "error": f"Failed to download {gguf_name}: {exc}",
                    "deps": cls._check_model_dependencies(model_id),
                }

        final_deps = cls._check_model_dependencies(model_id)
        return {"ready": final_deps["ready"], "actions": actions, "deps": final_deps}

    @staticmethod
    def _resolve_localai_model_size(
        entry: dict[str, Any], gallery_item: dict[str, Any]
    ) -> str:
        if entry.get("is_repo_managed"):
            model_id = str(entry.get("id") or "")
            runtime_size = AIManagementRestApi._total_size(
                AIManagementRestApi._localai_runtime_model_files(model_id)
            )
            if runtime_size:
                return runtime_size
            repo_size = AIManagementRestApi._total_size(
                AIManagementRestApi._localai_repo_model_files(model_id)
            )
            if repo_size:
                return repo_size

        explicit_size = str(entry.get("file_size") or "").strip()
        if explicit_size:
            return explicit_size

        for key in ("file_size", "filesize", "size", "download_size"):
            value = str(gallery_item.get(key) or "").strip()
            if value:
                return value

        desc = str(entry.get("description") or "").strip()
        if " GB" in desc or " MB" in desc:
            size_match = re.search(r"(\d+\.?\d*\s*[GM]B)", desc)
            if size_match:
                return size_match.group(1)
        return ""

    @expose("/localai/gallery", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def localai_gallery(self) -> Any:
        """Return the curated LocalAI model catalog with download sizes.

        Merges the static catalog (with descriptions/groups) with live
        availability data from the running LocalAI instance's gallery.
        """
        base_url = self._localai_base_url()
        config = get_ai_insights_config()
        providers = config.get("providers") or {}
        localai_provider = providers.get("localai") or {}

        # Build the curated catalog with size info
        catalog = []
        gallery_lookup: dict[str, dict] = {}

        # Try to fetch the live gallery for file size info
        auth_headers = self._localai_auth_headers()
        if base_url:
            try:
                resp = http_requests.get(
                    f"{base_url}/models/available",
                    headers=auth_headers,
                    timeout=10,
                )
                if resp.status_code == 200:
                    for item in resp.json():
                        name = item.get("name", "")
                        gallery_lookup[name.lower()] = item
            except Exception:  # pylint: disable=broad-except
                pass

        # Also get currently installed models
        installed_ids: set[str] = set()
        if base_url:
            try:
                resp = http_requests.get(
                    f"{base_url}/v1/models",
                    headers=auth_headers,
                    timeout=5,
                )
                if resp.status_code == 200:
                    for m in resp.json().get("data", []):
                        installed_ids.add(m.get("id", ""))
            except Exception:  # pylint: disable=broad-except
                pass

        for entry in LOCALAI_TEXT_MODEL_CATALOG:
            model_id = entry["id"]
            gallery_item = gallery_lookup.get(model_id.lower(), {})
            file_size = self._resolve_localai_model_size(entry, gallery_item)
            is_repo_managed = self._is_repo_managed_localai_model(entry)
            repo_installed = bool(self._localai_runtime_model_files(model_id))
            dependency_info = (
                self._repo_managed_base_dependency(model_id)
                if is_repo_managed
                else {}
            )

            dep_check = (
                self._check_model_dependencies(model_id)
                if is_repo_managed
                else {}
            )

            catalog.append({
                "id": model_id,
                "label": entry.get("label", model_id),
                "group": entry.get("group", "General"),
                "description": entry.get("description", ""),
                "capabilities": entry.get("capabilities", []),
                "is_recommended": entry.get("is_recommended", False),
                "file_size": file_size,
                "installed": repo_installed or model_id in installed_ids,
                "is_default_model": model_id == localai_provider.get("default_model"),
                "is_repo_managed": is_repo_managed,
                "asset_file_size": file_size if is_repo_managed else "",
                "base_model": dependency_info.get("base_model", ""),
                "base_model_file_size": dependency_info.get(
                    "base_model_file_size", ""
                ),
                "lora_adapter": dependency_info.get("lora_adapter", ""),
                "lora_adapter_file_size": dependency_info.get(
                    "lora_adapter_file_size", ""
                ),
                "model_ready": dep_check.get("ready", True),
                "missing_dependencies": dep_check.get("missing", []),
            })

        # Also add any installed models not in the curated catalog
        catalog_ids = {e["id"] for e in LOCALAI_TEXT_MODEL_CATALOG}
        for mid in installed_ids:
            if mid not in catalog_ids:
                catalog.append({
                    "id": mid,
                    "label": mid,
                    "group": "Installed",
                    "description": "Model installed on LocalAI.",
                    "capabilities": [],
                    "is_recommended": False,
                    "file_size": "",
                    "installed": True,
                    "is_default_model": mid == localai_provider.get("default_model"),
                    "is_repo_managed": False,
                    "asset_file_size": "",
                    "base_model": "",
                    "base_model_file_size": "",
                    "lora_adapter": "",
                    "lora_adapter_file_size": "",
                })

        return self.response(
            200,
            result={
                "models": catalog,
                "provider_enabled": bool(localai_provider.get("enabled")),
                "provider_default_model": localai_provider.get("default_model"),
                "default_provider": config.get("default_provider"),
                "localai_running": base_url is not None
                and self._localai_health_check(base_url),
                "base_url": base_url,
            },
        )

    @expose("/localai/start", methods=("POST",))
    @protect()
    @safe
    @permission_name("write")
    def localai_start(self) -> Any:
        """Start the managed LocalAI service using the repo bootstrap script.

        Before starting, checks that the default model has all required
        dependencies (YAML config + base GGUF weights). Reports dependency
        status so the UI can show what's missing or being downloaded.
        """
        # Pre-flight: check default model dependencies
        dep_check = self._check_model_dependencies(LOCALAI_DEFAULT_MODEL_ID)
        dep_status = {
            "model_ready": dep_check["ready"],
            "missing_dependencies": dep_check.get("missing", []),
        }

        try:
            command_result = self._run_localai_setup_command("start")
        except FileNotFoundError as ex:
            return self.response_500(message=str(ex))
        stdout = command_result["stdout"]
        stderr = command_result["stderr"]

        base_url = self._localai_base_url() or "http://127.0.0.1:39671"
        running = self._localai_health_check(base_url)

        if command_result["returncode"] == 0 and running:
            self._persist_localai_recommended_defaults()
            return self.response(
                200,
                result={
                    "localai_running": True,
                    "base_url": base_url,
                    "stdout": stdout,
                    "stderr": stderr,
                    "default_provider": "localai",
                    "default_model": LOCALAI_DEFAULT_MODEL_ID,
                    **dep_status,
                },
            )

        message = stderr or stdout or "LocalAI failed to start"
        if not dep_check["ready"]:
            message += (
                f"\n\nModel '{LOCALAI_DEFAULT_MODEL_ID}' has missing dependencies: "
                + ", ".join(dep_check.get("missing", []))
            )
        return self.response(
            400,
            message=message,
            result={
                "localai_running": running,
                "base_url": base_url,
                "stdout": stdout,
                "stderr": stderr,
                "returncode": command_result["returncode"],
                **dep_status,
            },
        )

    @expose("/localai/stop", methods=("POST",))
    @protect()
    @safe
    @permission_name("write")
    def localai_stop(self) -> Any:
        """Stop the managed LocalAI service using the repo bootstrap script."""
        try:
            command_result = self._run_localai_setup_command("stop")
        except FileNotFoundError as ex:
            return self.response_500(message=str(ex))

        base_url = self._localai_base_url() or "http://127.0.0.1:39671"
        running = self._localai_health_check(base_url)
        success = command_result["returncode"] == 0 and not running

        if success:
            return self.response(
                200,
                result={
                    "localai_running": False,
                    "base_url": base_url,
                    "stdout": command_result["stdout"],
                    "stderr": command_result["stderr"],
                },
            )

        message = (
            command_result["stderr"]
            or command_result["stdout"]
            or "LocalAI failed to stop cleanly"
        )
        return self.response(
            400,
            message=message,
            result={
                "localai_running": running,
                "base_url": base_url,
                "stdout": command_result["stdout"],
                "stderr": command_result["stderr"],
                "returncode": command_result["returncode"],
            },
        )

    @expose("/localai/installed", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def localai_installed(self) -> Any:
        """Return currently installed models on the running LocalAI instance."""
        base_url = self._localai_base_url()
        if not base_url:
            return self.response(
                400, message="LocalAI provider is not configured"
            )
        try:
            resp = http_requests.get(
                f"{base_url}/v1/models",
                headers=self._localai_auth_headers(),
                timeout=5,
            )
            resp.raise_for_status()
            models = resp.json().get("data", [])
            return self.response(
                200,
                result={
                    "models": [
                        {"id": m.get("id", ""), "object": m.get("object", "")}
                        for m in models
                    ],
                },
            )
        except Exception as ex:  # pylint: disable=broad-except
            return self.response(400, message=f"Cannot reach LocalAI: {ex}")

    @expose("/localai/models/install", methods=("POST",))
    @protect()
    @safe
    @permission_name("write")
    def localai_install_model(self) -> Any:
        """Install or deploy a model on the LocalAI instance."""
        body = request.json or {}
        model_id = str(body.get("model_id", "")).strip()
        if not model_id:
            return self.response_400(message="model_id is required")

        entry = next(
            (
                item
                for item in LOCALAI_TEXT_MODEL_CATALOG
                if str(item.get("id") or "") == model_id
            ),
            None,
        )
        if entry and self._is_repo_managed_localai_model(entry):
            try:
                deployed = self._deploy_repo_managed_localai_model(model_id)
                # Also ensure base GGUF dependency is present
                dep_result = self._ensure_model_dependencies(model_id)
                return self.response(
                    200,
                    result={
                        "uuid": "",
                        "status_url": "",
                        "deployed": True,
                        "model_id": model_id,
                        "copied_files": deployed["copied_files"],
                        "file_size": deployed["file_size"],
                        "model_ready": dep_result["ready"],
                        "dependency_actions": dep_result.get("actions", []),
                        "missing_dependencies": dep_result.get("deps", {}).get(
                            "missing", []
                        ),
                    },
                )
            except FileNotFoundError as ex:
                return self.response(400, message=str(ex))
            except Exception as ex:  # pylint: disable=broad-except
                return self.response(400, message=f"Deploy request failed: {ex}")

        base_url = self._localai_base_url()
        if not base_url:
            return self.response(
                400, message="LocalAI provider is not configured"
            )

        try:
            resp = http_requests.post(
                f"{base_url}/models/apply",
                json={"id": model_id},
                headers=self._localai_auth_headers(),
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            return self.response(
                200,
                result={
                    "uuid": data.get("uuid", ""),
                    "status_url": data.get("status", ""),
                },
            )
        except Exception as ex:  # pylint: disable=broad-except
            return self.response(400, message=f"Install request failed: {ex}")

    @expose("/localai/models/jobs/<string:job_uuid>", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def localai_job_progress(self, job_uuid: str) -> Any:
        """Poll the download progress of a LocalAI model install job."""
        base_url = self._localai_base_url()
        if not base_url:
            return self.response(
                400, message="LocalAI provider is not configured"
            )
        try:
            resp = http_requests.get(
                f"{base_url}/models/jobs/{job_uuid}",
                headers=self._localai_auth_headers(),
                timeout=5,
            )
            resp.raise_for_status()
            data = resp.json()
            return self.response(
                200,
                result={
                    "uuid": job_uuid,
                    "processed": data.get("processed", False),
                    "progress": round(data.get("progress", 0), 1),
                    "file_size": data.get("file_size", ""),
                    "downloaded_size": data.get("downloaded_size", ""),
                    "message": data.get("message", ""),
                    "error": data.get("error"),
                },
            )
        except Exception as ex:  # pylint: disable=broad-except
            return self.response(
                400, message=f"Cannot check job status: {ex}"
            )

    @expose("/localai/models/<string:model_id>", methods=("DELETE",))
    @protect()
    @safe
    @permission_name("write")
    def localai_delete_model(self, model_id: str) -> Any:
        """Delete a model from the running LocalAI instance."""
        entry = next(
            (
                item
                for item in LOCALAI_TEXT_MODEL_CATALOG
                if str(item.get("id") or "") == model_id
            ),
            None,
        )
        if entry and self._is_repo_managed_localai_model(entry):
            removed = self._remove_repo_managed_localai_model(model_id)
            return self.response(
                200,
                result={
                    "deleted": model_id,
                    "removed_files": removed["removed_files"],
                },
            )
        base_url = self._localai_base_url()
        if not base_url:
            return self.response(
                400, message="LocalAI provider is not configured"
            )
        try:
            resp = http_requests.delete(
                f"{base_url}/v1/models/{model_id}",
                headers=self._localai_auth_headers(),
                timeout=10,
            )
            if resp.status_code in (200, 204):
                return self.response(200, result={"deleted": model_id})
            return self.response(
                400,
                message=f"LocalAI returned {resp.status_code}: {resp.text[:200]}",
            )
        except Exception as ex:  # pylint: disable=broad-except
            return self.response(400, message=f"Delete failed: {ex}")

    # ── Fine-Tuning Pipeline ──────────────────────────────────────────────

    @staticmethod
    def _finetune_dir() -> Path:
        return Path(__file__).resolve().parents[2] / "localai" / "finetune"

    @staticmethod
    def _training_data_path() -> Path:
        return (
            Path(__file__).resolve().parents[2]
            / "localai"
            / "training"
            / "ai-insights-training-data.jsonl"
        )

    @expose("/localai/training/status", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def localai_training_status(self) -> Any:
        """Return training pipeline status: data stats, scripts present, output state."""
        finetune_dir = self._finetune_dir()
        training_data = self._training_data_path()
        output_dir = finetune_dir / "output"

        # Training data stats
        data_stats: dict[str, Any] = {"exists": False, "examples": 0}
        if training_data.exists():
            line_count = sum(1 for line in training_data.open() if line.strip())
            data_stats = {"exists": True, "examples": line_count, "path": str(training_data)}

        # Pipeline scripts
        scripts = {
            "pipeline_sh": (finetune_dir / "pipeline.sh").exists(),
            "prepare_data_py": (finetune_dir / "prepare_data.py").exists(),
            "train_py": (finetune_dir / "train.py").exists(),
            "merge_and_export_py": (finetune_dir / "merge_and_export.py").exists(),
            "evaluate_py": (finetune_dir / "evaluate.py").exists(),
            "config_yaml": (finetune_dir / "config.yaml").exists(),
            "requirements_txt": (finetune_dir / "requirements.txt").exists(),
        }

        # Output artifacts
        artifacts: dict[str, Any] = {"has_adapter": False, "has_gguf": False}
        adapter_dir = output_dir / "adapter"
        gguf_dir = output_dir / "gguf"
        if adapter_dir.exists():
            adapter_files = list(adapter_dir.glob("*"))
            artifacts["has_adapter"] = len(adapter_files) > 0
            artifacts["adapter_files"] = len(adapter_files)
        if gguf_dir.exists():
            gguf_files = list(gguf_dir.glob("*.gguf"))
            artifacts["has_gguf"] = len(gguf_files) > 0
            artifacts["gguf_files"] = [
                {"name": f.name, "size": self._format_bytes(f.stat().st_size)}
                for f in gguf_files
            ]

        # Evaluation results
        eval_files = list(output_dir.glob("eval_*.json")) if output_dir.exists() else []
        evaluations = []
        for ef in eval_files:
            try:
                import json as json_mod
                data = json_mod.loads(ef.read_text())
                evaluations.append({
                    "file": ef.name,
                    "model": data.get("model", ""),
                    "overall_score": data.get("overall_score", 0),
                    "category_scores": data.get("category_scores", {}),
                })
            except Exception:
                pass

        # Training metadata
        meta_path = output_dir / "training_meta.json"
        training_meta = None
        if meta_path.exists():
            try:
                import json as json_mod
                training_meta = json_mod.loads(meta_path.read_text())
            except Exception:
                pass

        return self.response(200, result={
            "training_data": data_stats,
            "scripts": scripts,
            "all_scripts_present": all(scripts.values()),
            "artifacts": artifacts,
            "evaluations": evaluations,
            "training_meta": training_meta,
            "finetune_dir": str(finetune_dir),
        })

    @expose("/localai/training/evaluate", methods=("POST",))
    @protect()
    @safe
    @permission_name("write")
    def localai_training_evaluate(self) -> Any:
        """Run the evaluation benchmark suite against the current model."""
        body = request.json or {}
        model_id = str(body.get("model_id", LOCALAI_DEFAULT_MODEL_ID)).strip()
        base_only = bool(body.get("base_only", False))

        finetune_dir = self._finetune_dir()
        eval_script = finetune_dir / "evaluate.py"
        config_file = finetune_dir / "config.yaml"

        if not eval_script.exists():
            return self.response(400, message="Evaluation script not found. Run pipeline setup first.")

        cmd = [
            "python3", str(eval_script),
            "--config", str(config_file),
            "--model", model_id,
        ]
        if base_only:
            cmd.append("--base-only")

        # Pass API key via environment
        env = dict(os.environ)
        secret = None
        config = get_ai_insights_config()
        providers = config.get("providers") or {}
        localai = providers.get("localai") or {}
        from superset.ai_insights.config import resolve_provider_secret
        secret = resolve_provider_secret(localai)
        if secret:
            env["LOCALAI_API_KEY"] = secret
            cmd.extend(["--api-key", secret])

        try:
            completed = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=600,
                cwd=str(finetune_dir.parents[1]),
                env=env,
            )

            # Try to read the evaluation report
            output_dir = finetune_dir / "output"
            eval_file = output_dir / f"eval_{model_id.replace('/', '_')}.json"
            eval_result = None
            if eval_file.exists():
                try:
                    import json as json_mod
                    eval_result = json_mod.loads(eval_file.read_text())
                except Exception:
                    pass

            return self.response(200, result={
                "returncode": completed.returncode,
                "stdout": self._trim_output(completed.stdout),
                "stderr": self._trim_output(completed.stderr),
                "evaluation": eval_result,
                "model_id": model_id,
            })
        except subprocess.TimeoutExpired:
            return self.response(400, message="Evaluation timed out (10 minutes)")
        except Exception as ex:
            return self.response_500(message=str(ex))

    @expose("/localai/training/prepare", methods=("POST",))
    @protect()
    @safe
    @permission_name("write")
    def localai_training_prepare(self) -> Any:
        """Run data preparation: validate, split, generate stats."""
        finetune_dir = self._finetune_dir()
        prepare_script = finetune_dir / "prepare_data.py"
        config_file = finetune_dir / "config.yaml"

        if not prepare_script.exists():
            return self.response(400, message="Prepare script not found.")

        try:
            completed = subprocess.run(
                ["python3", str(prepare_script), "--config", str(config_file)],
                capture_output=True,
                text=True,
                check=False,
                timeout=120,
                cwd=str(finetune_dir.parents[1]),
            )
            return self.response(200, result={
                "returncode": completed.returncode,
                "stdout": self._trim_output(completed.stdout),
                "stderr": self._trim_output(completed.stderr),
            })
        except Exception as ex:
            return self.response_500(message=str(ex))

    @staticmethod
    def _localai_health_check(base_url: str) -> bool:
        try:
            resp = http_requests.get(f"{base_url}/readyz", timeout=3)
            return resp.status_code == 200
        except Exception:  # pylint: disable=broad-except
            return False
