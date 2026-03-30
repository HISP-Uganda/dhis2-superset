"""Persist AI insights management settings

Revision ID: 2026_03_29_ai_insights_settings
Revises: 2026_03_28_repository_org_unit_finalization_status
Create Date: 2026-03-29 10:15:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "2026_03_29_ai_insights_settings"
down_revision = "2026_03_28_repository_org_unit_finalization_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_insights_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("config_json", sa.Text(), nullable=True),
        sa.Column("encrypted_secrets", sa.Text(), nullable=True),
        sa.Column("changed_on", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("ai_insights_settings")
