from __future__ import annotations

from types import SimpleNamespace

import pytest
from flask import g

from superset.ai_insights.service import AIInsightError, AIInsightService
from tests.conftest import with_config


def make_user() -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        is_authenticated=True,
        roles=[SimpleNamespace(name="Admin")],
    )


def make_ai_config(*, allow_sql_execution: bool = False) -> dict[str, object]:
    return {
        "enabled": True,
        "allow_sql_execution": allow_sql_execution,
        "default_provider": "mock",
        "default_model": "mock-1",
        "providers": {
            "mock": {
                "type": "mock",
                "enabled": True,
                "models": ["mock-1"],
                "default_model": "mock-1",
                "is_local": True,
            }
        },
    }


@with_config({"AI_INSIGHTS_CONFIG": make_ai_config()})
def test_generate_chart_insight_uses_mart_backed_chart(
    app_context: None,
    mocker,
) -> None:
    del app_context
    g.user = make_user()

    datasource = SimpleNamespace(
        id=9,
        table_name="admissions_mart",
        schema="public",
        dataset_role="MART",
        database=SimpleNamespace(backend="postgresql"),
    )
    chart = SimpleNamespace(
        id=12,
        slice_name="Admissions by region",
        viz_type="echarts_timeseries_bar",
        form_data={"slice_id": 12},
        datasource=datasource,
    )

    mocker.patch("superset.ai_insights.service.user_can_access_ai_mode", return_value=True)
    mocker.patch("superset.ai_insights.service.ChartDAO.get_by_id_or_uuid", return_value=chart)
    mocker.patch("superset.ai_insights.service.security_manager.raise_for_access")

    result = AIInsightService().generate_chart_insight(12, {"question": "Summarize this chart"})

    assert result["mode"] == "chart"
    assert result["provider"] == "mock"
    assert "Chart insight:" in result["insight"]


@with_config({"AI_INSIGHTS_CONFIG": make_ai_config()})
def test_generate_chart_insight_rejects_non_mart_datasource(
    app_context: None,
    mocker,
) -> None:
    del app_context
    g.user = make_user()

    datasource = SimpleNamespace(
        id=9,
        table_name="regular_table",
        schema="public",
        dataset_role="DEFAULT",
        database=SimpleNamespace(backend="postgresql"),
    )
    chart = SimpleNamespace(
        id=12,
        slice_name="Admissions by region",
        viz_type="echarts_timeseries_bar",
        form_data={"slice_id": 12},
        datasource=datasource,
    )

    mocker.patch("superset.ai_insights.service.user_can_access_ai_mode", return_value=True)
    mocker.patch("superset.ai_insights.service.ChartDAO.get_by_id_or_uuid", return_value=chart)
    mocker.patch("superset.ai_insights.service.security_manager.raise_for_access")

    with pytest.raises(AIInsightError, match="MART-backed chart datasource"):
        AIInsightService().generate_chart_insight(12, {"question": "Summarize this chart"})


@with_config({"AI_INSIGHTS_CONFIG": make_ai_config(allow_sql_execution=True)})
def test_assist_sql_generates_validated_sql_and_optional_execution(
    app_context: None,
    mocker,
) -> None:
    del app_context
    g.user = make_user()

    dataframe = SimpleNamespace(
        to_dict=lambda orient="records": [
            {"region": "Kampala", "value": 85125},
            {"region": "Gulu", "value": 12034},
        ]
    )
    database = SimpleNamespace(
        id=11,
        backend="postgresql",
        db_engine_spec=SimpleNamespace(engine="postgresql"),
        get_df=mocker.Mock(return_value=dataframe),
    )

    mocker.patch("superset.ai_insights.service.user_can_access_ai_mode", return_value=True)
    mocker.patch("superset.ai_insights.service.DatabaseDAO.find_by_id", return_value=database)
    mocker.patch("superset.ai_insights.service.security_manager.raise_for_access")
    mocker.patch(
        "superset.ai_insights.service.build_mart_schema_context",
        return_value=[
            {
                "schema": "public",
                "table": "admissions_mart",
                "columns": [
                    {"name": "region", "type": "STRING"},
                    {"name": "value", "type": "DOUBLE"},
                ],
            }
        ],
    )
    mocker.patch(
        "superset.ai_insights.service.ensure_mart_only_sql",
        return_value={
            "sql": "SELECT * FROM public.admissions_mart LIMIT 100",
            "tables": ["public.admissions_mart"],
            "validated": True,
        },
    )

    result = AIInsightService().assist_sql(
        {
            "database_id": 11,
            "schema": "public",
            "question": "Show admissions by region",
            "execute": True,
        }
    )

    assert result["mode"] == "sql"
    assert result["validated"] is True
    assert result["sql"] == "SELECT * FROM public.admissions_mart LIMIT 100"
    assert result["tables"] == ["public.admissions_mart"]
    assert result["execution"] == {
        "row_count": 2,
        "sample_rows": [
            {"region": "Kampala", "value": 85125},
            {"region": "Gulu", "value": 12034},
        ],
    }
    database.get_df.assert_called_once_with(
        "SELECT * FROM public.admissions_mart LIMIT 100",
        schema="public",
    )
