from __future__ import annotations

from types import SimpleNamespace

import pytest
from flask import g

from superset.ai_insights.service import (
    AIInsightError,
    AIInsightService,
    _build_localai_evidence_digest,
    _build_localai_report_plan,
    _build_text_messages,
    _count_meaningful_dashboard_charts,
    _context_to_plain_text,
    _detect_insight_mode,
    _extract_user_focus,
    _looks_false_insufficient_data_output,
    _looks_incomplete_localai_output,
    _proofread_generated_insight,
    _looks_placeholder_output,
    _strip_prompt_leakage,
    _looks_repetitive_model_output,
)
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


def test_build_text_messages_uses_dynamic_prompt_for_localai_chart() -> None:
    messages = _build_text_messages(
        mode="chart",
        question="Summarize this chart",
        context_payload={
            "chart": {"name": "Admissions Vs Death", "viz_type": "bar"},
            "query_result": {
                "columns": ["region", "admissions", "deaths"],
                "row_count": 3,
                "sample_rows": [
                    {"region": "North", "admissions": 120, "deaths": 12},
                    {"region": "East", "admissions": 90, "deaths": 7},
                    {"region": "West", "admissions": 70, "deaths": 4},
                ],
            },
        },
        conversation=[],
        is_local_provider=True,
        provider_type="localai",
    )

    assert messages[0]["role"] == "system"
    assert messages[-1]["role"] == "user"
    assert "__direct_report__" not in [message["role"] for message in messages]
    assert "EVIDENCE SUMMARY:" in messages[-1]["content"]
    assert "Admissions Vs Death" in messages[-1]["content"]


def test_build_text_messages_includes_mode_aware_localai_report_plan() -> None:
    messages = _build_text_messages(
        mode="dashboard",
        question="Key takeaways focusing on testing trends",
        context_payload={
            "dashboard": {"name": "Malaria Dashboard"},
            "charts": [
                {
                    "chart": {"name": "Testing trend"},
                    "query_result": {
                        "columns": ["period", "testing_rate"],
                        "row_count": 3,
                        "sample_rows": [
                            {"period": "202601", "testing_rate": 124.2},
                            {"period": "202602", "testing_rate": 120.1},
                            {"period": "202603", "testing_rate": 118.4},
                        ],
                    },
                }
            ],
        },
        conversation=[],
        is_local_provider=True,
        provider_type="localai",
    )

    assert "Required report plan:" in messages[-1]["content"]
    assert "## Key Takeaways" in messages[-1]["content"]
    assert "## Leadership Watchouts" in messages[-1]["content"]


def test_build_localai_report_plan_returns_expected_summary_sections() -> None:
    plan, headings = _build_localai_report_plan("summary", "dashboard")

    assert "## Executive Summary" in plan
    assert "## Key Points" in plan
    assert headings == [
        "## Executive Summary",
        "## Key Points",
        "## Leadership Watchouts",
    ]


def test_incomplete_localai_output_detector_flags_missing_required_headings() -> None:
    assert _looks_incomplete_localai_output(
        "## Executive Summary\nA concise overview.\n\n## Key Points\n- Signal one\n- Signal two",
        [
            "## Executive Summary",
            "## Key Points",
            "## Leadership Watchouts",
        ],
    )


def test_repetitive_model_output_detector_flags_pipe_delimited_slug_spam() -> None:
    text = (
        "admissionsvsdeathsovertime|Admissions Vs Death|Admissions vs Deaths by Region|"
        "admissionsvsdeathsovertime|admissionsvsdeathsovertime|admissionsvsdeathsovertime|"
        "admissionsvsdeathsovertime|admissionsvsdeathsovertime"
    )

    assert _looks_repetitive_model_output(text) is True


def test_detect_insight_mode_supports_requested_aliases() -> None:
    assert _detect_insight_mode("Quarter over quarter changes") == "period_comparison"
    assert _detect_insight_mode("Cross chart analysis") == "cross_chart"
    assert _detect_insight_mode("Metrics to watch") == "metrics_attention"
    assert _detect_insight_mode("Deep dive") == "deep_dive"


def test_extract_user_focus_preserves_dynamic_user_input() -> None:
    mode = _detect_insight_mode(
        "Key takeaways focusing on deaths by region for the latest quarter"
    )
    focus = _extract_user_focus(
        "Key takeaways focusing on deaths by region for the latest quarter",
        mode,
    )

    assert mode == "key_takeaways"
    assert "deaths by region" in focus.lower()
    assert "latest quarter" in focus.lower()


def test_strip_prompt_leakage_removes_truncation_marker_lines() -> None:
    cleaned = _strip_prompt_leakage(
        "... and 7 more rows\n\n## Key Takeaways\n\n- Signal"
    )

    assert "... and 7 more rows" not in cleaned
    assert "## Key Takeaways" in cleaned


def test_placeholder_output_detector_flags_stub_scaffolding() -> None:
    assert _looks_placeholder_output("[STUB\nWrite a 70-120 word paragraph]") is True


def test_placeholder_output_detector_flags_raw_context_echo() -> None:
    text = (
        "Chart 9: Map 03\n"
        "Type: chart\n"
        "Columns: region, population\n"
        "Total rows: 1\n"
        "Sample data (1 rows):\n"
        "Row 1: region=Unknown, population=1"
    )

    assert _looks_placeholder_output(text) is True


def test_placeholder_output_detector_flags_collapsed_context_echo_block() -> None:
    text = (
        "Chart9:Malaria Summary KPIs Type: chart Columns: region, Total Cases, Total Tests "
        "Totalrows:15 Pre-computedanalytics: Metric'Total Cases':min=27,711,max=404,630 "
        "Highest: South Buganda (404,630) Lowest: Karamoja (134,969) "
        "Sample data (3 rows): Row1:region=Acholi, Total Cases=239,913"
    )

    assert _looks_placeholder_output(text) is True


def test_context_to_plain_text_skips_sparse_unknown_single_chart_data() -> None:
    text = _context_to_plain_text(
        {
            "chart": {"name": "Map 03", "viz_type": "unknown"},
            "query_result": {
                "columns": ["region", "population", "population under5"],
                "row_count": 1,
                "sample_rows": [
                    {"region": "Unknown", "population": 1, "population under5": 0}
                ],
            },
        }
    )

    assert "Data notice:" in text
    assert "Sample data" not in text
    assert "Pre-computed analytics:" not in text


def test_build_localai_evidence_digest_avoids_raw_sample_row_scaffolding() -> None:
    digest = _build_localai_evidence_digest(
        {
            "dashboard": {"name": "Malaria Summary"},
            "charts": [
                {
                    "chart": {"name": "Cases, Tests, and Positivity by Region"},
                    "query_result": {
                        "columns": ["region", "Total Cases", "Total Tests"],
                        "row_count": 3,
                        "sample_rows": [
                            {"region": "Acholi", "Total Cases": 239913, "Total Tests": 198814},
                            {"region": "Ankole", "Total Cases": 304699, "Total Tests": 234000},
                            {"region": "Bugisu", "Total Cases": 203798, "Total Tests": 165000},
                        ],
                    },
                }
            ],
        },
        "dashboard",
    )

    assert "Cross-chart evidence:" in digest
    assert "Rows analysed: 3" in digest
    assert "Metric '" not in digest
    assert "Sample data" not in digest
    assert "Row 1:" not in digest


def test_build_localai_evidence_digest_counts_all_meaningful_dashboard_charts() -> None:
    payload = {
        "dashboard": {"name": "Executive Dashboard"},
        "charts": [
            {
                "chart": {"name": "Chart A"},
                "query_result": {
                    "columns": ["period", "cases"],
                    "row_count": 2,
                    "sample_rows": [
                        {"period": "202601", "cases": 20},
                        {"period": "202602", "cases": 25},
                    ],
                },
            },
            {
                "chart": {"name": "Chart B"},
                "query_result": {
                    "columns": ["region", "tests"],
                    "row_count": 2,
                    "sample_rows": [
                        {"region": "North", "tests": 100},
                        {"region": "East", "tests": 90},
                    ],
                },
            },
            {
                "chart": {"name": "Chart C"},
                "query_result": {
                    "columns": ["region", "positivity"],
                    "row_count": 2,
                    "sample_rows": [
                        {"region": "North", "positivity": 0.2},
                        {"region": "East", "positivity": 0.1},
                    ],
                },
            },
        ],
    }

    digest = _build_localai_evidence_digest(payload, "dashboard")

    assert _count_meaningful_dashboard_charts(payload) == 3
    assert "Dashboard coverage: 3 of 3 charts" in digest
    assert "Chart A" in digest
    assert "Chart B" in digest
    assert "Chart C" in digest


def test_false_insufficient_output_detector_rejects_bad_dashboard_claims() -> None:
    payload = {
        "dashboard": {"name": "Executive Dashboard"},
        "charts": [
            {
                "chart": {"name": "Chart A"},
                "query_result": {
                    "columns": ["period", "cases"],
                    "row_count": 2,
                    "sample_rows": [
                        {"period": "202601", "cases": 20},
                        {"period": "202602", "cases": 25},
                    ],
                },
            },
        ],
    }

    assert _looks_false_insufficient_data_output(
        "No charts had sufficient data to generate actionable insights.",
        payload,
        "dashboard",
    )


def test_proofread_generated_insight_fixes_joined_words_and_bad_bullets() -> None:
    cleaned = _proofread_generated_insight(
        "Executive Summary:\nMalariacasesandpositivityratesfell.\n¢Leadershipwatchouts:Testingratesstable."
    )

    assert "Malaria cases" in cleaned or "malaria cases" in cleaned.lower()
    assert "positivity rates" in cleaned.lower()
    assert "- Leadership watchouts: Testing rates stable." in cleaned


def test_proofread_generated_insight_splits_long_joined_sequences() -> None:
    cleaned = _proofread_generated_insight(
        "positivityrateshaveallfallensignificantly year-over-yeardeclinesinmalariacases"
    )

    assert "positivity rates have all fallen significantly" in cleaned.lower()
    assert "year-over-year declines in malaria cases" in cleaned.lower()


def test_proofread_generated_insight_repairs_fragmented_localai_health_words() -> None:
    cleaned = _proofread_generated_insight(
        "Malari a testing has f all en in the h is t or icalrec or d. "
        "Ho sp it al admissions are r is in g."
    )

    assert "malaria testing has fallen" in cleaned.lower()
    assert "historical record" in cleaned.lower()
    assert "hospital admissions are rising" in cleaned.lower()


def test_proofread_generated_insight_repairs_split_operational_words() -> None:
    cleaned = _proofread_generated_insight(
        "The dashboard is m is s in g critical d at a to supp or t action able planning."
    )

    assert "missing critical data" in cleaned.lower()
    assert "support actionable planning" in cleaned.lower()


def test_proofread_generated_insight_removes_raw_context_scaffolding() -> None:
    cleaned = _proofread_generated_insight(
        "Chart 9: Map 03\nColumns: region, population\nRow 1: region=Unknown, population=1\n\nExecutive Summary:\nCoverage is too sparse for reliable analysis."
    )

    assert "Chart 9:" not in cleaned
    assert "Columns:" not in cleaned
    assert "Row 1:" not in cleaned
    assert "Executive Summary:" in cleaned


def test_proofread_generated_insight_removes_leaked_instruction_blocks() -> None:
    cleaned = _proofread_generated_insight(
        "Context:\n7 day moving average\n146 districts analysed\n\n"
        "Chart Summary\nMalaria positivity remains high.\n\n"
        "---\n\nWrite a concise summary of the key facts and trends in the evidence, "
        "focusing on the most important and actionable information for the leadership. "
        "Do not include the evidence or context. Do not exceed 150 words.\n\n"
        "Malaria remains widespread."
    )

    assert "Context:" not in cleaned
    assert "Write a concise summary" not in cleaned
    assert "Do not exceed 150 words" not in cleaned
    assert "Chart Summary" in cleaned


def test_proofread_generated_insight_repairs_additional_split_words() -> None:
    cleaned = _proofread_generated_insight(
        "No data quality or completeness in for m at i on. "
        "The national malaria tr an sm is si on risk is w or sen in g for vulnerable population s."
    )

    assert "information" in cleaned.lower()
    assert "transmission" in cleaned.lower()
    assert "worsening" in cleaned.lower()
    assert "populations" in cleaned.lower()


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
