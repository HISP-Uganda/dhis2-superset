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
import {
  render,
  screen,
  userEvent,
  waitFor,
} from 'spec/helpers/testing-library';
import CMSAdminPage from '.';

jest.mock(
  'src/pages/PublicLandingPage/PublicDashboardEmbed',
  () =>
    function MockPublicDashboardEmbed() {
      return <div data-testid="public-dashboard-embed" />;
    },
);

jest.mock('src/pages/PublicLandingPage/BlockRenderer', () => ({
  __esModule: true,
  RenderBlockTree: ({
    blocks,
  }: {
    blocks: Array<{ content?: { title?: string } }>;
  }) => (
    <div data-testid="mock-block-tree">
      {blocks.length
        ? blocks.map((block, index) => (
            <div key={`${block.content?.title || 'block'}-${index}`}>
              {block.content?.title || 'Add content here.'}
            </div>
          ))
        : 'No block preview'}
    </div>
  ),
  groupBlocksBySlot: (blocks: Array<Record<string, any>>) =>
    blocks.reduce(
      (acc, block) => {
        const slot = block.slot || 'content';
        acc[slot] = [...(acc[slot] || []), block];
        return acc;
      },
      {
        header: [],
        hero: [],
        content: [],
        sidebar: [],
        cta: [],
        footer: [],
      } as Record<string, Array<Record<string, any>>>,
    ),
}));

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

function buildAdminPayload(isPublished = true) {
  return {
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
        lightModeLabel: 'Light mode',
        darkModeLabel: 'Dark mode',
        loginButtonText: 'Login',
        loginButtonUrl: '/login/',
        footerText: 'Uganda Malaria Analytics Portal · Ministry of Health',
        emptyPageMessage: 'This page does not have any visible blocks yet.',
        noPublicPageMessage: 'No public page is available.',
        dashboardBadgeLabel: 'Public Dashboard',
        dashboardEmbedSubtitle:
          'Viewing this dashboard inside the public portal keeps navigation, context, and access controls in one place.',
        dashboardEmbedIntro:
          'This embedded view is tuned for public presentation with tighter chrome, balanced spacing, and the portal frame still available around it.',
        dashboardBackLabel: 'Back to page',
        dashboardLoadingLabel: 'Loading dashboard...',
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
      media_assets: 1,
    },
    pages: [
      {
        id: 1,
        slug: 'welcome',
        path: 'about/welcome',
        title: 'Welcome',
        subtitle: 'Overview',
        description: 'Portal welcome page',
        excerpt: 'Welcome',
        is_published: isPublished,
        is_homepage: true,
        display_order: 0,
        parent_page_id: null,
        navigation_label: 'Welcome',
        status: isPublished ? 'published' : 'draft',
        visibility: isPublished ? 'public' : 'draft',
        theme_id: 1,
        template_id: 1,
        style_bundle_id: 1,
        featured_image_asset_id: null,
        og_image_asset_id: null,
        settings: {},
      },
    ],
    current_page: {
      id: 1,
      slug: 'welcome',
      path: 'about/welcome',
      title: 'Welcome',
      subtitle: 'Overview',
      description: 'Portal welcome page',
      excerpt: 'Welcome',
      is_published: isPublished,
      is_homepage: true,
      display_order: 0,
      parent_page_id: null,
      navigation_label: 'Welcome',
      status: isPublished ? 'published' : 'draft',
      visibility: isPublished ? 'public' : 'draft',
      page_type: 'content',
      template_key: 'default',
      theme_id: 1,
      template_id: 1,
      style_bundle_id: 1,
      featured_image_asset_id: null,
      og_image_asset_id: null,
      settings: {},
      blocks: [],
      sections: [],
    },
    menus: {
      header: [],
      footer: [],
    },
    dashboards: [],
    available_charts: [],
    media_assets: [
      {
        id: 7,
        slug: 'policy-brief',
        title: 'Policy Brief',
        asset_type: 'file',
        visibility: 'private',
        is_public: false,
        status: 'active',
        settings: {},
        download_url: '/api/v1/public_page/assets/7/download',
      },
    ],
    block_types: [],
    reusable_blocks: [],
    starter_patterns: [],
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
      can_manage_media: true,
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
}

let bootstrapPayload = buildAdminPayload(true);

beforeEach(() => {
  fetchMock.restore();
  bootstrapPayload = buildAdminPayload(true);
  fetchMock.get('glob:*/api/v1/public_page/admin/bootstrap*', () => ({
    result: bootstrapPayload,
  }));
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
  expect(
    screen.getByRole('heading', { name: 'Page content' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Document' })).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Page Options' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Compose' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
  expect(screen.getByText('Media Library')).toBeInTheDocument();
  expect(screen.getByText('Themes')).toBeInTheDocument();
  expect(screen.getAllByDisplayValue('Welcome').length).toBeGreaterThan(0);
});

test('shows shared footer editing controls in the page studio inspector', async () => {
  render(<CMSAdminPage />, {
    useRouter: true,
    useTheme: true,
  });

  expect(
    await screen.findByDisplayValue(
      'Uganda Malaria Analytics Portal · Ministry of Health',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /Save Footer Settings/i }),
  ).toBeInTheDocument();
});

test('renders the pages manager with create and filter controls', async () => {
  window.history.pushState({}, '', '/superset/cms/?tab=pages');

  render(<CMSAdminPage />, {
    useRouter: true,
    useTheme: true,
  });

  expect((await screen.findAllByText('Pages')).length).toBeGreaterThan(0);
  expect(
    screen.getByPlaceholderText('Search title, slug, or path'),
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole('button', { name: /Create Page/i }).length,
  ).toBeGreaterThan(0);
  expect(screen.getAllByText('about/welcome').length).toBeGreaterThan(0);
});

test('disables in-canvas add content actions for published pages', async () => {
  render(<CMSAdminPage />, {
    useRouter: true,
    useTheme: true,
  });

  expect(
    await screen.findByRole('heading', { name: 'Page content' }),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText(
      'Published pages are read-only. Unpublish to edit content.',
    ).length,
  ).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '+ Add Content' })).toBeDisabled();
});

test('allows adding a block when editing an unpublished page', async () => {
  bootstrapPayload = buildAdminPayload(false);

  render(<CMSAdminPage />, {
    useRouter: true,
    useTheme: true,
  });

  expect(
    await screen.findByRole('heading', { name: 'Page content' }),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '+ Add Content' }));

  expect(await screen.findByText('Add content here.')).toBeInTheDocument();
});

test('surfaces backend validation details when page save fails', async () => {
  bootstrapPayload = buildAdminPayload(false);

  fetchMock.post('glob:*/api/v1/public_page/admin/pages', {
    status: 400,
    body: {
      message: "{'chart_ref': ['Chart must be marked public']}",
    },
  });

  render(<CMSAdminPage />, {
    useRouter: true,
    useTheme: true,
  });

  expect(
    await screen.findByRole('heading', { name: 'Page content' }),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Save Draft/i }));

  expect(
    await screen.findByText("{'chart_ref': ['Chart must be marked public']}"),
  ).toBeInTheDocument();
});

test('saves configurable portal copy from the CMS portal tab', async () => {
  window.history.pushState({}, '', '/superset/cms/?tab=portal');
  fetchMock.post('glob:*/api/v1/public_page/admin/layout', {
    result: {
      id: 1,
      scope: 'public_portal',
      title: 'Public Portal',
      config: {},
    },
  });

  render(<CMSAdminPage />, {
    useRouter: true,
    useTheme: true,
  });

  expect(
    await screen.findByDisplayValue('Uganda Malaria Analytics Portal'),
  ).toBeInTheDocument();

  const getFieldInput = (label: string) =>
    screen
      .getByText(label)
      .closest('div')
      ?.parentElement?.querySelector('input, textarea') as
      | HTMLInputElement
      | HTMLTextAreaElement;

  const loginButtonTextInput = getFieldInput('Login Button Text');
  const footerTextInput = getFieldInput('Footer Text');
  const dashboardBackLabelInput = getFieldInput('Dashboard Back Label');

  await userEvent.clear(loginButtonTextInput);
  await userEvent.type(loginButtonTextInput, 'Portal sign in');
  await userEvent.clear(footerTextInput);
  await userEvent.type(footerTextInput, 'Custom portal footer');
  await userEvent.clear(dashboardBackLabelInput);
  await userEvent.type(dashboardBackLabelInput, 'Return to directory');
  await userEvent.click(
    screen.getByRole('button', { name: /Save Portal Settings/i }),
  );

  await waitFor(() =>
    expect(fetchMock.called('glob:*/api/v1/public_page/admin/layout')).toBe(
      true,
    ),
  );

  const layoutCall =
    fetchMock.lastCall('glob:*/api/v1/public_page/admin/layout') || [];
  const requestOptions = layoutCall[1] as { body?: string } | undefined;
  const payload = JSON.parse(String(requestOptions?.body || '{}'));

  expect(payload.config.loginButtonText).toBe('Portal sign in');
  expect(payload.config.footerText).toBe('Custom portal footer');
  expect(payload.config.dashboardBackLabel).toBe('Return to directory');
});
