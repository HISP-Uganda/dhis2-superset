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
from marshmallow import ValidationError

from superset.extensions import db
from superset.models.dashboard import Dashboard
from superset.public_page.api import PublicPageRestApi
from superset.public_page.models import (
    MediaAsset,
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


def test_public_draft_page_save_does_not_require_public_references(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    captured: dict[str, list[bool]] = {"block_flags": [], "asset_flags": []}

    monkeypatch.setattr(api, "_validate_theme_reference", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        api,
        "_validate_template_reference",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        api,
        "_validate_style_bundle_reference",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        api,
        "_validate_parent_page_reference",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        api,
        "_validate_asset_reference",
        lambda *_args, require_public=False, **_kwargs: captured["asset_flags"].append(
            require_public
        )
        or None,
    )
    monkeypatch.setattr(
        api,
        "_validate_block_references",
        lambda *_args, require_public=False, **_kwargs: captured["block_flags"].append(
            require_public
        ),
    )
    monkeypatch.setattr(api, "_upsert_blocks", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_clear_legacy_sections", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        api,
        "_snapshot_page_revision",
        lambda *_args, **_kwargs: None,
    )

    page = api._upsert_page(
        {
            "title": "Draft page",
            "slug": "draft-page",
            "visibility": "public",
            "is_published": False,
            "status": "draft",
            "featured_image_asset_id": 11,
            "og_image_asset_id": 12,
            "settings": {},
            "blocks": [
                {
                    "block_type": "chart",
                    "content": {},
                    "settings": {"chart_ref": {"id": 99}},
                    "styles": {},
                    "metadata": {},
                    "children": [],
                }
            ],
            "sections": [],
        }
    )

    assert page.visibility == "public"
    assert page.is_published is False
    assert page.status == "draft"
    assert captured["block_flags"] == [False]
    assert captured["asset_flags"] == [False, False]


def test_published_public_page_save_requires_public_references(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    captured: dict[str, list[bool]] = {"block_flags": [], "asset_flags": []}

    monkeypatch.setattr(api, "_validate_theme_reference", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        api,
        "_validate_template_reference",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        api,
        "_validate_style_bundle_reference",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        api,
        "_validate_parent_page_reference",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        api,
        "_validate_asset_reference",
        lambda *_args, require_public=False, **_kwargs: captured["asset_flags"].append(
            require_public
        )
        or None,
    )
    monkeypatch.setattr(
        api,
        "_validate_block_references",
        lambda *_args, require_public=False, **_kwargs: captured["block_flags"].append(
            require_public
        ),
    )
    monkeypatch.setattr(api, "_upsert_blocks", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_clear_legacy_sections", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        api,
        "_snapshot_page_revision",
        lambda *_args, **_kwargs: None,
    )

    page = api._upsert_page(
        {
            "title": "Published page",
            "slug": "published-page",
            "visibility": "public",
            "is_published": True,
            "status": "published",
            "featured_image_asset_id": 21,
            "og_image_asset_id": 22,
            "settings": {},
            "blocks": [
                {
                    "block_type": "chart",
                    "content": {},
                    "settings": {"chart_ref": {"id": 101}},
                    "styles": {},
                    "metadata": {},
                    "children": [],
                }
            ],
            "sections": [],
        }
    )

    assert page.visibility == "public"
    assert page.is_published is True
    assert page.status == "published"
    assert captured["block_flags"] == [True]
    assert captured["asset_flags"] == [True, True]


def test_page_breadcrumbs_include_parent_hierarchy(app_context: None) -> None:
    api = PublicPageRestApi()
    about = Page(
        id=1,
        slug="about",
        title="About",
        visibility="public",
        is_published=True,
        status="published",
    )
    team = Page(
        id=2,
        slug="team",
        title="Team",
        parent_page=about,
        visibility="public",
        is_published=True,
        status="published",
    )

    breadcrumbs = api._page_breadcrumbs(team, public_context=True)

    assert api._page_path(team) == "about/team"
    assert breadcrumbs == [
        {
            "id": 1,
            "title": "About",
            "slug": "about",
            "path": "/superset/public/about/",
        },
        {
            "id": 2,
            "title": "Team",
            "slug": "team",
            "path": "/superset/public/about/team/",
        },
    ]


def test_serialize_media_asset_exposes_download_url(app_context: None) -> None:
    api = PublicPageRestApi()
    asset = MediaAsset(
        id=5,
        slug="annual-report",
        title="Annual Report",
        asset_type="file",
        storage_path="annual-report.pdf",
        original_filename="Annual Report.pdf",
        visibility="public",
        is_public=True,
        status="active",
    )

    serialized = api._serialize_media_asset(asset, include_admin=True)

    assert serialized is not None
    assert serialized["download_url"] == "/api/v1/public_page/assets/5/download"
    assert serialized["original_filename"] == "Annual Report.pdf"


def test_validate_parent_page_reference_rejects_cycles(app_context: None) -> None:
    api = PublicPageRestApi()
    page = Page(id=11, slug="policies", title="Policies")
    child = Page(id=12, slug="privacy", title="Privacy", parent_page=page)

    class QueryStub:
        def __init__(self, result):
            self.result = result

        def filter(self, *args, **kwargs):
            del args, kwargs
            return self

        def one_or_none(self):
            return self.result

    original_query = db.session.query

    def fake_query(model):
        if model is Page:
            return QueryStub(child)
        return original_query(model)

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(db.session, "query", fake_query)
        with pytest.raises(ValidationError):
            api._validate_parent_page_reference(12, page=page)
