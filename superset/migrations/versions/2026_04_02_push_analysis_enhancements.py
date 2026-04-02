"""Add push analysis recipients, report format, PDF storage

Revision ID: 2026_04_02_push_analysis_enhancements
Revises: 2026_04_01_ai_conversations_and_usage
Create Date: 2026-04-02 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "2026_04_02_push_analysis_enhancements"
down_revision = "2026_04_01_ai_conversations_and_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to ai_push_analysis_schedules
    with op.batch_alter_table("ai_push_analysis_schedules") as batch_op:
        batch_op.add_column(
            sa.Column("recipients_json", sa.Text(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "report_format",
                sa.String(16),
                nullable=False,
                server_default="pdf",
            )
        )
        batch_op.add_column(
            sa.Column(
                "include_charts",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            )
        )
        batch_op.add_column(
            sa.Column("subject_line", sa.String(512), nullable=True)
        )
        batch_op.add_column(
            sa.Column("last_error", sa.Text(), nullable=True)
        )

    # Add new columns to ai_push_analysis_results
    with op.batch_alter_table("ai_push_analysis_results") as batch_op:
        batch_op.add_column(
            sa.Column("report_pdf", sa.LargeBinary(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "recipients_notified",
                sa.Integer(),
                nullable=True,
                server_default="0",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("ai_push_analysis_results") as batch_op:
        batch_op.drop_column("recipients_notified")
        batch_op.drop_column("report_pdf")

    with op.batch_alter_table("ai_push_analysis_schedules") as batch_op:
        batch_op.drop_column("last_error")
        batch_op.drop_column("subject_line")
        batch_op.drop_column("include_charts")
        batch_op.drop_column("report_format")
        batch_op.drop_column("recipients_json")
