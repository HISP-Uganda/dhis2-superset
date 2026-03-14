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
"""DHIS2 multi-instance support – create registry, staged-dataset, variable, and sync-job tables.

Revision ID: dhis2_multi_instance_v1
Revises: update_dhis2_chart_columns
Create Date: 2026-01-01 00:00:00.000000

Tables created
--------------
dhis2_instances
    Registry of DHIS2 server instances associated with a Superset ``dbs`` row.
dhis2_staged_datasets
    Materialised datasets that aggregate data from one or more DHIS2 instances.
dhis2_dataset_variables
    Per-variable source mapping: which DHIS2 instance provides each column.
dhis2_sync_jobs
    Audit trail for background sync job executions.
"""

import sqlalchemy as sa
from alembic import op

from superset.extensions import encrypted_field_factory
from superset.migrations.shared.utils import (
    create_fks_for_table,
    create_index,
    create_table,
    drop_index,
    drop_table,
)

# Alembic revision identifiers
revision = "dhis2_multi_instance_v1"
down_revision = "update_dhis2_chart_columns"


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------


def upgrade() -> None:
    """Create dhis2_instances, dhis2_staged_datasets, dhis2_dataset_variables,
    and dhis2_sync_jobs tables together with their indexes and foreign keys."""

    # ------------------------------------------------------------------
    # 1. dhis2_instances
    # ------------------------------------------------------------------
    create_table(
        "dhis2_instances",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "database_id",
            sa.Integer(),
            sa.ForeignKey("dbs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("url", sa.String(length=1024), nullable=False),
        sa.Column("auth_type", sa.String(length=50), nullable=False, server_default="basic"),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column(
            "password",
            encrypted_field_factory.create(sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "access_token",
            encrypted_field_factory.create(sa.Text()),
            nullable=True,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by_fk", sa.Integer(), nullable=True),
        sa.Column("changed_by_fk", sa.Integer(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=True),
        sa.Column("changed_on", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "database_id", "name", name="uq_dhis2_instances_db_name"
        ),
    )

    # Indexes on dhis2_instances
    create_index(
        "dhis2_instances",
        "ix_dhis2_instances_database_id",
        ["database_id"],
    )
    create_index(
        "dhis2_instances",
        "ix_dhis2_instances_database_id_is_active",
        ["database_id", "is_active"],
    )

    # Foreign keys on dhis2_instances
    create_fks_for_table(
        "fk_dhis2_instances_database_id_dbs",
        "dhis2_instances",
        "dbs",
        ["database_id"],
        ["id"],
        ondelete="CASCADE",
    )
    create_fks_for_table(
        "fk_dhis2_instances_created_by_fk_ab_user",
        "dhis2_instances",
        "ab_user",
        ["created_by_fk"],
        ["id"],
    )
    create_fks_for_table(
        "fk_dhis2_instances_changed_by_fk_ab_user",
        "dhis2_instances",
        "ab_user",
        ["changed_by_fk"],
        ["id"],
    )

    # ------------------------------------------------------------------
    # 2. dhis2_staged_datasets
    # ------------------------------------------------------------------
    create_table(
        "dhis2_staged_datasets",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "database_id",
            sa.Integer(),
            sa.ForeignKey("dbs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("staging_table_name", sa.String(length=255), nullable=True),
        sa.Column("schedule_cron", sa.String(length=100), nullable=True),
        sa.Column(
            "schedule_timezone",
            sa.String(length=100),
            nullable=True,
            server_default="UTC",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "auto_refresh_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("last_sync_at", sa.DateTime(), nullable=True),
        sa.Column("last_sync_status", sa.String(length=50), nullable=True),
        sa.Column("last_sync_rows", sa.Integer(), nullable=True),
        sa.Column("dataset_config", sa.Text(), nullable=True),
        sa.Column("created_by_fk", sa.Integer(), nullable=True),
        sa.Column("changed_by_fk", sa.Integer(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=True),
        sa.Column("changed_on", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "database_id", "name", name="uq_dhis2_staged_datasets_db_name"
        ),
    )

    # Indexes on dhis2_staged_datasets
    create_index(
        "dhis2_staged_datasets",
        "ix_dhis2_staged_datasets_database_id",
        ["database_id"],
    )
    create_index(
        "dhis2_staged_datasets",
        "ix_dhis2_staged_datasets_database_id_is_active",
        ["database_id", "is_active"],
    )

    # Foreign keys on dhis2_staged_datasets
    create_fks_for_table(
        "fk_dhis2_staged_datasets_database_id_dbs",
        "dhis2_staged_datasets",
        "dbs",
        ["database_id"],
        ["id"],
        ondelete="CASCADE",
    )
    create_fks_for_table(
        "fk_dhis2_staged_datasets_created_by_fk_ab_user",
        "dhis2_staged_datasets",
        "ab_user",
        ["created_by_fk"],
        ["id"],
    )
    create_fks_for_table(
        "fk_dhis2_staged_datasets_changed_by_fk_ab_user",
        "dhis2_staged_datasets",
        "ab_user",
        ["changed_by_fk"],
        ["id"],
    )

    # ------------------------------------------------------------------
    # 3. dhis2_dataset_variables
    # ------------------------------------------------------------------
    create_table(
        "dhis2_dataset_variables",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "staged_dataset_id",
            sa.Integer(),
            sa.ForeignKey("dhis2_staged_datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "instance_id",
            sa.Integer(),
            sa.ForeignKey("dhis2_instances.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("variable_id", sa.String(length=255), nullable=False),
        sa.Column("variable_type", sa.String(length=50), nullable=False),
        sa.Column("variable_name", sa.String(length=1024), nullable=True),
        sa.Column("alias", sa.String(length=255), nullable=True),
        sa.Column("extra_params", sa.Text(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "staged_dataset_id",
            "instance_id",
            "variable_id",
            name="uq_dhis2_dataset_variables_ds_inst_var",
        ),
    )

    # Indexes on dhis2_dataset_variables
    create_index(
        "dhis2_dataset_variables",
        "ix_dhis2_dataset_variables_staged_dataset_id",
        ["staged_dataset_id"],
    )
    create_index(
        "dhis2_dataset_variables",
        "ix_dhis2_dataset_variables_instance_id",
        ["instance_id"],
    )
    create_index(
        "dhis2_dataset_variables",
        "ix_dhis2_dataset_variables_staged_dataset_instance",
        ["staged_dataset_id", "instance_id"],
    )

    # Foreign keys on dhis2_dataset_variables
    create_fks_for_table(
        "fk_dhis2_dataset_variables_staged_dataset_id",
        "dhis2_dataset_variables",
        "dhis2_staged_datasets",
        ["staged_dataset_id"],
        ["id"],
        ondelete="CASCADE",
    )
    create_fks_for_table(
        "fk_dhis2_dataset_variables_instance_id",
        "dhis2_dataset_variables",
        "dhis2_instances",
        ["instance_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # ------------------------------------------------------------------
    # 4. dhis2_sync_jobs
    # ------------------------------------------------------------------
    create_table(
        "dhis2_sync_jobs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "staged_dataset_id",
            sa.Integer(),
            sa.ForeignKey("dhis2_staged_datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "job_type",
            sa.String(length=50),
            nullable=False,
            server_default="manual",
        ),
        sa.Column(
            "status",
            sa.String(length=50),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("rows_loaded", sa.Integer(), nullable=True),
        sa.Column("rows_failed", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("instance_results", sa.Text(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=True),
        sa.Column("changed_on", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # Indexes on dhis2_sync_jobs
    create_index(
        "dhis2_sync_jobs",
        "ix_dhis2_sync_jobs_staged_dataset_id",
        ["staged_dataset_id"],
    )
    create_index(
        "dhis2_sync_jobs",
        "ix_dhis2_sync_jobs_status",
        ["status"],
    )
    create_index(
        "dhis2_sync_jobs",
        "ix_dhis2_sync_jobs_staged_dataset_id_status",
        ["staged_dataset_id", "status"],
    )

    # Foreign keys on dhis2_sync_jobs
    create_fks_for_table(
        "fk_dhis2_sync_jobs_staged_dataset_id",
        "dhis2_sync_jobs",
        "dhis2_staged_datasets",
        ["staged_dataset_id"],
        ["id"],
        ondelete="CASCADE",
    )


# ---------------------------------------------------------------------------
# downgrade
# ---------------------------------------------------------------------------


def downgrade() -> None:
    """Drop the DHIS2 multi-instance tables in reverse dependency order."""

    # Drop sync jobs first – references dhis2_staged_datasets
    drop_index("dhis2_sync_jobs", "ix_dhis2_sync_jobs_staged_dataset_id_status")
    drop_index("dhis2_sync_jobs", "ix_dhis2_sync_jobs_status")
    drop_index("dhis2_sync_jobs", "ix_dhis2_sync_jobs_staged_dataset_id")
    drop_table("dhis2_sync_jobs")

    # Drop variable mappings – references both dhis2_staged_datasets and dhis2_instances
    drop_index(
        "dhis2_dataset_variables",
        "ix_dhis2_dataset_variables_staged_dataset_instance",
    )
    drop_index("dhis2_dataset_variables", "ix_dhis2_dataset_variables_instance_id")
    drop_index(
        "dhis2_dataset_variables",
        "ix_dhis2_dataset_variables_staged_dataset_id",
    )
    drop_table("dhis2_dataset_variables")

    # Drop staged datasets – references dbs
    drop_index(
        "dhis2_staged_datasets",
        "ix_dhis2_staged_datasets_database_id_is_active",
    )
    drop_index("dhis2_staged_datasets", "ix_dhis2_staged_datasets_database_id")
    drop_table("dhis2_staged_datasets")

    # Drop instances last – referenced by dhis2_dataset_variables (now gone)
    drop_index("dhis2_instances", "ix_dhis2_instances_database_id_is_active")
    drop_index("dhis2_instances", "ix_dhis2_instances_database_id")
    drop_table("dhis2_instances")
