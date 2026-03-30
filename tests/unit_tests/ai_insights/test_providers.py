from __future__ import annotations

import json

from superset.ai_insights.providers import (
    AnthropicProvider,
    DeepSeekProvider,
    GeminiProvider,
    MockProvider,
    OpenAIProvider,
    ProviderRegistry,
)


def test_mock_provider_uses_first_registered_mart_table_for_sql_generation() -> None:
    provider = MockProvider(
        "mock",
        {
            "enabled": True,
            "models": ["mock-1"],
        },
    )

    response = provider.generate(
        messages=[
            {
                "role": "system",
                "content": 'Return a strict JSON object with the keys "sql", "explanation", "assumptions", and "follow_ups".',
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "question": "Show admissions by region",
                        "mart_tables": [
                            {
                                "schema": "public",
                                "table": "admissions_mart",
                                "columns": [{"name": "region", "type": "STRING"}],
                            }
                        ],
                    }
                ),
            },
        ],
        model=None,
        timeout=30,
        max_tokens=1000,
        temperature=0.1,
    )

    payload = json.loads(response.text)
    assert payload["sql"] == "SELECT * FROM public.admissions_mart LIMIT 100"


def test_openai_provider_posts_to_official_endpoint(mocker) -> None:
    provider = OpenAIProvider(
        "openai",
        {
            "enabled": True,
            "models": ["gpt-5.4"],
            "default_model": "gpt-5.4",
            "api_key": "secret",
        },
    )
    response = mocker.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "choices": [{"message": {"content": "OK"}}],
    }
    post = mocker.patch(
        "superset.ai_insights.providers.requests.post",
        return_value=response,
    )

    result = provider.generate(
        messages=[{"role": "user", "content": "ping"}],
        model=None,
        timeout=30,
        max_tokens=128,
        temperature=0.1,
    )

    assert result.text == "OK"
    assert post.call_args.args[0] == "https://api.openai.com/v1/chat/completions"


def test_gemini_provider_posts_to_official_compat_endpoint(mocker) -> None:
    provider = GeminiProvider(
        "gemini",
        {
            "enabled": True,
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
            "models": ["gemini-2.5-flash"],
            "default_model": "gemini-2.5-flash",
            "api_key": "secret",
        },
    )
    response = mocker.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "choices": [{"message": {"content": "OK"}}],
    }
    post = mocker.patch(
        "superset.ai_insights.providers.requests.post",
        return_value=response,
    )

    result = provider.generate(
        messages=[{"role": "user", "content": "ping"}],
        model=None,
        timeout=30,
        max_tokens=128,
        temperature=0.1,
    )

    assert result.text == "OK"
    assert (
        post.call_args.args[0]
        == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    )


def test_deepseek_provider_posts_to_official_endpoint(mocker) -> None:
    provider = DeepSeekProvider(
        "deepseek",
        {
            "enabled": True,
            "base_url": "https://api.deepseek.com",
            "models": ["deepseek-reasoner"],
            "default_model": "deepseek-reasoner",
            "api_key": "secret",
        },
    )
    response = mocker.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "choices": [{"message": {"content": "OK"}}],
    }
    post = mocker.patch(
        "superset.ai_insights.providers.requests.post",
        return_value=response,
    )

    result = provider.generate(
        messages=[{"role": "user", "content": "ping"}],
        model=None,
        timeout=30,
        max_tokens=128,
        temperature=0.1,
    )

    assert result.text == "OK"
    assert post.call_args.args[0] == "https://api.deepseek.com/chat/completions"


def test_anthropic_provider_posts_messages_request(mocker) -> None:
    provider = AnthropicProvider(
        "anthropic",
        {
            "enabled": True,
            "models": ["claude-sonnet-4-20250514"],
            "default_model": "claude-sonnet-4-20250514",
            "api_key": "secret",
        },
    )
    response = mocker.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "content": [{"type": "text", "text": "OK"}],
    }
    post = mocker.patch(
        "superset.ai_insights.providers.requests.post",
        return_value=response,
    )

    result = provider.generate(
        messages=[
            {"role": "system", "content": "You are a test."},
            {"role": "user", "content": "ping"},
        ],
        model=None,
        timeout=30,
        max_tokens=128,
        temperature=0.1,
    )

    assert result.text == "OK"
    assert post.call_args.args[0] == "https://api.anthropic.com/v1/messages"
    assert post.call_args.kwargs["headers"]["x-api-key"] == "secret"
    assert post.call_args.kwargs["json"]["system"] == "You are a test."
    assert post.call_args.kwargs["json"]["messages"] == [
        {"role": "user", "content": "ping"}
    ]


def test_provider_registry_accepts_explicit_config() -> None:
    registry = ProviderRegistry(
        config={
            "default_provider": "mock",
            "default_model": "mock-1",
            "providers": {
                "mock": {
                    "type": "mock",
                    "enabled": True,
                    "models": ["mock-1"],
                    "default_model": "mock-1",
                }
            },
        }
    )

    result = registry.generate(messages=[{"role": "user", "content": "hello"}])

    assert result.provider_id == "mock"
    assert result.model == "mock-1"
