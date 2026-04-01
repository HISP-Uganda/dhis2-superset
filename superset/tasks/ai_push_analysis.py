"""Celery tasks for AI push analysis — scheduled and triggered insight generation."""
from __future__ import annotations

import logging
from datetime import datetime
from time import perf_counter
from typing import Any

from celery.exceptions import SoftTimeLimitExceeded
from flask import current_app, g

from superset import is_feature_enabled
from superset.extensions import celery_app, db

logger = logging.getLogger(__name__)


@celery_app.task(
    name="ai_push_analysis.execute_schedule",
    bind=True,
    soft_time_limit=120,
    time_limit=180,
)
def execute_push_analysis_schedule(self: Any, schedule_id: int) -> None:
    """Execute a single push analysis schedule and store the result."""
    from superset.ai_insights.config import (  # noqa: F811
        AI_INSIGHTS_FEATURE_FLAG,
        AI_MODE_CHART,
        AI_MODE_DASHBOARD,
        get_ai_insights_config,
    )
    from superset.ai_insights.providers import AIProviderError, ProviderRegistry
    from superset.ai_insights.push_analysis import PushAnalysisResult, PushAnalysisSchedule
    from superset.ai_insights.service import _build_text_messages

    if not is_feature_enabled(AI_INSIGHTS_FEATURE_FLAG):
        logger.info("AI_INSIGHTS feature flag disabled, skipping push analysis")
        return

    schedule = db.session.query(PushAnalysisSchedule).get(schedule_id)
    if not schedule or not schedule.enabled:
        logger.info("Schedule %s not found or disabled", schedule_id)
        return

    started_at = perf_counter()
    try:
        context_payload = _build_push_context(schedule)
        mode = AI_MODE_DASHBOARD if schedule.dashboard_id else AI_MODE_CHART
        question = schedule.question or f"Provide a brief summary for this {mode}"

        messages = _build_text_messages(
            mode=mode,
            question=question,
            context_payload=context_payload,
            conversation=[],
        )

        config = get_ai_insights_config()
        registry = ProviderRegistry(config)
        response = registry.generate(
            messages=messages,
            provider_id=schedule.provider_id,
            model=schedule.model_name,
        )

        duration_ms = int((perf_counter() - started_at) * 1000)
        result = PushAnalysisResult(
            schedule_id=schedule.id,
            insight_text=response.text,
            provider_id=response.provider_id,
            model_name=response.model,
            duration_ms=duration_ms,
            status="success",
            created_on=datetime.utcnow(),
        )
        schedule.last_run_at = datetime.utcnow()
        schedule.last_status = "success"
        db.session.add(result)
        db.session.commit()

        logger.info(
            "Push analysis schedule %s completed in %dms",
            schedule_id,
            duration_ms,
        )

        # Notify recipients if configured
        recipients = schedule.config.get("recipients", [])
        if recipients:
            _notify_recipients(schedule, result, recipients)

    except (AIProviderError, SoftTimeLimitExceeded) as ex:
        duration_ms = int((perf_counter() - started_at) * 1000)
        error_msg = str(ex)
        result = PushAnalysisResult(
            schedule_id=schedule.id,
            insight_text=None,
            duration_ms=duration_ms,
            status="error",
            error_message=error_msg,
            created_on=datetime.utcnow(),
        )
        schedule.last_run_at = datetime.utcnow()
        schedule.last_status = "error"
        db.session.add(result)
        db.session.commit()
        logger.error(
            "Push analysis schedule %s failed: %s", schedule_id, error_msg
        )

    except Exception:  # pylint: disable=broad-except
        db.session.rollback()
        logger.exception("Unexpected error in push analysis schedule %s", schedule_id)


@celery_app.task(
    name="ai_push_analysis.run_all_due",
    bind=True,
    soft_time_limit=300,
)
def run_all_due_push_analyses(self: Any) -> None:
    """Scan all enabled push analysis schedules and execute those that are due.

    This is intended to be called periodically (e.g., every minute) by Celery Beat.
    """
    from superset.ai_insights.config import AI_INSIGHTS_FEATURE_FLAG  # noqa: F811
    from superset.ai_insights.push_analysis import PushAnalysisSchedule

    if not is_feature_enabled(AI_INSIGHTS_FEATURE_FLAG):
        return

    schedules = (
        db.session.query(PushAnalysisSchedule)
        .filter(PushAnalysisSchedule.enabled.is_(True))
        .all()
    )

    for schedule in schedules:
        if _is_schedule_due(schedule):
            execute_push_analysis_schedule.delay(schedule.id)


def _build_push_context(schedule: Any) -> dict[str, Any]:
    """Build context payload for the push analysis."""
    from superset.daos.chart import ChartDAO
    from superset.daos.dashboard import DashboardDAO

    context: dict[str, Any] = {}

    if schedule.dashboard_id:
        dashboard = DashboardDAO.find_by_id(schedule.dashboard_id)
        if dashboard:
            context["dashboard"] = {
                "id": dashboard.id,
                "title": dashboard.dashboard_title,
            }
            context["charts"] = [
                {
                    "id": chart.id,
                    "name": chart.slice_name,
                    "viz_type": chart.viz_type,
                }
                for chart in (dashboard.slices or [])[:12]
            ]
    elif schedule.chart_id:
        chart = ChartDAO.find_by_id(schedule.chart_id)
        if chart:
            context["chart"] = {
                "id": chart.id,
                "name": chart.slice_name,
                "viz_type": chart.viz_type,
                "form_data": chart.form_data,
            }
            datasource = chart.datasource
            if datasource:
                context["datasource"] = {
                    "id": datasource.id,
                    "table_name": getattr(datasource, "table_name", None),
                    "schema": datasource.schema,
                }

    extra_config = schedule.config
    if extra_config.get("additional_instructions"):
        context["instructions"] = extra_config["additional_instructions"]

    return context


def _is_schedule_due(schedule: PushAnalysisSchedule) -> bool:
    """Check if a periodic schedule should run now."""
    if schedule.schedule_type == "one_time":
        return schedule.last_run_at is None

    if schedule.schedule_type != "periodic" or not schedule.crontab:
        return False

    try:
        from superset.tasks.cron_util import cron_schedule_window

        since = schedule.last_run_at or schedule.created_on
        dttm_list = cron_schedule_window(since, schedule.crontab, "UTC")
        return len(dttm_list) > 0
    except Exception:  # pylint: disable=broad-except
        logger.warning("Invalid crontab for schedule %s: %s", schedule.id, schedule.crontab)
        return False


def _notify_recipients(
    schedule: PushAnalysisSchedule,
    result: PushAnalysisResult,
    recipients: list[dict[str, str]],
) -> None:
    """Send notification to recipients (email, Slack, etc.).

    This is a placeholder that logs the notification. In production,
    integrate with the existing Superset report/alert notification system.
    """
    for recipient in recipients:
        channel = recipient.get("type", "log")
        target = recipient.get("target", "")
        logger.info(
            "Push analysis notification [%s → %s]: Schedule '%s' completed. "
            "Insight preview: %.200s",
            channel,
            target,
            schedule.name,
            result.insight_text or "",
        )
