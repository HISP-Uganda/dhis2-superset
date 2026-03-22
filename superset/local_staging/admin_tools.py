from __future__ import annotations

import importlib.util
import subprocess
import sys
from typing import Any

from superset.local_staging.platform_settings import (
    ENGINE_CLICKHOUSE,
    ENGINE_DUCKDB,
    ENGINE_SUPERSET_DB,
)

ENGINE_DEPENDENCIES: dict[str, list[dict[str, str]]] = {
    ENGINE_SUPERSET_DB: [],
    ENGINE_DUCKDB: [
        {"package": "duckdb", "module": "duckdb"},
        {"package": "duckdb-engine", "module": "duckdb_engine"},
    ],
    ENGINE_CLICKHOUSE: [
        {"package": "clickhouse-connect", "module": "clickhouse_connect"},
    ],
}

MANAGED_STAGING_PREFIX = "ds_"
MANAGED_SERVING_PREFIX = "sv_"


def classify_table_name(table_name: str) -> dict[str, Any]:
    normalized = str(table_name or "").strip().lower()
    is_build = normalized.endswith("__loading") or "__build_" in normalized
    if is_build and normalized.startswith(MANAGED_SERVING_PREFIX):
        return {"role": "build", "managed": True}
    if normalized.startswith(MANAGED_STAGING_PREFIX):
        return {"role": "staging", "managed": True}
    if normalized.startswith(MANAGED_SERVING_PREFIX):
        return {"role": "serving", "managed": True}
    return {"role": "other", "managed": False}


def build_table_metadata(
    *,
    schema: str,
    name: str,
    table_type: str,
    row_count: int | None,
) -> dict[str, Any]:
    table_info = classify_table_name(name)
    return {
        "schema": schema,
        "name": name,
        "full_name": f"{schema}.{name}" if schema else name,
        "type": table_type,
        "row_count": row_count,
        **table_info,
    }


def is_safe_identifier(identifier: str) -> bool:
    value = str(identifier or "")
    return bool(value) and value.replace("_", "").isalnum()


def _package_status(package_name: str, module_name: str) -> dict[str, Any]:
    installed = importlib.util.find_spec(module_name) is not None
    return {
        "package_name": package_name,
        "module_name": module_name,
        "installed": installed,
        "required": True,
    }


def get_dependency_status() -> dict[str, Any]:
    status: dict[str, Any] = {}
    for engine_name, packages in ENGINE_DEPENDENCIES.items():
        package_statuses = [
            _package_status(package["package"], package["module"])
            for package in packages
        ]
        ready = all(package["installed"] for package in package_statuses)
        status[engine_name] = {
            "engine": engine_name,
            "ready": ready,
            "packages": package_statuses,
            "install_command": (
                " ".join([sys.executable, "-m", "pip", "install", *[
                    package["package"] for package in packages
                ]])
                if packages
                else None
            ),
        }
    return status


def trim_command_output(output: str, *, max_chars: int = 4000) -> str:
    text = str(output or "").strip()
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}…"


def install_engine_dependencies(engine_name: str) -> dict[str, Any]:
    packages = ENGINE_DEPENDENCIES.get(engine_name)
    if packages is None:
        raise ValueError(f"Unknown engine: {engine_name}")
    if not packages:
        return {
            "ok": True,
            "engine": engine_name,
            "packages": [],
            "message": "No additional packages are required for this engine.",
            "dependency_status": get_dependency_status().get(engine_name, {}),
        }

    package_names = [package["package"] for package in packages]
    command = [sys.executable, "-m", "pip", "install", *package_names]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        timeout=900,
    )
    dependency_status = get_dependency_status().get(engine_name, {})
    stdout = trim_command_output(completed.stdout)
    stderr = trim_command_output(completed.stderr)
    ok = completed.returncode == 0 and bool(dependency_status.get("ready"))
    return {
        "ok": ok,
        "engine": engine_name,
        "packages": package_names,
        "command": " ".join(command),
        "returncode": completed.returncode,
        "stdout": stdout,
        "stderr": stderr,
        "message": (
            f"Installed dependencies for {engine_name}"
            if ok
            else f"Dependency installation failed for {engine_name}"
        ),
        "dependency_status": dependency_status,
    }
