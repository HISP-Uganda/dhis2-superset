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
"""Add DHIS2 job control fields, metadata job model, and serving dataset linkage.

Revision ID: dhis2_job_control_v1
Revises: dhis2_connection_metadata_v1
Create Date: 2026-03-16 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "dhis2_job_control_v1"
down_revision = "dhis2_connection_metadata_v1"


def _column_exists(table_name: str, column_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return column_name in [col["name"] for col in inspector.get_columns(table_name)]


def _table_exists(table_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _index_exists(table_name: str, index_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return index_name in [idx["name"] for idx in inspector.get_indexes(table_name)]


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Add task_id + cancel_requested to dhis2_sync_jobs
    # ------------------------------------------------------------------
    if not _column_exists("dhis2_sync_jobs", "task_id"):
        op.add_column(
            "dhis2_sync_jobs",
            sa.Column("task_id", sa.String(length=255), nullable=True),
        )

    if not _column_exists("dhis2_sync_jobs", "cancel_requested"):
        op.add_column(
            "dhis2_sync_jobs",
            sa.Column(
                "cancel_requested",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )

    if not _index_exists("dhis2_sync_jobs", "ix_dhis2_sync_jobs_task_id"):
        op.create_index(
            "ix_dhis2_sync_jobs_task_id",
            "dhis2_sync_jobs",
            ["task_id"],
            unique=False,
        )

    # ------------------------------------------------------------------
    # 2. Add serving_superset_dataset_id to dhis2_staged_datasets
    # ------------------------------------------------------------------
    if not _column_exists("dhis2_staged_datasets", "serving_superset_dataset_id"):
        op.add_column(
            "dhis2_staged_datasets",
            sa.Column(
                "serving_superset_dataset_id",
                sa.Integer(),
                nullable=True,
            ),
        )
        # Add FK constraint only on databases that support ALTER TABLE with FK
        # (SQLite does not; the ORM-level relationship handles referential integrity).
        bind = op.get_bind()
        if bind.dialect.name != "sqlite":
            op.create_foreign_key(
                "fk_dhis2_staged_datasets_serving_sqla_table",
                "dhis2_staged_datasets",
                "tables",
                ["serving_superset_dataset_id"],
                ["id"],
                ondelete="SET NULL",
            )

    # ------------------------------------------------------------------
    # 3. Create dhis2_metadata_jobs table
    # ------------------------------------------------------------------
    if not _table_exists("dhis2_metadata_jobs"):
        op.create_table(
            "dhis2_metadata_jobs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("database_id", sa.Integer(), nullable=False),
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
            sa.Column("instance_ids", sa.Text(), nullable=True),
            sa.Column("metadata_types", sa.Text(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("task_id", sa.String(length=255), nullable=True),
            sa.Column(
                "cancel_requested",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
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
        op.create_index(
            "ix_dhis2_metadata_jobs_database_id",
            "dhis2_metadata_jobs",
            ["database_id"],
            unique=False,
        )
        op.create_index(
            "ix_dhis2_metadata_jobs_status",
            "dhis2_metadata_jobs",
            ["status"],
            unique=False,
        )
        op.create_index(
            "ix_dhis2_metadata_jobs_task_id",
            "dhis2_metadata_jobs",
            ["task_id"],
            unique=False,
        )


def downgrade() -> None:
    # Drop metadata jobs table
    if _table_exists("dhis2_metadata_jobs"):
        for idx in ("ix_dhis2_metadata_jobs_task_id", "ix_dhis2_metadata_jobs_status", "ix_dhis2_metadata_jobs_database_id"):
            if _index_exists("dhis2_metadata_jobs", idx):
                op.drop_index(idx, table_name="dhis2_metadata_jobs")
        op.drop_table("dhis2_metadata_jobs")

    # Remove serving_superset_dataset_id from dhis2_staged_datasets
    if _column_exists("dhis2_staged_datasets", "serving_superset_dataset_id"):
        op.drop_column("dhis2_staged_datasets", "serving_superset_dataset_id")

    # Remove fields from dhis2_sync_jobs
    if _index_exists("dhis2_sync_jobs", "ix_dhis2_sync_jobs_task_id"):
        op.drop_index("ix_dhis2_sync_jobs_task_id", table_name="dhis2_sync_jobs")
    for col in ("cancel_requested", "task_id"):
        if _column_exists("dhis2_sync_jobs", col):
            op.drop_column("dhis2_sync_jobs", col)
