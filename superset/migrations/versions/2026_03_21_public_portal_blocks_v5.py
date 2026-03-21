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
"""Add block-tree storage for CMS pages and backfill legacy sections.

Revision ID: public_portal_blocks_v5
Revises: public_portal_flat_public_defaults_v4
Create Date: 2026-03-21
"""

from __future__ import annotations

import json
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "public_portal_blocks_v5"
down_revision = "public_portal_flat_public_defaults_v4"
branch_labels = None
depends_on = None


LEGACY_SECTION_TYPE_MAP = {
    "hero": "hero",
    "chart_grid": "group",
    "kpi_band": "group",
    "dashboard_catalog": "group",
    "content": "group",
}

LEGACY_COMPONENT_TYPE_MAP = {
    "markdown": "rich_text",
    "heading": "heading",
    "paragraph": "paragraph",
    "image": "image",
    "button": "button",
    "divider": "divider",
    "spacer": "spacer",
    "cta": "card",
    "chart": "chart",
    "dashboard": "dashboard",
    "indicator_highlights": "dynamic_widget",
    "dashboard_list": "dynamic_widget",
}


def _table_exists(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def _json_loads(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _json_dumps(value: dict | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value)


def _generate_uid(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def _derive_slot(section_type: str, settings: dict) -> str:
    if settings.get("region"):
        return str(settings["region"])
    if section_type == "hero":
        return "hero"
    return "content"


def upgrade() -> None:
    if not _table_exists("public_page_blocks"):
        op.create_table(
            "public_page_blocks",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("uid", sa.String(length=64), nullable=False),
            sa.Column("page_id", sa.Integer(), nullable=False),
            sa.Column("parent_block_id", sa.Integer(), nullable=True),
            sa.Column("block_type", sa.String(length=64), nullable=False, server_default="rich_text"),
            sa.Column("slot", sa.String(length=64), nullable=False, server_default="content"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("tree_path", sa.String(length=255), nullable=False, server_default="0000"),
            sa.Column("depth", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_container", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("visibility", sa.String(length=32), nullable=False, server_default="public"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("style_bundle_id", sa.Integer(), nullable=True),
            sa.Column("content_json", sa.Text(), nullable=True),
            sa.Column("settings_json", sa.Text(), nullable=True),
            sa.Column("styles_json", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("created_by_fk", sa.Integer(), nullable=True),
            sa.Column("changed_by_fk", sa.Integer(), nullable=True),
            sa.Column("created_on", sa.DateTime(), nullable=False),
            sa.Column("changed_on", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["page_id"], ["public_pages.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["parent_block_id"],
                ["public_page_blocks.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["style_bundle_id"],
                ["public_cms_style_bundles.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(["created_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["changed_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("uid", name="uq_public_page_blocks_uid"),
        )
        op.create_index("ix_public_page_blocks_page_id", "public_page_blocks", ["page_id"])
        op.create_index(
            "ix_public_page_blocks_page_parent_sort",
            "public_page_blocks",
            ["page_id", "parent_block_id", "sort_order"],
        )
        op.create_index(
            "ix_public_page_blocks_tree_path",
            "public_page_blocks",
            ["page_id", "tree_path"],
        )
        op.create_index(
            "ix_public_page_blocks_block_type",
            "public_page_blocks",
            ["block_type"],
        )
        op.create_index(
            "ix_public_page_blocks_status",
            "public_page_blocks",
            ["status"],
        )

    if not (_table_exists("public_page_sections") and _table_exists("public_page_components")):
        return

    bind = op.get_bind()
    existing_page_ids = {
        row.page_id
        for row in bind.execute(
            sa.text("SELECT DISTINCT page_id FROM public_page_blocks")
        ).fetchall()
    }

    section_rows = bind.execute(
        sa.text(
            """
            SELECT
              s.id,
              s.page_id,
              s.section_key,
              s.title,
              s.subtitle,
              s.section_type,
              s.display_order,
              s.is_visible,
              s.style_bundle_id,
              s.settings_json,
              s.created_on,
              s.changed_on
            FROM public_page_sections AS s
            ORDER BY s.page_id, s.display_order, s.id
            """
        )
    ).fetchall()
    component_rows = bind.execute(
        sa.text(
            """
            SELECT
              c.id,
              c.section_id,
              c.component_key,
              c.component_type,
              c.title,
              c.body,
              c.chart_id,
              c.dashboard_id,
              c.display_order,
              c.is_visible,
              c.style_bundle_id,
              c.settings_json,
              c.created_on,
              c.changed_on
            FROM public_page_components AS c
            ORDER BY c.section_id, c.display_order, c.id
            """
        )
    ).fetchall()

    components_by_section: dict[int, list[sa.Row]] = {}
    for component in component_rows:
        components_by_section.setdefault(component.section_id, []).append(component)

    insert_block = sa.text(
        """
        INSERT INTO public_page_blocks (
          uid, page_id, parent_block_id, block_type, slot, sort_order, tree_path,
          depth, is_container, visibility, status, schema_version, style_bundle_id,
          content_json, settings_json, styles_json, metadata_json, created_by_fk,
          changed_by_fk, created_on, changed_on
        ) VALUES (
          :uid, :page_id, :parent_block_id, :block_type, :slot, :sort_order, :tree_path,
          :depth, :is_container, :visibility, :status, :schema_version, :style_bundle_id,
          :content_json, :settings_json, :styles_json, :metadata_json, :created_by_fk,
          :changed_by_fk, :created_on, :changed_on
        )
        RETURNING id
        """
    )

    for section_index, section in enumerate(section_rows):
        if section.page_id in existing_page_ids:
            continue
        section_settings = _json_loads(section.settings_json)
        section_type = (section.section_type or "content").strip().lower()
        block_type = LEGACY_SECTION_TYPE_MAP.get(section_type, "group")
        slot = _derive_slot(section_type, section_settings)
        section_content = {
            "title": section.title,
            "subtitle": section.subtitle,
        }
        if section_type == "hero":
            section_content = {
                "eyebrow": section_settings.get("eyebrow"),
                "title": section.title,
                "subtitle": section.subtitle,
            }
        section_result = bind.execute(
            insert_block,
            {
                "uid": _generate_uid("sec"),
                "page_id": section.page_id,
                "parent_block_id": None,
                "block_type": block_type,
                "slot": slot,
                "sort_order": section.display_order or section_index,
                "tree_path": f"{(section.display_order or section_index):04d}",
                "depth": 0,
                "is_container": True,
                "visibility": "public",
                "status": "active" if section.is_visible else "hidden",
                "schema_version": 1,
                "style_bundle_id": section.style_bundle_id,
                "content_json": _json_dumps(section_content),
                "settings_json": _json_dumps(
                    {
                        **section_settings,
                        "legacySectionType": section_type,
                        "legacySectionKey": section.section_key,
                    }
                ),
                "styles_json": _json_dumps({}),
                "metadata_json": _json_dumps(
                    {
                        "source": "legacy_section",
                        "section_key": section.section_key,
                        "section_type": section_type,
                    }
                ),
                "created_by_fk": None,
                "changed_by_fk": None,
                "created_on": section.created_on,
                "changed_on": section.changed_on,
            },
        )
        section_block_id = section_result.scalar()
        for component_index, component in enumerate(
            components_by_section.get(section.id, [])
        ):
            component_type = (component.component_type or "rich_text").strip().lower()
            block_component_type = LEGACY_COMPONENT_TYPE_MAP.get(
                component_type,
                component_type,
            )
            component_settings = _json_loads(component.settings_json)
            component_content: dict[str, object] = {
                "title": component.title,
                "body": component.body,
            }
            if block_component_type == "heading":
                component_content = {
                    "text": component.title or component.body,
                    "level": component_settings.get("level", 2),
                }
            elif block_component_type in {"paragraph", "rich_text"}:
                component_content = {"body": component.body or component.title}
            elif block_component_type == "image":
                component_content = {
                    "title": component.title,
                    "url": component_settings.get("imageUrl"),
                    "alt": component_settings.get("altText"),
                    "caption": component_settings.get("caption") or component.body,
                }
            elif block_component_type == "button":
                component_content = {"label": component.body or component.title}
            elif block_component_type == "card":
                component_content = {
                    "title": component.title,
                    "body": component.body,
                    "buttonLabel": component_settings.get("buttonLabel"),
                }
            elif block_component_type == "chart":
                component_content = {
                    "title": component.title,
                    "caption": component.body,
                }
                component_settings = {
                    **component_settings,
                    "provider": "superset",
                    "mode": "saved_chart",
                    "chart_ref": {"id": component.chart_id}
                    if component.chart_id is not None
                    else None,
                    "height": component_settings.get("height", 360),
                }
            elif block_component_type == "dashboard":
                component_content = {
                    "title": component.title,
                    "caption": component.body,
                }
                component_settings = {
                    **component_settings,
                    "dashboard_ref": {"id": component.dashboard_id}
                    if component.dashboard_id is not None
                    else None,
                    "height": component_settings.get("height", 720),
                }
            elif block_component_type == "dynamic_widget":
                widget_type = "custom"
                if component_type == "indicator_highlights":
                    widget_type = "indicator_highlights"
                elif component_type == "dashboard_list":
                    widget_type = "dashboard_list"
                component_settings = {
                    **component_settings,
                    "widgetType": widget_type,
                }
            bind.execute(
                insert_block,
                {
                    "uid": _generate_uid("cmp"),
                    "page_id": section.page_id,
                    "parent_block_id": section_block_id,
                    "block_type": block_component_type,
                    "slot": slot,
                    "sort_order": component.display_order or component_index,
                    "tree_path": (
                        f"{(section.display_order or section_index):04d}."
                        f"{(component.display_order or component_index):04d}"
                    ),
                    "depth": 1,
                    "is_container": block_component_type in {"group", "columns", "column", "hero", "card"},
                    "visibility": "public",
                    "status": "active" if component.is_visible else "hidden",
                    "schema_version": 1,
                    "style_bundle_id": component.style_bundle_id,
                    "content_json": _json_dumps(component_content),
                    "settings_json": _json_dumps(component_settings),
                    "styles_json": _json_dumps({}),
                    "metadata_json": _json_dumps(
                        {
                            "source": "legacy_component",
                            "component_key": component.component_key,
                            "component_type": component_type,
                        }
                    ),
                    "created_by_fk": None,
                    "changed_by_fk": None,
                    "created_on": component.created_on,
                    "changed_on": component.changed_on,
                },
            )


def downgrade() -> None:
    if _table_exists("public_page_blocks"):
        op.drop_index("ix_public_page_blocks_status", table_name="public_page_blocks")
        op.drop_index(
            "ix_public_page_blocks_block_type",
            table_name="public_page_blocks",
        )
        op.drop_index(
            "ix_public_page_blocks_tree_path",
            table_name="public_page_blocks",
        )
        op.drop_index(
            "ix_public_page_blocks_page_parent_sort",
            table_name="public_page_blocks",
        )
        op.drop_index("ix_public_page_blocks_page_id", table_name="public_page_blocks")
        op.drop_table("public_page_blocks")
