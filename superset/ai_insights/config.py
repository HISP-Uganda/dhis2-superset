from __future__ import annotations

import os
from copy import deepcopy
from typing import Any

from flask import current_app, g

from superset import is_feature_enabled

AI_INSIGHTS_FEATURE_FLAG = "AI_INSIGHTS"
AI_MODE_CHART = "chart"
AI_MODE_DASHBOARD = "dashboard"
AI_MODE_SQL = "sql"
AI_MODE_PUBLIC_DASHBOARD = "public_dashboard"

DEFAULT_AI_INSIGHTS_CONFIG: dict[str, Any] = {
    "enabled": False,
    "allow_sql_execution": False,
    "max_context_rows": 20,
    "max_context_columns": 25,
    "max_dashboard_charts": 12,
    "max_follow_up_messages": 6,
    "max_generated_sql_rows": 200,
    "request_timeout_seconds": 300,
    "max_tokens": 16384,
    "temperature": 0.1,
    "default_provider": "localai",
    "default_model": "ai-insights-model-26.04",
    "allowed_roles": [],
    "allow_public_dashboard_ai": False,
    "public_ai_max_tokens": 600,
    "public_ai_rate_limit_per_minute": 10,
    "mode_roles": {
        AI_MODE_CHART: [],
        AI_MODE_DASHBOARD: [],
        AI_MODE_SQL: [],
        AI_MODE_PUBLIC_DASHBOARD: [],
    },
    "providers": {
        "localai": {
            "enabled": True,
            "type": "localai",
            "label": "LocalAI",
            "base_url": "http://127.0.0.1:39671",
            "api_key_env": "LOCALAI_API_KEY",
            "models": ["ai-insights-model-26.04"],
            "default_model": "ai-insights-model-26.04",
            "is_local": True,
        },
    },
}


def _merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def get_ai_insights_config() -> dict[str, Any]:
    merged = _merge_dicts(
        DEFAULT_AI_INSIGHTS_CONFIG,
        current_app.config.get("AI_INSIGHTS_CONFIG") or {},
    )
    try:
        from superset.ai_insights.settings import load_ai_settings_override

        merged = _merge_dicts(merged, load_ai_settings_override())
    except Exception:  # pylint: disable=broad-except
        current_app.logger.debug(
            "Falling back to static AI insights config; persisted settings unavailable",
            exc_info=True,
        )

    # Ensure every provider config has models populated from model catalogs
    # so that the capabilities API always returns a usable model list.
    try:
        from superset.ai_insights.settings import (
            _ensure_provider_defaults,
            apply_localai_recommended_defaults,
        )

        merged = apply_localai_recommended_defaults(merged)
        providers = merged.get("providers") or {}
        for pid, pcfg in list(providers.items()):
            if isinstance(pcfg, dict):
                providers[pid] = _ensure_provider_defaults(pid, pcfg)
    except Exception:  # pylint: disable=broad-except
        pass

    return merged


def is_ai_insights_enabled() -> bool:
    config = get_ai_insights_config()
    return bool(config.get("enabled")) and is_feature_enabled(AI_INSIGHTS_FEATURE_FLAG)


def resolve_provider_secret(provider_config: dict[str, Any]) -> str | None:
    if provider_config.get("api_key"):
        return str(provider_config["api_key"])
    env_name = provider_config.get("api_key_env")
    if env_name:
        return os.environ.get(str(env_name)) or os.environ.get(str(env_name).upper())
    return None


def get_mode_allowed_roles(mode: str) -> list[str]:
    config = get_ai_insights_config()
    mode_roles = config.get("mode_roles") or {}
    return list(mode_roles.get(mode) or config.get("allowed_roles") or [])


def user_can_access_ai_mode(mode: str) -> bool:
    if not is_ai_insights_enabled():
        return False

    user = getattr(g, "user", None)

    # Public/guest dashboard AI — allow if configured
    if mode == AI_MODE_PUBLIC_DASHBOARD:
        config = get_ai_insights_config()
        if not config.get("allow_public_dashboard_ai"):
            return False
        # Guest users are treated as authenticated with is_guest_user flag
        if user and getattr(user, "is_guest_user", False):
            return True
        # Also allow if user is fully authenticated
        if user and getattr(user, "is_authenticated", False):
            return True
        return False

    if not user or not getattr(user, "is_authenticated", False):
        return False

    allowed_roles = set(get_mode_allowed_roles(mode))
    if not allowed_roles:
        return True

    user_roles = {role.name for role in getattr(user, "roles", [])}
    return bool(user_roles & allowed_roles)
