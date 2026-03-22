from __future__ import annotations

import functools
import re
from typing import Any


_OPENAPI_HTTP_METHODS = {
    "get",
    "put",
    "post",
    "delete",
    "options",
    "head",
    "patch",
    "trace",
}
_PATH_PARAM_PATTERN = re.compile(r"{([^}]+)}")


def ensure_openapi_operation_responses(spec: dict[str, Any]) -> dict[str, Any]:
    for path, path_item in spec.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue
        path_param_names = set(_PATH_PARAM_PATTERN.findall(path))
        path_level_params = _collect_path_parameter_names(path_item.get("parameters"))
        for method, operation in path_item.items():
            if method not in _OPENAPI_HTTP_METHODS or not isinstance(operation, dict):
                continue
            if not operation.get("responses"):
                operation["responses"] = {"200": {"description": "Success"}}
            operation_param_names = _collect_path_parameter_names(
                operation.get("parameters")
            )
            missing_path_params = path_param_names - path_level_params - operation_param_names
            if missing_path_params:
                operation.setdefault("parameters", [])
                operation["parameters"].extend(
                    _build_path_parameters(sorted(missing_path_params))
                )
    return spec


def _collect_path_parameter_names(parameters: Any) -> set[str]:
    names: set[str] = set()
    if not isinstance(parameters, list):
        return names
    for parameter in parameters:
        if (
            isinstance(parameter, dict)
            and parameter.get("in") == "path"
            and isinstance(parameter.get("name"), str)
        ):
            names.add(parameter["name"])
    return names


def _build_path_parameters(names: list[str]) -> list[dict[str, Any]]:
    return [
        {
            "in": "path",
            "name": name,
            "required": True,
            "schema": {"type": "string"},
            "description": f"{name} path parameter",
        }
        for name in names
    ]


def patch_fab_openapi() -> None:
    from flask import current_app
    from flask_appbuilder.api import BaseApi
    from flask_appbuilder.api.manager import OpenApi

    if getattr(OpenApi.get, "_superset_openapi_patched", False):
        return

    original_get = OpenApi.get

    @functools.wraps(original_get)
    def patched_get(self: Any, version: str) -> Any:
        version_found = False
        api_spec = self._create_api_spec(version)
        for base_api in current_app.appbuilder.baseviews:
            if isinstance(base_api, BaseApi) and base_api.version == version:
                base_api.add_api_spec(api_spec)
                version_found = True
        if not version_found:
            return self.response_404()
        return self.response(
            200,
            **ensure_openapi_operation_responses(api_spec.to_dict()),
        )

    patched_get.__dict__.update(getattr(original_get, "__dict__", {}))
    patched_get._superset_openapi_patched = True  # type: ignore[attr-defined]
    OpenApi.get = patched_get
