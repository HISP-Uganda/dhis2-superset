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
"""Add DHIS2 repository reporting unit persistence to databases.

Revision ID: 2026_03_28_database_repository_org_units
Revises: 2026_03_26_backfill_dhis2_dataset_roles
Create Date: 2026-03-28 10:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "2026_03_28_database_repository_org_units"
down_revision = "2026_03_26_backfill_dhis2_dataset_roles"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    inspector = inspect(op.get_bind())
    return column_name in [column["name"] for column in inspector.get_columns(table_name)]


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if not _column_exists("dbs", "repository_reporting_unit_approach"):
        op.add_column(
            "dbs",
            sa.Column("repository_reporting_unit_approach", sa.String(length=50), nullable=True),
        )
    if not _column_exists("dbs", "lowest_data_level_to_use"):
        op.add_column(
            "dbs",
            sa.Column("lowest_data_level_to_use", sa.Integer(), nullable=True),
        )
    if not _column_exists("dbs", "primary_instance_id"):
        op.add_column(
            "dbs",
            sa.Column("primary_instance_id", sa.Integer(), nullable=True),
        )
        if dialect != "sqlite":
            op.create_foreign_key(
                "fk_dbs_primary_instance_id_dhis2_instances",
                "dbs",
                "dhis2_instances",
                ["primary_instance_id"],
                ["id"],
                ondelete="SET NULL",
            )
    if not _column_exists("dbs", "repository_data_scope"):
        op.add_column(
            "dbs",
            sa.Column("repository_data_scope", sa.String(length=50), nullable=True),
        )
    if not _column_exists("dbs", "repository_org_unit_config_json"):
        op.add_column(
            "dbs",
            sa.Column("repository_org_unit_config_json", sa.Text(), nullable=True),
        )

    if not _table_exists("dhis2_repository_org_units"):
        op.create_table(
            "dhis2_repository_org_units",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("database_id", sa.Integer(), nullable=False),
            sa.Column("repository_key", sa.String(length=255), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=False),
            sa.Column("parent_repository_key", sa.String(length=255), nullable=True),
            sa.Column("level", sa.Integer(), nullable=True),
            sa.Column("hierarchy_path", sa.Text(), nullable=True),
            sa.Column("selection_key", sa.String(length=255), nullable=True),
            sa.Column("strategy", sa.String(length=50), nullable=True),
            sa.Column("source_lineage_label", sa.String(length=50), nullable=True),
            sa.Column(
                "is_conflicted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "is_unmatched",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("provenance_json", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["database_id"], ["dbs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "database_id",
                "repository_key",
                name="uq_dhis2_repository_org_units_db_key",
            ),
        )
        op.create_index(
            "ix_dhis2_repository_org_units_database_id",
            "dhis2_repository_org_units",
            ["database_id"],
            unique=False,
        )
        op.create_index(
            "ix_dhis2_repository_org_units_database_id_level",
            "dhis2_repository_org_units",
            ["database_id", "level"],
            unique=False,
        )

    if not _table_exists("dhis2_repository_org_unit_lineage"):
        op.create_table(
            "dhis2_repository_org_unit_lineage",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("repository_org_unit_id", sa.Integer(), nullable=False),
            sa.Column("database_id", sa.Integer(), nullable=False),
            sa.Column("instance_id", sa.Integer(), nullable=False),
            sa.Column("source_instance_role", sa.String(length=50), nullable=True),
            sa.Column("source_instance_code", sa.String(length=20), nullable=True),
            sa.Column("source_org_unit_uid", sa.String(length=255), nullable=False),
            sa.Column("source_org_unit_name", sa.String(length=255), nullable=True),
            sa.Column("source_parent_uid", sa.String(length=255), nullable=True),
            sa.Column("source_path", sa.Text(), nullable=True),
            sa.Column("source_level", sa.Integer(), nullable=True),
            sa.Column("provenance_json", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(
                ["repository_org_unit_id"],
                ["dhis2_repository_org_units.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["database_id"], ["dbs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["instance_id"],
                ["dhis2_instances.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "repository_org_unit_id",
                "instance_id",
                "source_org_unit_uid",
                name="uq_dhis2_repository_org_unit_lineage",
            ),
        )
        op.create_index(
            "ix_dhis2_repository_org_unit_lineage_database_id",
            "dhis2_repository_org_unit_lineage",
            ["database_id"],
            unique=False,
        )
        op.create_index(
            "ix_dhis2_repository_org_unit_lineage_instance_id",
            "dhis2_repository_org_unit_lineage",
            ["instance_id"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if _table_exists("dhis2_repository_org_unit_lineage"):
        op.drop_index(
            "ix_dhis2_repository_org_unit_lineage_instance_id",
            table_name="dhis2_repository_org_unit_lineage",
        )
        op.drop_index(
            "ix_dhis2_repository_org_unit_lineage_database_id",
            table_name="dhis2_repository_org_unit_lineage",
        )
        op.drop_table("dhis2_repository_org_unit_lineage")

    if _table_exists("dhis2_repository_org_units"):
        op.drop_index(
            "ix_dhis2_repository_org_units_database_id_level",
            table_name="dhis2_repository_org_units",
        )
        op.drop_index(
            "ix_dhis2_repository_org_units_database_id",
            table_name="dhis2_repository_org_units",
        )
        op.drop_table("dhis2_repository_org_units")

    if dialect != "sqlite":
        try:
            op.drop_constraint(
                "fk_dbs_primary_instance_id_dhis2_instances",
                "dbs",
                type_="foreignkey",
            )
        except Exception:  # pylint: disable=broad-except
            pass

    for column_name in [
        "repository_org_unit_config_json",
        "repository_data_scope",
        "primary_instance_id",
        "lowest_data_level_to_use",
        "repository_reporting_unit_approach",
    ]:
        if _column_exists("dbs", column_name):
            op.drop_column("dbs", column_name)
