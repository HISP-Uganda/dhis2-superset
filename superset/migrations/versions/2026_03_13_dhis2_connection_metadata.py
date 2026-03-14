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
"""Add DHIS2 configured-connection ordering and test metadata.

Revision ID: dhis2_connection_metadata_v1
Revises: staged_metadata_arch_v1
Create Date: 2026-03-13 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "dhis2_connection_metadata_v1"
down_revision = "staged_metadata_arch_v1"


def _column_exists(table_name: str, column_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return column_name in [column["name"] for column in inspector.get_columns(table_name)]


def _index_exists(table_name: str, index_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return index_name in [index["name"] for index in inspector.get_indexes(table_name)]


def upgrade() -> None:
    if not _column_exists("dhis2_instances", "display_order"):
        op.add_column(
            "dhis2_instances",
            sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        )

    if not _column_exists("dhis2_instances", "last_test_status"):
        op.add_column(
            "dhis2_instances",
            sa.Column("last_test_status", sa.String(length=50), nullable=True),
        )

    if not _column_exists("dhis2_instances", "last_test_message"):
        op.add_column(
            "dhis2_instances",
            sa.Column("last_test_message", sa.Text(), nullable=True),
        )

    if not _column_exists("dhis2_instances", "last_test_response_time_ms"):
        op.add_column(
            "dhis2_instances",
            sa.Column("last_test_response_time_ms", sa.Float(), nullable=True),
        )

    if not _column_exists("dhis2_instances", "last_tested_on"):
        op.add_column(
            "dhis2_instances",
            sa.Column("last_tested_on", sa.DateTime(), nullable=True),
        )

    if not _index_exists(
        "dhis2_instances",
        "ix_dhis2_instances_database_id_display_order",
    ):
        op.create_index(
            "ix_dhis2_instances_database_id_display_order",
            "dhis2_instances",
            ["database_id", "display_order"],
            unique=False,
        )


def downgrade() -> None:
    if _index_exists("dhis2_instances", "ix_dhis2_instances_database_id_display_order"):
        op.drop_index(
            "ix_dhis2_instances_database_id_display_order",
            table_name="dhis2_instances",
        )

    for column_name in (
        "last_tested_on",
        "last_test_response_time_ms",
        "last_test_message",
        "last_test_status",
        "display_order",
    ):
        if _column_exists("dhis2_instances", column_name):
            op.drop_column("dhis2_instances", column_name)
