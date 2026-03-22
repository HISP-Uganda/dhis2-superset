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
"""Add reusable CMS blocks for synced page sections.

Revision ID: public_portal_reusable_blocks_v7
Revises: public_portal_page_hierarchy_media_v6
Create Date: 2026-03-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "public_portal_reusable_blocks_v7"
down_revision = "public_portal_page_hierarchy_media_v6"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def upgrade() -> None:
    if _table_exists("public_cms_reusable_blocks"):
        return

    op.create_table(
        "public_cms_reusable_blocks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=64), nullable=False, server_default="custom"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("blocks_json", sa.Text(), nullable=True),
        sa.Column("settings_json", sa.Text(), nullable=True),
        sa.Column("archived_on", sa.DateTime(), nullable=True),
        sa.Column("archived_by_fk", sa.Integer(), nullable=True),
        sa.Column("created_by_fk", sa.Integer(), nullable=True),
        sa.Column("changed_by_fk", sa.Integer(), nullable=True),
        sa.Column("created_on", sa.DateTime(), nullable=False),
        sa.Column("changed_on", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["archived_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["changed_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("slug", name="uq_public_cms_reusable_block_slug"),
    )
    op.create_index(
        "ix_public_cms_reusable_blocks_status",
        "public_cms_reusable_blocks",
        ["status"],
    )
    op.create_index(
        "ix_public_cms_reusable_blocks_is_active",
        "public_cms_reusable_blocks",
        ["is_active"],
    )
    op.create_index(
        "ix_public_cms_reusable_blocks_category",
        "public_cms_reusable_blocks",
        ["category"],
    )
    op.create_index(
        "ix_public_cms_reusable_blocks_created_on",
        "public_cms_reusable_blocks",
        ["created_on"],
    )


def downgrade() -> None:
    if _table_exists("public_cms_reusable_blocks"):
        op.drop_table("public_cms_reusable_blocks")
