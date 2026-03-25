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
"""Add is_dhis2_staging_internal column to Database

Revision ID: 2026_03_25_database_staging_internal_column
Revises: dhis2_ou_hierarchy_config_v1
Create Date: 2026-03-25 10:00:00.000000

"""
from __future__ import annotations

import json
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = '2026_03_25_database_staging_internal_column'
down_revision = 'dhis2_ou_hierarchy_config_v1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add the column
    with op.batch_alter_table('dbs') as batch_op:
        batch_op.add_column(
            sa.Column(
                'is_dhis2_staging_internal',
                sa.Boolean(),
                nullable=False,
                server_default=sa.false()
            )
        )

    # Data migration: backfill from extra
    bind = op.get_bind()
    
    # Use raw SQL to fetch databases to avoid ORM issues during migration
    dbs = bind.execute(sa.text("SELECT id, extra FROM dbs")).fetchall()
    for row in dbs:
        db_id, extra_str = row
        if extra_str:
            try:
                extra = json.loads(extra_str)
                if isinstance(extra, dict) and extra.get('dhis2_staging_internal') is True:
                    bind.execute(
                        sa.text("UPDATE dbs SET is_dhis2_staging_internal = :val WHERE id = :id"),
                        {"val": True, "id": db_id}
                    )
            except (ValueError, json.JSONDecodeError):
                continue


def downgrade() -> None:
    with op.batch_alter_table('dbs') as batch_op:
        batch_op.drop_column('is_dhis2_staging_internal')
