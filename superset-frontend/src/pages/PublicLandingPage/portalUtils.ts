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
  PortalPage,
  PortalPageComponent,
  PortalPageSection,
  PortalUserLayout,
} from './types';
import { cloneDraftPageWithBlocks, normalizeBlocks } from './blockUtils';

export function moveArrayItem<T>(
  items: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items.slice();
  }

  const nextItems = items.slice();
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

export function applyUserLayoutToSections(
  sections: PortalPageSection[],
  userLayout?: PortalUserLayout | null,
): PortalPageSection[] {
  const hiddenIds = new Set(userLayout?.layout?.hidden_section_ids || []);
  const preferredOrder = userLayout?.layout?.section_order || [];
  const preferredIndex = new Map(
    preferredOrder.map((sectionId, index) => [sectionId, index]),
  );

  return sections
    .map(section => ({
      ...section,
      settings: { ...(section.settings || {}) },
      components: [...(section.components || [])]
        .filter(component => component.is_visible !== false)
        .sort((left, right) => left.display_order - right.display_order),
      is_visible:
        section.is_visible !== false &&
        (!section.id || !hiddenIds.has(section.id)),
    }))
    .filter(section => section.is_visible !== false)
    .sort((left, right) => {
      const leftOrder =
        left.id !== undefined && preferredIndex.has(left.id)
          ? preferredIndex.get(left.id)!
          : Number.MAX_SAFE_INTEGER;
      const rightOrder =
        right.id !== undefined && preferredIndex.has(right.id)
          ? preferredIndex.get(right.id)!
          : Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.display_order - right.display_order;
    });
}

export function createEmptyComponent(
  componentType = 'markdown',
): PortalPageComponent {
  const isTextual =
    componentType === 'markdown' ||
    componentType === 'heading' ||
    componentType === 'paragraph';
  return {
    component_type: componentType,
    title:
      componentType === 'chart'
        ? 'Chart'
        : componentType === 'image'
          ? 'Image'
          : componentType === 'button'
            ? 'Button'
            : componentType === 'cta'
              ? 'Call To Action'
              : componentType === 'divider'
                ? 'Divider'
                : componentType === 'spacer'
                  ? 'Spacer'
                  : 'Content',
    body: isTextual
      ? 'Add markdown content here.'
      : componentType === 'indicator_highlights'
        ? null
        : componentType === 'button'
          ? 'Learn more'
          : componentType === 'cta'
            ? 'Describe the action or supporting text.'
            : '',
    chart_id: null,
    dashboard_id: null,
    style_bundle_id: null,
    display_order: 0,
    is_visible: true,
    settings:
      componentType === 'chart'
        ? { height: 360 }
        : componentType === 'image'
          ? { imageUrl: '', altText: '', caption: '' }
          : componentType === 'button'
            ? { url: '', variant: 'primary' }
            : componentType === 'cta'
              ? { buttonLabel: 'Get Started', buttonUrl: '', align: 'left' }
              : componentType === 'divider'
                ? { style: 'solid' }
                : componentType === 'spacer'
                  ? { height: 48 }
                  : componentType === 'indicator_highlights'
                    ? { limit: 6 }
                    : {},
  };
}

export function createEmptySection(sectionType = 'content'): PortalPageSection {
  const region =
    sectionType === 'hero'
      ? 'hero'
      : sectionType === 'dashboard_catalog'
        ? 'content'
        : sectionType === 'kpi_band'
          ? 'content'
          : 'content';
  return {
    section_type: sectionType,
    title:
      sectionType === 'hero'
        ? 'New Hero Section'
        : sectionType === 'chart_grid'
          ? 'New Chart Section'
          : 'New Section',
    subtitle: '',
    style_bundle_id: null,
    display_order: 0,
    is_visible: true,
    settings:
      sectionType === 'chart_grid'
        ? { columns: 2, region }
        : sectionType === 'hero'
          ? { align: 'left', region }
          : { region },
    components: [
      createEmptyComponent(
        sectionType === 'chart_grid'
          ? 'chart'
          : sectionType === 'kpi_band'
            ? 'indicator_highlights'
            : 'markdown',
      ),
    ],
  };
}

export function createDraftPage(page: PortalPage): PortalPage {
  const draftWithBlocks = cloneDraftPageWithBlocks(page);
  return {
    ...page,
    blocks: draftWithBlocks.blocks,
    settings: { ...(page.settings || {}) },
    theme: page.theme ? { ...page.theme } : page.theme,
    template: page.template ? { ...page.template } : page.template,
    style_bundle: page.style_bundle
      ? { ...page.style_bundle }
      : page.style_bundle,
    parent_page: page.parent_page ? { ...page.parent_page } : page.parent_page,
    featured_image_asset: page.featured_image_asset
      ? { ...page.featured_image_asset }
      : page.featured_image_asset,
    og_image_asset: page.og_image_asset
      ? { ...page.og_image_asset }
      : page.og_image_asset,
    breadcrumbs: [...(page.breadcrumbs || [])],
    rendering: page.rendering
      ? {
          ...page.rendering,
          css_variables: { ...(page.rendering.css_variables || {}) },
          inline_style: { ...(page.rendering.inline_style || {}) },
          template_structure: {
            ...(page.rendering.template_structure || {}),
          },
        }
      : page.rendering,
    sections: (page.sections || []).map(section => ({
      ...section,
      settings: { ...(section.settings || {}) },
      style_bundle: section.style_bundle
        ? { ...section.style_bundle }
        : section.style_bundle,
      rendering: section.rendering
        ? {
            ...section.rendering,
            css_variables: { ...(section.rendering.css_variables || {}) },
            inline_style: { ...(section.rendering.inline_style || {}) },
          }
        : section.rendering,
      components: (section.components || []).map(component => ({
        ...component,
        settings: { ...(component.settings || {}) },
        chart: component.chart ? { ...component.chart } : component.chart,
        dashboard: component.dashboard
          ? { ...component.dashboard }
          : component.dashboard,
        style_bundle: component.style_bundle
          ? { ...component.style_bundle }
          : component.style_bundle,
        rendering: component.rendering
          ? {
              ...component.rendering,
              css_variables: { ...(component.rendering.css_variables || {}) },
              inline_style: { ...(component.rendering.inline_style || {}) },
            }
          : component.rendering,
      })),
    })),
  };
}

export function normalizeDraftPage(page: PortalPage): PortalPage {
  return {
    id: page.id,
    slug: page.slug?.trim() || undefined,
    title: page.title.trim(),
    subtitle: page.subtitle?.trim() || '',
    description: page.description?.trim() || '',
    excerpt: page.excerpt?.trim() || '',
    status: page.status || 'published',
    is_published: page.is_published,
    is_homepage: page.is_homepage,
    display_order: page.display_order ?? 0,
    parent_page_id: page.parent_page_id ?? page.parent_page?.id ?? null,
    navigation_label: page.navigation_label?.trim() || '',
    visibility: page.visibility || 'public',
    page_type: page.page_type || 'content',
    template_key: page.template_key || 'default',
    theme_id: page.theme_id ?? page.theme?.id ?? null,
    template_id: page.template_id ?? page.template?.id ?? null,
    style_bundle_id: page.style_bundle_id ?? page.style_bundle?.id ?? null,
    featured_image_asset_id:
      page.featured_image_asset_id ?? page.featured_image_asset?.id ?? null,
    og_image_asset_id:
      page.og_image_asset_id ?? page.og_image_asset?.id ?? null,
    seo_title: page.seo_title?.trim() || '',
    seo_description: page.seo_description?.trim() || '',
    og_image_url: page.og_image_url?.trim() || '',
    featured_image_url: page.featured_image_url?.trim() || '',
    scheduled_publish_at: page.scheduled_publish_at || null,
    settings: { ...(page.settings || {}) },
    blocks: normalizeBlocks(page.blocks || []),
    sections: page.sections.map((section, sectionIndex) => ({
      id: section.id,
      section_key: section.section_key,
      section_type: section.section_type,
      style_bundle_id:
        section.style_bundle_id ?? section.style_bundle?.id ?? null,
      title: section.title?.trim() || '',
      subtitle: section.subtitle?.trim() || '',
      display_order: sectionIndex,
      is_visible: section.is_visible,
      settings: { ...(section.settings || {}) },
      components: section.components.map((component, componentIndex) => ({
        id: component.id,
        component_key: component.component_key,
        component_type: component.component_type,
        title: component.title?.trim() || '',
        body: component.body ?? '',
        chart_id: component.chart_id ?? null,
        dashboard_id: component.dashboard_id ?? null,
        style_bundle_id:
          component.style_bundle_id ?? component.style_bundle?.id ?? null,
        display_order: componentIndex,
        is_visible: component.is_visible,
        settings: { ...(component.settings || {}) },
      })),
    })),
  };
}
