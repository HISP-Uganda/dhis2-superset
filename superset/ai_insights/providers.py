from __future__ import annotations

import json
import logging
from collections.abc import Generator
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


@dataclass(frozen=True)
class StreamChunk:
    text: str
    done: bool = False


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


def _normalize_anthropic_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(item.get("text", "")).strip()
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ).strip()
    if isinstance(content, dict):
        return str(content.get("text", "")).strip()
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

    def generate_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> Generator[StreamChunk, None, None]:
        """Default: fall back to non-streaming generate and yield one chunk."""
        response = self.generate(
            messages=messages,
            model=model,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        yield StreamChunk(text=response.text, done=True)

    def _post_chat_completion_stream(
        self,
        *,
        url: str,
        headers: dict[str, str],
        selected_model: str,
        messages: list[dict[str, str]],
        timeout: int,
        max_tokens: int,
        temperature: float,
        extra_payload: dict[str, Any] | None = None,
    ) -> Generator[StreamChunk, None, None]:
        """Stream OpenAI-compatible chat completions via SSE."""
        payload: dict[str, Any] = {
            "model": selected_model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
            **(extra_payload or {}),
        }
        # Only include max_tokens if positive (reasoning models use max_completion_tokens instead)
        if max_tokens > 0 and "max_completion_tokens" not in (extra_payload or {}):
            payload["max_tokens"] = max_tokens
        response = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=timeout,
            stream=True,
        )
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as ex:
            raise AIProviderError(f"HTTP {response.status_code} Error") from ex

        # Repetition detection: stop early only when the model is clearly
        # looping (same paragraph block repeated 3+ times).  Conservative
        # thresholds to avoid cutting off legitimate analysis.
        import re as _re

        _full_text = ""
        _last_check_len = 0

        def _is_repeating(text: str) -> bool:
            # Strategy 0: pipe-delimited raw IDs/titles repeated over and over.
            pipe_tokens = [token.strip().lower() for token in text.split("|") if token.strip()]
            if len(pipe_tokens) >= 8:
                token_counts: dict[str, int] = {}
                for token in pipe_tokens:
                    token_counts[token] = token_counts.get(token, 0) + 1
                    if token_counts[token] >= 5 and token_counts[token] / len(pipe_tokens) >= 0.45:
                        return True

            # Strategy 1: same ## heading appears 2+ times
            headings = _re.findall(r"^#{1,3} .{3,}", text, _re.MULTILINE)
            seen: dict[str, int] = {}
            for h in headings:
                key = h.strip().lower()
                seen[key] = seen.get(key, 0) + 1
                if seen[key] >= 2:
                    return True

            # Strategy 2: a paragraph opening (first 80 chars) repeats 2+ times
            paragraphs = _re.split(r"\n\s*\n", text)
            para_counts: dict[str, int] = {}
            for p in paragraphs:
                p = p.strip()
                if len(p) < 60:
                    continue
                key = p[:80].lower()
                para_counts[key] = para_counts.get(key, 0) + 1
                if para_counts[key] >= 2:
                    return True

            # Strategy 3: any 80-char substring appears 2+ times in the text
            if len(text) > 1500:
                window = 80
                tail = text[-window:]
                count = text.count(tail)
                if count >= 2:
                    return True

            # Strategy 4: content after "Action Recommendations" exceeds 800 chars
            rec_match = _re.search(
                r"## Action Recommendations", text, _re.IGNORECASE
            )
            if rec_match:
                after_rec = text[rec_match.end():]
                if len(after_rec) > 2000:
                    return True

            # Strategy 5: any non-trivial line (30+ chars) repeated 3+ times
            lines = text.split("\n")
            line_counts: dict[str, int] = {}
            for ln in lines:
                ln = ln.strip()
                if len(ln) < 30:
                    continue
                key = ln[:100].lower()
                line_counts[key] = line_counts.get(key, 0) + 1
                if line_counts[key] >= 3:
                    return True

            return False

        for line in response.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            data_str = line[6:].strip()
            if data_str == "[DONE]":
                yield StreamChunk(text="", done=True)
                return
            try:
                chunk = json.loads(data_str)
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    _full_text += content
                    # Check periodically (every ~200 chars after 500 total)
                    if (
                        len(_full_text) > 500
                        and len(_full_text) - _last_check_len >= 200
                    ):
                        _last_check_len = len(_full_text)
                        if _is_repeating(_full_text):
                            logger.warning(
                                "Repetition detected after %d chars, stopping stream",
                                len(_full_text),
                            )
                            yield StreamChunk(text="", done=True)
                            response.close()
                            return
                    yield StreamChunk(text=content)
            except (json.JSONDecodeError, IndexError, KeyError):
                continue
        yield StreamChunk(text="", done=True)

    def _post_chat_completion(
        self,
        *,
        url: str,
        headers: dict[str, str],
        selected_model: str,
        messages: list[dict[str, str]],
        timeout: int,
        max_tokens: int,
        temperature: float,
        extra_payload: dict[str, Any] | None = None,
    ) -> ProviderResponse:
        started_at = perf_counter()
        payload: dict[str, Any] = {
            "model": selected_model,
            "messages": messages,
            "temperature": temperature,
            **(extra_payload or {}),
        }
        # Only include max_tokens if positive (reasoning models use max_completion_tokens instead)
        if max_tokens > 0 and "max_completion_tokens" not in (extra_payload or {}):
            payload["max_tokens"] = max_tokens
        response = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=timeout,
        )
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as ex:
            error_msg = f"HTTP {response.status_code} Error"
            try:
                error_body = response.json()
                if isinstance(error_body, dict) and "error" in error_body:
                    if isinstance(error_body["error"], dict) and "message" in error_body["error"]:
                        error_msg += f": {error_body['error']['message']}"
                    else:
                        error_msg += f": {error_body['error']}"
            except Exception:  # pylint: disable=broad-except
                pass
            raise AIProviderError(error_msg) from ex

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


class OpenAIProvider(BaseProvider):
    """OpenAI API provider.

    Supports both the Chat Completions API (https://platform.openai.com/docs/api-reference/chat)
    and reasoning models (o-series) which use max_completion_tokens instead of max_tokens.
    """
    provider_type = "openai"

    # o-series reasoning models use max_completion_tokens, not max_tokens
    _REASONING_MODELS = {"o1", "o1-mini", "o1-preview", "o3", "o3-mini", "o3-pro", "o4-mini"}

    def is_available(self) -> bool:
        return super().is_available()

    def _openai_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if secret := resolve_provider_secret(self.config):
            headers["Authorization"] = f"Bearer {secret}"
        if organization := str(self.config.get("organization_id") or "").strip():
            headers["OpenAI-Organization"] = organization
        return headers

    def _openai_url(self) -> str:
        return str(
            self.config.get("base_url") or "https://api.openai.com/v1"
        ).rstrip("/")

    def _validate(self, model: str | None) -> str:
        if not self.is_available():
            raise AIProviderError(f"Provider {self.provider_id} is not configured")
        selected_model = model or self.default_model
        if not selected_model:
            raise AIProviderError(f"Provider {self.provider_id} has no configured model")
        return selected_model

    def _is_reasoning_model(self, model: str) -> bool:
        """Check if model is an o-series reasoning model."""
        return any(model.startswith(prefix) for prefix in self._REASONING_MODELS)

    def _build_extra_payload(self, model: str, max_tokens: int) -> dict[str, Any]:
        """Build model-specific extra payload parameters."""
        if self._is_reasoning_model(model):
            # Reasoning models use max_completion_tokens, don't accept max_tokens
            return {"max_completion_tokens": max_tokens}
        return {}

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        selected_model = self._validate(model)
        extra = self._build_extra_payload(selected_model, max_tokens)
        # Reasoning models don't accept temperature or max_tokens params
        effective_max = 0 if self._is_reasoning_model(selected_model) else max_tokens
        effective_temp = 1.0 if self._is_reasoning_model(selected_model) else temperature
        return self._post_chat_completion(
            url=f"{self._openai_url()}/chat/completions",
            headers=self._openai_headers(),
            selected_model=selected_model,
            messages=messages,
            timeout=timeout,
            max_tokens=effective_max if effective_max else max_tokens,
            temperature=effective_temp,
            extra_payload=extra,
        )

    def generate_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> Generator[StreamChunk, None, None]:
        selected_model = self._validate(model)
        extra = self._build_extra_payload(selected_model, max_tokens)
        effective_max = 0 if self._is_reasoning_model(selected_model) else max_tokens
        effective_temp = 1.0 if self._is_reasoning_model(selected_model) else temperature
        yield from self._post_chat_completion_stream(
            url=f"{self._openai_url()}/chat/completions",
            headers=self._openai_headers(),
            selected_model=selected_model,
            messages=messages,
            timeout=timeout,
            max_tokens=effective_max if effective_max else max_tokens,
            temperature=effective_temp,
            extra_payload=extra,
        )


class OpenAICompatibleProvider(BaseProvider):
    provider_type = "openai_compatible"

    def is_available(self) -> bool:
        return super().is_available() and bool(self.config.get("base_url"))

    def _compat_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if secret := resolve_provider_secret(self.config):
            headers["Authorization"] = f"Bearer {secret}"
        return headers

    def _compat_validate(self, model: str | None) -> str:
        if not self.is_available():
            raise AIProviderError(f"Provider {self.provider_id} is not configured")
        selected_model = model or self.default_model
        if not selected_model:
            raise AIProviderError(f"Provider {self.provider_id} has no configured model")
        return selected_model

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        selected_model = self._compat_validate(model)
        base_url = str(self.config["base_url"]).rstrip("/")
        return self._post_chat_completion(
            url=f"{base_url}/chat/completions",
            headers=self._compat_headers(),
            selected_model=selected_model,
            messages=messages,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    def generate_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> Generator[StreamChunk, None, None]:
        selected_model = self._compat_validate(model)
        base_url = str(self.config["base_url"]).rstrip("/")
        yield from self._post_chat_completion_stream(
            url=f"{base_url}/chat/completions",
            headers=self._compat_headers(),
            selected_model=selected_model,
            messages=messages,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=temperature,
        )


class GeminiProvider(BaseProvider):
    """Native Google Gemini API provider.

    Uses ``generateContent`` / ``streamGenerateContent`` instead of the
    OpenAI-compatible shim so that all model versions (including 3.x) are
    supported as soon as Google publishes them.

    Expects the API key via the standard ``api_key`` / ``api_key_env``
    config.  ``base_url`` defaults to
    ``https://generativelanguage.googleapis.com`` and is *not* user-
    editable (the preset sets ``supports_base_url: false``).
    """

    provider_type = "gemini"

    # ── helpers ─────────────────────────────────────────────────

    def _gemini_base(self) -> str:
        raw = str(self.config.get("base_url") or "").strip().rstrip("/")
        # Strip the old /v1beta/openai suffix if still stored from previous
        # config so we always hit the native endpoint.
        for suffix in ("/openai", "/v1beta/openai", "/v1beta"):
            if raw.endswith(suffix):
                raw = raw[: -len(suffix)]
        return raw or "https://generativelanguage.googleapis.com"

    def _gemini_url(self, model: str, *, stream: bool = False) -> str:
        base = self._gemini_base()
        action = "streamGenerateContent" if stream else "generateContent"
        url = f"{base}/v1beta/models/{model}:{action}"
        if stream:
            url += "?alt=sse"
        return url

    def _gemini_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if secret := resolve_provider_secret(self.config):
            headers["x-goog-api-key"] = secret
        return headers

    def _validate(self, model: str | None) -> str:
        if not self.is_available():
            raise AIProviderError(
                f"Provider {self.provider_id} is not configured"
            )
        selected = model or self.default_model
        if not selected:
            raise AIProviderError(
                f"Provider {self.provider_id} has no configured model"
            )
        return selected

    @staticmethod
    def _build_payload(
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
    ) -> dict[str, Any]:
        """Convert OpenAI-style messages to native Gemini format."""
        system_parts: list[str] = []
        contents: list[dict[str, Any]] = []

        for msg in messages:
            role = str(msg.get("role") or "user").strip().lower()
            text = str(msg.get("content") or "").strip()
            if not text:
                continue
            if role == "system":
                system_parts.append(text)
                continue
            gemini_role = "model" if role == "assistant" else "user"
            contents.append(
                {"role": gemini_role, "parts": [{"text": text}]}
            )

        payload: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            },
        }
        if system_parts:
            payload["systemInstruction"] = {
                "parts": [{"text": "\n\n".join(system_parts)}]
            }
        return payload

    @staticmethod
    def _extract_text(body: dict[str, Any]) -> str:
        """Pull the assistant text from a Gemini generateContent response."""
        try:
            candidates = body.get("candidates") or []
            parts = candidates[0].get("content", {}).get("parts", [])
            return "".join(
                str(p.get("text", "")) for p in parts if isinstance(p, dict)
            ).strip()
        except (IndexError, KeyError, TypeError):
            return ""

    def _raise_for_status(
        self, response: requests.Response, selected_model: str
    ) -> None:
        if response.ok:
            return
        error_msg = f"HTTP {response.status_code} Error"
        try:
            body = response.json()
            err = body.get("error", {})
            if isinstance(err, dict) and err.get("message"):
                error_msg += f": {err['message']}"
        except Exception:  # pylint: disable=broad-except
            pass
        if response.status_code == 503:
            error_msg = (
                f"Model '{selected_model}' is not available ({error_msg}). "
                "It may not be released yet or is temporarily overloaded."
            )
        raise AIProviderError(error_msg)

    # ── generate (non-streaming) ────────────────────────────────

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        selected_model = self._validate(model)
        payload = self._build_payload(messages, max_tokens, temperature)
        started_at = perf_counter()

        response = requests.post(
            self._gemini_url(selected_model),
            headers=self._gemini_headers(),
            json=payload,
            timeout=timeout,
        )
        self._raise_for_status(response, selected_model)

        text = self._extract_text(response.json())
        if not text:
            raise AIProviderError(
                f"Provider {self.provider_id} returned an empty response"
            )

        return ProviderResponse(
            provider_id=self.provider_id,
            model=selected_model,
            text=text,
            duration_ms=int((perf_counter() - started_at) * 1000),
        )

    # ── generate_stream (SSE) ───────────────────────────────────

    def generate_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> Generator[StreamChunk, None, None]:
        selected_model = self._validate(model)
        payload = self._build_payload(messages, max_tokens, temperature)

        response = requests.post(
            self._gemini_url(selected_model, stream=True),
            headers=self._gemini_headers(),
            json=payload,
            timeout=timeout,
            stream=True,
        )
        self._raise_for_status(response, selected_model)

        for line in response.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            data_str = line[6:].strip()
            try:
                chunk = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            text = self._extract_text(chunk)
            if text:
                yield StreamChunk(text=text)

        yield StreamChunk(text="", done=True)


class DeepSeekProvider(OpenAICompatibleProvider):
    provider_type = "deepseek"


class AnthropicProvider(BaseProvider):
    provider_type = "anthropic"

    def is_available(self) -> bool:
        return super().is_available()

    def _anthropic_headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            # Latest stable Anthropic API version
            "anthropic-version": str(
                self.config.get("api_version") or "2023-06-01"
            ).strip(),
        }
        if secret := resolve_provider_secret(self.config):
            headers["x-api-key"] = secret
        return headers

    def _anthropic_url(self) -> str:
        return str(
            self.config.get("base_url") or "https://api.anthropic.com"
        ).rstrip("/")

    def _anthropic_validate(self, model: str | None) -> str:
        if not self.is_available():
            raise AIProviderError(f"Provider {self.provider_id} is not configured")
        selected_model = model or self.default_model
        if not selected_model:
            raise AIProviderError(f"Provider {self.provider_id} has no configured model")
        return selected_model

    def _prepare_anthropic_payload(
        self,
        messages: list[dict[str, str]],
        selected_model: str,
        max_tokens: int,
        temperature: float,
    ) -> dict[str, Any]:
        anthropic_messages: list[dict[str, str]] = []
        system_prompts: list[str] = []
        for message in messages:
            role = str(message.get("role") or "user").strip().lower()
            content = str(message.get("content") or "").strip()
            if not content:
                continue
            if role == "system":
                system_prompts.append(content)
                continue
            anthropic_messages.append(
                {
                    "role": "assistant" if role == "assistant" else "user",
                    "content": content,
                }
            )

        if not anthropic_messages:
            raise AIProviderError(
                f"Provider {self.provider_id} requires at least one non-system message"
            )

        payload: dict[str, Any] = {
            "model": selected_model,
            "messages": anthropic_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if system_prompts:
            payload["system"] = "\n\n".join(system_prompts)
        return payload

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        selected_model = self._anthropic_validate(model)
        payload = self._prepare_anthropic_payload(
            messages, selected_model, max_tokens, temperature
        )
        started_at = perf_counter()
        response = requests.post(
            f"{self._anthropic_url()}/v1/messages",
            headers=self._anthropic_headers(),
            json=payload,
            timeout=timeout,
        )
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as ex:
            error_msg = f"HTTP {response.status_code} Error"
            try:
                error_body = response.json()
                if isinstance(error_body, dict) and "error" in error_body:
                    if isinstance(error_body["error"], dict) and "message" in error_body["error"]:
                        error_msg += f": {error_body['error']['message']}"
                    else:
                        error_msg += f": {error_body['error']}"
            except Exception:  # pylint: disable=broad-except
                pass
            raise AIProviderError(error_msg) from ex

        body = response.json()
        text = _normalize_anthropic_message_content(body.get("content"))
        if not text:
            raise AIProviderError(
                f"Provider {self.provider_id} returned an unexpected response"
            )

        return ProviderResponse(
            provider_id=self.provider_id,
            model=selected_model,
            text=text,
            duration_ms=int((perf_counter() - started_at) * 1000),
        )

    def generate_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> Generator[StreamChunk, None, None]:
        selected_model = self._anthropic_validate(model)
        payload = self._prepare_anthropic_payload(
            messages, selected_model, max_tokens, temperature
        )
        payload["stream"] = True

        response = requests.post(
            f"{self._anthropic_url()}/v1/messages",
            headers=self._anthropic_headers(),
            json=payload,
            timeout=timeout,
            stream=True,
        )
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as ex:
            raise AIProviderError(f"HTTP {response.status_code} Error") from ex

        for line in response.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            data_str = line[6:].strip()
            try:
                event = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            event_type = event.get("type", "")
            if event_type == "content_block_delta":
                delta = event.get("delta", {})
                text = delta.get("text", "")
                if text:
                    yield StreamChunk(text=text)
            elif event_type == "message_stop":
                yield StreamChunk(text="", done=True)
                return
        yield StreamChunk(text="", done=True)


class OllamaProvider(BaseProvider):
    provider_type = "ollama"

    @property
    def is_local(self) -> bool:
        return True

    def is_available(self) -> bool:
        return super().is_available() and bool(self.config.get("base_url"))

    def _ollama_validate(self, model: str | None) -> str:
        if not self.is_available():
            raise AIProviderError(f"Provider {self.provider_id} is not configured")
        selected_model = model or self.default_model
        if not selected_model:
            raise AIProviderError(f"Provider {self.provider_id} has no configured model")
        return selected_model

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        selected_model = self._ollama_validate(model)
        base_url = str(self.config["base_url"]).rstrip("/")

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
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as ex:
            error_msg = f"HTTP {response.status_code} Error"
            try:
                error_body = response.json()
                if isinstance(error_body, dict) and "error" in error_body:
                    if isinstance(error_body["error"], dict) and "message" in error_body["error"]:
                        error_msg += f": {error_body['error']['message']}"
                    else:
                        error_msg += f": {error_body['error']}"
            except Exception:  # pylint: disable=broad-except
                pass
            raise AIProviderError(error_msg) from ex

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

    def generate_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> Generator[StreamChunk, None, None]:
        selected_model = self._ollama_validate(model)
        base_url = str(self.config["base_url"]).rstrip("/")

        response = requests.post(
            f"{base_url}/api/chat",
            json={
                "model": selected_model,
                "messages": messages,
                "stream": True,
                "options": {
                    "temperature": temperature,
                    "num_predict": max_tokens,
                },
            },
            timeout=timeout,
            stream=True,
        )
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as ex:
            raise AIProviderError(f"HTTP {response.status_code} Error") from ex

        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError:
                continue
            content = chunk.get("message", {}).get("content", "")
            if content:
                yield StreamChunk(text=content)
            if chunk.get("done"):
                yield StreamChunk(text="", done=True)
                return
        yield StreamChunk(text="", done=True)


class LocalAIProvider(BaseProvider):
    """LocalAI provider — OpenAI-compatible API running on a local/internal host.

    LocalAI (https://localai.io) exposes the standard ``/v1/chat/completions``
    endpoint so we reuse the base-class helpers for both sync and streaming.
    An optional health-check against ``/v1/models`` is performed when
    ``is_available()`` is called.
    """

    provider_type = "localai"

    @property
    def is_local(self) -> bool:
        return True

    def is_available(self) -> bool:
        if not super().is_available() or not self.config.get("base_url"):
            return False
        # Quick health-check — try /readyz first (no auth required),
        # fall back to /v1/models with auth headers if needed.
        base_url = str(self.config["base_url"]).rstrip("/")
        try:
            resp = requests.get(f"{base_url}/readyz", timeout=3)
            if resp.status_code == 200:
                return True
            # readyz may not exist; try /v1/models with auth
            headers = self._localai_headers()
            resp = requests.get(f"{base_url}/v1/models", headers=headers, timeout=3)
            return resp.status_code == 200
        except Exception:  # pylint: disable=broad-except
            return False

    def _localai_url(self) -> str:
        return str(self.config["base_url"]).rstrip("/") + "/v1/chat/completions"

    def _localai_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if secret := resolve_provider_secret(self.config):
            headers["Authorization"] = f"Bearer {secret}"
        return headers

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResponse:
        selected_model = model or self.default_model
        if not selected_model:
            raise AIProviderError(f"Provider {self.provider_id} has no configured model")
        return self._post_chat_completion(
            url=self._localai_url(),
            headers=self._localai_headers(),
            selected_model=selected_model,
            messages=messages,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=temperature,
            extra_payload={
                "repeat_penalty": 1.4,
            },
        )

    def generate_stream(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None,
        timeout: int,
        max_tokens: int,
        temperature: float,
    ) -> Generator[StreamChunk, None, None]:
        selected_model = model or self.default_model
        if not selected_model:
            raise AIProviderError(f"Provider {self.provider_id} has no configured model")
        yield from self._post_chat_completion_stream(
            url=self._localai_url(),
            headers=self._localai_headers(),
            selected_model=selected_model,
            messages=messages,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=temperature,
            extra_payload={
                "repeat_penalty": 1.4,
            },
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
    "anthropic": AnthropicProvider,
    "deepseek": DeepSeekProvider,
    "gemini": GeminiProvider,
    "localai": LocalAIProvider,
    "mock": MockProvider,
    "ollama": OllamaProvider,
    "openai": OpenAIProvider,
    "openai_compatible": OpenAICompatibleProvider,
}


class ProviderRegistry:
    def __init__(self, config: dict[str, Any] | None = None) -> None:
        config = config or get_ai_insights_config()
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
        self._max_tokens = int(config.get("max_tokens") or 4096)
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

    def _lookup_provider(self, provider_id: str | None) -> BaseProvider | None:
        """Look up a provider by ID without checking availability.

        Returns the provider instance even if its health-check fails, so
        callers can read metadata like ``is_local`` and ``provider_type``
        without risking a timeout or exception from the availability check.
        """
        pid = provider_id or self._default_provider
        if not pid:
            # Fall back to the first registered provider (any state)
            for provider in self._providers.values():
                return provider
            return None
        return self._providers.get(pid)

    def _resolve_timeout(self, provider: BaseProvider) -> int:
        timeout = self._timeout
        if provider.provider_type == "localai":
            timeout = max(timeout, 120)
        elif provider.is_local:
            timeout = max(timeout, 90)
        return timeout

    def generate(
        self,
        *,
        messages: list[dict[str, str]],
        provider_id: str | None = None,
        model: str | None = None,
    ) -> ProviderResponse:
        provider = self._resolve_provider(provider_id)
        selected_model = model or self._default_model
        max_tokens = self._max_tokens
        timeout = self._resolve_timeout(provider)
        if provider.provider_type == "localai":
            max_tokens = min(max(max_tokens, 8192), 16384)
        elif provider.is_local:
            max_tokens = max(max_tokens, 8192)
        return provider.generate(
            messages=messages,
            model=selected_model,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=self._temperature,
        )

    def generate_stream(
        self,
        *,
        messages: list[dict[str, str]],
        provider_id: str | None = None,
        model: str | None = None,
    ) -> Generator[StreamChunk, None, None]:
        provider = self._resolve_provider(provider_id)
        selected_model = model or self._default_model
        # Local models: give LocalAI a larger generation budget for full insight reports.
        max_tokens = self._max_tokens
        timeout = self._resolve_timeout(provider)
        if provider.provider_type == "localai":
            max_tokens = min(max(max_tokens, 8192), 16384)
        elif provider.is_local:
            max_tokens = max(max_tokens, 8192)
        yield from provider.generate_stream(
            messages=messages,
            model=selected_model,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=self._temperature,
        )
