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

import {
  buildPublishPagePayload,
  buildPublishStatePayload,
} from './publishPayload';
import type { PortalPage, PortalPageSummary } from '../PublicLandingPage/types';

test('buildPublishPagePayload keeps the edited draft body when publishing', () => {
  const draftPage: PortalPage = {
    id: 1,
    slug: 'welcome',
    path: 'about/welcome',
    title: 'Welcome edited',
    subtitle: '',
    description: '',
    excerpt: '',
    is_published: false,
    is_homepage: false,
    display_order: 0,
    parent_page_id: null,
    navigation_label: 'Welcome',
    status: 'draft',
    visibility: 'draft',
    page_type: 'content',
    template_key: 'default',
    theme_id: 1,
    template_id: 1,
    style_bundle_id: null,
    featured_image_asset_id: null,
    og_image_asset_id: null,
    scheduled_publish_at: null,
    settings: {},
    blocks: [
      {
        uid: 'paragraph_1',
        block_type: 'paragraph',
        slot: 'content',
        sort_order: 0,
        is_container: false,
        visibility: 'public',
        status: 'active',
        schema_version: 1,
        style_bundle_id: null,
        content: {
          body: 'Add content here.',
        },
        settings: {},
        styles: {},
        metadata: {},
        children: [],
      },
    ],
    sections: [],
  };

  const payload = buildPublishPagePayload(draftPage, true);

  expect(payload.title).toBe('Welcome edited');
  expect(payload.is_published).toBe(true);
  expect(payload.visibility).toBe('public');
  expect(payload.blocks).toHaveLength(1);
  expect(payload.blocks[0].content.body).toBe('Add content here.');
});

test('buildPublishStatePayload promotes draft visibility when publishing', () => {
  const page: PortalPageSummary = {
    title: 'Welcome',
    is_published: false,
    is_homepage: false,
    display_order: 0,
    settings: {},
    visibility: 'draft',
    scheduled_publish_at: null,
  };

  expect(buildPublishStatePayload(page, true)).toEqual({
    is_published: true,
    visibility: 'public',
    scheduled_publish_at: null,
  });
});
