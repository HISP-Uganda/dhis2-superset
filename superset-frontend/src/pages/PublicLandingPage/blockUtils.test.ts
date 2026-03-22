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
  cloneBlocksForInsertion,
  createGridTemplateBlock,
  createEmptyBlock,
  createReusableReferenceBlock,
  detachReusableBlockByUid,
  insertBlocksRelative,
  setColumnsBlockTemplateByUid,
  splitBlockIntoColumnsByUid,
} from './blockUtils';
import type { PortalReusableBlock } from './types';

test('insertBlocksRelative preserves multi-block starter pattern order', () => {
  const anchor = createEmptyBlock('section');
  anchor.uid = 'anchor_section';
  anchor.content = { title: 'Existing Section' };

  const hero = createEmptyBlock('hero');
  hero.content = { ...hero.content, title: 'Pattern Hero' };
  const callout = createEmptyBlock('callout');
  callout.content = { ...callout.content, title: 'Pattern Callout' };

  const preparedPattern = cloneBlocksForInsertion([hero, callout]);
  const inserted = insertBlocksRelative(
    [anchor],
    'anchor_section',
    preparedPattern,
    'after',
  );

  expect(inserted.map(block => block.block_type)).toEqual([
    'section',
    'hero',
    'callout',
  ]);
  expect(inserted[1].content.title).toBe('Pattern Hero');
  expect(inserted[2].content.title).toBe('Pattern Callout');
  expect(inserted[1].uid).not.toBe(hero.uid);
});

test('detachReusableBlockByUid converts a synced reusable block to local blocks', () => {
  const sharedCard = createEmptyBlock('card');
  sharedCard.content = {
    ...sharedCard.content,
    title: 'Shared CTA',
    body: 'Open the district dashboard.',
  };

  const reusableBlock: PortalReusableBlock = {
    id: 9,
    slug: 'shared-cta',
    title: 'Shared CTA',
    description: 'Shared call to action',
    category: 'conversion',
    settings: {},
    blocks: [sharedCard],
  };

  const syncedReference = createReusableReferenceBlock(reusableBlock);
  syncedReference.uid = 'shared_cta_ref';

  const detached = detachReusableBlockByUid(
    [syncedReference],
    'shared_cta_ref',
  );

  expect(detached).toHaveLength(1);
  expect(detached[0].block_type).toBe('card');
  expect(detached[0].content.title).toBe('Shared CTA');
  expect(detached[0].uid).not.toBe(sharedCard.uid);
  expect(detached[0].reusable_block).toBeUndefined();

  detached[0].content.title = 'Locally edited CTA';

  expect(reusableBlock.blocks[0].content.title).toBe('Shared CTA');
});

test('createEmptyBlock seeds chart blocks with public page presentation defaults', () => {
  const chart = createEmptyBlock('chart');

  expect(chart.settings.show_header).toBe(true);
  expect(chart.settings.surface_preset).toBe('default');
  expect(chart.settings.legend_preset).toBe('default');
});

test('splitBlockIntoColumnsByUid wraps a selected block in a two-column layout', () => {
  const block = createEmptyBlock('chart');
  block.uid = 'chart_primary';
  block.content = {
    ...block.content,
    title: 'Coverage map',
  };
  block.settings = {
    ...block.settings,
    gridSpan: 8,
  };

  const result = splitBlockIntoColumnsByUid([block], 'chart_primary', 2);

  expect(result.wrapperUid).toBeTruthy();
  expect(result.focusUid).toBeTruthy();
  expect(result.blocks).toHaveLength(1);
  expect(result.blocks[0].block_type).toBe('columns');
  expect(result.blocks[0].settings.gridSpan).toBe(8);
  expect(result.blocks[0].children).toHaveLength(2);
  expect(result.blocks[0].children[0].block_type).toBe('column');
  expect(result.blocks[0].children[1].block_type).toBe('column');
  expect(result.blocks[0].children[0].children[0].uid).toBe('chart_primary');
  expect(result.blocks[0].children[0].children[0].settings.gridSpan).toBe(12);
  expect(result.focusUid).toBe(result.blocks[0].children[1].uid);
});

test('createGridTemplateBlock builds a 12-column row with equal column spans', () => {
  const gridRow = createGridTemplateBlock(4, {
    slot: 'content',
    rowMinHeight: 320,
  });

  expect(gridRow.block_type).toBe('columns');
  expect(gridRow.settings.columnCount).toBe(4);
  expect(gridRow.settings.gridSpan).toBe(12);
  expect(gridRow.settings.rowMinHeight).toBe(320);
  expect(gridRow.children).toHaveLength(4);
  expect(gridRow.children.map(column => column.settings?.gridSpan)).toEqual([
    3, 3, 3, 3,
  ]);
  expect(gridRow.children.map(column => column.settings?.minHeight)).toEqual([
    320, 320, 320, 320,
  ]);
});

test('setColumnsBlockTemplateByUid preserves overflow content when reducing columns', () => {
  const gridRow = createGridTemplateBlock(4, {
    slot: 'content',
    rowMinHeight: 260,
  });
  gridRow.uid = 'row_4';
  gridRow.children = gridRow.children.map((column, index) => {
    const paragraph = createEmptyBlock('paragraph');
    paragraph.uid = `paragraph_${index + 1}`;
    paragraph.content = {
      ...paragraph.content,
      body: `Column ${index + 1} body`,
    };
    return {
      ...column,
      children: [paragraph],
    };
  });

  const updated = setColumnsBlockTemplateByUid([gridRow], 'row_4', 2);
  const nextRow = updated[0];

  expect(nextRow.children).toHaveLength(2);
  expect(nextRow.children.map(column => column.settings?.gridSpan)).toEqual([
    6, 6,
  ]);
  expect(nextRow.children[0].children[0].content.body).toBe('Column 1 body');
  expect(
    nextRow.children[1].children.map(child => child.content?.body),
  ).toEqual(['Column 2 body', 'Column 3 body', 'Column 4 body']);
});
