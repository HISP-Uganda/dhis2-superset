from __future__ import annotations

import json
import logging
import re
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
from superset.ai_insights.providers import AIProviderError, ProviderRegistry
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
    if not payload:
        return {}
    return payload


def _build_text_messages(
    *,
    mode: str,
    question: str,
    context_payload: dict[str, Any],
    conversation: list[dict[str, str]] | None,
) -> list[dict[str, str]]:
    system_prompt = (
        "You are the Superset AI Insight module. Ground every answer only in the "
        "provided MART-backed chart, dashboard, or SQL context. Do not invent facts, "
        "do not make causal claims, and explicitly note uncertainty when the data is insufficient."
    )
    if mode == AI_MODE_DASHBOARD:
        system_prompt += " You are answering against dashboard context."
    elif mode == AI_MODE_SQL:
        system_prompt += " You are answering against MART SQL analysis context."
    else:
        system_prompt += " You are answering against chart context."

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.extend(_trim_conversation(conversation or []))
    messages.append(
        {
            "role": "user",
            "content": (
                f"Question:\n{question}\n\n"
                f"Context:\n{json.dumps(context_payload, ensure_ascii=True, default=str)}"
            ),
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
    system_prompt = (
        "You are the Superset MART SQL assistant. Return a strict JSON object with the keys "
        '"sql", "explanation", "assumptions", and "follow_ups". '
        "Generate one read-only SELECT statement only. Query MART tables only. "
        "Use the active database dialect and include a LIMIT."
    )
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.extend(_trim_conversation(conversation or []))
    messages.append(
        {
            "role": "user",
            "content": json.dumps(
                {
                    "question": question,
                    "database_backend": database.backend,
                    "database_engine": database.db_engine_spec.engine,
                    "current_sql": current_sql or "",
                    "mart_tables": mart_schema_context,
                },
                ensure_ascii=True,
                default=str,
            ),
        }
    )
    return messages


def _audit(metadata: AuditMetadata) -> None:
    logger.info(
        "ai_insights request",
        extra={
            "mode": metadata.mode,
            "provider": metadata.provider,
            "model": metadata.model,
            "duration_ms": metadata.duration_ms,
            "database_backend": metadata.database_backend,
            "status": metadata.status,
            "user_id": getattr(getattr(g, "user", None), "id", None),
        },
    )


class AIInsightService:
    def __init__(self) -> None:
        self.registry = ProviderRegistry()

    def get_capabilities(self, mode: str) -> dict[str, Any]:
        self._ensure_mode_access(mode)
        config = get_ai_insights_config()
        return {
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
                    "form_data": chart.form_data,
                },
                "datasource": {
                    "id": datasource.id,
                    "table_name": getattr(datasource, "table_name", None),
                    "schema": datasource.schema,
                    "database_backend": datasource.database.backend,
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
        _audit(
            AuditMetadata(
                mode=AI_MODE_CHART,
                provider=response.provider_id,
                model=response.model,
                duration_ms=response.duration_ms,
                database_backend=datasource.database.backend,
            )
        )
        return {
            "mode": AI_MODE_CHART,
            "question": question,
            "insight": response.text,
            "provider": response.provider_id,
            "model": response.model,
            "duration_ms": int((perf_counter() - started_at) * 1000),
        }

    def generate_dashboard_insight(
        self, dashboard_id: int | str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        self._ensure_mode_access(AI_MODE_DASHBOARD)
        dashboard = DashboardDAO.get_by_id_or_slug(dashboard_id)
        dashboard.raise_for_access()

        context_payload = _sanitize_context_payload(payload.get("context"))
        if not context_payload:
            context_payload = {
                "dashboard": {
                    "id": dashboard.id,
                    "title": dashboard.dashboard_title,
                },
                "charts": [
                    {
                        "id": chart.id,
                        "name": chart.slice_name,
                        "viz_type": chart.viz_type,
                    }
                    for chart in dashboard.slices
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
            )
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
            )
        )
        return result_payload

    def _ensure_mode_access(self, mode: str) -> None:
        if not user_can_access_ai_mode(mode):
            raise AIInsightError("AI insights are not enabled for this user", 403)

