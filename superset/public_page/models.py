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
"""Persisted models for the public analytics portal."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from flask_appbuilder import Model
from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.types import Text

from superset import security_manager
from superset.public_page.styling import (
    default_style_variables,
    default_template_structure,
    default_theme_tokens,
)


def _json_loads(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _json_dumps(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value)


def slugify(value: str | None, fallback: str = "page") -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", str(value or "")).strip("-").lower()
    return slug or fallback


class NavigationMenu(Model):
    """Named navigation container for header/footer menus."""

    __tablename__ = "public_navigation_menus"

    __table_args__ = (
        UniqueConstraint("slug", name="uq_public_navigation_menu_slug"),
        sa.Index("ix_public_navigation_menus_location", "location"),
        sa.Index(
            "ix_public_navigation_menus_location_display_order",
            "location",
            "display_order",
        ),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    slug = sa.Column(sa.String(255), nullable=False)
    title = sa.Column(sa.String(255), nullable=False)
    description = sa.Column(Text, nullable=True)
    location = sa.Column(sa.String(64), nullable=False, default="header")
    visibility = sa.Column(sa.String(32), nullable=False, default="public")
    display_order = sa.Column(sa.Integer, nullable=False, default=0)
    is_enabled = sa.Column(sa.Boolean, nullable=False, default=True)
    settings_json = sa.Column(Text, nullable=True)
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    items: list[NavigationItem] = relationship(
        "NavigationItem",
        back_populates="menu",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="NavigationItem.display_order.asc()",
    )

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class NavigationItem(Model):
    """Individual navigation entry."""

    __tablename__ = "public_navigation_items"

    __table_args__ = (
        sa.Index("ix_public_navigation_items_menu_id", "menu_id"),
        sa.Index(
            "ix_public_navigation_items_menu_id_display_order",
            "menu_id",
            "display_order",
        ),
        sa.Index("ix_public_navigation_items_parent_id", "parent_id"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    menu_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_navigation_menus.id", ondelete="CASCADE"),
        nullable=False,
    )
    parent_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_navigation_items.id", ondelete="CASCADE"),
        nullable=True,
    )
    label = sa.Column(sa.String(255), nullable=False)
    item_type = sa.Column(sa.String(64), nullable=False, default="page")
    href = sa.Column(sa.String(1024), nullable=True)
    icon = sa.Column(sa.String(255), nullable=True)
    description = sa.Column(Text, nullable=True)
    visibility = sa.Column(sa.String(32), nullable=False, default="public")
    page_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_pages.id", ondelete="SET NULL"),
        nullable=True,
    )
    dashboard_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dashboards.id", ondelete="SET NULL"),
        nullable=True,
    )
    display_order = sa.Column(sa.Integer, nullable=False, default=0)
    is_visible = sa.Column(sa.Boolean, nullable=False, default=True)
    open_in_new_tab = sa.Column(sa.Boolean, nullable=False, default=False)
    settings_json = sa.Column(Text, nullable=True)
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    menu: NavigationMenu = relationship(
        "NavigationMenu",
        back_populates="items",
        foreign_keys=[menu_id],
    )
    parent = relationship(
        "NavigationItem",
        remote_side=[id],
        back_populates="children",
        foreign_keys=[parent_id],
    )
    children: list[NavigationItem] = relationship(
        "NavigationItem",
        back_populates="parent",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="NavigationItem.display_order.asc()",
    )
    page = relationship("Page", foreign_keys=[page_id])
    dashboard = relationship("Dashboard", foreign_keys=[dashboard_id])

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class CMSStyleBundle(Model):
    """Scoped style bundle that can be attached to themes, templates, or content."""

    __tablename__ = "public_cms_style_bundles"

    __table_args__ = (
        UniqueConstraint("slug", name="uq_public_cms_style_bundle_slug"),
        sa.Index("ix_public_cms_style_bundles_status", "status"),
        sa.Index("ix_public_cms_style_bundles_is_active", "is_active"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    slug = sa.Column(sa.String(255), nullable=False)
    title = sa.Column(sa.String(255), nullable=False)
    description = sa.Column(Text, nullable=True)
    status = sa.Column(sa.String(32), nullable=False, default="active")
    is_active = sa.Column(sa.Boolean, nullable=False, default=True)
    variables_json = sa.Column(Text, nullable=True)
    css_text = sa.Column(Text, nullable=True)
    settings_json = sa.Column(Text, nullable=True)
    archived_on = sa.Column(sa.DateTime, nullable=True)
    archived_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    archived_by = relationship(
        security_manager.user_model,
        foreign_keys=[archived_by_fk],
    )
    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )
    changed_by = relationship(
        security_manager.user_model,
        foreign_keys=[changed_by_fk],
    )

    def get_variables(self) -> dict[str, Any]:
        return _json_loads(self.variables_json) or default_style_variables()

    def set_variables(self, value: dict[str, Any] | None) -> None:
        self.variables_json = _json_dumps(value or default_style_variables())

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class CMSTheme(Model):
    """Reusable design tokens for public portal pages and templates."""

    __tablename__ = "public_cms_themes"

    __table_args__ = (
        UniqueConstraint("slug", name="uq_public_cms_theme_slug"),
        sa.Index("ix_public_cms_themes_status", "status"),
        sa.Index("ix_public_cms_themes_is_active", "is_active"),
        sa.Index("ix_public_cms_themes_is_default", "is_default"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    slug = sa.Column(sa.String(255), nullable=False)
    title = sa.Column(sa.String(255), nullable=False)
    description = sa.Column(Text, nullable=True)
    status = sa.Column(sa.String(32), nullable=False, default="active")
    is_active = sa.Column(sa.Boolean, nullable=False, default=True)
    is_default = sa.Column(sa.Boolean, nullable=False, default=False)
    preview_image_url = sa.Column(sa.String(1024), nullable=True)
    tokens_json = sa.Column(Text, nullable=True)
    settings_json = sa.Column(Text, nullable=True)
    style_bundle_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_style_bundles.id", ondelete="SET NULL"),
        nullable=True,
    )
    archived_on = sa.Column(sa.DateTime, nullable=True)
    archived_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    style_bundle: CMSStyleBundle = relationship(
        CMSStyleBundle,
        foreign_keys=[style_bundle_id],
    )
    archived_by = relationship(
        security_manager.user_model,
        foreign_keys=[archived_by_fk],
    )
    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )
    changed_by = relationship(
        security_manager.user_model,
        foreign_keys=[changed_by_fk],
    )

    def get_tokens(self) -> dict[str, Any]:
        return _json_loads(self.tokens_json) or default_theme_tokens()

    def set_tokens(self, value: dict[str, Any] | None) -> None:
        self.tokens_json = _json_dumps(value or default_theme_tokens())

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class CMSTemplate(Model):
    """Reusable page template structure for public portal pages."""

    __tablename__ = "public_cms_templates"

    __table_args__ = (
        UniqueConstraint("slug", name="uq_public_cms_template_slug"),
        sa.Index("ix_public_cms_templates_status", "status"),
        sa.Index("ix_public_cms_templates_is_active", "is_active"),
        sa.Index("ix_public_cms_templates_is_default", "is_default"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    slug = sa.Column(sa.String(255), nullable=False)
    title = sa.Column(sa.String(255), nullable=False)
    description = sa.Column(Text, nullable=True)
    status = sa.Column(sa.String(32), nullable=False, default="active")
    is_active = sa.Column(sa.Boolean, nullable=False, default=True)
    is_default = sa.Column(sa.Boolean, nullable=False, default=False)
    structure_json = sa.Column(Text, nullable=True)
    settings_json = sa.Column(Text, nullable=True)
    theme_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_themes.id", ondelete="SET NULL"),
        nullable=True,
    )
    style_bundle_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_style_bundles.id", ondelete="SET NULL"),
        nullable=True,
    )
    archived_on = sa.Column(sa.DateTime, nullable=True)
    archived_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    theme: CMSTheme = relationship(CMSTheme, foreign_keys=[theme_id])
    style_bundle: CMSStyleBundle = relationship(
        CMSStyleBundle,
        foreign_keys=[style_bundle_id],
    )
    archived_by = relationship(
        security_manager.user_model,
        foreign_keys=[archived_by_fk],
    )
    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )
    changed_by = relationship(
        security_manager.user_model,
        foreign_keys=[changed_by_fk],
    )

    def get_structure(self) -> dict[str, Any]:
        return _json_loads(self.structure_json) or default_template_structure()

    def set_structure(self, value: dict[str, Any] | None) -> None:
        self.structure_json = _json_dumps(value or default_template_structure())

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class CMSMediaAsset(Model):
    """Managed media/file asset used by CMS pages and blocks."""

    __tablename__ = "public_cms_media_assets"

    __table_args__ = (
        UniqueConstraint("slug", name="uq_public_cms_media_asset_slug"),
        sa.Index("ix_public_cms_media_assets_status", "status"),
        sa.Index("ix_public_cms_media_assets_visibility", "visibility"),
        sa.Index("ix_public_cms_media_assets_asset_type", "asset_type"),
        sa.Index("ix_public_cms_media_assets_created_on", "created_on"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    slug = sa.Column(sa.String(255), nullable=False)
    title = sa.Column(sa.String(255), nullable=False)
    description = sa.Column(Text, nullable=True)
    asset_type = sa.Column(sa.String(64), nullable=False, default="file")
    mime_type = sa.Column(sa.String(255), nullable=True)
    file_extension = sa.Column(sa.String(32), nullable=True)
    original_filename = sa.Column(sa.String(512), nullable=True)
    storage_path = sa.Column(sa.String(1024), nullable=False)
    file_size = sa.Column(sa.BigInteger, nullable=True)
    checksum = sa.Column(sa.String(128), nullable=True)
    visibility = sa.Column(sa.String(32), nullable=False, default="private")
    is_public = sa.Column(sa.Boolean, nullable=False, default=False)
    status = sa.Column(sa.String(32), nullable=False, default="active")
    alt_text = sa.Column(sa.String(500), nullable=True)
    caption = sa.Column(Text, nullable=True)
    width = sa.Column(sa.Integer, nullable=True)
    height = sa.Column(sa.Integer, nullable=True)
    settings_json = sa.Column(Text, nullable=True)
    archived_on = sa.Column(sa.DateTime, nullable=True)
    archived_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    archived_by = relationship(
        security_manager.user_model,
        foreign_keys=[archived_by_fk],
    )
    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )
    changed_by = relationship(
        security_manager.user_model,
        foreign_keys=[changed_by_fk],
    )

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class CMSReusableBlock(Model):
    """Reusable synced block section saved independently from page trees."""

    __tablename__ = "public_cms_reusable_blocks"

    __table_args__ = (
        UniqueConstraint("slug", name="uq_public_cms_reusable_block_slug"),
        sa.Index("ix_public_cms_reusable_blocks_status", "status"),
        sa.Index("ix_public_cms_reusable_blocks_is_active", "is_active"),
        sa.Index("ix_public_cms_reusable_blocks_category", "category"),
        sa.Index("ix_public_cms_reusable_blocks_created_on", "created_on"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    slug = sa.Column(sa.String(255), nullable=False)
    title = sa.Column(sa.String(255), nullable=False)
    description = sa.Column(Text, nullable=True)
    category = sa.Column(sa.String(64), nullable=False, default="custom")
    status = sa.Column(sa.String(32), nullable=False, default="active")
    is_active = sa.Column(sa.Boolean, nullable=False, default=True)
    blocks_json = sa.Column(Text, nullable=True)
    settings_json = sa.Column(Text, nullable=True)
    archived_on = sa.Column(sa.DateTime, nullable=True)
    archived_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    archived_by = relationship(
        security_manager.user_model,
        foreign_keys=[archived_by_fk],
    )
    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )
    changed_by = relationship(
        security_manager.user_model,
        foreign_keys=[changed_by_fk],
    )

    def get_blocks(self) -> list[dict[str, Any]]:
        if not self.blocks_json:
            return []
        try:
            parsed = json.loads(self.blocks_json)
        except (TypeError, json.JSONDecodeError):
            return []
        return parsed if isinstance(parsed, list) else []

    def set_blocks(self, value: list[dict[str, Any]] | None) -> None:
        self.blocks_json = json.dumps(value or [])

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class Page(Model):
    """CMS-like public portal page."""

    __tablename__ = "public_pages"

    __table_args__ = (
        UniqueConstraint("slug", name="uq_public_pages_slug"),
        sa.Index("ix_public_pages_is_published", "is_published"),
        sa.Index("ix_public_pages_is_homepage", "is_homepage"),
        sa.Index("ix_public_pages_display_order", "display_order"),
        sa.Index("ix_public_pages_visibility", "visibility"),
        sa.Index("ix_public_pages_status", "status"),
        sa.Index("ix_public_pages_published_on", "published_on"),
        sa.Index("ix_public_pages_parent_page_id", "parent_page_id"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    slug = sa.Column(sa.String(255), nullable=False)
    title = sa.Column(sa.String(255), nullable=False)
    subtitle = sa.Column(sa.String(500), nullable=True)
    description = sa.Column(Text, nullable=True)
    excerpt = sa.Column(sa.String(500), nullable=True)
    seo_title = sa.Column(sa.String(255), nullable=True)
    seo_description = sa.Column(Text, nullable=True)
    og_image_url = sa.Column(sa.String(1024), nullable=True)
    featured_image_url = sa.Column(sa.String(1024), nullable=True)
    visibility = sa.Column(sa.String(32), nullable=False, default="public")
    page_type = sa.Column(sa.String(64), nullable=False, default="content")
    template_key = sa.Column(sa.String(128), nullable=False, default="default")
    parent_page_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_pages.id", ondelete="SET NULL"),
        nullable=True,
    )
    navigation_label = sa.Column(sa.String(255), nullable=True)
    theme_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_themes.id", ondelete="SET NULL"),
        nullable=True,
    )
    template_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    style_bundle_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_style_bundles.id", ondelete="SET NULL"),
        nullable=True,
    )
    featured_image_asset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_media_assets.id", ondelete="SET NULL"),
        nullable=True,
    )
    og_image_asset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_media_assets.id", ondelete="SET NULL"),
        nullable=True,
    )
    status = sa.Column(sa.String(32), nullable=False, default="published")
    is_published = sa.Column(sa.Boolean, nullable=False, default=True)
    is_homepage = sa.Column(sa.Boolean, nullable=False, default=False)
    display_order = sa.Column(sa.Integer, nullable=False, default=0)
    scheduled_publish_at = sa.Column(sa.DateTime, nullable=True)
    published_on = sa.Column(sa.DateTime, nullable=True)
    published_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    archived_on = sa.Column(sa.DateTime, nullable=True)
    archived_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    settings_json = sa.Column(Text, nullable=True)
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )
    changed_by = relationship(
        security_manager.user_model,
        foreign_keys=[changed_by_fk],
    )
    published_by = relationship(
        security_manager.user_model,
        foreign_keys=[published_by_fk],
    )
    archived_by = relationship(
        security_manager.user_model,
        foreign_keys=[archived_by_fk],
    )
    parent_page = relationship(
        "Page",
        remote_side=[id],
        back_populates="child_pages",
        foreign_keys=[parent_page_id],
    )
    child_pages: list[Page] = relationship(
        "Page",
        back_populates="parent_page",
        foreign_keys=[parent_page_id],
        order_by="Page.display_order.asc(), Page.id.asc()",
    )
    theme: CMSTheme = relationship(CMSTheme, foreign_keys=[theme_id])
    template: CMSTemplate = relationship(CMSTemplate, foreign_keys=[template_id])
    style_bundle: CMSStyleBundle = relationship(
        CMSStyleBundle,
        foreign_keys=[style_bundle_id],
    )
    featured_image_asset: CMSMediaAsset = relationship(
        CMSMediaAsset,
        foreign_keys=[featured_image_asset_id],
    )
    og_image_asset: CMSMediaAsset = relationship(
        CMSMediaAsset,
        foreign_keys=[og_image_asset_id],
    )
    sections: list[PageSection] = relationship(
        "PageSection",
        back_populates="page",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PageSection.display_order.asc()",
    )
    layout_overrides: list[UserPageLayout] = relationship(
        "UserPageLayout",
        back_populates="page",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    revisions: list[PageRevision] = relationship(
        "PageRevision",
        back_populates="page",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PageRevision.created_on.desc()",
    )
    blocks: list[PageBlock] = relationship(
        "PageBlock",
        back_populates="page",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PageBlock.tree_path.asc(), PageBlock.id.asc()",
    )

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class PageSection(Model):
    """Logical section inside a public portal page."""

    __tablename__ = "public_page_sections"

    __table_args__ = (
        sa.Index("ix_public_page_sections_page_id", "page_id"),
        sa.Index(
            "ix_public_page_sections_page_id_display_order",
            "page_id",
            "display_order",
        ),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    page_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_pages.id", ondelete="CASCADE"),
        nullable=False,
    )
    section_key = sa.Column(sa.String(255), nullable=False)
    title = sa.Column(sa.String(255), nullable=True)
    subtitle = sa.Column(sa.String(500), nullable=True)
    section_type = sa.Column(sa.String(64), nullable=False, default="content")
    display_order = sa.Column(sa.Integer, nullable=False, default=0)
    is_visible = sa.Column(sa.Boolean, nullable=False, default=True)
    style_bundle_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_style_bundles.id", ondelete="SET NULL"),
        nullable=True,
    )
    settings_json = sa.Column(Text, nullable=True)
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    page: Page = relationship(
        "Page",
        back_populates="sections",
        foreign_keys=[page_id],
    )
    style_bundle: CMSStyleBundle = relationship(
        CMSStyleBundle,
        foreign_keys=[style_bundle_id],
    )
    components: list[PageComponent] = relationship(
        "PageComponent",
        back_populates="section",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PageComponent.display_order.asc()",
    )

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class PageComponent(Model):
    """Renderable component inside a page section."""

    __tablename__ = "public_page_components"

    __table_args__ = (
        sa.Index("ix_public_page_components_section_id", "section_id"),
        sa.Index(
            "ix_public_page_components_section_id_display_order",
            "section_id",
            "display_order",
        ),
        sa.Index("ix_public_page_components_chart_id", "chart_id"),
        sa.Index("ix_public_page_components_dashboard_id", "dashboard_id"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    section_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_page_sections.id", ondelete="CASCADE"),
        nullable=False,
    )
    component_key = sa.Column(sa.String(255), nullable=False)
    component_type = sa.Column(sa.String(64), nullable=False, default="markdown")
    title = sa.Column(sa.String(255), nullable=True)
    body = sa.Column(Text, nullable=True)
    chart_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("slices.id", ondelete="SET NULL"),
        nullable=True,
    )
    dashboard_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dashboards.id", ondelete="SET NULL"),
        nullable=True,
    )
    display_order = sa.Column(sa.Integer, nullable=False, default=0)
    is_visible = sa.Column(sa.Boolean, nullable=False, default=True)
    style_bundle_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_style_bundles.id", ondelete="SET NULL"),
        nullable=True,
    )
    settings_json = sa.Column(Text, nullable=True)
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    section: PageSection = relationship(
        "PageSection",
        back_populates="components",
        foreign_keys=[section_id],
    )
    style_bundle: CMSStyleBundle = relationship(
        CMSStyleBundle,
        foreign_keys=[style_bundle_id],
    )
    chart = relationship("Slice", foreign_keys=[chart_id])
    dashboard = relationship("Dashboard", foreign_keys=[dashboard_id])

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)


class PageBlock(Model):
    """Ordered block tree for CMS-authored pages."""

    __tablename__ = "public_page_blocks"

    __table_args__ = (
        UniqueConstraint("uid", name="uq_public_page_blocks_uid"),
        sa.Index("ix_public_page_blocks_page_id", "page_id"),
        sa.Index(
            "ix_public_page_blocks_page_parent_sort",
            "page_id",
            "parent_block_id",
            "sort_order",
        ),
        sa.Index("ix_public_page_blocks_tree_path", "page_id", "tree_path"),
        sa.Index("ix_public_page_blocks_block_type", "block_type"),
        sa.Index("ix_public_page_blocks_status", "status"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    uid = sa.Column(sa.String(64), nullable=False)
    page_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_pages.id", ondelete="CASCADE"),
        nullable=False,
    )
    parent_block_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_page_blocks.id", ondelete="CASCADE"),
        nullable=True,
    )
    block_type = sa.Column(sa.String(64), nullable=False, default="rich_text")
    slot = sa.Column(sa.String(64), nullable=False, default="content")
    sort_order = sa.Column(sa.Integer, nullable=False, default=0)
    tree_path = sa.Column(sa.String(255), nullable=False, default="0000")
    depth = sa.Column(sa.Integer, nullable=False, default=0)
    is_container = sa.Column(sa.Boolean, nullable=False, default=False)
    visibility = sa.Column(sa.String(32), nullable=False, default="public")
    status = sa.Column(sa.String(32), nullable=False, default="active")
    schema_version = sa.Column(sa.Integer, nullable=False, default=1)
    style_bundle_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_cms_style_bundles.id", ondelete="SET NULL"),
        nullable=True,
    )
    content_json = sa.Column(Text, nullable=True)
    settings_json = sa.Column(Text, nullable=True)
    styles_json = sa.Column(Text, nullable=True)
    metadata_json = sa.Column(Text, nullable=True)
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    page: Page = relationship(
        "Page",
        back_populates="blocks",
        foreign_keys=[page_id],
    )
    parent = relationship(
        "PageBlock",
        remote_side=[id],
        back_populates="children",
        foreign_keys=[parent_block_id],
    )
    children: list[PageBlock] = relationship(
        "PageBlock",
        back_populates="parent",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PageBlock.sort_order.asc(), PageBlock.id.asc()",
    )
    style_bundle: CMSStyleBundle = relationship(
        CMSStyleBundle,
        foreign_keys=[style_bundle_id],
    )
    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )
    changed_by = relationship(
        security_manager.user_model,
        foreign_keys=[changed_by_fk],
    )

    def get_content(self) -> dict[str, Any]:
        return _json_loads(self.content_json)

    def set_content(self, value: dict[str, Any] | None) -> None:
        self.content_json = _json_dumps(value)

    def get_settings(self) -> dict[str, Any]:
        return _json_loads(self.settings_json)

    def set_settings(self, value: dict[str, Any] | None) -> None:
        self.settings_json = _json_dumps(value)

    def get_styles(self) -> dict[str, Any]:
        return _json_loads(self.styles_json)

    def set_styles(self, value: dict[str, Any] | None) -> None:
        self.styles_json = _json_dumps(value)

    def get_metadata(self) -> dict[str, Any]:
        return _json_loads(self.metadata_json)

    def set_metadata(self, value: dict[str, Any] | None) -> None:
        self.metadata_json = _json_dumps(value)


class PageLayoutConfig(Model):
    """Portal-level configurable layout/theme settings."""

    __tablename__ = "public_page_layout_configs"

    __table_args__ = (
        UniqueConstraint("scope", name="uq_public_page_layout_scope"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    scope = sa.Column(sa.String(255), nullable=False, default="public_portal")
    title = sa.Column(sa.String(255), nullable=False, default="Public Portal")
    config_json = sa.Column(Text, nullable=True)
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    def get_config(self) -> dict[str, Any]:
        return _json_loads(self.config_json)

    def set_config(self, value: dict[str, Any] | None) -> None:
        self.config_json = _json_dumps(value)


class UserPageLayout(Model):
    """Per-user section order/visibility preferences for a public page."""

    __tablename__ = "public_user_page_layouts"

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "page_id",
            name="uq_public_user_page_layout_user_page",
        ),
        sa.Index("ix_public_user_page_layouts_user_id", "user_id"),
        sa.Index("ix_public_user_page_layouts_page_id", "page_id"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    user_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="CASCADE"),
        nullable=False,
    )
    page_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_pages.id", ondelete="CASCADE"),
        nullable=False,
    )
    layout_json = sa.Column(Text, nullable=True)
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    user = relationship(
        security_manager.user_model,
        foreign_keys=[user_id],
    )
    page: Page = relationship(
        "Page",
        back_populates="layout_overrides",
        foreign_keys=[page_id],
    )

    def get_layout(self) -> dict[str, Any]:
        return _json_loads(self.layout_json)

    def set_layout(self, value: dict[str, Any] | None) -> None:
        self.layout_json = _json_dumps(value)


class PageRevision(Model):
    """Revision history snapshot for public portal pages."""

    __tablename__ = "public_page_revisions"

    __table_args__ = (
        sa.Index("ix_public_page_revisions_page_id", "page_id"),
        sa.Index(
            "ix_public_page_revisions_page_id_revision_number",
            "page_id",
            "revision_number",
        ),
        sa.Index(
            "ix_public_page_revisions_page_id_created_on",
            "page_id",
            "created_on",
        ),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    page_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("public_pages.id", ondelete="CASCADE"),
        nullable=False,
    )
    revision_number = sa.Column(sa.Integer, nullable=False, default=1)
    action = sa.Column(sa.String(64), nullable=False, default="saved")
    summary = sa.Column(sa.String(500), nullable=True)
    snapshot_json = sa.Column(Text, nullable=True)
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)

    page: Page = relationship(
        "Page",
        back_populates="revisions",
        foreign_keys=[page_id],
    )
    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )

    def get_snapshot(self) -> dict[str, Any]:
        return _json_loads(self.snapshot_json)

    def set_snapshot(self, value: dict[str, Any] | None) -> None:
        self.snapshot_json = _json_dumps(value)


# Backwards-compatible aliases for local imports. The mapped class names stay
# CMS-prefixed to avoid collisions with Superset's existing Theme model.
MediaAsset = CMSMediaAsset
ReusableBlock = CMSReusableBlock
StyleBundle = CMSStyleBundle
Theme = CMSTheme
Template = CMSTemplate
