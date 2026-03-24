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
"""Add org unit hierarchy configuration columns to dhis2_staged_datasets.

Adds columns that allow explicit, dataset-level control of:
- which org unit hierarchy source mode to use (primary / repository / per_instance)
- which scope to expand from selected roots (selected / children / grandchildren / all_levels)
- which hierarchy mode to use for multi-instance datasets
- a primary instance reference for primary-mode resolution
- an allowlist of org unit levels to include (prevents level-7/8 leakage)
- leaf-only flag for facility-level filtering

Revision ID: dhis2_ou_hierarchy_config_v1
Revises: 2026_03_23_add_dataset_role_column
Create Date: 2026-03-24 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "dhis2_ou_hierarchy_config_v1"
down_revision = "2026_03_23_add_dataset_role_column"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return column_name in [col["name"] for col in inspector.get_columns(table_name)]


def upgrade() -> None:
    table = "dhis2_staged_datasets"

    if not _column_exists(table, "org_unit_source_mode"):
        op.add_column(
            table,
            sa.Column("org_unit_source_mode", sa.String(length=50), nullable=True),
        )

    if not _column_exists(table, "org_unit_scope"):
        op.add_column(
            table,
            sa.Column("org_unit_scope", sa.String(length=50), nullable=True),
        )

    if not _column_exists(table, "org_unit_hierarchy_mode"):
        op.add_column(
            table,
            sa.Column("org_unit_hierarchy_mode", sa.String(length=50), nullable=True),
        )

    if not _column_exists(table, "primary_instance_id"):
        op.add_column(
            table,
            sa.Column("primary_instance_id", sa.Integer(), nullable=True),
        )
        bind = op.get_bind()
        if bind.dialect.name != "sqlite":
            op.create_foreign_key(
                "fk_dhis2_staged_datasets_primary_instance",
                table,
                "dhis2_instances",
                ["primary_instance_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if not _column_exists(table, "allowed_org_unit_levels_json"):
        op.add_column(
            table,
            sa.Column("allowed_org_unit_levels_json", sa.Text(), nullable=True),
        )

    if not _column_exists(table, "org_unit_leaf_only"):
        op.add_column(
            table,
            sa.Column(
                "org_unit_leaf_only",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    table = "dhis2_staged_datasets"

    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        try:
            op.drop_constraint(
                "fk_dhis2_staged_datasets_primary_instance",
                table,
                type_="foreignkey",
            )
        except Exception:  # pylint: disable=broad-except
            pass

    for col in [
        "org_unit_leaf_only",
        "allowed_org_unit_levels_json",
        "primary_instance_id",
        "org_unit_hierarchy_mode",
        "org_unit_scope",
        "org_unit_source_mode",
    ]:
        if _column_exists(table, col):
            op.drop_column(table, col)
