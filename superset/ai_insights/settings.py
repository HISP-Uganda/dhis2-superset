from __future__ import annotations

import json
import logging
import os
import secrets
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from flask_appbuilder.security.sqla.models import Role
from sqlalchemy.orm import defer

from superset import db, is_feature_enabled
from superset.constants import PASSWORD_MASK
from superset.extensions import encrypted_field_factory

logger = logging.getLogger(__name__)

AI_INSIGHTS_FEATURE_FLAG = "AI_INSIGHTS"
LOCALAI_API_KEY_ENV_NAME = "LOCALAI_API_KEY"
LOCALAI_API_KEY_ENV_VAR = "LOCALAI_API_KEY_ENV"
LOCALAI_BASE_URL_ENV_VAR = "LOCALAI_BASE_URL"
LOCALAI_EXTERNAL_BACKENDS_ENV_VAR = "LOCALAI_EXTERNAL_BACKENDS"
LOCALAI_DEFAULT_EXTERNAL_BACKENDS = "llama-cpp"

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
    # Based on Anthropic's official Claude model catalog.
    # https://docs.anthropic.com/en/docs/about-claude/models
    # https://platform.claude.com/docs/en/home
    {
        "id": "claude-opus-4-6",
        "label": "Claude Opus 4.6",
        "group": "Frontier",
        "description": "Anthropic's most capable model. Best for complex analysis, multi-step reasoning, and executive insights.",
        "is_latest": True,
        "is_recommended": True,
    },
    {
        "id": "claude-sonnet-4-6",
        "label": "Claude Sonnet 4.6",
        "group": "Balanced",
        "description": "High-performance Claude with excellent reasoning and faster output. Great balance of quality and speed.",
    },
    {
        "id": "claude-opus-4-1-20250805",
        "label": "Claude Opus 4.1",
        "group": "Frontier",
        "description": "Previous frontier Claude model for complex reasoning and coding.",
    },
    {
        "id": "claude-sonnet-4-20250514",
        "label": "Claude Sonnet 4",
        "group": "Balanced",
        "description": "Strong Claude model with good reasoning for interactive insights.",
    },
    {
        "id": "claude-opus-4-20250514",
        "label": "Claude Opus 4",
        "group": "Frontier",
        "description": "Earlier Claude 4 frontier model for demanding analysis tasks.",
    },
    {
        "id": "claude-haiku-4-5-20251001",
        "label": "Claude Haiku 4.5",
        "group": "Fast",
        "description": "Fast, cost-efficient Claude model for lighter insight tasks and high-volume use.",
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

LOCALAI_DEFAULT_MODEL_ID = "ai-insights-model-26.04"

LOCALAI_SUPERSET_CAPABILITIES: list[str] = [
    "Natural-language analytics chat",
    "Superset MCP/API control",
    "SQL generation and repair",
    "Chart recommendation and chart-spec generation",
    "Dashboard composition and layout planning",
    "Vision-based chart and dashboard analysis",
    "Structured JSON outputs",
    "Semantic retrieval and metric glossary grounding",
    "Narrative insight generation",
    "Dashboard QA and critique",
    "Scheduled insight reporting",
    "CSV, image, PDF, DOCX, PPTX, and asset export orchestration",
]

LOCALAI_TEXT_MODEL_CATALOG: list[dict[str, Any]] = [
    # Recommended models for Superset AI Insights on LocalAI.
    # These match the gallery IDs from https://models.localai.io
    # Users can override via LOCALAI_MODELS env var or AI Management UI.
    {
        "id": LOCALAI_DEFAULT_MODEL_ID,
        "label": "AI Insights Model 26.04",
        "group": "Custom",
        "description": "Purpose-built model for Superset analytics copilot workflows. Optimized for professional chart and dashboard interpretation, SQL reasoning, structured outputs, reporting, and export-oriented narrative generation.",
        "file_size": "4.6 GB",
        "is_latest": True,
        "is_recommended": True,
        "is_repo_managed": True,
        "capabilities": LOCALAI_SUPERSET_CAPABILITIES,
        "base_model_gguf": "hermes-3-llama-3.1-8b-lorablated.Q4_K_M.gguf",
        "base_model_url": "https://huggingface.co/mlabonne/Hermes-3-Llama-3.1-8B-lorablated-GGUF/resolve/main/hermes-3-llama-3.1-8b-lorablated.Q4_K_M.gguf",
    },
    {
        "id": "hermes-3-llama-3.1-8b-lorablated",
        "label": "Hermes 3 LLaMA 3.1 8B",
        "group": "General",
        "description": "Best general-purpose model for chart and dashboard narrative insights. 4.6 GB.",
        "file_size": "4.6 GB",
        "capabilities": [
            "Narrative chart and dashboard summarization",
            "General-purpose analytics chat",
            "Executive-style insight writing",
        ],
    },
    {
        "id": "deepseek-r1-distill-qwen-7b",
        "label": "DeepSeek R1 Distill Qwen 7B",
        "group": "Reasoning",
        "description": "Reasoning-optimised model for SQL generation and deep analytics. 4.7 GB.",
        "file_size": "4.7 GB",
        "capabilities": [
            "SQL generation and repair",
            "Multi-step reasoning",
            "Complex dashboard decomposition",
        ],
    },
    {
        "id": "qwen3-8b",
        "label": "Qwen 3 8B",
        "group": "General",
        "description": "Strong multilingual model with excellent structured output and table formatting.",
        "capabilities": [
            "Structured JSON outputs",
            "Table and report formatting",
            "Multilingual analytics assistance",
        ],
    },
    {
        "id": "meta-llama-3.1-8b-instruct",
        "label": "LLaMA 3.1 8B Instruct",
        "group": "General",
        "description": "Meta LLaMA 3.1 8B — reliable general-purpose local model.",
        "capabilities": [
            "General analytics chat",
            "Chart narrative generation",
            "Dataset and metric explanation",
        ],
    },
    {
        "id": "gemma-3-4b-it",
        "label": "Gemma 3 4B IT",
        "group": "Compact",
        "description": "Google Gemma 3 4B — small but capable model for lightweight tasks. 2.3 GB.",
        "file_size": "2.3 GB",
        "capabilities": [
            "Lightweight local analysis",
            "Fast classification and summaries",
            "Compact deployment footprint",
        ],
    },
    {
        "id": "qwen3.5-4b",
        "label": "Qwen 3.5 4B",
        "group": "Compact",
        "description": "Compact Qwen model for fast, cost-free local insights.",
        "capabilities": [
            "Fast local summaries",
            "Structured output generation",
            "Low-resource analytics support",
        ],
    },
    {
        "id": "deepseek-r1-distill-qwen-14b",
        "label": "DeepSeek R1 Distill Qwen 14B",
        "group": "Reasoning",
        "description": "Larger reasoning model for complex multi-chart dashboard analysis. 8.7 GB.",
        "file_size": "8.7 GB",
        "capabilities": [
            "Advanced reasoning",
            "Cross-chart anomaly analysis",
            "Long-form investigative insights",
        ],
    },
]

MODEL_CATALOGS: dict[str, list[dict[str, Any]]] = {
    "anthropic_text": ANTHROPIC_TEXT_MODEL_CATALOG,
    "deepseek_text": DEEPSEEK_TEXT_MODEL_CATALOG,
    "gemini_text": GEMINI_TEXT_MODEL_CATALOG,
    "localai_text": LOCALAI_TEXT_MODEL_CATALOG,
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
        "description": "Official Anthropic Messages API for Claude models (platform.claude.com).",
        "catalog_key": "anthropic_text",
        "default_base_url": "https://api.anthropic.com",
        "default_model": "claude-sonnet-4-6",
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
        "id": "localai",
        "provider_type": "localai",
        "label": "LocalAI",
        "description": "OpenAI-compatible local inference server (localai.io) for self-hosted models.",
        "catalog_key": "localai_text",
        "default_base_url": "http://127.0.0.1:39671",
        "default_model": LOCALAI_DEFAULT_MODEL_ID,
        "is_local": True,
        "supports_base_url": True,
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
    "localai": "localai_text",
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


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _project_env_path() -> Path:
    override = os.environ.get("SUPERSET_PROJECT_ENV_FILE")
    if override:
        return Path(override).expanduser()
    return _repo_root() / ".env"


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'").strip('"')
    return values


def _write_env_file_updates(path: Path, updates: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    indexes: dict[str, int] = {}
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _ = stripped.split("=", 1)
        indexes[key.strip()] = idx

    for key, value in updates.items():
        rendered = f"{key}={value}"
        if key in indexes:
            lines[indexes[key]] = rendered
        else:
            lines.append(rendered)

    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


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

    if provider_id == "localai":
        provider.setdefault(
            "api_key_env",
            os.environ.get(LOCALAI_API_KEY_ENV_VAR, LOCALAI_API_KEY_ENV_NAME),
        )

    provider["models"] = _normalize_string_list(provider.get("models"))
    default_model = str(provider.get("default_model") or "").strip()
    if default_model and default_model not in provider["models"]:
        provider["models"].insert(0, default_model)
    if not provider["default_model"] and provider["models"]:
        provider["default_model"] = provider["models"][0]
    provider["enabled"] = bool(provider.get("enabled"))
    return provider


def ensure_localai_environment(*, write_env_file: bool = True) -> dict[str, str]:
    env_path = _project_env_path()
    env_file_values = _read_env_file(env_path)
    api_key_env = (
        os.environ.get(LOCALAI_API_KEY_ENV_VAR)
        or env_file_values.get(LOCALAI_API_KEY_ENV_VAR)
        or LOCALAI_API_KEY_ENV_NAME
    ).strip() or LOCALAI_API_KEY_ENV_NAME
    api_key = (
        os.environ.get(api_key_env)
        or env_file_values.get(api_key_env)
        or f"sk-localai-{secrets.token_urlsafe(32)}"
    ).strip()
    base_url = (
        os.environ.get(LOCALAI_BASE_URL_ENV_VAR)
        or env_file_values.get(LOCALAI_BASE_URL_ENV_VAR)
        or "http://127.0.0.1:39671"
    ).strip()
    default_model = (
        os.environ.get("LOCALAI_DEFAULT_MODEL")
        or env_file_values.get("LOCALAI_DEFAULT_MODEL")
        or LOCALAI_DEFAULT_MODEL_ID
    ).strip()
    model_ids = ",".join(_catalog_models("localai_text") or [LOCALAI_DEFAULT_MODEL_ID])
    models = (
        os.environ.get("LOCALAI_MODELS")
        or env_file_values.get("LOCALAI_MODELS")
        or model_ids
    ).strip()
    external_backends = (
        os.environ.get(LOCALAI_EXTERNAL_BACKENDS_ENV_VAR)
        or env_file_values.get(LOCALAI_EXTERNAL_BACKENDS_ENV_VAR)
        or LOCALAI_DEFAULT_EXTERNAL_BACKENDS
    ).strip()

    os.environ[LOCALAI_API_KEY_ENV_VAR] = api_key_env
    os.environ[api_key_env] = api_key
    os.environ[LOCALAI_BASE_URL_ENV_VAR] = base_url
    os.environ["LOCALAI_DEFAULT_MODEL"] = default_model
    os.environ["LOCALAI_MODELS"] = models
    os.environ[LOCALAI_EXTERNAL_BACKENDS_ENV_VAR] = external_backends

    if write_env_file:
        _write_env_file_updates(
            env_path,
            {
                LOCALAI_API_KEY_ENV_VAR: api_key_env,
                api_key_env: api_key,
                LOCALAI_BASE_URL_ENV_VAR: base_url,
                "LOCALAI_DEFAULT_MODEL": default_model,
                "LOCALAI_MODELS": models,
                LOCALAI_EXTERNAL_BACKENDS_ENV_VAR: external_backends,
            },
        )

    return {
        "api_key_env": api_key_env,
        "api_key": api_key,
        "base_url": base_url,
        "default_model": default_model,
        "models": models,
        "external_backends": external_backends,
        "env_path": str(env_path),
    }


def apply_localai_recommended_defaults(config: dict[str, Any] | None) -> dict[str, Any]:
    normalized = deepcopy(config or {})
    providers = normalized.setdefault("providers", {})
    localai_env = ensure_localai_environment(write_env_file=False)

    raw_localai = providers.get("localai")
    existing_localai = raw_localai if isinstance(raw_localai, dict) else None
    localai = _ensure_provider_defaults("localai", existing_localai)

    if existing_localai is None or "enabled" not in existing_localai:
        localai["enabled"] = True

    models = [model for model in localai.get("models") or [] if model != LOCALAI_DEFAULT_MODEL_ID]
    localai["models"] = [LOCALAI_DEFAULT_MODEL_ID, *models]
    localai["api_key_env"] = localai_env["api_key_env"]
    localai["base_url"] = str(localai.get("base_url") or localai_env["base_url"]).strip()

    if not str(localai.get("default_model") or "").strip():
        localai["default_model"] = LOCALAI_DEFAULT_MODEL_ID

    providers["localai"] = localai

    if not str(normalized.get("default_provider") or "").strip():
        normalized["default_provider"] = "localai"
        normalized["default_model"] = LOCALAI_DEFAULT_MODEL_ID
    elif normalized.get("default_provider") == "localai" and not str(
        normalized.get("default_model") or ""
    ).strip():
        normalized["default_model"] = LOCALAI_DEFAULT_MODEL_ID

    return normalized


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

    def get_config_safe(self) -> dict[str, Any]:
        try:
            return self.get_config()
        except Exception:  # pylint: disable=broad-except
            db.session.rollback()
            logger.warning("Unable to load AI insights config_json; using defaults")
            return {}

    def set_config(self, config: dict[str, Any]) -> None:
        self.config_json = _json_dumps(config)

    def get_secrets(self) -> dict[str, Any]:
        return _json_loads(self.encrypted_secrets)

    def get_secrets_safe(self) -> dict[str, Any]:
        try:
            return self.get_secrets()
        except Exception:  # pylint: disable=broad-except
            db.session.rollback()
            logger.warning(
                "Unable to decrypt AI insights secrets; treating stored secrets as empty",
                exc_info=True,
            )
            return {}

    def set_secrets(self, secrets: dict[str, Any]) -> None:
        self.encrypted_secrets = _json_dumps(secrets)

    @classmethod
    def get(cls) -> "AIInsightsSettings | None":
        try:
            row = (
                db.session.query(cls)
                .options(defer(cls.encrypted_secrets))
                .filter_by(id=1)
                .one_or_none()
            )
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

    config = row.get_config_safe()
    secrets = row.get_secrets_safe()
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
        existing_secrets=row.get_secrets_safe() if row else None,
    )
    row.set_config(normalized)
    row.set_secrets(secrets)
    db.session.commit()
    return build_ai_management_payload()
