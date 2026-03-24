"""Add dataset_role column

Revision ID: 2026_03_23_add_dataset_role_column
Revises: 2026_03_22_merge_public_portal_dhis2_heads
Create Date: 2026-03-23 10:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = '2026_03_23_add_dataset_role_column'
down_revision = '2026_03_22_merge_public_portal_dhis2_heads'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Check if column exists to be safe
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col['name'] for col in inspector.get_columns('tables')]

    if 'dataset_role' not in columns:
        with op.batch_alter_table('tables') as batch_op:
             batch_op.add_column(
                sa.Column(
                    'dataset_role',
                    sa.String(length=32),
                    nullable=True,
                    server_default='SERVING_DATASET'
                )
            )
        # Backfill existing NULLs to SERVING_DATASET
        op.execute("UPDATE tables SET dataset_role = 'SERVING_DATASET' WHERE dataset_role IS NULL")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col['name'] for col in inspector.get_columns('tables')]

    if 'dataset_role' in columns:
        with op.batch_alter_table('tables') as batch_op:
            batch_op.drop_column('dataset_role')
