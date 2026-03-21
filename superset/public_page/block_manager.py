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
        payload["content"] = {"title": "Dynamic Widget", "body": ""}
        payload["settings"] = {"widgetType": "indicator_highlights", "limit": 6}
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
