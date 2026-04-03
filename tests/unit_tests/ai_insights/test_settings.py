from __future__ import annotations

import pytest

from superset import db
from superset.ai_insights.settings import (
    AIInsightsSettings,
    build_ai_management_payload,
    load_ai_settings_override,
    save_ai_management_settings,
)
from superset.constants import PASSWORD_MASK


def _reset_settings() -> None:
    try:
        AIInsightsSettings.__table__.create(bind=db.session.get_bind(), checkfirst=True)
        db.session.query(AIInsightsSettings).delete()
        db.session.commit()
    except Exception:  # pylint: disable=broad-except
        db.session.rollback()


def test_ai_management_payload_includes_current_openai_catalog(app_context: None) -> None:
    del app_context
    _reset_settings()

    payload = build_ai_management_payload()
    model_ids = [item["id"] for item in payload["model_catalogs"]["openai_text"]]

    assert "gpt-5.4" in model_ids
    assert "gpt-5.4-pro" in model_ids
    assert "gpt-5.4-mini" in model_ids
    assert "gpt-4.1" in model_ids
    assert "o3" in model_ids
    assert "o4-mini" in model_ids


def test_ai_management_payload_includes_cloud_provider_catalogs(
    app_context: None,
) -> None:
    del app_context
    _reset_settings()

    payload = build_ai_management_payload()

    gemini_ids = [item["id"] for item in payload["model_catalogs"]["gemini_text"]]
    anthropic_ids = [
        item["id"] for item in payload["model_catalogs"]["anthropic_text"]
    ]
    deepseek_ids = [
        item["id"] for item in payload["model_catalogs"]["deepseek_text"]
    ]
    preset_ids = {item["id"] for item in payload["provider_presets"]}

    assert "gemini-2.5-flash" in gemini_ids
    assert "claude-sonnet-4-20250514" in anthropic_ids
    assert "deepseek-reasoner" in deepseek_ids
    assert {"gemini", "anthropic", "deepseek"} <= preset_ids


def test_save_ai_management_settings_persists_and_masks_provider_secret(
    app_context: None,
) -> None:
    del app_context
    _reset_settings()

    result = save_ai_management_settings(
        {
            "enabled": True,
            "default_provider": "openai",
            "default_model": "gpt-5.4",
            "providers": {
                "openai": {
                    "enabled": True,
                    "type": "openai",
                    "label": "OpenAI Cloud",
                    "api_key": "super-secret-key",
                    "models": ["gpt-5.4", "gpt-4.1"],
                    "default_model": "gpt-5.4",
                }
            },
        }
    )

    override = load_ai_settings_override()

    assert override["providers"]["openai"]["api_key"] == "super-secret-key"
    assert result["settings"]["providers"]["openai"]["api_key"] == PASSWORD_MASK
    assert result["settings"]["providers"]["openai"]["has_api_key"] is True


def test_build_ai_management_payload_recovers_from_invalid_encrypted_secrets(
    app_context: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    del app_context
    _reset_settings()
    row = AIInsightsSettings(id=1)
    row.set_config({"enabled": True})
    row.set_secrets({"providers": {"openai": {"api_key": "super-secret-key"}}})
    db.session.add(row)
    db.session.commit()

    original_get_secrets = AIInsightsSettings.get_secrets

    def broken_get_secrets(self: AIInsightsSettings) -> dict[str, object]:
        if self.id == 1:
            raise ValueError("Invalid decryption key")
        return original_get_secrets(self)

    monkeypatch.setattr(AIInsightsSettings, "get_secrets", broken_get_secrets)

    payload = build_ai_management_payload()

    assert payload["settings"]["enabled"] is True
    assert payload["settings"]["providers"]["openai"].get("has_api_key") is not True


def test_save_ai_management_settings_overwrites_invalid_encrypted_secrets(
    app_context: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    del app_context
    _reset_settings()
    row = AIInsightsSettings(id=1)
    row.set_config({"enabled": False})
    row.set_secrets({"providers": {"openai": {"api_key": "stale-secret"}}})
    db.session.add(row)
    db.session.commit()

    original_get_secrets = AIInsightsSettings.get_secrets

    failures = {"remaining": 1}

    def broken_get_secrets(self: AIInsightsSettings) -> dict[str, object]:
        if self.id == 1:
            if failures["remaining"] > 0:
                failures["remaining"] -= 1
                raise ValueError("Invalid decryption key")
        return original_get_secrets(self)

    monkeypatch.setattr(AIInsightsSettings, "get_secrets", broken_get_secrets)

    result = save_ai_management_settings(
        {
            "enabled": True,
            "default_provider": "openai",
            "default_model": "gpt-5.4",
            "providers": {
                "openai": {
                    "enabled": True,
                    "type": "openai",
                    "label": "OpenAI Cloud",
                    "api_key": "replacement-secret",
                    "models": ["gpt-5.4"],
                    "default_model": "gpt-5.4",
                }
            },
        }
    )

    monkeypatch.setattr(AIInsightsSettings, "get_secrets", original_get_secrets)
    override = load_ai_settings_override()

    assert result["settings"]["providers"]["openai"]["has_api_key"] is True
    assert override["providers"]["openai"]["api_key"] == "replacement-secret"
