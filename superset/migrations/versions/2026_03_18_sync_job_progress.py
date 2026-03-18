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
"""Add fine-grained progress fields to dhis2_sync_jobs.

Revision ID: dhis2_sync_progress_v1
Revises: dhis2_warehouse_v1
Create Date: 2026-03-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "dhis2_sync_progress_v1"
down_revision = "dhis2_warehouse_v1"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    new_columns = [
        ("total_units", sa.Integer(), None),
        ("completed_units", sa.Integer(), None),
        ("failed_units", sa.Integer(), None),
        ("percent_complete", sa.Float(), None),
        ("current_step", sa.String(100), None),
        ("current_item", sa.String(255), None),
        ("rows_extracted", sa.Integer(), None),
        ("rows_staged", sa.Integer(), None),
        ("rows_merged", sa.Integer(), None),
        ("error_summary", sa.Text(), None),
    ]
    for col_name, col_type, _ in new_columns:
        if not _column_exists("dhis2_sync_jobs", col_name):
            op.add_column(
                "dhis2_sync_jobs",
                sa.Column(col_name, col_type, nullable=True),
            )


def downgrade() -> None:
    columns_to_drop = [
        "total_units",
        "completed_units",
        "failed_units",
        "percent_complete",
        "current_step",
        "current_item",
        "rows_extracted",
        "rows_staged",
        "rows_merged",
        "error_summary",
    ]
    for col_name in columns_to_drop:
        if _column_exists("dhis2_sync_jobs", col_name):
            op.drop_column("dhis2_sync_jobs", col_name)
