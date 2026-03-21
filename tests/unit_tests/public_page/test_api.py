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
import pytest
from uuid import uuid4

from superset.models.dashboard import Dashboard
from superset.public_page.api import PublicPageRestApi
from superset.public_page.models import (
    Page,
    PageComponent,
    PageRevision,
    PageSection,
    StyleBundle,
    Template,
    Theme,
)
from superset.public_page.styling import default_theme_tokens, validate_custom_css


def test_page_is_publicly_viewable(app_context: None) -> None:
    api = PublicPageRestApi()

    public_page = Page(visibility="public", is_published=True, status="published")
    draft_page = Page(visibility="draft", is_published=False, status="draft")
    private_page = Page(
        visibility="authenticated",
        is_published=False,
        status="private",
    )

    assert api._page_is_publicly_viewable(public_page) is True
    assert api._page_is_publicly_viewable(draft_page) is False
    assert api._page_is_publicly_viewable(private_page) is False


def test_page_revision_snapshot_round_trip(app_context: None) -> None:
    revision = PageRevision(revision_number=1, action="saved")

    revision.set_snapshot({"title": "Welcome", "sections": [{"section_key": "hero"}]})

    assert revision.get_snapshot() == {
        "title": "Welcome",
        "sections": [{"section_key": "hero"}],
    }


def test_validate_custom_css_blocks_unsafe_patterns() -> None:
    with pytest.raises(ValueError):
        validate_custom_css("@import url('https://example.com/theme.css');")


def test_default_theme_tokens_use_flat_full_width_public_defaults() -> None:
    tokens = default_theme_tokens()

    assert tokens["containers"]["pageMaxWidth"] == "100%"
    assert tokens["radius"]["lg"] == "0"
    assert tokens["shadows"]["card"] == "none"
    assert tokens["backgrounds"]["hero"] == "#ffffff"


def test_serialize_dashboard_includes_public_embed_uuid(app_context: None) -> None:
    api = PublicPageRestApi()
    dashboard = Dashboard(
        id=9,
        dashboard_title="National Malaria Dashboard",
        slug="national-malaria-dashboard",
        uuid=uuid4(),
    )

    serialized = api._serialize_dashboard(dashboard)

    assert serialized["id"] == 9
    assert serialized["slug"] == "national-malaria-dashboard"
    assert serialized["uuid"] == str(dashboard.uuid)


def test_resolve_page_rendering_falls_back_to_active_defaults(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()

    inactive_style = StyleBundle(
        id=31,
        slug="inactive-style",
        title="Inactive Style",
        status="archived",
        is_active=False,
    )
    inactive_style.set_variables({"padding": "32px"})
    inactive_style.css_text = ".card { color: red; }"

    inactive_theme = Theme(
        id=11,
        slug="inactive-theme",
        title="Inactive Theme",
        status="archived",
        is_active=False,
        is_default=False,
    )
    inactive_theme.set_tokens({"colors": {"accent": "#991b1b"}})

    default_theme = Theme(
        id=12,
        slug="default-theme",
        title="Default Theme",
        status="active",
        is_active=True,
        is_default=True,
    )
    default_theme.set_tokens({"colors": {"accent": "#0f766e"}})

    inactive_template = Template(
        id=21,
        slug="inactive-template",
        title="Inactive Template",
        status="archived",
        is_active=False,
        is_default=False,
        theme=inactive_theme,
    )
    inactive_template.set_structure({"regions": {"sidebar": {"enabled": True}}})

    default_template = Template(
        id=22,
        slug="default-template",
        title="Default Template",
        status="active",
        is_active=True,
        is_default=True,
    )
    default_template.set_structure({"regions": {"content": {"enabled": True}}})

    page = Page(
        slug="welcome",
        title="Welcome",
        visibility="public",
        is_published=True,
        status="published",
        theme=inactive_theme,
        template=inactive_template,
        style_bundle=inactive_style,
    )

    monkeypatch.setattr(api, "_default_theme", lambda admin=False: default_theme)
    monkeypatch.setattr(
        api,
        "_default_template",
        lambda admin=False: default_template,
    )

    rendering = api._resolve_page_rendering(page, public_context=True)

    assert rendering["theme"]["slug"] == "default-theme"
    assert rendering["template"]["slug"] == "default-template"
    assert rendering["style_bundle"] is None
    assert "--portal-accent" in rendering["css_text"]
    assert any("Inactive theme" in warning for warning in rendering["warnings"])
    assert any("Inactive template" in warning for warning in rendering["warnings"])
    assert any(
        "Inactive style bundle" in warning for warning in rendering["warnings"]
    )


def test_serialize_page_derives_block_tree_from_legacy_sections(
    app_context: None,
) -> None:
    api = PublicPageRestApi()
    page = Page(
        slug="dashboards",
        title="Dashboards",
        visibility="public",
        is_published=True,
        status="published",
    )
    section = PageSection(
        page=page,
        section_key="dashboard-directory",
        title="Public Dashboards",
        subtitle="Browse published dashboards.",
        section_type="dashboard_catalog",
        display_order=0,
        is_visible=True,
    )
    section.set_settings({})
    component = PageComponent(
        section=section,
        component_key="welcome-copy",
        component_type="markdown",
        title="Overview",
        body="Portal overview",
        display_order=0,
        is_visible=True,
    )
    component.set_settings({})

    serialized = api._serialize_page(page, include_admin=True, public_context=False)

    assert serialized["blocks"]
    assert serialized["blocks"][0]["block_type"] == "group"
    assert serialized["blocks"][0]["children"][0]["block_type"] == "rich_text"
    assert serialized["blocks"][0]["children"][0]["content"]["body"] == "Portal overview"
