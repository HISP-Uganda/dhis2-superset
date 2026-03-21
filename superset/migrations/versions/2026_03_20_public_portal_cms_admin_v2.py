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
"""Expand public portal CMS metadata, visibility, and revision tracking.

Revision ID: public_portal_cms_admin_v2
Revises: public_portal_cms_v1
Create Date: 2026-03-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "public_portal_cms_admin_v2"
down_revision = "public_portal_cms_v1"
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
    if _table_exists("public_navigation_menus"):
        with op.batch_alter_table("public_navigation_menus") as batch_op:
            if not _column_exists("public_navigation_menus", "description"):
                batch_op.add_column(sa.Column("description", sa.Text(), nullable=True))
            if not _column_exists("public_navigation_menus", "visibility"):
                batch_op.add_column(
                    sa.Column(
                        "visibility",
                        sa.String(length=32),
                        nullable=False,
                        server_default="public",
                    )
                )

    if _table_exists("public_navigation_items"):
        with op.batch_alter_table("public_navigation_items") as batch_op:
            if not _column_exists("public_navigation_items", "visibility"):
                batch_op.add_column(
                    sa.Column(
                        "visibility",
                        sa.String(length=32),
                        nullable=False,
                        server_default="public",
                    )
                )

    if _table_exists("public_pages"):
        with op.batch_alter_table("public_pages") as batch_op:
            if not _column_exists("public_pages", "excerpt"):
                batch_op.add_column(sa.Column("excerpt", sa.String(length=500), nullable=True))
            if not _column_exists("public_pages", "seo_title"):
                batch_op.add_column(sa.Column("seo_title", sa.String(length=255), nullable=True))
            if not _column_exists("public_pages", "seo_description"):
                batch_op.add_column(sa.Column("seo_description", sa.Text(), nullable=True))
            if not _column_exists("public_pages", "og_image_url"):
                batch_op.add_column(sa.Column("og_image_url", sa.String(length=1024), nullable=True))
            if not _column_exists("public_pages", "featured_image_url"):
                batch_op.add_column(
                    sa.Column("featured_image_url", sa.String(length=1024), nullable=True)
                )
            if not _column_exists("public_pages", "visibility"):
                batch_op.add_column(
                    sa.Column(
                        "visibility",
                        sa.String(length=32),
                        nullable=False,
                        server_default="public",
                    )
                )
            if not _column_exists("public_pages", "page_type"):
                batch_op.add_column(
                    sa.Column(
                        "page_type",
                        sa.String(length=64),
                        nullable=False,
                        server_default="content",
                    )
                )
            if not _column_exists("public_pages", "template_key"):
                batch_op.add_column(
                    sa.Column(
                        "template_key",
                        sa.String(length=128),
                        nullable=False,
                        server_default="default",
                    )
                )
            if not _column_exists("public_pages", "scheduled_publish_at"):
                batch_op.add_column(sa.Column("scheduled_publish_at", sa.DateTime(), nullable=True))
            if not _column_exists("public_pages", "published_on"):
                batch_op.add_column(sa.Column("published_on", sa.DateTime(), nullable=True))
            if not _column_exists("public_pages", "published_by_fk"):
                batch_op.add_column(sa.Column("published_by_fk", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_public_pages_published_by_fk_ab_user",
                    "ab_user",
                    ["published_by_fk"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if not _column_exists("public_pages", "archived_on"):
                batch_op.add_column(sa.Column("archived_on", sa.DateTime(), nullable=True))
            if not _column_exists("public_pages", "archived_by_fk"):
                batch_op.add_column(sa.Column("archived_by_fk", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_public_pages_archived_by_fk_ab_user",
                    "ab_user",
                    ["archived_by_fk"],
                    ["id"],
                    ondelete="SET NULL",
                )

        if not _index_exists("public_pages", "ix_public_pages_visibility"):
            op.create_index("ix_public_pages_visibility", "public_pages", ["visibility"])
        if not _index_exists("public_pages", "ix_public_pages_status"):
            op.create_index("ix_public_pages_status", "public_pages", ["status"])
        if not _index_exists("public_pages", "ix_public_pages_published_on"):
            op.create_index("ix_public_pages_published_on", "public_pages", ["published_on"])

        op.execute(
            sa.text(
                """
                UPDATE public_pages
                SET published_on = COALESCE(published_on, changed_on, created_on)
                WHERE is_published = 1 AND published_on IS NULL
                """
            )
        )

    if not _table_exists("public_page_revisions"):
        op.create_table(
            "public_page_revisions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("page_id", sa.Integer(), nullable=False),
            sa.Column("revision_number", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column("summary", sa.String(length=500), nullable=True),
            sa.Column("snapshot_json", sa.Text(), nullable=True),
            sa.Column("created_by_fk", sa.Integer(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["page_id"], ["public_pages.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
        )
        op.create_index(
            "ix_public_page_revisions_page_id",
            "public_page_revisions",
            ["page_id"],
        )
        op.create_index(
            "ix_public_page_revisions_page_id_revision_number",
            "public_page_revisions",
            ["page_id", "revision_number"],
        )
        op.create_index(
            "ix_public_page_revisions_page_id_created_on",
            "public_page_revisions",
            ["page_id", "created_on"],
        )


def downgrade() -> None:
    if _table_exists("public_page_revisions"):
        op.drop_index(
            "ix_public_page_revisions_page_id_created_on",
            table_name="public_page_revisions",
        )
        op.drop_index(
            "ix_public_page_revisions_page_id_revision_number",
            table_name="public_page_revisions",
        )
        op.drop_index("ix_public_page_revisions_page_id", table_name="public_page_revisions")
        op.drop_table("public_page_revisions")

    if _table_exists("public_pages"):
        if _index_exists("public_pages", "ix_public_pages_published_on"):
            op.drop_index("ix_public_pages_published_on", table_name="public_pages")
        if _index_exists("public_pages", "ix_public_pages_status"):
            op.drop_index("ix_public_pages_status", table_name="public_pages")
        if _index_exists("public_pages", "ix_public_pages_visibility"):
            op.drop_index("ix_public_pages_visibility", table_name="public_pages")
        with op.batch_alter_table("public_pages") as batch_op:
            if _column_exists("public_pages", "archived_by_fk"):
                batch_op.drop_column("archived_by_fk")
            if _column_exists("public_pages", "archived_on"):
                batch_op.drop_column("archived_on")
            if _column_exists("public_pages", "published_by_fk"):
                batch_op.drop_column("published_by_fk")
            if _column_exists("public_pages", "published_on"):
                batch_op.drop_column("published_on")
            if _column_exists("public_pages", "scheduled_publish_at"):
                batch_op.drop_column("scheduled_publish_at")
            if _column_exists("public_pages", "template_key"):
                batch_op.drop_column("template_key")
            if _column_exists("public_pages", "page_type"):
                batch_op.drop_column("page_type")
            if _column_exists("public_pages", "visibility"):
                batch_op.drop_column("visibility")
            if _column_exists("public_pages", "featured_image_url"):
                batch_op.drop_column("featured_image_url")
            if _column_exists("public_pages", "og_image_url"):
                batch_op.drop_column("og_image_url")
            if _column_exists("public_pages", "seo_description"):
                batch_op.drop_column("seo_description")
            if _column_exists("public_pages", "seo_title"):
                batch_op.drop_column("seo_title")
            if _column_exists("public_pages", "excerpt"):
                batch_op.drop_column("excerpt")

    if _table_exists("public_navigation_items"):
        with op.batch_alter_table("public_navigation_items") as batch_op:
            if _column_exists("public_navigation_items", "visibility"):
                batch_op.drop_column("visibility")

    if _table_exists("public_navigation_menus"):
        with op.batch_alter_table("public_navigation_menus") as batch_op:
            if _column_exists("public_navigation_menus", "visibility"):
                batch_op.drop_column("visibility")
            if _column_exists("public_navigation_menus", "description"):
                batch_op.drop_column("description")
