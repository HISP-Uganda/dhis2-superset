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
import { styled, t } from '@superset-ui/core';
import { Button, Empty, Tag } from 'antd';
import PublicChartContainer from './PublicChartContainer';
import PublicDashboardEmbed from './PublicDashboardEmbed';
import { ensurePageBlocks } from './blockUtils';
import type {
  PortalChartSummary,
  PortalDashboardSummary,
  PortalHighlight,
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
  return ensurePageBlocks({
    blocks,
    sections: [],
  } as PortalPage).reduce<Record<string, PortalPageBlock[]>>(
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
  highlights?: PortalHighlight[];
  onNavigate?: (path?: string | null, openInNewTab?: boolean) => void;
  onOpenDashboard?: (dashboard: PortalDashboardSummary) => void;
  mode?: 'public' | 'editor';
};

export function RenderBlockTree({
  blocks,
  charts,
  dashboards,
  highlights = [],
  onNavigate,
  onOpenDashboard,
  mode = 'public',
}: RenderBlockTreeProps) {
  function renderBlock(block: PortalPageBlock): JSX.Element | null {
    if (block.status === 'hidden') {
      return null;
    }
    const style = blockStyle(block);
    const className = blockClassName(block);
    const children = (block.children || []).map(child => renderBlock(child));
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
            <div>{children.filter(Boolean)}</div>
          </Hero>
        );
      case 'group':
      case 'column':
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
            {block.settings?.layout === 'grid' ? (
              <Grid $columns={Number(block.settings?.columnCount) || 2}>
                {children.filter(Boolean)}
              </Grid>
            ) : (
              <div>{children.filter(Boolean)}</div>
            )}
          </Section>
        );
      case 'columns':
        return (
          <Grid
            key={block.uid || block.id}
            className={className}
            style={style}
            $columns={
              Number(block.settings?.columnCount) ||
              Math.max(block.children.length, 1)
            }
          >
            {children.filter(Boolean)}
          </Grid>
        );
      case 'card':
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title && <CardTitle>{title}</CardTitle>}
            {body ? (
              <CardBody>
                <SafeMarkdown source={body} />
              </CardBody>
            ) : null}
            {children.filter(Boolean)}
            {block.content?.buttonLabel && block.settings?.buttonUrl ? (
              <Button
                type="primary"
                style={{ marginTop: 16 }}
                onClick={() => onNavigate?.(block.settings?.buttonUrl, false)}
              >
                {block.content.buttonLabel}
              </Button>
            ) : null}
          </SurfaceCard>
        );
      case 'heading':
        return (
          <SectionTitle
            key={block.uid || block.id}
            className={className}
            style={style}
            as={
              `h${Math.min(Math.max(Number(block.content?.level) || 2, 1), 6)}` as never
            }
          >
            {block.content?.text || title || t('Heading')}
          </SectionTitle>
        );
      case 'paragraph':
      case 'rich_text':
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <CardBody>
              <SafeMarkdown
                source={block.content?.body || body || t('No content yet.')}
              />
            </CardBody>
          </SurfaceCard>
        );
      case 'list':
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <CardBody>
              <SafeMarkdown source={block.content?.items || body || ''} />
            </CardBody>
          </SurfaceCard>
        );
      case 'quote':
        return (
          <Quote
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <SafeMarkdown source={block.content?.quote || body || ''} />
            {block.content?.citation ? (
              <footer>{block.content.citation}</footer>
            ) : null}
          </Quote>
        );
      case 'image':
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            {title && <CardTitle>{title}</CardTitle>}
            {block.content?.url ? (
              <img
                src={block.content.url}
                alt={block.content.alt || title || t('Image')}
                style={{ width: '100%', display: 'block' }}
              />
            ) : (
              <Empty description={t('No image configured yet.')} />
            )}
            {block.content?.caption ? (
              <CardBody>{block.content.caption}</CardBody>
            ) : null}
          </SurfaceCard>
        );
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
        return (
          <SurfaceCard
            key={block.uid || block.id}
            className={className}
            style={style}
          >
            <div
              dangerouslySetInnerHTML={{
                __html: block.content?.html || '',
              }}
            />
          </SurfaceCard>
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

  return <>{blocks.map(block => renderBlock(block))}</>;
}
