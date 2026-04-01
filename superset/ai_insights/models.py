"""Database models for AI conversation persistence and usage tracking."""
from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from flask_appbuilder import Model
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship


class AIConversation(Model):
    """Persisted AI conversation session."""

    __tablename__ = "ai_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("ab_user.id"), nullable=False, index=True)
    mode = Column(String(32), nullable=False)  # chart | dashboard | sql
    target_id = Column(String(128), nullable=True)  # chart_id, dashboard_id, etc.
    title = Column(String(256), nullable=True)
    provider_id = Column(String(64), nullable=True)
    model_name = Column(String(128), nullable=True)
    created_on = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_on = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    messages = relationship(
        "AIConversationMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="AIConversationMessage.seq",
    )

    def to_dict(self, include_messages: bool = False) -> dict:
        result = {
            "id": self.id,
            "user_id": self.user_id,
            "mode": self.mode,
            "target_id": self.target_id,
            "title": self.title,
            "provider_id": self.provider_id,
            "model_name": self.model_name,
            "created_on": self.created_on.isoformat() if self.created_on else None,
            "updated_on": self.updated_on.isoformat() if self.updated_on else None,
            "message_count": len(self.messages) if self.messages else 0,
        }
        if include_messages:
            result["messages"] = [m.to_dict() for m in (self.messages or [])]
        return result


class AIConversationMessage(Model):
    """Single message within an AI conversation."""

    __tablename__ = "ai_conversation_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(
        Integer, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False
    )
    seq = Column(Integer, nullable=False)
    role = Column(String(16), nullable=False)  # user | assistant | system
    content = Column(Text, nullable=False)
    duration_ms = Column(Integer, nullable=True)
    created_on = Column(DateTime, default=datetime.utcnow, nullable=False)

    conversation = relationship("AIConversation", back_populates="messages")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "seq": self.seq,
            "role": self.role,
            "content": self.content,
            "duration_ms": self.duration_ms,
            "created_on": self.created_on.isoformat() if self.created_on else None,
        }


class AIUsageLog(Model):
    """Structured audit log for AI usage analytics."""

    __tablename__ = "ai_usage_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("ab_user.id"), nullable=True, index=True)
    conversation_id = Column(
        Integer, ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True
    )
    mode = Column(String(32), nullable=False)
    provider_id = Column(String(64), nullable=False)
    model_name = Column(String(128), nullable=False)
    question_length = Column(Integer, nullable=True)
    response_length = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    status = Column(String(16), nullable=False, default="success")
    error_message = Column(Text, nullable=True)
    target_id = Column(String(128), nullable=True)
    created_on = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
