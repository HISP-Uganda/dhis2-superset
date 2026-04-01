from __future__ import annotations

import json
import logging
import re
from collections.abc import Generator
from dataclasses import dataclass
from time import perf_counter
from typing import Any

from flask import g

from superset import security_manager
from superset.ai_insights.config import (
    AI_MODE_CHART,
    AI_MODE_DASHBOARD,
    AI_MODE_SQL,
    get_ai_insights_config,
    user_can_access_ai_mode,
)
from superset.ai_insights.providers import AIProviderError, ProviderRegistry, StreamChunk
from superset.ai_insights.sql import (
    AISQLValidationError,
    build_mart_schema_context,
    ensure_mart_only_sql,
    is_mart_table,
)
from superset.daos.chart import ChartDAO
from superset.daos.dashboard import DashboardDAO
from superset.daos.database import DatabaseDAO
from superset.models.core import Database

logger = logging.getLogger(__name__)

JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


class AIInsightError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class AuditMetadata:
    mode: str
    provider: str
    model: str
    duration_ms: int
    database_backend: str | None = None
    status: str = "success"


def _trim_conversation(conversation: list[dict[str, str]]) -> list[dict[str, str]]:
    max_messages = int(get_ai_insights_config().get("max_follow_up_messages") or 6)
    if len(conversation) <= max_messages:
        return conversation
    return conversation[-max_messages:]


def _extract_json_object(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = candidate.strip("`")
        if "\n" in candidate:
            candidate = candidate.split("\n", 1)[1]
    match = JSON_BLOCK_RE.search(candidate)
    payload = match.group(0) if match else candidate
    return json.loads(payload)


def _sanitize_context_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Sanitize and prune the frontend-supplied context payload.

    Removes noisy UI-only keys from ``form_data`` and trims large arrays
    so that only analytically meaningful data reaches the LLM.
    """
    if not payload:
        return {}
    return _prune_context(payload)


# ── Context pruning ─────────────────────────────────────────────────
# form_data contains dozens of UI-styling keys that consume tokens
# without contributing analytical value.  Keep only the semantic keys.

_FORM_DATA_KEEP_KEYS = frozenset({
    # Semantic / analytical
    "datasource", "viz_type", "metrics", "metric", "percent_metrics",
    "groupby", "columns", "all_columns", "order_by_cols",
    "row_limit", "time_range", "granularity_sqla", "time_grain_sqla",
    "adhoc_filters", "where", "having",
    "order_desc", "contribution",
    # Series / pivot
    "series", "entity", "x_axis", "temporal_columns_lookup",
    # Table-specific
    "query_mode", "include_time",
    # Map-specific
    "spatial", "mapbox_style",
})


def _prune_form_data(form_data: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only analytically meaningful keys from chart form_data."""
    if not form_data:
        return {}
    return {k: v for k, v in form_data.items() if k in _FORM_DATA_KEEP_KEYS}


def _prune_context(payload: dict[str, Any]) -> dict[str, Any]:
    """Recursively prune heavy UI-only data from context payloads."""
    result = {}
    for key, value in payload.items():
        if key == "form_data" and isinstance(value, dict):
            result[key] = _prune_form_data(value)
        elif key == "chart" and isinstance(value, dict):
            result[key] = _prune_context(value)
        elif key == "charts" and isinstance(value, list):
            result[key] = [_prune_context(c) if isinstance(c, dict) else c for c in value]
        elif key == "query_result" and isinstance(value, dict):
            result[key] = _compress_query_result(value)
        else:
            result[key] = value
    return result


def _compress_query_result(qr: dict[str, Any]) -> dict[str, Any]:
    """Compress query result to save tokens: fewer rows, summarize numerics."""
    config = get_ai_insights_config()
    max_rows = int(config.get("max_context_rows") or 20)
    max_cols = int(config.get("max_context_columns") or 25)

    columns = (qr.get("columns") or [])[:max_cols]
    sample_rows = (qr.get("sample_rows") or [])[:max_rows]

    compressed: dict[str, Any] = {
        "row_count": qr.get("row_count", 0),
        "columns": columns,
    }
    if sample_rows:
        compressed["sample_rows"] = sample_rows
    # Drop applied/rejected filters if empty
    if qr.get("applied_filters"):
        compressed["applied_filters"] = qr["applied_filters"]
    return compressed


def _compact_json(obj: Any) -> str:
    """Serialize to compact JSON with no unnecessary whitespace."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str)


# ── System prompts ──────────────────────────────────────────────────
# Kept terse to minimize input tokens while retaining instruction quality.

_SYSTEM_PROMPT_CHART = (
    "You are Superset AI. Analyze ONLY the provided MART-backed chart context. "
    "Be specific, cite numbers from the data, note uncertainty. No invented facts. "
    "Give actionable health analytics insights. Be concise but thorough."
)

_SYSTEM_PROMPT_DASHBOARD = (
    "You are Superset AI. Analyze ONLY the provided MART-backed dashboard context. "
    "Synthesize cross-chart patterns, highlight anomalies, cite specific values. "
    "No invented facts. Give actionable health analytics insights. Be concise but thorough."
)

_SYSTEM_PROMPT_SQL = (
    'You are Superset MART SQL assistant. Return JSON: {"sql","explanation","assumptions","follow_ups"}. '
    "One read-only SELECT. MART tables only. Include LIMIT. Use the given dialect."
)


def _build_text_messages(
    *,
    mode: str,
    question: str,
    context_payload: dict[str, Any],
    conversation: list[dict[str, str]] | None,
) -> list[dict[str, str]]:
    if mode == AI_MODE_DASHBOARD:
        system_prompt = _SYSTEM_PROMPT_DASHBOARD
    elif mode == AI_MODE_SQL:
        system_prompt = _SYSTEM_PROMPT_SQL
    else:
        system_prompt = _SYSTEM_PROMPT_CHART

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.extend(_trim_conversation(conversation or []))
    messages.append(
        {
            "role": "user",
            "content": f"{question}\n\nContext:\n{_compact_json(context_payload)}",
        }
    )
    return messages


def _build_sql_messages(
    *,
    question: str,
    database: Database,
    mart_schema_context: list[dict[str, Any]],
    current_sql: str | None,
    conversation: list[dict[str, str]] | None,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": _SYSTEM_PROMPT_SQL}]
    messages.extend(_trim_conversation(conversation or []))

    # Compact MART schema: only table name + column names (skip types/descriptions
    # unless they exist and are short) to drastically cut input tokens.
    compact_tables = []
    for tbl in mart_schema_context:
        cols = []
        for col in tbl.get("columns") or []:
            col_entry = col["name"]
            col_type = col.get("type")
            if col_type:
                col_entry += f":{col_type}"
            cols.append(col_entry)
        entry: dict[str, Any] = {"t": tbl["table"], "cols": cols}
        if tbl.get("schema"):
            entry["s"] = tbl["schema"]
        if tbl.get("description"):
            entry["desc"] = tbl["description"][:120]
        compact_tables.append(entry)

    messages.append(
        {
            "role": "user",
            "content": _compact_json(
                {
                    "q": question,
                    "dialect": database.db_engine_spec.engine,
                    "sql": current_sql or "",
                    "tables": compact_tables,
                }
            ),
        }
    )
    return messages


def _audit(
    metadata: AuditMetadata,
    question_length: int = 0,
    response_length: int = 0,
    target_id: str | None = None,
    conversation_id: int | None = None,
) -> None:
    user_id = getattr(getattr(g, "user", None), "id", None)

    logger.info(
        "ai_insights request",
        extra={
            "mode": metadata.mode,
            "provider": metadata.provider,
            "model": metadata.model,
            "duration_ms": metadata.duration_ms,
            "database_backend": metadata.database_backend,
            "status": metadata.status,
            "user_id": user_id,
        },
    )

    # Persist to ai_usage_log table
    try:
        from superset.ai_insights.models import AIUsageLog
        from superset.extensions import db

        log_entry = AIUsageLog(
            user_id=user_id,
            conversation_id=conversation_id,
            mode=metadata.mode,
            provider_id=metadata.provider,
            model_name=metadata.model,
            question_length=question_length,
            response_length=response_length,
            duration_ms=metadata.duration_ms,
            status=metadata.status,
            target_id=target_id,
        )
        db.session.add(log_entry)
        db.session.commit()
    except Exception:  # pylint: disable=broad-except
        logger.debug("Failed to persist AI usage log", exc_info=True)


class AIInsightService:
    def __init__(self) -> None:
        self.registry = ProviderRegistry()

    def get_capabilities(self, mode: str) -> dict[str, Any]:
        if not user_can_access_ai_mode(mode):
            return {
                "enabled": False,
                "default_provider": None,
                "default_model": None,
                "providers": [],
                "allow_sql_execution": False,
                "max_context_rows": 0,
            }
        config = get_ai_insights_config()
        return {
            "enabled": True,
            **self.registry.capabilities(),
            "allow_sql_execution": bool(config.get("allow_sql_execution")),
            "max_context_rows": int(config.get("max_context_rows") or 20),
        }

    def generate_chart_insight(self, chart_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_mode_access(AI_MODE_CHART)
        chart = ChartDAO.get_by_id_or_uuid(str(chart_id))
        security_manager.raise_for_access(chart=chart)
        datasource = chart.datasource
        if datasource is None or not is_mart_table(datasource):
            raise AIInsightError("AI insights require a MART-backed chart datasource", 400)

        context_payload = _sanitize_context_payload(payload.get("context"))
        if not context_payload:
            context_payload = {
                "chart": {
                    "id": chart.id,
                    "name": chart.slice_name,
                    "viz_type": chart.viz_type,
                    "form_data": _prune_form_data(chart.form_data),
                },
                "datasource": {
                    "table_name": getattr(datasource, "table_name", None),
                    "schema": datasource.schema,
                },
            }

        question = str(payload.get("question") or "Summarize this chart")
        started_at = perf_counter()
        response = self.registry.generate(
            messages=_build_text_messages(
                mode=AI_MODE_CHART,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
            model=payload.get("model"),
        )
        total_ms = int((perf_counter() - started_at) * 1000)
        _audit(
            AuditMetadata(
                mode=AI_MODE_CHART,
                provider=response.provider_id,
                model=response.model,
                duration_ms=response.duration_ms,
                database_backend=datasource.database.backend,
            ),
            question_length=len(question),
            response_length=len(response.text),
            target_id=str(chart_id),
        )
        return {
            "mode": AI_MODE_CHART,
            "question": question,
            "insight": response.text,
            "provider": response.provider_id,
            "model": response.model,
            "duration_ms": total_ms,
        }

    def generate_dashboard_insight(
        self, dashboard_id: int | str, payload: dict[str, Any], public_mode: bool = False
    ) -> dict[str, Any]:
        from superset.ai_insights.config import AI_MODE_PUBLIC_DASHBOARD
        self._ensure_mode_access(AI_MODE_PUBLIC_DASHBOARD if public_mode else AI_MODE_DASHBOARD)
        dashboard = DashboardDAO.get_by_id_or_slug(dashboard_id)
        dashboard.raise_for_access()

        context_payload = _sanitize_context_payload(payload.get("context"))
        if not context_payload:
            max_charts = int(get_ai_insights_config().get("max_dashboard_charts") or 12)
            context_payload = {
                "dashboard": {
                    "title": dashboard.dashboard_title,
                },
                "charts": [
                    {"name": chart.slice_name, "viz_type": chart.viz_type}
                    for chart in dashboard.slices[:max_charts]
                ],
            }

        question = str(payload.get("question") or "Summarize this dashboard")
        response = self.registry.generate(
            messages=_build_text_messages(
                mode=AI_MODE_DASHBOARD,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
            model=payload.get("model"),
        )
        _audit(
            AuditMetadata(
                mode=AI_MODE_DASHBOARD,
                provider=response.provider_id,
                model=response.model,
                duration_ms=response.duration_ms,
            ),
            question_length=len(question),
            response_length=len(response.text),
            target_id=str(dashboard_id),
        )
        return {
            "mode": AI_MODE_DASHBOARD,
            "question": question,
            "insight": response.text,
            "provider": response.provider_id,
            "model": response.model,
            "duration_ms": response.duration_ms,
        }

    def assist_sql(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_mode_access(AI_MODE_SQL)
        database_id = int(payload.get("database_id") or 0)
        database = DatabaseDAO.find_by_id(database_id)
        if not database:
            raise AIInsightError("Database not found", 404)

        security_manager.raise_for_access(database=database)
        schema = payload.get("schema")
        mart_schema_context = build_mart_schema_context(database.id, schema)
        if not mart_schema_context:
            raise AIInsightError(
                "No MART tables are registered for the selected database/schema", 400
            )

        question = str(payload.get("question") or "").strip()
        if not question:
            raise AIInsightError("A question is required", 400)

        response = self.registry.generate(
            messages=_build_sql_messages(
                question=question,
                database=database,
                mart_schema_context=mart_schema_context,
                current_sql=payload.get("current_sql"),
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
            model=payload.get("model"),
        )
        try:
            structured = _extract_json_object(response.text)
        except json.JSONDecodeError as ex:
            raise AIInsightError("The AI provider returned invalid SQL metadata", 502) from ex

        sql = str(structured.get("sql") or "").strip()
        if not sql:
            raise AIInsightError("The AI provider did not generate SQL", 502)

        try:
            validation = ensure_mart_only_sql(database, sql, schema=schema)
        except AISQLValidationError as ex:
            raise AIInsightError(str(ex), 400) from ex

        result_payload: dict[str, Any] = {
            "mode": AI_MODE_SQL,
            "question": question,
            "provider": response.provider_id,
            "model": response.model,
            "sql": validation["sql"],
            "tables": validation["tables"],
            "validated": True,
            "explanation": structured.get("explanation") or "",
            "assumptions": structured.get("assumptions") or [],
            "follow_ups": structured.get("follow_ups") or [],
            "database_backend": database.backend,
        }

        config = get_ai_insights_config()
        should_execute = bool(payload.get("execute")) and bool(
            config.get("allow_sql_execution")
        )
        if should_execute:
            dataframe = database.get_df(validation["sql"], schema=schema)
            rows = dataframe.to_dict(orient="records")
            result_payload["execution"] = {
                "row_count": len(rows),
                "sample_rows": rows[: int(config.get("max_context_rows") or 20)],
            }
        else:
            result_payload["execution"] = None

        _audit(
            AuditMetadata(
                mode=AI_MODE_SQL,
                provider=response.provider_id,
                model=response.model,
                duration_ms=response.duration_ms,
                database_backend=database.backend,
            ),
            question_length=len(question),
            response_length=len(response.text),
        )
        return result_payload

    def stream_chart_insight(
        self, chart_id: int, payload: dict[str, Any]
    ) -> Generator[StreamChunk, None, None]:
        self._ensure_mode_access(AI_MODE_CHART)
        chart = ChartDAO.get_by_id_or_uuid(str(chart_id))
        security_manager.raise_for_access(chart=chart)
        datasource = chart.datasource
        if datasource is None or not is_mart_table(datasource):
            raise AIInsightError("AI insights require a MART-backed chart datasource", 400)

        context_payload = _sanitize_context_payload(payload.get("context"))
        if not context_payload:
            context_payload = {
                "chart": {
                    "id": chart.id,
                    "name": chart.slice_name,
                    "viz_type": chart.viz_type,
                    "form_data": _prune_form_data(chart.form_data),
                },
                "datasource": {
                    "table_name": getattr(datasource, "table_name", None),
                    "schema": datasource.schema,
                },
            }

        question = str(payload.get("question") or "Summarize this chart")
        yield from self.registry.generate_stream(
            messages=_build_text_messages(
                mode=AI_MODE_CHART,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
            model=payload.get("model"),
        )

    def stream_dashboard_insight(
        self, dashboard_id: int | str, payload: dict[str, Any], public_mode: bool = False
    ) -> Generator[StreamChunk, None, None]:
        from superset.ai_insights.config import AI_MODE_PUBLIC_DASHBOARD
        self._ensure_mode_access(AI_MODE_PUBLIC_DASHBOARD if public_mode else AI_MODE_DASHBOARD)
        dashboard = DashboardDAO.get_by_id_or_slug(dashboard_id)
        dashboard.raise_for_access()

        context_payload = _sanitize_context_payload(payload.get("context"))
        if not context_payload:
            max_charts = int(get_ai_insights_config().get("max_dashboard_charts") or 12)
            context_payload = {
                "dashboard": {
                    "title": dashboard.dashboard_title,
                },
                "charts": [
                    {"name": chart.slice_name, "viz_type": chart.viz_type}
                    for chart in dashboard.slices[:max_charts]
                ],
            }

        question = str(payload.get("question") or "Summarize this dashboard")
        yield from self.registry.generate_stream(
            messages=_build_text_messages(
                mode=AI_MODE_DASHBOARD,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
            model=payload.get("model"),
        )

    def _ensure_mode_access(self, mode: str) -> None:
        if not user_can_access_ai_mode(mode):
            raise AIInsightError("AI insights are not enabled for this user", 403)

