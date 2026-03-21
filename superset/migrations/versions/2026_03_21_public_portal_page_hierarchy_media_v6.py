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
"""Add hierarchical page metadata and CMS media assets.

Revision ID: public_portal_page_hierarchy_media_v6
Revises: public_portal_blocks_v5
Create Date: 2026-03-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "public_portal_page_hierarchy_media_v6"
down_revision = "public_portal_blocks_v5"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def _column_exists(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name):
        return False
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _index_exists(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name):
        return False
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    if not _table_exists("public_cms_media_assets"):
        op.create_table(
            "public_cms_media_assets",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("slug", sa.String(length=255), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("asset_type", sa.String(length=64), nullable=False, server_default="file"),
            sa.Column("mime_type", sa.String(length=255), nullable=True),
            sa.Column("file_extension", sa.String(length=32), nullable=True),
            sa.Column("original_filename", sa.String(length=512), nullable=True),
            sa.Column("storage_path", sa.String(length=1024), nullable=False),
            sa.Column("file_size", sa.BigInteger(), nullable=True),
            sa.Column("checksum", sa.String(length=128), nullable=True),
            sa.Column("visibility", sa.String(length=32), nullable=False, server_default="private"),
            sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("alt_text", sa.String(length=500), nullable=True),
            sa.Column("caption", sa.Text(), nullable=True),
            sa.Column("width", sa.Integer(), nullable=True),
            sa.Column("height", sa.Integer(), nullable=True),
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
            sa.UniqueConstraint("slug", name="uq_public_cms_media_asset_slug"),
        )
        op.create_index(
            "ix_public_cms_media_assets_status",
            "public_cms_media_assets",
            ["status"],
        )
        op.create_index(
            "ix_public_cms_media_assets_visibility",
            "public_cms_media_assets",
            ["visibility"],
        )
        op.create_index(
            "ix_public_cms_media_assets_asset_type",
            "public_cms_media_assets",
            ["asset_type"],
        )
        op.create_index(
            "ix_public_cms_media_assets_created_on",
            "public_cms_media_assets",
            ["created_on"],
        )

    if _table_exists("public_pages"):
        with op.batch_alter_table("public_pages") as batch_op:
            if not _column_exists("public_pages", "parent_page_id"):
                batch_op.add_column(
                    sa.Column("parent_page_id", sa.Integer(), nullable=True)
                )
            if not _column_exists("public_pages", "navigation_label"):
                batch_op.add_column(
                    sa.Column("navigation_label", sa.String(length=255), nullable=True)
                )
            if not _column_exists("public_pages", "featured_image_asset_id"):
                batch_op.add_column(
                    sa.Column("featured_image_asset_id", sa.Integer(), nullable=True)
                )
            if not _column_exists("public_pages", "og_image_asset_id"):
                batch_op.add_column(
                    sa.Column("og_image_asset_id", sa.Integer(), nullable=True)
                )
            batch_op.create_foreign_key(
                "fk_public_pages_parent_page_id",
                "public_pages",
                ["parent_page_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch_op.create_foreign_key(
                "fk_public_pages_featured_image_asset_id",
                "public_cms_media_assets",
                ["featured_image_asset_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch_op.create_foreign_key(
                "fk_public_pages_og_image_asset_id",
                "public_cms_media_assets",
                ["og_image_asset_id"],
                ["id"],
                ondelete="SET NULL",
            )

        if not _index_exists("public_pages", "ix_public_pages_parent_page_id"):
            op.create_index(
                "ix_public_pages_parent_page_id",
                "public_pages",
                ["parent_page_id"],
            )


def downgrade() -> None:
    if _table_exists("public_pages"):
        with op.batch_alter_table("public_pages") as batch_op:
            if _column_exists("public_pages", "og_image_asset_id"):
                batch_op.drop_column("og_image_asset_id")
            if _column_exists("public_pages", "featured_image_asset_id"):
                batch_op.drop_column("featured_image_asset_id")
            if _column_exists("public_pages", "navigation_label"):
                batch_op.drop_column("navigation_label")
            if _column_exists("public_pages", "parent_page_id"):
                batch_op.drop_column("parent_page_id")

    if _table_exists("public_cms_media_assets"):
        op.drop_table("public_cms_media_assets")
