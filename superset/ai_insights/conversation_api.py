"""REST API for AI conversation persistence."""
from __future__ import annotations

from datetime import datetime

from flask import Response, g, request
from flask_appbuilder.api import expose, protect, safe
from marshmallow import Schema, fields, ValidationError

from superset.ai_insights.config import AI_INSIGHTS_FEATURE_FLAG
from superset.ai_insights.models import AIConversation, AIConversationMessage
from superset.extensions import db
from superset.views.base_api import (
    BaseSupersetApi,
    requires_json,
    statsd_metrics,
    validate_feature_flags,
)


class CreateConversationSchema(Schema):
    mode = fields.String(required=True)
    target_id = fields.String(load_default=None, allow_none=True)
    title = fields.String(load_default=None, allow_none=True)
    provider_id = fields.String(load_default=None, allow_none=True)
    model_name = fields.String(load_default=None, allow_none=True)


class AppendMessageSchema(Schema):
    role = fields.String(required=True)
    content = fields.String(required=True)
    duration_ms = fields.Integer(load_default=None, allow_none=True)


class AIConversationRestApi(BaseSupersetApi):
    allow_browser_login = True
    class_permission_name = "AIConversation"
    resource_name = "ai/conversations"
    openapi_spec_tag = "AI"

    @expose("/", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def list_conversations(self) -> Response:
        """List conversations for current user, optionally filtered by mode/target."""
        user_id = g.user.id
        mode = request.args.get("mode")
        target_id = request.args.get("target_id")
        limit = min(int(request.args.get("limit", 50)), 200)

        query = (
            db.session.query(AIConversation)
            .filter(AIConversation.user_id == user_id)
        )
        if mode:
            query = query.filter(AIConversation.mode == mode)
        if target_id:
            query = query.filter(AIConversation.target_id == str(target_id))

        conversations = (
            query.order_by(AIConversation.updated_on.desc()).limit(limit).all()
        )
        return self.response(
            200,
            result=[c.to_dict() for c in conversations],
        )

    @expose("/", methods=("POST",))
    @protect()
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def create_conversation(self) -> Response:
        """Create a new conversation."""
        try:
            payload = CreateConversationSchema().load(request.json or {})
        except ValidationError as ex:
            return self.response_400(message=ex.messages)

        now = datetime.utcnow()
        conversation = AIConversation(
            user_id=g.user.id,
            mode=payload["mode"],
            target_id=payload.get("target_id"),
            title=payload.get("title"),
            provider_id=payload.get("provider_id"),
            model_name=payload.get("model_name"),
            created_on=now,
            updated_on=now,
        )
        db.session.add(conversation)
        db.session.commit()
        return self.response(201, result=conversation.to_dict())

    @expose("/<int:conversation_id>", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def get_conversation(self, conversation_id: int) -> Response:
        """Get a conversation with all messages."""
        conversation = db.session.query(AIConversation).get(conversation_id)
        if not conversation or conversation.user_id != g.user.id:
            return self.response_404()
        return self.response(200, result=conversation.to_dict(include_messages=True))

    @expose("/<int:conversation_id>/messages", methods=("POST",))
    @protect()
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def append_message(self, conversation_id: int) -> Response:
        """Append a message to a conversation."""
        conversation = db.session.query(AIConversation).get(conversation_id)
        if not conversation or conversation.user_id != g.user.id:
            return self.response_404()

        try:
            payload = AppendMessageSchema().load(request.json or {})
        except ValidationError as ex:
            return self.response_400(message=ex.messages)

        next_seq = len(conversation.messages) + 1
        message = AIConversationMessage(
            conversation_id=conversation.id,
            seq=next_seq,
            role=payload["role"],
            content=payload["content"],
            duration_ms=payload.get("duration_ms"),
            created_on=datetime.utcnow(),
        )
        conversation.updated_on = datetime.utcnow()
        db.session.add(message)
        db.session.commit()
        return self.response(201, result=message.to_dict())

    @expose("/<int:conversation_id>", methods=("DELETE",))
    @protect()
    @statsd_metrics
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def delete_conversation(self, conversation_id: int) -> Response:
        """Delete a conversation and all its messages."""
        conversation = db.session.query(AIConversation).get(conversation_id)
        if not conversation or conversation.user_id != g.user.id:
            return self.response_404()
        db.session.delete(conversation)
        db.session.commit()
        return self.response(200, message="Conversation deleted")

    @expose("/<int:conversation_id>/title", methods=("PUT",))
    @protect()
    @statsd_metrics
    @requires_json
    @validate_feature_flags([AI_INSIGHTS_FEATURE_FLAG])
    def update_title(self, conversation_id: int) -> Response:
        """Update the title of a conversation."""
        conversation = db.session.query(AIConversation).get(conversation_id)
        if not conversation or conversation.user_id != g.user.id:
            return self.response_404()
        title = (request.json or {}).get("title", "")
        conversation.title = title
        conversation.updated_on = datetime.utcnow()
        db.session.commit()
        return self.response(200, result=conversation.to_dict())
