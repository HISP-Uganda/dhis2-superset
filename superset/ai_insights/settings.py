from __future__ import annotations

import json
import logging
from copy import deepcopy
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from flask_appbuilder.security.sqla.models import Role

from superset import db, is_feature_enabled
from superset.constants import PASSWORD_MASK
from superset.extensions import encrypted_field_factory

logger = logging.getLogger(__name__)

AI_INSIGHTS_FEATURE_FLAG = "AI_INSIGHTS"

OPENAI_TEXT_MODEL_CATALOG: list[dict[str, Any]] = [
    # Based on OpenAI's official Models and All models catalog as of 2026-03-29.
    # https://developers.openai.com/api/docs/models
    # https://developers.openai.com/api/docs/models/all
    {
        "id": "gpt-5.4",
        "label": "GPT-5.4",
        "group": "Frontier",
        "description": "Flagship model for complex reasoning, coding, and professional workflows.",
        "is_latest": True,
        "is_recommended": True,
    },
    {
        "id": "gpt-5.4-pro",
        "label": "GPT-5.4 Pro",
        "group": "Frontier",
        "description": "Higher-precision GPT-5.4 variant for demanding tasks.",
    },
    {
        "id": "gpt-5.4-mini",
        "label": "GPT-5.4 Mini",
        "group": "Frontier",
        "description": "Stronger mini model for coding, computer use, and sub-agents.",
    },
    {
        "id": "gpt-5.4-nano",
        "label": "GPT-5.4 Nano",
        "group": "Frontier",
        "description": "Lowest-cost GPT-5.4-class model for simple high-volume work.",
    },
    {
        "id": "gpt-5-mini",
        "label": "GPT-5 Mini",
        "group": "Frontier",
        "description": "Near-frontier model for lower-latency and cost-sensitive workloads.",
    },
    {
        "id": "gpt-5-nano",
        "label": "GPT-5 Nano",
        "group": "Frontier",
        "description": "Fastest and most cost-efficient GPT-5 variant.",
    },
    {
        "id": "gpt-5",
        "label": "GPT-5",
        "group": "Frontier",
        "description": "Reasoning model for coding and agentic tasks with configurable reasoning effort.",
    },
    {
        "id": "gpt-5-pro",
        "label": "GPT-5 Pro",
        "group": "Reasoning",
        "description": "Higher-compute GPT-5 variant for precision-heavy work.",
    },
    {
        "id": "gpt-5.2",
        "label": "GPT-5.2",
        "group": "Reasoning",
        "description": "Previous frontier model for professional work.",
    },
    {
        "id": "gpt-5.2-pro",
        "label": "GPT-5.2 Pro",
        "group": "Reasoning",
        "description": "Higher-compute GPT-5.2 professional model.",
    },
    {
        "id": "gpt-5.1",
        "label": "GPT-5.1",
        "group": "Reasoning",
        "description": "Strong model for coding and agentic tasks with configurable reasoning effort.",
    },
    {
        "id": "o3-pro",
        "label": "o3 Pro",
        "group": "Reasoning",
        "description": "Higher-compute o3 model for better responses.",
    },
    {
        "id": "o3",
        "label": "o3",
        "group": "Reasoning",
        "description": "Reasoning model for complex tasks.",
    },
    {
        "id": "o4-mini",
        "label": "o4-mini",
        "group": "Reasoning",
        "description": "Fast, cost-efficient reasoning model.",
    },
    {
        "id": "o3-mini",
        "label": "o3-mini",
        "group": "Reasoning",
        "description": "Small reasoning alternative to o3.",
    },
    {
        "id": "gpt-4.1",
        "label": "GPT-4.1",
        "group": "Balanced",
        "description": "High-capability non-reasoning model.",
    },
    {
        "id": "gpt-4.1-mini",
        "label": "GPT-4.1 Mini",
        "group": "Balanced",
        "description": "Smaller and faster GPT-4.1 variant.",
    },
    {
        "id": "gpt-4.1-nano",
        "label": "GPT-4.1 Nano",
        "group": "Balanced",
        "description": "Lowest-cost GPT-4.1 variant.",
    },
    {
        "id": "gpt-4o",
        "label": "GPT-4o",
        "group": "Balanced",
        "description": "Fast and flexible GPT model.",
    },
    {
        "id": "gpt-4o-mini",
        "label": "GPT-4o Mini",
        "group": "Balanced",
        "description": "Affordable small GPT-4o variant.",
    },
    {
        "id": "gpt-4o-search-preview",
        "label": "GPT-4o Search Preview",
        "group": "Preview",
        "description": "GPT model optimized for web search in Chat Completions.",
    },
    {
        "id": "gpt-4o-mini-search-preview",
        "label": "GPT-4o Mini Search Preview",
        "group": "Preview",
        "description": "Small GPT search preview model.",
    },
    {
        "id": "gpt-4.5-preview",
        "label": "GPT-4.5 Preview",
        "group": "Legacy",
        "description": "Deprecated large GPT preview model.",
        "is_deprecated": True,
    },
    {
        "id": "gpt-4-turbo",
        "label": "GPT-4 Turbo",
        "group": "Legacy",
        "description": "Older fast high-intelligence GPT model.",
    },
    {
        "id": "gpt-3.5-turbo",
        "label": "GPT-3.5 Turbo",
        "group": "Legacy",
        "description": "Legacy lower-cost GPT chat model.",
    },
]

GEMINI_TEXT_MODEL_CATALOG: list[dict[str, Any]] = [
    # Based on Google's official Gemini model catalog as of 2026-04.
    # https://ai.google.dev/gemini-api/docs/models
    #
    # ── Gemini 3.x (Preview) ──
    {
        "id": "gemini-3.1-pro-preview",
        "label": "Gemini 3.1 Pro",
        "group": "Frontier",
        "description": "Reasoning-first model for complex agentic workflows, coding, and deep analytics.",
        "is_latest": True,
    },
    {
        "id": "gemini-3-flash-preview",
        "label": "Gemini 3 Flash",
        "group": "Frontier",
        "description": "Best model for complex multimodal understanding and agentic tasks.",
    },
    {
        "id": "gemini-3.1-flash-lite-preview",
        "label": "Gemini 3.1 Flash Lite",
        "group": "Frontier",
        "description": "Most cost-efficient Gemini 3 model for high-volume, low-latency tasks.",
    },
    #
    # ── Gemini 2.5 (Stable) ──
    {
        "id": "gemini-2.5-pro",
        "label": "Gemini 2.5 Pro",
        "group": "Reasoning",
        "description": "Thinking model for complex analytics, code, and large-context reasoning.",
    },
    {
        "id": "gemini-2.5-flash",
        "label": "Gemini 2.5 Flash",
        "group": "Balanced",
        "description": "Best price-performance Gemini model for fast chart and dashboard insights.",
        "is_recommended": True,
    },
    {
        "id": "gemini-2.5-flash-lite",
        "label": "Gemini 2.5 Flash Lite",
        "group": "Balanced",
        "description": "Lowest-cost stable Gemini model for high-volume workloads.",
    },
    #
    # ── Gemini 2.0 ──
    {
        "id": "gemini-2.0-flash",
        "label": "Gemini 2.0 Flash",
        "group": "Fast",
        "description": "Fast Gemini 2.0 model with multimodal capabilities and tool use.",
    },
    {
        "id": "gemini-2.0-flash-lite",
        "label": "Gemini 2.0 Flash Lite",
        "group": "Fast",
        "description": "Cost-efficient Gemini 2.0 model for high-throughput tasks.",
    },
    #
    # ── Gemini 1.5 (Legacy) ──
    {
        "id": "gemini-1.5-pro",
        "label": "Gemini 1.5 Pro",
        "group": "Legacy",
        "description": "Previous-generation Gemini model with 2M token context window.",
    },
    {
        "id": "gemini-1.5-flash",
        "label": "Gemini 1.5 Flash",
        "group": "Legacy",
        "description": "Previous-generation fast Gemini model for lighter workloads.",
    },
]

ANTHROPIC_TEXT_MODEL_CATALOG: list[dict[str, Any]] = [
    # Based on Anthropic's official Claude model overview as of 2026-03-29.
    # https://docs.anthropic.com/en/docs/about-claude/models/overview
    {
        "id": "claude-opus-4-1-20250805",
        "label": "Claude Opus 4.1",
        "group": "Frontier",
        "description": "Anthropic's most capable Claude model for complex reasoning and coding.",
        "is_latest": True,
    },
    {
        "id": "claude-sonnet-4-20250514",
        "label": "Claude Sonnet 4",
        "group": "Balanced",
        "description": "High-performance Claude model with strong reasoning and better latency for interactive insights.",
        "is_recommended": True,
    },
    {
        "id": "claude-opus-4-20250514",
        "label": "Claude Opus 4",
        "group": "Frontier",
        "description": "Earlier Claude 4 frontier model for demanding analysis tasks.",
    },
    {
        "id": "claude-3-7-sonnet-20250219",
        "label": "Claude 3.7 Sonnet",
        "group": "Balanced",
        "description": "Previous strong Claude model with hybrid reasoning.",
    },
    {
        "id": "claude-3-5-haiku-20241022",
        "label": "Claude 3.5 Haiku",
        "group": "Fast",
        "description": "Fast lower-latency Claude model for lighter MART insight tasks.",
    },
]

DEEPSEEK_TEXT_MODEL_CATALOG: list[dict[str, Any]] = [
    # Based on DeepSeek's official API docs as of 2026-03-29.
    # https://api-docs.deepseek.com/
    {
        "id": "deepseek-reasoner",
        "label": "DeepSeek Reasoner",
        "group": "Reasoning",
        "description": "Reasoning-optimized DeepSeek model for SQL generation and deeper MART analysis.",
        "is_latest": True,
        "is_recommended": True,
    },
    {
        "id": "deepseek-chat",
        "label": "DeepSeek Chat",
        "group": "Balanced",
        "description": "Fast DeepSeek general model for chart and dashboard narrative insights.",
    },
]

MODEL_CATALOGS: dict[str, list[dict[str, Any]]] = {
    "anthropic_text": ANTHROPIC_TEXT_MODEL_CATALOG,
    "deepseek_text": DEEPSEEK_TEXT_MODEL_CATALOG,
    "gemini_text": GEMINI_TEXT_MODEL_CATALOG,
    "openai_text": OPENAI_TEXT_MODEL_CATALOG,
    "mock": [
        {
            "id": "mock-1",
            "label": "Mock 1",
            "group": "Testing",
            "description": "Deterministic mock provider for development and tests.",
            "is_recommended": True,
        }
    ],
}

PROVIDER_PRESETS: list[dict[str, Any]] = [
    {
        "id": "openai",
        "provider_type": "openai",
        "label": "OpenAI Cloud",
        "description": "Hosted OpenAI API with the official current model catalog.",
        "catalog_key": "openai_text",
        "default_base_url": "https://api.openai.com/v1",
        "default_model": "gpt-5.4",
        "is_local": False,
        "supports_base_url": False,
        "supports_api_key": True,
        "supports_api_key_env": True,
    },
    {
        "id": "openai_compatible",
        "provider_type": "openai_compatible",
        "label": "OpenAI-Compatible Endpoint",
        "description": "Custom endpoint that implements the OpenAI chat-completions contract.",
        "catalog_key": "openai_text",
        "default_base_url": "",
        "default_model": "gpt-5.4",
        "is_local": False,
        "supports_base_url": True,
        "supports_api_key": True,
        "supports_api_key_env": True,
    },
    {
        "id": "gemini",
        "provider_type": "gemini",
        "label": "Google Gemini",
        "description": "Official Gemini API using Google's native generateContent endpoint.",
        "catalog_key": "gemini_text",
        "default_base_url": "https://generativelanguage.googleapis.com",
        "default_model": "gemini-2.5-flash",
        "is_local": False,
        "supports_base_url": False,
        "supports_api_key": True,
        "supports_api_key_env": True,
    },
    {
        "id": "anthropic",
        "provider_type": "anthropic",
        "label": "Anthropic Claude",
        "description": "Official Anthropic Messages API for Claude models.",
        "catalog_key": "anthropic_text",
        "default_base_url": "https://api.anthropic.com",
        "default_model": "claude-sonnet-4-20250514",
        "is_local": False,
        "supports_base_url": False,
        "supports_api_key": True,
        "supports_api_key_env": True,
    },
    {
        "id": "deepseek",
        "provider_type": "deepseek",
        "label": "DeepSeek",
        "description": "Official DeepSeek API using the OpenAI-compatible chat-completions endpoint.",
        "catalog_key": "deepseek_text",
        "default_base_url": "https://api.deepseek.com",
        "default_model": "deepseek-reasoner",
        "is_local": False,
        "supports_base_url": False,
        "supports_api_key": True,
        "supports_api_key_env": True,
    },
    {
        "id": "ollama",
        "provider_type": "ollama",
        "label": "Ollama",
        "description": "Local model runtime for self-hosted AI testing and offline use.",
        "catalog_key": None,
        "default_base_url": "http://127.0.0.1:11434",
        "default_model": "llama3.1:8b",
        "is_local": True,
        "supports_base_url": True,
        "supports_api_key": False,
        "supports_api_key_env": False,
    },
    {
        "id": "mock",
        "provider_type": "mock",
        "label": "Mock / Test",
        "description": "Deterministic provider for validation, demos, and test environments.",
        "catalog_key": "mock",
        "default_base_url": None,
        "default_model": "mock-1",
        "is_local": True,
        "supports_base_url": False,
        "supports_api_key": False,
        "supports_api_key_env": False,
    },
]

PROVIDER_PRESET_MAP = {preset["id"]: preset for preset in PROVIDER_PRESETS}
PROVIDER_RUNTIME_FIELDS = {
    "enabled",
    "type",
    "label",
    "base_url",
    "api_key",
    "api_key_env",
    "organization_id",
    "models",
    "default_model",
    "is_local",
}

PROVIDER_TYPE_TO_CATALOG_KEY = {
    "anthropic": "anthropic_text",
    "deepseek": "deepseek_text",
    "gemini": "gemini_text",
    "mock": "mock",
    "openai": "openai_text",
    "openai_compatible": "openai_text",
}


def _json_loads(value: str | None) -> dict[str, Any]:
    try:
        return json.loads(value or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}


def _json_dumps(value: dict[str, Any]) -> str:
    return json.dumps(value, sort_keys=True)


def _normalize_string_list(values: list[Any] | None) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for value in values or []:
        item = str(value or "").strip()
        if not item or item in seen:
            continue
        normalized.append(item)
        seen.add(item)
    return normalized


def _catalog_models(catalog_key: str | None) -> list[str]:
    if not catalog_key:
        return []
    return [str(item["id"]) for item in MODEL_CATALOGS.get(catalog_key) or []]


def _default_catalog_key_for_provider_type(provider_type: str | None) -> str | None:
    return PROVIDER_TYPE_TO_CATALOG_KEY.get(str(provider_type or "").strip().lower())


def _merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dicts(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def _merge_provider_secrets(
    config: dict[str, Any],
    secrets: dict[str, Any],
) -> dict[str, Any]:
    providers = config.setdefault("providers", {})
    secret_providers = (secrets.get("providers") or {}) if isinstance(secrets, dict) else {}
    for provider_id, provider_secrets in secret_providers.items():
        if not isinstance(provider_secrets, dict):
            continue
        provider = dict(providers.get(provider_id) or {})
        if provider_secrets.get("api_key"):
            provider["api_key"] = str(provider_secrets["api_key"])
        providers[provider_id] = provider
    return config


def _mask_provider_secrets(config: dict[str, Any]) -> dict[str, Any]:
    masked = deepcopy(config)
    providers = masked.setdefault("providers", {})
    for provider in providers.values():
        if not isinstance(provider, dict):
            continue
        has_api_key = bool(provider.get("api_key"))
        if has_api_key:
            provider["api_key"] = PASSWORD_MASK
        provider["has_api_key"] = has_api_key
    return masked


def _ensure_provider_defaults(
    provider_id: str,
    provider_config: dict[str, Any] | None,
) -> dict[str, Any]:
    preset = PROVIDER_PRESET_MAP.get(provider_id)
    provider = deepcopy(provider_config or {})
    if preset:
        provider.setdefault("type", preset["provider_type"])
        provider.setdefault("label", preset["label"])
        if preset.get("default_base_url") is not None:
            provider.setdefault("base_url", preset["default_base_url"])
        provider.setdefault("default_model", preset["default_model"])
        provider.setdefault("is_local", bool(preset["is_local"]))
        catalog_models = _catalog_models(preset.get("catalog_key")) or [
            str(preset["default_model"])
        ]
        if not provider.get("models"):
            provider["models"] = catalog_models
        else:
            # Merge: keep saved models, append any new catalog entries.
            saved_set = set(provider["models"])
            for cid in catalog_models:
                if cid not in saved_set:
                    provider["models"].append(cid)
        provider["catalog_key"] = preset.get("catalog_key")
    else:
        provider.setdefault("type", "openai_compatible")
        provider.setdefault("label", provider_id.replace("_", " ").title())
        provider_type = str(provider.get("type") or "").strip().lower()
        catalog_key = _default_catalog_key_for_provider_type(provider_type)
        provider.setdefault("models", _catalog_models(catalog_key))
        provider.setdefault("is_local", False)
        provider["catalog_key"] = catalog_key

    provider["models"] = _normalize_string_list(provider.get("models"))
    default_model = str(provider.get("default_model") or "").strip()
    if default_model and default_model not in provider["models"]:
        provider["models"].insert(0, default_model)
    if not provider["default_model"] and provider["models"]:
        provider["default_model"] = provider["models"][0]
    provider["enabled"] = bool(provider.get("enabled"))
    return provider


def _normalize_for_storage(
    payload: dict[str, Any],
    *,
    existing_secrets: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    normalized = {
        "enabled": bool(payload.get("enabled")),
        "allow_sql_execution": bool(payload.get("allow_sql_execution")),
        "max_context_rows": int(payload.get("max_context_rows") or 20),
        "max_context_columns": int(payload.get("max_context_columns") or 25),
        "max_dashboard_charts": int(payload.get("max_dashboard_charts") or 12),
        "max_follow_up_messages": int(payload.get("max_follow_up_messages") or 6),
        "max_generated_sql_rows": int(payload.get("max_generated_sql_rows") or 200),
        "request_timeout_seconds": int(payload.get("request_timeout_seconds") or 60),
        "max_tokens": int(payload.get("max_tokens") or 4096),
        "temperature": float(payload.get("temperature") or 0.1),
        "default_provider": str(payload.get("default_provider") or "").strip() or None,
        "default_model": str(payload.get("default_model") or "").strip() or None,
        "allow_public_dashboard_ai": bool(payload.get("allow_public_dashboard_ai")),
        "public_ai_max_tokens": int(payload.get("public_ai_max_tokens") or 2048),
        "public_ai_rate_limit_per_minute": int(
            payload.get("public_ai_rate_limit_per_minute") or 10
        ),
        "allowed_roles": _normalize_string_list(payload.get("allowed_roles")),
        "mode_roles": {
            "chart": _normalize_string_list(
                ((payload.get("mode_roles") or {}).get("chart"))
            ),
            "dashboard": _normalize_string_list(
                ((payload.get("mode_roles") or {}).get("dashboard"))
            ),
            "sql": _normalize_string_list(((payload.get("mode_roles") or {}).get("sql"))),
        },
        "providers": {},
    }

    preserved_secrets = deepcopy(existing_secrets or {})
    preserved_secrets.setdefault("providers", {})

    for provider_id, raw_provider in (payload.get("providers") or {}).items():
        if not isinstance(raw_provider, dict):
            continue
        provider = _ensure_provider_defaults(provider_id, raw_provider)
        cleaned_provider = {
            key: deepcopy(value)
            for key, value in provider.items()
            if key in PROVIDER_RUNTIME_FIELDS
        }
        cleaned_provider["models"] = _normalize_string_list(cleaned_provider.get("models"))
        cleaned_provider["default_model"] = (
            str(cleaned_provider.get("default_model") or "").strip() or None
        )
        api_key = str(raw_provider.get("api_key") or "").strip()
        if api_key and api_key != PASSWORD_MASK:
            preserved_secrets["providers"].setdefault(provider_id, {})["api_key"] = api_key
        elif not api_key and raw_provider.get("clear_api_key"):
            preserved_secrets["providers"].pop(provider_id, None)
            
        cleaned_provider.pop("api_key", None)
        normalized["providers"][provider_id] = cleaned_provider

    if normalized["default_provider"]:
        default_provider = normalized["providers"].get(normalized["default_provider"])
        if default_provider:
            normalized["default_model"] = (
                normalized["default_model"] or default_provider.get("default_model")
            )

    return normalized, preserved_secrets


class AIInsightsSettings(db.Model):  # type: ignore[name-defined]
    __tablename__ = "ai_insights_settings"

    id = sa.Column(sa.Integer, primary_key=True, default=1)
    config_json = sa.Column(sa.Text, nullable=True)
    encrypted_secrets = sa.Column(
        encrypted_field_factory.create(sa.Text),
        nullable=True,
    )
    changed_on = sa.Column(
        sa.DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    def get_config(self) -> dict[str, Any]:
        return _json_loads(self.config_json)

    def set_config(self, config: dict[str, Any]) -> None:
        self.config_json = _json_dumps(config)

    def get_secrets(self) -> dict[str, Any]:
        return _json_loads(self.encrypted_secrets)

    def set_secrets(self, secrets: dict[str, Any]) -> None:
        self.encrypted_secrets = _json_dumps(secrets)

    @classmethod
    def get(cls) -> "AIInsightsSettings | None":
        try:
            row = db.session.get(cls, 1)
        except Exception:  # pylint: disable=broad-except
            db.session.rollback()
            return None

        if row is None:
            try:
                row = cls(id=1)
                db.session.add(row)
                db.session.commit()
            except Exception:  # pylint: disable=broad-except
                db.session.rollback()
                return db.session.get(cls, 1)
        return row


def load_ai_settings_override() -> dict[str, Any]:
    row = AIInsightsSettings.get()
    if row is None:
        return {}

    config = row.get_config()
    secrets = row.get_secrets()
    return _merge_provider_secrets(config, secrets)


def get_provider_presets() -> list[dict[str, Any]]:
    return deepcopy(PROVIDER_PRESETS)


def get_model_catalogs() -> dict[str, list[dict[str, Any]]]:
    return deepcopy(MODEL_CATALOGS)


def get_role_names() -> list[str]:
    try:
        rows = db.session.query(Role.name).order_by(Role.name.asc()).all()
        return [str(row[0]) for row in rows if row and row[0]]
    except Exception:  # pylint: disable=broad-except
        logger.exception("Unable to resolve AI management roles")
        return []


def build_ai_management_payload() -> dict[str, Any]:
    from superset.ai_insights.config import get_ai_insights_config

    effective = _mask_provider_secrets(get_ai_insights_config())
    providers = effective.setdefault("providers", {})
    for preset in PROVIDER_PRESETS:
        providers[preset["id"]] = _ensure_provider_defaults(
            preset["id"],
            providers.get(preset["id"]) or {},
        )
        if providers[preset["id"]].get("has_api_key"):
            providers[preset["id"]]["api_key"] = PASSWORD_MASK
    for provider_id, provider in list(providers.items()):
        if not isinstance(provider, dict):
            providers[provider_id] = _ensure_provider_defaults(provider_id, {})
            continue
        providers[provider_id] = _ensure_provider_defaults(provider_id, provider)
        if provider.get("has_api_key"):
            providers[provider_id]["api_key"] = PASSWORD_MASK

    return {
        "feature_flag_enabled": bool(is_feature_enabled(AI_INSIGHTS_FEATURE_FLAG)),
        "settings": effective,
        "provider_presets": get_provider_presets(),
        "model_catalogs": get_model_catalogs(),
        "role_names": get_role_names(),
    }


def save_ai_management_settings(payload: dict[str, Any]) -> dict[str, Any]:
    row = AIInsightsSettings.get()
    if row is None:
        row = AIInsightsSettings(id=1)
        db.session.add(row)

    normalized, secrets = _normalize_for_storage(
        payload,
        existing_secrets=row.get_secrets() if row else None,
    )
    row.set_config(normalized)
    row.set_secrets(secrets)
    db.session.commit()
    return build_ai_management_payload()
