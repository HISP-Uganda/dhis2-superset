"""Fix AI insights encrypted secrets storage type

Revision ID: 2026_04_03_fix_ai_insights_encrypted_secrets_type
Revises: 2026_04_02_push_analysis_enhancements
Create Date: 2026-04-03 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "2026_04_03_fix_ai_insights_encrypted_secrets_type"
down_revision = "2026_04_02_push_analysis_enhancements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"]: column for column in inspector.get_columns("ai_insights_settings")}
    encrypted_secrets = columns.get("encrypted_secrets")
    if not encrypted_secrets:
        return

    dialect_name = bind.dialect.name
    column_type = str(encrypted_secrets["type"]).lower()

    if dialect_name == "postgresql" and "bytea" not in column_type:
        op.execute(
            """
            ALTER TABLE ai_insights_settings
            ALTER COLUMN encrypted_secrets TYPE BYTEA
            USING CASE
                WHEN encrypted_secrets IS NULL THEN NULL
                ELSE convert_to(encrypted_secrets, 'UTF8')
            END
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"]: column for column in inspector.get_columns("ai_insights_settings")}
    encrypted_secrets = columns.get("encrypted_secrets")
    if not encrypted_secrets:
        return

    dialect_name = bind.dialect.name
    column_type = str(encrypted_secrets["type"]).lower()

    if dialect_name == "postgresql" and "text" not in column_type:
        op.execute(
            """
            ALTER TABLE ai_insights_settings
            ALTER COLUMN encrypted_secrets TYPE TEXT
            USING CASE
                WHEN encrypted_secrets IS NULL THEN NULL
                ELSE convert_from(encrypted_secrets, 'UTF8')
            END
            """
        )
    elif dialect_name != "postgresql":
        with op.batch_alter_table("ai_insights_settings") as batch_op:
            batch_op.alter_column(
                "encrypted_secrets",
                existing_type=sa.LargeBinary(),
                type_=sa.Text(),
                existing_nullable=True,
            )
