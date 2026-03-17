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
"""Add dhis2_sync_job_requests table for per-batch analytics request logging.

Revision ID: dhis2_request_log_v1
Revises: dhis2_job_control_v1
Create Date: 2026-03-17 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "dhis2_request_log_v1"
down_revision = "2026_03_16_merge_heads"


def _table_exists(table_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _index_exists(table_name: str, index_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return index_name in [idx["name"] for idx in inspector.get_indexes(table_name)]


def upgrade() -> None:
    if _table_exists("dhis2_sync_job_requests"):
        return

    op.create_table(
        "dhis2_sync_job_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sync_job_id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.Integer(), nullable=True),
        sa.Column("instance_name", sa.String(length=255), nullable=True),
        sa.Column("request_seq", sa.Integer(), nullable=False),
        sa.Column("ou_count", sa.Integer(), nullable=True),
        sa.Column("dx_count", sa.Integer(), nullable=True),
        sa.Column("periods_json", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("http_status_code", sa.Integer(), nullable=True),
        sa.Column("dhis2_error_code", sa.String(length=20), nullable=True),
        sa.Column("pages_fetched", sa.Integer(), nullable=True),
        sa.Column("rows_returned", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["sync_job_id"],
            ["dhis2_sync_jobs.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["dhis2_instances.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    if not _index_exists("dhis2_sync_job_requests", "ix_dhis2_sync_job_requests_sync_job_id"):
        op.create_index(
            "ix_dhis2_sync_job_requests_sync_job_id",
            "dhis2_sync_job_requests",
            ["sync_job_id"],
        )
    if not _index_exists("dhis2_sync_job_requests", "ix_dhis2_sync_job_requests_job_seq"):
        op.create_index(
            "ix_dhis2_sync_job_requests_job_seq",
            "dhis2_sync_job_requests",
            ["sync_job_id", "request_seq"],
        )


def downgrade() -> None:
    if _table_exists("dhis2_sync_job_requests"):
        op.drop_table("dhis2_sync_job_requests")
