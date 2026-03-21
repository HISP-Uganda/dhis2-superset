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

import { t } from '@superset-ui/core';
import type {
  PortalPage,
  PortalPageBlock,
  PortalPageComponent,
  PortalPageSection,
} from './types';

const CONTAINER_BLOCK_TYPES = new Set([
  'group',
  'columns',
  'column',
  'hero',
  'card',
]);

function makeUid(prefix = 'blk') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isContainerBlock(blockType?: string | null) {
  return CONTAINER_BLOCK_TYPES.has((blockType || '').trim().toLowerCase());
}

export function cloneBlockTree(blocks: PortalPageBlock[]): PortalPageBlock[] {
  return (blocks || []).map(block => ({
    ...block,
    content: { ...(block.content || {}) },
    settings: { ...(block.settings || {}) },
    styles: { ...(block.styles || {}) },
    metadata: { ...(block.metadata || {}) },
    style_bundle: block.style_bundle
      ? { ...block.style_bundle }
      : block.style_bundle,
    rendering: block.rendering
      ? {
          ...block.rendering,
          css_variables: { ...(block.rendering.css_variables || {}) },
          inline_style: { ...(block.rendering.inline_style || {}) },
        }
      : block.rendering,
    chart: block.chart ? { ...block.chart } : block.chart,
    dashboard: block.dashboard ? { ...block.dashboard } : block.dashboard,
    children: cloneBlockTree(block.children || []),
  }));
}

export function createEmptyBlock(blockType = 'paragraph'): PortalPageBlock {
  const normalizedType = blockType.trim().toLowerCase();
  const base: PortalPageBlock = {
    uid: makeUid(normalizedType.slice(0, 3) || 'blk'),
    block_type: normalizedType,
    slot: normalizedType === 'hero' ? 'hero' : 'content',
    sort_order: 0,
    is_container: isContainerBlock(normalizedType),
    visibility: 'public',
    status: 'active',
    schema_version: 1,
    style_bundle_id: null,
    content: {},
    settings: {},
    styles: {},
    metadata: {
      label:
        normalizedType === 'chart'
          ? t('Chart')
          : normalizedType === 'hero'
            ? t('Hero')
            : normalizedType === 'columns'
              ? t('Columns')
              : t('Block'),
    },
    children: [],
  };

  switch (normalizedType) {
    case 'rich_text':
    case 'paragraph':
      base.content = { body: t('Add content here.') };
      break;
    case 'heading':
      base.content = { text: t('Heading'), level: 2 };
      break;
    case 'image':
      base.content = { title: t('Image'), url: '', alt: '', caption: '' };
      break;
    case 'button':
      base.content = { label: t('Open link') };
      base.settings = { url: '', variant: 'primary' };
      break;
    case 'spacer':
      base.settings = { height: 48 };
      break;
    case 'hero':
      base.content = {
        eyebrow: '',
        title: t('Hero Title'),
        subtitle: t('Introduce the page with a strong message.'),
      };
      break;
    case 'group':
      base.content = { title: t('Section'), subtitle: '' };
      break;
    case 'card':
      base.content = { title: t('Card'), body: '' };
      break;
    case 'columns':
      base.settings = { columnCount: 2, gap: 24 };
      base.children = [createEmptyBlock('column'), createEmptyBlock('column')];
      break;
    case 'column':
      base.content = { title: '' };
      break;
    case 'chart':
      base.content = { title: t('Chart'), caption: '' };
      base.settings = {
        provider: 'superset',
        mode: 'saved_chart',
        chart_ref: null,
        height: 360,
        responsive: true,
        show_header: true,
      };
      break;
    case 'dashboard':
      base.content = { title: t('Dashboard'), caption: '' };
      base.settings = { dashboard_ref: null, height: 720 };
      break;
    case 'dynamic_widget':
      base.content = { title: t('Dynamic Widget'), body: '' };
      base.settings = { widgetType: 'indicator_highlights', limit: 6 };
      break;
    case 'embed':
    case 'video':
      base.content = { url: '', caption: '' };
      break;
    case 'html':
      base.content = { html: '' };
      break;
    default:
      break;
  }

  return base;
}

function convertLegacyComponent(
  component: PortalPageComponent,
): PortalPageBlock {
  const componentType = (component.component_type || 'paragraph').toLowerCase();
  const mappedType =
    componentType === 'markdown'
      ? 'rich_text'
      : componentType === 'cta'
        ? 'card'
        : componentType === 'indicator_highlights' ||
            componentType === 'dashboard_list'
          ? 'dynamic_widget'
          : componentType;
  const block = createEmptyBlock(mappedType);
  block.id = component.id;
  block.uid = component.component_key || block.uid;
  block.sort_order = component.display_order ?? 0;
  block.status = component.is_visible === false ? 'hidden' : 'active';
  block.style_bundle_id = component.style_bundle_id ?? null;
  block.style_bundle = component.style_bundle || null;
  block.rendering = component.rendering;
  block.chart = component.chart || null;
  block.dashboard = component.dashboard || null;
  block.metadata = {
    ...(block.metadata || {}),
    source: 'legacy_component',
    component_type: componentType,
    component_key: component.component_key,
  };
  if (mappedType === 'rich_text' || mappedType === 'paragraph') {
    block.content = { body: component.body || component.title || '' };
  } else if (mappedType === 'heading') {
    block.content = { text: component.title || component.body || '', level: 2 };
  } else if (mappedType === 'image') {
    block.content = {
      title: component.title || '',
      url: component.settings?.imageUrl || '',
      alt: component.settings?.altText || '',
      caption: component.settings?.caption || component.body || '',
    };
  } else if (mappedType === 'button') {
    block.content = { label: component.body || component.title || '' };
    block.settings = {
      ...component.settings,
      url: component.settings?.url || '',
      variant: component.settings?.variant || 'primary',
    };
  } else if (mappedType === 'card') {
    block.content = {
      title: component.title || '',
      body: component.body || '',
      buttonLabel: component.settings?.buttonLabel || '',
    };
    block.settings = { ...component.settings };
  } else if (mappedType === 'chart') {
    block.content = {
      title: component.title || '',
      caption: component.body || '',
    };
    block.settings = {
      ...component.settings,
      provider: 'superset',
      mode: 'saved_chart',
      chart_ref: component.chart_id ? { id: component.chart_id } : null,
      height: Number(component.settings?.height) || 360,
    };
  } else if (mappedType === 'dashboard') {
    block.content = {
      title: component.title || '',
      caption: component.body || '',
    };
    block.settings = {
      ...component.settings,
      dashboard_ref: component.dashboard_id
        ? { id: component.dashboard_id }
        : null,
      height: Number(component.settings?.height) || 720,
    };
  } else if (mappedType === 'dynamic_widget') {
    block.content = {
      title: component.title || '',
      body: component.body || '',
    };
    block.settings = {
      ...component.settings,
      widgetType:
        componentType === 'indicator_highlights'
          ? 'indicator_highlights'
          : componentType === 'dashboard_list'
            ? 'dashboard_list'
            : component.settings?.widgetType || 'custom',
    };
  } else {
    block.content = {
      title: component.title || '',
      body: component.body || '',
    };
    block.settings = { ...(component.settings || {}) };
  }
  return block;
}

function convertLegacySection(section: PortalPageSection): PortalPageBlock {
  const sectionType = (section.section_type || 'content').toLowerCase();
  const mappedType = sectionType === 'hero' ? 'hero' : 'group';
  const block = createEmptyBlock(mappedType);
  block.id = section.id;
  block.uid = section.section_key || block.uid;
  block.slot =
    section.settings?.region || (sectionType === 'hero' ? 'hero' : 'content');
  block.sort_order = section.display_order ?? 0;
  block.status = section.is_visible === false ? 'hidden' : 'active';
  block.style_bundle_id = section.style_bundle_id ?? null;
  block.style_bundle = section.style_bundle || null;
  block.rendering = section.rendering;
  block.metadata = {
    ...(block.metadata || {}),
    source: 'legacy_section',
    section_type: sectionType,
    section_key: section.section_key,
  };
  if (mappedType === 'hero') {
    block.content = {
      eyebrow: section.settings?.eyebrow || '',
      title: section.title || '',
      subtitle: section.subtitle || '',
    };
  } else {
    block.content = {
      title: section.title || '',
      subtitle: section.subtitle || '',
    };
    block.settings = { ...(section.settings || {}) };
  }
  block.children = (section.components || []).map(convertLegacyComponent);
  if (!block.children.length && sectionType === 'dashboard_catalog') {
    const catalogBlock = createEmptyBlock('dynamic_widget');
    catalogBlock.slot = block.slot;
    catalogBlock.content = {
      title: section.title || '',
      body: section.subtitle || '',
    };
    catalogBlock.settings = {
      widgetType: 'dashboard_list',
    };
    block.children = [catalogBlock];
  } else if (!block.children.length && sectionType === 'kpi_band') {
    const highlightsBlock = createEmptyBlock('dynamic_widget');
    highlightsBlock.slot = block.slot;
    highlightsBlock.content = {
      title: section.title || '',
      body: section.subtitle || '',
    };
    highlightsBlock.settings = {
      widgetType: 'indicator_highlights',
      limit: 6,
    };
    block.children = [highlightsBlock];
  }
  return block;
}

export function ensurePageBlocks(
  page: PortalPage | null | undefined,
): PortalPageBlock[] {
  if (!page) {
    return [];
  }
  if ((page.blocks || []).length) {
    return cloneBlockTree(page.blocks || []);
  }
  return (page.sections || []).map(convertLegacySection);
}

export function flattenBlocks(
  blocks: PortalPageBlock[],
  depth = 0,
): Array<{ block: PortalPageBlock; depth: number }> {
  return (blocks || []).flatMap(block => [
    { block, depth },
    ...flattenBlocks(block.children || [], depth + 1),
  ]);
}

function updateBlockList(
  blocks: PortalPageBlock[],
  targetUid: string,
  updater: (
    block: PortalPageBlock,
    siblings: PortalPageBlock[],
  ) => PortalPageBlock[],
): PortalPageBlock[] {
  if (!targetUid) {
    return cloneBlockTree(blocks);
  }
  const cloned = cloneBlockTree(blocks);
  function walk(items: PortalPageBlock[]): PortalPageBlock[] {
    const directIndex = items.findIndex(
      item => (item.uid || String(item.id)) === targetUid,
    );
    if (directIndex >= 0) {
      return updater(items[directIndex], items);
    }
    return items.map(item => ({
      ...item,
      children: walk(item.children || []),
    }));
  }
  return walk(cloned);
}

export function updateBlockByUid(
  blocks: PortalPageBlock[],
  targetUid: string,
  patch: Partial<PortalPageBlock>,
): PortalPageBlock[] {
  return updateBlockList(blocks, targetUid, (_, siblings) =>
    siblings.map(item =>
      (item.uid || String(item.id)) === targetUid
        ? { ...item, ...patch }
        : item,
    ),
  );
}

export function updateBlockContent(
  blocks: PortalPageBlock[],
  targetUid: string,
  patch: Record<string, any>,
): PortalPageBlock[] {
  return updateBlockByUid(blocks, targetUid, {
    content: {
      ...(flattenBlocks(blocks).find(
        ({ block }) => (block.uid || String(block.id)) === targetUid,
      )?.block.content || {}),
      ...patch,
    },
  });
}

export function updateBlockSettings(
  blocks: PortalPageBlock[],
  targetUid: string,
  patch: Record<string, any>,
): PortalPageBlock[] {
  return updateBlockByUid(blocks, targetUid, {
    settings: {
      ...(flattenBlocks(blocks).find(
        ({ block }) => (block.uid || String(block.id)) === targetUid,
      )?.block.settings || {}),
      ...patch,
    },
  });
}

export function addRootBlock(
  blocks: PortalPageBlock[],
  blockType: string,
): PortalPageBlock[] {
  return [...cloneBlockTree(blocks), createEmptyBlock(blockType)];
}

export function insertBlockRelative(
  blocks: PortalPageBlock[],
  targetUid: string | null,
  blockType: string,
  mode: 'after' | 'child' = 'after',
): PortalPageBlock[] {
  if (!targetUid) {
    return addRootBlock(blocks, blockType);
  }
  const nextBlock = createEmptyBlock(blockType);
  return updateBlockList(blocks, targetUid, (block, siblings) => {
    if (mode === 'child' && isContainerBlock(block.block_type)) {
      return siblings.map(item =>
        item === block
          ? {
              ...item,
              children: [...(item.children || []), nextBlock],
            }
          : item,
      );
    }
    const index = siblings.findIndex(item => item === block);
    const result = siblings.slice();
    result.splice(index + 1, 0, nextBlock);
    return result;
  });
}

export function removeBlockByUid(
  blocks: PortalPageBlock[],
  targetUid: string,
): PortalPageBlock[] {
  const cloned = cloneBlockTree(blocks);
  function walk(items: PortalPageBlock[]): PortalPageBlock[] {
    const filtered = items.filter(
      item => (item.uid || String(item.id)) !== targetUid,
    );
    return filtered.map(item => ({
      ...item,
      children: walk(item.children || []),
    }));
  }
  return walk(cloned);
}

export function moveBlockByUid(
  blocks: PortalPageBlock[],
  targetUid: string,
  direction: -1 | 1,
): PortalPageBlock[] {
  return updateBlockList(blocks, targetUid, (block, siblings) => {
    const index = siblings.findIndex(item => item === block);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) {
      return siblings;
    }
    const result = siblings.slice();
    const [moved] = result.splice(index, 1);
    result.splice(nextIndex, 0, moved);
    return result;
  });
}

export function duplicateBlockByUid(
  blocks: PortalPageBlock[],
  targetUid: string,
): PortalPageBlock[] {
  return updateBlockList(blocks, targetUid, (block, siblings) => {
    const index = siblings.findIndex(item => item === block);
    const clone = cloneBlockTree([block])[0];
    function regenerateIds(node: PortalPageBlock): PortalPageBlock {
      return {
        ...node,
        id: undefined,
        uid: makeUid(node.block_type.slice(0, 3) || 'blk'),
        children: (node.children || []).map(regenerateIds),
      };
    }
    const duplicated = regenerateIds(clone);
    const result = siblings.slice();
    result.splice(index + 1, 0, duplicated);
    return result;
  });
}

export function normalizeBlocks(
  blocks: PortalPageBlock[],
  depth = 0,
): PortalPageBlock[] {
  return (blocks || []).map((block, index) => ({
    id: block.id,
    uid: block.uid || makeUid(block.block_type.slice(0, 3) || 'blk'),
    parent_block_id: block.parent_block_id ?? null,
    block_type: block.block_type,
    slot: block.slot || 'content',
    sort_order: index,
    tree_path: block.tree_path || null,
    depth,
    is_container: block.is_container || isContainerBlock(block.block_type),
    visibility: block.visibility || 'public',
    status: block.status || 'active',
    schema_version: block.schema_version || 1,
    style_bundle_id: block.style_bundle_id ?? block.style_bundle?.id ?? null,
    content: { ...(block.content || {}) },
    settings: { ...(block.settings || {}) },
    styles: { ...(block.styles || {}) },
    metadata: { ...(block.metadata || {}) },
    children: normalizeBlocks(block.children || [], depth + 1),
  }));
}

export function cloneDraftPageWithBlocks(page: PortalPage): PortalPage {
  return {
    ...page,
    settings: { ...(page.settings || {}) },
    blocks: ensurePageBlocks(page),
  };
}
