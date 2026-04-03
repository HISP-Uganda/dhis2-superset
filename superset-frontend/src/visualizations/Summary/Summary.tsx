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
/* eslint-disable theme-colors/no-literal-colors */
import React, { useState, useCallback, useMemo } from 'react';
import { styled, t } from '@superset-ui/core';
import {
  SummaryTransformedProps,
  SummaryItem,
  SummaryGroup,
  TrendDisplay,
  TrendLogic,
  Layout,
  Alignment,
  BorderStyle,
  ImagePlacement,
} from './types';

/* ── Styled Components ─────────────────────────────── */

interface WrapperProps {
  $fontFamily: string;
}

const Wrapper = styled.div<WrapperProps>`
  width: 100%;
  height: 100%;
  overflow: auto;
  font-family: ${({ $fontFamily }) =>
    `${$fontFamily}, 'Segoe UI', Roboto, sans-serif`};
`;

interface GridProps {
  $layout: Layout;
  $columns: number | 'auto';
  $gap: number;
  $padding: number;
  $alignment: Alignment;
}

const Grid = styled.div<GridProps>`
  display: ${({ $layout }) =>
    $layout === 'grid' || $layout === 'micro-card' || $layout === 'compact-kpi'
      ? 'grid'
      : 'flex'};
  grid-template-columns: ${({ $layout, $columns }) => {
    if (
      $layout === 'grid' ||
      $layout === 'micro-card' ||
      $layout === 'compact-kpi'
    ) {
      return $columns === 'auto'
        ? 'repeat(auto-fit, minmax(140px, 1fr))'
        : `repeat(${$columns}, 1fr)`;
    }
    return 'none';
  }};
  flex-direction: ${({ $layout }) =>
    $layout === 'vertical' || $layout === 'split' ? 'column' : 'row'};
  flex-wrap: ${({ $layout }) =>
    $layout === 'horizontal' ? 'wrap' : 'nowrap'};
  gap: ${({ $gap }) => $gap}px;
  padding: ${({ $padding }) => $padding}px;
  height: 100%;
  width: 100%;
  align-content: start;
  align-items: ${({ $layout, $alignment }) => {
    /* Grid: always stretch cards to equal height; Card uses justify-content
       to vertically center its own content. Flex: respect alignment. */
    if ($layout === 'grid' || $layout === 'micro-card' || $layout === 'compact-kpi')
      return 'stretch';
    if ($alignment === 'center') return 'center';
    if ($alignment === 'end') return 'flex-end';
    if ($alignment === 'stretch') return 'stretch';
    return 'flex-start';
  }};
  justify-items: ${({ $alignment }) => {
    if ($alignment === 'center') return 'center';
    if ($alignment === 'end') return 'end';
    return 'stretch';
  }};
`;

interface CardProps {
  $cardStyle: string;
  $borderRadius: number;
  $padding: number;
  $showDivider: boolean;
  $statusColor: string | null;
  $borderWidth: number;
  $borderColor: string;
  $borderStyle: BorderStyle;
  $alignment: Alignment;
  $cardBgColor?: string;
}

const Card = styled.div<CardProps>`
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: ${({ $alignment }) => {
    if ($alignment === 'center') return 'center';
    if ($alignment === 'end') return 'flex-end';
    return 'flex-start';
  }};
  padding: ${({ $padding }) => $padding}px;
  border-radius: ${({ $cardStyle, $borderRadius }) =>
    $cardStyle !== 'transparent' ? `${$borderRadius}px` : '0'};
  background: ${({ $cardStyle, $cardBgColor }) => {
    if ($cardBgColor) return $cardBgColor;
    if ($cardStyle === 'elevated' || $cardStyle === 'flat')
      return 'var(--pro-bg-card)';
    return 'transparent';
  }};
  box-shadow: ${({ $cardStyle }) =>
    $cardStyle === 'elevated'
      ? 'var(--pro-shadow-sm)'
      : 'none'};
  border: ${({ $cardStyle, $borderWidth, $borderColor, $borderStyle }) => {
    if ($borderStyle === 'none' || $borderWidth === 0) return 'none';
    if ($cardStyle === 'transparent') return 'none';
    const color = $borderColor || 'var(--pro-border)';
    return `${$borderWidth}px ${$borderStyle} ${color}`;
  }};
  border-bottom: ${({
    $showDivider,
    $cardStyle,
    $borderColor,
    $borderStyle,
  }) =>
    $cardStyle === 'transparent' && $showDivider
      ? `1px ${$borderStyle || 'solid'} ${$borderColor || 'var(--pro-border)'}`
      : undefined};
  overflow: hidden;
  transition: box-shadow 0.15s ease;
  min-width: 0;
  text-align: ${({ $alignment }) => {
    if ($alignment === 'center') return 'center';
    if ($alignment === 'end') return 'right';
    return 'left';
  }};

  /* Status indicator bar */
  ${({ $statusColor }) =>
    $statusColor
      ? `&::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: ${$statusColor};
    border-radius: inherit;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }`
      : ''}

  &:hover {
    box-shadow: ${({ $cardStyle }) =>
      $cardStyle === 'elevated'
        ? 'var(--pro-shadow-md)'
        : 'none'};
  }
`;

/* Content layout wrappers */
const ContentColumn = styled.div`
  display: flex;
  flex-direction: column;
  align-items: inherit;
  width: 100%;
`;

const ContentRow = styled.div<{ $reverse?: boolean }>`
  display: flex;
  align-items: baseline;
  justify-content: inherit;
  gap: 12px;
  width: 100%;
  flex-direction: ${({ $reverse }) => ($reverse ? 'row-reverse' : 'row')};
`;

const ContentInline = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: inherit;
  gap: 8px;
  width: 100%;
`;

interface LabelProps {
  $size: string;
  $weight: string;
  $transform: string;
  $color: string;
}

const LabelText = styled.div<LabelProps>`
  font-size: ${({ $size }) => $size};
  font-weight: ${({ $weight }) => $weight};
  color: ${({ $color }) =>
    $color || 'var(--pro-text-secondary)'};
  text-transform: ${({ $transform }) => $transform};
  letter-spacing: 0.04em;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SubtitleText = styled.div`
  font-size: 11px;
  font-weight: 400;
  color: var(--pro-text-muted);
  line-height: 1.3;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

interface CardImageProps {
  $size: number;
}

const CardImage = styled.img<CardImageProps>`
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: 4px;
`;

const CardRowLayout = styled.div<{ $gap: number }>`
  display: flex;
  align-items: center;
  gap: ${({ $gap }) => $gap}px;
  width: 100%;
`;

const CardColumnLayout = styled.div<{ $gap: number }>`
  display: flex;
  flex-direction: column;
  align-items: inherit;
  gap: ${({ $gap }) => $gap}px;
  width: 100%;
`;

const CardContentFlex = styled.div`
  flex: 1;
  min-width: 0;
`;

interface ValueProps {
  $size: string;
  $weight: string;
  $color: string | null;
}

const ValueText = styled.div<ValueProps>`
  font-size: ${({ $size }) => $size};
  font-weight: ${({ $weight }) => $weight};
  color: ${({ $color }) => $color || 'var(--pro-text-primary)'};
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  white-space: nowrap;
`;

const TrendRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: inherit;
  gap: 4px;
  margin-top: 4px;
`;

interface TrendBadgeProps {
  $positive: boolean;
  $isBadge: boolean;
}

const TrendBadge = styled.span<TrendBadgeProps>`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  font-weight: 600;
  padding: ${({ $isBadge }) => ($isBadge ? '2px 8px' : '1px 6px')};
  border-radius: var(--pro-radius-chip, 999px);
  background: ${({ $positive }) =>
    $positive
      ? 'var(--pro-success-bg)'
      : 'var(--pro-danger-bg)'};
  color: ${({ $positive }) =>
    $positive
      ? 'var(--pro-success)'
      : 'var(--pro-danger)'};
`;

const FlatTrend = styled.span`
  font-size: 12px;
  color: var(--pro-text-muted);
`;

/* ── Micro Visualization components ──────────────── */

const MicroVizContainer = styled.div`
  margin-top: 8px;
  width: 100%;
`;

const ProgressTrack = styled.div`
  width: 100%;
  height: 6px;
  background: var(--pro-border);
  border-radius: 3px;
  overflow: hidden;
`;

interface ProgressFillProps {
  $percent: number;
  $color: string;
}

const ProgressFill = styled.div<ProgressFillProps>`
  height: 100%;
  width: ${({ $percent }) => Math.min(100, Math.max(0, $percent))}%;
  background: ${({ $color }) => $color};
  border-radius: 3px;
  transition: width 0.4s ease;
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--pro-text-muted);
  font-size: 14px;
`;

/* ── Group header ──────────────────────────────────── */

const GroupSection = styled.div`
  &:not(:first-of-type) {
    margin-top: 6px;
  }
`;

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--pro-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--pro-border);
  margin-bottom: 4px;
`;

/* ── Pagination controls ──────────────────────────── */

const PaginationBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 8px;
  flex-shrink: 0;
`;

const PageButton = styled.button<{ $disabled?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--pro-border);
  border-radius: 6px;
  background: ${({ $disabled }) =>
    $disabled ? 'var(--pro-bg-card)' : 'var(--pro-bg-card)'};
  color: ${({ $disabled }) =>
    $disabled
      ? 'var(--pro-text-muted)'
      : 'var(--pro-text-primary)'};
  font-size: 12px;
  font-weight: 600;
  cursor: ${({ $disabled }) => ($disabled ? 'default' : 'pointer')};
  pointer-events: ${({ $disabled }) => ($disabled ? 'none' : 'auto')};
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: var(--pro-bg-hover);
    border-color: var(--pro-border-hover);
  }
`;

const PageInfo = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: var(--pro-text-secondary);
  white-space: nowrap;
`;

/* ── Sparkline SVG ─────────────────────────────────── */

function Sparkline({
  data,
  color,
  width = 80,
  height = 24,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 1;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + h - ((d - min) / range) * h;
    return `${x},${y}`;
  });

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={parseFloat(points[points.length - 1].split(',')[0])}
        cy={parseFloat(points[points.length - 1].split(',')[1])}
        r="2"
        fill={color}
      />
    </svg>
  );
}

/* ── Mini Bar SVG ──────────────────────────────────── */

function MiniBar({
  data,
  color,
  width = 80,
  height = 24,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const barWidth = Math.max(2, (width - (data.length - 1)) / data.length);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {data.map((d, i) => {
        const barHeight = (d / max) * height;
        return (
          <rect
            key={i}
            x={i * (barWidth + 1)}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={1}
            fill={color}
            opacity={i === data.length - 1 ? 1 : 0.5}
          />
        );
      })}
    </svg>
  );
}

/* ── Bullet indicator SVG ──────────────────────────── */

function BulletIndicator({
  percent,
  color,
  width = 80,
  height = 12,
}: {
  percent: number;
  color: string;
  width?: number;
  height?: number;
}) {
  const pct = Math.min(100, Math.max(0, percent));
  const barH = height * 0.5;
  const markerX = (pct / 100) * width;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ color: 'var(--pro-border)' }}>
      <rect
        x={0}
        y={(height - barH) / 2}
        width={width}
        height={barH}
        rx={barH / 2}
        fill="currentColor"
      />
      <rect
        x={0}
        y={(height - barH) / 2}
        width={markerX}
        height={barH}
        rx={barH / 2}
        fill={color}
        opacity={0.7}
      />
      <line
        x1={markerX}
        x2={markerX}
        y1={1}
        y2={height - 1}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Trend Indicator ───────────────────────────────── */

function TrendIndicator({
  direction,
  formattedValue,
  display,
  logic,
}: {
  direction: 'up' | 'down' | 'flat';
  formattedValue?: string;
  display: TrendDisplay;
  logic: TrendLogic;
}) {
  if (direction === 'flat') {
    return <FlatTrend>—</FlatTrend>;
  }

  const isPositive =
    (direction === 'up' && logic === 'higher-is-better') ||
    (direction === 'down' && logic === 'lower-is-better');

  const arrow = direction === 'up' ? '↑' : '↓';
  const showArrow = display === 'arrow' || display === 'both';
  const showValue =
    display === 'value' || display === 'both' || display === 'badge';
  const isBadge = display === 'badge';

  return (
    <TrendBadge $positive={isPositive} $isBadge={isBadge}>
      {showArrow && arrow}
      {showValue && formattedValue && ` ${formattedValue}`}
    </TrendBadge>
  );
}

/* ── Main Component ────────────────────────────────── */

export default function Summary(props: SummaryTransformedProps) {
  const {
    width,
    height,
    items,
    groups,
    groupsPerPage = 6,
    layoutMode,
    gridColumns,
    valuePosition,
    cardStyle,
    labelFontSize,
    valueFontSize,
    fontFamily,
    labelFontWeight,
    valueFontWeight,
    labelTextTransform,
    labelColor,
    valueColorMode,
    alignment,
    showLabels,
    showTrendIndicator,
    showMicroViz,
    showDividers,
    trendDisplay,
    trendLogic,
    microVisualType,
    imagePlacement,
    imageSize,
    itemPadding,
    itemGap,
    itemBorderRadius,
    borderWidth,
    borderColor,
    borderStyle,
  } = props;

  const isGrouped = groups && groups.length > 0;
  const totalGroups = groups?.length ?? 0;
  const totalPages = isGrouped
    ? Math.ceil(totalGroups / groupsPerPage)
    : 1;

  const [page, setPage] = useState(0);
  const safeSetPage = useCallback(
    (p: number) => setPage(Math.max(0, Math.min(p, totalPages - 1))),
    [totalPages],
  );

  const visibleGroups = useMemo(() => {
    if (!isGrouped) return [];
    const start = page * groupsPerPage;
    return groups!.slice(start, start + groupsPerPage);
  }, [isGrouped, groups, page, groupsPerPage]);

  if (
    (!isGrouped && (!items || items.length === 0)) ||
    (isGrouped && totalGroups === 0)
  ) {
    return (
      <Wrapper $fontFamily={fontFamily} style={{ width, height }}>
        <EmptyState>{t('No metrics configured')}</EmptyState>
      </Wrapper>
    );
  }

  const renderContent = (item: SummaryItem) => {
    const valueEl = (
      <ValueText
        $size={valueFontSize}
        $weight={valueFontWeight}
        $color={
          valueColorMode === 'scheme' ? null : item.statusColor
        }
      >
        {item.formattedValue}
      </ValueText>
    );
    const labelEl = showLabels ? (
      <>
        <LabelText
          $size={labelFontSize}
          $weight={labelFontWeight}
          $transform={labelTextTransform}
          $color={item.labelColor || labelColor}
        >
          {item.label}
        </LabelText>
        {item.subtitle && <SubtitleText>{item.subtitle}</SubtitleText>}
      </>
    ) : null;

    let inner;
    switch (valuePosition) {
      case 'above':
        inner = (
          <ContentColumn>
            {valueEl}
            {labelEl}
          </ContentColumn>
        );
        break;
      case 'left':
        inner = (
          <ContentRow>
            {valueEl}
            {labelEl}
          </ContentRow>
        );
        break;
      case 'right':
        inner = (
          <ContentRow $reverse>
            {valueEl}
            {labelEl}
          </ContentRow>
        );
        break;
      case 'inline':
        inner = (
          <ContentInline>
            {labelEl}
            {valueEl}
          </ContentInline>
        );
        break;
      case 'below':
      default:
        inner = (
          <ContentColumn>
            {labelEl}
            {valueEl}
          </ContentColumn>
        );
        break;
    }

    /* Wrap with image if present */
    if (item.imageUrl) {
      const imgEl = (
        <CardImage src={item.imageUrl} $size={imageSize} alt="" />
      );
      if (imagePlacement === 'above') {
        return (
          <CardColumnLayout $gap={8}>
            {imgEl}
            <CardContentFlex>{inner}</CardContentFlex>
          </CardColumnLayout>
        );
      }
      if (imagePlacement === 'below') {
        return (
          <CardColumnLayout $gap={8}>
            <CardContentFlex>{inner}</CardContentFlex>
            {imgEl}
          </CardColumnLayout>
        );
      }
      if (imagePlacement === 'after') {
        return (
          <CardRowLayout $gap={12}>
            <CardContentFlex>{inner}</CardContentFlex>
            {imgEl}
          </CardRowLayout>
        );
      }
      /* 'before' — default */
      return (
        <CardRowLayout $gap={12}>
          {imgEl}
          <CardContentFlex>{inner}</CardContentFlex>
        </CardRowLayout>
      );
    }

    return inner;
  };

  const renderMicroViz = (item: SummaryItem) => {
    if (!showMicroViz || microVisualType === 'none') return null;

    return (
      <MicroVizContainer>
        {microVisualType === 'sparkline' &&
          item.sparklineData &&
          item.sparklineData.length > 1 && (
            <Sparkline data={item.sparklineData} color={item.accentColor} />
          )}
        {microVisualType === 'mini-bar' &&
          item.sparklineData &&
          item.sparklineData.length > 0 && (
            <MiniBar data={item.sparklineData} color={item.accentColor} />
          )}
        {microVisualType === 'progress-bar' &&
          item.progressPercent !== undefined && (
            <ProgressTrack>
              <ProgressFill
                $percent={item.progressPercent}
                $color={item.statusColor || item.accentColor}
              />
            </ProgressTrack>
          )}
        {microVisualType === 'bullet' &&
          item.progressPercent !== undefined && (
            <BulletIndicator
              percent={item.progressPercent}
              color={item.statusColor || item.accentColor}
            />
          )}
      </MicroVizContainer>
    );
  };

  const renderCards = (cardItems: SummaryItem[]) => (
    <Grid
      $layout={layoutMode}
      $columns={gridColumns}
      $gap={itemGap}
      $padding={itemPadding}
      $alignment={alignment}
    >
      {cardItems.map((item, idx) => (
        <Card
          key={item.key}
          $cardStyle={cardStyle}
          $borderRadius={itemBorderRadius}
          $padding={
            cardStyle !== 'transparent' ? itemPadding : itemPadding / 2
          }
          $showDivider={showDividers && idx < cardItems.length - 1}
          $statusColor={item.statusColor}
          $borderWidth={borderWidth}
          $borderColor={item.borderColor || borderColor}
          $borderStyle={borderStyle}
          $alignment={alignment}
          $cardBgColor={item.cardColor}
        >
          {renderContent(item)}

          {showTrendIndicator && item.trendValue !== undefined && (
            <TrendRow>
              <TrendIndicator
                direction={item.trendDirection}
                formattedValue={item.formattedTrendValue}
                display={trendDisplay}
                logic={trendLogic}
              />
            </TrendRow>
          )}

          {renderMicroViz(item)}
        </Card>
      ))}
    </Grid>
  );

  /* ── Flat mode (no groupby) ──────────────────────── */
  if (!isGrouped) {
    return (
      <Wrapper $fontFamily={fontFamily} style={{ width, height }}>
        {renderCards(items)}
      </Wrapper>
    );
  }

  /* ── Grouped + paginated mode ────────────────────── */
  return (
    <Wrapper
      $fontFamily={fontFamily}
      style={{ width, height, display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ flex: '1 1 auto', overflow: 'auto' }}>
        {visibleGroups.map((group: SummaryGroup) => (
          <GroupSection key={group.groupKey}>
            <GroupHeader>{group.groupLabel}</GroupHeader>
            {renderCards(group.items)}
          </GroupSection>
        ))}
      </div>

      {totalPages > 1 && (
        <PaginationBar>
          <PageButton
            $disabled={page === 0}
            onClick={() => safeSetPage(page - 1)}
          >
            ‹
          </PageButton>
          <PageInfo>
            {page + 1} / {totalPages}
            {' '}({totalGroups} {t('groups')})
          </PageInfo>
          <PageButton
            $disabled={page >= totalPages - 1}
            onClick={() => safeSetPage(page + 1)}
          >
            ›
          </PageButton>
        </PaginationBar>
      )}
    </Wrapper>
  );
}
