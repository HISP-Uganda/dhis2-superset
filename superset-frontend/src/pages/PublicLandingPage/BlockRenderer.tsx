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
/* eslint-disable no-restricted-imports, theme-colors/no-literal-colors */

import { CSSProperties, useMemo, useRef, useState } from 'react';
import { SafeMarkdown } from '@superset-ui/core/components';
import { sanitizeHtml, styled, t } from '@superset-ui/core';
import { Button, Dropdown, Empty, Tag } from 'antd';
import type { MenuProps } from 'antd';
import RichTextComposer from 'src/pages/CMSAdminPage/RichTextComposer';
import PublicChartContainer, { isMapLikeViz } from './PublicChartContainer';
import PublicDashboardEmbed from './PublicDashboardEmbed';
import { cloneBlockTree, isContainerBlock } from './blockUtils';
import type {
  PortalBlockDefinition,
  PortalChartSummary,
  PortalDashboardSummary,
  PortalHighlight,
  PortalMediaAsset,
  PortalNavigationMenu,
  PortalPage,
  PortalPageBlock,
} from './types';

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-bottom: 28px;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

const SectionTitleGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-size: 24px;
  letter-spacing: -0.03em;
`;

const SectionSubtitle = styled.p`
  margin: 0;
  color: var(--portal-muted);
`;

const SectionNote = styled.span`
  color: var(--portal-muted);
  font-size: 13px;
`;

const Grid = styled.div<{ $columns?: number }>`
  display: grid;
  grid-template-columns: repeat(
    ${({ $columns = 1 }) => $columns},
    minmax(0, 1fr)
  );
  gap: 18px;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

const BlockGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 18px;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

const BlockGridCell = styled.div<{ $span?: number; $minHeight?: number }>`
  display: flex;
  align-items: stretch;
  min-width: 0;
  grid-column: span ${({ $span = 12 }) => Math.min(Math.max($span, 1), 12)};
  ${({ $minHeight }) =>
    $minHeight ? `min-height: ${Math.max($minHeight, 0)}px;` : ''}

  & > * {
    flex: 1 1 auto;
    min-width: 0;
  }

  @media (max-width: 960px) {
    grid-column: span 1;
  }
`;

const EditorSelectable = styled.div<{ $selected?: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  align-self: stretch;
  width: 100%;
  min-height: 100%;
  height: 100%;
  box-sizing: border-box;
  min-width: 0;
  border: 1px solid
    ${({ $selected }) =>
      $selected ? 'rgba(15, 118, 110, 0.55)' : 'rgba(148, 163, 184, 0.18)'};
  border-radius: 16px;
  padding: 8px;
  background: ${({ $selected }) =>
    $selected ? 'rgba(240, 253, 250, 0.8)' : 'transparent'};
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    border-color: rgba(15, 118, 110, 0.4);
    box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.08);
  }

  &:hover .cms-editor-resize-handle {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  &:hover .cms-editor-resize-frame {
    opacity: 1;
  }

  &:hover .cms-editor-inline-actions {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
`;

const EditorCanvasBody = styled.div`
  display: flex;
  flex: 1 1 auto;
  min-width: 0;

  & > * {
    flex: 1 1 auto;
    min-width: 0;
  }
`;

const EditorSelectableHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
`;

const EditorSelectableLabel = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: var(--portal-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const EditorInlineActions = styled.div<{ $visible?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: ${({ $visible }) => ($visible ? 'auto' : 'none')};
  transform: ${({ $visible }) =>
    $visible ? 'translateY(0)' : 'translateY(-2px)'};
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
`;

const EditorInlineActionButton = styled.button<{ $accent?: boolean }>`
  border: 0;
  border-radius: 999px;
  padding: 4px 10px;
  background: ${({ $accent }) =>
    $accent ? 'rgba(15, 118, 110, 0.12)' : 'rgba(15, 23, 42, 0.08)'};
  color: ${({ $accent }) =>
    $accent ? 'rgb(15, 118, 110)' : 'var(--portal-muted-strong)'};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;

  &:hover {
    background: ${({ $accent }) =>
      $accent ? 'rgba(15, 118, 110, 0.18)' : 'rgba(15, 23, 42, 0.12)'};
  }
`;

const EditorEmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 16px;
  border-radius: 14px;
  border: 1px dashed rgba(15, 118, 110, 0.28);
  background: rgba(248, 250, 252, 0.94);
`;

const EditorEmptyStateCopy = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const EditorEmptyStateTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: var(--portal-muted-strong);
`;

const EditorEmptyStateDescription = styled.div`
  font-size: 12px;
  color: var(--portal-muted);
  max-width: 560px;
`;

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function formatBlockTypeCategory(category?: string | null) {
  return String(category || t('Content'))
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function buildEditorInsertMenuItems(
  blockTypes: PortalBlockDefinition[],
): MenuProps['items'] {
  if (!blockTypes.length) {
    return [];
  }
  const grouped = blockTypes.reduce<Record<string, PortalBlockDefinition[]>>(
    (accumulator, blockType) => {
      const category = blockType.category || 'content';
      accumulator[category] = [...(accumulator[category] || []), blockType];
      return accumulator;
    },
    {},
  );
  const orderedCategories = Object.keys(grouped).sort((left, right) =>
    formatBlockTypeCategory(left).localeCompare(formatBlockTypeCategory(right)),
  );
  return orderedCategories.map(category => ({
    type: 'group' as const,
    key: `group-${category}`,
    label: formatBlockTypeCategory(category),
    children: grouped[category]
      .slice()
      .sort((left, right) => left.label.localeCompare(right.label))
      .map(blockType => ({
        key: blockType.type,
        label: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 700 }}>{blockType.label}</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {blockType.description || blockType.type}
            </span>
          </div>
        ),
      })),
  }));
}

function resizeCursor(direction: ResizeDirection) {
  switch (direction) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'nw':
    case 'se':
    default:
      return 'nwse-resize';
  }
}

function resizeHandlePlacement(direction: ResizeDirection) {
  switch (direction) {
    case 'n':
      return `
        top: 0;
        left: 18px;
        right: 18px;
        height: 14px;
      `;
    case 's':
      return `
        bottom: 0;
        left: 18px;
        right: 18px;
        height: 14px;
      `;
    case 'e':
      return `
        top: 18px;
        right: 0;
        bottom: 18px;
        width: 14px;
      `;
    case 'w':
      return `
        top: 18px;
        left: 0;
        bottom: 18px;
        width: 14px;
      `;
    case 'ne':
      return `
        top: 0;
        right: 0;
        width: 18px;
        height: 18px;
      `;
    case 'nw':
      return `
        top: 0;
        left: 0;
        width: 18px;
        height: 18px;
      `;
    case 'sw':
      return `
        left: 0;
        bottom: 0;
        width: 18px;
        height: 18px;
      `;
    case 'se':
    default:
      return `
        right: 0;
        bottom: 0;
        width: 18px;
        height: 18px;
      `;
  }
}

const EditorResizeFrame = styled.div<{ $visible?: boolean }>`
  position: absolute;
  inset: 6px;
  border: 1px dashed rgba(15, 118, 110, 0.45);
  border-radius: 12px;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: none;
  transition: opacity 0.2s ease;
`;

const EditorResizeHandle = styled.button<{
  $visible?: boolean;
  $direction: ResizeDirection;
}>`
  position: absolute;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: ${({ $direction }) => resizeCursor($direction)};
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: ${({ $visible }) => ($visible ? 'auto' : 'none')};
  transition:
    opacity 0.2s ease,
    transform 0.2s ease,
    background 0.2s ease;
  transform: ${({ $visible }) =>
    $visible ? 'translateY(0)' : 'translateY(4px)'};
  z-index: 3;
  ${({ $direction }) => resizeHandlePlacement($direction)}

  &::after {
    position: absolute;
    content: '';
    border-radius: 999px;
    background: rgba(15, 118, 110, 0.92);
    inset: auto;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    ${({ $direction }) =>
      $direction === 'n' || $direction === 's'
        ? `
            width: 36px;
            height: 3px;
          `
        : $direction === 'e' || $direction === 'w'
          ? `
              width: 3px;
              height: 36px;
            `
          : `
              width: 12px;
              height: 12px;
            `}
  }

  &:hover {
    background: rgba(15, 118, 110, 0.08);
  }
`;

const SurfaceCard = styled.div`
  padding: 18px;
  border-radius: var(--portal-radius-lg, 0);
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
`;

const DashboardDirectoryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 18px;
`;

const DashboardDirectoryCard = styled(SurfaceCard)`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
  min-height: 220px;
  cursor: pointer;
  border-color: var(--portal-border-strong);
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.98) 0%,
      rgba(241, 245, 249, 0.94) 100%
    ),
    var(--portal-surface);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;

  &:hover,
  &:focus-visible {
    border-color: rgba(15, 118, 110, 0.26);
    box-shadow: 0 20px 40px rgba(15, 23, 42, 0.1);
    transform: translateY(-2px);
  }
`;

const DashboardDirectoryTop = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const DashboardDirectoryEyebrow = styled.span`
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.1);
  color: var(--portal-accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const DashboardDirectoryDescription = styled.p`
  margin: 0;
  color: var(--portal-muted-strong);
  font-size: 14px;
  line-height: 1.7;
`;

const DashboardDirectoryFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const CardTitle = styled.h3`
  margin: 0 0 8px;
  font-size: 18px;
  letter-spacing: -0.02em;
`;

const CardBody = styled.div`
  color: var(--portal-muted-strong);
`;

const RichTextBlock = styled.div`
  & > *:first-of-type {
    margin-top: 0;
  }

  & > *:last-child {
    margin-bottom: 0;
  }
`;

const RichTextInline = styled.span`
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  line-height: inherit;
  white-space: normal;

  &,
  & * {
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    line-height: inherit;
  }

  p,
  div,
  blockquote,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  ul,
  ol {
    margin: 0;
  }

  a {
    color: inherit;
    text-decoration: underline;
  }
`;

const Hero = styled.section`
  position: relative;
  overflow: hidden;
  border-radius: var(--portal-radius-lg, 0);
  padding: 36px;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
  gap: 28px;
  background: var(--portal-hero-background, var(--portal-surface));
  border: 1px solid var(--portal-border-strong);

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
    padding: 24px;
  }
`;

const Eyebrow = styled.div`
  display: inline-flex;
  margin-bottom: 12px;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--portal-muted);
`;

const HeroTitle = styled.h1`
  margin: 0;
  font-size: var(--portal-heading-hero-size, clamp(2.5rem, 5vw, 4rem));
  line-height: 1;
  letter-spacing: -0.05em;
`;

const HeroSubtitle = styled.p`
  margin: 18px 0 0;
  max-width: 60ch;
  font-size: 18px;
  color: var(--portal-muted-strong);
`;

const HeroActions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 18px;
  flex-wrap: wrap;
`;

const Quote = styled.blockquote`
  margin: 0;
  padding: 18px 20px;
  border-left: 4px solid var(--portal-accent);
  background: rgba(15, 23, 42, 0.02);
  color: var(--portal-muted-strong);
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
`;

const MetricCard = styled.div`
  padding: 18px;
  border-radius: var(--portal-radius-md, 0);
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
`;

const MetricValue = styled.div`
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.04em;
`;

const MetricLabel = styled.div`
  margin-top: 8px;
  font-weight: 600;
`;

const MetricMeta = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
  color: var(--portal-muted);
`;

const BreadcrumbNav = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--portal-muted);
  font-size: 13px;
`;

const BreadcrumbItem = styled.button`
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
`;

const MenuList = styled.div<{ $vertical?: boolean }>`
  display: flex;
  flex-direction: ${({ $vertical }) => ($vertical ? 'column' : 'row')};
  gap: 12px;
  flex-wrap: wrap;
`;

const MenuLink = styled.button`
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--portal-link);
  font-weight: 600;
  cursor: pointer;
`;

const FileMeta = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
  color: var(--portal-muted);
  font-size: 12px;
`;

const CalloutCard = styled.div<{ $tone?: string }>`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: var(--portal-radius-lg, 0);
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-left: 4px solid
    ${({ $tone }) =>
      $tone === 'warning'
        ? '#d97706'
        : $tone === 'error'
          ? '#dc2626'
          : $tone === 'success'
            ? '#0f766e'
            : '#1d4ed8'};
`;

function normalizeBlockInlineStyles(
  styles?: Record<string, any>,
): CSSProperties {
  const nextStyles: CSSProperties = {};
  Object.entries(styles || {}).forEach(([key, value]) => {
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && !value.trim())
    ) {
      return;
    }
    (nextStyles as Record<string, any>)[key] = value;
  });
  if (
    (nextStyles.borderColor || nextStyles.borderWidth) &&
    !nextStyles.borderStyle
  ) {
    nextStyles.borderStyle = 'solid';
  }
  if (nextStyles.borderColor && !nextStyles.borderWidth) {
    nextStyles.borderWidth = '1px';
  }
  return nextStyles;
}

function blockStyle(block: PortalPageBlock): CSSProperties {
  return {
    ...((block.rendering?.inline_style || {}) as CSSProperties),
    ...normalizeBlockInlineStyles(block.styles),
  };
}

function blockClassName(block: PortalPageBlock) {
  return ['cms-block-shell', block.rendering?.scope_class]
    .filter(Boolean)
    .join(' ');
}

function positiveNumberOrUndefined(value: any) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.round(parsed);
}

function lookupChart(
  block: PortalPageBlock,
  charts: PortalChartSummary[],
): PortalChartSummary | null {
  if (block.chart) {
    return block.chart;
  }
  const chartId =
    block.settings?.chart_ref?.id ||
    block.settings?.chartRef?.id ||
    block.settings?.chart_id ||
    block.settings?.chartId;
  if (!chartId) {
    return null;
  }
  return charts.find(chart => chart.id === chartId) || null;
}

function lookupDashboard(
  block: PortalPageBlock,
  dashboards: PortalDashboardSummary[],
): PortalDashboardSummary | null {
  if (block.dashboard) {
    return block.dashboard;
  }
  const dashboardId =
    block.settings?.dashboard_ref?.id ||
    block.settings?.dashboardRef?.id ||
    block.settings?.dashboard_id ||
    block.settings?.dashboardId;
  if (!dashboardId) {
    return null;
  }
  return dashboards.find(dashboard => dashboard.id === dashboardId) || null;
}

function lookupAsset(
  block: PortalPageBlock,
  mediaAssets: PortalMediaAsset[],
): PortalMediaAsset | null {
  if (block.asset) {
    return block.asset;
  }
  if (block.content?.asset) {
    return block.content.asset as PortalMediaAsset;
  }
  const assetId =
    block.settings?.asset_ref?.id ||
    block.settings?.assetRef?.id ||
    block.content?.asset_ref?.id ||
    block.content?.assetRef?.id;
  if (!assetId) {
    return null;
  }
  return mediaAssets.find(asset => asset.id === assetId) || null;
}

function findMenu(
  navigation: {
    header: PortalNavigationMenu[];
    footer: PortalNavigationMenu[];
  },
  slugOrLocation?: string | null,
) {
  const allMenus = [...(navigation.header || []), ...(navigation.footer || [])];
  if (!slugOrLocation) {
    return allMenus[0] || null;
  }
  return (
    allMenus.find(
      menu =>
        menu.slug === slugOrLocation ||
        menu.location === slugOrLocation ||
        menu.title === slugOrLocation,
    ) || null
  );
}

function renderHighlights(
  highlights: PortalHighlight[],
  limit?: number,
  labels?: {
    emptyMessage?: string;
    datasetFallbackLabel?: string;
    latestPeriodLabel?: string;
  },
) {
  const visible = highlights.slice(0, limit || highlights.length);
  if (!visible.length) {
    return (
      <Empty
        description={
          labels?.emptyMessage || t('No highlights are available yet.')
        }
      />
    );
  }
  return (
    <MetricsGrid>
      {visible.map(highlight => (
        <MetricCard
          key={`${highlight.canonical_metric_key}-${highlight.period}`}
        >
          <MetricValue>{highlight.value}</MetricValue>
          <MetricLabel>{highlight.indicator_name}</MetricLabel>
          <MetricMeta>
            <Tag>
              {highlight.dataset_name ||
                labels?.datasetFallbackLabel ||
                t('Dataset')}
            </Tag>
            <Tag>
              {highlight.period || labels?.latestPeriodLabel || t('Latest')}
            </Tag>
          </MetricMeta>
        </MetricCard>
      ))}
    </MetricsGrid>
  );
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextContent(content?: string | null) {
  const raw = (content || '').trim();
  if (!raw) {
    return '';
  }
  if (typeof document === 'undefined') {
    return raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const container = document.createElement('div');
  container.innerHTML = sanitizeHtml(raw);
  return (container.textContent || '').replace(/\s+/g, ' ').trim();
}

function meaningfulTextValue(
  text?: string | null,
  html?: string | null,
): string {
  return plainTextContent(html) || plainTextContent(text);
}

function isGenericChartTitle(title: string, chartName?: string | null) {
  const normalizedTitle = plainTextContent(title).toLowerCase();
  if (!normalizedTitle) {
    return true;
  }
  if (normalizedTitle === 'chart') {
    return true;
  }
  const normalizedChartName = plainTextContent(chartName).toLowerCase();
  return Boolean(
    normalizedChartName && normalizedTitle === normalizedChartName,
  );
}

function contentFieldHtml(block: PortalPageBlock, field: string) {
  return block.content?.[`${field}_html`] || undefined;
}

function settingsFieldHtml(block: PortalPageBlock, field: string) {
  return block.settings?.[`${field}_html`] || undefined;
}

function normalizeInlineRichContent(
  content?: string | null,
  allowLinks = true,
) {
  const html = (content || '').trim();
  if (!html) {
    return '';
  }

  const sanitized = sanitizeHtml(html);
  const inlineBlockTags = new Set([
    'P',
    'DIV',
    'BLOCKQUOTE',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
  ]);

  if (typeof document === 'undefined') {
    return sanitized
      .replace(
        /<\/(p|div|blockquote|h[1-6])>\s*<(p|div|blockquote|h[1-6])>/gi,
        '<br /><br />',
      )
      .replace(/<\/?(p|div|blockquote|h[1-6])>/gi, '')
      .replace(/<li>/gi, '&#8226; ')
      .replace(/<\/li>\s*/gi, '<br />')
      .replace(/<\/?(ul|ol)>/gi, '')
      .replace(allowLinks ? /$^/ : /<\/?a\b[^>]*>/gi, '')
      .replace(/(?:<br\s*\/?>\s*)+$/gi, '')
      .trim();
  }

  const container = document.createElement('div');
  container.innerHTML = sanitized;

  const toInlineHtml = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent || '');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const element = node as HTMLElement;
    const childrenHtml = Array.from(element.childNodes)
      .map(child => toInlineHtml(child))
      .join('');

    if (element.tagName === 'BR') {
      return '<br />';
    }

    if (element.tagName === 'UL' || element.tagName === 'OL') {
      return Array.from(element.children)
        .map(child => {
          const childHtml = Array.from(child.childNodes)
            .map(item => toInlineHtml(item))
            .join('');
          return childHtml ? `&#8226; ${childHtml}` : '';
        })
        .filter(Boolean)
        .join('<br />');
    }

    if (element.tagName === 'LI') {
      return childrenHtml ? `&#8226; ${childrenHtml}` : '';
    }

    if (inlineBlockTags.has(element.tagName)) {
      return childrenHtml ? `${childrenHtml}<br />` : '';
    }

    if (!allowLinks && element.tagName === 'A') {
      return childrenHtml;
    }

    const clone = element.cloneNode(false) as HTMLElement;
    clone.innerHTML = childrenHtml;
    return clone.outerHTML;
  };

  return Array.from(container.childNodes)
    .map(node => toInlineHtml(node))
    .join('')
    .replace(/(?:<br\s*\/?>\s*)+$/gi, '')
    .trim();
}

export function groupBlocksBySlot(blocks: PortalPageBlock[]) {
  return cloneBlockTree(blocks).reduce<Record<string, PortalPageBlock[]>>(
    (acc, block) => {
      const slot = block.slot || 'content';
      if (!acc[slot]) {
        acc[slot] = [];
      }
      acc[slot].push(block);
      return acc;
    },
    {
      header: [],
      hero: [],
      content: [],
      sidebar: [],
      cta: [],
      footer: [],
    },
  );
}

type RenderBlockTreeProps = {
  blocks: PortalPageBlock[];
  charts: PortalChartSummary[];
  dashboards: PortalDashboardSummary[];
  editorBlockTypes?: PortalBlockDefinition[];
  chartEmbedAccess?: 'public' | 'authenticated';
  mediaAssets?: PortalMediaAsset[];
  page?: PortalPage | null;
  navigation?: {
    header: PortalNavigationMenu[];
    footer: PortalNavigationMenu[];
  };
  highlights?: PortalHighlight[];
  onNavigate?: (path?: string | null, openInNewTab?: boolean) => void;
  onOpenDashboard?: (dashboard: PortalDashboardSummary) => void;
  mode?: 'public' | 'editor';
  selectedBlockUid?: string | null;
  onSelectBlock?: (block: PortalPageBlock) => void;
  onResizeBlock?: (
    block: PortalPageBlock,
    patch: { gridSpan: number; minHeight: number },
  ) => void;
  onInlineRichTextChange?: (
    block: PortalPageBlock,
    html: string,
    field?: 'body' | 'quote',
  ) => void;
  onInsertBlockFromCanvas?: (
    block: PortalPageBlock,
    mode: 'after' | 'child',
  ) => void;
  onInsertBlockTypeFromCanvas?: (
    block: PortalPageBlock,
    mode: 'after' | 'child',
    blockType: string,
  ) => void;
  onInsertGridTemplateFromCanvas?: (
    block: PortalPageBlock,
    columnCount: number,
  ) => void;
  onDeleteBlockFromCanvas?: (block: PortalPageBlock) => void;
};

export function RenderBlockTree({
  blocks,
  charts,
  dashboards,
  editorBlockTypes = [],
  chartEmbedAccess = 'public',
  mediaAssets = [],
  page = null,
  navigation = { header: [], footer: [] },
  highlights = [],
  onNavigate,
  onOpenDashboard,
  mode = 'public',
  selectedBlockUid = null,
  onSelectBlock,
  onResizeBlock,
  onInlineRichTextChange,
  onInsertBlockFromCanvas,
  onInsertBlockTypeFromCanvas,
  onInsertGridTemplateFromCanvas,
  onDeleteBlockFromCanvas,
}: RenderBlockTreeProps) {
  const [resizePreview, setResizePreview] = useState<{
    blockId: string;
    gridSpan: number;
    minHeight: number;
  } | null>(null);
  const suppressSelectionRef = useRef(false);
  const editorInsertMenuItems = useMemo(
    () => buildEditorInsertMenuItems(editorBlockTypes),
    [editorBlockTypes],
  );
  const hasEditorInsertMenu = Boolean(
    editorInsertMenuItems && editorInsertMenuItems.length,
  );

  function scheduleSelectionRelease() {
    if (typeof window === 'undefined') {
      suppressSelectionRef.current = false;
      return;
    }
    window.setTimeout(() => {
      suppressSelectionRef.current = false;
    }, 0);
  }

  function blockId(block: PortalPageBlock) {
    return block.uid || String(block.id || '');
  }

  function blockSpan(block: PortalPageBlock, fallback = 12) {
    if (resizePreview?.blockId === blockId(block)) {
      return resizePreview.gridSpan;
    }
    const configured = Number(block.settings?.gridSpan);
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(Math.max(Math.round(configured), 1), 12);
    }
    return Math.min(Math.max(Math.round(fallback), 1), 12);
  }

  function blockMinHeight(block: PortalPageBlock) {
    if (resizePreview?.blockId === blockId(block)) {
      const previewHeight = Number(resizePreview.minHeight);
      if (Number.isFinite(previewHeight) && previewHeight > 0) {
        return Math.round(previewHeight);
      }
      return undefined;
    }
    const configured = Number(
      block.settings?.minHeight ?? block.styles?.minHeight ?? 0,
    );
    if (!Number.isFinite(configured) || configured <= 0) {
      return undefined;
    }
    return Math.round(configured);
  }

  function blockFrameHeight(block: PortalPageBlock, fallback: number) {
    return Math.max(
      fallback,
      positiveNumberOrUndefined(block.settings?.height) || 0,
      blockMinHeight(block) || 0,
    );
  }

  function blockRowMinHeight(block: PortalPageBlock) {
    return (
      positiveNumberOrUndefined(block.settings?.rowMinHeight) ||
      blockMinHeight(block)
    );
  }

  function renderChildrenGrid(
    childBlocks: PortalPageBlock[],
    fallbackSpan = 12,
    parentBlock?: PortalPageBlock,
  ) {
    const visibleBlocks = (childBlocks || []).filter(
      child => child.status !== 'hidden',
    );
    if (!visibleBlocks.length) {
      if (mode === 'editor' && parentBlock) {
        const label =
          parentBlock.metadata?.label || parentBlock.block_type || t('Block');
        return (
          <EditorEmptyState>
            <EditorEmptyStateCopy>
              <EditorEmptyStateTitle>
                {t('This block is empty.')}
              </EditorEmptyStateTitle>
              <EditorEmptyStateDescription>
                {t(
                  'Add text, media, charts, dashboards, or a grid layout inside %s.',
                  label,
                )}
              </EditorEmptyStateDescription>
            </EditorEmptyStateCopy>
            <EditorInlineActions $visible>
              {renderInsertControl(blockId(parentBlock), parentBlock, 'child', {
                label: t('+ Add Content'),
                ariaLabel: t('Add content inside %s', label),
                accent: true,
              })}
              {renderGridTemplateControls(parentBlock, label)}
              {renderDeleteControl(parentBlock, label)}
            </EditorInlineActions>
          </EditorEmptyState>
        );
      }
      return null;
    }
    return (
      <BlockGrid data-block-grid="true">
        {visibleBlocks.map(child => {
          const renderedChild = renderBlock(child);
          if (!renderedChild) {
            return null;
          }
          const childNode =
            mode === 'editor' && renderedChild.type !== EditorSelectable
              ? wrapEditorBlock(child, renderedChild)
              : renderedChild;
          return (
            <BlockGridCell
              key={`cell-${child.uid || child.id}`}
              data-block-cell="true"
              $span={blockSpan(child, fallbackSpan)}
              $minHeight={blockMinHeight(child)}
            >
              {childNode}
            </BlockGridCell>
          );
        })}
      </BlockGrid>
    );
  }

  function renderRichContent(content?: string | null, fallback?: string) {
    const html = (content || '').trim();
    if (html) {
      return (
        <RichTextBlock
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
        />
      );
    }
    return <SafeMarkdown source={fallback || ''} />;
  }

  function renderInlineRichContent(
    content?: string | null,
    fallback?: string,
    options?: { as?: 'span' | 'div'; allowLinks?: boolean },
  ) {
    const html = normalizeInlineRichContent(
      content,
      options?.allowLinks ?? true,
    );
    if (html) {
      return (
        <RichTextInline
          as={options?.as || 'span'}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    return fallback || null;
  }

  function stopCanvasAction(
    event:
      | {
          preventDefault?: () => void;
          stopPropagation?: () => void;
        }
      | undefined,
  ) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
  }

  function renderInsertControl(
    key: string,
    block: PortalPageBlock,
    mode: 'after' | 'child',
    options?: {
      label?: string;
      ariaLabel?: string;
      accent?: boolean;
    },
  ) {
    const buttonLabel =
      options?.label ||
      (mode === 'child' ? t('+ Add Content') : t('+ Add After'));
    const ariaLabel =
      options?.ariaLabel ||
      (mode === 'child'
        ? t('Add content inside %s', block.metadata?.label || block.block_type)
        : t('Add content after %s', block.metadata?.label || block.block_type));
    if (hasEditorInsertMenu && onInsertBlockTypeFromCanvas) {
      return (
        <Dropdown
          key={`${key}-insert`}
          trigger={['click']}
          placement="bottomRight"
          menu={{
            items: editorInsertMenuItems,
            onClick: ({ key: blockType, domEvent }) => {
              stopCanvasAction(domEvent);
              onInsertBlockTypeFromCanvas(block, mode, String(blockType || ''));
            },
          }}
        >
          <EditorInlineActionButton
            type="button"
            $accent={options?.accent}
            aria-label={ariaLabel}
            onClick={event => stopCanvasAction(event)}
          >
            {buttonLabel}
          </EditorInlineActionButton>
        </Dropdown>
      );
    }
    if (!onInsertBlockFromCanvas) {
      return null;
    }
    return (
      <EditorInlineActionButton
        key={`${key}-insert`}
        type="button"
        $accent={options?.accent}
        aria-label={ariaLabel}
        onClick={event => {
          stopCanvasAction(event);
          onInsertBlockFromCanvas(block, mode);
        }}
      >
        {buttonLabel}
      </EditorInlineActionButton>
    );
  }

  function renderGridTemplateControls(
    block: PortalPageBlock,
    label: string,
  ): JSX.Element[] | null {
    if (
      !isContainerBlock(block.block_type) ||
      !onInsertGridTemplateFromCanvas
    ) {
      return null;
    }
    return [1, 2, 3, 4].map(columnCount => (
      <EditorInlineActionButton
        key={`${blockId(block)}-grid-${columnCount}`}
        type="button"
        aria-label={t('Insert a %s-column row inside %s', columnCount, label)}
        onClick={event => {
          stopCanvasAction(event);
          onInsertGridTemplateFromCanvas(block, columnCount);
        }}
      >
        {t('%s Col', columnCount)}
      </EditorInlineActionButton>
    ));
  }

  function renderDeleteControl(
    block: PortalPageBlock,
    label: string,
  ): JSX.Element | null {
    if (!onDeleteBlockFromCanvas) {
      return null;
    }
    return (
      <EditorInlineActionButton
        key={`${blockId(block)}-delete`}
        type="button"
        aria-label={t('Delete %s', label)}
        onClick={event => {
          stopCanvasAction(event);
          onDeleteBlockFromCanvas(block);
        }}
      >
        {t('Delete')}
      </EditorInlineActionButton>
    );
  }

  function wrapEditorBlock(
    block: PortalPageBlock,
    rendered: JSX.Element,
  ): JSX.Element {
    if (mode !== 'editor') {
      return rendered;
    }
    const currentBlockId = blockId(block);
    const label = block.metadata?.label || block.block_type || t('Block');
    const isContainer = isContainerBlock(block.block_type);
    const isResizeVisible =
      selectedBlockUid === currentBlockId ||
      resizePreview?.blockId === currentBlockId;
    const resizeHandles: Array<{
      direction: ResizeDirection;
      label: string;
    }> = [
      { direction: 'n', label: t('Resize top %s', label) },
      { direction: 's', label: t('Resize bottom %s', label) },
      { direction: 'e', label: t('Resize right %s', label) },
      { direction: 'w', label: t('Resize left %s', label) },
      { direction: 'ne', label: t('Resize top right %s', label) },
      { direction: 'nw', label: t('Resize top left %s', label) },
      { direction: 'se', label: t('Resize bottom right %s', label) },
      { direction: 'sw', label: t('Resize bottom left %s', label) },
    ];

    function beginResize(
      event: React.MouseEvent<HTMLButtonElement>,
      direction: ResizeDirection,
    ) {
      event.preventDefault();
      event.stopPropagation();
      suppressSelectionRef.current = true;

      const handleElement = event.currentTarget;
      const blockCell = handleElement.closest(
        '[data-block-cell="true"]',
      ) as HTMLElement | null;
      const blockGrid = handleElement.closest(
        '[data-block-grid="true"]',
      ) as HTMLElement | null;

      if (!blockCell || !blockGrid) {
        return;
      }

      const startX = event.clientX;
      const startY = event.clientY;
      const cellRect = blockCell.getBoundingClientRect();
      const gridRect = blockGrid.getBoundingClientRect();
      const gridStyles = window.getComputedStyle(blockGrid);
      const gridGap =
        Number.parseFloat(gridStyles.columnGap || gridStyles.gap || '18') || 18;
      const totalColumns = 12;
      const columnWidth = Math.max(
        (gridRect.width - gridGap * (totalColumns - 1)) / totalColumns,
        1,
      );
      const baseMinHeight =
        blockMinHeight(block) || Math.max(Math.round(cellRect.height), 0);

      const computeResizeValues = (clientX: number, clientY: number) => {
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        const horizontalDelta = direction.includes('e')
          ? deltaX
          : direction.includes('w')
            ? -deltaX
            : 0;
        const verticalDelta = direction.includes('s')
          ? deltaY
          : direction.includes('n')
            ? -deltaY
            : 0;
        const nextWidth = Math.max(
          columnWidth,
          cellRect.width + horizontalDelta,
        );
        const nextGridSpan =
          horizontalDelta === 0
            ? blockSpan(block)
            : Math.min(
                totalColumns,
                Math.max(
                  1,
                  Math.round((nextWidth + gridGap) / (columnWidth + gridGap)),
                ),
              );
        const nextMinHeight =
          verticalDelta === 0
            ? blockMinHeight(block) || 0
            : Math.max(
                0,
                Math.round((baseMinHeight + verticalDelta) / 20) * 20,
              );
        return {
          gridSpan: nextGridSpan,
          minHeight: nextMinHeight,
        };
      };

      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = resizeCursor(direction);

      const cleanup = () => {
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const nextValues = computeResizeValues(
          moveEvent.clientX,
          moveEvent.clientY,
        );
        setResizePreview({
          blockId: currentBlockId,
          ...nextValues,
        });
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        upEvent.preventDefault();
        const nextValues = computeResizeValues(
          upEvent.clientX,
          upEvent.clientY,
        );
        cleanup();
        setResizePreview(null);
        onResizeBlock?.(block, nextValues);
        scheduleSelectionRelease();
      };

      setResizePreview({
        blockId: currentBlockId,
        gridSpan: blockSpan(block),
        minHeight: blockMinHeight(block) || 0,
      });
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return (
      <EditorSelectable
        key={`editor-${currentBlockId}`}
        $selected={selectedBlockUid === currentBlockId}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          if (suppressSelectionRef.current) {
            suppressSelectionRef.current = false;
            return;
          }
          onSelectBlock?.(block);
        }}
      >
        <EditorSelectableHeader>
          <EditorSelectableLabel>{label}</EditorSelectableLabel>
          <EditorInlineActions
            className="cms-editor-inline-actions"
            $visible={selectedBlockUid === currentBlockId}
          >
            {renderInsertControl(
              currentBlockId,
              block,
              isContainer ? 'child' : 'after',
              {
                label: isContainer ? t('+ Add Content') : t('+ Add After'),
                ariaLabel: isContainer
                  ? t('Add content inside %s', label)
                  : t('Add content after %s', label),
                accent: true,
              },
            )}
            {renderGridTemplateControls(block, label)}
            {renderDeleteControl(block, label)}
          </EditorInlineActions>
        </EditorSelectableHeader>
        <EditorCanvasBody>{rendered}</EditorCanvasBody>
        <EditorResizeFrame
          className="cms-editor-resize-frame"
          $visible={isResizeVisible}
        />
        {resizeHandles.map(handle => (
          <EditorResizeHandle
            key={`${currentBlockId}-${handle.direction}`}
            className="cms-editor-resize-handle"
            data-resize-direction={handle.direction}
            type="button"
            aria-label={handle.label}
            $direction={handle.direction}
            $visible={isResizeVisible}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              scheduleSelectionRelease();
            }}
            onMouseDown={event => beginResize(event, handle.direction)}
          />
        ))}
      </EditorSelectable>
    );
  }

  function isSelectedForInlineEditing(block: PortalPageBlock) {
    const currentBlockId = blockId(block);
    return (
      mode === 'editor' &&
      selectedBlockUid === currentBlockId &&
      typeof onInlineRichTextChange === 'function'
    );
  }

  function renderInlineBodyEditor(
    block: PortalPageBlock,
    value: string,
    field: 'body' | 'quote' = 'body',
    minHeight = 180,
  ) {
    return (
      <RichTextComposer
        value={value}
        minHeight={minHeight}
        helperText={t(
          'Formatting updates the selected block directly in the page canvas.',
        )}
        onChange={html => onInlineRichTextChange?.(block, html, field)}
      />
    );
  }

  function renderBlock(block: PortalPageBlock): JSX.Element | null {
    if (block.status === 'hidden') {
      return null;
    }
    const style = blockStyle(block);
    const className = blockClassName(block);
    const title = block.content?.title;
    const subtitle = block.content?.subtitle;
    const body = block.content?.body;
    const titleHtml = contentFieldHtml(block, 'title');
    const subtitleHtml = contentFieldHtml(block, 'subtitle');
    const eyebrowHtml = contentFieldHtml(block, 'eyebrow');
    const textHtml = contentFieldHtml(block, 'text');
    const itemsHtml = contentFieldHtml(block, 'items');
    const citationHtml = contentFieldHtml(block, 'citation');
    const captionHtml = contentFieldHtml(block, 'caption');
    const buttonLabelHtml = contentFieldHtml(block, 'buttonLabel');
    const labelHtml = contentFieldHtml(block, 'label');
    const valueHtml = contentFieldHtml(block, 'value');
    const bodyHtml = block.content?.html || block.content?.body_html;
    const primaryActionLabelHtml = settingsFieldHtml(
      block,
      'primaryActionLabel',
    );
    const secondaryActionLabelHtml = settingsFieldHtml(
      block,
      'secondaryActionLabel',
    );

    if (block.settings?.render_error) {
      return (
        <SurfaceCard
          key={block.uid || block.id}
          className={className}
          style={style}
        >
          <CardTitle>{title || t('Unavailable block')}</CardTitle>
          <CardBody>{block.settings.render_error}</CardBody>
        </SurfaceCard>
      );
    }

    switch (block.block_type) {
      case 'reusable_reference': {
        const reusableBlocks = block.reusable_block?.blocks || [];
        return wrapEditorBlock(
          block,
          <div key={block.uid || block.id} className={className} style={style}>
            {reusableBlocks.length ? (
              <RenderBlockTree
                blocks={reusableBlocks}
                charts={charts}
                dashboards={dashboards}
                mediaAssets={mediaAssets}
                page={page}
                navigation={navigation}
                highlights={highlights}
                onNavigate={onNavigate}
                onOpenDashboard={onOpenDashboard}
                mode="public"
              />
            ) : (
              <SurfaceCard>
                <CardTitle>
                  {block.content?.title ||
                    block.reusable_block?.title ||
                    t('Reusable Section')}
                </CardTitle>
                <CardBody>
                  {block.settings?.render_error ||
                    t('This synced section is not available yet.')}
                </CardBody>
              </SurfaceCard>
            )}
          </div>,
        );
      }
      case 'section': {
        const sectionColumns = Number(block.settings?.columns) || 1;
        const sectionSpan =
          sectionColumns > 1
            ? Math.max(Math.floor(12 / sectionColumns), 1)
            : 12;
        return (
          <Section
            key={block.uid || block.id}
            id={block.settings?.anchor || undefined}
            className={className}
            style={{
              ...style,
              background: block.settings?.background || undefined,
              padding: block.styles?.padding || undefined,
            }}
          >
            {(title || titleHtml || subtitle || subtitleHtml) && (
              <SectionHeader>
                <SectionTitleGroup>
                  {title || titleHtml ? (
                    <SectionTitle>
                      {renderInlineRichContent(titleHtml, title)}
                    </SectionTitle>
                  ) : null}
                  {subtitle || subtitleHtml ? (
                    <SectionSubtitle>
                      {renderInlineRichContent(subtitleHtml, subtitle)}
                    </SectionSubtitle>
                  ) : null}
                </SectionTitleGroup>
              </SectionHeader>
            )}
            {renderChildrenGrid(block.children || [], sectionSpan, block)}
          </Section>
        );
      }
      case 'hero':
        return (
          <Hero key={block.uid || block.id} className={className} style={style}>
            <div>
              {block.content?.eyebrow || eyebrowHtml ? (
                <Eyebrow>
                  {renderInlineRichContent(eyebrowHtml, block.content?.eyebrow)}
                </Eyebrow>
              ) : null}
              <HeroTitle>
                {renderInlineRichContent(
                  titleHtml,
                  block.content?.title || t('Hero Title'),
                )}
              </HeroTitle>
              {block.content?.subtitle || subtitleHtml ? (
                <HeroSubtitle>
                  {renderInlineRichContent(
                    subtitleHtml,
                    block.content?.subtitle,
                  )}
                </HeroSubtitle>
              ) : null}
              {body || bodyHtml ? (
                <CardBody style={{ marginTop: 16 }}>
                  {renderRichContent(bodyHtml, body)}
                </CardBody>
              ) : null}
              {mode === 'public' ? (
                <HeroActions>
                  {block.settings?.primaryActionUrl ? (
                    <Button
                      type="primary"
                      size="large"
                      onClick={() =>
                        onNavigate?.(block.settings?.primaryActionUrl, false)
                      }
                    >
                      {renderInlineRichContent(
                        primaryActionLabelHtml,
                        block.settings?.primaryActionLabel || t('Learn more'),
                        { allowLinks: false },
                      )}
                    </Button>
                  ) : null}
                  {block.settings?.secondaryActionUrl ? (
                    <Button
                      size="large"
                      onClick={() =>
                        onNavigate?.(block.settings?.secondaryActionUrl, false)
                      }
                    >
                      {renderInlineRichContent(
                        secondaryActionLabelHtml,
                        block.settings?.secondaryActionLabel || t('Open'),
                        { allowLinks: false },
                      )}
                    </Button>
                  ) : null}
                </HeroActions>
              ) : null}
            </div>
            <div>{renderChildrenGrid(block.children || [], 12, block)}</div>
          </Hero>
        );
      case 'group':
      case 'column': {
        const containerColumns = Number(block.settings?.columnCount) || 1;
        const containerSpan =
          containerColumns > 1
            ? Math.max(Math.floor(12 / containerColumns), 1)
            : 12;
        return (
          <Section
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {(title || titleHtml || subtitle || subtitleHtml) && (
              <SectionHeader>
                <SectionTitleGroup>
                  {title || titleHtml ? (
                    <SectionTitle>
                      {renderInlineRichContent(titleHtml, title)}
                    </SectionTitle>
                  ) : null}
                  {subtitle || subtitleHtml ? (
                    <SectionSubtitle>
                      {renderInlineRichContent(subtitleHtml, subtitle)}
                    </SectionSubtitle>
                  ) : null}
                </SectionTitleGroup>
              </SectionHeader>
            )}
            {renderChildrenGrid(block.children || [], containerSpan, block)}
          </Section>
        );
      }
      case 'columns': {
        const columnCount =
          Number(block.settings?.columnCount) ||
          Math.max(block.children.length, 1);
        const columnSpan =
          columnCount > 1 ? Math.max(Math.floor(12 / columnCount), 1) : 12;
        const rowMinHeight = blockRowMinHeight(block);
        const visibleChildren = (block.children || []).filter(
          child => child.status !== 'hidden',
        );
        return (
          <BlockGrid
            key={block.uid || block.id}
            data-block-grid="true"
            className={className}
            style={{
              ...style,
              gap: block.settings?.gap || style?.gap,
            }}
          >
            {visibleChildren.length ? (
              visibleChildren.map(child => {
                const renderedChild = renderBlock(child);
                if (!renderedChild) {
                  return null;
                }
                const childNode =
                  mode === 'editor' && renderedChild.type !== EditorSelectable
                    ? wrapEditorBlock(child, renderedChild)
                    : renderedChild;
                return (
                  <BlockGridCell
                    key={`cell-${child.uid || child.id}`}
                    data-block-cell="true"
                    $span={blockSpan(child, columnSpan)}
                    $minHeight={blockMinHeight(child) || rowMinHeight}
                  >
                    {childNode}
                  </BlockGridCell>
                );
              })
            ) : (
              <BlockGridCell data-block-cell="true" $span={12}>
                {renderChildrenGrid([], 12, block)}
              </BlockGridCell>
            )}
          </BlockGrid>
        );
      }
      case 'card':
        return wrapEditorBlock(
          block,
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title || titleHtml ? (
              <CardTitle>{renderInlineRichContent(titleHtml, title)}</CardTitle>
            ) : null}
            {body || bodyHtml ? (
              <CardBody>
                {isSelectedForInlineEditing(block)
                  ? renderInlineBodyEditor(
                      block,
                      bodyHtml || block.content?.body || body || '',
                    )
                  : renderRichContent(bodyHtml, body)}
              </CardBody>
            ) : null}
            {renderChildrenGrid(block.children || [], 12, block)}
            {(block.content?.buttonLabel || buttonLabelHtml) &&
            block.settings?.buttonUrl ? (
              <Button
                type="primary"
                style={{ marginTop: 16 }}
                onClick={() => onNavigate?.(block.settings?.buttonUrl, false)}
              >
                {renderInlineRichContent(
                  buttonLabelHtml,
                  block.content?.buttonLabel,
                  { allowLinks: false },
                )}
              </Button>
            ) : null}
          </SurfaceCard>,
        );
      case 'heading':
        return wrapEditorBlock(
          block,
          <SectionTitle
            key={block.uid || block.id}
            className={className}
            style={style}
            as={
              `h${Math.min(Math.max(Number(block.content?.level) || 2, 1), 6)}` as never
            }
          >
            {renderInlineRichContent(
              textHtml || titleHtml,
              block.content?.text || title || t('Heading'),
            )}
          </SectionTitle>,
        );
      case 'paragraph':
      case 'rich_text':
        return wrapEditorBlock(
          block,
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <CardBody>
              {isSelectedForInlineEditing(block)
                ? renderInlineBodyEditor(
                    block,
                    bodyHtml || block.content?.body || body || '',
                    'body',
                    220,
                  )
                : renderRichContent(
                    bodyHtml,
                    block.content?.body || body || t('No content yet.'),
                  )}
            </CardBody>
          </SurfaceCard>,
        );
      case 'page_title':
        return (
          <Section
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <SectionHeader>
              <SectionTitleGroup>
                <SectionTitle>
                  {page?.title || title || t('Untitled page')}
                </SectionTitle>
                {(block.settings?.showSubtitle ?? true) && page?.subtitle ? (
                  <SectionSubtitle>{page.subtitle}</SectionSubtitle>
                ) : null}
                {block.settings?.showExcerpt && page?.excerpt ? (
                  <CardBody>{page.excerpt}</CardBody>
                ) : null}
              </SectionTitleGroup>
            </SectionHeader>
          </Section>
        );
      case 'breadcrumb':
        return (
          <BreadcrumbNav
            key={block.uid || block.id}
            className={className}
            style={style}
            aria-label={t('Breadcrumb')}
          >
            {(page?.breadcrumbs || []).map((crumb, index) => {
              const isLast = index === (page?.breadcrumbs || []).length - 1;
              if (isLast && block.settings?.showCurrentPage === false) {
                return null;
              }
              return (
                <span key={`${crumb.path}-${index}`}>
                  {index > 0 ? ' / ' : null}
                  <BreadcrumbItem
                    type="button"
                    onClick={() => onNavigate?.(crumb.path, false)}
                    disabled={!crumb.path || isLast}
                  >
                    {crumb.title || crumb.slug || t('Page')}
                  </BreadcrumbItem>
                </span>
              );
            })}
          </BreadcrumbNav>
        );
      case 'list':
        return wrapEditorBlock(
          block,
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <CardBody>
              {renderRichContent(
                itemsHtml || bodyHtml,
                block.content?.items || body || '',
              )}
            </CardBody>
          </SurfaceCard>,
        );
      case 'quote':
        return wrapEditorBlock(
          block,
          <Quote
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {isSelectedForInlineEditing(block)
              ? renderInlineBodyEditor(
                  block,
                  bodyHtml || block.content?.quote || body || '',
                  'quote',
                  140,
                )
              : renderRichContent(bodyHtml, block.content?.quote || body || '')}
            {block.content?.citation || citationHtml ? (
              <footer>
                {renderInlineRichContent(citationHtml, block.content?.citation)}
              </footer>
            ) : null}
          </Quote>,
        );
      case 'image': {
        const asset = lookupAsset(block, mediaAssets);
        const imageUrl = block.content?.url || asset?.download_url;
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title || titleHtml ? (
              <CardTitle>{renderInlineRichContent(titleHtml, title)}</CardTitle>
            ) : null}
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={
                  block.content?.alt || asset?.alt_text || title || t('Image')
                }
                style={{ width: '100%', display: 'block' }}
              />
            ) : (
              <Empty description={t('No image configured yet.')} />
            )}
            {block.content?.caption || captionHtml || asset?.caption ? (
              <CardBody>
                {renderRichContent(
                  captionHtml,
                  block.content?.caption || asset?.caption,
                )}
              </CardBody>
            ) : null}
          </SurfaceCard>
        );
      }
      case 'gallery':
        return (
          <Grid
            key={block.uid || block.id}
            className={className}
            style={style}
            $columns={Number(block.settings?.columns) || 3}
          >
            {(block.content?.images || []).length ? (
              (block.content.images || []).map(
                (image: Record<string, string>, index: number) => (
                  <SurfaceCard key={`${block.uid || block.id}-${index}`}>
                    <img
                      src={image.url}
                      alt={image.alt || t('Gallery image')}
                      style={{ width: '100%', display: 'block' }}
                    />
                  </SurfaceCard>
                ),
              )
            ) : (
              <Empty description={t('No gallery images configured yet.')} />
            )}
          </Grid>
        );
      case 'file':
      case 'download': {
        const asset = lookupAsset(block, mediaAssets);
        const downloadUrl = block.settings?.download_url || asset?.download_url;
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <CardTitle>
              {renderInlineRichContent(
                titleHtml,
                title || asset?.title || t('Download file'),
              )}
            </CardTitle>
            {body || bodyHtml ? (
              <CardBody>{renderRichContent(bodyHtml, body)}</CardBody>
            ) : null}
            {downloadUrl ? (
              <Button
                type={block.block_type === 'download' ? 'primary' : 'default'}
                onClick={() =>
                  onNavigate?.(
                    downloadUrl,
                    block.settings?.open_in_new_tab === true,
                  )
                }
              >
                {renderInlineRichContent(
                  buttonLabelHtml || labelHtml,
                  block.content?.buttonLabel ||
                    block.content?.label ||
                    t('Download'),
                  { allowLinks: false },
                )}
              </Button>
            ) : (
              <Empty
                description={t('Choose a file asset to render this block.')}
              />
            )}
            {asset ? (
              <FileMeta>
                {asset.original_filename ? (
                  <span>{asset.original_filename}</span>
                ) : null}
                {asset.file_extension ? (
                  <Tag>{asset.file_extension.toUpperCase()}</Tag>
                ) : null}
                {asset.file_size ? (
                  <span>{`${Math.max(asset.file_size / 1024, 1).toFixed(0)} KB`}</span>
                ) : null}
              </FileMeta>
            ) : null}
          </SurfaceCard>
        );
      }
      case 'button':
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <Button
              type={
                (block.settings?.variant as
                  | 'default'
                  | 'primary'
                  | 'dashed'
                  | 'link'
                  | 'text') || 'primary'
              }
              onClick={() => onNavigate?.(block.settings?.url, false)}
            >
              {renderInlineRichContent(
                labelHtml || titleHtml,
                block.content?.label || title || t('Open link'),
                { allowLinks: false },
              )}
            </Button>
          </SurfaceCard>
        );
      case 'menu': {
        const menu = findMenu(
          navigation,
          block.settings?.menu_slug || block.settings?.location,
        );
        const items = menu?.items || [];
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title || titleHtml ? (
              <CardTitle>{renderInlineRichContent(titleHtml, title)}</CardTitle>
            ) : null}
            {items.length ? (
              <MenuList $vertical={block.settings?.orientation === 'vertical'}>
                {items.map(item => (
                  <MenuLink
                    key={item.id}
                    type="button"
                    onClick={() =>
                      onNavigate?.(item.path, item.open_in_new_tab)
                    }
                  >
                    {item.label}
                  </MenuLink>
                ))}
              </MenuList>
            ) : (
              <Empty description={t('No menu items are available.')} />
            )}
          </SurfaceCard>
        );
      }
      case 'callout':
        return wrapEditorBlock(
          block,
          <CalloutCard
            key={block.uid || block.id}
            className={className}
            style={style}
            $tone={block.settings?.tone}
          >
            {title || titleHtml ? (
              <CardTitle>{renderInlineRichContent(titleHtml, title)}</CardTitle>
            ) : null}
            <CardBody>
              {isSelectedForInlineEditing(block)
                ? renderInlineBodyEditor(
                    block,
                    bodyHtml || block.content?.body || body || '',
                  )
                : renderRichContent(
                    bodyHtml,
                    body || t('Callout content goes here.'),
                  )}
            </CardBody>
          </CalloutCard>,
        );
      case 'statistic':
        return (
          <MetricCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <MetricValue>
              {renderInlineRichContent(valueHtml, block.content?.value || '0')}
            </MetricValue>
            <MetricLabel>
              {renderInlineRichContent(titleHtml, title || t('Statistic'))}
            </MetricLabel>
            {block.content?.caption || captionHtml ? (
              <MetricMeta>
                {renderInlineRichContent(captionHtml, block.content?.caption, {
                  as: 'div',
                })}
              </MetricMeta>
            ) : null}
          </MetricCard>
        );
      case 'divider':
        return (
          <hr
            key={block.uid || block.id}
            className={className}
            style={{
              ...style,
              border: style.border || 0,
              borderTop:
                style.borderTop ||
                `${block.styles?.borderWidth || '1px'} ${
                  block.styles?.borderStyle || 'solid'
                } ${block.styles?.borderColor || 'var(--portal-border)'}`,
            }}
          />
        );
      case 'spacer':
        return (
          <div
            key={block.uid || block.id}
            className={className}
            style={{ ...style, height: blockFrameHeight(block, 48) }}
          />
        );
      case 'embed':
      case 'video':
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title || titleHtml ? (
              <CardTitle>{renderInlineRichContent(titleHtml, title)}</CardTitle>
            ) : null}
            {block.content?.url ? (
              <iframe
                src={block.content.url}
                title={title || block.block_type}
                style={{
                  width: '100%',
                  height: blockFrameHeight(block, 360),
                  border: 0,
                }}
              />
            ) : (
              <Empty description={t('No embed URL configured yet.')} />
            )}
            {block.content?.caption || captionHtml ? (
              <CardBody style={{ marginTop: 16 }}>
                {renderRichContent(captionHtml, block.content?.caption)}
              </CardBody>
            ) : null}
          </SurfaceCard>
        );
      case 'html':
        return wrapEditorBlock(
          block,
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {/* eslint-disable-next-line react/no-danger */}
            <div
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(block.content?.html || ''),
              }}
            />
          </SurfaceCard>,
        );
      case 'table':
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title || titleHtml ? (
              <CardTitle>{renderInlineRichContent(titleHtml, title)}</CardTitle>
            ) : null}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {(block.content?.columns || []).map((column: string) => (
                      <th
                        key={column}
                        style={{
                          textAlign: 'left',
                          padding: '8px 0',
                          borderBottom: '1px solid var(--portal-border)',
                        }}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(block.content?.rows || []).map(
                    (row: string[], index: number) => (
                      <tr key={`${block.uid || block.id}-${index}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} style={{ padding: '8px 0' }}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </SurfaceCard>
        );
      case 'chart': {
        const chart = lookupChart(block, charts);
        const chartIsMapLike = isMapLikeViz(chart?.viz_type);
        const explicitSurfacePreset =
          block.settings?.surface_preset === 'borderless' ||
          block.settings?.surface_preset === 'map_focus'
            ? block.settings?.surface_preset
            : 'default';
        const surfacePreset =
          explicitSurfacePreset !== 'default'
            ? explicitSurfacePreset
            : chartIsMapLike
              ? 'map_focus'
              : 'default';
        const explicitLegendPreset =
          block.settings?.legend_preset === 'horizontal_top' ||
          block.settings?.legend_preset === 'horizontal_bottom' ||
          block.settings?.legend_preset === 'vertical_right' ||
          block.settings?.legend_preset === 'hidden'
            ? block.settings?.legend_preset
            : 'default';
        const legendPreset =
          explicitLegendPreset !== 'default'
            ? explicitLegendPreset
            : chartIsMapLike
              ? 'horizontal_bottom'
              : 'default';
        const borderlessContainer = surfacePreset !== 'default';
        const headerTitleText = meaningfulTextValue(title, titleHtml);
        const headerCaptionText = meaningfulTextValue(
          block.content?.caption,
          captionHtml,
        );
        const showHeader =
          (block.settings?.show_header ?? true) &&
          (headerCaptionText ||
            (headerTitleText &&
              (!chartIsMapLike ||
                !isGenericChartTitle(headerTitleText, chart?.slice_name))));
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={
              borderlessContainer
                ? {
                    ...style,
                    padding: style.padding || 0,
                    border: style.border || 0,
                    background: style.background || 'transparent',
                  }
                : style
            }
          >
            {showHeader ? (
              <div
                style={
                  borderlessContainer ? { padding: '0 0 16px' } : undefined
                }
              >
                {headerTitleText ? (
                  <CardTitle>
                    {renderInlineRichContent(titleHtml, title)}
                  </CardTitle>
                ) : null}
                {headerCaptionText ? (
                  <CardBody>
                    {renderRichContent(captionHtml, block.content?.caption)}
                  </CardBody>
                ) : null}
              </div>
            ) : null}
            {chart ? (
              <PublicChartContainer
                title={chart.slice_name}
                url={chart.url}
                height={blockFrameHeight(block, 360)}
                surfacePreset={surfacePreset}
                legendPreset={legendPreset}
                vizType={chart.viz_type}
                accessMode={chartEmbedAccess}
              />
            ) : (
              <Empty
                description={t('Choose a public chart to render this block.')}
              />
            )}
          </SurfaceCard>
        );
      }
      case 'dashboard': {
        const dashboard = lookupDashboard(block, dashboards);
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title || titleHtml ? (
              <CardTitle>{renderInlineRichContent(titleHtml, title)}</CardTitle>
            ) : null}
            {dashboard ? (
              <>
                <PublicDashboardEmbed
                  title={dashboard.dashboard_title}
                  dashboardId={dashboard.id}
                  dashboardUuid={dashboard.uuid}
                  height={blockFrameHeight(block, 720)}
                  loadingLabel={t('Loading dashboard...')}
                />
                {onOpenDashboard ? (
                  <Button
                    type="link"
                    style={{ paddingInline: 0 }}
                    onClick={() => onOpenDashboard(dashboard)}
                  >
                    {t('Open dashboard')}
                  </Button>
                ) : null}
              </>
            ) : (
              <Empty
                description={t(
                  'Choose a public dashboard to render this block.',
                )}
              />
            )}
          </SurfaceCard>
        );
      }
      case 'dynamic_widget':
        if (block.settings?.widgetType === 'indicator_highlights') {
          return (
            <Section
              key={block.uid || block.id}
              className={className}
              style={style}
            >
              {(title ||
                titleHtml ||
                subtitle ||
                subtitleHtml ||
                block.content?.note ||
                contentFieldHtml(block, 'note')) && (
                <SectionHeader>
                  <SectionTitleGroup>
                    {title || titleHtml ? (
                      <SectionTitle>
                        {renderInlineRichContent(titleHtml, title)}
                      </SectionTitle>
                    ) : null}
                    {subtitle || subtitleHtml ? (
                      <SectionSubtitle>
                        {renderInlineRichContent(subtitleHtml, subtitle)}
                      </SectionSubtitle>
                    ) : null}
                  </SectionTitleGroup>
                  <SectionNote>
                    {renderInlineRichContent(
                      contentFieldHtml(block, 'note'),
                      block.content?.note || t('Latest DHIS2 highlights'),
                    )}
                  </SectionNote>
                </SectionHeader>
              )}
              {renderHighlights(
                highlights,
                Number(block.settings?.limit) || 6,
                {
                  emptyMessage: block.content?.emptyMessage,
                  datasetFallbackLabel: block.content?.datasetFallbackLabel,
                  latestPeriodLabel: block.content?.latestPeriodLabel,
                },
              )}
            </Section>
          );
        }
        if (block.settings?.widgetType === 'dashboard_list') {
          const dashboardEyebrow =
            block.content?.cardEyebrow || t('Public Dashboard');
          const dashboardDescription =
            block.content?.cardDescription ||
            t(
              'Professionally framed for public viewing with embedded access, preserved portal navigation, and reduced chrome.',
            );
          const dashboardActionLabel =
            block.content?.actionLabel || t('Open dashboard');
          const dashboardSlugFallbackLabel =
            block.content?.slugFallbackLabel || t('Embedded access ready');
          const emptyMessage =
            block.content?.emptyMessage ||
            t(
              'No public dashboards are available yet. Publish a dashboard and enable embedding to list it here.',
            );
          return (
            <Section
              key={block.uid || block.id}
              className={className}
              style={style}
            >
              {(title || titleHtml || subtitle || subtitleHtml) && (
                <SectionHeader>
                  <SectionTitleGroup>
                    {title || titleHtml ? (
                      <SectionTitle>
                        {renderInlineRichContent(titleHtml, title)}
                      </SectionTitle>
                    ) : null}
                    {subtitle || subtitleHtml ? (
                      <SectionSubtitle>
                        {renderInlineRichContent(subtitleHtml, subtitle)}
                      </SectionSubtitle>
                    ) : null}
                  </SectionTitleGroup>
                </SectionHeader>
              )}
              {dashboards.length ? (
                <DashboardDirectoryGrid>
                  {dashboards.map(dashboard => (
                    <DashboardDirectoryCard
                      key={dashboard.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenDashboard?.(dashboard)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onOpenDashboard?.(dashboard);
                        }
                      }}
                    >
                      <DashboardDirectoryTop>
                        <DashboardDirectoryEyebrow>
                          {dashboardEyebrow}
                        </DashboardDirectoryEyebrow>
                        <CardTitle>{dashboard.dashboard_title}</CardTitle>
                        <DashboardDirectoryDescription>
                          {dashboardDescription}
                        </DashboardDirectoryDescription>
                      </DashboardDirectoryTop>
                      <DashboardDirectoryFooter>
                        {dashboard.slug ? (
                          <Tag>{dashboard.slug}</Tag>
                        ) : (
                          <SectionNote>
                            {dashboardSlugFallbackLabel}
                          </SectionNote>
                        )}
                        <Button
                          type="primary"
                          onClick={event => {
                            event.stopPropagation();
                            onOpenDashboard?.(dashboard);
                          }}
                        >
                          {dashboardActionLabel}
                        </Button>
                      </DashboardDirectoryFooter>
                    </DashboardDirectoryCard>
                  ))}
                </DashboardDirectoryGrid>
              ) : (
                <SurfaceCard>
                  <Empty description={emptyMessage} />
                </SurfaceCard>
              )}
            </Section>
          );
        }
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title || titleHtml ? (
              <CardTitle>{renderInlineRichContent(titleHtml, title)}</CardTitle>
            ) : null}
            <CardBody>
              {renderRichContent(
                bodyHtml,
                body ||
                  t('This widget renders dynamic portal data at runtime.'),
              )}
            </CardBody>
          </SurfaceCard>
        );
      default:
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title || titleHtml ? (
              <CardTitle>{renderInlineRichContent(titleHtml, title)}</CardTitle>
            ) : null}
            <CardBody>
              {renderRichContent(
                bodyHtml,
                body || t('Unsupported block type.'),
              )}
            </CardBody>
          </SurfaceCard>
        );
    }
  }

  return renderChildrenGrid(blocks, 12);
}
