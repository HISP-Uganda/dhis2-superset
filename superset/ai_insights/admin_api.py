from __future__ import annotations

from copy import deepcopy
from typing import Any

from flask import request
from flask_appbuilder.api import expose, protect, safe
from flask_appbuilder.security.decorators import permission_name
from marshmallow import INCLUDE, Schema, ValidationError, fields

from superset.ai_insights.config import get_ai_insights_config
from superset.ai_insights.providers import AIProviderError, ProviderRegistry
from superset.ai_insights.settings import (
    build_ai_management_payload,
    save_ai_management_settings,
)
from superset.constants import MODEL_API_RW_METHOD_PERMISSION_MAP, PASSWORD_MASK
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
