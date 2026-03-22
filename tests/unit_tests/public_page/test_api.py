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

import superset.public_page.api as public_page_api
from superset.extensions import db
from superset.models.dashboard import Dashboard
from superset.models.embedded_dashboard import EmbeddedDashboard
from superset.models.slice import Slice
from superset.public_page.api import (
    DEFAULT_WELCOME_PAGE_CTA_TARGET,
    DEFAULT_WELCOME_PAGE_DESCRIPTION,
    DEFAULT_WELCOME_PAGE_SUBTITLE,
    LEGACY_WELCOME_PAGE_DESCRIPTION,
    LEGACY_WELCOME_PAGE_SUBTITLE,
    PublicPageRestApi,
)
from superset.public_page.block_manager import DEFAULT_WELCOME_PAGE_SEED_VERSION
from superset.public_page.models import (
    MediaAsset,
    NavigationMenu,
    NavigationItem,
    Page,
    PageBlock,
    PageComponent,
    PageRevision,
    PageSection,
    ReusableBlock,
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
    embedded = EmbeddedDashboard(uuid=uuid4(), dashboard=dashboard)
    dashboard.embedded = [embedded]

    serialized = api._serialize_dashboard(dashboard)

    assert serialized["id"] == 9
    assert serialized["slug"] == "national-malaria-dashboard"
    assert serialized["uuid"] == str(embedded.uuid)


def test_list_public_dashboards_only_returns_published_embeddable_dashboards(
    app_context: None,
) -> None:
    api = PublicPageRestApi()
    published_embedded = Dashboard(
        dashboard_title="Published embedded dashboard",
        slug="published-embedded-dashboard",
        published=True,
        display_order=1,
    )
    published_embedded.embedded = [EmbeddedDashboard(uuid=uuid4())]
    published_only = Dashboard(
        dashboard_title="Published only dashboard",
        slug="published-only-dashboard",
        published=True,
        display_order=2,
    )
    draft_embedded = Dashboard(
        dashboard_title="Draft embedded dashboard",
        slug="draft-embedded-dashboard",
        published=False,
        display_order=3,
    )
    draft_embedded.embedded = [EmbeddedDashboard(uuid=uuid4())]
    db.session.add_all([published_embedded, published_only, draft_embedded])
    db.session.flush()

    dashboards = api._list_public_dashboards()

    assert [dashboard.slug for dashboard in dashboards] == [
        "published-embedded-dashboard"
    ]


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


def test_serialize_page_resolves_updated_reusable_block_references(
    app_context: None,
) -> None:
    api = PublicPageRestApi()
    reusable_block = ReusableBlock(
        slug="shared-faq",
        title="Shared FAQ",
        category="documentation",
        status="active",
        is_active=True,
    )
    reusable_block.set_settings({})
    reusable_block.set_blocks(
        [
            {
                "uid": "faq_group",
                "block_type": "group",
                "slot": "content",
                "sort_order": 0,
                "is_container": True,
                "content": {"title": "How current is the data?"},
                "settings": {},
                "styles": {},
                "metadata": {"label": "FAQ Group"},
                "children": [
                    {
                        "uid": "faq_answer",
                        "block_type": "paragraph",
                        "slot": "content",
                        "sort_order": 0,
                        "is_container": False,
                        "content": {"body": "Data refreshes daily."},
                        "settings": {},
                        "styles": {},
                        "metadata": {"label": "Answer"},
                        "children": [],
                    }
                ],
            }
        ]
    )
    page = Page(
        slug="faq",
        title="FAQ",
        visibility="public",
        is_published=True,
        status="published",
    )
    reference_block = PageBlock(
        page=page,
        uid="faq_synced",
        block_type="reusable_reference",
        slot="content",
        sort_order=0,
        tree_path="0000",
        depth=0,
        is_container=False,
        visibility="public",
        status="active",
        schema_version=1,
    )
    reference_block.set_content({"title": "Shared FAQ"})
    reference_block.set_settings({"reusable_block_id": 1})
    reference_block.set_styles({})
    reference_block.set_metadata({"label": "Shared FAQ"})

    db.session.add(reusable_block)
    db.session.flush()
    reference_block.set_settings({"reusable_block_id": reusable_block.id})
    db.session.add(page)
    db.session.add(reference_block)
    db.session.flush()

    serialized = api._serialize_page(page, include_admin=True, public_context=False)

    assert serialized["blocks"][0]["reusable_block"]["title"] == "Shared FAQ"
    assert (
        serialized["blocks"][0]["reusable_block"]["blocks"][0]["content"]["title"]
        == "How current is the data?"
    )

    reusable_block.set_blocks(
        [
            {
                "uid": "faq_group",
                "block_type": "group",
                "slot": "content",
                "sort_order": 0,
                "is_container": True,
                "content": {"title": "How current is the refreshed data?"},
                "settings": {},
                "styles": {},
                "metadata": {"label": "FAQ Group"},
                "children": [],
            }
        ]
    )
    db.session.flush()

    refreshed = api._serialize_page(page, include_admin=True, public_context=False)

    assert (
        refreshed["blocks"][0]["reusable_block"]["blocks"][0]["content"]["title"]
        == "How current is the refreshed data?"
    )


def test_upsert_reusable_block_creates_updates_and_deletes(app_context: None) -> None:
    api = PublicPageRestApi()

    created = api._upsert_reusable_block(
        {
            "title": "Shared CTA Band",
            "description": "Shared call to action",
            "category": "conversion",
            "blocks": [
                {
                    "block_type": "callout",
                    "content": {
                        "title": "Open the national dashboard",
                        "body": "Shared guidance for all district pages.",
                    },
                    "settings": {"tone": "success"},
                    "styles": {},
                    "metadata": {"label": "Shared CTA"},
                    "children": [],
                }
            ],
        }
    )
    db.session.flush()

    assert created.id is not None
    assert created.slug == "shared-cta-band"
    assert created.get_blocks()[0]["content"]["title"] == "Open the national dashboard"

    updated = api._upsert_reusable_block(
        {
            "id": created.id,
            "title": "Shared CTA Band Updated",
            "description": "Updated shared call to action",
            "category": "conversion",
            "blocks": [
                {
                    "block_type": "callout",
                    "content": {
                        "title": "Open the updated dashboard",
                        "body": "This change should propagate to synced sections.",
                    },
                    "settings": {"tone": "info"},
                    "styles": {},
                    "metadata": {"label": "Shared CTA"},
                    "children": [],
                }
            ],
        }
    )
    db.session.flush()

    assert updated.id == created.id
    assert updated.title == "Shared CTA Band Updated"
    assert updated.get_blocks()[0]["settings"]["tone"] == "info"

    db.session.delete(updated)
    db.session.flush()

    assert (
        db.session.query(ReusableBlock)
        .filter(ReusableBlock.id == created.id)
        .one_or_none()
        is None
    )


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

    monkeypatch.setattr(public_page_api, "_can_embed_charts", lambda: False)
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


def test_published_public_page_publish_promotes_referenced_serving_charts(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    private_chart = Slice(id=101, slice_name="District trend", is_public=False)
    original_query = db.session.query

    class SliceQueryStub:
        def filter(self, *args, **kwargs):
            del args, kwargs
            return self

        def all(self):
            return [private_chart]

        def one_or_none(self):
            return private_chart

    def fake_query(model):
        if model is Slice:
            return SliceQueryStub()
        return original_query(model)

    monkeypatch.setattr(public_page_api, "_can_embed_charts", lambda: True)
    monkeypatch.setattr(db.session, "query", fake_query)
    monkeypatch.setattr(api, "_chart_uses_serving_tables", lambda *_args, **_kwargs: True)
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
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(api, "_upsert_blocks", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_clear_legacy_sections", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_ensure_homepage_exists", lambda *_args, **_kwargs: None)

    page = api._upsert_page(
        {
            "title": "Published page",
            "slug": "published-page",
            "visibility": "public",
            "is_published": True,
            "status": "published",
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

    assert page.is_published is True
    assert page.status == "published"
    assert private_chart.is_public is True


def test_upsert_page_demotes_previous_active_landing_page(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    existing_home = Page(
        slug="welcome",
        title="Welcome",
        visibility="public",
        is_published=True,
        is_homepage=True,
        status="published",
        display_order=0,
    )
    db.session.add(existing_home)
    db.session.flush()

    monkeypatch.setattr(public_page_api, "_can_embed_charts", lambda: False)
    monkeypatch.setattr(api, "_validate_theme_reference", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_validate_template_reference", lambda *_args, **_kwargs: None)
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
    monkeypatch.setattr(api, "_validate_asset_reference", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_validate_block_references", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_upsert_blocks", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_clear_legacy_sections", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_snapshot_page_revision", lambda *_args, **_kwargs: None)

    page = api._upsert_page(
        {
            "title": "Insights",
            "slug": "insights",
            "visibility": "public",
            "is_published": True,
            "is_homepage": True,
            "status": "published",
            "settings": {},
            "blocks": [],
            "sections": [],
        }
    )

    db.session.refresh(existing_home)

    assert page.is_homepage is True
    assert existing_home.is_homepage is False


def test_upsert_page_clears_landing_page_flag_for_non_active_pages(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    monkeypatch.setattr(public_page_api, "_can_embed_charts", lambda: False)
    monkeypatch.setattr(api, "_validate_theme_reference", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_validate_template_reference", lambda *_args, **_kwargs: None)
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
    monkeypatch.setattr(api, "_validate_asset_reference", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_validate_block_references", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_upsert_blocks", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_clear_legacy_sections", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_snapshot_page_revision", lambda *_args, **_kwargs: None)

    page = api._upsert_page(
        {
            "title": "Draft landing candidate",
            "slug": "draft-landing-candidate",
            "visibility": "public",
            "is_published": False,
            "is_homepage": True,
            "status": "draft",
            "settings": {},
            "blocks": [],
            "sections": [],
        }
    )

    assert page.is_homepage is False
    assert page.status == "draft"


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


def test_page_breadcrumbs_use_canonical_path_for_homepage(app_context: None) -> None:
    api = PublicPageRestApi()
    homepage = Page(
        id=1,
        slug="welcome",
        title="Welcome",
        visibility="public",
        is_published=True,
        is_homepage=True,
        status="published",
    )
    team = Page(
        id=2,
        slug="team",
        title="Team",
        parent_page=homepage,
        visibility="public",
        is_published=True,
        status="published",
    )

    breadcrumbs = api._page_breadcrumbs(team, public_context=True)

    assert api._public_page_url(homepage) == "/superset/public/welcome/"
    assert breadcrumbs[0]["path"] == "/superset/public/welcome/"
    assert breadcrumbs[1]["path"] == "/superset/public/welcome/team/"


def test_serialize_navigation_item_uses_canonical_path_for_homepage(
    app_context: None,
) -> None:
    api = PublicPageRestApi()
    homepage = Page(
        id=4,
        slug="welcome",
        title="Welcome",
        visibility="public",
        is_published=True,
        is_homepage=True,
        status="published",
    )
    item = NavigationItem(
        id=9,
        label="Welcome",
        item_type="page",
        visibility="public",
        is_visible=True,
        page=homepage,
    )

    serialized = api._serialize_navigation_item(
        item,
        pages=[homepage],
        dashboards=[],
        public_context=True,
    )

    assert serialized is not None
    assert serialized["path"] == "/superset/public/welcome/"


def test_serialize_navigation_expands_page_collection_into_page_hierarchy(
    app_context: None,
) -> None:
    api = PublicPageRestApi()
    homepage = Page(
        id=1,
        slug="welcome",
        title="Welcome",
        visibility="public",
        is_published=True,
        is_homepage=True,
        status="published",
        display_order=0,
    )
    dashboards_page = Page(
        id=2,
        slug="dashboards",
        title="Dashboards",
        visibility="public",
        is_published=True,
        is_homepage=False,
        status="published",
        display_order=1,
    )
    about_page = Page(
        id=3,
        slug="about",
        title="About",
        visibility="public",
        is_published=True,
        is_homepage=False,
        status="published",
        display_order=2,
    )
    team_page = Page(
        id=4,
        slug="team",
        title="Team",
        parent_page=about_page,
        visibility="public",
        is_published=True,
        is_homepage=False,
        status="published",
        display_order=0,
    )
    reports_page = Page(
        id=5,
        slug="reports",
        title="Reports",
        visibility="public",
        is_published=True,
        is_homepage=False,
        status="published",
        display_order=3,
    )
    header_menu = NavigationMenu(
        id=1,
        slug="public-header",
        title="Header",
        location="header",
        visibility="public",
        display_order=0,
        is_enabled=True,
    )
    NavigationItem(
        id=11,
        menu=header_menu,
        label="Home",
        item_type="page",
        page=homepage,
        visibility="public",
        display_order=0,
        is_visible=True,
    )
    NavigationItem(
        id=12,
        menu=header_menu,
        label="Dashboards",
        item_type="page",
        page=dashboards_page,
        visibility="public",
        display_order=1,
        is_visible=True,
    )
    NavigationItem(
        id=13,
        menu=header_menu,
        label="Pages",
        item_type="page_collection",
        visibility="public",
        display_order=2,
        is_visible=True,
    )

    serialized = api._serialize_navigation(
        [header_menu],
        [homepage, dashboards_page, about_page, team_page, reports_page],
        [],
        public_context=True,
    )

    items = serialized["header"][0]["items"]
    assert [item["label"] for item in items] == [
        "Home",
        "Dashboards",
        "About",
        "Reports",
    ]
    assert items[2]["path"] == "/superset/public/about/"
    assert items[2]["children"] == [
        {
            "id": "page-4",
            "label": "Team",
            "path": "/superset/public/about/team/",
            "item_type": "page",
            "page_id": 4,
            "description": None,
            "children": [],
        }
    ]


def test_serialize_navigation_page_collection_skips_explicit_page_items(
    app_context: None,
) -> None:
    api = PublicPageRestApi()
    homepage = Page(
        id=1,
        slug="welcome",
        title="Welcome",
        visibility="public",
        is_published=True,
        is_homepage=True,
        status="published",
    )
    dashboards_page = Page(
        id=2,
        slug="dashboards",
        title="Dashboards",
        visibility="public",
        is_published=True,
        is_homepage=False,
        status="published",
    )
    about_page = Page(
        id=3,
        slug="about",
        title="About",
        visibility="public",
        is_published=True,
        is_homepage=False,
        status="published",
    )
    header_menu = NavigationMenu(
        id=1,
        slug="public-header",
        title="Header",
        location="header",
        visibility="public",
        display_order=0,
        is_enabled=True,
    )
    NavigationItem(
        id=11,
        menu=header_menu,
        label="Home",
        item_type="page",
        page=homepage,
        visibility="public",
        display_order=0,
        is_visible=True,
    )
    NavigationItem(
        id=12,
        menu=header_menu,
        label="Dashboards",
        item_type="page",
        page=dashboards_page,
        visibility="public",
        display_order=1,
        is_visible=True,
    )
    NavigationItem(
        id=13,
        menu=header_menu,
        label="About",
        item_type="page",
        page=about_page,
        visibility="public",
        display_order=2,
        is_visible=True,
    )
    NavigationItem(
        id=14,
        menu=header_menu,
        label="Pages",
        item_type="page_collection",
        visibility="public",
        display_order=3,
        is_visible=True,
    )

    serialized = api._serialize_navigation(
        [header_menu],
        [homepage, dashboards_page, about_page],
        [],
        public_context=True,
    )

    assert [item["label"] for item in serialized["header"][0]["items"]] == [
        "Home",
        "Dashboards",
        "About",
    ]


def test_serialize_navigation_promotes_top_level_page_types(
    app_context: None,
) -> None:
    api = PublicPageRestApi()
    homepage = Page(
        id=1,
        slug="welcome",
        title="Welcome",
        visibility="public",
        is_published=True,
        is_homepage=True,
        status="published",
        display_order=0,
    )
    dashboards_page = Page(
        id=2,
        slug="dashboards",
        title="Dashboards",
        visibility="public",
        is_published=True,
        status="published",
        display_order=1,
    )
    about_page = Page(
        id=3,
        slug="about",
        title="About",
        visibility="public",
        is_published=True,
        status="published",
        page_type="content",
        display_order=3,
    )
    faq_page = Page(
        id=4,
        slug="faq",
        title="FAQ",
        parent_page=about_page,
        visibility="public",
        is_published=True,
        status="published",
        page_type="faq",
        display_order=2,
    )
    guidance_page = Page(
        id=5,
        slug="guidance",
        title="Guidance",
        parent_page=faq_page,
        visibility="public",
        is_published=True,
        status="published",
        page_type="content",
        display_order=0,
    )
    header_menu = NavigationMenu(
        id=1,
        slug="public-header",
        title="Header",
        location="header",
        visibility="public",
        display_order=0,
        is_enabled=True,
    )
    NavigationItem(
        id=11,
        menu=header_menu,
        label="Home",
        item_type="page",
        page=homepage,
        visibility="public",
        display_order=0,
        is_visible=True,
    )
    NavigationItem(
        id=12,
        menu=header_menu,
        label="Dashboards",
        item_type="page",
        page=dashboards_page,
        visibility="public",
        display_order=1,
        is_visible=True,
    )
    NavigationItem(
        id=13,
        menu=header_menu,
        label="Pages",
        item_type="page_collection",
        visibility="public",
        display_order=2,
        is_visible=True,
    )

    serialized = api._serialize_navigation(
        [header_menu],
        [homepage, dashboards_page, about_page, faq_page, guidance_page],
        [],
        public_context=True,
    )

    items = serialized["header"][0]["items"]
    assert [item["label"] for item in items] == [
        "Home",
        "Dashboards",
        "FAQ",
        "About",
    ]
    assert items[2]["path"] == "/superset/public/about/faq/"
    assert items[2]["children"] == [
        {
            "id": "page-5",
            "label": "Guidance",
            "path": "/superset/public/about/faq/guidance/",
            "item_type": "page",
            "page_id": 5,
            "description": None,
            "children": [],
        }
    ]


def test_ensure_homepage_exists_promotes_first_public_page(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    first_page = Page(
        id=11,
        slug="insights",
        title="Insights",
        visibility="public",
        is_published=True,
        status="published",
        is_homepage=False,
        display_order=0,
    )
    second_page = Page(
        id=12,
        slug="about",
        title="About",
        visibility="public",
        is_published=True,
        status="published",
        is_homepage=False,
        display_order=1,
    )
    pages = [first_page, second_page]

    class QueryStub:
        def filter(self, *args, **kwargs):
            del args, kwargs
            return self

        def update(self, values, synchronize_session=False):
            del synchronize_session
            for page in pages:
                page.is_homepage = values.get("is_homepage", page.is_homepage)

    monkeypatch.setattr(api, "_list_pages", lambda admin=False: pages)
    monkeypatch.setattr(db.session, "query", lambda model: QueryStub())
    monkeypatch.setattr(db.session, "flush", lambda: None)

    target_page = api._ensure_homepage_exists()

    assert target_page is first_page
    assert first_page.is_homepage is True
    assert second_page.is_homepage is False


def test_ensure_homepage_exists_collapses_multiple_active_homepages(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    first_page = Page(
        id=11,
        slug="insights",
        title="Insights",
        visibility="public",
        is_published=True,
        status="published",
        is_homepage=True,
        display_order=1,
    )
    second_page = Page(
        id=12,
        slug="about",
        title="About",
        visibility="public",
        is_published=True,
        status="published",
        is_homepage=True,
        display_order=0,
    )
    pages = [first_page, second_page]

    class QueryStub:
        def filter(self, *args, **kwargs):
            del args, kwargs
            return self

        def update(self, values, synchronize_session=False):
            del synchronize_session
            for page in pages:
                page.is_homepage = values.get("is_homepage", page.is_homepage)

    monkeypatch.setattr(api, "_list_pages", lambda admin=False: pages)
    monkeypatch.setattr(db.session, "query", lambda model: QueryStub())
    monkeypatch.setattr(db.session, "flush", lambda: None)

    target_page = api._ensure_homepage_exists()

    assert target_page is second_page
    assert second_page.is_homepage is True
    assert first_page.is_homepage is False


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


def test_seed_default_portal_creates_balanced_welcome_page_blocks(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    monkeypatch.setattr(api, "_get_or_create_layout_config", lambda: None)
    monkeypatch.setattr(
        api,
        "_list_public_serving_charts",
        lambda: [
            Slice(
                id=7,
                slice_name="Regional malaria burden trend",
                description="Trend across the latest reporting periods.",
            ),
            Slice(
                id=8,
                slice_name="District reporting completeness",
                description="Published completeness snapshot.",
            ),
        ],
    )
    monkeypatch.setattr(
        api,
        "_list_public_dashboards",
        lambda: [
            Dashboard(
                id=31,
                dashboard_title="National overview",
                slug="national-overview",
            )
        ],
    )

    api._seed_default_portal()

    welcome_page = db.session.query(Page).filter(Page.slug == "welcome").one()
    root_blocks = [
        block for block in welcome_page.blocks if block.parent_block_id is None
    ]
    hero_block = next(block for block in root_blocks if block.block_type == "hero")

    assert welcome_page.subtitle == DEFAULT_WELCOME_PAGE_SUBTITLE
    assert welcome_page.description == DEFAULT_WELCOME_PAGE_DESCRIPTION
    assert (
        welcome_page.get_settings()["defaultWelcomeSeedVersion"]
        == DEFAULT_WELCOME_PAGE_SEED_VERSION
    )
    assert hero_block.get_content()["title"] == "Welcome to a trusted public analytics workspace"
    assert any(
        block.block_type == "dynamic_widget"
        and block.get_settings().get("widgetType") == "indicator_highlights"
        for block in root_blocks
    )
    assert any(
        block.block_type == "dynamic_widget"
        and block.get_settings().get("widgetType") == "dashboard_list"
        for block in root_blocks
    )
    assert {
        block.get_settings().get("chart_ref", {}).get("id")
        for block in welcome_page.blocks
        if block.block_type == "chart"
    } == {7, 8}
    assert welcome_page.sections == []


def test_seed_default_portal_refreshes_legacy_welcome_page(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    monkeypatch.setattr(api, "_get_or_create_layout_config", lambda: None)
    monkeypatch.setattr(api, "_list_public_serving_charts", lambda: [])
    monkeypatch.setattr(api, "_list_public_dashboards", lambda: [])

    welcome_page = db.session.query(Page).filter(Page.slug == "welcome").one_or_none()
    if welcome_page is None:
        welcome_page = Page(slug="welcome", title="Welcome")
        db.session.add(welcome_page)
    for block in list(welcome_page.blocks):
        db.session.delete(block)
    for section in list(welcome_page.sections):
        db.session.delete(section)
    welcome_page.subtitle = LEGACY_WELCOME_PAGE_SUBTITLE
    welcome_page.description = LEGACY_WELCOME_PAGE_DESCRIPTION
    welcome_page.excerpt = None
    welcome_page.seo_title = None
    welcome_page.seo_description = None
    welcome_page.status = "published"
    welcome_page.is_published = True
    welcome_page.is_homepage = True
    welcome_page.display_order = 0
    welcome_page.set_settings(
        {
            "heroCtaLabel": "Browse dashboards",
            "heroCtaTarget": DEFAULT_WELCOME_PAGE_CTA_TARGET,
        }
    )
    db.session.flush()

    hero_section = PageSection(
        page=welcome_page,
        section_key="hero",
        title="Towards malaria elimination in Uganda",
        subtitle=(
            "Serving-table powered public analytics for surveillance, programme "
            "performance, and transparent reporting."
        ),
        section_type="hero",
        display_order=0,
        is_visible=True,
    )
    hero_section.set_settings({"columns": 1})
    highlights_section = PageSection(
        page=welcome_page,
        section_key="highlights",
        title="Latest Indicator Highlights",
        subtitle="Derived from the most recent staged DHIS2 observations.",
        section_type="kpi_band",
        display_order=1,
        is_visible=True,
    )
    db.session.add_all([hero_section, highlights_section])
    db.session.flush()

    hero_component = PageComponent(
        section=hero_section,
        component_key="welcome-intro",
        component_type="markdown",
        title="Portal Overview",
        body="Legacy portal overview.",
        display_order=0,
        is_visible=True,
    )
    hero_component.set_settings({})
    highlights_component = PageComponent(
        section=highlights_section,
        component_key="indicator-highlights",
        component_type="indicator_highlights",
        title="Indicator Highlights",
        display_order=0,
        is_visible=True,
    )
    highlights_component.set_settings({"limit": 6})
    db.session.add_all([hero_component, highlights_component])
    db.session.flush()
    db.session.expire(welcome_page, ["blocks", "sections"])

    api._seed_default_portal()

    refreshed_page = db.session.query(Page).filter(Page.slug == "welcome").one()
    hero_block = next(
        block
        for block in refreshed_page.blocks
        if block.parent_block_id is None and block.block_type == "hero"
    )

    assert refreshed_page.subtitle == DEFAULT_WELCOME_PAGE_SUBTITLE
    assert refreshed_page.description == DEFAULT_WELCOME_PAGE_DESCRIPTION
    assert refreshed_page.sections == []
    assert (
        refreshed_page.get_settings()["defaultWelcomeSeedVersion"]
        == DEFAULT_WELCOME_PAGE_SEED_VERSION
    )
    assert hero_block.get_content()["title"] == "Welcome to a trusted public analytics workspace"


def test_seed_default_portal_preserves_custom_welcome_page(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    monkeypatch.setattr(api, "_get_or_create_layout_config", lambda: None)
    monkeypatch.setattr(api, "_list_public_serving_charts", lambda: [])
    monkeypatch.setattr(api, "_list_public_dashboards", lambda: [])

    welcome_page = db.session.query(Page).filter(Page.slug == "welcome").one_or_none()
    if welcome_page is None:
        welcome_page = Page(slug="welcome", title="Welcome")
        db.session.add(welcome_page)
    for block in list(welcome_page.blocks):
        db.session.delete(block)
    for section in list(welcome_page.sections):
        db.session.delete(section)
    welcome_page.subtitle = "Custom landing subtitle"
    welcome_page.description = "Custom landing description."
    welcome_page.excerpt = None
    welcome_page.seo_title = None
    welcome_page.seo_description = None
    welcome_page.status = "published"
    welcome_page.is_published = True
    welcome_page.is_homepage = True
    welcome_page.display_order = 0
    welcome_page.set_settings(
        {
            "heroCtaLabel": "Open reports",
            "heroCtaTarget": "/superset/public/reports/",
        }
    )
    db.session.flush()

    block = PageBlock(
        page=welcome_page,
        uid="custom_welcome_block",
        block_type="paragraph",
        slot="content",
        sort_order=0,
        tree_path="0000",
        depth=0,
        is_container=False,
        visibility="public",
        status="active",
        schema_version=1,
    )
    block.set_content({"body": "Custom public welcome copy."})
    block.set_settings({})
    block.set_styles({})
    block.set_metadata({"label": "Paragraph"})
    db.session.add(block)
    db.session.flush()
    db.session.expire(welcome_page, ["blocks", "sections"])

    api._seed_default_portal()

    refreshed_page = db.session.query(Page).filter(Page.slug == "welcome").one()
    root_blocks = [
        candidate for candidate in refreshed_page.blocks if candidate.parent_block_id is None
    ]

    assert refreshed_page.subtitle == "Custom landing subtitle"
    assert refreshed_page.description == "Custom landing description."
    assert refreshed_page.get_settings().get("defaultWelcomeSeedVersion") is None
    assert len(root_blocks) == 1
    assert root_blocks[0].block_type == "paragraph"
    assert root_blocks[0].get_content()["body"] == "Custom public welcome copy."


def test_seed_default_portal_restores_default_landing_and_about_pages(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    monkeypatch.setattr(api, "_get_or_create_layout_config", lambda: None)
    monkeypatch.setattr(api, "_list_public_serving_charts", lambda: [])
    monkeypatch.setattr(api, "_list_public_dashboards", lambda: [])

    welcome_page = db.session.query(Page).filter(Page.slug == "welcome").one_or_none()
    if welcome_page is None:
        welcome_page = Page(slug="welcome", title="Welcome")
        db.session.add(welcome_page)
    welcome_page.visibility = "public"
    welcome_page.status = "draft"
    welcome_page.is_published = False
    welcome_page.is_homepage = False
    welcome_page.display_order = 0
    welcome_page.subtitle = None
    welcome_page.description = None
    welcome_page.excerpt = None
    welcome_page.navigation_label = None
    welcome_page.seo_title = None
    welcome_page.seo_description = None
    welcome_page.og_image_url = None
    welcome_page.featured_image_url = None
    welcome_page.archived_on = None
    welcome_page.set_settings({})
    for block in list(welcome_page.blocks):
        db.session.delete(block)
    for section in list(welcome_page.sections):
        db.session.delete(section)

    dashboards_page = (
        db.session.query(Page).filter(Page.slug == "dashboards").one_or_none()
    )
    if dashboards_page is None:
        dashboards_page = Page(slug="dashboards", title="Dashboards")
        db.session.add(dashboards_page)
    dashboards_page.visibility = "public"
    dashboards_page.status = "published"
    dashboards_page.is_published = True
    dashboards_page.is_homepage = True
    dashboards_page.display_order = 1
    dashboards_page.subtitle = None
    dashboards_page.description = None
    dashboards_page.excerpt = None
    dashboards_page.navigation_label = None
    dashboards_page.seo_title = None
    dashboards_page.seo_description = None
    dashboards_page.og_image_url = None
    dashboards_page.featured_image_url = None
    dashboards_page.archived_on = None
    dashboards_page.set_settings({})
    for block in list(dashboards_page.blocks):
        db.session.delete(block)
    for section in list(dashboards_page.sections):
        db.session.delete(section)

    about_page = db.session.query(Page).filter(Page.slug == "about").one_or_none()
    if about_page is None:
        about_page = Page(slug="about", title="About")
        db.session.add(about_page)
    about_page.visibility = "public"
    about_page.status = "draft"
    about_page.is_published = False
    about_page.is_homepage = False
    about_page.display_order = 2
    about_page.subtitle = None
    about_page.description = None
    about_page.excerpt = None
    about_page.navigation_label = None
    about_page.seo_title = None
    about_page.seo_description = None
    about_page.og_image_url = None
    about_page.featured_image_url = None
    about_page.archived_on = None
    about_page.set_settings({})
    for block in list(about_page.blocks):
        db.session.delete(block)
    for section in list(about_page.sections):
        db.session.delete(section)

    db.session.flush()

    api._seed_default_portal()

    refreshed_welcome = db.session.query(Page).filter(Page.slug == "welcome").one()
    refreshed_dashboards = db.session.query(Page).filter(Page.slug == "dashboards").one()
    refreshed_about = db.session.query(Page).filter(Page.slug == "about").one()
    header_menu = (
        db.session.query(NavigationMenu)
        .filter(NavigationMenu.slug == "public-header")
        .one()
    )
    welcome_item = next(
        item
        for item in header_menu.items
        if item.parent_id is None and item.page == refreshed_welcome
    )

    assert refreshed_welcome.status == "published"
    assert refreshed_welcome.is_published is True
    assert refreshed_welcome.is_homepage is True
    assert refreshed_about.status == "published"
    assert refreshed_about.is_published is True
    assert refreshed_dashboards.is_homepage is False
    assert welcome_item.label == "Home"


def test_seed_default_portal_preserves_unpublished_authored_system_pages(
    app_context: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = PublicPageRestApi()
    monkeypatch.setattr(api, "_get_or_create_layout_config", lambda: None)
    monkeypatch.setattr(api, "_list_public_serving_charts", lambda: [])
    monkeypatch.setattr(api, "_list_public_dashboards", lambda: [])

    welcome_page = db.session.query(Page).filter(Page.slug == "welcome").one_or_none()
    if welcome_page is None:
        welcome_page = Page(slug="welcome", title="Welcome")
        db.session.add(welcome_page)
    welcome_page.visibility = "public"
    welcome_page.status = "draft"
    welcome_page.is_published = False
    welcome_page.is_homepage = False
    welcome_page.display_order = 0
    welcome_page.subtitle = "Custom hidden landing page"
    welcome_page.description = "Do not republish this page automatically."
    welcome_page.archived_on = None
    welcome_page.set_settings({"defaultWelcomeSeedVersion": 99})

    dashboards_page = (
        db.session.query(Page).filter(Page.slug == "dashboards").one_or_none()
    )
    if dashboards_page is None:
        dashboards_page = Page(slug="dashboards", title="Dashboards")
        db.session.add(dashboards_page)
    dashboards_page.visibility = "public"
    dashboards_page.status = "draft"
    dashboards_page.is_published = False
    dashboards_page.is_homepage = False
    dashboards_page.display_order = 1
    dashboards_page.subtitle = "Custom hidden dashboards page"
    dashboards_page.description = "Keep this unpublished until review is complete."
    dashboards_page.archived_on = None
    dashboards_page.set_settings({"menuMode": "manual"})

    about_page = db.session.query(Page).filter(Page.slug == "about").one_or_none()
    if about_page is None:
        about_page = Page(slug="about", title="About")
        db.session.add(about_page)
    about_page.visibility = "public"
    about_page.status = "draft"
    about_page.is_published = False
    about_page.is_homepage = False
    about_page.display_order = 2
    about_page.subtitle = "Custom hidden about page"
    about_page.description = "Remain unpublished."
    about_page.archived_on = None
    about_page.set_settings({"audience": "internal"})

    db.session.flush()

    api._seed_default_portal()

    refreshed_welcome = db.session.query(Page).filter(Page.slug == "welcome").one()
    refreshed_dashboards = db.session.query(Page).filter(Page.slug == "dashboards").one()
    refreshed_about = db.session.query(Page).filter(Page.slug == "about").one()

    assert refreshed_welcome.is_published is False
    assert refreshed_welcome.status == "draft"
    assert refreshed_dashboards.is_published is False
    assert refreshed_dashboards.status == "draft"
    assert refreshed_about.is_published is False
    assert refreshed_about.status == "draft"
