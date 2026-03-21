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

import { render, screen } from 'spec/helpers/testing-library';
import { RenderBlockTree } from './BlockRenderer';
import type { PortalPage, PortalPageBlock } from './types';

jest.mock(
  './PublicDashboardEmbed',
  () =>
    function MockPublicDashboardEmbed() {
      return <div data-testid="public-dashboard-embed" />;
    },
);

jest.mock(
  './PublicChartContainer',
  () =>
    function MockPublicChartContainer({
      title,
      height,
    }: {
      title: string;
      height?: number;
    }) {
      return (
        <div data-testid="public-chart-container">
          {title}:{height}
        </div>
      );
    },
);

const page: PortalPage = {
  id: 12,
  slug: 'team',
  path: 'about/team',
  title: 'Our Team',
  subtitle: 'Meet the programme team',
  excerpt: 'Team overview',
  description: 'Team overview',
  is_published: true,
  is_homepage: false,
  display_order: 0,
  settings: {},
  blocks: [],
  sections: [],
  breadcrumbs: [
    { id: 1, title: 'About', slug: 'about', path: '/superset/public/about/' },
    {
      id: 12,
      title: 'Our Team',
      slug: 'team',
      path: '/superset/public/about/team/',
    },
  ],
};

const blocks: PortalPageBlock[] = [
  {
    uid: 'crumb_1',
    block_type: 'breadcrumb',
    slot: 'content',
    sort_order: 0,
    is_container: false,
    visibility: 'public',
    status: 'active',
    schema_version: 1,
    style_bundle_id: null,
    content: {},
    settings: { showCurrentPage: true },
    styles: {},
    metadata: {},
    children: [],
  },
  {
    uid: 'file_1',
    block_type: 'download',
    slot: 'content',
    sort_order: 1,
    is_container: false,
    visibility: 'public',
    status: 'active',
    schema_version: 1,
    style_bundle_id: null,
    content: {
      title: 'Malaria Response Plan',
      body: 'Download the latest response plan.',
      buttonLabel: 'Download PDF',
    },
    settings: {
      asset_ref: { id: 9 },
      download_url: '/api/v1/public_page/assets/9/download',
      open_in_new_tab: false,
    },
    styles: {},
    metadata: {},
    children: [],
  },
  {
    uid: 'grp_1',
    block_type: 'group',
    slot: 'content',
    sort_order: 2,
    is_container: true,
    visibility: 'public',
    status: 'active',
    schema_version: 1,
    style_bundle_id: null,
    content: {
      title: 'Highlights',
      body: 'Key analytics for this page.',
    },
    settings: {},
    styles: {},
    metadata: {},
    children: [
      {
        uid: 'cht_1',
        block_type: 'chart',
        slot: 'content',
        sort_order: 0,
        is_container: false,
        visibility: 'public',
        status: 'active',
        schema_version: 1,
        style_bundle_id: null,
        content: {
          title: 'Coverage Trend',
          caption: 'Last 12 months',
        },
        settings: {
          chart_ref: { id: 21 },
          height: 420,
          show_header: true,
        },
        styles: {},
        metadata: {},
        children: [],
      },
    ],
  },
];

test('renders breadcrumb, file download, and nested chart blocks', () => {
  const onNavigate = jest.fn();

  render(
    <RenderBlockTree
      blocks={blocks}
      charts={[
        {
          id: 21,
          slice_name: 'Coverage Trend',
          viz_type: 'line',
          url: '/superset/explore/?slice_id=21&standalone=true',
        },
      ]}
      dashboards={[]}
      mediaAssets={[
        {
          id: 9,
          slug: 'malaria-response-plan',
          title: 'Malaria Response Plan',
          asset_type: 'file',
          original_filename: 'response-plan.pdf',
          file_extension: 'pdf',
          visibility: 'public',
          is_public: true,
          status: 'active',
          settings: {},
          download_url: '/api/v1/public_page/assets/9/download',
        },
      ]}
      page={page}
      navigation={{ header: [], footer: [] }}
      onNavigate={onNavigate}
    />,
    { useTheme: true },
  );

  expect(screen.getByText('About')).toBeInTheDocument();
  expect(screen.getByText('Our Team')).toBeInTheDocument();
  expect(screen.getByText('Malaria Response Plan')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Download PDF' }),
  ).toBeInTheDocument();
  expect(screen.getByText('response-plan.pdf')).toBeInTheDocument();
  expect(screen.getByText('Highlights')).toBeInTheDocument();
  expect(screen.getByText('Coverage Trend:420')).toBeInTheDocument();
});
