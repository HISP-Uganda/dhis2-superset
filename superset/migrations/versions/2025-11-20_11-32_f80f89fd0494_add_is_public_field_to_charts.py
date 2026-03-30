# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""Add is_public field to charts

Revision ID: f80f89fd0494
Revises: c233f5365c9e
Create Date: 2025-11-20 11:32:17.533327

"""

# revision identifiers, used by Alembic.
revision = 'f80f89fd0494'
down_revision = 'c233f5365c9e'

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


def upgrade():
    # Add is_public column to slices table with default value
    # Check if column already exists to avoid duplicate column error
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col['name'] for col in inspector.get_columns('slices')]

    if 'is_public' not in columns:
        # SQLite doesn't support ALTER COLUMN, so we add with nullable=False and server_default directly
        with op.batch_alter_table('slices') as batch_op:
            batch_op.add_column(
                sa.Column('is_public', sa.Boolean(), nullable=False, server_default=sa.false())
            )


def downgrade():
    # Remove is_public column
    op.drop_column('slices', 'is_public')
