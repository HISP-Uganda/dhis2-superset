"""REST API for push analysis schedule management."""
from __future__ import annotations

import json
from datetime import datetime

from flask import Response, g, request
from flask_appbuilder.api import expose, protect, safe
from marshmallow import Schema, fields, ValidationError

from superset.ai_insights.config import AI_INSIGHTS_FEATURE_FLAG
from superset.ai_insights.push_analysis import PushAnalysisResult, PushAnalysisSchedule
from superset.extensions import db
from superset.tasks.ai_push_analysis import execute_push_analysis_schedule
from superset.views.base_api import (
    BaseSupersetApi,
    requires_json,
    statsd_metrics,
    validate_feature_flags,
)


class CreateScheduleSchema(Schema):
    name = fields.String(required=True)
    schedule_type = fields.String(load_default="periodic")
    crontab = fields.String(load_default=None, allow_none=True)
    dashboard_id = fields.Integer(load_default=None, allow_none=True)
    chart_id = fields.Integer(load_default=None, allow_none=True)
    provider_id = fields.String(load_default=None, allow_none=True)
    model_name = fields.String(load_default=None, allow_none=True)
    question = fields.String(load_default=None, allow_none=True)
    config = fields.Dict(load_default=dict)
    enabled = fields.Boolean(load_default=True)


class AIPushAnalysisRestApi(BaseSupersetApi):
    allow_browser_login = True
    class_permission_name = "AIManagement"
    resource_name = "ai/push-analysis"
    openapi_spec_tag = "AI"

    @expose("/", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def list_schedules(self) -> Response:
        """List push analysis schedules for the current user."""
        user_id = g.user.id
        schedules = (
            db.session.query(PushAnalysisSchedule)
            .filter(PushAnalysisSchedule.owner_id == user_id)
            .order_by(PushAnalysisSchedule.updated_on.desc())
            .all()
        )
        return self.response(200, result=[s.to_dict() for s in schedules])

    @expose("/", methods=("POST",))
    @protect()
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def create_schedule(self) -> Response:
        """Create a new push analysis schedule."""
        try:
            payload = CreateScheduleSchema().load(request.json or {})
        except ValidationError as ex:
            return self.response_400(message=ex.messages)

        now = datetime.utcnow()
        schedule = PushAnalysisSchedule(
            owner_id=g.user.id,
            name=payload["name"],
            schedule_type=payload.get("schedule_type", "periodic"),
            crontab=payload.get("crontab"),
            dashboard_id=payload.get("dashboard_id"),
            chart_id=payload.get("chart_id"),
            provider_id=payload.get("provider_id"),
            model_name=payload.get("model_name"),
            question=payload.get("question"),
            config_json=json.dumps(payload.get("config", {})),
            enabled=payload.get("enabled", True),
            created_on=now,
            updated_on=now,
        )
        db.session.add(schedule)
        db.session.commit()
        return self.response(201, result=schedule.to_dict())

    @expose("/<int:schedule_id>", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def get_schedule(self, schedule_id: int) -> Response:
        schedule = db.session.query(PushAnalysisSchedule).get(schedule_id)
        if not schedule or schedule.owner_id != g.user.id:
            return self.response_404()
        result = schedule.to_dict()
        result["results"] = [
            r.to_dict()
            for r in (schedule.results or [])[:20]
        ]
        return self.response(200, result=result)

    @expose("/<int:schedule_id>", methods=("PUT",))
    @protect()
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def update_schedule(self, schedule_id: int) -> Response:
        schedule = db.session.query(PushAnalysisSchedule).get(schedule_id)
        if not schedule or schedule.owner_id != g.user.id:
            return self.response_404()

        payload = request.json or {}
        for field in (
            "name", "schedule_type", "crontab", "dashboard_id", "chart_id",
            "provider_id", "model_name", "question", "enabled",
        ):
            if field in payload:
                setattr(schedule, field, payload[field])
        if "config" in payload:
            schedule.config_json = json.dumps(payload["config"])
        schedule.updated_on = datetime.utcnow()
        db.session.commit()
        return self.response(200, result=schedule.to_dict())

    @expose("/<int:schedule_id>", methods=("DELETE",))
    @protect()
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def delete_schedule(self, schedule_id: int) -> Response:
        schedule = db.session.query(PushAnalysisSchedule).get(schedule_id)
        if not schedule or schedule.owner_id != g.user.id:
            return self.response_404()
        db.session.delete(schedule)
        db.session.commit()
        return self.response(200, message="Schedule deleted")

    @expose("/<int:schedule_id>/run", methods=("POST",))
    @protect()
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def trigger_run(self, schedule_id: int) -> Response:
        """Manually trigger a push analysis run."""
        schedule = db.session.query(PushAnalysisSchedule).get(schedule_id)
        if not schedule or schedule.owner_id != g.user.id:
            return self.response_404()
        execute_push_analysis_schedule.delay(schedule.id)
        return self.response(202, message="Push analysis triggered")
