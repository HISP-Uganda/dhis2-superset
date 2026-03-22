from __future__ import annotations

from types import SimpleNamespace

from superset.local_staging import admin_tools
from superset.local_staging.platform_settings import (
    ENGINE_CLICKHOUSE,
    ENGINE_DUCKDB,
    ENGINE_SUPERSET_DB,
)


def test_classify_table_name_marks_managed_roles() -> None:
    assert admin_tools.classify_table_name("ds_14_cases") == {
        "role": "staging",
        "managed": True,
    }
    assert admin_tools.classify_table_name("sv_14_cases") == {
        "role": "serving",
        "managed": True,
    }
    assert admin_tools.classify_table_name("sv_14_cases__build_1712") == {
        "role": "build",
        "managed": True,
    }
    assert admin_tools.classify_table_name("users") == {
        "role": "other",
        "managed": False,
    }


def test_get_dependency_status_reports_per_engine_readiness(monkeypatch) -> None:
    installed_modules = {"duckdb", "duckdb_engine"}

    def fake_find_spec(module_name: str) -> object | None:
        return object() if module_name in installed_modules else None

    monkeypatch.setattr(
        admin_tools.importlib.util,
        "find_spec",
        fake_find_spec,
    )

    status = admin_tools.get_dependency_status()

    assert status[ENGINE_SUPERSET_DB]["ready"] is True
    assert status[ENGINE_DUCKDB]["ready"] is True
    assert status[ENGINE_CLICKHOUSE]["ready"] is False
    assert status[ENGINE_CLICKHOUSE]["packages"][0]["package_name"] == (
        "clickhouse-connect"
    )


def test_install_engine_dependencies_uses_python_pip(monkeypatch) -> None:
    monkeypatch.setattr(
        admin_tools,
        "get_dependency_status",
        lambda: {
            ENGINE_DUCKDB: {
                "engine": ENGINE_DUCKDB,
                "ready": True,
                "packages": [
                    {
                        "package_name": "duckdb",
                        "module_name": "duckdb",
                        "installed": True,
                        "required": True,
                    },
                    {
                        "package_name": "duckdb-engine",
                        "module_name": "duckdb_engine",
                        "installed": True,
                        "required": True,
                    },
                ],
            }
        },
    )

    calls: list[list[str]] = []

    def fake_run(*args, **kwargs):
        calls.append(list(args[0]))
        return SimpleNamespace(returncode=0, stdout="installed", stderr="")

    monkeypatch.setattr(admin_tools.subprocess, "run", fake_run)

    result = admin_tools.install_engine_dependencies(ENGINE_DUCKDB)

    assert result["ok"] is True
    assert calls == [[
        admin_tools.sys.executable,
        "-m",
        "pip",
        "install",
        "duckdb",
        "duckdb-engine",
    ]]
    assert "duckdb-engine" in result["command"]
