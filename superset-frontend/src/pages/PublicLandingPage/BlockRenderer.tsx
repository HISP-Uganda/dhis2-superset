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

import { CSSProperties } from 'react';
import { SafeMarkdown } from '@superset-ui/core/components';
import { sanitizeHtml, styled, t } from '@superset-ui/core';
import { Button, Empty, Tag } from 'antd';
import RichTextComposer from 'src/pages/CMSAdminPage/RichTextComposer';
import PublicChartContainer from './PublicChartContainer';
import PublicDashboardEmbed from './PublicDashboardEmbed';
import { cloneBlockTree } from './blockUtils';
import type {
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
  min-width: 0;
  grid-column: span ${({ $span = 12 }) => Math.min(Math.max($span, 1), 12)};
  ${({ $minHeight }) =>
    $minHeight ? `min-height: ${Math.max($minHeight, 0)}px;` : ''}

  @media (max-width: 960px) {
    grid-column: span 1;
  }
`;

const EditorSelectable = styled.div<{ $selected?: boolean }>`
  position: relative;
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
`;

const EditorSelectableLabel = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: var(--portal-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const SurfaceCard = styled.div`
  padding: 18px;
  border-radius: var(--portal-radius-lg, 0);
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
`;

const CardTitle = styled.h3`
  margin: 0 0 8px;
  font-size: 18px;
  letter-spacing: -0.02em;
`;

const CardBody = styled.div`
  color: var(--portal-muted-strong);
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

const CalloutCard = styled(SurfaceCard)<{ $tone?: string }>`
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

function blockStyle(block: PortalPageBlock): CSSProperties {
  return (block.rendering?.inline_style || {}) as CSSProperties;
}

function blockClassName(block: PortalPageBlock) {
  return ['cms-block-shell', block.rendering?.scope_class]
    .filter(Boolean)
    .join(' ');
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

function renderHighlights(highlights: PortalHighlight[], limit?: number) {
  const visible = highlights.slice(0, limit || highlights.length);
  if (!visible.length) {
    return <Empty description={t('No highlights are available yet.')} />;
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
            <Tag>{highlight.dataset_name || t('Dataset')}</Tag>
            <Tag>{highlight.period || t('Latest')}</Tag>
          </MetricMeta>
        </MetricCard>
      ))}
    </MetricsGrid>
  );
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
  onInlineRichTextChange?: (
    block: PortalPageBlock,
    html: string,
    field?: 'body' | 'quote',
  ) => void;
};

export function RenderBlockTree({
  blocks,
  charts,
  dashboards,
  mediaAssets = [],
  page = null,
  navigation = { header: [], footer: [] },
  highlights = [],
  onNavigate,
  onOpenDashboard,
  mode = 'public',
  selectedBlockUid = null,
  onSelectBlock,
  onInlineRichTextChange,
}: RenderBlockTreeProps) {
  function blockSpan(block: PortalPageBlock, fallback = 12) {
    const configured = Number(block.settings?.gridSpan);
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(Math.max(Math.round(configured), 1), 12);
    }
    return Math.min(Math.max(Math.round(fallback), 1), 12);
  }

  function blockMinHeight(block: PortalPageBlock) {
    const configured = Number(
      block.settings?.minHeight ?? block.styles?.minHeight ?? 0,
    );
    if (!Number.isFinite(configured) || configured <= 0) {
      return undefined;
    }
    return Math.round(configured);
  }

  function renderChildrenGrid(
    childBlocks: PortalPageBlock[],
    fallbackSpan = 12,
  ) {
    const visibleBlocks = (childBlocks || []).filter(
      child => child.status !== 'hidden',
    );
    if (!visibleBlocks.length) {
      return null;
    }
    return (
      <BlockGrid>
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
      return <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
    }
    return <SafeMarkdown source={fallback || ''} />;
  }

  function wrapEditorBlock(
    block: PortalPageBlock,
    rendered: JSX.Element,
  ): JSX.Element {
    if (mode !== 'editor') {
      return rendered;
    }
    const blockId = block.uid || String(block.id || '');
    const label = block.metadata?.label || block.block_type || t('Block');
    return (
      <EditorSelectable
        key={`editor-${blockId}`}
        $selected={selectedBlockUid === blockId}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onSelectBlock?.(block);
        }}
      >
        <EditorSelectableLabel>{label}</EditorSelectableLabel>
        {rendered}
      </EditorSelectable>
    );
  }

  function isSelectedForInlineEditing(block: PortalPageBlock) {
    const blockId = block.uid || String(block.id || '');
    return (
      mode === 'editor' &&
      selectedBlockUid === blockId &&
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
            {(title || subtitle) && (
              <SectionHeader>
                <SectionTitleGroup>
                  {title && <SectionTitle>{title}</SectionTitle>}
                  {subtitle && <SectionSubtitle>{subtitle}</SectionSubtitle>}
                </SectionTitleGroup>
              </SectionHeader>
            )}
            {renderChildrenGrid(block.children || [], sectionSpan)}
          </Section>
        );
      }
      case 'hero':
        return (
          <Hero key={block.uid || block.id} className={className} style={style}>
            <div>
              {block.content?.eyebrow && (
                <Eyebrow>{block.content.eyebrow}</Eyebrow>
              )}
              <HeroTitle>{block.content?.title || t('Hero Title')}</HeroTitle>
              {block.content?.subtitle && (
                <HeroSubtitle>{block.content.subtitle}</HeroSubtitle>
              )}
              {body && (
                <CardBody style={{ marginTop: 16 }}>
                  <SafeMarkdown source={body} />
                </CardBody>
              )}
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
                      {block.settings?.primaryActionLabel || t('Learn more')}
                    </Button>
                  ) : null}
                  {block.settings?.secondaryActionUrl ? (
                    <Button
                      size="large"
                      onClick={() =>
                        onNavigate?.(block.settings?.secondaryActionUrl, false)
                      }
                    >
                      {block.settings?.secondaryActionLabel || t('Open')}
                    </Button>
                  ) : null}
                </HeroActions>
              ) : null}
            </div>
            <div>{renderChildrenGrid(block.children || [], 12)}</div>
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
            {(title || subtitle) && (
              <SectionHeader>
                <SectionTitleGroup>
                  {title && <SectionTitle>{title}</SectionTitle>}
                  {subtitle && <SectionSubtitle>{subtitle}</SectionSubtitle>}
                </SectionTitleGroup>
              </SectionHeader>
            )}
            {renderChildrenGrid(block.children || [], containerSpan)}
          </Section>
        );
      }
      case 'columns': {
        const columnCount =
          Number(block.settings?.columnCount) ||
          Math.max(block.children.length, 1);
        const columnSpan =
          columnCount > 1 ? Math.max(Math.floor(12 / columnCount), 1) : 12;
        return (
          <BlockGrid
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {(block.children || []).map(child => {
              const renderedChild = renderBlock(child);
              if (!renderedChild) {
                return null;
              }
              return (
                <BlockGridCell
                  key={`cell-${child.uid || child.id}`}
                  $span={blockSpan(child, columnSpan)}
                  $minHeight={blockMinHeight(child)}
                >
                  {renderedChild}
                </BlockGridCell>
              );
            })}
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
            {title && <CardTitle>{title}</CardTitle>}
            {body ? (
              <CardBody>
                {isSelectedForInlineEditing(block)
                  ? renderInlineBodyEditor(
                      block,
                      block.content?.html ||
                        block.content?.body_html ||
                        block.content?.body ||
                        body ||
                        '',
                    )
                  : renderRichContent(
                      block.content?.html || block.content?.body_html,
                      body,
                    )}
              </CardBody>
            ) : null}
            {renderChildrenGrid(block.children || [], 12)}
            {block.content?.buttonLabel && block.settings?.buttonUrl ? (
              <Button
                type="primary"
                style={{ marginTop: 16 }}
                onClick={() => onNavigate?.(block.settings?.buttonUrl, false)}
              >
                {block.content.buttonLabel}
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
            {block.content?.text || title || t('Heading')}
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
                    block.content?.html ||
                      block.content?.body_html ||
                      block.content?.body ||
                      body ||
                      '',
                    'body',
                    220,
                  )
                : renderRichContent(
                    block.content?.html || block.content?.body_html,
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
              <SafeMarkdown source={block.content?.items || body || ''} />
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
                  block.content?.html ||
                    block.content?.body_html ||
                    block.content?.quote ||
                    body ||
                    '',
                  'quote',
                  140,
                )
              : renderRichContent(
                  block.content?.html || block.content?.body_html,
                  block.content?.quote || body || '',
                )}
            {block.content?.citation ? (
              <footer>{block.content.citation}</footer>
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
            {title && <CardTitle>{title}</CardTitle>}
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
            {block.content?.caption || asset?.caption ? (
              <CardBody>{block.content?.caption || asset?.caption}</CardBody>
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
            <CardTitle>{title || asset?.title || t('Download file')}</CardTitle>
            {body ? <CardBody>{body}</CardBody> : null}
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
                {block.content?.buttonLabel ||
                  block.content?.label ||
                  t('Download')}
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
              {block.content?.label || title || t('Open link')}
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
            {title ? <CardTitle>{title}</CardTitle> : null}
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
            {title && <CardTitle>{title}</CardTitle>}
            <CardBody>
              {isSelectedForInlineEditing(block)
                ? renderInlineBodyEditor(
                    block,
                    block.content?.html ||
                      block.content?.body_html ||
                      block.content?.body ||
                      body ||
                      '',
                  )
                : renderRichContent(
                    block.content?.html || block.content?.body_html,
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
            <MetricValue>{block.content?.value || '0'}</MetricValue>
            <MetricLabel>{title || t('Statistic')}</MetricLabel>
            {block.content?.caption ? (
              <MetricMeta>{block.content.caption}</MetricMeta>
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
              border: 0,
              borderTop: '1px solid var(--portal-border)',
            }}
          />
        );
      case 'spacer':
        return (
          <div
            key={block.uid || block.id}
            className={className}
            style={{ ...style, height: Number(block.settings?.height) || 48 }}
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
            {title && <CardTitle>{title}</CardTitle>}
            {block.content?.url ? (
              <iframe
                src={block.content.url}
                title={title || block.block_type}
                style={{
                  width: '100%',
                  height: block.settings?.height || 360,
                  border: 0,
                }}
              />
            ) : (
              <Empty description={t('No embed URL configured yet.')} />
            )}
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
            {title && <CardTitle>{title}</CardTitle>}
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
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {(block.settings?.show_header ?? true) &&
            (title || block.content?.caption) ? (
              <>
                {title && <CardTitle>{title}</CardTitle>}
                {block.content?.caption ? (
                  <CardBody>{block.content.caption}</CardBody>
                ) : null}
              </>
            ) : null}
            {chart ? (
              <PublicChartContainer
                title={chart.slice_name}
                url={chart.url}
                height={Number(block.settings?.height) || 360}
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
            {title && <CardTitle>{title}</CardTitle>}
            {dashboard ? (
              <>
                <PublicDashboardEmbed
                  title={dashboard.dashboard_title}
                  dashboardId={dashboard.id}
                  dashboardUuid={dashboard.uuid}
                  height={Number(block.settings?.height) || 720}
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
              {(title || subtitle) && (
                <SectionHeader>
                  <SectionTitleGroup>
                    {title && <SectionTitle>{title}</SectionTitle>}
                    {subtitle && <SectionSubtitle>{subtitle}</SectionSubtitle>}
                  </SectionTitleGroup>
                  <SectionNote>{t('Latest DHIS2 highlights')}</SectionNote>
                </SectionHeader>
              )}
              {renderHighlights(highlights, Number(block.settings?.limit) || 6)}
            </Section>
          );
        }
        if (block.settings?.widgetType === 'dashboard_list') {
          return (
            <Section
              key={block.uid || block.id}
              className={className}
              style={style}
            >
              {(title || subtitle) && (
                <SectionHeader>
                  <SectionTitleGroup>
                    {title && <SectionTitle>{title}</SectionTitle>}
                    {subtitle && <SectionSubtitle>{subtitle}</SectionSubtitle>}
                  </SectionTitleGroup>
                </SectionHeader>
              )}
              <Grid $columns={2}>
                {dashboards.map(dashboard => (
                  <SurfaceCard
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
                    style={{ cursor: 'pointer' }}
                  >
                    <CardTitle>{dashboard.dashboard_title}</CardTitle>
                    <Button
                      type="link"
                      onClick={event => {
                        event.stopPropagation();
                        onOpenDashboard?.(dashboard);
                      }}
                    >
                      {t('Open dashboard')}
                    </Button>
                  </SurfaceCard>
                ))}
              </Grid>
            </Section>
          );
        }
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title && <CardTitle>{title}</CardTitle>}
            <CardBody>
              {body || t('This widget renders dynamic portal data at runtime.')}
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
            {title && <CardTitle>{title}</CardTitle>}
            <CardBody>
              <SafeMarkdown source={body || t('Unsupported block type.')} />
            </CardBody>
          </SurfaceCard>
        );
    }
  }

  return renderChildrenGrid(blocks, 12);
}
