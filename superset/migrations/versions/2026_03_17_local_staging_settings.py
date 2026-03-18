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
"""Add local_staging_settings table for pluggable engine config.

Revision ID: local_staging_settings_v1
Revises: dhis2_request_log_v1
Create Date: 2026-03-17
"""

import sqlalchemy as sa
from alembic import op

revision = "local_staging_settings_v1"
down_revision = "dhis2_request_log_v1"


_DEFAULT_DUCKDB_CONFIG = (
    '{"db_path": "/var/lib/superset/dhis2_staging.duckdb", '
    '"memory_limit": "1GB", "threads": 2}'
)


def upgrade() -> None:
    op.create_table(
        "local_staging_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "active_engine",
            sa.String(50),
            nullable=False,
            # DuckDB is the default: embedded, zero-infrastructure, used
            # only by the DHIS2 integration layer (not Superset SQL Lab).
            server_default="duckdb",
        ),
        sa.Column("duckdb_config", sa.Text, nullable=True),
        sa.Column("clickhouse_config", sa.Text, nullable=True),
        sa.Column(
            "retention_enabled",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("retention_config", sa.Text, nullable=True),
        sa.Column("engine_health_status", sa.Text, nullable=True),
    )
    # Insert the default singleton row.  DuckDB path can be changed via
    # the admin UI at /superset/local-staging/ or DHIS2_DUCKDB_PATH env var.
    op.execute(
        "INSERT INTO local_staging_settings "
        "(id, active_engine, duckdb_config, retention_enabled) "
        f"VALUES (1, 'duckdb', '{_DEFAULT_DUCKDB_CONFIG}', FALSE)"
    )


def downgrade() -> None:
    op.drop_table("local_staging_settings")
