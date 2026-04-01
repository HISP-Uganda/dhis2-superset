"""Push Analysis — scheduled/triggered AI insight generation.

Supports:
- Periodic dashboard briefs (e.g., daily/weekly summaries)
- Threshold-triggered alerts (metric crosses a value)
- Ad-hoc one-time analysis requests
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from flask_appbuilder import Model
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from superset.extensions import db

logger = logging.getLogger(__name__)


class PushAnalysisSchedule(Model):
    """Scheduled push analysis configuration."""

    __tablename__ = "ai_push_analysis_schedules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_id = Column(Integer, ForeignKey("ab_user.id"), nullable=False, index=True)
    name = Column(String(256), nullable=False)
    schedule_type = Column(
        String(32), nullable=False, default="periodic"
    )  # periodic | threshold | one_time
    crontab = Column(String(128), nullable=True)  # cron expression for periodic
    dashboard_id = Column(Integer, nullable=True)
    chart_id = Column(Integer, nullable=True)
    provider_id = Column(String(64), nullable=True)
    model_name = Column(String(128), nullable=True)
    question = Column(Text, nullable=True)
    config_json = Column(Text, nullable=True)  # threshold config, recipients, etc.
    enabled = Column(sa.Boolean, default=True, nullable=False)
    last_run_at = Column(DateTime, nullable=True)
    last_status = Column(String(16), nullable=True)
    created_on = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_on = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    results = relationship(
        "PushAnalysisResult",
        back_populates="schedule",
        cascade="all, delete-orphan",
        order_by="PushAnalysisResult.created_on.desc()",
    )

    @property
    def config(self) -> dict[str, Any]:
        try:
            return json.loads(self.config_json or "{}")
        except json.JSONDecodeError:
            return {}

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "owner_id": self.owner_id,
            "name": self.name,
            "schedule_type": self.schedule_type,
            "crontab": self.crontab,
            "dashboard_id": self.dashboard_id,
            "chart_id": self.chart_id,
            "provider_id": self.provider_id,
            "model_name": self.model_name,
            "question": self.question,
            "enabled": self.enabled,
            "last_run_at": self.last_run_at.isoformat() if self.last_run_at else None,
            "last_status": self.last_status,
            "created_on": self.created_on.isoformat() if self.created_on else None,
            "updated_on": self.updated_on.isoformat() if self.updated_on else None,
        }


class PushAnalysisResult(Model):
    """Stored result from a push analysis run."""

    __tablename__ = "ai_push_analysis_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    schedule_id = Column(
        Integer,
        ForeignKey("ai_push_analysis_schedules.id", ondelete="CASCADE"),
        nullable=False,
    )
    insight_text = Column(Text, nullable=True)
    provider_id = Column(String(64), nullable=True)
    model_name = Column(String(128), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    status = Column(String(16), nullable=False, default="success")
    error_message = Column(Text, nullable=True)
    created_on = Column(DateTime, default=datetime.utcnow, nullable=False)

    schedule = relationship("PushAnalysisSchedule", back_populates="results")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "schedule_id": self.schedule_id,
            "insight_text": self.insight_text,
            "provider_id": self.provider_id,
            "model_name": self.model_name,
            "duration_ms": self.duration_ms,
            "status": self.status,
            "error_message": self.error_message,
            "created_on": self.created_on.isoformat() if self.created_on else None,
        }
