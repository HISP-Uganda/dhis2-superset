from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Any

import requests

from superset.ai_insights.config import get_ai_insights_config, resolve_provider_secret

logger = logging.getLogger(__name__)


class AIProviderError(Exception):
    """Raised when a configured provider cannot satisfy a request."""


@dataclass(frozen=True)
class ProviderResponse:
    provider_id: str
    model: str
    text: str
    duration_ms: int


def _normalize_openai_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ).strip()
    return str(content or "")


class BaseProvider:
    provider_type = "base"

    def __init__(self, provider_id: str, config: dict[str, Any]):
        self.provider_id = provider_id
        self.config = config

    @property
    def label(self) -> str:
        return str(self.config.get("label") or self.provider_id)

    @property
    def models(self) -> list[str]:
        return [str(model) for model in self.config.get("models") or []]

    @property
    def default_model(self) -> str | None:
        if self.config.get("default_model"):
            return str(self.config["default_model"])
        return self.models[0] if self.models else None

    @property
    def is_local(self) -> bool:
        return bool(self.config.get("is_local"))

    def is_available(self) -> bool:
        return bool(self.config.get("enabled"))

    def capability(self) -> dict[str, Any]:
        return {
            "id": self.provider_id,
            "label": self.label,
            "models": self.models,
            "default_model": self.default_model,
            "provider_type": self.provider_type,
            "is_local": self.is_local,
            "available": self.is_available(),
        }

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        raise NotImplementedError


class OpenAICompatibleProvider(BaseProvider):
    provider_type = "openai_compatible"

    def is_available(self) -> bool:
        return super().is_available() and bool(self.config.get("base_url"))

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        if not self.is_available():
            raise AIProviderError(f"Provider {self.provider_id} is not configured")

        base_url = str(self.config["base_url"]).rstrip("/")
        selected_model = model or self.default_model
        if not selected_model:
            raise AIProviderError(f"Provider {self.provider_id} has no configured model")

        headers = {"Content-Type": "application/json"}
        if secret := resolve_provider_secret(self.config):
            headers["Authorization"] = f"Bearer {secret}"

        started_at = perf_counter()
        response = requests.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json={
                "model": selected_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        try:
            text = _normalize_openai_message_content(
                payload["choices"][0]["message"]["content"]
            )
        except (KeyError, IndexError, TypeError) as ex:
            raise AIProviderError(
                f"Provider {self.provider_id} returned an unexpected response"
            ) from ex

        return ProviderResponse(
            provider_id=self.provider_id,
            model=selected_model,
            text=text,
            duration_ms=int((perf_counter() - started_at) * 1000),
        )


class OllamaProvider(BaseProvider):
    provider_type = "ollama"

    def is_available(self) -> bool:
        return super().is_available() and bool(self.config.get("base_url"))

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        if not self.is_available():
            raise AIProviderError(f"Provider {self.provider_id} is not configured")

        base_url = str(self.config["base_url"]).rstrip("/")
        selected_model = model or self.default_model
        if not selected_model:
            raise AIProviderError(f"Provider {self.provider_id} has no configured model")

        started_at = perf_counter()
        response = requests.post(
            f"{base_url}/api/chat",
            json={
                "model": selected_model,
                "messages": messages,
                "stream": False,
                "options": {
                    "temperature": temperature,
                    "num_predict": max_tokens,
                },
            },
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        try:
            text = str(payload["message"]["content"])
        except (KeyError, TypeError) as ex:
            raise AIProviderError(
                f"Provider {self.provider_id} returned an unexpected response"
            ) from ex

        return ProviderResponse(
            provider_id=self.provider_id,
            model=selected_model,
            text=text,
            duration_ms=int((perf_counter() - started_at) * 1000),
        )


class MockProvider(BaseProvider):
    provider_type = "mock"

    @staticmethod
    def _resolve_mock_sql_table(messages: list[dict[str, str]]) -> str:
        for message in reversed(messages):
            content = message.get("content", "")
            if not content:
                continue
            try:
                payload = json.loads(content)
            except json.JSONDecodeError:
                continue
            mart_tables = payload.get("mart_tables") or []
            if mart_tables and isinstance(mart_tables, list):
                first_table = mart_tables[0]
                if isinstance(first_table, dict):
                    schema = str(first_table.get("schema") or "").strip()
                    table = str(first_table.get("table") or "").strip()
                    if table:
                        return f"{schema}.{table}" if schema else table
        return "analytics_mart"

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        del timeout, max_tokens, temperature

        selected_model = model or self.default_model or "mock-1"
        combined = "\n".join(message.get("content", "") for message in messages)
        started_at = perf_counter()

        if "Return a strict JSON object" in combined:
            table_name = self._resolve_mock_sql_table(messages)
            text = json.dumps(
                {
                    "sql": f"SELECT * FROM {table_name} LIMIT 100",
                    "explanation": "Reads a MART table with a safe row limit.",
                    "assumptions": ["The MART metadata supplied to the assistant is authoritative."],
                    "follow_ups": ["Add a WHERE clause for a specific period."],
                }
            )
        elif "dashboard context" in combined.lower():
            text = (
                "Dashboard summary: the visible MART-backed charts are grounded in the "
                "current filter state, with notable concentrations called out from the "
                "provided samples."
            )
        else:
            text = (
                "Chart insight: the summary is based only on the supplied chart context "
                "and sampled MART-backed query results."
            )

        return ProviderResponse(
            provider_id=self.provider_id,
            model=selected_model,
            text=text,
            duration_ms=int((perf_counter() - started_at) * 1000),
        )


PROVIDER_TYPES: dict[str, type[BaseProvider]] = {
    "mock": MockProvider,
    "ollama": OllamaProvider,
    "openai_compatible": OpenAICompatibleProvider,
}


class ProviderRegistry:
    def __init__(self) -> None:
        config = get_ai_insights_config()
        provider_configs = config.get("providers") or {}
        self._providers: dict[str, BaseProvider] = {}
        for provider_id, provider_config in provider_configs.items():
            provider_type = str(provider_config.get("type") or "openai_compatible")
            provider_class = PROVIDER_TYPES.get(provider_type)
            if not provider_class:
                logger.warning(
                    "Skipping unsupported AI provider type %s for %s",
                    provider_type,
                    provider_id,
                )
                continue
            self._providers[provider_id] = provider_class(provider_id, provider_config)
        self._default_provider = config.get("default_provider")
        self._default_model = config.get("default_model")
        self._timeout = int(config.get("request_timeout_seconds") or 30)
        self._max_tokens = int(config.get("max_tokens") or 1200)
        self._temperature = float(config.get("temperature") or 0.1)

    def capabilities(self) -> dict[str, Any]:
        return {
            "default_provider": self._default_provider,
            "default_model": self._default_model,
            "providers": [
                provider.capability()
                for provider in self._providers.values()
                if provider.is_available()
            ],
        }

    def _resolve_provider(self, provider_id: str | None) -> BaseProvider:
        selected_provider_id = provider_id or self._default_provider
        if not selected_provider_id:
            available = [provider for provider in self._providers.values() if provider.is_available()]
            if len(available) == 1:
                return available[0]
            raise AIProviderError("No default AI provider is configured")

        provider = self._providers.get(selected_provider_id)
        if not provider or not provider.is_available():
            raise AIProviderError(f"AI provider {selected_provider_id} is unavailable")
        return provider

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        provider_id: str | None = None,
        model: str | None = None,
    ) -> ProviderResponse:
        provider = self._resolve_provider(provider_id)
        selected_model = model or self._default_model
        return provider.generate(
            messages=messages,
            model=selected_model,
            timeout=self._timeout,
            max_tokens=self._max_tokens,
            temperature=self._temperature,
        )
