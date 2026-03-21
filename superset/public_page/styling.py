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
"""Theme, template, and scoped style helpers for the public portal CMS."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any


DEFAULT_THEME_TOKENS: dict[str, Any] = {
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

DEFAULT_TEMPLATE_STRUCTURE: dict[str, Any] = {
    "layoutMode": "editorial",
    "heroStyle": "split",
    "regions": {
        "header": {
            "enabled": True,
            "label": "Header",
            "container": "page",
        },
        "hero": {
            "enabled": True,
            "label": "Hero",
            "container": "page",
        },
        "content": {
            "enabled": True,
            "label": "Content",
            "container": "page",
        },
        "sidebar": {
            "enabled": False,
            "label": "Sidebar",
            "container": "compact",
        },
        "cta": {
            "enabled": True,
            "label": "CTA",
            "container": "page",
        },
        "footer": {
            "enabled": True,
            "label": "Footer",
            "container": "page",
        },
    },
    "settings": {
        "sidebarWidth": "320px",
        "contentColumns": 1,
        "stickySidebar": False,
    },
}

DEFAULT_STYLE_VARIABLES: dict[str, Any] = {
    "backgroundColor": "",
    "textColor": "",
    "borderColor": "",
    "borderRadius": "",
    "padding": "",
    "margin": "",
    "boxShadow": "",
    "maxWidth": "",
    "gap": "",
}

FORBIDDEN_CSS_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"</style",
        r"<script",
        r"javascript:",
        r"expression\s*\(",
        r"@import",
        r"-moz-binding",
        r"behavior\s*:",
        r"url\s*\(\s*['\"]?\s*javascript:",
    )
]

_TOKEN_KEY_RE = re.compile(r"[^a-z0-9]+")


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def normalize_slug(value: str) -> str:
    return _TOKEN_KEY_RE.sub("-", value.lower()).strip("-")


def css_var_name(*parts: str) -> str:
    normalized = [normalize_slug(part) for part in parts if part]
    return "--cms-" + "-".join(filter(None, normalized))


def theme_tokens_with_defaults(tokens: dict[str, Any] | None) -> dict[str, Any]:
    return deep_merge(DEFAULT_THEME_TOKENS, tokens or {})


def template_structure_with_defaults(structure: dict[str, Any] | None) -> dict[str, Any]:
    return deep_merge(DEFAULT_TEMPLATE_STRUCTURE, structure or {})


def style_variables_with_defaults(variables: dict[str, Any] | None) -> dict[str, Any]:
    return deep_merge(DEFAULT_STYLE_VARIABLES, variables or {})


def _coerce_css_value(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if len(text) > 500:
        text = text[:500]
    return text


def flatten_theme_tokens(tokens: dict[str, Any]) -> dict[str, str]:
    variables: dict[str, str] = {}
    for group_name, group_values in tokens.items():
        if not isinstance(group_values, dict):
            continue
        for token_name, token_value in group_values.items():
            variables[css_var_name(group_name, token_name)] = _coerce_css_value(
                token_value
            )

    colors = tokens.get("colors", {})
    fonts = tokens.get("fonts", {})
    containers = tokens.get("containers", {})
    radius = tokens.get("radius", {})
    shadows = tokens.get("shadows", {})
    headings = tokens.get("headings", {})
    links = tokens.get("links", {})
    backgrounds = tokens.get("backgrounds", {})

    variables.update(
        {
            "--portal-accent": _coerce_css_value(colors.get("accent")),
            "--portal-secondary": _coerce_css_value(colors.get("secondary")),
            "--portal-surface": _coerce_css_value(colors.get("surface")),
            "--portal-bg": _coerce_css_value(colors.get("background")),
            "--portal-bg-elevated": _coerce_css_value(
                colors.get("backgroundElevated")
            ),
            "--portal-text": _coerce_css_value(colors.get("text")),
            "--portal-muted": _coerce_css_value(colors.get("muted")),
            "--portal-muted-strong": _coerce_css_value(colors.get("mutedStrong")),
            "--portal-border": _coerce_css_value(colors.get("border")),
            "--portal-border-strong": _coerce_css_value(colors.get("borderStrong")),
            "--portal-link": _coerce_css_value(colors.get("link")),
            "--portal-link-hover": _coerce_css_value(colors.get("linkHover")),
            "--portal-font-heading": _coerce_css_value(fonts.get("heading")),
            "--portal-font-body": _coerce_css_value(fonts.get("body")),
            "--portal-font-mono": _coerce_css_value(fonts.get("mono")),
            "--portal-base-font-size": _coerce_css_value(fonts.get("baseSize")),
            "--portal-page-max-width": _coerce_css_value(
                containers.get("pageMaxWidth")
            ),
            "--portal-sidebar-width": _coerce_css_value(
                containers.get("sidebarWidth")
            ),
            "--portal-radius-md": _coerce_css_value(radius.get("md")),
            "--portal-radius-lg": _coerce_css_value(radius.get("lg")),
            "--portal-shadow-card": _coerce_css_value(shadows.get("card")),
            "--portal-shadow-hero": _coerce_css_value(shadows.get("hero")),
            "--portal-heading-hero-size": _coerce_css_value(
                headings.get("heroSize")
            ),
            "--portal-heading-section-size": _coerce_css_value(
                headings.get("sectionSize")
            ),
            "--portal-heading-card-size": _coerce_css_value(
                headings.get("cardSize")
            ),
            "--portal-link-decoration": _coerce_css_value(
                links.get("defaultDecoration")
            ),
            "--portal-link-hover-decoration": _coerce_css_value(
                links.get("hoverDecoration")
            ),
            "--portal-hero-background": _coerce_css_value(backgrounds.get("hero")),
        }
    )
    return {key: value for key, value in variables.items() if value}


def build_inline_style_from_variables(
    variables: dict[str, Any] | None,
) -> dict[str, str]:
    normalized = style_variables_with_defaults(variables)
    mapping = {
        "backgroundColor": "background",
        "textColor": "color",
        "borderColor": "borderColor",
        "borderRadius": "borderRadius",
        "padding": "padding",
        "margin": "margin",
        "boxShadow": "boxShadow",
        "maxWidth": "maxWidth",
        "gap": "gap",
    }
    inline_style = {
        css_key: _coerce_css_value(normalized.get(source_key))
        for source_key, css_key in mapping.items()
        if _coerce_css_value(normalized.get(source_key))
    }
    if inline_style.get("borderColor"):
        inline_style.setdefault("borderStyle", "solid")
        inline_style.setdefault("borderWidth", "1px")
    return inline_style


def build_css_variable_block(
    selector: str,
    variables: dict[str, str] | None,
) -> str:
    if not variables:
        return ""
    declarations = [
        f"  {name}: {value};"
        for name, value in variables.items()
        if _coerce_css_value(value)
    ]
    if not declarations:
        return ""
    return f"{selector} {{\n" + "\n".join(declarations) + "\n}\n"


def validate_custom_css(css_text: str | None) -> str:
    text = (css_text or "").strip()
    if not text:
        return ""
    if len(text) > 15000:
        raise ValueError("Custom CSS is too large")
    if "@" in text:
        raise ValueError("Only scoped CSS rules are supported; at-rules are not allowed")
    for pattern in FORBIDDEN_CSS_PATTERNS:
        if pattern.search(text):
            raise ValueError("CSS contains forbidden content")
    return text


def scope_css(css_text: str | None, selector: str) -> str:
    text = validate_custom_css(css_text)
    if not text:
        return ""
    scoped_rules: list[str] = []
    for block in text.split("}"):
        if "{" not in block:
            continue
        raw_selectors, declarations = block.split("{", 1)
        declarations = declarations.strip()
        if not declarations:
            continue
        selectors = []
        for raw_selector in raw_selectors.split(","):
            current = raw_selector.strip()
            if not current:
                continue
            if current in {":scope", "&"}:
                selectors.append(selector)
            elif current.startswith(selector):
                selectors.append(current)
            elif current in {"html", "body", ":root"}:
                selectors.append(selector)
            else:
                selectors.append(f"{selector} {current}")
        if selectors:
            scoped_rules.append(f"{', '.join(selectors)} {{ {declarations} }}")
    return "\n".join(scoped_rules)


def default_theme_tokens() -> dict[str, Any]:
    return deepcopy(DEFAULT_THEME_TOKENS)


def default_template_structure() -> dict[str, Any]:
    return deepcopy(DEFAULT_TEMPLATE_STRUCTURE)


def default_style_variables() -> dict[str, Any]:
    return deepcopy(DEFAULT_STYLE_VARIABLES)
