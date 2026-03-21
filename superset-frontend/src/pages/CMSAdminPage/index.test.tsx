/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import fetchMock from 'fetch-mock';
import { render, screen } from 'spec/helpers/testing-library';
import CMSAdminPage from '.';

jest.mock(
  'src/pages/PublicLandingPage/PublicDashboardEmbed',
  () =>
    function MockPublicDashboardEmbed() {
      return <div data-testid="public-dashboard-embed" />;
    },
);

jest.mock('src/utils/getBootstrapData', () => ({
  __esModule: true,
  default: () => ({
    common: {
      feature_flags: {},
      conf: {
        AUTH_USER_REGISTRATION: false,
      },
    },
    user: {
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      isAnonymous: false,
      username: 'admin',
      permissions: {},
      userId: 1,
      roles: {
        Admin: [['cms.pages.view', 'CMS']],
      },
    },
  }),
  applicationRoot: () => '',
}));

jest.mock('src/dashboard/util/permissionUtils', () => ({
  userHasPermission: jest.fn(() => true),
}));

const adminPayload = {
  config: {
    navbar: {
      title: { text: 'Portal' },
    },
  },
  portal_layout: {
    id: 1,
    scope: 'public_portal',
    title: 'Public Portal',
    config: {
      portalTitle: 'Uganda Malaria Analytics Portal',
      portalSubtitle: 'Serving tables only.',
      welcomeBadge: 'MOH',
      accentColor: '#0f766e',
      secondaryColor: '#1d4ed8',
      surfaceColor: '#ffffff',
      pageMaxWidth: 1280,
      showThemeToggle: true,
    },
  },
  stats: {
    total_pages: 3,
    published_pages: 2,
    draft_pages: 1,
    private_pages: 0,
    menus: 2,
    chart_enabled_pages: 1,
    themes: 1,
    templates: 1,
    style_bundles: 1,
  },
  pages: [
    {
      id: 1,
      slug: 'welcome',
      title: 'Welcome',
      subtitle: 'Overview',
      description: 'Portal welcome page',
      excerpt: 'Welcome',
      is_published: true,
      is_homepage: true,
      display_order: 0,
      status: 'published',
      visibility: 'public',
      theme_id: 1,
      template_id: 1,
      style_bundle_id: 1,
      settings: {},
    },
  ],
  current_page: {
    id: 1,
    slug: 'welcome',
    title: 'Welcome',
    subtitle: 'Overview',
    description: 'Portal welcome page',
    excerpt: 'Welcome',
    is_published: true,
    is_homepage: true,
    display_order: 0,
    status: 'published',
    visibility: 'public',
    page_type: 'content',
    template_key: 'default',
    theme_id: 1,
    template_id: 1,
    style_bundle_id: 1,
    settings: {},
    sections: [],
  },
  menus: {
    header: [],
    footer: [],
  },
  dashboards: [],
  available_charts: [],
  themes: [
    {
      id: 1,
      slug: 'default-theme',
      title: 'Default Theme',
      status: 'active',
      is_active: true,
      is_default: true,
      tokens: {},
      settings: {},
    },
  ],
  templates: [
    {
      id: 1,
      slug: 'default-template',
      title: 'Default Template',
      status: 'active',
      is_active: true,
      is_default: true,
      theme_id: 1,
      style_bundle_id: 1,
      structure: {},
      settings: {},
    },
  ],
  style_bundles: [
    {
      id: 1,
      slug: 'portal-foundation',
      title: 'Portal Foundation',
      status: 'active',
      is_active: true,
      variables: {},
      settings: {},
      css_text: '',
    },
  ],
  permissions: {
    can_view_pages: true,
    can_create_pages: true,
    can_edit_pages: true,
    can_delete_pages: true,
    can_publish_pages: true,
    can_manage_menus: true,
    can_embed_charts: true,
    can_manage_layout: true,
    can_manage_themes: true,
    can_manage_templates: true,
    can_manage_styles: true,
  },
  recent_edits: [],
  recently_published_pages: [],
  revisions: [],
};

beforeEach(() => {
  fetchMock.restore();
  fetchMock.get('glob:*/api/v1/public_page/admin/bootstrap*', {
    result: adminPayload,
  });
  window.history.pushState({}, '', '/superset/cms/?tab=studio&page=welcome');
});

afterEach(() => {
  fetchMock.restore();
});

test('renders the authenticated CMS studio shell', async () => {
  render(<CMSAdminPage />, {
    useRouter: true,
    useTheme: true,
  });

  expect(await screen.findByText('CMS Pages')).toBeInTheDocument();
  expect(screen.getByText('Portal Administration')).toBeInTheDocument();
  expect(screen.getByText('Canvas Preview')).toBeInTheDocument();
  expect(screen.getByText('Themes')).toBeInTheDocument();
  expect(screen.getAllByDisplayValue('Welcome').length).toBeGreaterThan(0);
});
