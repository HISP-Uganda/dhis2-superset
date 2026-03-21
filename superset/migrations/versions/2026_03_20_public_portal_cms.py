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
"""Create public portal CMS, navigation, and user layout tables.

Revision ID: public_portal_cms_v1
Revises: dhis2_sync_progress_v1
Create Date: 2026-03-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "public_portal_cms_v1"
down_revision = "dhis2_sync_progress_v1"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def upgrade() -> None:
    if not _table_exists("public_page_layout_configs"):
        op.create_table(
            "public_page_layout_configs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("scope", sa.String(length=255), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("config_json", sa.Text(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("scope", name="uq_public_page_layout_scope"),
        )

    if not _table_exists("public_pages"):
        op.create_table(
            "public_pages",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("slug", sa.String(length=255), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("subtitle", sa.String(length=500), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("is_published", sa.Boolean(), nullable=False),
            sa.Column("is_homepage", sa.Boolean(), nullable=False),
            sa.Column("display_order", sa.Integer(), nullable=False),
            sa.Column("settings_json", sa.Text(), nullable=True),
            sa.Column("created_by_fk", sa.Integer(), nullable=True),
            sa.Column("changed_by_fk", sa.Integer(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["created_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["changed_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("slug", name="uq_public_pages_slug"),
        )
        op.create_index("ix_public_pages_is_published", "public_pages", ["is_published"])
        op.create_index("ix_public_pages_is_homepage", "public_pages", ["is_homepage"])
        op.create_index("ix_public_pages_display_order", "public_pages", ["display_order"])

    if not _table_exists("public_navigation_menus"):
        op.create_table(
            "public_navigation_menus",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("slug", sa.String(length=255), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("location", sa.String(length=64), nullable=False),
            sa.Column("display_order", sa.Integer(), nullable=False),
            sa.Column("is_enabled", sa.Boolean(), nullable=False),
            sa.Column("settings_json", sa.Text(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("slug", name="uq_public_navigation_menu_slug"),
        )
        op.create_index(
            "ix_public_navigation_menus_location",
            "public_navigation_menus",
            ["location"],
        )
        op.create_index(
            "ix_public_navigation_menus_location_display_order",
            "public_navigation_menus",
            ["location", "display_order"],
        )

    if not _table_exists("public_page_sections"):
        op.create_table(
            "public_page_sections",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("page_id", sa.Integer(), nullable=False),
            sa.Column("section_key", sa.String(length=255), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=True),
            sa.Column("subtitle", sa.String(length=500), nullable=True),
            sa.Column("section_type", sa.String(length=64), nullable=False),
            sa.Column("display_order", sa.Integer(), nullable=False),
            sa.Column("is_visible", sa.Boolean(), nullable=False),
            sa.Column("settings_json", sa.Text(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["page_id"], ["public_pages.id"], ondelete="CASCADE"),
        )
        op.create_index(
            "ix_public_page_sections_page_id",
            "public_page_sections",
            ["page_id"],
        )
        op.create_index(
            "ix_public_page_sections_page_id_display_order",
            "public_page_sections",
            ["page_id", "display_order"],
        )

    if not _table_exists("public_navigation_items"):
        op.create_table(
            "public_navigation_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("menu_id", sa.Integer(), nullable=False),
            sa.Column("parent_id", sa.Integer(), nullable=True),
            sa.Column("label", sa.String(length=255), nullable=False),
            sa.Column("item_type", sa.String(length=64), nullable=False),
            sa.Column("href", sa.String(length=1024), nullable=True),
            sa.Column("icon", sa.String(length=255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("page_id", sa.Integer(), nullable=True),
            sa.Column("dashboard_id", sa.Integer(), nullable=True),
            sa.Column("display_order", sa.Integer(), nullable=False),
            sa.Column("is_visible", sa.Boolean(), nullable=False),
            sa.Column("open_in_new_tab", sa.Boolean(), nullable=False),
            sa.Column("settings_json", sa.Text(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["menu_id"],
                ["public_navigation_menus.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["parent_id"],
                ["public_navigation_items.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["page_id"],
                ["public_pages.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["dashboard_id"],
                ["dashboards.id"],
                ondelete="SET NULL",
            ),
        )
        op.create_index(
            "ix_public_navigation_items_menu_id",
            "public_navigation_items",
            ["menu_id"],
        )
        op.create_index(
            "ix_public_navigation_items_menu_id_display_order",
            "public_navigation_items",
            ["menu_id", "display_order"],
        )
        op.create_index(
            "ix_public_navigation_items_parent_id",
            "public_navigation_items",
            ["parent_id"],
        )

    if not _table_exists("public_page_components"):
        op.create_table(
            "public_page_components",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("section_id", sa.Integer(), nullable=False),
            sa.Column("component_key", sa.String(length=255), nullable=False),
            sa.Column("component_type", sa.String(length=64), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=True),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("chart_id", sa.Integer(), nullable=True),
            sa.Column("dashboard_id", sa.Integer(), nullable=True),
            sa.Column("display_order", sa.Integer(), nullable=False),
            sa.Column("is_visible", sa.Boolean(), nullable=False),
            sa.Column("settings_json", sa.Text(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["section_id"],
                ["public_page_sections.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["chart_id"], ["slices.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["dashboard_id"],
                ["dashboards.id"],
                ondelete="SET NULL",
            ),
        )
        op.create_index(
            "ix_public_page_components_section_id",
            "public_page_components",
            ["section_id"],
        )
        op.create_index(
            "ix_public_page_components_section_id_display_order",
            "public_page_components",
            ["section_id", "display_order"],
        )
        op.create_index(
            "ix_public_page_components_chart_id",
            "public_page_components",
            ["chart_id"],
        )
        op.create_index(
            "ix_public_page_components_dashboard_id",
            "public_page_components",
            ["dashboard_id"],
        )

    if not _table_exists("public_user_page_layouts"):
        op.create_table(
            "public_user_page_layouts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("page_id", sa.Integer(), nullable=False),
            sa.Column("layout_json", sa.Text(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["ab_user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["page_id"], ["public_pages.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(
                "user_id",
                "page_id",
                name="uq_public_user_page_layout_user_page",
            ),
        )
        op.create_index(
            "ix_public_user_page_layouts_user_id",
            "public_user_page_layouts",
            ["user_id"],
        )
        op.create_index(
            "ix_public_user_page_layouts_page_id",
            "public_user_page_layouts",
            ["page_id"],
        )


def downgrade() -> None:
    if _table_exists("public_user_page_layouts"):
        op.drop_index("ix_public_user_page_layouts_page_id", table_name="public_user_page_layouts")
        op.drop_index("ix_public_user_page_layouts_user_id", table_name="public_user_page_layouts")
        op.drop_table("public_user_page_layouts")

    if _table_exists("public_page_components"):
        op.drop_index("ix_public_page_components_dashboard_id", table_name="public_page_components")
        op.drop_index("ix_public_page_components_chart_id", table_name="public_page_components")
        op.drop_index(
            "ix_public_page_components_section_id_display_order",
            table_name="public_page_components",
        )
        op.drop_index("ix_public_page_components_section_id", table_name="public_page_components")
        op.drop_table("public_page_components")

    if _table_exists("public_navigation_items"):
        op.drop_index(
            "ix_public_navigation_items_parent_id",
            table_name="public_navigation_items",
        )
        op.drop_index(
            "ix_public_navigation_items_menu_id_display_order",
            table_name="public_navigation_items",
        )
        op.drop_index(
            "ix_public_navigation_items_menu_id",
            table_name="public_navigation_items",
        )
        op.drop_table("public_navigation_items")

    if _table_exists("public_page_sections"):
        op.drop_index(
            "ix_public_page_sections_page_id_display_order",
            table_name="public_page_sections",
        )
        op.drop_index("ix_public_page_sections_page_id", table_name="public_page_sections")
        op.drop_table("public_page_sections")

    if _table_exists("public_navigation_menus"):
        op.drop_index(
            "ix_public_navigation_menus_location_display_order",
            table_name="public_navigation_menus",
        )
        op.drop_index(
            "ix_public_navigation_menus_location",
            table_name="public_navigation_menus",
        )
        op.drop_table("public_navigation_menus")

    if _table_exists("public_pages"):
        op.drop_index("ix_public_pages_display_order", table_name="public_pages")
        op.drop_index("ix_public_pages_is_homepage", table_name="public_pages")
        op.drop_index("ix_public_pages_is_published", table_name="public_pages")
        op.drop_table("public_pages")

    if _table_exists("public_page_layout_configs"):
        op.drop_table("public_page_layout_configs")
