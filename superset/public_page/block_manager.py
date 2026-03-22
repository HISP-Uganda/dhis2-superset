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
"""Shared block registry and legacy conversion helpers for public CMS pages."""

from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import uuid4


BLOCK_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "type": "section",
        "label": "Section",
        "category": "layout",
        "description": "Page section container with anchor, spacing, and background settings.",
        "icon": "layout",
        "is_container": True,
    },
    {
        "type": "rich_text",
        "label": "Rich Text",
        "category": "text",
        "description": "Formatted markdown or prose content.",
        "icon": "paragraph",
        "is_container": False,
    },
    {
        "type": "heading",
        "label": "Heading",
        "category": "text",
        "description": "Section heading with configurable level and alignment.",
        "icon": "title",
        "is_container": False,
    },
    {
        "type": "paragraph",
        "label": "Paragraph",
        "category": "text",
        "description": "Simple paragraph content block.",
        "icon": "align-left",
        "is_container": False,
    },
    {
        "type": "list",
        "label": "List",
        "category": "text",
        "description": "Bullet or ordered list.",
        "icon": "unordered-list",
        "is_container": False,
    },
    {
        "type": "quote",
        "label": "Quote",
        "category": "text",
        "description": "Quoted text with attribution.",
        "icon": "quote-left",
        "is_container": False,
    },
    {
        "type": "image",
        "label": "Image",
        "category": "media",
        "description": "Single image with alt text and caption.",
        "icon": "picture",
        "is_container": False,
    },
    {
        "type": "gallery",
        "label": "Gallery",
        "category": "media",
        "description": "Multi-image gallery.",
        "icon": "appstore",
        "is_container": False,
    },
    {
        "type": "video",
        "label": "Video",
        "category": "media",
        "description": "Embedded video block.",
        "icon": "video-camera",
        "is_container": False,
    },
    {
        "type": "embed",
        "label": "Embed",
        "category": "media",
        "description": "External embed or iframe source.",
        "icon": "link",
        "is_container": False,
    },
    {
        "type": "file",
        "label": "File",
        "category": "media",
        "description": "Downloadable file or document resource.",
        "icon": "paper-clip",
        "is_container": False,
    },
    {
        "type": "download",
        "label": "Download",
        "category": "media",
        "description": "Prominent download call-to-action for a CMS asset.",
        "icon": "download",
        "is_container": False,
    },
    {
        "type": "button",
        "label": "Button",
        "category": "design",
        "description": "Link or call-to-action button.",
        "icon": "plus-square",
        "is_container": False,
    },
    {
        "type": "divider",
        "label": "Divider",
        "category": "design",
        "description": "Horizontal separator.",
        "icon": "minus",
        "is_container": False,
    },
    {
        "type": "spacer",
        "label": "Spacer",
        "category": "design",
        "description": "Vertical spacing block.",
        "icon": "column-height",
        "is_container": False,
    },
    {
        "type": "group",
        "label": "Group",
        "category": "layout",
        "description": "Generic container block.",
        "icon": "border",
        "is_container": True,
    },
    {
        "type": "columns",
        "label": "Columns",
        "category": "layout",
        "description": "Responsive multi-column layout.",
        "icon": "layout",
        "is_container": True,
    },
    {
        "type": "column",
        "label": "Column",
        "category": "layout",
        "description": "Child column inside a columns block.",
        "icon": "column-width",
        "is_container": True,
    },
    {
        "type": "hero",
        "label": "Hero",
        "category": "layout",
        "description": "Prominent hero/banner block.",
        "icon": "highlight",
        "is_container": True,
    },
    {
        "type": "card",
        "label": "Card",
        "category": "layout",
        "description": "Card-style container.",
        "icon": "profile",
        "is_container": True,
    },
    {
        "type": "table",
        "label": "Table",
        "category": "data",
        "description": "Structured table content.",
        "icon": "table",
        "is_container": False,
    },
    {
        "type": "chart",
        "label": "Chart",
        "category": "data",
        "description": "Superset chart block.",
        "icon": "bar-chart",
        "is_container": False,
    },
    {
        "type": "dashboard",
        "label": "Dashboard",
        "category": "data",
        "description": "Embedded public dashboard block.",
        "icon": "dashboard",
        "is_container": False,
    },
    {
        "type": "dynamic_widget",
        "label": "Dynamic Widget",
        "category": "data",
        "description": "Runtime widget powered by backend data.",
        "icon": "database",
        "is_container": False,
    },
    {
        "type": "page_title",
        "label": "Page Title",
        "category": "utility",
        "description": "Render the current page title, subtitle, or excerpt.",
        "icon": "font-size",
        "is_container": False,
    },
    {
        "type": "breadcrumb",
        "label": "Breadcrumb",
        "category": "utility",
        "description": "Render the current page breadcrumb trail.",
        "icon": "right",
        "is_container": False,
    },
    {
        "type": "menu",
        "label": "Menu",
        "category": "utility",
        "description": "Render a managed navigation menu inside page content.",
        "icon": "menu",
        "is_container": False,
    },
    {
        "type": "reusable_reference",
        "label": "Reusable Section",
        "category": "layout",
        "description": "Synced section managed from the reusable block library.",
        "icon": "copy",
        "is_container": False,
    },
    {
        "type": "callout",
        "label": "Callout",
        "category": "design",
        "description": "Highlighted alert or informational card.",
        "icon": "notification",
        "is_container": False,
    },
    {
        "type": "statistic",
        "label": "Statistic",
        "category": "data",
        "description": "Standalone metric/stat block.",
        "icon": "number",
        "is_container": False,
    },
    {
        "type": "html",
        "label": "HTML",
        "category": "advanced",
        "description": "Sanitized raw HTML block.",
        "icon": "code",
        "is_container": False,
    },
)

BLOCK_TYPE_INDEX = {definition["type"]: definition for definition in BLOCK_DEFINITIONS}
CONTAINER_BLOCK_TYPES = {
    definition["type"]
    for definition in BLOCK_DEFINITIONS
    if definition.get("is_container")
}
DEFAULT_WELCOME_PAGE_SEED_VERSION = 2

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

LEGACY_SECTION_TYPE_MAP = {
    "hero": "hero",
    "section": "section",
    "chart_grid": "group",
    "kpi_band": "group",
    "dashboard_catalog": "group",
    "content": "group",
}


def list_block_definitions() -> list[dict[str, Any]]:
    return [deepcopy(definition) for definition in BLOCK_DEFINITIONS]


def generate_block_uid(prefix: str = "blk") -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def is_container_block(block_type: str | None) -> bool:
    return (block_type or "").strip().lower() in CONTAINER_BLOCK_TYPES


def default_block_payload(block_type: str) -> dict[str, Any]:
    normalized = (block_type or "rich_text").strip().lower()
    definition = BLOCK_TYPE_INDEX.get(normalized) or BLOCK_TYPE_INDEX["rich_text"]
    payload: dict[str, Any] = {
        "uid": generate_block_uid(),
        "block_type": definition["type"],
        "slot": "content",
        "visibility": "public",
        "status": "active",
        "is_container": bool(definition.get("is_container")),
        "content": {},
        "settings": {},
        "styles": {},
        "metadata": {
            "label": definition["label"],
        },
        "children": [],
    }
    if definition["type"] in {"rich_text", "paragraph"}:
        payload["content"] = {"body": "Add content here."}
    elif definition["type"] == "section":
        payload["content"] = {"title": "Section", "subtitle": ""}
        payload["settings"] = {
            "anchor": "",
            "container": "default",
            "background": "",
            "columns": 1,
        }
    elif definition["type"] == "heading":
        payload["content"] = {"text": "Heading", "level": 2}
    elif definition["type"] == "quote":
        payload["content"] = {"quote": "Quote", "citation": ""}
    elif definition["type"] == "image":
        payload["content"] = {"url": "", "alt": "", "caption": ""}
    elif definition["type"] == "gallery":
        payload["content"] = {"images": []}
    elif definition["type"] == "video":
        payload["content"] = {"url": "", "caption": ""}
    elif definition["type"] == "embed":
        payload["content"] = {"url": "", "caption": ""}
    elif definition["type"] in {"file", "download"}:
        payload["content"] = {"title": "Download resource", "body": ""}
        payload["settings"] = {"asset_ref": None, "download_url": "", "open_in_new_tab": False}
    elif definition["type"] == "button":
        payload["content"] = {"label": "Open link"}
        payload["settings"] = {"url": "", "variant": "primary"}
    elif definition["type"] == "spacer":
        payload["settings"] = {"height": 48}
    elif definition["type"] == "columns":
        payload["settings"] = {"columnCount": 2, "gap": 24}
        payload["children"] = [
            default_block_payload("column"),
            default_block_payload("column"),
        ]
    elif definition["type"] == "column":
        payload["slot"] = "content"
    elif definition["type"] == "hero":
        payload["slot"] = "hero"
        payload["content"] = {
            "eyebrow": "",
            "title": "Hero Title",
            "subtitle": "Add an introductory subtitle.",
        }
    elif definition["type"] == "card":
        payload["content"] = {"title": "Card Title", "subtitle": ""}
    elif definition["type"] == "table":
        payload["content"] = {"columns": [], "rows": []}
    elif definition["type"] == "chart":
        payload["content"] = {
            "title": "Chart",
            "caption": "",
        }
        payload["settings"] = {
            "provider": "superset",
            "mode": "saved_chart",
            "chart_ref": None,
            "height": 360,
            "responsive": True,
            "show_header": True,
            "surface_preset": "default",
            "legend_preset": "default",
        }
    elif definition["type"] == "dashboard":
        payload["content"] = {
            "title": "Dashboard",
            "caption": "",
        }
        payload["settings"] = {
            "dashboard_ref": None,
            "height": 720,
        }
    elif definition["type"] == "dynamic_widget":
        payload["content"] = {
            "title": "Dynamic Widget",
            "subtitle": "",
            "body": "",
            "note": "",
            "emptyMessage": "",
            "datasetFallbackLabel": "",
            "latestPeriodLabel": "",
            "cardEyebrow": "",
            "cardDescription": "",
            "actionLabel": "",
            "slugFallbackLabel": "",
        }
        payload["settings"] = {"widgetType": "indicator_highlights", "limit": 6}
    elif definition["type"] == "page_title":
        payload["settings"] = {"showSubtitle": True, "showExcerpt": False}
    elif definition["type"] == "breadcrumb":
        payload["settings"] = {"showCurrentPage": True}
    elif definition["type"] == "menu":
        payload["content"] = {"title": "Menu"}
        payload["settings"] = {"menu_slug": "header", "location": "header"}
    elif definition["type"] == "reusable_reference":
        payload["content"] = {"title": "Reusable Section"}
        payload["settings"] = {"reusable_block_id": None, "displayMode": "synced"}
    elif definition["type"] == "callout":
        payload["content"] = {"title": "Callout", "body": "Highlight an important note."}
        payload["settings"] = {"tone": "info"}
    elif definition["type"] == "statistic":
        payload["content"] = {"title": "Statistic", "value": "0", "caption": ""}
    elif definition["type"] == "html":
        payload["content"] = {"html": ""}
    return payload


def _derive_slot_from_legacy_section(section_type: str, settings: dict[str, Any]) -> str:
    if settings.get("region"):
        return str(settings["region"])
    if section_type == "hero":
        return "hero"
    return "content"


def legacy_sections_to_blocks(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for section_index, section in enumerate(sections or []):
        section_type = (section.get("section_type") or "content").strip().lower()
        settings = deepcopy(section.get("settings") or {})
        container_type = LEGACY_SECTION_TYPE_MAP.get(section_type, "group")
        block = default_block_payload(container_type)
        block.update(
            {
                "id": section.get("id"),
                "uid": section.get("uid") or generate_block_uid("sec"),
                "block_type": container_type,
                "slot": _derive_slot_from_legacy_section(section_type, settings),
                "sort_order": int(section.get("display_order") or section_index),
                "is_container": True,
                "visibility": "public",
                "status": "active" if section.get("is_visible", True) else "hidden",
                "style_bundle_id": section.get("style_bundle_id"),
                "content": {
                    "title": section.get("title"),
                    "subtitle": section.get("subtitle"),
                },
                "settings": {
                    **settings,
                    "legacySectionType": section_type,
                    "legacySectionKey": section.get("section_key"),
                },
                "metadata": {
                    **(block.get("metadata") or {}),
                    "source": "legacy_section",
                    "section_key": section.get("section_key"),
                    "section_type": section_type,
                },
            }
        )
        if section_type == "hero":
            block["content"] = {
                "eyebrow": settings.get("eyebrow"),
                "title": section.get("title"),
                "subtitle": section.get("subtitle"),
            }
        elif container_type == "group":
            block["content"] = {
                "title": section.get("title"),
                "subtitle": section.get("subtitle"),
            }
        child_blocks: list[dict[str, Any]] = []
        for component_index, component in enumerate(section.get("components") or []):
            component_type = (
                component.get("component_type") or "rich_text"
            ).strip().lower()
            normalized_type = LEGACY_COMPONENT_TYPE_MAP.get(
                component_type,
                component_type,
            )
            child = default_block_payload(normalized_type)
            component_settings = deepcopy(component.get("settings") or {})
            child.update(
                {
                    "id": component.get("id"),
                    "uid": component.get("uid") or generate_block_uid("cmp"),
                    "block_type": normalized_type,
                    "slot": block["slot"],
                    "sort_order": int(
                        component.get("display_order") or component_index
                    ),
                    "is_container": is_container_block(normalized_type),
                    "visibility": "public",
                    "status": "active"
                    if component.get("is_visible", True)
                    else "hidden",
                    "style_bundle_id": component.get("style_bundle_id"),
                    "content": {
                        "title": component.get("title"),
                        "body": component.get("body"),
                    },
                    "settings": component_settings,
                    "metadata": {
                        **(child.get("metadata") or {}),
                        "source": "legacy_component",
                        "component_key": component.get("component_key"),
                        "component_type": component_type,
                    },
                    "children": [],
                }
            )
            if normalized_type == "heading":
                child["content"] = {
                    "text": component.get("title") or component.get("body"),
                    "level": component_settings.get("level", 2),
                }
            elif normalized_type in {"paragraph", "rich_text"}:
                child["content"] = {
                    "body": component.get("body") or component.get("title"),
                }
            elif normalized_type == "image":
                child["content"] = {
                    "title": component.get("title"),
                    "url": component_settings.get("imageUrl"),
                    "alt": component_settings.get("altText"),
                    "caption": component_settings.get("caption") or component.get("body"),
                }
            elif normalized_type == "button":
                child["content"] = {
                    "label": component.get("body") or component.get("title"),
                }
            elif normalized_type == "card":
                child["content"] = {
                    "title": component.get("title"),
                    "body": component.get("body"),
                    "buttonLabel": component_settings.get("buttonLabel"),
                }
            elif normalized_type == "chart":
                child["content"] = {
                    "title": component.get("title"),
                    "caption": component.get("body"),
                }
                child["settings"] = {
                    **component_settings,
                    "provider": "superset",
                    "mode": "saved_chart",
                    "chart_ref": (
                        {"id": component.get("chart_id")}
                        if component.get("chart_id") is not None
                        else None
                    ),
                    "height": component_settings.get("height", 360),
                }
            elif normalized_type == "dashboard":
                child["content"] = {
                    "title": component.get("title"),
                    "caption": component.get("body"),
                }
                child["settings"] = {
                    **component_settings,
                    "dashboard_ref": (
                        {"id": component.get("dashboard_id")}
                        if component.get("dashboard_id") is not None
                        else None
                    ),
                    "height": component_settings.get("height", 720),
                }
            elif normalized_type == "dynamic_widget":
                widget_type = "custom"
                if component_type == "indicator_highlights":
                    widget_type = "indicator_highlights"
                elif component_type == "dashboard_list":
                    widget_type = "dashboard_list"
                child["content"] = {
                    "title": component.get("title"),
                    "body": component.get("body"),
                }
                child["settings"] = {
                    **component_settings,
                    "widgetType": widget_type,
                }
            child_blocks.append(child)
        block["children"] = child_blocks
        if not child_blocks and section_type == "dashboard_catalog":
            catalog_block = default_block_payload("dynamic_widget")
            catalog_block.update(
                {
                    "uid": generate_block_uid("cmp"),
                    "slot": block["slot"],
                    "sort_order": 0,
                    "content": {
                        "title": section.get("title"),
                        "body": section.get("subtitle"),
                    },
                    "settings": {
                        "widgetType": "dashboard_list",
                    },
                    "metadata": {
                        **(catalog_block.get("metadata") or {}),
                        "source": "legacy_section_virtual_component",
                        "component_type": "dashboard_list",
                    },
                }
            )
            block["children"] = [catalog_block]
        elif not child_blocks and section_type == "kpi_band":
            highlight_block = default_block_payload("dynamic_widget")
            highlight_block.update(
                {
                    "uid": generate_block_uid("cmp"),
                    "slot": block["slot"],
                    "sort_order": 0,
                    "content": {
                        "title": section.get("title"),
                        "body": section.get("subtitle"),
                    },
                    "settings": {
                        "widgetType": "indicator_highlights",
                        "limit": 6,
                    },
                    "metadata": {
                        **(highlight_block.get("metadata") or {}),
                        "source": "legacy_section_virtual_component",
                        "component_type": "indicator_highlights",
                    },
                }
            )
            block["children"] = [highlight_block]
        blocks.append(block)
    return blocks


def _starter_pattern_block(
    block_type: str,
    *,
    slot: str | None = None,
    content: dict[str, Any] | None = None,
    settings: dict[str, Any] | None = None,
    styles: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    children: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    block = default_block_payload(block_type)
    block["content"] = {
        **(block.get("content") or {}),
        **(content or {}),
    }
    block["settings"] = {
        **(block.get("settings") or {}),
        **(settings or {}),
    }
    block["styles"] = {
        **(block.get("styles") or {}),
        **(styles or {}),
    }
    block["metadata"] = {
        **(block.get("metadata") or {}),
        **(metadata or {}),
    }
    if slot is not None:
        block["slot"] = slot
    if children is not None:
        block["children"] = children
    return block


def build_default_welcome_page_blocks(
    *,
    featured_charts: list[dict[str, Any]] | None = None,
    has_public_dashboards: bool = False,
) -> list[dict[str, Any]]:
    featured_chart_payload = [
        chart
        for chart in (featured_charts or [])[:4]
        if chart.get("id") is not None
    ]
    seed_metadata = {
        "seedSource": "default_welcome_page",
        "seedVersion": DEFAULT_WELCOME_PAGE_SEED_VERSION,
    }

    def welcome_block(
        block_type: str,
        *,
        slot: str | None = None,
        content: dict[str, Any] | None = None,
        settings: dict[str, Any] | None = None,
        styles: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        children: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return _starter_pattern_block(
            block_type,
            slot=slot,
            content=content,
            settings=settings,
            styles=styles,
            metadata={
                **seed_metadata,
                **(metadata or {}),
            },
            children=children,
        )

    hero_children = [
        welcome_block(
            "statistic",
            content={
                "title": "Dashboards",
                "value": "Curated",
                "caption": "Published views prepared for rapid public exploration.",
            },
            settings={"gridSpan": 4, "minHeight": 156},
            styles={
                "backgroundColor": "rgba(255, 255, 255, 0.84)",
                "borderColor": "rgba(148, 163, 184, 0.3)",
            },
        ),
        welcome_block(
            "statistic",
            content={
                "title": "Serving data",
                "value": "Scoped",
                "caption": "Staged with the selected org units, periods, dimensions, and variables.",
            },
            settings={"gridSpan": 4, "minHeight": 156},
            styles={
                "backgroundColor": "rgba(255, 255, 255, 0.84)",
                "borderColor": "rgba(148, 163, 184, 0.3)",
            },
        ),
        welcome_block(
            "statistic",
            content={
                "title": "Narrative pages",
                "value": "Balanced",
                "caption": "Reusable sections keep public interpretation consistent across pages.",
            },
            settings={"gridSpan": 4, "minHeight": 156},
            styles={
                "backgroundColor": "rgba(255, 255, 255, 0.84)",
                "borderColor": "rgba(148, 163, 184, 0.3)",
            },
        ),
        welcome_block(
            "callout",
            content={
                "title": "What this portal guarantees",
                "body": (
                    "Published highlights and featured analytics are served from local "
                    "staging tables that preserve the configured geography, time period, "
                    "dimensions, and variables selected for publication."
                ),
            },
            settings={"tone": "info", "gridSpan": 12},
            styles={
                "backgroundColor": "rgba(255, 255, 255, 0.74)",
                "borderColor": "rgba(15, 118, 110, 0.32)",
            },
        ),
    ]

    blocks = [
        welcome_block(
            "hero",
            slot="hero",
            content={
                "eyebrow": "Uganda Malaria Analytics Portal",
                "title": "Welcome to a trusted public analytics workspace",
                "subtitle": (
                    "Explore curated dashboards, recent highlights, and published pages "
                    "prepared for programme teams, district leaders, and partners."
                ),
                "body": (
                    "This landing page brings together the fastest entry points into "
                    "public malaria evidence. Start with the summary blocks, then move "
                    "into dashboard views when deeper analysis is needed."
                ),
            },
            settings={
                "primaryActionLabel": "Browse dashboards",
                "primaryActionUrl": "/superset/public/dashboards/",
                "secondaryActionLabel": "View methodology",
                "secondaryActionUrl": "/superset/public/about/",
            },
            styles={
                "background": (
                    "linear-gradient(135deg, rgba(15, 118, 110, 0.1) 0%, "
                    "rgba(29, 78, 216, 0.05) 100%)"
                ),
                "padding": "40px",
            },
            children=hero_children,
        ),
        welcome_block(
            "section",
            content={
                "title": "Use this portal to answer core questions",
                "subtitle": (
                    "The welcome page is structured for fast scanning first, then deeper "
                    "navigation into dashboards and supporting pages."
                ),
            },
            settings={"columns": 3, "anchor": "portal-overview"},
            children=[
                welcome_block(
                    "card",
                    content={
                        "title": "Review performance quickly",
                        "body": (
                            "Start with highlights and featured analysis to spot shifts "
                            "before opening a full dashboard."
                        ),
                    },
                    settings={"minHeight": 208},
                ),
                welcome_block(
                    "card",
                    content={
                        "title": "Move across hierarchy levels",
                        "body": (
                            "Published content can surface national, regional, district, "
                            "subcounty, and facility views when those levels are staged."
                        ),
                    },
                    settings={"minHeight": 208},
                ),
                welcome_block(
                    "card",
                    content={
                        "title": "Share a consistent public story",
                        "body": (
                            "Balanced narrative blocks, dashboard links, and notes keep "
                            "public interpretation aligned with the published scope."
                        ),
                    },
                    settings={"minHeight": 208},
                ),
            ],
        ),
        welcome_block(
            "dynamic_widget",
            content={
                "title": "Latest published highlights",
                "subtitle": (
                    "Recent staged observations surfaced for a quick programme readout."
                ),
            },
            settings={"widgetType": "indicator_highlights", "limit": 6},
        ),
    ]

    if featured_chart_payload:
        blocks.append(
            welcome_block(
                "section",
                content={
                    "title": "Featured public analysis",
                    "subtitle": (
                        "Selected charts built from serving datasets and ready for public sharing."
                    ),
                },
                settings={"columns": 2, "anchor": "featured-analysis"},
                children=[
                    welcome_block(
                        "chart",
                        content={
                            "title": str(chart.get("title") or "Featured chart"),
                            "caption": str(
                                chart.get("caption")
                                or "Published chart from a staged serving dataset."
                            ),
                        },
                        settings={
                            "chart_ref": {"id": chart["id"]},
                            "height": 380,
                            "responsive": True,
                            "show_header": True,
                        },
                    )
                    for chart in featured_chart_payload
                ],
            )
        )

    if has_public_dashboards:
        blocks.append(
            welcome_block(
                "dynamic_widget",
                content={
                    "title": "Published dashboards",
                    "subtitle": (
                        "Open curated dashboard collections for broader exploration and drill-down."
                    ),
                },
                settings={"widgetType": "dashboard_list"},
            )
        )
    else:
        blocks.append(
            welcome_block(
                "section",
                content={
                    "title": "Dashboard directory",
                    "subtitle": (
                        "The landing page is ready to guide readers into dashboards as "
                        "soon as public views are promoted."
                    ),
                },
                settings={"columns": 2, "anchor": "dashboard-directory"},
                children=[
                    welcome_block(
                        "card",
                        content={
                            "title": "Publish the first dashboard",
                            "body": (
                                "Once a public dashboard is available, it will appear here "
                                "as a direct entry point from the welcome page."
                            ),
                        },
                        settings={"minHeight": 196},
                    ),
                    welcome_block(
                        "card",
                        content={
                            "title": "Keep the story balanced",
                            "body": (
                                "Use the welcome page for framing and navigation, and "
                                "reserve the dashboard directory for detailed visual analysis."
                            ),
                        },
                        settings={"minHeight": 196},
                    ),
                ],
            )
        )

    blocks.append(
        welcome_block(
            "section",
            content={
                "title": "How published data is prepared",
                "subtitle": (
                    "The public view stays aligned to the selected publication scope."
                ),
            },
            settings={"columns": 2, "anchor": "data-methodology"},
            children=[
                welcome_block(
                    "card",
                    content={
                        "title": "Serving datasets follow the published scope",
                        "body": (
                            "Each staged dataset is prepared from the exact org units, "
                            "periods, dimensions, and variables selected during publication. "
                            "Public pages read from those serving tables for stable access."
                        ),
                    },
                    settings={"minHeight": 220},
                ),
                welcome_block(
                    "callout",
                    content={
                        "title": "Interpret figures with their labels",
                        "body": (
                            "Read indicator names, period labels, and geography context "
                            "together. Those labels reflect the scope configured at staging time."
                        ),
                    },
                    settings={"tone": "success", "minHeight": 220},
                    styles={"backgroundColor": "#f8fafc", "borderColor": "#0f766e"},
                ),
            ],
        )
    )
    blocks.extend(
        [
            welcome_block(
                "callout",
                slot="cta",
                content={
                    "title": "Start with the dashboard directory",
                    "body": (
                        "Move from this summary page into published dashboards for deeper "
                        "trend, geography, and indicator exploration."
                    ),
                },
                settings={"tone": "success"},
                styles={
                    "padding": "28px",
                    "backgroundColor": "rgba(15, 118, 110, 0.06)",
                    "borderColor": "#0f766e",
                },
            ),
            welcome_block(
                "button",
                slot="cta",
                content={"label": "Open dashboards"},
                settings={"url": "/superset/public/dashboards/", "variant": "primary"},
                styles={"justifySelf": "start"},
            ),
        ]
    )
    return blocks


def list_starter_patterns() -> list[dict[str, Any]]:
    welcome_pattern = {
        "id": "welcome-homepage",
        "slug": "welcome-homepage",
        "title": "Welcome Homepage",
        "description": "Complete default landing page with a professional hero, balanced guidance, and dashboard CTA.",
        "category": "landing",
        "blocks": build_default_welcome_page_blocks(
            featured_charts=[],
            has_public_dashboards=False,
        ),
    }
    hero_pattern = {
        "id": "hero-storytelling",
        "slug": "hero-storytelling",
        "title": "Hero Storytelling",
        "description": "Lead with a narrative headline, supporting summary, and clear next steps.",
        "category": "storytelling",
        "blocks": [
            _starter_pattern_block(
                "hero",
                content={
                    "eyebrow": "National snapshot",
                    "title": "Malaria programme performance at a glance",
                    "subtitle": "Frame the key message, current period, and audience before readers enter the detail.",
                    "body": "Summarize what changed, why it matters, and where to explore deeper evidence on the page.",
                },
                settings={
                    "primaryActionLabel": "Explore dashboards",
                    "primaryActionUrl": "/superset/public/dashboards/",
                    "secondaryActionLabel": "Read methodology",
                    "secondaryActionUrl": "#methodology",
                },
                children=[
                    _starter_pattern_block(
                        "card",
                        content={
                            "title": "What to watch",
                            "body": "Highlight one priority trend, one risk, and the next operational decision.",
                        },
                        styles={
                            "backgroundColor": "#ffffff",
                            "padding": "24px",
                            "borderColor": "#cbd5e1",
                        },
                    ),
                ],
            ),
        ],
    }
    feature_grid_pattern = {
        "id": "feature-grid",
        "slug": "feature-grid",
        "title": "Feature Grid",
        "description": "Show three to four programme focus areas or service offers in a balanced grid.",
        "category": "storytelling",
        "blocks": [
            _starter_pattern_block(
                "section",
                content={
                    "title": "Priority focus areas",
                    "subtitle": "Use cards to summarize service pillars, interventions, or programme workstreams.",
                },
                settings={"columns": 3},
                children=[
                    _starter_pattern_block(
                        "card",
                        content={
                            "title": "Case management",
                            "body": "Explain the operational objective and supporting evidence in two short sentences.",
                        },
                    ),
                    _starter_pattern_block(
                        "card",
                        content={
                            "title": "Surveillance",
                            "body": "Describe the insight this workstream provides and who depends on it.",
                        },
                    ),
                    _starter_pattern_block(
                        "card",
                        content={
                            "title": "Supply chain",
                            "body": "Summarize stock visibility, response timing, or another execution concern.",
                        },
                    ),
                ],
            ),
        ],
    }
    cta_pattern = {
        "id": "call-to-action-band",
        "slug": "call-to-action-band",
        "title": "Call To Action Band",
        "description": "Close a page or section with a strong next action for analysts or programme teams.",
        "category": "conversion",
        "blocks": [
            _starter_pattern_block(
                "callout",
                content={
                    "title": "Need the full district breakdown?",
                    "body": "Direct readers to the most relevant dashboard, download, or briefing pack.",
                },
                settings={"tone": "success"},
                styles={
                    "padding": "24px",
                    "backgroundColor": "#f8fafc",
                    "borderColor": "#0f766e",
                },
            ),
            _starter_pattern_block(
                "button",
                content={"label": "Open district dashboard"},
                settings={"url": "/superset/public/dashboards/", "variant": "primary"},
                styles={"justifySelf": "start"},
            ),
        ],
    }
    faq_pattern = {
        "id": "faq-answers",
        "slug": "faq-answers",
        "title": "FAQ Answers",
        "description": "Stack common questions and concise answers for public guidance pages.",
        "category": "documentation",
        "blocks": [
            _starter_pattern_block(
                "section",
                content={
                    "title": "Frequently asked questions",
                    "subtitle": "Keep each answer short and link out when deeper references are needed.",
                },
                children=[
                    _starter_pattern_block(
                        "group",
                        content={"title": "How often is the data refreshed?"},
                        children=[
                            _starter_pattern_block(
                                "paragraph",
                                content={
                                    "body": "Describe the refresh cadence, the latest refresh date, and any known publication lag.",
                                },
                            )
                        ],
                    ),
                    _starter_pattern_block(
                        "group",
                        content={"title": "Who should use this page?"},
                        children=[
                            _starter_pattern_block(
                                "paragraph",
                                content={
                                    "body": "Clarify the intended audience, recommended decisions, and important caveats.",
                                },
                            )
                        ],
                    ),
                ],
            ),
        ],
    }
    chart_showcase_pattern = {
        "id": "chart-showcase",
        "slug": "chart-showcase",
        "title": "Chart Showcase",
        "description": "Combine narrative framing with a featured chart and supporting interpretation.",
        "category": "analytics",
        "blocks": [
            _starter_pattern_block(
                "section",
                content={
                    "title": "Featured analysis",
                    "subtitle": "Pair one key chart with the interpretation readers should take away.",
                },
                children=[
                    _starter_pattern_block(
                        "chart",
                        content={
                            "title": "Coverage trend",
                            "caption": "Replace this placeholder with a serving-table chart.",
                        },
                        settings={"height": 420},
                    ),
                    _starter_pattern_block(
                        "callout",
                        content={
                            "title": "Interpretation",
                            "body": "Use this space to explain the trend, caveats, and suggested follow-up action.",
                        },
                        settings={"tone": "info"},
                    ),
                ],
            ),
        ],
    }
    two_column_pattern = {
        "id": "two-column-briefing",
        "slug": "two-column-briefing",
        "title": "Two Column Briefing",
        "description": "Balance narrative text and supporting evidence side by side.",
        "category": "briefing",
        "blocks": [
            _starter_pattern_block(
                "columns",
                settings={"columnCount": 2, "gap": 24},
                children=[
                    _starter_pattern_block(
                        "column",
                        children=[
                            _starter_pattern_block(
                                "heading",
                                content={"text": "Context and key message", "level": 2},
                            ),
                            _starter_pattern_block(
                                "paragraph",
                                content={
                                    "body": "Use the left column for narrative explanation, interpretation, or methodology notes.",
                                },
                            ),
                        ],
                    ),
                    _starter_pattern_block(
                        "column",
                        children=[
                            _starter_pattern_block(
                                "statistic",
                                content={
                                    "title": "Reporting completeness",
                                    "value": "94%",
                                    "caption": "Latest available month",
                                },
                            ),
                            _starter_pattern_block(
                                "button",
                                content={"label": "Download source file"},
                                settings={"url": "/superset/public/dashboards/", "variant": "default"},
                            ),
                        ],
                    ),
                ],
            ),
        ],
    }
    return [
        welcome_pattern,
        hero_pattern,
        feature_grid_pattern,
        cta_pattern,
        faq_pattern,
        chart_showcase_pattern,
        two_column_pattern,
    ]
