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
"""Add CMS themes, templates, and scoped style bundles for public portal pages.

Revision ID: public_portal_design_system_v3
Revises: public_portal_cms_admin_v2
Create Date: 2026-03-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "public_portal_design_system_v3"
down_revision = "public_portal_cms_admin_v2"
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
    if not _table_exists("public_cms_style_bundles"):
        op.create_table(
            "public_cms_style_bundles",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("slug", sa.String(length=255), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("variables_json", sa.Text(), nullable=True),
            sa.Column("css_text", sa.Text(), nullable=True),
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
            sa.UniqueConstraint("slug", name="uq_public_cms_style_bundle_slug"),
        )
        op.create_index(
            "ix_public_cms_style_bundles_status",
            "public_cms_style_bundles",
            ["status"],
        )
        op.create_index(
            "ix_public_cms_style_bundles_is_active",
            "public_cms_style_bundles",
            ["is_active"],
        )

    if not _table_exists("public_cms_themes"):
        op.create_table(
            "public_cms_themes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("slug", sa.String(length=255), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("preview_image_url", sa.String(length=1024), nullable=True),
            sa.Column("tokens_json", sa.Text(), nullable=True),
            sa.Column("settings_json", sa.Text(), nullable=True),
            sa.Column("style_bundle_id", sa.Integer(), nullable=True),
            sa.Column("archived_on", sa.DateTime(), nullable=True),
            sa.Column("archived_by_fk", sa.Integer(), nullable=True),
            sa.Column("created_by_fk", sa.Integer(), nullable=True),
            sa.Column("changed_by_fk", sa.Integer(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["style_bundle_id"],
                ["public_cms_style_bundles.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(["archived_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["changed_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("slug", name="uq_public_cms_theme_slug"),
        )
        op.create_index("ix_public_cms_themes_status", "public_cms_themes", ["status"])
        op.create_index(
            "ix_public_cms_themes_is_active",
            "public_cms_themes",
            ["is_active"],
        )
        op.create_index(
            "ix_public_cms_themes_is_default",
            "public_cms_themes",
            ["is_default"],
        )

    if not _table_exists("public_cms_templates"):
        op.create_table(
            "public_cms_templates",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("slug", sa.String(length=255), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("structure_json", sa.Text(), nullable=True),
            sa.Column("settings_json", sa.Text(), nullable=True),
            sa.Column("theme_id", sa.Integer(), nullable=True),
            sa.Column("style_bundle_id", sa.Integer(), nullable=True),
            sa.Column("archived_on", sa.DateTime(), nullable=True),
            sa.Column("archived_by_fk", sa.Integer(), nullable=True),
            sa.Column("created_by_fk", sa.Integer(), nullable=True),
            sa.Column("changed_by_fk", sa.Integer(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["theme_id"], ["public_cms_themes.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["style_bundle_id"],
                ["public_cms_style_bundles.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(["archived_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["changed_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("slug", name="uq_public_cms_template_slug"),
        )
        op.create_index(
            "ix_public_cms_templates_status",
            "public_cms_templates",
            ["status"],
        )
        op.create_index(
            "ix_public_cms_templates_is_active",
            "public_cms_templates",
            ["is_active"],
        )
        op.create_index(
            "ix_public_cms_templates_is_default",
            "public_cms_templates",
            ["is_default"],
        )

    if _table_exists("public_pages"):
        with op.batch_alter_table("public_pages") as batch_op:
            if not _column_exists("public_pages", "theme_id"):
                batch_op.add_column(sa.Column("theme_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_public_pages_theme_id_public_cms_themes",
                    "public_cms_themes",
                    ["theme_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if not _column_exists("public_pages", "template_id"):
                batch_op.add_column(sa.Column("template_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_public_pages_template_id_public_cms_templates",
                    "public_cms_templates",
                    ["template_id"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if not _column_exists("public_pages", "style_bundle_id"):
                batch_op.add_column(sa.Column("style_bundle_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_public_pages_style_bundle_id_public_cms_style_bundles",
                    "public_cms_style_bundles",
                    ["style_bundle_id"],
                    ["id"],
                    ondelete="SET NULL",
                )

    if _table_exists("public_page_sections"):
        with op.batch_alter_table("public_page_sections") as batch_op:
            if not _column_exists("public_page_sections", "style_bundle_id"):
                batch_op.add_column(sa.Column("style_bundle_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_public_page_sections_style_bundle_id_public_cms_style_bundles",
                    "public_cms_style_bundles",
                    ["style_bundle_id"],
                    ["id"],
                    ondelete="SET NULL",
                )

    if _table_exists("public_page_components"):
        with op.batch_alter_table("public_page_components") as batch_op:
            if not _column_exists("public_page_components", "style_bundle_id"):
                batch_op.add_column(sa.Column("style_bundle_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    "fk_public_page_components_style_bundle_id_public_cms_style_bundles",
                    "public_cms_style_bundles",
                    ["style_bundle_id"],
                    ["id"],
                    ondelete="SET NULL",
                )


def downgrade() -> None:
    if _table_exists("public_page_components"):
        with op.batch_alter_table("public_page_components") as batch_op:
            if _column_exists("public_page_components", "style_bundle_id"):
                batch_op.drop_column("style_bundle_id")

    if _table_exists("public_page_sections"):
        with op.batch_alter_table("public_page_sections") as batch_op:
            if _column_exists("public_page_sections", "style_bundle_id"):
                batch_op.drop_column("style_bundle_id")

    if _table_exists("public_pages"):
        with op.batch_alter_table("public_pages") as batch_op:
            if _column_exists("public_pages", "style_bundle_id"):
                batch_op.drop_column("style_bundle_id")
            if _column_exists("public_pages", "template_id"):
                batch_op.drop_column("template_id")
            if _column_exists("public_pages", "theme_id"):
                batch_op.drop_column("theme_id")

    if _table_exists("public_cms_templates"):
        if _index_exists("public_cms_templates", "ix_public_cms_templates_is_default"):
            op.drop_index(
                "ix_public_cms_templates_is_default",
                table_name="public_cms_templates",
            )
        if _index_exists("public_cms_templates", "ix_public_cms_templates_is_active"):
            op.drop_index(
                "ix_public_cms_templates_is_active",
                table_name="public_cms_templates",
            )
        if _index_exists("public_cms_templates", "ix_public_cms_templates_status"):
            op.drop_index(
                "ix_public_cms_templates_status",
                table_name="public_cms_templates",
            )
        op.drop_table("public_cms_templates")

    if _table_exists("public_cms_themes"):
        if _index_exists("public_cms_themes", "ix_public_cms_themes_is_default"):
            op.drop_index(
                "ix_public_cms_themes_is_default",
                table_name="public_cms_themes",
            )
        if _index_exists("public_cms_themes", "ix_public_cms_themes_is_active"):
            op.drop_index(
                "ix_public_cms_themes_is_active",
                table_name="public_cms_themes",
            )
        if _index_exists("public_cms_themes", "ix_public_cms_themes_status"):
            op.drop_index(
                "ix_public_cms_themes_status",
                table_name="public_cms_themes",
            )
        op.drop_table("public_cms_themes")

    if _table_exists("public_cms_style_bundles"):
        if _index_exists(
            "public_cms_style_bundles",
            "ix_public_cms_style_bundles_is_active",
        ):
            op.drop_index(
                "ix_public_cms_style_bundles_is_active",
                table_name="public_cms_style_bundles",
            )
        if _index_exists(
            "public_cms_style_bundles",
            "ix_public_cms_style_bundles_status",
        ):
            op.drop_index(
                "ix_public_cms_style_bundles_status",
                table_name="public_cms_style_bundles",
            )
        op.drop_table("public_cms_style_bundles")
