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

import { applyUserLayoutToSections, normalizeDraftPage } from './portalUtils';
import type { PortalPage, PortalPageSection } from './types';

const sections: PortalPageSection[] = [
  {
    id: 1,
    section_key: 'hero',
    title: 'Hero',
    subtitle: '',
    section_type: 'hero',
    display_order: 0,
    is_visible: true,
    settings: {},
    components: [],
  },
  {
    id: 2,
    section_key: 'content',
    title: 'Content',
    subtitle: '',
    section_type: 'content',
    display_order: 1,
    is_visible: true,
    settings: {},
    components: [],
  },
  {
    id: 3,
    section_key: 'hidden',
    title: 'Hidden',
    subtitle: '',
    section_type: 'content',
    display_order: 2,
    is_visible: true,
    settings: {},
    components: [],
  },
];

test('applyUserLayoutToSections reorders and hides sections', () => {
  const result = applyUserLayoutToSections(sections, {
    id: 9,
    page_id: 1,
    user_id: 1,
    layout: {
      section_order: [2, 1, 3],
      hidden_section_ids: [3],
    },
  });

  expect(result.map(section => section.id)).toEqual([2, 1]);
});

test('normalizeDraftPage strips nested chart metadata from save payload', () => {
  const draftPage = {
    id: 4,
    slug: '',
    title: ' Welcome ',
    subtitle: ' Subtitle ',
    description: ' Description ',
    status: 'published',
    is_published: true,
    is_homepage: false,
    display_order: 3,
    theme_id: 9,
    template_id: 10,
    style_bundle_id: 11,
    settings: { heroCtaLabel: 'Open' },
    blocks: [
      {
        id: 33,
        uid: 'coverage-chart',
        block_type: 'chart',
        slot: 'content',
        sort_order: 0,
        is_container: false,
        style_bundle_id: 13,
        content: {
          title: ' Coverage ',
          caption: 'Latest malaria coverage summary.',
        },
        settings: {
          chart_ref: { id: 7 },
          height: 300,
          show_header: true,
        },
        styles: {},
        metadata: { label: 'Chart' },
        tree_path: '0000',
        depth: 0,
        dashboard: null,
        asset: null,
        style_bundle: {
          id: 13,
          slug: 'chart-style',
          title: 'Chart Style',
          variables: {},
          settings: {},
        },
        rendering: {
          scope_class: 'portal-block',
          css_text: '.portal-block { color: #000; }',
        },
        chart: {
          id: 7,
          slice_name: 'Coverage Map',
          url: '/superset/explore/?slice_id=7&standalone=true',
        },
        children: [],
      },
    ],
    sections: [
      {
        id: 11,
        section_key: 'featured',
        title: ' Featured ',
        subtitle: ' Section ',
        section_type: 'chart_grid',
        style_bundle_id: 12,
        display_order: 0,
        is_visible: true,
        settings: { columns: 2 },
        components: [
          {
            id: 33,
            component_key: 'coverage-chart',
            component_type: 'chart',
            title: ' Coverage ',
            body: null,
            chart_id: 7,
            dashboard_id: null,
            style_bundle_id: 13,
            display_order: 0,
            is_visible: true,
            settings: { height: 300 },
            chart: {
              id: 7,
              slice_name: 'Coverage Map',
              url: '/superset/explore/?slice_id=7&standalone=true',
            },
            dashboard: null,
          },
        ],
      },
    ],
  } as PortalPage;

  const normalized = normalizeDraftPage(draftPage);

  expect(normalized.slug).toBeUndefined();
  expect(normalized.title).toBe('Welcome');
  expect(normalized.theme_id).toBe(9);
  expect(normalized.template_id).toBe(10);
  expect(normalized.style_bundle_id).toBe(11);
  expect(normalized.sections[0].title).toBe('Featured');
  expect(normalized.sections[0].style_bundle_id).toBe(12);
  expect(normalized.sections[0].components[0]).toEqual(
    expect.objectContaining({
      chart_id: 7,
      component_type: 'chart',
      style_bundle_id: 13,
      title: 'Coverage',
    }),
  );
  expect(normalized.sections[0].components[0]).not.toHaveProperty('chart');
  expect(normalized.blocks[0]).toEqual(
    expect.objectContaining({
      block_type: 'chart',
      style_bundle_id: 13,
      settings: expect.objectContaining({
        chart_ref: { id: 7 },
      }),
    }),
  );
  expect(normalized.blocks[0]).not.toHaveProperty('chart');
  expect(normalized.blocks[0]).not.toHaveProperty('tree_path');
  expect(normalized.blocks[0]).not.toHaveProperty('depth');
  expect(normalized.blocks[0]).not.toHaveProperty('rendering');
  expect(normalized.blocks[0]).not.toHaveProperty('style_bundle');
  expect(normalized.blocks[0]).not.toHaveProperty('asset');
  expect(normalized.blocks[0]).not.toHaveProperty('dashboard');
});
