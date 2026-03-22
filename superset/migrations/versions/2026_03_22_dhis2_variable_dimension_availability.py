# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file to You under
# the Apache License, Version 2.0 (the "License"); you may not use this
# file except in compliance with the License.  You may obtain a copy of the
# License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Persist per-variable dimension availability metadata for DHIS2 datasets.

Revision ID: dhis2_variable_dimension_availability_v1
Revises: dhis2_sync_progress_v1
Create Date: 2026-03-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "dhis2_variable_dimension_availability_v1"
down_revision = "dhis2_sync_progress_v1"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(
        column["name"] == column_name for column in inspector.get_columns(table_name)
    )


def upgrade() -> None:
    if not _column_exists("dhis2_dataset_variables", "dimension_availability_json"):
        op.add_column(
            "dhis2_dataset_variables",
            sa.Column("dimension_availability_json", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("dhis2_dataset_variables", "dimension_availability_json"):
        op.drop_column("dhis2_dataset_variables", "dimension_availability_json")
