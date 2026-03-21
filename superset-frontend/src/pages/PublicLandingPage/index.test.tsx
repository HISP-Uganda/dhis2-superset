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
import { DEFAULT_PUBLIC_PAGE_CONFIG } from './config';
import type { PortalPayload } from './types';
import PublicLandingPage from '.';

const welcomePageBlocks = [
  {
    uid: 'hero-block',
    block_type: 'hero',
    slot: 'hero',
    sort_order: 0,
    is_container: true,
    content: {
      title: 'Towards malaria elimination in Uganda',
      subtitle: 'Serving-table powered public analytics.',
      body: 'Explore curated pages and public charts.',
    },
    settings: {},
    styles: {},
    metadata: { label: 'Hero' },
    children: [],
  },
  {
    uid: 'featured-group',
    block_type: 'group',
    slot: 'content',
    sort_order: 1,
    is_container: true,
    content: {
      title: 'Featured Analytics',
      subtitle: 'Public charts backed by serving datasets.',
    },
    settings: {},
    styles: {},
    metadata: { label: 'Group' },
    children: [
      {
        uid: 'coverage-chart',
        block_type: 'chart',
        slot: 'content',
        sort_order: 0,
        is_container: false,
        content: {
          title: 'Coverage Map',
          caption: 'Latest malaria coverage summary.',
        },
        settings: {
          chart_ref: { id: 7 },
          height: 240,
          show_header: true,
        },
        styles: {},
        metadata: { label: 'Chart' },
        chart: {
          id: 7,
          slice_name: 'Coverage Map',
          description: 'Serving chart',
          viz_type: 'dhis2_map',
          url: '/superset/explore/?slice_id=7&standalone=true',
          is_public: true,
          uses_serving_dataset: true,
        },
        children: [],
      },
    ],
  },
];

const dashboardDirectoryBlocks = [
  {
    uid: 'dashboard-directory',
    block_type: 'dynamic_widget',
    slot: 'content',
    sort_order: 0,
    is_container: false,
    content: {
      title: 'Public Dashboards',
      subtitle: 'Browse the published dashboard directory.',
    },
    settings: {
      widgetType: 'dashboard_list',
    },
    styles: {},
    metadata: { label: 'Dashboard Directory' },
    children: [],
  },
];

jest.mock(
  './PublicDashboardEmbed',
  () =>
    function MockPublicDashboardEmbed(props: {
      title: string;
      dashboardId: number | string;
      dashboardUuid?: string | null;
    }) {
      return (
        <div
          data-testid="public-dashboard-embed"
          data-dashboard-id={String(props.dashboardId)}
          data-dashboard-uuid={props.dashboardUuid || ''}
          aria-label={props.title}
        >
          {props.title}
        </div>
      );
    },
);

const portalPayload: PortalPayload = {
  config: DEFAULT_PUBLIC_PAGE_CONFIG,
  portal_layout: {
    id: 1,
    scope: 'public_portal',
    title: 'Public Portal',
    config: {
      portalTitle: 'Uganda Malaria Analytics Portal',
      portalSubtitle: 'Serving-table analytics for public access.',
      welcomeBadge: 'Ministry of Health',
      accentColor: '#0f766e',
      secondaryColor: '#1d4ed8',
      surfaceColor: '#ffffff',
      pageMaxWidth: '100%',
      showThemeToggle: true,
    },
  },
  navigation: {
    header: [
      {
        id: 1,
        slug: 'header',
        title: 'Header',
        location: 'header',
        display_order: 0,
        settings: {},
        items: [
          {
            id: 11,
            label: 'Welcome',
            item_type: 'page',
            path: '/superset/public/welcome/',
            page_id: 1,
          },
          {
            id: 12,
            label: 'Dashboards',
            item_type: 'page',
            path: '/superset/public/dashboards/',
            page_id: 2,
          },
        ],
      },
    ],
    footer: [
      {
        id: 2,
        slug: 'footer',
        title: 'Footer',
        location: 'footer',
        display_order: 0,
        settings: {},
        items: [
          {
            id: 21,
            label: 'Data Sources',
            item_type: 'external',
            path: '/superset/public/about/',
          },
        ],
      },
    ],
  },
  pages: [
    {
      id: 1,
      slug: 'welcome',
      title: 'Welcome',
      subtitle: 'Evidence-led malaria analytics',
      description: 'Welcome portal page',
      is_published: true,
      is_homepage: true,
      display_order: 0,
      settings: {
        heroCtaLabel: 'Browse dashboards',
        heroCtaTarget: '/superset/public/dashboards/',
      },
    },
  ],
  current_page: {
    id: 1,
    slug: 'welcome',
    title: 'Welcome',
    subtitle: 'Evidence-led malaria analytics',
    description: 'Welcome portal page',
    status: 'published',
    is_published: true,
    is_homepage: true,
    display_order: 0,
    settings: {
      heroCtaLabel: 'Browse dashboards',
      heroCtaTarget: '/superset/public/dashboards/',
    },
    rendering: {
      scope_class: 'cms-page-scope-welcome',
      css_text: '.cms-page-scope-welcome { --portal-accent: #0f766e; }',
      css_variables: {
        '--portal-accent': '#0f766e',
      },
      inline_style: {},
      warnings: [],
      theme: {
        id: 1,
        slug: 'default-theme',
        title: 'Default Theme',
        tokens: {
          colors: {
            accent: '#0f766e',
            surface: '#ffffff',
          },
          containers: {
            pageMaxWidth: '100%',
          },
        },
        settings: {},
      },
      template: {
        id: 1,
        slug: 'default-template',
        title: 'Default Template',
        structure: {
          regions: {
            hero: { enabled: true },
            content: { enabled: true },
          },
        },
        settings: {},
      },
      template_structure: {
        regions: {
          hero: { enabled: true },
          content: { enabled: true },
        },
      },
    },
    blocks: welcomePageBlocks,
    sections: [
      {
        id: 101,
        section_key: 'hero',
        title: 'Towards malaria elimination in Uganda',
        subtitle: 'Serving-table powered public analytics.',
        section_type: 'hero',
        display_order: 0,
        is_visible: true,
        settings: { region: 'hero' },
        rendering: {
          scope_class: 'cms-section-hero',
          css_text: '',
          css_variables: {},
          inline_style: {},
          warnings: [],
        },
        components: [
          {
            id: 201,
            component_key: 'intro',
            component_type: 'markdown',
            title: 'Overview',
            body: 'Explore curated pages and public charts.',
            display_order: 0,
            is_visible: true,
            settings: {},
            rendering: {
              scope_class: 'cms-component-intro',
              css_text: '',
              css_variables: {},
              inline_style: {},
              warnings: [],
            },
          },
        ],
      },
      {
        id: 102,
        section_key: 'featured-charts',
        title: 'Featured Analytics',
        subtitle: 'Public charts backed by serving datasets.',
        section_type: 'chart_grid',
        display_order: 1,
        is_visible: true,
        settings: { columns: 2, region: 'content' },
        rendering: {
          scope_class: 'cms-section-featured',
          css_text: '',
          css_variables: {},
          inline_style: {},
          warnings: [],
        },
        components: [
          {
            id: 202,
            component_key: 'coverage-chart',
            component_type: 'chart',
            title: 'Coverage Map',
            body: 'Latest malaria coverage summary.',
            chart_id: 7,
            display_order: 0,
            is_visible: true,
            settings: { height: 240 },
            rendering: {
              scope_class: 'cms-component-coverage-chart',
              css_text: '',
              css_variables: {},
              inline_style: {},
              warnings: [],
            },
            chart: {
              id: 7,
              slice_name: 'Coverage Map',
              description: 'Serving chart',
              viz_type: 'dhis2_map',
              url: '/superset/explore/?slice_id=7&standalone=true',
              is_public: true,
              uses_serving_dataset: true,
            },
          },
        ],
      },
    ],
  },
  user_layout: {
    id: 8,
    page_id: 1,
    user_id: 1,
    layout: {
      section_order: [101, 102],
      hidden_section_ids: [],
    },
  },
  dashboards: [
    {
      id: 9,
      uuid: 'a2efb6e2-6f5f-45f6-8cac-57aef1f9dc31',
      dashboard_title: 'National Malaria Dashboard',
      slug: 'national-malaria-dashboard',
      url: '/superset/dashboard/national-malaria-dashboard/',
      display_order: 0,
    },
  ],
  available_charts: [
    {
      id: 7,
      slice_name: 'Coverage Map',
      description: 'Serving chart',
      viz_type: 'dhis2_map',
      url: '/superset/explore/?slice_id=7&standalone=true',
      is_public: true,
      uses_serving_dataset: true,
    },
  ],
  permissions: {
    can_customize_layout: false,
    can_manage_pages: false,
  },
  indicator_highlights: [
    {
      indicator_name: 'Cases',
      dataset_name: 'Malaria',
      instance_name: 'National',
      period: '2026Q1',
      value: '12.4K',
    },
  ],
};

const dashboardCatalogPayload: PortalPayload = {
  ...portalPayload,
  pages: [
    ...portalPayload.pages,
    {
      id: 2,
      slug: 'dashboards',
      title: 'Dashboards',
      subtitle: 'Public dashboards',
      description: 'Public dashboard directory',
      is_published: true,
      is_homepage: false,
      display_order: 1,
      settings: {},
    },
  ],
  current_page: {
    id: 2,
    slug: 'dashboards',
    title: 'Dashboards',
    subtitle: 'Public dashboards',
    description: 'Public dashboard directory',
    status: 'published',
    is_published: true,
    is_homepage: false,
    display_order: 1,
    settings: {},
    blocks: dashboardDirectoryBlocks,
    sections: [
      {
        id: 103,
        section_key: 'dashboard-directory',
        title: 'Public Dashboards',
        subtitle: 'Browse the published dashboard directory.',
        section_type: 'dashboard_catalog',
        display_order: 0,
        is_visible: true,
        settings: {},
        components: [],
      },
    ],
  },
};

beforeEach(() => {
  fetchMock.restore();
  window.history.pushState({}, '', '/superset/public/welcome/');
});

afterEach(() => {
  fetchMock.restore();
});

test('renders portal content without exposing CMS admin controls', async () => {
  fetchMock.get('glob:*/api/v1/public_page/portal*', {
    result: portalPayload,
  });

  render(<PublicLandingPage />, {
    useRouter: true,
    useTheme: true,
  });

  expect(
    await screen.findByText('Towards malaria elimination in Uganda'),
  ).toBeInTheDocument();
  expect(screen.getByText('Featured Analytics')).toBeInTheDocument();
  expect(screen.getByTitle('Coverage Map')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Customize layout' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Page studio' }),
  ).not.toBeInTheDocument();
  expect(
    document.head.querySelector('meta[name="description"]'),
  ).not.toBeNull();
  expect(
    Array.from(document.querySelectorAll('style')).some(style =>
      style.textContent?.includes('--portal-accent'),
    ),
  ).toBe(true);
});

test('renders block-authored pages without relying on legacy sections', async () => {
  fetchMock.get('glob:*/api/v1/public_page/portal*', {
    result: {
      ...portalPayload,
      current_page: {
        ...portalPayload.current_page,
        blocks: [
          {
            uid: 'hero-block',
            block_type: 'hero',
            slot: 'hero',
            sort_order: 0,
            is_container: true,
            content: {
              title: 'Block Authored Welcome',
              subtitle: 'Rendered from the page block tree.',
            },
            settings: {},
            styles: {},
            metadata: { label: 'Hero' },
            children: [],
          },
          {
            uid: 'content-block',
            block_type: 'rich_text',
            slot: 'content',
            sort_order: 1,
            is_container: false,
            content: {
              body: 'This page was rendered from `page.blocks`.',
            },
            settings: {},
            styles: {},
            metadata: { label: 'Rich Text' },
            children: [],
          },
        ],
        sections: [],
      },
    },
  });

  render(<PublicLandingPage />, {
    useRouter: true,
    useTheme: true,
  });

  expect(await screen.findByText('Block Authored Welcome')).toBeInTheDocument();
  expect(
    screen.getByText('Rendered from the page block tree.'),
  ).toBeInTheDocument();
  expect(
    screen.getByText('This page was rendered from `page.blocks`.'),
  ).toBeInTheDocument();
});

test('keeps public navigation when a dashboard is opened from the public portal', async () => {
  fetchMock.get('glob:*/api/v1/public_page/portal*', {
    result: dashboardCatalogPayload,
  });
  window.history.pushState({}, '', '/superset/public/dashboards/');

  render(<PublicLandingPage />, {
    useRouter: true,
    useTheme: true,
  });

  await userEvent.click(await screen.findByText('National Malaria Dashboard'));

  await waitFor(() =>
    expect(window.location.pathname).toBe('/superset/public/dashboards/'),
  );
  expect(window.location.pathname).toBe('/superset/public/dashboards/');
  expect(window.location.search).toContain(
    'dashboard=national-malaria-dashboard',
  );
  expect(
    await screen.findByRole('button', { name: 'Back to page' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('National Malaria Dashboard')).toHaveAttribute(
    'data-dashboard-uuid',
    'a2efb6e2-6f5f-45f6-8cac-57aef1f9dc31',
  );
});
