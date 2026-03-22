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

import { fireEvent, render, screen } from 'spec/helpers/testing-library';
import { RenderBlockTree } from './BlockRenderer';
import type { PortalPage, PortalPageBlock } from './types';

jest.mock(
  './PublicDashboardEmbed',
  () =>
    function MockPublicDashboardEmbed() {
      return <div data-testid="public-dashboard-embed" />;
    },
);

jest.mock('./PublicChartContainer', () => ({
  __esModule: true,
  isMapLikeViz: (vizType?: string | null) => {
    const normalized = (vizType || '').trim().toLowerCase();
    return Boolean(
      normalized &&
        (normalized.includes('map') || normalized.startsWith('deck_')),
    );
  },
  default: function MockPublicChartContainer({
    title,
    height,
    surfacePreset,
    legendPreset,
    vizType,
  }: {
    title: string;
    height?: number;
    surfacePreset?: string;
    legendPreset?: string;
    vizType?: string;
  }) {
    return (
      <div data-testid="public-chart-container">
        {title}:{height}:{surfacePreset}:{legendPreset}:{vizType}
      </div>
    );
  },
}));

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
  expect(
    screen.getByText('Coverage Trend:420:default:default:line'),
  ).toBeInTheDocument();
});

test('passes map-focused chart presentation options to the public chart container', () => {
  render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'map_chart',
          block_type: 'chart',
          slot: 'content',
          sort_order: 0,
          is_container: false,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: {
            title: 'Facility map',
            caption: 'Public facility distribution',
          },
          settings: {
            chart_ref: { id: 8 },
            height: 360,
            show_header: false,
            surface_preset: 'map_focus',
            legend_preset: 'horizontal_top',
          },
          styles: {},
          metadata: {},
          children: [],
        },
      ]}
      charts={[
        {
          id: 8,
          slice_name: 'Facility map',
          viz_type: 'dhis2_map',
          url: '/superset/explore/?slice_id=8&standalone=true',
        },
      ]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
    />,
    { useTheme: true },
  );

  expect(
    screen.getByText('Facility map:360:map_focus:horizontal_top:dhis2_map'),
  ).toBeInTheDocument();
});

test('defaults map charts to professional public presentation without a redundant header', () => {
  render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'map_chart_auto',
          block_type: 'chart',
          slot: 'content',
          sort_order: 0,
          is_container: false,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: {
            title: 'Facility map',
            caption: '',
          },
          settings: {
            chart_ref: { id: 18 },
            height: 360,
            show_header: true,
          },
          styles: {},
          metadata: {},
          children: [],
        },
      ]}
      charts={[
        {
          id: 18,
          slice_name: 'Facility map',
          viz_type: 'dhis2_map',
          url: '/superset/explore/?slice_id=18&standalone=true',
        },
      ]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
    />,
    { useTheme: true },
  );

  expect(
    screen.getByText('Facility map:360:map_focus:horizontal_bottom:dhis2_map'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Facility map' }),
  ).not.toBeInTheDocument();
});

test('renders synced reusable block references with their current source blocks', () => {
  render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'reusable_ref_1',
          block_type: 'reusable_reference',
          slot: 'content',
          sort_order: 0,
          is_container: false,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: {
            title: 'Shared section',
          },
          settings: {
            reusable_block_id: 4,
          },
          styles: {},
          metadata: {
            label: 'Shared section',
          },
          reusable_block: {
            id: 4,
            slug: 'shared-section',
            title: 'Shared section',
            category: 'analytics',
            settings: {},
            blocks: [
              {
                uid: 'shared_card',
                block_type: 'card',
                slot: 'content',
                sort_order: 0,
                is_container: true,
                visibility: 'public',
                status: 'active',
                schema_version: 1,
                style_bundle_id: null,
                content: {
                  title: 'Shared interpretation',
                  body: 'This content is served from the reusable block library.',
                },
                settings: {},
                styles: {},
                metadata: {},
                children: [],
              },
            ],
          },
          children: [],
        },
      ]}
      charts={[]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
    />,
    { useTheme: true },
  );

  expect(screen.getByText('Shared interpretation')).toBeInTheDocument();
});

test('applies saved block sizing and card style options to rendered blocks', () => {
  render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'card_1',
          block_type: 'card',
          slot: 'content',
          sort_order: 0,
          is_container: true,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: {
            title: 'Configured card',
            body: 'Saved style options persist to the page render.',
          },
          settings: {
            minHeight: 240,
          },
          styles: {
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            borderColor: '#38bdf8',
            borderStyle: 'solid',
            borderWidth: '2px',
            borderRadius: '24px',
            boxShadow: '0 18px 42px rgba(15, 23, 42, 0.14)',
            maxWidth: '420px',
            margin: '0 auto',
            padding: '32px',
          },
          metadata: {},
          rendering: {
            scope_class: 'cms-block-configured-card',
            css_text: '',
            inline_style: {
              backgroundColor: '#ffffff',
            },
          },
          children: [],
        },
      ]}
      charts={[]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
    />,
    { useTheme: true },
  );

  const configuredCard = screen
    .getByText('Configured card')
    .closest('.cms-block-shell');

  expect(configuredCard).toHaveStyle({
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderColor: '#38bdf8',
    borderStyle: 'solid',
    borderWidth: '2px',
    borderRadius: '24px',
    maxWidth: '420px',
    margin: '0 auto',
    padding: '32px',
  });
});

test('renders saved rich text formatting for block content and action labels', () => {
  render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'hero_rich',
          block_type: 'hero',
          slot: 'content',
          sort_order: 0,
          is_container: true,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: {
            title: 'Coverage Overview',
            title_html: '<p><strong>Coverage</strong> Overview</p>',
            subtitle: 'Quarterly performance snapshot',
            subtitle_html: '<p><em>Quarterly</em> performance snapshot</p>',
          },
          settings: {
            primaryActionUrl: '/superset/public/explore/',
            primaryActionLabel: 'Learn more',
            primaryActionLabel_html: '<p><strong>Learn</strong> more</p>',
          },
          styles: {},
          metadata: {},
          children: [],
        },
        {
          uid: 'card_rich',
          block_type: 'card',
          slot: 'content',
          sort_order: 1,
          is_container: true,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: {
            title: 'Weekly bulletin',
            buttonLabel: 'Open report',
            buttonLabel_html: '<p><em>Open</em> report</p>',
          },
          settings: {
            buttonUrl: '/superset/public/reports/',
          },
          styles: {},
          metadata: {},
          children: [],
        },
      ]}
      charts={[]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
    />,
    { useTheme: true },
  );

  const heroTitle = screen.getByRole('heading', { name: 'Coverage Overview' });
  const heroButton = screen.getByRole('button', { name: 'Learn more' });
  const cardButton = screen.getByRole('button', { name: 'Open report' });

  expect(heroTitle.querySelector('strong')).not.toBeNull();
  expect(heroButton.querySelector('strong')).not.toBeNull();
  expect(cardButton.querySelector('em')).not.toBeNull();
});

test('resizes editor blocks by drag and commits the new size settings', () => {
  const onResizeBlock = jest.fn();

  const { container } = render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'group_1',
          block_type: 'group',
          slot: 'content',
          sort_order: 0,
          is_container: true,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: { title: 'Resizable group' },
          settings: {},
          styles: {},
          metadata: { label: 'Resizable group' },
          children: [
            {
              uid: 'card_resize',
              block_type: 'card',
              slot: 'content',
              sort_order: 0,
              is_container: true,
              visibility: 'public',
              status: 'active',
              schema_version: 1,
              style_bundle_id: null,
              content: {
                title: 'Resizable child card',
                body: 'Drag the resize handle to change width and height.',
              },
              settings: {
                gridSpan: 3,
                minHeight: 220,
              },
              styles: {},
              metadata: { label: 'Resizable child card' },
              children: [],
            },
          ],
        },
      ]}
      charts={[]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
      mode="editor"
      selectedBlockUid="card_resize"
      onResizeBlock={onResizeBlock}
    />,
    { useTheme: true },
  );

  const resizeHandle = container.querySelector(
    '[data-resize-direction="se"]',
  ) as HTMLElement;
  const blockCell = resizeHandle.closest(
    '[data-block-cell="true"]',
  ) as HTMLElement;
  const blockGrid = resizeHandle.closest(
    '[data-block-grid="true"]',
  ) as HTMLElement;

  Object.defineProperty(blockCell, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 330,
      height: 220,
      top: 0,
      left: 0,
      right: 330,
      bottom: 220,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(blockGrid, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 1398,
      height: 480,
      top: 0,
      left: 0,
      right: 1398,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  fireEvent.mouseDown(resizeHandle, { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 336, clientY: 220 });
  fireEvent.mouseUp(window, { clientX: 336, clientY: 220 });

  expect(onResizeBlock).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 'card_resize' }),
    expect.objectContaining({
      gridSpan: 5,
      minHeight: 340,
    }),
  );
});

test('resizes editor blocks from a side border handle without opening selection', () => {
  const onResizeBlock = jest.fn();
  const onSelectBlock = jest.fn();

  const { container } = render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'card_resize_right',
          block_type: 'card',
          slot: 'content',
          sort_order: 0,
          is_container: true,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: {
            title: 'Resizable right edge',
            body: 'Drag the border to resize width.',
          },
          settings: {
            gridSpan: 4,
            minHeight: 200,
          },
          styles: {},
          metadata: { label: 'Resizable right edge' },
          children: [],
        },
      ]}
      charts={[]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
      mode="editor"
      onResizeBlock={onResizeBlock}
      onSelectBlock={onSelectBlock}
    />,
    { useTheme: true },
  );

  const resizeHandle = container.querySelector(
    '[data-resize-direction="e"]',
  ) as HTMLElement;
  const blockCell = resizeHandle.closest(
    '[data-block-cell="true"]',
  ) as HTMLElement;
  const blockGrid = resizeHandle.closest(
    '[data-block-grid="true"]',
  ) as HTMLElement;

  Object.defineProperty(blockCell, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 440,
      height: 200,
      top: 0,
      left: 0,
      right: 440,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(blockGrid, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 1398,
      height: 400,
      top: 0,
      left: 0,
      right: 1398,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  fireEvent.mouseDown(resizeHandle, { clientX: 120, clientY: 120 });
  fireEvent.mouseMove(window, { clientX: 360, clientY: 120 });
  fireEvent.mouseUp(window, { clientX: 360, clientY: 120 });

  expect(onSelectBlock).not.toHaveBeenCalled();
  expect(onResizeBlock).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 'card_resize_right' }),
    expect.objectContaining({
      gridSpan: 6,
      minHeight: 200,
    }),
  );
});

test('shows inline add and grid template actions for selected container blocks', () => {
  const onInsertBlockFromCanvas = jest.fn();
  const onInsertGridTemplateFromCanvas = jest.fn();

  render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'group_actions',
          block_type: 'group',
          slot: 'content',
          sort_order: 0,
          is_container: true,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: { title: 'Content group' },
          settings: {},
          styles: {},
          metadata: { label: 'Content group' },
          children: [],
        },
      ]}
      charts={[]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
      mode="editor"
      selectedBlockUid="group_actions"
      onInsertBlockFromCanvas={onInsertBlockFromCanvas}
      onInsertGridTemplateFromCanvas={onInsertGridTemplateFromCanvas}
    />,
    { useTheme: true },
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Add content inside Content group' }),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Insert a 3-column row inside Content group',
    }),
  );

  expect(onInsertBlockFromCanvas).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 'group_actions' }),
    'child',
  );
  expect(onInsertGridTemplateFromCanvas).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 'group_actions' }),
    3,
  );
});

test('applies row height and gap settings for 12-column grid rows', () => {
  const { container } = render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'columns_row',
          block_type: 'columns',
          slot: 'content',
          sort_order: 0,
          is_container: true,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: {},
          settings: {
            columnCount: 3,
            gap: 32,
            rowMinHeight: 280,
          },
          styles: {},
          metadata: { label: 'Grid row' },
          children: [
            {
              uid: 'column_1',
              block_type: 'column',
              slot: 'content',
              sort_order: 0,
              is_container: true,
              visibility: 'public',
              status: 'active',
              schema_version: 1,
              style_bundle_id: null,
              content: {},
              settings: { gridSpan: 4 },
              styles: {},
              metadata: { label: 'Column 1' },
              children: [],
            },
            {
              uid: 'column_2',
              block_type: 'column',
              slot: 'content',
              sort_order: 1,
              is_container: true,
              visibility: 'public',
              status: 'active',
              schema_version: 1,
              style_bundle_id: null,
              content: {},
              settings: { gridSpan: 4 },
              styles: {},
              metadata: { label: 'Column 2' },
              children: [],
            },
            {
              uid: 'column_3',
              block_type: 'column',
              slot: 'content',
              sort_order: 2,
              is_container: true,
              visibility: 'public',
              status: 'active',
              schema_version: 1,
              style_bundle_id: null,
              content: {},
              settings: { gridSpan: 4 },
              styles: {},
              metadata: { label: 'Column 3' },
              children: [],
            },
          ],
        },
      ]}
      charts={[]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
    />,
    { useTheme: true },
  );

  const blockGrids = container.querySelectorAll('[data-block-grid="true"]');
  const blockCells = container.querySelectorAll('[data-block-cell="true"]');
  const blockGrid = blockGrids[1] as HTMLElement;
  const blockCell = blockCells[1] as HTMLElement;

  expect(blockGrid).toHaveStyle({ gap: '32px' });
  expect(blockCell).toHaveStyle({ minHeight: '280px' });
});

test('resize handle does not trigger block selection when starting a resize', () => {
  const onResizeBlock = jest.fn();
  const onSelectBlock = jest.fn();

  const { container } = render(
    <RenderBlockTree
      blocks={[
        {
          uid: 'card_resize_only',
          block_type: 'card',
          slot: 'content',
          sort_order: 0,
          is_container: true,
          visibility: 'public',
          status: 'active',
          schema_version: 1,
          style_bundle_id: null,
          content: {
            title: 'Resizable card only',
            body: 'Resize without opening settings.',
          },
          settings: {
            gridSpan: 4,
            minHeight: 200,
          },
          styles: {},
          metadata: { label: 'Resizable card only' },
          children: [],
        },
      ]}
      charts={[]}
      dashboards={[]}
      page={page}
      navigation={{ header: [], footer: [] }}
      mode="editor"
      onResizeBlock={onResizeBlock}
      onSelectBlock={onSelectBlock}
    />,
    { useTheme: true },
  );

  const resizeHandle = container.querySelector(
    '[data-resize-direction="w"]',
  ) as HTMLElement;
  const blockCell = resizeHandle.closest(
    '[data-block-cell="true"]',
  ) as HTMLElement;
  const blockGrid = resizeHandle.closest(
    '[data-block-grid="true"]',
  ) as HTMLElement;

  Object.defineProperty(blockCell, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 440,
      height: 200,
      top: 0,
      left: 0,
      right: 440,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(blockGrid, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 1398,
      height: 400,
      top: 0,
      left: 0,
      right: 1398,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  fireEvent.mouseDown(resizeHandle, { clientX: 120, clientY: 120 });
  fireEvent.mouseMove(window, { clientX: 240, clientY: 180 });
  fireEvent.mouseUp(window, { clientX: 240, clientY: 180 });
  fireEvent.click(resizeHandle);

  expect(onSelectBlock).not.toHaveBeenCalled();
  expect(onResizeBlock).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 'card_resize_only' }),
    expect.any(Object),
  );
});
