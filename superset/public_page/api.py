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
"""Public portal configuration, navigation, page CMS, and layout APIs."""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from flask import current_app, g, request, Response, send_file
from flask_appbuilder.api import BaseApi, expose, protect, safe
from marshmallow import Schema, ValidationError, fields, validate
from sqlalchemy import func
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from superset import security_manager
from superset.extensions import db, event_logger
from superset.models.dashboard import Dashboard
from superset.models.slice import Slice
from superset.public_page.block_manager import (
    default_block_payload,
    generate_block_uid,
    is_container_block,
    legacy_sections_to_blocks,
    list_block_definitions,
)
from superset.public_page.models import (
    StyleBundle,
    Template,
    MediaAsset,
    Theme,
    NavigationItem,
    NavigationMenu,
    Page,
    PageBlock,
    PageComponent,
    PageLayoutConfig,
    PageRevision,
    PageSection,
    UserPageLayout,
    slugify,
)
from superset.public_page.styling import (
    build_css_variable_block,
    build_inline_style_from_variables,
    default_style_variables,
    default_template_structure,
    default_theme_tokens,
    flatten_theme_tokens,
    scope_css,
    style_variables_with_defaults,
    template_structure_with_defaults,
    theme_tokens_with_defaults,
    validate_custom_css,
)
from superset.utils.core import get_user_id

logger = logging.getLogger(__name__)


# Simple in-process cache for indicator highlights.
_HIGHLIGHTS_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
_HIGHLIGHTS_CACHE_TTL = 180  # seconds

PORTAL_LAYOUT_SCOPE = "public_portal"
CMS_VIEW_NAME = "CMS"
CMS_PAGE_VIEW_PERMISSION = "cms.pages.view"
CMS_PAGE_CREATE_PERMISSION = "cms.pages.create"
CMS_PAGE_EDIT_PERMISSION = "cms.pages.edit"
CMS_PAGE_DELETE_PERMISSION = "cms.pages.delete"
CMS_PAGE_PUBLISH_PERMISSION = "cms.pages.publish"
CMS_MEDIA_MANAGE_PERMISSION = "cms.media.manage"
CMS_MENU_MANAGE_PERMISSION = "cms.menus.manage"
CMS_CHART_EMBED_PERMISSION = "cms.charts.embed"
CMS_LAYOUT_MANAGE_PERMISSION = "cms.layout.manage"
CMS_THEME_MANAGE_PERMISSION = "cms.themes.manage"
CMS_TEMPLATE_MANAGE_PERMISSION = "cms.templates.manage"
CMS_STYLE_MANAGE_PERMISSION = "cms.styles.manage"
ASSET_STORAGE_SUBDIR = "public_page_assets"
DEFAULT_PUBLIC_PAGE_ALLOWED_ASSET_EXTENSIONS = {
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "csv",
    "txt",
    "ppt",
    "pptx",
    "zip",
    "json",
}


# Default configuration for public landing page
DEFAULT_PUBLIC_PAGE_CONFIG: dict[str, Any] = {
    "navbar": {
        "enabled": True,
        "height": 60,
        "backgroundColor": "#ffffff",
        "boxShadow": "none",
        "logo": {
            "enabled": True,
            "alt": "Organization Logo",
            "height": 40,
        },
        "title": {
            "enabled": True,
            "text": "Malaria Repository Analytics",
            "fontSize": "18px",
            "fontWeight": 700,
            "color": "#0f172a",
        },
        "loginButton": {
            "enabled": True,
            "text": "Login",
            "url": "/login/",
            "type": "primary",
        },
        "customLinks": [],
    },
    "sidebar": {
        "enabled": False,
        "width": 280,
        "position": "left",
        "backgroundColor": "#ffffff",
        "borderStyle": "1px solid #e2e8f0",
        "title": "Categories",
        "collapsibleOnMobile": True,
        "mobileBreakpoint": 768,
    },
    "content": {
        "backgroundColor": "#ffffff",
        "padding": "0",
        "showWelcomeMessage": True,
        "welcomeTitle": "Welcome",
        "welcomeDescription": "Explore public malaria dashboards and analytics.",
    },
    "footer": {
        "enabled": True,
        "height": 56,
        "backgroundColor": "#0f172a",
        "text": "Public Analytics Portal",
        "textColor": "#cbd5e1",
        "links": [],
    },
}

DEFAULT_PORTAL_LAYOUT_CONFIG: dict[str, Any] = {
    "portalTitle": "Uganda Malaria Analytics Portal",
    "portalSubtitle": "Serving-table analytics, public dashboards, and programme pages.",
    "welcomeBadge": "Ministry of Health",
    "accentColor": "#0f766e",
    "secondaryColor": "#1d4ed8",
    "surfaceColor": "#ffffff",
    "pageMaxWidth": "100%",
    "showThemeToggle": True,
}


def _now() -> datetime:
    return datetime.utcnow()


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError as ex:
        raise ValidationError({"scheduled_publish_at": ["Invalid datetime"]}) from ex
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _merge_dicts(default: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = default.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _merge_dicts(result[key], value)
        else:
            result[key] = value
    return result


def _role_names() -> set[str]:
    user = getattr(g, "user", None)
    if not user or getattr(user, "is_anonymous", True):
        return set()
    return {
        getattr(role, "name", "")
        for role in getattr(user, "roles", []) or []
        if getattr(role, "name", "")
    }


def _is_authenticated_user() -> bool:
    user = getattr(g, "user", None)
    return bool(user and not getattr(user, "is_anonymous", True))


def _can_manage_pages() -> bool:
    return security_manager.can_access(CMS_PAGE_VIEW_PERMISSION, CMS_VIEW_NAME)


def _can_create_pages() -> bool:
    return security_manager.can_access(CMS_PAGE_CREATE_PERMISSION, CMS_VIEW_NAME)


def _can_edit_pages() -> bool:
    return security_manager.can_access(CMS_PAGE_EDIT_PERMISSION, CMS_VIEW_NAME)


def _can_delete_pages() -> bool:
    return security_manager.can_access(CMS_PAGE_DELETE_PERMISSION, CMS_VIEW_NAME)


def _can_publish_pages() -> bool:
    return security_manager.can_access(CMS_PAGE_PUBLISH_PERMISSION, CMS_VIEW_NAME)


def _can_manage_media() -> bool:
    return security_manager.can_access(CMS_MEDIA_MANAGE_PERMISSION, CMS_VIEW_NAME)


def _can_manage_menus() -> bool:
    return security_manager.can_access(CMS_MENU_MANAGE_PERMISSION, CMS_VIEW_NAME)


def _can_embed_charts() -> bool:
    return security_manager.can_access(CMS_CHART_EMBED_PERMISSION, CMS_VIEW_NAME)


def _can_manage_layout() -> bool:
    return security_manager.can_access(CMS_LAYOUT_MANAGE_PERMISSION, CMS_VIEW_NAME)


def _can_manage_themes() -> bool:
    return security_manager.can_access(CMS_THEME_MANAGE_PERMISSION, CMS_VIEW_NAME)


def _can_manage_templates() -> bool:
    return security_manager.can_access(CMS_TEMPLATE_MANAGE_PERMISSION, CMS_VIEW_NAME)


def _can_manage_styles() -> bool:
    return security_manager.can_access(CMS_STYLE_MANAGE_PERMISSION, CMS_VIEW_NAME)


class PortalComponentSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    component_key = fields.Str(load_default=None, allow_none=True)
    component_type = fields.Str(required=True)
    title = fields.Str(load_default=None, allow_none=True)
    body = fields.Str(load_default=None, allow_none=True)
    chart_id = fields.Int(load_default=None, allow_none=True)
    dashboard_id = fields.Int(load_default=None, allow_none=True)
    style_bundle_id = fields.Int(load_default=None, allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)
    settings = fields.Dict(load_default=dict)


class PortalBlockSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    uid = fields.Str(load_default=None, allow_none=True)
    parent_block_id = fields.Int(load_default=None, allow_none=True)
    block_type = fields.Str(required=True)
    slot = fields.Str(load_default="content")
    sort_order = fields.Int(load_default=0)
    is_container = fields.Bool(load_default=False)
    visibility = fields.Str(
        load_default="public",
        validate=validate.OneOf(["draft", "authenticated", "public"]),
    )
    status = fields.Str(load_default="active")
    schema_version = fields.Int(load_default=1)
    style_bundle_id = fields.Int(load_default=None, allow_none=True)
    content = fields.Dict(load_default=dict)
    settings = fields.Dict(load_default=dict)
    styles = fields.Dict(load_default=dict)
    metadata = fields.Dict(load_default=dict)
    children = fields.List(fields.Nested(lambda: PortalBlockSchema()), load_default=list)


class PortalMediaAssetSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    slug = fields.Str(load_default=None, allow_none=True)
    title = fields.Str(required=True)
    description = fields.Str(load_default=None, allow_none=True)
    asset_type = fields.Str(load_default="file")
    visibility = fields.Str(
        load_default="private",
        validate=validate.OneOf(["private", "authenticated", "public"]),
    )
    is_public = fields.Bool(load_default=False)
    alt_text = fields.Str(load_default=None, allow_none=True)
    caption = fields.Str(load_default=None, allow_none=True)
    settings = fields.Dict(load_default=dict)


class PortalSectionSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    section_key = fields.Str(load_default=None, allow_none=True)
    title = fields.Str(load_default=None, allow_none=True)
    subtitle = fields.Str(load_default=None, allow_none=True)
    section_type = fields.Str(required=True)
    style_bundle_id = fields.Int(load_default=None, allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)
    settings = fields.Dict(load_default=dict)
    components = fields.List(
        fields.Nested(PortalComponentSchema),
        load_default=list,
    )


class PortalPageSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    slug = fields.Str(load_default=None, allow_none=True)
    title = fields.Str(required=True)
    subtitle = fields.Str(load_default=None, allow_none=True)
    description = fields.Str(load_default=None, allow_none=True)
    excerpt = fields.Str(load_default=None, allow_none=True)
    seo_title = fields.Str(load_default=None, allow_none=True)
    seo_description = fields.Str(load_default=None, allow_none=True)
    og_image_url = fields.Str(load_default=None, allow_none=True)
    featured_image_url = fields.Str(load_default=None, allow_none=True)
    parent_page_id = fields.Int(load_default=None, allow_none=True)
    navigation_label = fields.Str(load_default=None, allow_none=True)
    visibility = fields.Str(
        load_default="public",
        validate=validate.OneOf(["draft", "authenticated", "public"]),
    )
    page_type = fields.Str(load_default="content")
    template_key = fields.Str(load_default="default")
    theme_id = fields.Int(load_default=None, allow_none=True)
    template_id = fields.Int(load_default=None, allow_none=True)
    style_bundle_id = fields.Int(load_default=None, allow_none=True)
    featured_image_asset_id = fields.Int(load_default=None, allow_none=True)
    og_image_asset_id = fields.Int(load_default=None, allow_none=True)
    status = fields.Str(load_default="published")
    is_published = fields.Bool(load_default=True)
    is_homepage = fields.Bool(load_default=False)
    display_order = fields.Int(load_default=0)
    scheduled_publish_at = fields.Str(load_default=None, allow_none=True)
    settings = fields.Dict(load_default=dict)
    blocks = fields.List(fields.Nested(PortalBlockSchema), load_default=list)
    sections = fields.List(fields.Nested(PortalSectionSchema), load_default=list)


class UserLayoutSchema(Schema):
    page_id = fields.Int(load_default=None, allow_none=True)
    page_slug = fields.Str(load_default=None, allow_none=True)
    section_order = fields.List(fields.Int(), load_default=list)
    hidden_section_ids = fields.List(fields.Int(), load_default=list)
    settings = fields.Dict(load_default=dict)


class PortalMenuItemSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    parent_id = fields.Int(load_default=None, allow_none=True)
    label = fields.Str(required=True)
    item_type = fields.Str(required=True)
    href = fields.Str(load_default=None, allow_none=True)
    icon = fields.Str(load_default=None, allow_none=True)
    description = fields.Str(load_default=None, allow_none=True)
    visibility = fields.Str(
        load_default="public",
        validate=validate.OneOf(["draft", "authenticated", "public"]),
    )
    page_id = fields.Int(load_default=None, allow_none=True)
    dashboard_id = fields.Int(load_default=None, allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)
    open_in_new_tab = fields.Bool(load_default=False)
    settings = fields.Dict(load_default=dict)
    children = fields.List(fields.Nested(lambda: PortalMenuItemSchema()), load_default=list)


class PortalMenuSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    slug = fields.Str(load_default=None, allow_none=True)
    title = fields.Str(required=True)
    description = fields.Str(load_default=None, allow_none=True)
    location = fields.Str(load_default="header")
    visibility = fields.Str(
        load_default="public",
        validate=validate.OneOf(["draft", "authenticated", "public"]),
    )
    display_order = fields.Int(load_default=0)
    is_enabled = fields.Bool(load_default=True)
    settings = fields.Dict(load_default=dict)
    items = fields.List(fields.Nested(PortalMenuItemSchema), load_default=list)


class PortalLayoutConfigSchema(Schema):
    title = fields.Str(load_default="Public Portal")
    config = fields.Dict(load_default=dict)


class StyleBundleSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    slug = fields.Str(load_default=None, allow_none=True)
    title = fields.Str(required=True)
    description = fields.Str(load_default=None, allow_none=True)
    status = fields.Str(
        load_default="active",
        validate=validate.OneOf(["draft", "active", "archived"]),
    )
    is_active = fields.Bool(load_default=True)
    variables = fields.Dict(load_default=dict)
    css_text = fields.Str(load_default=None, allow_none=True)
    settings = fields.Dict(load_default=dict)


class ThemeSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    slug = fields.Str(load_default=None, allow_none=True)
    title = fields.Str(required=True)
    description = fields.Str(load_default=None, allow_none=True)
    status = fields.Str(
        load_default="active",
        validate=validate.OneOf(["draft", "active", "archived"]),
    )
    is_active = fields.Bool(load_default=True)
    is_default = fields.Bool(load_default=False)
    preview_image_url = fields.Str(load_default=None, allow_none=True)
    style_bundle_id = fields.Int(load_default=None, allow_none=True)
    tokens = fields.Dict(load_default=dict)
    settings = fields.Dict(load_default=dict)


class TemplateSchema(Schema):
    id = fields.Int(load_default=None, allow_none=True)
    slug = fields.Str(load_default=None, allow_none=True)
    title = fields.Str(required=True)
    description = fields.Str(load_default=None, allow_none=True)
    status = fields.Str(
        load_default="active",
        validate=validate.OneOf(["draft", "active", "archived"]),
    )
    is_active = fields.Bool(load_default=True)
    is_default = fields.Bool(load_default=False)
    theme_id = fields.Int(load_default=None, allow_none=True)
    style_bundle_id = fields.Int(load_default=None, allow_none=True)
    structure = fields.Dict(load_default=dict)
    settings = fields.Dict(load_default=dict)


class PublicPageRestApi(BaseApi):
    """API for public page configuration and portal CMS data."""

    resource_name = "public_page"
    allow_browser_login = True

    def _get_or_create_layout_config(self) -> PageLayoutConfig:
        layout = (
            db.session.query(PageLayoutConfig)
            .filter(PageLayoutConfig.scope == PORTAL_LAYOUT_SCOPE)
            .one_or_none()
        )
        if layout is not None:
            return layout

        layout = PageLayoutConfig(
            scope=PORTAL_LAYOUT_SCOPE,
            title="Public Portal",
        )
        layout.set_config(DEFAULT_PORTAL_LAYOUT_CONFIG)
        db.session.add(layout)
        db.session.flush()
        return layout

    def _design_item_is_publicly_usable(self, item: Any | None) -> bool:
        return bool(
            item
            and getattr(item, "is_active", False)
            and getattr(item, "status", "active") == "active"
            and getattr(item, "archived_on", None) is None
        )

    def _list_style_bundles(self, admin: bool = False) -> list[StyleBundle]:
        bundles = (
            db.session.query(StyleBundle)
            .order_by(StyleBundle.title.asc(), StyleBundle.id.asc())
            .all()
        )
        if admin:
            return bundles
        return [bundle for bundle in bundles if self._design_item_is_publicly_usable(bundle)]

    def _list_themes(self, admin: bool = False) -> list[Theme]:
        themes = (
            db.session.query(Theme)
            .order_by(Theme.is_default.desc(), Theme.title.asc(), Theme.id.asc())
            .all()
        )
        if admin:
            return themes
        return [theme for theme in themes if self._design_item_is_publicly_usable(theme)]

    def _list_templates(self, admin: bool = False) -> list[Template]:
        templates = (
            db.session.query(Template)
            .order_by(
                Template.is_default.desc(),
                Template.title.asc(),
                Template.id.asc(),
            )
            .all()
        )
        if admin:
            return templates
        return [
            template
            for template in templates
            if self._design_item_is_publicly_usable(template)
        ]

    def _find_style_bundle(
        self,
        *,
        style_bundle_id: int | None = None,
        slug: str | None = None,
        admin: bool = False,
    ) -> StyleBundle | None:
        query = db.session.query(StyleBundle)
        if style_bundle_id is not None:
            bundle = query.filter(StyleBundle.id == style_bundle_id).one_or_none()
        elif slug:
            bundle = query.filter(StyleBundle.slug == slug).one_or_none()
        else:
            bundle = None
        if bundle is None:
            return None
        if admin or self._design_item_is_publicly_usable(bundle):
            return bundle
        return None

    def _find_theme(
        self,
        *,
        theme_id: int | None = None,
        slug: str | None = None,
        admin: bool = False,
    ) -> Theme | None:
        query = db.session.query(Theme)
        if theme_id is not None:
            theme = query.filter(Theme.id == theme_id).one_or_none()
        elif slug:
            theme = query.filter(Theme.slug == slug).one_or_none()
        else:
            theme = None
        if theme is None:
            return None
        if admin or self._design_item_is_publicly_usable(theme):
            return theme
        return None

    def _find_template(
        self,
        *,
        template_id: int | None = None,
        slug: str | None = None,
        admin: bool = False,
    ) -> Template | None:
        query = db.session.query(Template)
        if template_id is not None:
            template = query.filter(Template.id == template_id).one_or_none()
        elif slug:
            template = query.filter(Template.slug == slug).one_or_none()
        else:
            template = None
        if template is None:
            return None
        if admin or self._design_item_is_publicly_usable(template):
            return template
        return None

    def _default_theme(self, admin: bool = False) -> Theme | None:
        query = db.session.query(Theme).order_by(Theme.id.asc())
        if not admin:
            query = query.filter(Theme.is_active == True, Theme.status == "active")
        theme = query.filter(Theme.is_default == True).one_or_none()
        if theme is not None:
            return theme
        return query.first()

    def _default_template(self, admin: bool = False) -> Template | None:
        query = db.session.query(Template).order_by(Template.id.asc())
        if not admin:
            query = query.filter(
                Template.is_active == True,
                Template.status == "active",
            )
        template = query.filter(Template.is_default == True).one_or_none()
        if template is not None:
            return template
        return query.first()

    def _serialize_style_bundle(
        self,
        bundle: StyleBundle | None,
        include_admin: bool = False,
    ) -> dict[str, Any] | None:
        if bundle is None:
            return None
        payload = {
            "id": bundle.id,
            "slug": bundle.slug,
            "title": bundle.title,
            "description": bundle.description,
            "status": bundle.status,
            "is_active": bundle.is_active,
            "variables": style_variables_with_defaults(bundle.get_variables()),
            "settings": bundle.get_settings(),
        }
        if include_admin:
            payload.update(
                {
                    "css_text": bundle.css_text or "",
                    "created_on": _to_iso(bundle.created_on),
                    "changed_on": _to_iso(bundle.changed_on),
                    "archived_on": _to_iso(bundle.archived_on),
                    "created_by": self._serialize_user_ref(bundle.created_by),
                    "changed_by": self._serialize_user_ref(bundle.changed_by),
                }
            )
        return payload

    def _serialize_theme(
        self,
        theme: Theme | None,
        include_admin: bool = False,
    ) -> dict[str, Any] | None:
        if theme is None:
            return None
        payload = {
            "id": theme.id,
            "slug": theme.slug,
            "title": theme.title,
            "description": theme.description,
            "status": theme.status,
            "is_active": theme.is_active,
            "is_default": theme.is_default,
            "preview_image_url": theme.preview_image_url,
            "style_bundle_id": theme.style_bundle_id,
            "tokens": theme_tokens_with_defaults(theme.get_tokens()),
            "settings": theme.get_settings(),
            "style_bundle": self._serialize_style_bundle(
                theme.style_bundle,
                include_admin=include_admin,
            ),
        }
        if include_admin:
            payload.update(
                {
                    "created_on": _to_iso(theme.created_on),
                    "changed_on": _to_iso(theme.changed_on),
                    "archived_on": _to_iso(theme.archived_on),
                    "created_by": self._serialize_user_ref(theme.created_by),
                    "changed_by": self._serialize_user_ref(theme.changed_by),
                }
            )
        return payload

    def _serialize_template(
        self,
        template: Template | None,
        include_admin: bool = False,
    ) -> dict[str, Any] | None:
        if template is None:
            return None
        payload = {
            "id": template.id,
            "slug": template.slug,
            "title": template.title,
            "description": template.description,
            "status": template.status,
            "is_active": template.is_active,
            "is_default": template.is_default,
            "theme_id": template.theme_id,
            "style_bundle_id": template.style_bundle_id,
            "structure": template_structure_with_defaults(template.get_structure()),
            "settings": template.get_settings(),
            "theme": self._serialize_theme(template.theme, include_admin=False),
            "style_bundle": self._serialize_style_bundle(
                template.style_bundle,
                include_admin=include_admin,
            ),
        }
        if include_admin:
            payload.update(
                {
                    "created_on": _to_iso(template.created_on),
                    "changed_on": _to_iso(template.changed_on),
                    "archived_on": _to_iso(template.archived_on),
                    "created_by": self._serialize_user_ref(template.created_by),
                    "changed_by": self._serialize_user_ref(template.changed_by),
                }
            )
        return payload

    def _style_css_variables(self, variables: dict[str, Any] | None) -> dict[str, str]:
        style_variables = style_variables_with_defaults(variables)
        css_variables: dict[str, str] = {}
        for key, value in style_variables.items():
            if value:
                css_variables[f"--cms-style-{slugify(key, key)}"] = str(value)
        return css_variables

    def _resolve_scoped_style(
        self,
        bundle: StyleBundle | None,
        selector: str,
        public_context: bool = True,
    ) -> dict[str, Any]:
        if bundle is None:
            return {
                "style_bundle": None,
                "inline_style": {},
                "css_text": "",
                "css_variables": {},
                "warnings": [],
            }
        if public_context and not self._design_item_is_publicly_usable(bundle):
            return {
                "style_bundle": None,
                "inline_style": {},
                "css_text": "",
                "css_variables": {},
                "warnings": [f"Inactive style bundle {bundle.title} was ignored"],
            }

        variables = style_variables_with_defaults(bundle.get_variables())
        css_variables = self._style_css_variables(variables)
        scoped_css = ""
        warnings: list[str] = []
        try:
            scoped_css = scope_css(bundle.css_text or "", selector)
        except ValueError as ex:
            warnings.append(str(ex))

        return {
            "style_bundle": self._serialize_style_bundle(bundle, include_admin=not public_context),
            "inline_style": build_inline_style_from_variables(variables),
            "css_text": build_css_variable_block(selector, css_variables) + scoped_css,
            "css_variables": css_variables,
            "warnings": warnings,
        }

    def _build_generated_template_css(
        self,
        structure: dict[str, Any],
        selector: str,
    ) -> str:
        sidebar_enabled = bool(structure.get("regions", {}).get("sidebar", {}).get("enabled"))
        sidebar_width = (
            structure.get("settings", {}).get("sidebarWidth")
            or default_template_structure()["settings"]["sidebarWidth"]
        )
        if not sidebar_enabled:
            return ""
        return (
            f"{selector} .cms-template-content-shell {{ display: grid; "
            f"grid-template-columns: minmax(0, 1fr) {sidebar_width}; gap: 24px; "
            f"align-items: start; }}\n"
            "@media (max-width: 980px) { "
            f"{selector} .cms-template-content-shell {{ grid-template-columns: 1fr; }} "
            "}\n"
        )

    def _resolve_page_rendering(
        self,
        page: Page,
        public_context: bool = True,
    ) -> dict[str, Any]:
        warnings: list[str] = []
        page_scope_slug = slugify(page.slug or page.title or f"page-{page.id}", "page")
        scope_class = f"cms-page-scope-{page_scope_slug}"
        scope_selector = f".{scope_class}"

        theme = page.theme
        if theme is not None and public_context and not self._design_item_is_publicly_usable(theme):
            warnings.append(f"Inactive theme {theme.title} was ignored")
            theme = None
        if theme is None:
            theme = self._default_theme(admin=not public_context)
            if theme is None:
                warnings.append("No default theme is configured")

        template = page.template
        if template is None and page.template_key:
            template = self._find_template(
                slug=page.template_key,
                admin=not public_context,
            )
        if template is not None and public_context and not self._design_item_is_publicly_usable(template):
            warnings.append(f"Inactive template {template.title} was ignored")
            template = None
        if template is None:
            template = self._default_template(admin=not public_context)
            if template is None:
                warnings.append("No default template is configured")

        if theme is None and template and template.theme:
            if public_context and not self._design_item_is_publicly_usable(template.theme):
                warnings.append(
                    f"Inactive template theme {template.theme.title} was ignored"
                )
            else:
                theme = template.theme

        theme_tokens = theme_tokens_with_defaults(theme.get_tokens() if theme else None)
        css_variables = flatten_theme_tokens(theme_tokens)
        template_structure = template_structure_with_defaults(
            template.get_structure() if template else None
        )
        css_parts = [build_css_variable_block(scope_selector, css_variables)]
        css_parts.append(self._build_generated_template_css(template_structure, scope_selector))

        if theme and theme.style_bundle:
            resolved = self._resolve_scoped_style(
                theme.style_bundle,
                scope_selector,
                public_context=public_context,
            )
            css_parts.append(resolved["css_text"])
            warnings.extend(resolved["warnings"])

        if template and template.style_bundle:
            resolved = self._resolve_scoped_style(
                template.style_bundle,
                scope_selector,
                public_context=public_context,
            )
            css_parts.append(resolved["css_text"])
            warnings.extend(resolved["warnings"])

        page_style_rendering = self._resolve_scoped_style(
            page.style_bundle,
            scope_selector,
            public_context=public_context,
        )
        if page_style_rendering["css_text"]:
            css_parts.append(page_style_rendering["css_text"])
        warnings.extend(page_style_rendering["warnings"])

        return {
            "scope_class": scope_class,
            "css_variables": css_variables,
            "css_text": "\n".join(part for part in css_parts if part),
            "warnings": warnings,
            "theme": self._serialize_theme(theme, include_admin=not public_context),
            "template": self._serialize_template(template, include_admin=not public_context),
            "style_bundle": page_style_rendering["style_bundle"],
            "template_structure": template_structure,
        }

    def _serialize_dashboard(self, dash: Dashboard) -> dict[str, Any]:
        return {
            "id": dash.id,
            "uuid": str(dash.uuid) if getattr(dash, "uuid", None) else None,
            "dashboard_title": dash.dashboard_title,
            "slug": dash.slug or "",
            "url": f"/superset/dashboard/{dash.slug or dash.id}/",
            "display_order": dash.display_order,
        }

    def _chart_uses_serving_tables(self, chart: Slice) -> bool:
        datasource = getattr(chart, "table", None)
        return bool(datasource and getattr(datasource, "is_dhis2_staged_local", False))

    def _serialize_chart(self, chart: Slice) -> dict[str, Any]:
        return {
            "id": chart.id,
            "slice_name": chart.slice_name,
            "description": chart.description or "",
            "viz_type": chart.viz_type,
            "url": f"/superset/explore/?slice_id={chart.id}&standalone=true",
            "is_public": bool(getattr(chart, "is_public", False)),
            "uses_serving_dataset": self._chart_uses_serving_tables(chart),
        }

    def _serialize_user_ref(self, user: Any | None) -> dict[str, Any] | None:
        if user is None:
            return None
        name = " ".join(
            filter(
                None,
                [
                    getattr(user, "first_name", None),
                    getattr(user, "last_name", None),
                ],
            )
        ).strip()
        return {
            "id": getattr(user, "id", None),
            "username": getattr(user, "username", None),
            "name": name or getattr(user, "username", None),
        }

    def _asset_is_publicly_viewable(self, asset: MediaAsset) -> bool:
        if asset.status != "active":
            return False
        if asset.visibility != "public":
            return False
        return bool(asset.is_public)

    def _serialize_media_asset(
        self,
        asset: MediaAsset | None,
        *,
        include_admin: bool = False,
    ) -> dict[str, Any] | None:
        if asset is None:
            return None
        payload = {
            "id": asset.id,
            "slug": asset.slug,
            "title": asset.title,
            "description": asset.description,
            "asset_type": asset.asset_type,
            "mime_type": asset.mime_type,
            "file_extension": asset.file_extension,
            "original_filename": asset.original_filename,
            "file_size": asset.file_size,
            "visibility": asset.visibility,
            "is_public": asset.is_public,
            "status": asset.status,
            "alt_text": asset.alt_text,
            "caption": asset.caption,
            "width": asset.width,
            "height": asset.height,
            "settings": asset.get_settings(),
            "download_url": f"/api/v1/public_page/assets/{asset.id}/download",
        }
        if include_admin:
            payload.update(
                {
                    "storage_path": asset.storage_path,
                    "checksum": asset.checksum,
                    "archived_on": _to_iso(asset.archived_on),
                    "created_on": _to_iso(asset.created_on),
                    "changed_on": _to_iso(asset.changed_on),
                    "created_by": self._serialize_user_ref(asset.created_by),
                    "changed_by": self._serialize_user_ref(asset.changed_by),
                    "archived_by": self._serialize_user_ref(asset.archived_by),
                }
            )
        return payload

    def _allowed_asset_extensions(self) -> set[str]:
        configured = current_app.config.get("PUBLIC_PAGE_ALLOWED_UPLOAD_EXTENSIONS")
        if configured:
            return {str(extension).strip(".").lower() for extension in configured}
        return set(DEFAULT_PUBLIC_PAGE_ALLOWED_ASSET_EXTENSIONS)

    def _asset_upload_root(self) -> str:
        upload_root = current_app.config.get("UPLOAD_FOLDER") or os.path.join(
            current_app.root_path,
            "static",
            "uploads",
        )
        path = os.path.join(upload_root, ASSET_STORAGE_SUBDIR)
        os.makedirs(path, exist_ok=True)
        return path

    def _resolve_asset_storage_path(self, asset: MediaAsset) -> str:
        return os.path.join(self._asset_upload_root(), asset.storage_path)

    def _asset_type_for_file(self, mimetype: str | None, extension: str | None) -> str:
        normalized_extension = (extension or "").lower()
        if mimetype and mimetype.startswith("image/"):
            return "image"
        if mimetype and mimetype.startswith("video/"):
            return "video"
        if mimetype and mimetype.startswith("audio/"):
            return "audio"
        if normalized_extension in {"png", "jpg", "jpeg", "gif", "webp", "svg"}:
            return "image"
        return "file"

    def _generate_unique_asset_slug(self, candidate: str) -> str:
        base = slugify(candidate, "asset")
        next_slug = base
        suffix = 2
        while db.session.query(MediaAsset).filter(MediaAsset.slug == next_slug).one_or_none():
            next_slug = f"{base}-{suffix}"
            suffix += 1
        return next_slug

    def _store_uploaded_asset(
        self,
        upload: FileStorage,
        *,
        title: str | None = None,
        description: str | None = None,
        visibility: str = "private",
        is_public: bool = False,
        alt_text: str | None = None,
        caption: str | None = None,
    ) -> MediaAsset:
        filename = secure_filename(upload.filename or "")
        if not filename:
            raise ValidationError({"file": ["A file is required"]})
        extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if extension not in self._allowed_asset_extensions():
            raise ValidationError({"file": ["File type is not allowed"]})
        slug = self._generate_unique_asset_slug(title or filename)
        stored_name = f"{slug}-{uuid4().hex[:8]}.{extension}" if extension else slug
        storage_root = self._asset_upload_root()
        absolute_path = os.path.join(storage_root, stored_name)
        upload.save(absolute_path)

        with open(absolute_path, "rb") as saved_file:
            checksum = hashlib.sha256(saved_file.read()).hexdigest()
        file_size = os.path.getsize(absolute_path)
        mimetype = upload.mimetype or mimetypes.guess_type(filename)[0]
        asset = MediaAsset(
            slug=slug,
            title=(title or os.path.splitext(filename)[0] or "Asset").strip(),
            description=description,
            asset_type=self._asset_type_for_file(mimetype, extension),
            mime_type=mimetype,
            file_extension=extension or None,
            original_filename=filename,
            storage_path=stored_name,
            file_size=file_size,
            checksum=checksum,
            visibility=visibility,
            is_public=bool(is_public or visibility == "public"),
            status="active",
            alt_text=alt_text,
            caption=caption,
            created_by_fk=get_user_id(),
            changed_by_fk=get_user_id(),
        )
        asset.set_settings({})
        db.session.add(asset)
        db.session.flush()
        return asset

    def _list_media_assets(self, admin: bool = False) -> list[MediaAsset]:
        assets = (
            db.session.query(MediaAsset)
            .order_by(MediaAsset.created_on.desc(), MediaAsset.id.desc())
            .all()
        )
        if admin:
            return assets
        return [asset for asset in assets if self._asset_is_publicly_viewable(asset)]

    def _validate_asset_reference(
        self,
        asset_id: int | None,
        *,
        field_name: str = "asset_id",
        require_public: bool = False,
    ) -> MediaAsset | None:
        if not asset_id:
            return None
        asset = db.session.query(MediaAsset).filter(MediaAsset.id == asset_id).one_or_none()
        if asset is None or asset.status != "active":
            raise ValidationError({field_name: ["Asset not found"]})
        if require_public and not self._asset_is_publicly_viewable(asset):
            raise ValidationError({field_name: ["Asset must be public for public pages"]})
        return asset

    def _page_path_parts(self, page: Page) -> list[str]:
        parts: list[str] = []
        current = page
        seen_ids: set[int] = set()
        while current is not None:
            if current.id is not None and current.id in seen_ids:
                break
            if current.id is not None:
                seen_ids.add(current.id)
            parts.append(current.slug)
            current = current.parent_page
        return list(reversed(parts))

    def _page_path(self, page: Page) -> str:
        return "/".join(self._page_path_parts(page))

    def _page_breadcrumbs(
        self,
        page: Page | None,
        *,
        public_context: bool = False,
    ) -> list[dict[str, Any]]:
        if page is None:
            return []
        chain: list[Page] = []
        current = page
        seen_ids: set[int] = set()
        while current is not None:
            if current.id is not None and current.id in seen_ids:
                break
            if current.id is not None:
                seen_ids.add(current.id)
            chain.append(current)
            current = current.parent_page
        chain.reverse()
        breadcrumbs: list[dict[str, Any]] = []
        for entry in chain:
            if public_context and not self._page_is_publicly_viewable(entry):
                continue
            breadcrumbs.append(
                {
                    "id": entry.id,
                    "title": entry.navigation_label or entry.title,
                    "slug": entry.slug,
                    "path": f"/superset/public/{self._page_path(entry)}/",
                }
            )
        return breadcrumbs

    def _page_is_publicly_viewable(
        self,
        page: Page,
        at_time: datetime | None = None,
    ) -> bool:
        if page.visibility != "public":
            return False
        if not page.is_published:
            return False
        if page.status == "archived" or page.archived_on is not None:
            return False

        publish_at = page.scheduled_publish_at or page.published_on
        now = at_time or _now()
        if publish_at and publish_at > now:
            return False

        return page.status in {"published", "scheduled"}

    def _menu_is_publicly_visible(self, visibility: str | None) -> bool:
        return (visibility or "public") == "public"

    def _list_public_dashboards(self) -> list[Dashboard]:
        return (
            db.session.query(Dashboard)
            .filter(Dashboard.published == True)
            .order_by(Dashboard.display_order.asc().nullslast(), Dashboard.id.asc())
            .all()
        )

    def _list_serving_charts(self, public_only: bool = False) -> list[Slice]:
        query = db.session.query(Slice).order_by(Slice.slice_name.asc())
        if public_only:
            query = query.filter(Slice.is_public == True)
        charts = query.all()
        return [chart for chart in charts if self._chart_uses_serving_tables(chart)]

    def _list_public_serving_charts(self) -> list[Slice]:
        return self._list_serving_charts(public_only=True)

    def _list_pages(self, admin: bool = False) -> list[Page]:
        pages = (
            db.session.query(Page)
            .order_by(Page.display_order.asc(), Page.id.asc())
            .all()
        )
        if admin:
            return pages
        return [page for page in pages if self._page_is_publicly_viewable(page)]

    def _find_page(
        self,
        page_slug: str | None = None,
        page_id: int | None = None,
        admin: bool = False,
    ) -> Page | None:
        query = db.session.query(Page)
        if page_id:
            page = query.filter(Page.id == page_id).one_or_none()
            if page is None or (not admin and not self._page_is_publicly_viewable(page)):
                return None
            return page
        if page_slug:
            normalized = page_slug.strip("/")
            page = query.filter(Page.slug == normalized).one_or_none()
            if page is None or (not admin and not self._page_is_publicly_viewable(page)):
                pages = self._list_pages(admin=admin)
                for candidate in pages:
                    if self._page_path(candidate) == normalized:
                        return candidate
                return None
            return page

        pages = self._list_pages(admin=admin)
        homepage = next((page for page in pages if page.is_homepage), None)
        if homepage is not None:
            return homepage
        return pages[0] if pages else None

    def _block_scope_class(self, block: PageBlock | dict[str, Any]) -> str:
        key = None
        if isinstance(block, dict):
            key = (
                block.get("uid")
                or block.get("content", {}).get("title")
                or block.get("metadata", {}).get("label")
            )
        else:
            metadata = block.get_metadata()
            content = block.get_content()
            key = block.uid or content.get("title") or metadata.get("label")
        return f"cms-block-{slugify(key, 'block')}"

    def _legacy_blocks_for_page(self, page: Page) -> list[dict[str, Any]]:
        if not page.sections:
            return []
        legacy_sections = []
        for section in sorted(page.sections, key=lambda item: (item.display_order, item.id or 0)):
            legacy_sections.append(
                {
                    "id": section.id,
                    "section_key": section.section_key,
                    "title": section.title,
                    "subtitle": section.subtitle,
                    "section_type": section.section_type,
                    "style_bundle_id": section.style_bundle_id,
                    "display_order": section.display_order,
                    "is_visible": section.is_visible,
                    "settings": section.get_settings(),
                    "components": [
                        {
                            "id": component.id,
                            "component_key": component.component_key,
                            "component_type": component.component_type,
                            "title": component.title,
                            "body": component.body,
                            "chart_id": component.chart_id,
                            "dashboard_id": component.dashboard_id,
                            "style_bundle_id": component.style_bundle_id,
                            "display_order": component.display_order,
                            "is_visible": component.is_visible,
                            "settings": component.get_settings(),
                        }
                        for component in sorted(
                            section.components,
                            key=lambda item: (item.display_order, item.id or 0),
                        )
                    ],
                }
            )
        return legacy_sections_to_blocks(legacy_sections)

    def _block_chart_reference(
        self,
        block_settings: dict[str, Any],
    ) -> int | None:
        chart_ref = block_settings.get("chart_ref") or block_settings.get("chartRef")
        if isinstance(chart_ref, dict) and chart_ref.get("id") is not None:
            return int(chart_ref["id"])
        chart_id = block_settings.get("chart_id") or block_settings.get("chartId")
        return int(chart_id) if chart_id is not None else None

    def _block_dashboard_reference(
        self,
        block_settings: dict[str, Any],
    ) -> int | None:
        dashboard_ref = block_settings.get("dashboard_ref") or block_settings.get(
            "dashboardRef"
        )
        if isinstance(dashboard_ref, dict) and dashboard_ref.get("id") is not None:
            return int(dashboard_ref["id"])
        dashboard_id = block_settings.get("dashboard_id") or block_settings.get(
            "dashboardId"
        )
        return int(dashboard_id) if dashboard_id is not None else None

    def _block_asset_reference(
        self,
        block_type: str,
        block_content: dict[str, Any],
        block_settings: dict[str, Any],
    ) -> int | None:
        for candidate in (
            block_settings.get("asset_ref"),
            block_settings.get("assetRef"),
            block_content.get("asset_ref"),
            block_content.get("assetRef"),
            block_content.get("asset"),
        ):
            if isinstance(candidate, dict) and candidate.get("id") is not None:
                return int(candidate["id"])
        direct_value = (
            block_settings.get("asset_id")
            or block_settings.get("assetId")
            or block_content.get("asset_id")
            or block_content.get("assetId")
        )
        if direct_value is not None:
            return int(direct_value)
        if block_type == "image":
            image_ref = block_content.get("image")
            if isinstance(image_ref, dict) and image_ref.get("id") is not None:
                return int(image_ref["id"])
        return None

    def _serialize_block(
        self,
        block: PageBlock | dict[str, Any],
        page_rendering: dict[str, Any] | None = None,
        public_context: bool = False,
    ) -> dict[str, Any]:
        if isinstance(block, dict):
            content = dict(block.get("content") or {})
            settings = dict(block.get("settings") or {})
            styles = dict(block.get("styles") or {})
            metadata = dict(block.get("metadata") or {})
            style_bundle = None
            style_bundle_id = block.get("style_bundle_id")
            scope_class = self._block_scope_class(block)
            children_payload = block.get("children") or []
            block_type = block.get("block_type") or "rich_text"
            status = block.get("status") or "active"
            visibility = block.get("visibility") or "public"
            block_id = block.get("id")
            uid = block.get("uid")
            parent_block_id = block.get("parent_block_id")
            slot = block.get("slot") or "content"
            sort_order = int(block.get("sort_order") or 0)
            is_container = bool(
                block.get("is_container", is_container_block(block_type))
            )
            schema_version = int(block.get("schema_version") or 1)
            tree_path = block.get("tree_path")
            depth = int(block.get("depth") or 0)
        else:
            content = block.get_content()
            settings = block.get_settings()
            styles = block.get_styles()
            metadata = block.get_metadata()
            style_bundle = block.style_bundle
            style_bundle_id = block.style_bundle_id
            scope_class = self._block_scope_class(block)
            children_payload = sorted(
                block.children,
                key=lambda item: (item.sort_order, item.id or 0),
            )
            block_type = block.block_type
            status = block.status
            visibility = block.visibility
            block_id = block.id
            uid = block.uid
            parent_block_id = block.parent_block_id
            slot = block.slot
            sort_order = block.sort_order
            is_container = block.is_container
            schema_version = block.schema_version
            tree_path = block.tree_path
            depth = block.depth

        chart_id = self._block_chart_reference(settings)
        dashboard_id = self._block_dashboard_reference(settings)
        serialized_chart = None
        serialized_dashboard = None
        serialized_asset = None
        chart = None
        dashboard = None
        asset = None
        if chart_id is not None:
            chart = db.session.query(Slice).filter(Slice.id == chart_id).one_or_none()
        if dashboard_id is not None:
            dashboard = (
                db.session.query(Dashboard).filter(Dashboard.id == dashboard_id).one_or_none()
            )
        asset_id = self._block_asset_reference(block_type, content, settings)
        if asset_id is not None:
            asset = (
                db.session.query(MediaAsset).filter(MediaAsset.id == asset_id).one_or_none()
            )

        if chart is not None and self._chart_uses_serving_tables(chart):
            if not public_context or bool(getattr(chart, "is_public", False)):
                serialized_chart = self._serialize_chart(chart)
            elif block_type == "chart":
                settings = {
                    **settings,
                    "render_error": "Chart is unavailable for public rendering",
                }

        if dashboard is not None:
            if not public_context or bool(getattr(dashboard, "published", False)):
                serialized_dashboard = self._serialize_dashboard(dashboard)
            elif block_type == "dashboard":
                settings = {
                    **settings,
                    "render_error": "Dashboard is unavailable for public rendering",
                }

        if asset is not None and asset.status == "active":
            if not public_context or self._asset_is_publicly_viewable(asset):
                serialized_asset = self._serialize_media_asset(
                    asset,
                    include_admin=not public_context,
                )
                if block_type == "image":
                    content = {
                        **content,
                        "url": content.get("url") or serialized_asset["download_url"],
                        "alt": content.get("alt") or asset.alt_text,
                        "caption": content.get("caption") or asset.caption,
                        "title": content.get("title") or asset.title,
                    }
                elif block_type in {"file", "download"}:
                    content = {
                        **content,
                        "title": content.get("title") or asset.title,
                        "body": content.get("body") or asset.description or "",
                        "asset": serialized_asset,
                    }
                    settings = {
                        **settings,
                        "download_url": settings.get("download_url")
                        or serialized_asset["download_url"],
                    }
            elif block_type in {"image", "file", "download"}:
                settings = {
                    **settings,
                    "render_error": "Asset is unavailable for public rendering",
                }

        page_scope = page_rendering["scope_class"] if page_rendering else "cms-page-scope-preview"
        style_rendering = self._resolve_scoped_style(
            style_bundle,
            f".{page_scope} .{scope_class}",
            public_context=public_context,
        )
        children = [
            self._serialize_block(
                child,
                page_rendering=page_rendering,
                public_context=public_context,
            )
            for child in children_payload
        ]
        return {
            "id": block_id,
            "uid": uid,
            "parent_block_id": parent_block_id,
            "block_type": block_type,
            "slot": slot,
            "sort_order": sort_order,
            "tree_path": tree_path,
            "depth": depth,
            "is_container": is_container,
            "visibility": visibility,
            "status": status,
            "schema_version": schema_version,
            "style_bundle_id": style_bundle_id,
            "content": content,
            "settings": settings,
            "styles": styles,
            "metadata": metadata,
            "chart": serialized_chart,
            "dashboard": serialized_dashboard,
            "asset": serialized_asset,
            "children": children,
            "style_bundle": style_rendering["style_bundle"],
            "rendering": {
                "scope_class": scope_class,
                "css_text": style_rendering["css_text"],
                "css_variables": style_rendering["css_variables"],
                "inline_style": style_rendering["inline_style"],
                "warnings": style_rendering["warnings"],
            },
        }

    def _section_scope_class(self, section: PageSection) -> str:
        key = section.section_key or section.title or f"section-{section.id or 'preview'}"
        return f"cms-section-{slugify(key, 'section')}"

    def _component_scope_class(self, component: PageComponent) -> str:
        key = component.component_key or component.title or f"component-{component.id or 'preview'}"
        return f"cms-component-{slugify(key, 'component')}"

    def _serialize_component(
        self,
        component: PageComponent,
        page_rendering: dict[str, Any] | None = None,
        public_context: bool = False,
    ) -> dict[str, Any]:
        settings = component.get_settings()
        chart = component.chart
        dashboard = component.dashboard
        serialized_chart = None
        serialized_dashboard = None

        if chart is not None and self._chart_uses_serving_tables(chart):
            if not public_context or bool(getattr(chart, "is_public", False)):
                serialized_chart = self._serialize_chart(chart)
            elif component.component_type == "chart":
                settings = {
                    **settings,
                    "render_error": "Chart is unavailable for public rendering",
                }

        if dashboard is not None:
            if not public_context or bool(getattr(dashboard, "published", False)):
                serialized_dashboard = self._serialize_dashboard(dashboard)
            elif component.component_type == "dashboard":
                settings = {
                    **settings,
                    "render_error": "Dashboard is unavailable for public rendering",
                }

        scope_class = self._component_scope_class(component)
        page_scope = page_rendering["scope_class"] if page_rendering else "cms-page-scope-preview"
        style_rendering = self._resolve_scoped_style(
            component.style_bundle,
            f".{page_scope} .{scope_class}",
            public_context=public_context,
        )

        return {
            "id": component.id,
            "component_key": component.component_key,
            "component_type": component.component_type,
            "title": component.title,
            "body": component.body,
            "chart_id": component.chart_id,
            "dashboard_id": component.dashboard_id,
            "style_bundle_id": component.style_bundle_id,
            "display_order": component.display_order,
            "is_visible": component.is_visible,
            "settings": settings,
            "chart": serialized_chart,
            "dashboard": serialized_dashboard,
            "style_bundle": style_rendering["style_bundle"],
            "rendering": {
                "scope_class": scope_class,
                "css_text": style_rendering["css_text"],
                "css_variables": style_rendering["css_variables"],
                "inline_style": style_rendering["inline_style"],
                "warnings": style_rendering["warnings"],
            },
        }

    def _serialize_section(
        self,
        section: PageSection,
        page_rendering: dict[str, Any] | None = None,
        public_context: bool = False,
    ) -> dict[str, Any]:
        scope_class = self._section_scope_class(section)
        page_scope = page_rendering["scope_class"] if page_rendering else "cms-page-scope-preview"
        style_rendering = self._resolve_scoped_style(
            section.style_bundle,
            f".{page_scope} .{scope_class}",
            public_context=public_context,
        )
        return {
            "id": section.id,
            "section_key": section.section_key,
            "title": section.title,
            "subtitle": section.subtitle,
            "section_type": section.section_type,
            "style_bundle_id": section.style_bundle_id,
            "display_order": section.display_order,
            "is_visible": section.is_visible,
            "settings": section.get_settings(),
            "components": [
                self._serialize_component(
                    component,
                    page_rendering=page_rendering,
                    public_context=public_context,
                )
                for component in sorted(
                    section.components,
                    key=lambda item: (item.display_order, item.id or 0),
                )
            ],
            "style_bundle": style_rendering["style_bundle"],
            "rendering": {
                "scope_class": scope_class,
                "css_text": style_rendering["css_text"],
                "css_variables": style_rendering["css_variables"],
                "inline_style": style_rendering["inline_style"],
                "warnings": style_rendering["warnings"],
            },
        }

    def _serialize_page_summary(
        self,
        page: Page,
        include_admin: bool = False,
    ) -> dict[str, Any]:
        page_path = self._page_path(page)
        payload = {
            "id": page.id,
            "slug": page.slug,
            "path": page_path,
            "title": page.title,
            "subtitle": page.subtitle,
            "description": page.description,
            "excerpt": page.excerpt,
            "is_published": page.is_published,
            "is_homepage": page.is_homepage,
            "display_order": page.display_order,
            "parent_page_id": page.parent_page_id,
            "navigation_label": page.navigation_label,
            "theme_id": page.theme_id,
            "template_id": page.template_id,
            "style_bundle_id": page.style_bundle_id,
            "featured_image_asset_id": page.featured_image_asset_id,
            "og_image_asset_id": page.og_image_asset_id,
            "settings": page.get_settings(),
            "parent_page": (
                {
                    "id": page.parent_page.id,
                    "slug": page.parent_page.slug,
                    "path": self._page_path(page.parent_page),
                    "title": page.parent_page.title,
                    "navigation_label": page.parent_page.navigation_label,
                }
                if page.parent_page is not None
                else None
            ),
            "featured_image_asset": self._serialize_media_asset(
                page.featured_image_asset,
                include_admin=include_admin,
            ),
            "og_image_asset": self._serialize_media_asset(
                page.og_image_asset,
                include_admin=include_admin,
            ),
            "theme": self._serialize_theme(page.theme, include_admin=include_admin),
            "template": self._serialize_template(
                page.template,
                include_admin=include_admin,
            ),
            "style_bundle": self._serialize_style_bundle(
                page.style_bundle,
                include_admin=include_admin,
            ),
        }
        if include_admin:
            payload.update(
                {
                    "status": page.status,
                    "visibility": page.visibility,
                    "page_type": page.page_type,
                    "template_key": page.template_key,
                    "seo_title": page.seo_title,
                    "seo_description": page.seo_description,
                    "og_image_url": page.og_image_url,
                    "featured_image_url": page.featured_image_url,
                    "scheduled_publish_at": _to_iso(page.scheduled_publish_at),
                    "published_on": _to_iso(page.published_on),
                    "archived_on": _to_iso(page.archived_on),
                    "created_on": _to_iso(page.created_on),
                    "changed_on": _to_iso(page.changed_on),
                    "created_by": self._serialize_user_ref(page.created_by),
                    "changed_by": self._serialize_user_ref(page.changed_by),
                    "published_by": self._serialize_user_ref(page.published_by),
                    "archived_by": self._serialize_user_ref(page.archived_by),
                }
            )
        return payload

    def _serialize_page(
        self,
        page: Page,
        include_admin: bool = False,
        public_context: bool = False,
    ) -> dict[str, Any]:
        page_rendering = self._resolve_page_rendering(
            page,
            public_context=public_context,
        )
        sections = [
            self._serialize_section(
                section,
                page_rendering=page_rendering,
                public_context=public_context,
            )
            for section in sorted(
                page.sections,
                key=lambda item: (item.display_order, item.id or 0),
            )
        ]
        raw_blocks: list[PageBlock | dict[str, Any]]
        if page.blocks:
            raw_blocks = sorted(page.blocks, key=lambda item: (item.tree_path, item.id or 0))
        else:
            raw_blocks = self._legacy_blocks_for_page(page)
        block_roots: list[PageBlock | dict[str, Any]] = []
        if raw_blocks and isinstance(raw_blocks[0], PageBlock):
            block_roots = [block for block in raw_blocks if block.parent_block_id is None]
        else:
            block_roots = raw_blocks
        blocks = [
            self._serialize_block(
                block,
                page_rendering=page_rendering,
                public_context=public_context,
            )
            for block in block_roots
        ]
        combined_css = [page_rendering["css_text"]]
        for section in sections:
            if section["rendering"]["css_text"]:
                combined_css.append(section["rendering"]["css_text"])
            for component in section["components"]:
                if component["rendering"]["css_text"]:
                    combined_css.append(component["rendering"]["css_text"])
        for block in blocks:
            stack = [block]
            while stack:
                current = stack.pop()
                if current["rendering"]["css_text"]:
                    combined_css.append(current["rendering"]["css_text"])
                stack.extend(reversed(current.get("children") or []))
        return {
            **self._serialize_page_summary(page, include_admin=include_admin),
            "status": page.status,
            "blocks": blocks,
            "sections": sections,
            "breadcrumbs": self._page_breadcrumbs(page, public_context=public_context),
            "rendering": {
                **page_rendering,
                "css_text": "\n".join(part for part in combined_css if part),
            },
        }

    def _serialize_page_revision(self, revision: PageRevision) -> dict[str, Any]:
        return {
            "id": revision.id,
            "page_id": revision.page_id,
            "revision_number": revision.revision_number,
            "action": revision.action,
            "summary": revision.summary,
            "created_on": _to_iso(revision.created_on),
            "created_by": self._serialize_user_ref(revision.created_by),
            "snapshot": revision.get_snapshot(),
        }

    def _serialize_user_layout(self, layout: UserPageLayout | None) -> dict[str, Any] | None:
        if layout is None:
            return None
        return {
            "id": layout.id,
            "page_id": layout.page_id,
            "user_id": layout.user_id,
            "layout": layout.get_layout(),
            "changed_on": layout.changed_on.isoformat() if layout.changed_on else None,
        }

    def _serialize_navigation_item(
        self,
        item: NavigationItem,
        pages: list[Page],
        dashboards: list[Dashboard],
        public_context: bool = True,
    ) -> dict[str, Any] | None:
        if public_context and not self._menu_is_publicly_visible(item.visibility):
            return None
        settings = item.get_settings()
        path = item.href
        children: list[dict[str, Any]] = []

        if item.page is not None:
            if public_context and item.page not in pages:
                return None
            path = f"/superset/public/{self._page_path(item.page)}/"
        elif item.dashboard is not None:
            if public_context and item.dashboard not in dashboards:
                return None
            path = (
                f"/superset/public/dashboards/?dashboard="
                f"{item.dashboard.slug or item.dashboard.id}"
            )

        if item.item_type == "page_collection":
            children = [
                {
                    "id": f"page-{page.id}",
                    "label": page.navigation_label or page.title,
                    "path": f"/superset/public/{self._page_path(page)}/",
                    "item_type": "page",
                    "page_id": page.id,
                    "description": page.subtitle or page.description,
                }
                for page in pages
                if not page.is_homepage
            ]
        elif item.item_type == "dashboard_collection":
            children = [
                {
                    "id": f"dashboard-{dash.id}",
                    "label": dash.dashboard_title,
                    "path": (
                        f"/superset/public/dashboards/?dashboard={dash.slug or dash.id}"
                    ),
                    "item_type": "dashboard",
                    "dashboard_id": dash.id,
                }
                for dash in dashboards
            ]
        else:
            children = [
                serialized_child
                for child in sorted(
                    item.children,
                    key=lambda nav_item: (nav_item.display_order, nav_item.id or 0),
                )
                if child.is_visible
                and (
                    serialized_child := self._serialize_navigation_item(
                        child,
                        pages,
                        dashboards,
                        public_context=public_context,
                    )
                )
            ]

        return {
            "id": item.id,
            "label": item.label,
            "item_type": item.item_type,
            "icon": item.icon,
            "description": item.description,
            "path": path,
            "page_id": item.page_id,
            "dashboard_id": item.dashboard_id,
            "display_order": item.display_order,
            "is_visible": item.is_visible,
            "open_in_new_tab": item.open_in_new_tab,
            "visibility": item.visibility,
            "settings": settings,
            "children": children,
        }

    def _serialize_navigation(
        self,
        menus: list[NavigationMenu],
        pages: list[Page],
        dashboards: list[Dashboard],
        public_context: bool = True,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"header": [], "footer": []}
        for menu in sorted(menus, key=lambda item: (item.display_order, item.id or 0)):
            if not menu.is_enabled:
                continue
            if public_context and not self._menu_is_publicly_visible(menu.visibility):
                continue
            serialized_menu = {
                "id": menu.id,
                "slug": menu.slug,
                "title": menu.title,
                "description": menu.description,
                "location": menu.location,
                "visibility": menu.visibility,
                "display_order": menu.display_order,
                "is_enabled": menu.is_enabled,
                "settings": menu.get_settings(),
                "items": [
                    serialized_item
                    for item in sorted(
                        menu.items,
                        key=lambda nav_item: (nav_item.display_order, nav_item.id or 0),
                    )
                    if item.parent_id is None and item.is_visible
                    and (
                        serialized_item := self._serialize_navigation_item(
                            item,
                            pages,
                            dashboards,
                            public_context=public_context,
                        )
                    )
                ],
            }
            payload.setdefault(menu.location, []).append(serialized_menu)
        return payload

    def _get_user_layout(self, page: Page | None) -> UserPageLayout | None:
        if page is None or not _is_authenticated_user():
            return None
        user_id = get_user_id()
        if not user_id:
            return None
        return (
            db.session.query(UserPageLayout)
            .filter(
                UserPageLayout.user_id == user_id,
                UserPageLayout.page_id == page.id,
            )
            .one_or_none()
        )

    def _validate_component_references(
        self,
        component_data: dict[str, Any],
        page_visibility: str = "public",
    ) -> None:
        chart_id = component_data.get("chart_id")
        if chart_id:
            chart = db.session.query(Slice).filter(Slice.id == chart_id).one_or_none()
            if chart is None:
                raise ValidationError({"chart_id": ["Chart not found"]})
            if page_visibility == "public" and not getattr(chart, "is_public", False):
                raise ValidationError({"chart_id": ["Chart must be marked public"]})
            if not self._chart_uses_serving_tables(chart):
                raise ValidationError(
                    {"chart_id": ["Chart must query from a serving-table dataset"]}
                )

        dashboard_id = component_data.get("dashboard_id")
        if dashboard_id:
            dash = (
                db.session.query(Dashboard)
                .filter(Dashboard.id == dashboard_id)
                .one_or_none()
            )
            if dash is None:
                raise ValidationError({"dashboard_id": ["Dashboard not found"]})
            if page_visibility == "public" and not getattr(dash, "published", False):
                raise ValidationError(
                    {"dashboard_id": ["Dashboard must be published for public use"]}
                )

    def _validate_block_references(
        self,
        block_data: dict[str, Any],
        page_visibility: str = "public",
    ) -> None:
        content = block_data.get("content") or {}
        settings = block_data.get("settings") or {}
        block_type = (block_data.get("block_type") or "").strip().lower()
        chart_id = self._block_chart_reference(settings)
        if chart_id:
            chart = db.session.query(Slice).filter(Slice.id == chart_id).one_or_none()
            if chart is None:
                raise ValidationError({"chart_ref": ["Chart not found"]})
            if page_visibility == "public" and not getattr(chart, "is_public", False):
                raise ValidationError({"chart_ref": ["Chart must be marked public"]})
            if not self._chart_uses_serving_tables(chart):
                raise ValidationError(
                    {"chart_ref": ["Chart must query from a serving-table dataset"]}
                )

        dashboard_id = self._block_dashboard_reference(settings)
        if dashboard_id:
            dash = (
                db.session.query(Dashboard)
                .filter(Dashboard.id == dashboard_id)
                .one_or_none()
            )
            if dash is None:
                raise ValidationError({"dashboard_ref": ["Dashboard not found"]})
            if page_visibility == "public" and not getattr(dash, "published", False):
                raise ValidationError(
                    {"dashboard_ref": ["Dashboard must be published for public use"]}
                )

        asset_id = self._block_asset_reference(block_type, content, settings)
        if asset_id:
            self._validate_asset_reference(
                asset_id,
                field_name="asset_ref",
                require_public=page_visibility == "public",
            )

        for child in block_data.get("children") or []:
            self._validate_block_references(child, page_visibility=page_visibility)

    def _coerce_page_blocks_payload(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        block_payload = payload.get("blocks") or []
        if block_payload:
            return block_payload
        return legacy_sections_to_blocks(payload.get("sections") or [])

    def _upsert_blocks(
        self,
        page: Page,
        payload_blocks: list[dict[str, Any]],
    ) -> None:
        existing_blocks = {block.id: block for block in page.blocks}
        seen_ids: set[int] = set()

        def walk(
            blocks: list[dict[str, Any]],
            *,
            parent: PageBlock | None,
            depth: int,
            prefix: str,
        ) -> None:
            for index, block_data in enumerate(blocks):
                block_id = block_data.get("id")
                block = existing_blocks.get(block_id)
                if block is None:
                    block = PageBlock(page=page, created_by_fk=get_user_id())
                    db.session.add(block)
                block.uid = block_data.get("uid") or generate_block_uid()
                block.parent = parent
                block.block_type = (block_data.get("block_type") or "rich_text").strip().lower()
                block.slot = block_data.get("slot") or (parent.slot if parent else "content")
                block.sort_order = int(block_data.get("sort_order") or index)
                block.depth = depth
                block.tree_path = f"{prefix}{index:04d}"
                block.is_container = bool(
                    block_data.get("is_container", is_container_block(block.block_type))
                )
                block.visibility = block_data.get("visibility") or "public"
                block.status = block_data.get("status") or "active"
                block.schema_version = int(block_data.get("schema_version") or 1)
                block.style_bundle = self._validate_style_bundle_reference(
                    block_data.get("style_bundle_id"),
                    field_name="style_bundle_id",
                )
                block.changed_by_fk = get_user_id()
                block.set_content(block_data.get("content") or {})
                block.set_settings(block_data.get("settings") or {})
                block.set_styles(block_data.get("styles") or {})
                block.set_metadata(block_data.get("metadata") or {})
                db.session.flush()
                if block.id is not None:
                    seen_ids.add(block.id)
                walk(
                    block_data.get("children") or [],
                    parent=block,
                    depth=depth + 1,
                    prefix=f"{block.tree_path}.",
                )

        walk(payload_blocks, parent=None, depth=0, prefix="")

        for block in list(page.blocks):
            if block.id not in seen_ids:
                db.session.delete(block)

    def _clear_legacy_sections(self, page: Page) -> None:
        for section in list(page.sections):
            db.session.delete(section)

    def _validate_theme_reference(self, theme_id: int | None) -> Theme | None:
        if not theme_id:
            return None
        theme = db.session.query(Theme).filter(Theme.id == theme_id).one_or_none()
        if theme is None:
            raise ValidationError({"theme_id": ["Theme not found"]})
        return theme

    def _validate_template_reference(self, template_id: int | None) -> Template | None:
        if not template_id:
            return None
        template = (
            db.session.query(Template).filter(Template.id == template_id).one_or_none()
        )
        if template is None:
            raise ValidationError({"template_id": ["Template not found"]})
        return template

    def _validate_parent_page_reference(
        self,
        parent_page_id: int | None,
        *,
        page: Page | None = None,
    ) -> Page | None:
        if not parent_page_id:
            return None
        parent_page = (
            db.session.query(Page).filter(Page.id == parent_page_id).one_or_none()
        )
        if parent_page is None:
            raise ValidationError({"parent_page_id": ["Parent page not found"]})
        if page is not None and parent_page.id == page.id:
            raise ValidationError({"parent_page_id": ["A page cannot be its own parent"]})
        current = parent_page
        seen_ids: set[int] = set()
        while current is not None:
            if current.id is not None and current.id in seen_ids:
                raise ValidationError({"parent_page_id": ["Page hierarchy cannot be cyclic"]})
            if current.id is not None:
                seen_ids.add(current.id)
            if page is not None and current.id == page.id:
                raise ValidationError({"parent_page_id": ["Page hierarchy cannot be cyclic"]})
            current = current.parent_page
        return parent_page

    def _validate_style_bundle_reference(
        self,
        style_bundle_id: int | None,
        field_name: str = "style_bundle_id",
    ) -> StyleBundle | None:
        if not style_bundle_id:
            return None
        bundle = (
            db.session.query(StyleBundle)
            .filter(StyleBundle.id == style_bundle_id)
            .one_or_none()
        )
        if bundle is None:
            raise ValidationError({field_name: ["Style bundle not found"]})
        return bundle

    def _safe_slug(self, value: str | None, fallback: str) -> str:
        return slugify(value or fallback, fallback)

    def _ensure_unique_slug(
        self,
        model: Any,
        requested_slug: str,
        exclude_id: int | None = None,
        field_name: str = "slug",
        entity_label: str = "record",
    ) -> str:
        slug = self._safe_slug(requested_slug, entity_label)
        query = db.session.query(model).filter(model.slug == slug)
        if exclude_id is not None:
            query = query.filter(model.id != exclude_id)
        if query.one_or_none() is not None:
            raise ValidationError(
                {field_name: [f"A {entity_label} with this slug already exists"]}
            )
        return slug

    def _generate_unique_slug(
        self,
        base_slug: str,
        exclude_page_id: int | None = None,
    ) -> str:
        candidate = slugify(base_slug, "page")
        suffix = 2
        while True:
            query = db.session.query(Page).filter(Page.slug == candidate)
            if exclude_page_id is not None:
                query = query.filter(Page.id != exclude_page_id)
            if query.one_or_none() is None:
                return candidate
            candidate = f"{slugify(base_slug, 'page')}-{suffix}"
            suffix += 1

    def _generate_unique_design_slug(
        self,
        model: Any,
        base_slug: str,
        *,
        exclude_id: int | None = None,
        fallback: str,
    ) -> str:
        candidate = self._safe_slug(base_slug, fallback)
        suffix = 2
        while True:
            query = db.session.query(model).filter(model.slug == candidate)
            if exclude_id is not None:
                query = query.filter(model.id != exclude_id)
            if query.one_or_none() is None:
                return candidate
            candidate = f"{self._safe_slug(base_slug, fallback)}-{suffix}"
            suffix += 1

    def _mark_theme_default(self, theme: Theme) -> None:
        (
            db.session.query(Theme)
            .filter(Theme.id != theme.id, Theme.is_default == True)
            .update({"is_default": False}, synchronize_session=False)
        )
        theme.is_default = True
        theme.is_active = True
        theme.status = "active"

    def _mark_template_default(self, template: Template) -> None:
        (
            db.session.query(Template)
            .filter(Template.id != template.id, Template.is_default == True)
            .update({"is_default": False}, synchronize_session=False)
        )
        template.is_default = True
        template.is_active = True
        template.status = "active"

    def _ensure_default_theme_exists(self) -> Theme | None:
        default_theme = self._default_theme(admin=True)
        if default_theme is not None and default_theme.is_default:
            return default_theme
        replacement = (
            db.session.query(Theme)
            .filter(Theme.status != "archived")
            .order_by(Theme.is_active.desc(), Theme.id.asc())
            .first()
        )
        if replacement is not None:
            self._mark_theme_default(replacement)
        return replacement

    def _ensure_default_template_exists(self) -> Template | None:
        default_template = self._default_template(admin=True)
        if default_template is not None and default_template.is_default:
            return default_template
        replacement = (
            db.session.query(Template)
            .filter(Template.status != "archived")
            .order_by(Template.is_active.desc(), Template.id.asc())
            .first()
        )
        if replacement is not None:
            self._mark_template_default(replacement)
        return replacement

    def _upsert_style_bundle(self, payload: dict[str, Any]) -> StyleBundle:
        bundle_id = payload.get("id")
        bundle = None
        if bundle_id:
            bundle = (
                db.session.query(StyleBundle)
                .filter(StyleBundle.id == bundle_id)
                .one_or_none()
            )
        slug = self._ensure_unique_slug(
            StyleBundle,
            payload.get("slug") or payload.get("title"),
            exclude_id=bundle.id if bundle else None,
            entity_label="style bundle",
        )
        if bundle is None:
            bundle = StyleBundle(created_by_fk=get_user_id())
            db.session.add(bundle)

        status = payload.get("status") or "active"
        is_active = bool(payload.get("is_active", status == "active"))
        if status == "archived":
            is_active = False

        bundle.slug = slug
        bundle.title = payload["title"]
        bundle.description = payload.get("description")
        bundle.status = status
        bundle.is_active = is_active
        bundle.changed_by_fk = get_user_id()
        bundle.set_variables(payload.get("variables") or {})
        bundle.set_settings(payload.get("settings") or {})
        bundle.css_text = validate_custom_css(payload.get("css_text"))

        if status == "archived":
            bundle.archived_on = bundle.archived_on or _now()
            bundle.archived_by_fk = get_user_id()
        else:
            bundle.archived_on = None
            bundle.archived_by_fk = None

        db.session.flush()
        return bundle

    def _upsert_theme(self, payload: dict[str, Any]) -> Theme:
        theme_id = payload.get("id")
        theme = None
        if theme_id:
            theme = db.session.query(Theme).filter(Theme.id == theme_id).one_or_none()
        slug = self._ensure_unique_slug(
            Theme,
            payload.get("slug") or payload.get("title"),
            exclude_id=theme.id if theme else None,
            entity_label="theme",
        )
        style_bundle = self._validate_style_bundle_reference(payload.get("style_bundle_id"))
        if theme is None:
            theme = Theme(created_by_fk=get_user_id())
            db.session.add(theme)

        status = payload.get("status") or "active"
        is_active = bool(payload.get("is_active", status == "active"))
        is_default = bool(payload.get("is_default", False))
        if status == "archived":
            is_active = False
            is_default = False
        if is_default:
            is_active = True
            status = "active"

        theme.slug = slug
        theme.title = payload["title"]
        theme.description = payload.get("description")
        theme.status = status
        theme.is_active = is_active
        theme.is_default = is_default
        theme.preview_image_url = payload.get("preview_image_url")
        theme.style_bundle = style_bundle
        theme.changed_by_fk = get_user_id()
        theme.set_tokens(payload.get("tokens") or {})
        theme.set_settings(payload.get("settings") or {})

        if status == "archived":
            theme.archived_on = theme.archived_on or _now()
            theme.archived_by_fk = get_user_id()
        else:
            theme.archived_on = None
            theme.archived_by_fk = None

        db.session.flush()
        if theme.is_default:
            self._mark_theme_default(theme)
        else:
            self._ensure_default_theme_exists()
        return theme

    def _upsert_template(self, payload: dict[str, Any]) -> Template:
        template_id = payload.get("id")
        template = None
        if template_id:
            template = (
                db.session.query(Template).filter(Template.id == template_id).one_or_none()
            )
        slug = self._ensure_unique_slug(
            Template,
            payload.get("slug") or payload.get("title"),
            exclude_id=template.id if template else None,
            entity_label="template",
        )
        theme = self._validate_theme_reference(payload.get("theme_id"))
        style_bundle = self._validate_style_bundle_reference(payload.get("style_bundle_id"))
        if template is None:
            template = Template(created_by_fk=get_user_id())
            db.session.add(template)

        status = payload.get("status") or "active"
        is_active = bool(payload.get("is_active", status == "active"))
        is_default = bool(payload.get("is_default", False))
        if status == "archived":
            is_active = False
            is_default = False
        if is_default:
            is_active = True
            status = "active"

        template.slug = slug
        template.title = payload["title"]
        template.description = payload.get("description")
        template.status = status
        template.is_active = is_active
        template.is_default = is_default
        template.theme = theme
        template.style_bundle = style_bundle
        template.changed_by_fk = get_user_id()
        template.set_structure(payload.get("structure") or {})
        template.set_settings(payload.get("settings") or {})

        if status == "archived":
            template.archived_on = template.archived_on or _now()
            template.archived_by_fk = get_user_id()
        else:
            template.archived_on = None
            template.archived_by_fk = None

        db.session.flush()
        if template.is_default:
            self._mark_template_default(template)
        else:
            self._ensure_default_template_exists()
        return template

    def _clone_style_bundle(self, bundle: StyleBundle) -> StyleBundle:
        cloned = StyleBundle(
            slug=self._generate_unique_design_slug(
                StyleBundle,
                f"{bundle.slug}-copy",
                fallback="style-bundle",
            ),
            title=f"{bundle.title} Copy",
            description=bundle.description,
            status="draft",
            is_active=False,
            created_by_fk=get_user_id(),
            changed_by_fk=get_user_id(),
        )
        cloned.set_variables(bundle.get_variables())
        cloned.set_settings(bundle.get_settings())
        cloned.css_text = bundle.css_text
        db.session.add(cloned)
        db.session.flush()
        return cloned

    def _clone_theme(self, theme: Theme) -> Theme:
        cloned = Theme(
            slug=self._generate_unique_design_slug(
                Theme,
                f"{theme.slug}-copy",
                fallback="theme",
            ),
            title=f"{theme.title} Copy",
            description=theme.description,
            status="draft",
            is_active=False,
            is_default=False,
            preview_image_url=theme.preview_image_url,
            style_bundle=theme.style_bundle,
            created_by_fk=get_user_id(),
            changed_by_fk=get_user_id(),
        )
        cloned.set_tokens(theme.get_tokens())
        cloned.set_settings(theme.get_settings())
        db.session.add(cloned)
        db.session.flush()
        return cloned

    def _clone_template(self, template: Template) -> Template:
        cloned = Template(
            slug=self._generate_unique_design_slug(
                Template,
                f"{template.slug}-copy",
                fallback="template",
            ),
            title=f"{template.title} Copy",
            description=template.description,
            status="draft",
            is_active=False,
            is_default=False,
            theme=template.theme,
            style_bundle=template.style_bundle,
            created_by_fk=get_user_id(),
            changed_by_fk=get_user_id(),
        )
        cloned.set_structure(template.get_structure())
        cloned.set_settings(template.get_settings())
        db.session.add(cloned)
        db.session.flush()
        return cloned

    def _snapshot_page_revision(
        self,
        page: Page,
        action: str,
        summary: str | None = None,
    ) -> PageRevision:
        next_revision = (
            db.session.query(func.max(PageRevision.revision_number))
            .filter(PageRevision.page_id == page.id)
            .scalar()
            or 0
        ) + 1
        revision = PageRevision(
            page=page,
            revision_number=next_revision,
            action=action,
            summary=summary,
            created_by_fk=get_user_id(),
        )
        revision.set_snapshot(
            self._serialize_page(page, include_admin=True, public_context=False)
        )
        db.session.add(revision)
        db.session.flush()
        return revision

    def _upsert_page(self, payload: dict[str, Any]) -> Page:
        page_id = payload.get("id")
        requested_slug = slugify(payload.get("slug") or payload.get("title"), "page")

        page = None
        if page_id:
            page = db.session.query(Page).filter(Page.id == page_id).one_or_none()
        existing_slug = (
            db.session.query(Page)
            .filter(Page.slug == requested_slug)
            .one_or_none()
        )
        if existing_slug is not None and (page is None or existing_slug.id != page.id):
            raise ValidationError({"slug": ["A page with this slug already exists"]})
        if page is None:
            page = Page(slug=requested_slug, created_by_fk=get_user_id())
            db.session.add(page)

        now = _now()
        previous_was_public = self._page_is_publicly_viewable(page)
        page_visibility = payload.get("visibility") or "public"
        theme = self._validate_theme_reference(payload.get("theme_id"))
        template = self._validate_template_reference(payload.get("template_id"))
        page_style_bundle = self._validate_style_bundle_reference(
            payload.get("style_bundle_id")
        )
        parent_page = self._validate_parent_page_reference(
            payload.get("parent_page_id"),
            page=page,
        )
        if parent_page is not None and page_visibility == "public":
            if not self._page_is_publicly_viewable(parent_page):
                raise ValidationError(
                    {
                        "parent_page_id": [
                            "Public pages must use a published public parent page"
                        ]
                    }
                )
        featured_image_asset = self._validate_asset_reference(
            payload.get("featured_image_asset_id"),
            field_name="featured_image_asset_id",
            require_public=page_visibility == "public",
        )
        og_image_asset = self._validate_asset_reference(
            payload.get("og_image_asset_id"),
            field_name="og_image_asset_id",
            require_public=page_visibility == "public",
        )
        page.slug = requested_slug
        page.title = payload["title"]
        page.subtitle = payload.get("subtitle")
        page.description = payload.get("description")
        page.excerpt = payload.get("excerpt")
        page.seo_title = payload.get("seo_title")
        page.seo_description = payload.get("seo_description")
        page.og_image_asset = og_image_asset
        page.featured_image_asset = featured_image_asset
        page.og_image_url = (
            self._serialize_media_asset(og_image_asset, include_admin=True)["download_url"]
            if og_image_asset is not None
            else payload.get("og_image_url")
        )
        page.featured_image_url = (
            self._serialize_media_asset(
                featured_image_asset,
                include_admin=True,
            )["download_url"]
            if featured_image_asset is not None
            else payload.get("featured_image_url")
        )
        page.visibility = page_visibility
        page.page_type = payload.get("page_type") or "content"
        page.parent_page = parent_page
        page.navigation_label = payload.get("navigation_label") or None
        page.theme = theme
        page.template = template
        page.style_bundle = page_style_bundle
        page.template_key = (
            template.slug
            if template is not None
            else payload.get("template_key")
            or "default"
        )
        page.scheduled_publish_at = _parse_datetime(payload.get("scheduled_publish_at"))
        page.is_published = bool(payload.get("is_published", True))
        page.is_homepage = bool(payload.get("is_homepage", False))
        page.display_order = int(payload.get("display_order") or 0)
        page.changed_by_fk = get_user_id()
        page.set_settings(payload.get("settings") or {})

        if page.visibility == "draft":
            page.is_published = False
            page.status = "draft"
        elif page.visibility == "authenticated":
            page.status = "private" if page.is_published else "draft"
        elif page.status == "archived":
            page.is_published = False
        elif page.is_published:
            if page.scheduled_publish_at and page.scheduled_publish_at > now:
                page.status = "scheduled"
            else:
                page.status = "published"
        else:
            page.status = "draft"

        if page.status == "archived":
            page.archived_on = page.archived_on or now
            page.archived_by_fk = get_user_id()
            page.is_published = False
            page.is_homepage = False
        else:
            page.archived_on = None
            page.archived_by_fk = None

        if page.visibility == "public" and page.is_published:
            if not previous_was_public and (
                page.status == "published"
                or (
                    page.status == "scheduled"
                    and page.scheduled_publish_at
                    and page.scheduled_publish_at <= now
                )
            ):
                page.published_on = now
                page.published_by_fk = get_user_id()
        elif page.status != "scheduled":
            page.published_on = page.published_on if previous_was_public else None
            if not previous_was_public:
                page.published_by_fk = page.published_by_fk

        if page.is_homepage and self._page_is_publicly_viewable(page):
            (
                db.session.query(Page)
                .filter(Page.id != page.id, Page.is_homepage == True)
                .update({"is_homepage": False}, synchronize_session=False)
            )
        elif page.is_homepage:
            page.is_homepage = False

        payload_blocks = self._coerce_page_blocks_payload(payload)
        for block_data in payload_blocks:
            self._validate_block_references(
                block_data,
                page_visibility=page.visibility,
            )
        self._upsert_blocks(page, payload_blocks)
        self._clear_legacy_sections(page)

        db.session.flush()
        self._snapshot_page_revision(
            page,
            action="saved",
            summary=f"Saved page {page.title}",
        )
        return page

    def _clone_page(self, page: Page) -> Page:
        cloned_page = Page(
            slug=self._generate_unique_slug(f"{page.slug}-copy"),
            title=f"{page.title} Copy",
            subtitle=page.subtitle,
            description=page.description,
            excerpt=page.excerpt,
            seo_title=page.seo_title,
            seo_description=page.seo_description,
            og_image_url=page.og_image_url,
            featured_image_url=page.featured_image_url,
            parent_page=page.parent_page,
            navigation_label=page.navigation_label,
            visibility="draft",
            page_type=page.page_type,
            template_key=page.template_key,
            theme=page.theme,
            template=page.template,
            style_bundle=page.style_bundle,
            featured_image_asset=page.featured_image_asset,
            og_image_asset=page.og_image_asset,
            status="draft",
            is_published=False,
            is_homepage=False,
            display_order=page.display_order + 1,
            created_by_fk=get_user_id(),
            changed_by_fk=get_user_id(),
        )
        cloned_page.set_settings(page.get_settings())
        db.session.add(cloned_page)
        db.session.flush()

        if page.blocks:
            block_map: dict[int, PageBlock] = {}
            for block in sorted(page.blocks, key=lambda item: (item.tree_path, item.id or 0)):
                cloned_block = PageBlock(
                    page=cloned_page,
                    uid=generate_block_uid(),
                    block_type=block.block_type,
                    slot=block.slot,
                    sort_order=block.sort_order,
                    tree_path=block.tree_path,
                    depth=block.depth,
                    is_container=block.is_container,
                    visibility=block.visibility,
                    status=block.status,
                    schema_version=block.schema_version,
                    style_bundle=block.style_bundle,
                    created_by_fk=get_user_id(),
                    changed_by_fk=get_user_id(),
                )
                cloned_block.set_content(block.get_content())
                cloned_block.set_settings(block.get_settings())
                cloned_block.set_styles(block.get_styles())
                cloned_block.set_metadata(block.get_metadata())
                if block.parent_block_id:
                    cloned_block.parent = block_map[block.parent_block_id]
                db.session.add(cloned_block)
                db.session.flush()
                if block.id is not None:
                    block_map[block.id] = cloned_block
        else:
            for section in sorted(page.sections, key=lambda item: (item.display_order, item.id or 0)):
                cloned_section = PageSection(
                    page=cloned_page,
                    section_key=slugify(section.section_key, "section"),
                    title=section.title,
                    subtitle=section.subtitle,
                    section_type=section.section_type,
                    style_bundle=section.style_bundle,
                    display_order=section.display_order,
                    is_visible=section.is_visible,
                )
                cloned_section.set_settings(section.get_settings())
                db.session.add(cloned_section)
                db.session.flush()

                for component in sorted(
                    section.components,
                    key=lambda item: (item.display_order, item.id or 0),
                ):
                    cloned_component = PageComponent(
                        section=cloned_section,
                        component_key=slugify(component.component_key, "component"),
                        component_type=component.component_type,
                        title=component.title,
                        body=component.body,
                        chart_id=component.chart_id,
                        dashboard_id=component.dashboard_id,
                        style_bundle=component.style_bundle,
                        display_order=component.display_order,
                        is_visible=component.is_visible,
                    )
                    cloned_component.set_settings(component.get_settings())
                    db.session.add(cloned_component)

        db.session.flush()
        self._snapshot_page_revision(
            cloned_page,
            action="duplicated",
            summary=f"Duplicated from {page.title}",
        )
        return cloned_page

    def _upsert_menu_items(
        self,
        menu: NavigationMenu,
        items_data: list[dict[str, Any]],
        existing_items: dict[int, NavigationItem],
        seen_items: set[int],
        parent: NavigationItem | None = None,
    ) -> None:
        for item_index, item_data in enumerate(items_data):
            item = existing_items.get(item_data.get("id"))
            if item is None:
                item = NavigationItem(menu=menu, parent=parent)
                db.session.add(item)

            page_id = item_data.get("page_id")
            dashboard_id = item_data.get("dashboard_id")
            if page_id and db.session.query(Page).filter(Page.id == page_id).one_or_none() is None:
                raise ValidationError({"page_id": ["Linked page not found"]})
            if dashboard_id and (
                db.session.query(Dashboard).filter(Dashboard.id == dashboard_id).one_or_none()
                is None
            ):
                raise ValidationError({"dashboard_id": ["Linked dashboard not found"]})

            item.menu = menu
            item.parent = parent
            item.label = item_data["label"]
            item.item_type = item_data["item_type"]
            item.href = item_data.get("href")
            item.icon = item_data.get("icon")
            item.description = item_data.get("description")
            item.visibility = item_data.get("visibility") or "public"
            item.page_id = page_id
            item.dashboard_id = dashboard_id
            item.display_order = int(item_data.get("display_order") or item_index)
            item.is_visible = bool(item_data.get("is_visible", True))
            item.open_in_new_tab = bool(item_data.get("open_in_new_tab", False))
            item.set_settings(item_data.get("settings") or {})
            db.session.flush()
            seen_items.add(item.id)

            self._upsert_menu_items(
                menu,
                item_data.get("children") or [],
                existing_items,
                seen_items,
                parent=item,
            )

    def _upsert_menus(self, payload: list[dict[str, Any]]) -> list[NavigationMenu]:
        existing_menus = {
            menu.id: menu
            for menu in db.session.query(NavigationMenu).order_by(NavigationMenu.id.asc()).all()
        }
        seen_menu_ids: set[int] = set()

        for menu_index, menu_data in enumerate(payload):
            menu = existing_menus.get(menu_data.get("id"))
            requested_slug = slugify(menu_data.get("slug") or menu_data.get("title"), "menu")
            existing_slug = (
                db.session.query(NavigationMenu)
                .filter(NavigationMenu.slug == requested_slug)
                .one_or_none()
            )
            if existing_slug is not None and (menu is None or existing_slug.id != menu.id):
                raise ValidationError({"slug": ["A menu with this slug already exists"]})

            if menu is None:
                menu = NavigationMenu(slug=requested_slug, title=menu_data["title"])
                db.session.add(menu)
                db.session.flush()

            menu.slug = requested_slug
            menu.title = menu_data["title"]
            menu.description = menu_data.get("description")
            menu.location = menu_data.get("location") or "header"
            menu.visibility = menu_data.get("visibility") or "public"
            menu.display_order = int(menu_data.get("display_order") or menu_index)
            menu.is_enabled = bool(menu_data.get("is_enabled", True))
            menu.set_settings(menu_data.get("settings") or {})
            seen_menu_ids.add(menu.id)

            existing_items = {item.id: item for item in menu.items}
            seen_item_ids: set[int] = set()
            self._upsert_menu_items(
                menu,
                menu_data.get("items") or [],
                existing_items,
                seen_item_ids,
            )
            for existing_item in list(menu.items):
                if existing_item.id not in seen_item_ids:
                    db.session.delete(existing_item)

        for menu in db.session.query(NavigationMenu).all():
            if menu.id not in seen_menu_ids:
                db.session.delete(menu)

        db.session.flush()
        return (
            db.session.query(NavigationMenu)
            .order_by(NavigationMenu.display_order.asc(), NavigationMenu.id.asc())
            .all()
        )

    def _cms_permissions_payload(self) -> dict[str, bool]:
        return {
            "can_view_pages": _can_manage_pages(),
            "can_create_pages": _can_create_pages(),
            "can_edit_pages": _can_edit_pages(),
            "can_delete_pages": _can_delete_pages(),
            "can_publish_pages": _can_publish_pages(),
            "can_manage_media": _can_manage_media(),
            "can_manage_menus": _can_manage_menus(),
            "can_embed_charts": _can_embed_charts(),
            "can_manage_layout": _can_manage_layout(),
            "can_manage_themes": _can_manage_themes(),
            "can_manage_templates": _can_manage_templates(),
            "can_manage_styles": _can_manage_styles(),
        }

    def _build_admin_stats(
        self,
        pages: list[Page],
        menus: list[NavigationMenu],
        themes: list[Theme],
        templates: list[Template],
        style_bundles: list[StyleBundle],
        media_assets: list[MediaAsset],
    ) -> dict[str, int]:
        return {
            "total_pages": len(pages),
            "published_pages": len(
                [page for page in pages if self._page_is_publicly_viewable(page)]
            ),
            "draft_pages": len([page for page in pages if page.status == "draft"]),
            "private_pages": len(
                [
                    page
                    for page in pages
                    if page.visibility == "authenticated" and page.status != "archived"
                ]
            ),
            "menus": len(menus),
            "chart_enabled_pages": len(
                [
                    page
                    for page in pages
                    if any(block.block_type == "chart" for block in page.blocks)
                    or any(
                        component.component_type == "chart"
                        for section in page.sections
                        for component in section.components
                    )
                ]
            ),
            "themes": len(themes),
            "templates": len(templates),
            "style_bundles": len(style_bundles),
            "media_assets": len(media_assets),
        }

    def _get_admin_payload(
        self,
        page_slug: str | None = None,
        page_id: int | None = None,
    ) -> dict[str, Any]:
        self._seed_default_portal()
        layout_config = self._get_or_create_layout_config()
        pages = self._list_pages(admin=True)
        current_page = self._find_page(page_slug=page_slug, page_id=page_id, admin=True)
        menus = (
            db.session.query(NavigationMenu)
            .order_by(NavigationMenu.display_order.asc(), NavigationMenu.id.asc())
            .all()
        )
        themes = self._list_themes(admin=True)
        templates = self._list_templates(admin=True)
        style_bundles = self._list_style_bundles(admin=True)
        media_assets = self._list_media_assets(admin=True)
        dashboards = self._list_public_dashboards()
        charts = self._list_serving_charts(public_only=False)
        recent_revisions = (
            db.session.query(PageRevision)
            .order_by(PageRevision.created_on.desc(), PageRevision.id.desc())
            .limit(8)
            .all()
        )
        recently_published_pages = (
            db.session.query(Page)
            .filter(Page.published_on.isnot(None))
            .order_by(Page.published_on.desc(), Page.id.desc())
            .limit(8)
            .all()
        )

        return {
            "config": _merge_dicts(
                DEFAULT_PUBLIC_PAGE_CONFIG,
                current_app.config.get(
                    "PUBLIC_PAGE_CONFIG",
                    DEFAULT_PUBLIC_PAGE_CONFIG,
                ),
            ),
            "portal_layout": {
                "id": layout_config.id,
                "scope": layout_config.scope,
                "title": layout_config.title,
                "config": _merge_dicts(
                    DEFAULT_PORTAL_LAYOUT_CONFIG,
                    layout_config.get_config(),
                ),
            },
            "stats": self._build_admin_stats(
                pages,
                menus,
                themes,
                templates,
                style_bundles,
                media_assets,
            ),
            "pages": [
                self._serialize_page_summary(page, include_admin=True) for page in pages
            ],
            "current_page": (
                self._serialize_page(current_page, include_admin=True, public_context=False)
                if current_page
                else None
            ),
            "menus": self._serialize_navigation(
                menus,
                pages,
                dashboards,
                public_context=False,
            ),
            "dashboards": [self._serialize_dashboard(dash) for dash in dashboards],
            "available_charts": [self._serialize_chart(chart) for chart in charts],
            "media_assets": [
                self._serialize_media_asset(asset, include_admin=True)
                for asset in media_assets
            ],
            "block_types": list_block_definitions(),
            "themes": [
                self._serialize_theme(theme, include_admin=True) for theme in themes
            ],
            "templates": [
                self._serialize_template(template, include_admin=True)
                for template in templates
            ],
            "style_bundles": [
                self._serialize_style_bundle(bundle, include_admin=True)
                for bundle in style_bundles
            ],
            "permissions": self._cms_permissions_payload(),
            "recent_edits": [
                self._serialize_page_revision(revision) for revision in recent_revisions
            ],
            "recently_published_pages": [
                self._serialize_page_summary(page, include_admin=True)
                for page in recently_published_pages
            ],
            "revisions": (
                [
                    self._serialize_page_revision(revision)
                    for revision in (current_page.revisions[:12] if current_page else [])
                ]
            ),
        }

    def _seed_default_portal(self) -> None:
        self._get_or_create_layout_config()

        default_style_bundle = (
            db.session.query(StyleBundle)
            .filter(StyleBundle.slug == "portal-foundation")
            .one_or_none()
        )
        if default_style_bundle is None:
            default_style_bundle = StyleBundle(
                slug="portal-foundation",
                title="Portal Foundation",
                description="Baseline reusable portal surface styling.",
                status="active",
                is_active=True,
            )
            default_style_bundle.set_variables(
                {
                    "borderRadius": "0",
                    "boxShadow": "none",
                }
            )
            default_style_bundle.set_settings({"scope": "global"})
            default_style_bundle.css_text = (
                ".cms-page-region { padding-block: 8px; }\n"
                ".cms-page-region .cms-section-shell { position: relative; }\n"
                ".cms-rich-text p:last-child { margin-bottom: 0; }"
            )
            db.session.add(default_style_bundle)
            db.session.flush()

        default_theme = (
            db.session.query(Theme).filter(Theme.slug == "default-theme").one_or_none()
        )
        if default_theme is None:
            default_theme = Theme(
                slug="default-theme",
                title="Default Portal Theme",
                description="Default enterprise portal design tokens.",
                status="active",
                is_active=True,
                is_default=True,
                style_bundle=default_style_bundle,
            )
            default_theme.set_tokens(default_theme_tokens())
            default_theme.set_settings({"previewMode": "live"})
            db.session.add(default_theme)
            db.session.flush()
        elif not default_theme.is_default:
            self._mark_theme_default(default_theme)

        default_template = (
            db.session.query(Template)
            .filter(Template.slug == "default-template")
            .one_or_none()
        )
        if default_template is None:
            default_template = Template(
                slug="default-template",
                title="Default Portal Template",
                description="General-purpose portal template with optional sidebar.",
                status="active",
                is_active=True,
                is_default=True,
                theme=default_theme,
                style_bundle=default_style_bundle,
            )
            default_template.set_structure(default_template_structure())
            default_template.set_settings({"previewMode": "sample"})
            db.session.add(default_template)
            db.session.flush()
        elif not default_template.is_default:
            self._mark_template_default(default_template)

        header_menu = (
            db.session.query(NavigationMenu)
            .filter(NavigationMenu.slug == "public-header")
            .one_or_none()
        )
        if header_menu is None:
            header_menu = NavigationMenu(
                slug="public-header",
                title="Primary Navigation",
                location="header",
                display_order=0,
                is_enabled=True,
            )
            header_menu.set_settings({"variant": "topbar"})
            db.session.add(header_menu)
            db.session.flush()

        footer_menu = (
            db.session.query(NavigationMenu)
            .filter(NavigationMenu.slug == "public-footer")
            .one_or_none()
        )
        if footer_menu is None:
            footer_menu = NavigationMenu(
                slug="public-footer",
                title="Footer Navigation",
                location="footer",
                display_order=0,
                is_enabled=True,
            )
            db.session.add(footer_menu)
            db.session.flush()

        pages = db.session.query(Page).order_by(Page.display_order.asc()).all()
        page_by_slug = {page.slug: page for page in pages}

        if "welcome" not in page_by_slug:
            welcome_page = Page(
                slug="welcome",
                title="Welcome",
                subtitle="Evidence-led public malaria analytics",
                description=(
                    "A public analytics portal for Uganda malaria surveillance, "
                    "programme reporting, and serving-table chart access."
                ),
                status="published",
                is_published=True,
                is_homepage=True,
                display_order=0,
            )
            welcome_page.set_settings(
                {
                    "heroCtaLabel": "Browse dashboards",
                    "heroCtaTarget": "/superset/public/dashboards/",
                }
            )
            db.session.add(welcome_page)
            db.session.flush()

            hero_section = PageSection(
                page=welcome_page,
                section_key="hero",
                title="Towards malaria elimination in Uganda",
                subtitle=(
                    "Serving-table powered public analytics for surveillance, "
                    "programme performance, and transparent reporting."
                ),
                section_type="hero",
                display_order=0,
                is_visible=True,
            )
            hero_section.set_settings({"columns": 1})
            db.session.add(hero_section)
            db.session.flush()
            db.session.add(
                PageComponent(
                    section=hero_section,
                    component_key="welcome-intro",
                    component_type="markdown",
                    title="Portal Overview",
                    body=(
                        "Explore curated pages, public dashboards, and featured charts "
                        "rendered from local serving tables without navigating the full "
                        "authoring interface."
                    ),
                    display_order=0,
                    is_visible=True,
                )
            )

            kpi_section = PageSection(
                page=welcome_page,
                section_key="highlights",
                title="Latest Indicator Highlights",
                subtitle="Derived from the most recent staged DHIS2 observations.",
                section_type="kpi_band",
                display_order=1,
                is_visible=True,
            )
            db.session.add(kpi_section)
            db.session.flush()
            kpi_component = PageComponent(
                section=kpi_section,
                component_key="indicator-highlights",
                component_type="indicator_highlights",
                title="Indicator Highlights",
                body=None,
                display_order=0,
                is_visible=True,
            )
            kpi_component.set_settings({"limit": 6})
            db.session.add(kpi_component)

            public_charts = self._list_public_serving_charts()[:4]
            if public_charts:
                chart_section = PageSection(
                    page=welcome_page,
                    section_key="featured-charts",
                    title="Featured Analytics",
                    subtitle="Public charts backed by serving datasets.",
                    section_type="chart_grid",
                    display_order=2,
                    is_visible=True,
                )
                chart_section.set_settings({"columns": 2})
                db.session.add(chart_section)
                db.session.flush()
                for index, chart in enumerate(public_charts):
                    chart_component = PageComponent(
                        section=chart_section,
                        component_key=f"chart-{chart.id}",
                        component_type="chart",
                        title=chart.slice_name,
                        body=chart.description or None,
                        chart_id=chart.id,
                        display_order=index,
                        is_visible=True,
                    )
                    chart_component.set_settings({"height": 360})
                    db.session.add(chart_component)

        if "dashboards" not in page_by_slug:
            dashboards_page = Page(
                slug="dashboards",
                title="Dashboards",
                subtitle="Browse published public dashboards",
                description="A directory of public dashboards available in this workspace.",
                status="published",
                is_published=True,
                is_homepage=False,
                display_order=1,
            )
            db.session.add(dashboards_page)
            db.session.flush()
            section = PageSection(
                page=dashboards_page,
                section_key="dashboard-directory",
                title="Public Dashboards",
                subtitle="Published dashboards exposed for public viewing.",
                section_type="dashboard_catalog",
                display_order=0,
                is_visible=True,
            )
            db.session.add(section)
            db.session.flush()
            component = PageComponent(
                section=section,
                component_key="dashboard-list",
                component_type="dashboard_list",
                title="Dashboard Directory",
                display_order=0,
                is_visible=True,
            )
            component.set_settings({"variant": "cards"})
            db.session.add(component)

        if "about" not in page_by_slug:
            about_page = Page(
                slug="about",
                title="About",
                subtitle="Programme context and data infrastructure",
                description="Background and data sources for the public analytics portal.",
                status="published",
                is_published=True,
                is_homepage=False,
                display_order=2,
            )
            db.session.add(about_page)
            db.session.flush()
            about_section = PageSection(
                page=about_page,
                section_key="programme-overview",
                title="National Malaria Programme",
                subtitle="Public information for the analytics portal.",
                section_type="content",
                display_order=0,
                is_visible=True,
            )
            db.session.add(about_section)
            db.session.flush()
            db.session.add(
                PageComponent(
                    section=about_section,
                    component_key="programme-markdown",
                    component_type="markdown",
                    title="Programme Overview",
                    body=(
                        "This portal surfaces public malaria analytics using Superset "
                        "pages, serving-table chart embeds, and backend-managed "
                        "navigation. Layout preferences can be personalized per user "
                        "without changing the shared published page."
                    ),
                    display_order=0,
                    is_visible=True,
                )
            )

        for page in db.session.query(Page).all():
            if page.theme is None:
                page.theme = default_theme
            if page.template is None:
                page.template = default_template
            if not page.template_key:
                page.template_key = default_template.slug
            if not page.blocks and page.sections:
                self._upsert_blocks(page, self._legacy_blocks_for_page(page))
                self._clear_legacy_sections(page)

        if not header_menu.items:
            welcome_page = (
                db.session.query(Page).filter(Page.slug == "welcome").one_or_none()
            )
            dashboards_page = (
                db.session.query(Page).filter(Page.slug == "dashboards").one_or_none()
            )
            db.session.add_all(
                [
                    NavigationItem(
                        menu=header_menu,
                        label="Welcome",
                        item_type="page",
                        page=welcome_page,
                        display_order=0,
                        is_visible=True,
                    ),
                    NavigationItem(
                        menu=header_menu,
                        label="Dashboards",
                        item_type="page",
                        page=dashboards_page,
                        display_order=1,
                        is_visible=True,
                    ),
                    NavigationItem(
                        menu=header_menu,
                        label="Pages",
                        item_type="page_collection",
                        display_order=2,
                        is_visible=True,
                    ),
                ]
            )

        if not footer_menu.items:
            db.session.add_all(
                [
                    NavigationItem(
                        menu=footer_menu,
                        label="Data Sources",
                        item_type="external",
                        href="/superset/public/about/",
                        display_order=0,
                        is_visible=True,
                    ),
                    NavigationItem(
                        menu=footer_menu,
                        label="Sign In",
                        item_type="external",
                        href="/login/",
                        display_order=1,
                        is_visible=True,
                    ),
                ]
            )

        db.session.commit()

    def _get_portal_payload(self, page_slug: str | None = None) -> dict[str, Any]:
        self._seed_default_portal()
        config = _merge_dicts(
            DEFAULT_PUBLIC_PAGE_CONFIG,
            current_app.config.get("PUBLIC_PAGE_CONFIG", DEFAULT_PUBLIC_PAGE_CONFIG),
        )
        layout_config = self._get_or_create_layout_config()
        pages = self._list_pages(admin=False)
        dashboards = self._list_public_dashboards()
        current_page = self._find_page(page_slug=page_slug, admin=False)
        menus = (
            db.session.query(NavigationMenu)
            .order_by(NavigationMenu.display_order.asc(), NavigationMenu.id.asc())
            .all()
        )
        user_layout = self._get_user_layout(current_page)
        available_charts = [
            self._serialize_chart(chart) for chart in self._list_public_serving_charts()
        ]

        return {
            "config": config,
            "portal_layout": {
                "id": layout_config.id,
                "scope": layout_config.scope,
                "title": layout_config.title,
                "config": _merge_dicts(
                    DEFAULT_PORTAL_LAYOUT_CONFIG,
                    layout_config.get_config(),
                ),
            },
            "navigation": self._serialize_navigation(menus, pages, dashboards),
            "pages": [self._serialize_page_summary(page) for page in pages],
            "current_page": (
                self._serialize_page(
                    current_page,
                    include_admin=False,
                    public_context=True,
                )
                if current_page
                else None
            ),
            "user_layout": self._serialize_user_layout(user_layout),
            "dashboards": [self._serialize_dashboard(dash) for dash in dashboards],
            "available_charts": available_charts,
            "permissions": {
                "can_customize_layout": False,
                "can_manage_pages": False,
            },
            "indicator_highlights": self._fetch_indicator_highlights(limit=8),
        }

    @expose("/config", methods=("GET",))
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.get_config",
        log_to_statsd=False,
    )
    def get_config(self) -> Response:
        """Get public page layout configuration."""
        try:
            payload = self._get_portal_payload()
            return self.response(200, result=payload["config"])
        except Exception as ex:  # pylint: disable=broad-except
            logger.error("Error fetching public page config: %s", ex)
            return self.response_500(message=str(ex))

    @expose("/navigation", methods=("GET",))
    @safe
    def get_navigation(self) -> Response:
        """Get backend-driven public navigation menus."""
        try:
            payload = self._get_portal_payload(
                request.args.get("page") or request.args.get("slug")
            )
            return self.response(200, result=payload["navigation"])
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error fetching public navigation")
            return self.response_500(message=str(ex))

    @expose("/pages", methods=("GET",))
    @safe
    def get_pages(self) -> Response:
        """Get public portal pages or one specific page by slug/id."""
        try:
            page_slug = request.args.get("slug")
            page_id = request.args.get("page_id", type=int)
            if page_slug or page_id:
                page = self._find_page(page_slug=page_slug, page_id=page_id, admin=False)
                if page is None:
                    return self.response_404()
                return self.response(
                    200,
                    result=self._serialize_page(
                        page,
                        include_admin=False,
                        public_context=True,
                    ),
                )

            pages = self._list_pages(admin=False)
            return self.response(
                200,
                result=[self._serialize_page_summary(page) for page in pages],
                count=len(pages),
            )
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error fetching public pages")
            return self.response_500(message=str(ex))

    @expose("/pages", methods=("POST",))
    @protect()
    @safe
    def save_page(self) -> Response:
        """Create or update a public portal page."""
        if not (_can_create_pages() or _can_edit_pages()):
            return self.response(403, message="You do not have permission to edit pages")

        try:
            payload = PortalPageSchema().load(request.json or {})
            page = self._upsert_page(payload)
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_page(page, include_admin=True, public_context=False),
            )
        except ValidationError as ex:
            db.session.rollback()
            return self.response_400(message=str(ex.messages))
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error saving public page")
            return self.response_500(message=str(ex))

    @expose("/page-layout", methods=("GET",))
    @safe
    def get_page_layout(self) -> Response:
        """Get portal layout config plus per-user page layout override."""
        try:
            page = self._find_page(
                page_slug=request.args.get("page_slug"),
                page_id=request.args.get("page_id", type=int),
                admin=_can_manage_pages(),
            )
            layout_config = self._get_or_create_layout_config()
            user_layout = self._get_user_layout(page)
            return self.response(
                200,
                result={
                    "page_id": page.id if page else None,
                    "page_slug": page.slug if page else None,
                    "portal_layout": _merge_dicts(
                        DEFAULT_PORTAL_LAYOUT_CONFIG,
                        layout_config.get_config(),
                    ),
                    "user_layout": self._serialize_user_layout(user_layout),
                },
            )
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error fetching public page layout")
            return self.response_500(message=str(ex))

    @expose("/page-layout", methods=("POST",))
    @protect()
    @safe
    def save_page_layout(self) -> Response:
        """Persist per-user page layout preferences."""
        if not _is_authenticated_user():
            return self.response(403, message="Login required")

        try:
            payload = UserLayoutSchema().load(request.json or {})
        except ValidationError as ex:
            return self.response_400(message=str(ex.messages))

        page = self._find_page(
            page_slug=payload.get("page_slug"),
            page_id=payload.get("page_id"),
            admin=_can_manage_pages(),
        )
        if page is None:
            return self.response_404(message="Page not found")

        user_id = get_user_id()
        if not user_id:
            return self.response(403, message="Login required")

        layout = (
            db.session.query(UserPageLayout)
            .filter(
                UserPageLayout.user_id == user_id,
                UserPageLayout.page_id == page.id,
            )
            .one_or_none()
        )
        if layout is None:
            layout = UserPageLayout(user_id=user_id, page_id=page.id)
            db.session.add(layout)

        layout.set_layout(
            {
                "section_order": payload.get("section_order") or [],
                "hidden_section_ids": payload.get("hidden_section_ids") or [],
                "settings": payload.get("settings") or {},
            }
        )
        db.session.commit()

        return self.response(200, result=self._serialize_user_layout(layout))

    @expose("/charts", methods=("GET",))
    @safe
    def get_available_charts(self) -> Response:
        """List public charts eligible for portal embedding."""
        try:
            charts = [
                self._serialize_chart(chart)
                for chart in self._list_public_serving_charts()
            ]
            return self.response(200, result=charts, count=len(charts))
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error fetching public portal charts")
            return self.response_500(message=str(ex))

    @expose("/portal", methods=("GET",))
    @safe
    def get_portal(self) -> Response:
        """Combined portal payload for navigation, pages, charts, and layout."""
        try:
            page_slug = request.args.get("page") or request.args.get("slug")
            payload = self._get_portal_payload(page_slug)
            if page_slug and payload["current_page"] is None:
                return self.response_404(message="Public page not found")
            return self.response(200, result=payload)
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error fetching public portal payload")
            return self.response_500(message=str(ex))

    @expose("/admin/bootstrap", methods=("GET",))
    @protect()
    @safe
    def get_admin_bootstrap(self) -> Response:
        """Combined authenticated CMS bootstrap payload."""
        if not _can_manage_pages():
            return self.response(403, message="You do not have access to CMS Pages")
        try:
            payload = self._get_admin_payload(
                page_slug=request.args.get("page") or request.args.get("slug"),
                page_id=request.args.get("page_id", type=int),
            )
            return self.response(200, result=payload)
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error fetching CMS bootstrap payload")
            return self.response_500(message=str(ex))

    @expose("/admin/assets", methods=("GET",))
    @protect()
    @safe
    def get_admin_assets(self) -> Response:
        """List authenticated CMS media/file assets."""
        if not _can_manage_media():
            return self.response(403, message="You do not have access to CMS media")
        try:
            assets = self._list_media_assets(admin=True)
            return self.response(
                200,
                result=[
                    self._serialize_media_asset(asset, include_admin=True)
                    for asset in assets
                ],
                count=len(assets),
            )
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error fetching CMS assets")
            return self.response_500(message=str(ex))

    @expose("/admin/assets", methods=("POST",))
    @protect()
    @safe
    def create_admin_asset(self) -> Response:
        """Upload a CMS media/file asset."""
        if not _can_manage_media():
            return self.response(403, message="You do not have access to CMS media")
        try:
            upload = request.files.get("file")
            if not isinstance(upload, FileStorage):
                return self.response_400(message="A file upload is required")
            visibility = request.form.get("visibility") or "private"
            if visibility not in {"private", "authenticated", "public"}:
                return self.response_400(message="Invalid asset visibility")
            asset = self._store_uploaded_asset(
                upload,
                title=request.form.get("title"),
                description=request.form.get("description"),
                visibility=visibility,
                is_public=(request.form.get("is_public") or "").lower()
                in {"1", "true", "yes", "on"},
                alt_text=request.form.get("alt_text"),
                caption=request.form.get("caption"),
            )
            db.session.commit()
            return self.response(
                201,
                result=self._serialize_media_asset(asset, include_admin=True),
            )
        except ValidationError as ex:
            db.session.rollback()
            messages = ex.messages if isinstance(ex.messages, dict) else {"asset": ex.messages}
            return self.response_400(message=messages)
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error uploading CMS asset")
            return self.response_500(message=str(ex))

    @expose("/admin/assets/<int:asset_id>", methods=("DELETE",))
    @protect()
    @safe
    def archive_admin_asset(self, asset_id: int) -> Response:
        """Archive a CMS asset without deleting the file from disk."""
        if not _can_manage_media():
            return self.response(403, message="You do not have access to CMS media")
        try:
            asset = db.session.query(MediaAsset).filter(MediaAsset.id == asset_id).one_or_none()
            if asset is None:
                return self.response_404(message="Asset not found")
            asset.status = "archived"
            asset.is_public = False
            asset.archived_on = _now()
            asset.archived_by_fk = get_user_id()
            asset.changed_by_fk = get_user_id()
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_media_asset(asset, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error archiving CMS asset")
            return self.response_500(message=str(ex))

    @expose("/assets/<int:asset_id>/download", methods=("GET",))
    @safe
    def download_asset(self, asset_id: int) -> Response:
        """Download a public or permitted authenticated CMS asset."""
        try:
            asset = db.session.query(MediaAsset).filter(MediaAsset.id == asset_id).one_or_none()
            if asset is None or asset.status != "active":
                return self.response_404(message="Asset not found")
            if not self._asset_is_publicly_viewable(asset):
                if asset.visibility == "authenticated" and _is_authenticated_user():
                    pass
                elif asset.visibility == "private" and _can_manage_media():
                    pass
                else:
                    return self.response(403, message="Asset is not available")
            absolute_path = self._resolve_asset_storage_path(asset)
            if not os.path.exists(absolute_path):
                return self.response_404(message="Asset file not found")
            return send_file(
                absolute_path,
                mimetype=asset.mime_type or "application/octet-stream",
                as_attachment=asset.asset_type != "image",
                download_name=asset.original_filename or asset.title,
                conditional=True,
            )
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error downloading CMS asset")
            return self.response_500(message=str(ex))

    @expose("/admin/pages", methods=("GET",))
    @protect()
    @safe
    def get_admin_pages(self) -> Response:
        """List CMS pages or fetch a single page for editing."""
        if not _can_manage_pages():
            return self.response(403, message="You do not have access to CMS Pages")
        try:
            page_slug = request.args.get("slug")
            page_id = request.args.get("page_id", type=int)
            if page_slug or page_id:
                page = self._find_page(page_slug=page_slug, page_id=page_id, admin=True)
                if page is None:
                    return self.response_404(message="Page not found")
                return self.response(
                    200,
                    result=self._serialize_page(
                        page,
                        include_admin=True,
                        public_context=False,
                    ),
                )

            pages = self._list_pages(admin=True)
            return self.response(
                200,
                result=[
                    self._serialize_page_summary(page, include_admin=True)
                    for page in pages
                ],
                count=len(pages),
            )
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error fetching CMS pages")
            return self.response_500(message=str(ex))

    @expose("/admin/pages", methods=("POST",))
    @protect()
    @safe
    def save_admin_page(self) -> Response:
        """Create or update a CMS page from the authenticated admin studio."""
        try:
            payload = PortalPageSchema().load(request.json or {})
            if payload.get("id") and not _can_edit_pages():
                return self.response(403, message="You do not have permission to edit pages")
            if not payload.get("id") and not _can_create_pages():
                return self.response(403, message="You do not have permission to create pages")
            page = self._upsert_page(payload)
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_page(page, include_admin=True, public_context=False),
            )
        except ValidationError as ex:
            db.session.rollback()
            return self.response_400(message=str(ex.messages))
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error saving CMS page")
            return self.response_500(message=str(ex))

    @expose("/admin/block-types", methods=("GET",))
    @protect()
    @safe
    def get_admin_block_types(self) -> Response:
        """List available block definitions for the CMS editor."""
        if not _can_manage_pages():
            return self.response(403, message="You do not have access to CMS Pages")
        return self.response(200, result=list_block_definitions(), count=len(list_block_definitions()))

    @expose("/admin/pages/<int:page_id>/duplicate", methods=("POST",))
    @protect()
    @safe
    def duplicate_admin_page(self, page_id: int) -> Response:
        """Duplicate an existing CMS page."""
        if not _can_create_pages():
            return self.response(403, message="You do not have permission to create pages")
        page = self._find_page(page_id=page_id, admin=True)
        if page is None:
            return self.response_404(message="Page not found")
        try:
            cloned_page = self._clone_page(page)
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_page(
                    cloned_page,
                    include_admin=True,
                    public_context=False,
                ),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error duplicating CMS page")
            return self.response_500(message=str(ex))

    @expose("/admin/pages/<int:page_id>/publish", methods=("POST",))
    @protect()
    @safe
    def publish_admin_page(self, page_id: int) -> Response:
        """Publish or unpublish an existing CMS page."""
        if not _can_publish_pages():
            return self.response(403, message="You do not have permission to publish pages")
        page = self._find_page(page_id=page_id, admin=True)
        if page is None:
            return self.response_404(message="Page not found")
        try:
            payload = self._serialize_page(page, include_admin=True, public_context=False)
            payload.update(request.json or {})
            payload["id"] = page.id
            updated_page = self._upsert_page(payload)
            self._snapshot_page_revision(
                updated_page,
                action="published" if updated_page.is_published else "unpublished",
                summary=(
                    f"{'Published' if updated_page.is_published else 'Unpublished'} "
                    f"{updated_page.title}"
                ),
            )
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_page(
                    updated_page,
                    include_admin=True,
                    public_context=False,
                ),
            )
        except ValidationError as ex:
            db.session.rollback()
            return self.response_400(message=str(ex.messages))
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error publishing CMS page")
            return self.response_500(message=str(ex))

    @expose("/admin/pages/<int:page_id>/archive", methods=("POST",))
    @protect()
    @safe
    def archive_admin_page(self, page_id: int) -> Response:
        """Archive a CMS page."""
        if not _can_delete_pages():
            return self.response(403, message="You do not have permission to archive pages")
        page = self._find_page(page_id=page_id, admin=True)
        if page is None:
            return self.response_404(message="Page not found")
        try:
            page.status = "archived"
            page.visibility = page.visibility if page.visibility != "draft" else "authenticated"
            page.is_published = False
            page.is_homepage = False
            page.archived_on = _now()
            page.archived_by_fk = get_user_id()
            page.changed_by_fk = get_user_id()
            db.session.flush()
            self._snapshot_page_revision(
                page,
                action="archived",
                summary=f"Archived {page.title}",
            )
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_page(page, include_admin=True, public_context=False),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error archiving CMS page")
            return self.response_500(message=str(ex))

    @expose("/admin/pages/<int:page_id>/revisions", methods=("GET",))
    @protect()
    @safe
    def get_admin_page_revisions(self, page_id: int) -> Response:
        """Return revision history for a CMS page."""
        if not _can_manage_pages():
            return self.response(403, message="You do not have access to CMS Pages")
        page = self._find_page(page_id=page_id, admin=True)
        if page is None:
            return self.response_404(message="Page not found")
        return self.response(
            200,
            result=[
                self._serialize_page_revision(revision)
                for revision in page.revisions
            ],
            count=len(page.revisions),
        )

    @expose("/admin/pages/<int:page_id>", methods=("DELETE",))
    @protect()
    @safe
    def delete_admin_page(self, page_id: int) -> Response:
        """Soft-delete a CMS page by archiving it."""
        return self.archive_admin_page(page_id)

    @expose("/admin/menus", methods=("GET",))
    @protect()
    @safe
    def get_admin_menus(self) -> Response:
        """List CMS menus for the authenticated studio."""
        if not _can_manage_pages():
            return self.response(403, message="You do not have access to CMS Pages")
        menus = (
            db.session.query(NavigationMenu)
            .order_by(NavigationMenu.display_order.asc(), NavigationMenu.id.asc())
            .all()
        )
        pages = self._list_pages(admin=True)
        dashboards = self._list_public_dashboards()
        return self.response(
            200,
            result=self._serialize_navigation(
                menus,
                pages,
                dashboards,
                public_context=False,
            ),
        )

    @expose("/admin/menus", methods=("POST",))
    @protect()
    @safe
    def save_admin_menus(self) -> Response:
        """Create or update CMS menus and nested menu items."""
        if not _can_manage_menus():
            return self.response(403, message="You do not have permission to manage menus")
        try:
            payload = request.json or {}
            menus = PortalMenuSchema(many=True).load(payload.get("menus") or [])
            saved_menus = self._upsert_menus(menus)
            db.session.commit()
            pages = self._list_pages(admin=True)
            dashboards = self._list_public_dashboards()
            return self.response(
                200,
                result=self._serialize_navigation(
                    saved_menus,
                    pages,
                    dashboards,
                    public_context=False,
                ),
            )
        except ValidationError as ex:
            db.session.rollback()
            return self.response_400(message=str(ex.messages))
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error saving CMS menus")
            return self.response_500(message=str(ex))

    @expose("/admin/layout", methods=("GET",))
    @protect()
    @safe
    def get_admin_layout(self) -> Response:
        """Return the global portal layout config for CMS administration."""
        if not _can_manage_pages():
            return self.response(403, message="You do not have access to CMS Pages")
        layout_config = self._get_or_create_layout_config()
        return self.response(
            200,
            result={
                "id": layout_config.id,
                "scope": layout_config.scope,
                "title": layout_config.title,
                "config": _merge_dicts(
                    DEFAULT_PORTAL_LAYOUT_CONFIG,
                    layout_config.get_config(),
                ),
            },
        )

    @expose("/admin/layout", methods=("POST",))
    @protect()
    @safe
    def save_admin_layout(self) -> Response:
        """Persist global portal layout config from the CMS admin."""
        if not _can_manage_layout():
            return self.response(403, message="You do not have permission to manage layout")
        try:
            payload = PortalLayoutConfigSchema().load(request.json or {})
            layout_config = self._get_or_create_layout_config()
            layout_config.title = payload.get("title") or layout_config.title
            layout_config.set_config(payload.get("config") or {})
            db.session.commit()
            return self.response(
                200,
                result={
                    "id": layout_config.id,
                    "scope": layout_config.scope,
                    "title": layout_config.title,
                    "config": _merge_dicts(
                        DEFAULT_PORTAL_LAYOUT_CONFIG,
                        layout_config.get_config(),
                    ),
                },
            )
        except ValidationError as ex:
            db.session.rollback()
            return self.response_400(message=str(ex.messages))
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error saving CMS portal layout")
            return self.response_500(message=str(ex))

    @expose("/admin/themes", methods=("GET",))
    @protect()
    @safe
    def get_admin_themes(self) -> Response:
        """List CMS themes for authenticated administration."""
        if not (_can_manage_themes() or _can_edit_pages()):
            return self.response(403, message="You do not have access to CMS themes")
        themes = self._list_themes(admin=True)
        return self.response(
            200,
            result=[
                self._serialize_theme(theme, include_admin=True) for theme in themes
            ],
            count=len(themes),
        )

    @expose("/admin/themes", methods=("POST",))
    @protect()
    @safe
    def save_admin_theme(self) -> Response:
        """Create or update a CMS theme."""
        if not _can_manage_themes():
            return self.response(403, message="You do not have permission to manage themes")
        try:
            payload = ThemeSchema().load(request.json or {})
            theme = self._upsert_theme(payload)
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_theme(theme, include_admin=True),
            )
        except ValidationError as ex:
            db.session.rollback()
            return self.response_400(message=str(ex.messages))
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error saving CMS theme")
            return self.response_500(message=str(ex))

    @expose("/admin/themes/<int:theme_id>/duplicate", methods=("POST",))
    @protect()
    @safe
    def duplicate_admin_theme(self, theme_id: int) -> Response:
        """Duplicate a CMS theme."""
        if not _can_manage_themes():
            return self.response(403, message="You do not have permission to manage themes")
        theme = self._find_theme(theme_id=theme_id, admin=True)
        if theme is None:
            return self.response_404(message="Theme not found")
        try:
            cloned = self._clone_theme(theme)
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_theme(cloned, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error duplicating CMS theme")
            return self.response_500(message=str(ex))

    @expose("/admin/themes/<int:theme_id>/activate", methods=("POST",))
    @protect()
    @safe
    def activate_admin_theme(self, theme_id: int) -> Response:
        """Activate a CMS theme and optionally set it as the default."""
        if not _can_manage_themes():
            return self.response(403, message="You do not have permission to manage themes")
        theme = self._find_theme(theme_id=theme_id, admin=True)
        if theme is None:
            return self.response_404(message="Theme not found")
        try:
            payload = request.json or {}
            theme.status = "active"
            theme.is_active = True
            theme.archived_on = None
            theme.archived_by_fk = None
            theme.changed_by_fk = get_user_id()
            if payload.get("is_default", True):
                self._mark_theme_default(theme)
            else:
                self._ensure_default_theme_exists()
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_theme(theme, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error activating CMS theme")
            return self.response_500(message=str(ex))

    @expose("/admin/themes/<int:theme_id>/archive", methods=("POST",))
    @protect()
    @safe
    def archive_admin_theme(self, theme_id: int) -> Response:
        """Archive a CMS theme."""
        if not _can_manage_themes():
            return self.response(403, message="You do not have permission to manage themes")
        theme = self._find_theme(theme_id=theme_id, admin=True)
        if theme is None:
            return self.response_404(message="Theme not found")
        try:
            theme.status = "archived"
            theme.is_active = False
            theme.is_default = False
            theme.archived_on = _now()
            theme.archived_by_fk = get_user_id()
            theme.changed_by_fk = get_user_id()
            db.session.flush()
            self._ensure_default_theme_exists()
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_theme(theme, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error archiving CMS theme")
            return self.response_500(message=str(ex))

    @expose("/admin/templates", methods=("GET",))
    @protect()
    @safe
    def get_admin_templates(self) -> Response:
        """List CMS templates for authenticated administration."""
        if not (_can_manage_templates() or _can_edit_pages()):
            return self.response(
                403,
                message="You do not have access to CMS templates",
            )
        templates = self._list_templates(admin=True)
        return self.response(
            200,
            result=[
                self._serialize_template(template, include_admin=True)
                for template in templates
            ],
            count=len(templates),
        )

    @expose("/admin/templates", methods=("POST",))
    @protect()
    @safe
    def save_admin_template(self) -> Response:
        """Create or update a CMS template."""
        if not _can_manage_templates():
            return self.response(
                403,
                message="You do not have permission to manage templates",
            )
        try:
            payload = TemplateSchema().load(request.json or {})
            template = self._upsert_template(payload)
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_template(template, include_admin=True),
            )
        except ValidationError as ex:
            db.session.rollback()
            return self.response_400(message=str(ex.messages))
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error saving CMS template")
            return self.response_500(message=str(ex))

    @expose("/admin/templates/<int:template_id>/duplicate", methods=("POST",))
    @protect()
    @safe
    def duplicate_admin_template(self, template_id: int) -> Response:
        """Duplicate a CMS template."""
        if not _can_manage_templates():
            return self.response(
                403,
                message="You do not have permission to manage templates",
            )
        template = self._find_template(template_id=template_id, admin=True)
        if template is None:
            return self.response_404(message="Template not found")
        try:
            cloned = self._clone_template(template)
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_template(cloned, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error duplicating CMS template")
            return self.response_500(message=str(ex))

    @expose("/admin/templates/<int:template_id>/activate", methods=("POST",))
    @protect()
    @safe
    def activate_admin_template(self, template_id: int) -> Response:
        """Activate a CMS template and optionally set it as default."""
        if not _can_manage_templates():
            return self.response(
                403,
                message="You do not have permission to manage templates",
            )
        template = self._find_template(template_id=template_id, admin=True)
        if template is None:
            return self.response_404(message="Template not found")
        try:
            payload = request.json or {}
            template.status = "active"
            template.is_active = True
            template.archived_on = None
            template.archived_by_fk = None
            template.changed_by_fk = get_user_id()
            if payload.get("is_default", True):
                self._mark_template_default(template)
            else:
                self._ensure_default_template_exists()
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_template(template, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error activating CMS template")
            return self.response_500(message=str(ex))

    @expose("/admin/templates/<int:template_id>/archive", methods=("POST",))
    @protect()
    @safe
    def archive_admin_template(self, template_id: int) -> Response:
        """Archive a CMS template."""
        if not _can_manage_templates():
            return self.response(
                403,
                message="You do not have permission to manage templates",
            )
        template = self._find_template(template_id=template_id, admin=True)
        if template is None:
            return self.response_404(message="Template not found")
        try:
            template.status = "archived"
            template.is_active = False
            template.is_default = False
            template.archived_on = _now()
            template.archived_by_fk = get_user_id()
            template.changed_by_fk = get_user_id()
            db.session.flush()
            self._ensure_default_template_exists()
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_template(template, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error archiving CMS template")
            return self.response_500(message=str(ex))

    @expose("/admin/styles", methods=("GET",))
    @protect()
    @safe
    def get_admin_style_bundles(self) -> Response:
        """List CMS style bundles for authenticated administration."""
        if not (_can_manage_styles() or _can_edit_pages()):
            return self.response(
                403,
                message="You do not have access to CMS style bundles",
            )
        bundles = self._list_style_bundles(admin=True)
        return self.response(
            200,
            result=[
                self._serialize_style_bundle(bundle, include_admin=True)
                for bundle in bundles
            ],
            count=len(bundles),
        )

    @expose("/admin/styles", methods=("POST",))
    @protect()
    @safe
    def save_admin_style_bundle(self) -> Response:
        """Create or update a CMS style bundle."""
        if not _can_manage_styles():
            return self.response(
                403,
                message="You do not have permission to manage style bundles",
            )
        try:
            payload = StyleBundleSchema().load(request.json or {})
            bundle = self._upsert_style_bundle(payload)
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_style_bundle(bundle, include_admin=True),
            )
        except ValidationError as ex:
            db.session.rollback()
            return self.response_400(message=str(ex.messages))
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error saving CMS style bundle")
            return self.response_500(message=str(ex))

    @expose("/admin/styles/<int:style_bundle_id>/duplicate", methods=("POST",))
    @protect()
    @safe
    def duplicate_admin_style_bundle(self, style_bundle_id: int) -> Response:
        """Duplicate a CMS style bundle."""
        if not _can_manage_styles():
            return self.response(
                403,
                message="You do not have permission to manage style bundles",
            )
        bundle = self._find_style_bundle(style_bundle_id=style_bundle_id, admin=True)
        if bundle is None:
            return self.response_404(message="Style bundle not found")
        try:
            cloned = self._clone_style_bundle(bundle)
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_style_bundle(cloned, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error duplicating CMS style bundle")
            return self.response_500(message=str(ex))

    @expose("/admin/styles/<int:style_bundle_id>/activate", methods=("POST",))
    @protect()
    @safe
    def activate_admin_style_bundle(self, style_bundle_id: int) -> Response:
        """Activate a CMS style bundle."""
        if not _can_manage_styles():
            return self.response(
                403,
                message="You do not have permission to manage style bundles",
            )
        bundle = self._find_style_bundle(style_bundle_id=style_bundle_id, admin=True)
        if bundle is None:
            return self.response_404(message="Style bundle not found")
        try:
            bundle.status = "active"
            bundle.is_active = True
            bundle.archived_on = None
            bundle.archived_by_fk = None
            bundle.changed_by_fk = get_user_id()
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_style_bundle(bundle, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error activating CMS style bundle")
            return self.response_500(message=str(ex))

    @expose("/admin/styles/<int:style_bundle_id>/archive", methods=("POST",))
    @protect()
    @safe
    def archive_admin_style_bundle(self, style_bundle_id: int) -> Response:
        """Archive a CMS style bundle."""
        if not _can_manage_styles():
            return self.response(
                403,
                message="You do not have permission to manage style bundles",
            )
        bundle = self._find_style_bundle(style_bundle_id=style_bundle_id, admin=True)
        if bundle is None:
            return self.response_404(message="Style bundle not found")
        try:
            bundle.status = "archived"
            bundle.is_active = False
            bundle.archived_on = _now()
            bundle.archived_by_fk = get_user_id()
            bundle.changed_by_fk = get_user_id()
            db.session.commit()
            return self.response(
                200,
                result=self._serialize_style_bundle(bundle, include_admin=True),
            )
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error archiving CMS style bundle")
            return self.response_500(message=str(ex))

    @expose("/indicator_highlights", methods=("GET",))
    def indicator_highlights(self) -> Response:
        """Return latest indicator values from staged datasets for public display."""
        try:
            limit = min(int(request.args.get("limit", 20)), 100)
            now = time.monotonic()
            cached = _HIGHLIGHTS_CACHE
            if cached["data"] is not None and (now - cached["ts"]) < _HIGHLIGHTS_CACHE_TTL:
                highlights = cached["data"]
            else:
                highlights = self._fetch_indicator_highlights(limit)
                cached["data"] = highlights
                cached["ts"] = now
            return self.response(200, result=highlights, count=len(highlights))
        except Exception as ex:  # pylint: disable=broad-except
            logger.warning("indicator_highlights error: %s", ex)
            return self.response(200, result=[], count=0)

    def _fetch_indicator_highlights(self, limit: int = 20) -> list[dict[str, Any]]:
        """Query latest staged observations per (field, instance)."""
        from superset.dhis2.models import DHIS2Instance
        from superset.staging.models import (
            StageObservation,
            StagedDataset,
            StagedDatasetField,
        )

        latest_sub = (
            db.session.query(
                StageObservation.dataset_field_id,
                StageObservation.source_instance_id,
                func.max(StageObservation.period_key).label("max_period"),
            )
            .filter(
                (StageObservation.value_numeric.isnot(None))
                | (StageObservation.value_text.isnot(None))
            )
            .group_by(
                StageObservation.dataset_field_id,
                StageObservation.source_instance_id,
            )
            .subquery()
        )

        rows = (
            db.session.query(
                StagedDatasetField.source_field_label,
                StagedDatasetField.dataset_alias,
                StagedDatasetField.canonical_metric_key,
                StagedDataset.name.label("dataset_name"),
                DHIS2Instance.name.label("instance_name"),
                StageObservation.period_key,
                StageObservation.value_numeric,
                StageObservation.value_text,
                StageObservation.ingested_at,
            )
            .select_from(StagedDatasetField)
            .join(
                latest_sub,
                latest_sub.c.dataset_field_id == StagedDatasetField.id,
            )
            .join(
                StageObservation,
                (StageObservation.dataset_field_id == StagedDatasetField.id)
                & (
                    StageObservation.source_instance_id
                    == latest_sub.c.source_instance_id
                )
                & (StageObservation.period_key == latest_sub.c.max_period),
            )
            .join(StagedDataset, StagedDataset.id == StagedDatasetField.dataset_id)
            .outerjoin(
                DHIS2Instance,
                DHIS2Instance.id == StageObservation.source_instance_id,
            )
            .filter(
                StagedDataset.last_sync_status.in_(["success", "partial"]),
                (StageObservation.value_numeric.isnot(None))
                | (StageObservation.value_text.isnot(None)),
            )
            .order_by(StageObservation.ingested_at.desc())
            .limit(limit)
            .all()
        )

        results = []
        for row in rows:
            value = row.value_numeric
            if value is not None:
                if value >= 1_000_000:
                    display_value = f"{value / 1_000_000:.1f}M"
                elif value >= 1_000:
                    display_value = f"{value / 1_000:.1f}K"
                elif value == int(value):
                    display_value = f"{int(value):,}"
                else:
                    display_value = f"{value:.1f}"
            else:
                display_value = str(row.value_text or "—")

            results.append(
                {
                    "indicator_name": row.source_field_label
                    or row.dataset_alias
                    or "Indicator",
                    "canonical_metric_key": row.canonical_metric_key,
                    "dataset_name": row.dataset_name,
                    "instance_name": row.instance_name or "National",
                    "period": row.period_key or "—",
                    "value_raw": value,
                    "value": display_value,
                    "ingested_at": (
                        row.ingested_at.isoformat() if row.ingested_at else None
                    ),
                }
            )

        return results
