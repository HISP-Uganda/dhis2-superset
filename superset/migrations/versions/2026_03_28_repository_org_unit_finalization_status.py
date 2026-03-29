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
"""Add repository org unit finalization status columns to databases.

Revision ID: 2026_03_28_repository_org_unit_finalization_status
Revises: 2026_03_28_repair_repository_schema_backfill
Create Date: 2026-03-28 18:20:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "2026_03_28_repository_org_unit_finalization_status"
down_revision = "2026_03_28_repair_repository_schema_backfill"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return column_name in [column["name"] for column in inspector.get_columns(table_name)]


def upgrade() -> None:
    columns: tuple[tuple[str, sa.Column], ...] = (
        (
            "repository_org_unit_status",
            sa.Column("repository_org_unit_status", sa.String(length=20), nullable=True),
        ),
        (
            "repository_org_unit_status_message",
            sa.Column("repository_org_unit_status_message", sa.Text(), nullable=True),
        ),
        (
            "repository_org_unit_task_id",
            sa.Column("repository_org_unit_task_id", sa.String(length=255), nullable=True),
        ),
        (
            "repository_org_unit_last_finalized_at",
            sa.Column("repository_org_unit_last_finalized_at", sa.DateTime(), nullable=True),
        ),
    )
    for column_name, column in columns:
        if not _column_exists("dbs", column_name):
            op.add_column("dbs", column)


def downgrade() -> None:
    for column_name in [
        "repository_org_unit_last_finalized_at",
        "repository_org_unit_task_id",
        "repository_org_unit_status_message",
        "repository_org_unit_status",
    ]:
        if _column_exists("dbs", column_name):
            op.drop_column("dbs", column_name)
