"""Add AI conversation persistence and usage log tables

Revision ID: 2026_04_01_ai_conversations_and_usage
Revises: 2026_03_29_ai_insights_settings
Create Date: 2026-04-01 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "2026_04_01_ai_conversations_and_usage"
down_revision = "2026_03_29_ai_insights_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_conversations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("ab_user.id"), nullable=False),
        sa.Column("mode", sa.String(32), nullable=False),
        sa.Column("target_id", sa.String(128), nullable=True),
        sa.Column("title", sa.String(256), nullable=True),
        sa.Column("provider_id", sa.String(64), nullable=True),
        sa.Column("model_name", sa.String(128), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=False),
        sa.Column("updated_on", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_conversations_user_id", "ai_conversations", ["user_id"])

    op.create_table(
        "ai_conversation_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "ai_usage_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("ab_user.id"), nullable=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("ai_conversations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("mode", sa.String(32), nullable=False),
        sa.Column("provider_id", sa.String(64), nullable=False),
        sa.Column("model_name", sa.String(128), nullable=False),
        sa.Column("question_length", sa.Integer(), nullable=True),
        sa.Column("response_length", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="success"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("target_id", sa.String(128), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_usage_log_user_id", "ai_usage_log", ["user_id"])
    op.create_index("ix_ai_usage_log_created_on", "ai_usage_log", ["created_on"])

    # Push Analysis tables
    op.create_table(
        "ai_push_analysis_schedules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("ab_user.id"), nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("schedule_type", sa.String(32), nullable=False, server_default="periodic"),
        sa.Column("crontab", sa.String(128), nullable=True),
        sa.Column("dashboard_id", sa.Integer(), nullable=True),
        sa.Column("chart_id", sa.Integer(), nullable=True),
        sa.Column("provider_id", sa.String(64), nullable=True),
        sa.Column("model_name", sa.String(128), nullable=True),
        sa.Column("question", sa.Text(), nullable=True),
        sa.Column("config_json", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("last_status", sa.String(16), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=False),
        sa.Column("updated_on", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_push_analysis_schedules_owner_id",
        "ai_push_analysis_schedules",
        ["owner_id"],
    )

    op.create_table(
        "ai_push_analysis_results",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "schedule_id",
            sa.Integer(),
            sa.ForeignKey("ai_push_analysis_schedules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("insight_text", sa.Text(), nullable=True),
        sa.Column("provider_id", sa.String(64), nullable=True),
        sa.Column("model_name", sa.String(128), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="success"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("ai_push_analysis_results")
    op.drop_table("ai_push_analysis_schedules")
    op.drop_table("ai_usage_log")
    op.drop_table("ai_conversation_messages")
    op.drop_table("ai_conversations")
