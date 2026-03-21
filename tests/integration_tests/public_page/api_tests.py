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
from __future__ import annotations

from superset import db, security_manager
from superset.public_page.models import Page, PageRevision
from tests.integration_tests.base_tests import SupersetTestCase


class TestPublicPageApi(SupersetTestCase):
    def setUp(self) -> None:
        super().setUp()
        for permission_name in (
            "cms.pages.view",
            "cms.pages.create",
            "cms.pages.edit",
            "cms.pages.delete",
            "cms.pages.publish",
            "cms.menus.manage",
            "cms.charts.embed",
            "cms.layout.manage",
        ):
            security_manager.add_permission_view_menu(permission_name, "CMS")
        db.session.commit()

    def _create_page(
        self,
        slug: str,
        *,
        title: str,
        visibility: str = "public",
        is_published: bool = True,
        status: str = "published",
    ) -> Page:
        page = Page(
            slug=slug,
            title=title,
            subtitle="Portal page",
            description="Portal page description",
            visibility=visibility,
            is_published=is_published,
            status=status,
            is_homepage=False,
            display_order=0,
        )
        db.session.add(page)
        db.session.commit()
        return page

    def test_public_pages_hide_private_pages(self) -> None:
        public_page = self._create_page("public-page-api-test", title="Public")
        self._create_page(
            "private-page-api-test",
            title="Private",
            visibility="authenticated",
            is_published=False,
            status="draft",
        )

        response = self.client.get("/api/v1/public_page/pages")
        assert response.status_code == 200
        slugs = [page["slug"] for page in response.json["result"]]
        assert public_page.slug in slugs
        assert "private-page-api-test" not in slugs

        private_response = self.client.get(
            "/api/v1/public_page/portal?slug=private-page-api-test"
        )
        assert private_response.status_code == 404

    def test_admin_bootstrap_requires_cms_permission(self) -> None:
        with self.temporary_user(login=True) as _:
            response = self.client.get("/api/v1/public_page/admin/bootstrap")
            assert response.status_code == 403

    def test_admin_page_save_creates_revision(self) -> None:
        with self.temporary_user(
            login=True,
            extra_pvms=[
                ("cms.pages.view", "CMS"),
                ("cms.pages.create", "CMS"),
                ("cms.pages.edit", "CMS"),
            ],
        ) as _:
            response = self.client.post(
                "/api/v1/public_page/admin/pages",
                json={
                    "title": "Integrated CMS Save",
                    "slug": "integrated-cms-save",
                    "subtitle": "CMS test page",
                    "description": "Saved from integration tests.",
                    "visibility": "draft",
                    "status": "draft",
                    "is_published": False,
                    "is_homepage": False,
                    "display_order": 0,
                    "settings": {},
                    "sections": [],
                },
            )
            assert response.status_code == 200
            page_id = response.json["result"]["id"]
            revisions = (
                db.session.query(PageRevision)
                .filter(PageRevision.page_id == page_id)
                .all()
            )
            assert len(revisions) == 1
            assert revisions[0].action == "saved"
