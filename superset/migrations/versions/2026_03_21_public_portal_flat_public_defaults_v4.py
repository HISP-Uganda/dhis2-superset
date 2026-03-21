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
"""Flatten default public portal styling and switch to full-width layout.

Revision ID: public_portal_flat_public_defaults_v4
Revises: public_portal_design_system_v3
Create Date: 2026-03-21
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "public_portal_flat_public_defaults_v4"
down_revision = "public_portal_design_system_v3"
branch_labels = None
depends_on = None


FLAT_DEFAULT_THEME_TOKENS = {
    "colors": {
        "accent": "#0f766e",
        "secondary": "#1d4ed8",
        "surface": "#ffffff",
        "background": "#ffffff",
        "backgroundElevated": "#ffffff",
        "text": "#0f172a",
        "muted": "#64748b",
        "mutedStrong": "#475569",
        "border": "rgba(148, 163, 184, 0.22)",
        "borderStrong": "rgba(148, 163, 184, 0.28)",
        "link": "#0f766e",
        "linkHover": "#115e59",
    },
    "fonts": {
        "heading": "'Public Sans', 'Segoe UI', sans-serif",
        "body": "'Inter', 'Segoe UI', sans-serif",
        "mono": "'IBM Plex Mono', monospace",
        "baseSize": "16px",
    },
    "spacing": {
        "xs": "4px",
        "sm": "8px",
        "md": "16px",
        "lg": "24px",
        "xl": "40px",
    },
    "radius": {
        "sm": "0",
        "md": "0",
        "lg": "0",
        "pill": "0",
    },
    "shadows": {
        "soft": "none",
        "card": "none",
        "hero": "none",
    },
    "buttons": {
        "primaryBg": "#0f766e",
        "primaryText": "#ffffff",
        "primaryHover": "#115e59",
        "secondaryBg": "rgba(15, 23, 42, 0.04)",
        "secondaryText": "#0f172a",
        "secondaryHover": "rgba(15, 23, 42, 0.08)",
    },
    "headings": {
        "heroSize": "clamp(2.5rem, 5vw, 4rem)",
        "sectionSize": "24px",
        "cardSize": "18px",
        "letterSpacing": "-0.04em",
    },
    "forms": {
        "inputBg": "#ffffff",
        "inputBorder": "rgba(148, 163, 184, 0.3)",
        "inputRadius": "12px",
    },
    "containers": {
        "pageMaxWidth": "100%",
        "contentMaxWidth": "100%",
        "narrowMaxWidth": "100%",
        "sidebarWidth": "320px",
    },
    "links": {
        "defaultDecoration": "none",
        "hoverDecoration": "underline",
    },
    "backgrounds": {
        "hero": "#ffffff",
        "section": "#ffffff",
        "card": "#ffffff",
    },
}

FLAT_DEFAULT_STYLE_VARIABLES = {
    "backgroundColor": "",
    "textColor": "",
    "borderColor": "",
    "borderRadius": "0",
    "padding": "",
    "margin": "",
    "boxShadow": "none",
    "maxWidth": "",
    "gap": "",
}


def _table_exists(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def upgrade() -> None:
    bind = op.get_bind()

    if _table_exists("public_cms_style_bundles"):
        bind.execute(
            sa.text(
                """
                UPDATE public_cms_style_bundles
                SET variables_json = :variables_json
                WHERE slug = 'portal-foundation'
                """
            ),
            {"variables_json": json.dumps(FLAT_DEFAULT_STYLE_VARIABLES)},
        )

    if _table_exists("public_cms_themes"):
        bind.execute(
            sa.text(
                """
                UPDATE public_cms_themes
                SET tokens_json = :tokens_json
                WHERE slug = 'default-theme'
                """
            ),
            {"tokens_json": json.dumps(FLAT_DEFAULT_THEME_TOKENS)},
        )

    if _table_exists("public_page_layout_configs"):
        rows = bind.execute(
            sa.text(
                """
                SELECT id, config_json
                FROM public_page_layout_configs
                WHERE scope = 'public_portal'
                """
            )
        ).fetchall()
        for row in rows:
            config = json.loads(row.config_json) if row.config_json else {}
            config["pageMaxWidth"] = "100%"
            bind.execute(
                sa.text(
                    """
                    UPDATE public_page_layout_configs
                    SET config_json = :config_json
                    WHERE id = :id
                    """
                ),
                {"id": row.id, "config_json": json.dumps(config)},
            )


def downgrade() -> None:
    pass
