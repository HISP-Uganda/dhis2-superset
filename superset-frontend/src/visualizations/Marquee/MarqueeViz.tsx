/*
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

import React, { FC, useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { styled, t } from '@superset-ui/core';
import { MarqueeChartProps, MarqueeKpiItem, MarqueePlacement, MarqueeOrientation } from './types';

// ─── Pro Theme CSS Variable Defaults ─────────────────────────────────────────
// All visual properties fall back to --pro-* CSS variables, enabling automatic
// theme integration across presets without per-chart reconfiguration.

// ─── Styled Components — Command-Center / TV Ticker Design ──────────────────

interface WrapperProps {
  $containerBackground: string;
  $containerHeight: number;
  $isVertical: boolean;
  $variant: string;
}

const Wrapper = styled.div<WrapperProps>`
  position: relative;
  width: 100%;
  height: ${({ $isVertical, $containerHeight }) =>
    $isVertical ? '100%' : `${$containerHeight}px`};
  background: ${({ $containerBackground, $variant }) =>
    $containerBackground !== 'transparent'
      ? $containerBackground
      : $variant === 'dark'
        ? 'var(--pro-navy, #0D3B66)'
        : $variant === 'glass'
          ? 'linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(245,247,250,0.92) 100%)'
          : 'var(--pro-bg-canvas, #F5F7FA)'};
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  box-sizing: border-box;
  border-radius: var(--pro-radius-md, 12px);
  ${({ $variant }) =>
    $variant === 'glass'
      ? `
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.25);
    box-shadow: 0 4px 24px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  `
      : $variant === 'dark'
        ? `
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05);
  `
        : `
    border: 1px solid var(--pro-border, #E5EAF0);
    box-shadow: var(--pro-shadow-sm, 0 1px 3px rgba(0,0,0,0.06));
  `}
`;

interface TrackProps {
  $isVertical: boolean;
  $animationDuration: string;
  $paused: boolean;
  $reverse: boolean;
}

const Track = styled.div<TrackProps>`
  display: flex;
  flex-direction: ${({ $isVertical }) => ($isVertical ? 'column' : 'row')};
  align-items: ${({ $isVertical }) => ($isVertical ? 'stretch' : 'center')};
  gap: 0;
  flex-shrink: 0;
  animation: ${({ $isVertical, $reverse }) =>
    $isVertical
      ? $reverse
        ? 'marqueeScrollVerticalReverse'
        : 'marqueeScrollVertical'
      : $reverse
      ? 'marqueeScrollReverse'
      : 'marqueeScroll'
  } ${({ $animationDuration }) => $animationDuration} linear
    ${({ $paused }) => ($paused ? 'paused' : 'running')} infinite;
  will-change: transform;

  @keyframes marqueeScroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  @keyframes marqueeScrollReverse {
    0% { transform: translateX(-50%); }
    100% { transform: translateX(0); }
  }
  @keyframes marqueeScrollVertical {
    0% { transform: translateY(0); }
    100% { transform: translateY(-50%); }
  }
  @keyframes marqueeScrollVerticalReverse {
    0% { transform: translateY(-50%); }
    100% { transform: translateY(0); }
  }
`;

interface ItemProps {
  $background: string;
  $borderColor: string;
  $borderWidth: number;
  $borderRadius: number;
  $shadow: boolean;
  $padding: number;
  $minWidth: number;
  $maxWidth: number;
  $isVertical: boolean;
  $gap: number;
  $variant: string;
  $statusColor: string | null;
}

const Item = styled.div<ItemProps>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  position: relative;
  background: ${({ $background, $variant }) =>
    $background !== '#ffffff' && $background !== 'rgba(255,255,255,1)'
      ? $background
      : $variant === 'dark'
        ? 'rgba(255,255,255,0.06)'
        : $variant === 'glass'
          ? 'rgba(255,255,255,0.55)'
          : 'var(--pro-bg-card, #ffffff)'};
  border: ${({ $borderWidth, $borderColor, $variant }) =>
    $borderWidth > 0
      ? `${$borderWidth}px solid ${
          $variant === 'dark'
            ? 'rgba(255,255,255,0.08)'
            : $variant === 'glass'
              ? 'rgba(255,255,255,0.3)'
              : $borderColor
        }`
      : 'none'};
  border-radius: ${({ $borderRadius }) => $borderRadius}px;
  padding: ${({ $padding }) => $padding}px ${({ $padding }) => Math.round($padding * 1.4)}px;
  min-width: ${({ $isVertical, $minWidth }) => ($isVertical ? 'auto' : `${$minWidth}px`)};
  max-width: ${({ $isVertical, $maxWidth }) => ($isVertical ? 'none' : `${$maxWidth}px`)};
  flex-shrink: 0;
  margin: ${({ $isVertical, $gap }) =>
    $isVertical ? `${Math.round($gap / 2)}px 4px` : `0 ${Math.round($gap / 2)}px`};
  box-shadow: ${({ $shadow, $variant }) =>
    $shadow
      ? $variant === 'dark'
        ? '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)'
        : $variant === 'glass'
          ? '0 2px 12px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'
          : 'var(--pro-shadow-sm, 0 1px 3px rgba(0,0,0,0.06))'
      : 'none'};
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  cursor: default;
  overflow: hidden;

  /* Status indicator bar on the left edge */
  ${({ $statusColor }) =>
    $statusColor
      ? `
    &::before {
      content: '';
      position: absolute;
      top: 4px;
      bottom: 4px;
      left: 0;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: ${$statusColor};
    }
    padding-left: ${20}px;
  `
      : ''}

  &:hover {
    transform: translateY(-1px);
    box-shadow: ${({ $variant }) =>
      $variant === 'dark'
        ? '0 6px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)'
        : 'var(--pro-shadow-md, 0 4px 12px rgba(0,0,0,0.08))'};
  }
`;

interface SeparatorProps {
  $color: string;
  $isVertical: boolean;
  $variant: string;
}

const Separator = styled.div<SeparatorProps>`
  flex-shrink: 0;
  background: ${({ $color, $variant }) =>
    $variant === 'dark'
      ? 'rgba(255,255,255,0.1)'
      : $variant === 'glass'
        ? 'rgba(0,0,0,0.06)'
        : $color};
  ${({ $isVertical }) =>
    $isVertical
      ? 'width: 100%; height: 1px; margin: 4px 0;'
      : 'width: 1px; height: 60%; margin: 0 8px; align-self: center;'}
`;

interface LabelTextProps {
  $fontSize: number;
  $fontWeight: string;
  $color: string;
  $variant: string;
}

const LabelText = styled.div<LabelTextProps>`
  font-family: var(--pro-font-family, 'Inter', 'Segoe UI', Roboto, sans-serif);
  font-size: ${({ $fontSize }) => $fontSize}px;
  font-weight: ${({ $fontWeight }) => $fontWeight};
  color: ${({ $color, $variant }) =>
    $variant === 'dark'
      ? 'rgba(255,255,255,0.55)'
      : $color};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
  max-width: 100%;
`;

interface ValueTextProps {
  $fontSize: number;
  $fontWeight: string;
  $color: string;
  $variant: string;
  $statusColor: string | null;
}

const ValueText = styled.div<ValueTextProps>`
  font-family: var(--pro-font-family, 'Inter', 'Segoe UI', Roboto, sans-serif);
  font-size: ${({ $fontSize }) => $fontSize}px;
  font-weight: ${({ $fontWeight }) => $fontWeight};
  color: ${({ $statusColor, $color, $variant }) =>
    $statusColor
      ? $statusColor
      : $variant === 'dark'
        ? '#ffffff'
        : $color};
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
`;

interface DeltaTextProps {
  $positive: boolean;
  $positiveColor: string;
  $negativeColor: string;
  $fontSize: number;
  $variant: string;
}

const DeltaText = styled.span<DeltaTextProps>`
  font-family: var(--pro-font-family, 'Inter', 'Segoe UI', Roboto, sans-serif);
  font-size: ${({ $fontSize }) => $fontSize}px;
  font-weight: 600;
  color: ${({ $positive, $positiveColor, $negativeColor }) =>
    $positive ? $positiveColor : $negativeColor};
  margin-left: 6px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: 4px;
  background: ${({ $positive, $positiveColor, $negativeColor }) =>
    $positive
      ? `${$positiveColor}14`
      : `${$negativeColor}14`};
`;

interface SubtitleTextProps {
  $fontSize: number;
  $color: string;
  $variant: string;
}

const SubtitleText = styled.div<SubtitleTextProps>`
  font-family: var(--pro-font-family, 'Inter', 'Segoe UI', Roboto, sans-serif);
  font-size: ${({ $fontSize }) => $fontSize}px;
  color: ${({ $color, $variant }) =>
    $variant === 'dark'
      ? 'rgba(255,255,255,0.4)'
      : $color};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  line-height: 1.4;
`;

const ValueRow = styled.div`
  display: flex;
  align-items: baseline;
  max-width: 100%;
`;

const EmptyState = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pro-text-muted, #9ca3af);
  font-size: 13px;
  font-family: var(--pro-font-family, 'Inter', 'Segoe UI', Roboto, sans-serif);
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function resolveIsVertical(
  placement: MarqueePlacement,
  orientation: MarqueeOrientation,
): boolean {
  if (orientation === 'vertical') return true;
  if (orientation === 'horizontal') return false;
  return placement === 'left' || placement === 'right';
}

function cssRgba(value: any): string {
  if (!value) return 'transparent';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'r' in value) {
    const { r, g, b, a = 1 } = value as any;
    return `rgba(${r},${g},${b},${a})`;
  }
  return String(value);
}

/**
 * Resolve a status color for a KPI value based on threshold breakpoints.
 * Returns null if no thresholds configured or value is null.
 */
function resolveStatusColor(
  value: number | null | undefined,
  thresholds: Array<{ value: number; color: string }>,
): string | null {
  if (!thresholds || thresholds.length === 0 || value === null || value === undefined) {
    return null;
  }
  // thresholds are sorted ascending; pick the last one where value >= threshold
  const sorted = [...thresholds].sort((a, b) => a.value - b.value);
  let color: string | null = null;
  for (const t of sorted) {
    if (value >= t.value) {
      color = t.color;
    }
  }
  // If value is below the lowest threshold, use the first color
  if (color === null && sorted.length > 0) {
    color = sorted[0].color;
  }
  return color;
}

// ─── KPI Item Card ────────────────────────────────────────────────────────────

interface KpiCardProps {
  item: MarqueeKpiItem;
  props: MarqueeChartProps;
  isVertical: boolean;
}

const KpiCard: FC<KpiCardProps> = ({ item, props, isVertical }) => {
  const {
    itemBackground,
    itemBorderColor,
    itemBorderWidth,
    itemBorderRadius,
    showShadow,
    itemPadding,
    itemMinWidth,
    itemMaxWidth,
    gapBetweenItems,
    labelFontSize,
    labelFontWeight,
    labelColor,
    valueFontSize,
    valueFontWeight,
    valueColor,
    subtitleFontSize,
    subtitleColor,
    deltaPositiveColor,
    deltaNegativeColor,
    showLabel,
    showSubtitle,
    showDelta,
    variant,
    colorThresholds,
  } = props;

  const statusColor = resolveStatusColor(
    typeof item.value === 'number' ? item.value : null,
    colorThresholds,
  );

  return (
    <Item
      $background={cssRgba(itemBackground)}
      $borderColor={cssRgba(itemBorderColor)}
      $borderWidth={itemBorderWidth}
      $borderRadius={itemBorderRadius}
      $shadow={showShadow}
      $padding={itemPadding}
      $minWidth={itemMinWidth}
      $maxWidth={itemMaxWidth}
      $isVertical={isVertical}
      $gap={gapBetweenItems}
      $variant={variant}
      $statusColor={statusColor}
    >
      {showLabel && (
        <LabelText
          $fontSize={labelFontSize}
          $fontWeight={labelFontWeight}
          $color={cssRgba(labelColor)}
          $variant={variant}
          title={item.label}
        >
          {item.label}
        </LabelText>
      )}
      <ValueRow>
        <ValueText
          $fontSize={valueFontSize}
          $fontWeight={valueFontWeight}
          $color={cssRgba(valueColor)}
          $variant={variant}
          $statusColor={statusColor}
          title={item.formattedValue}
        >
          {item.formattedValue}
        </ValueText>
        {showDelta && item.formattedDelta && (
          <DeltaText
            $positive={!!item.deltaPositive}
            $positiveColor={cssRgba(deltaPositiveColor)}
            $negativeColor={cssRgba(deltaNegativeColor)}
            $fontSize={Math.max(10, valueFontSize - 6)}
            $variant={variant}
          >
            {item.deltaPositive ? '▲' : '▼'} {item.formattedDelta}
          </DeltaText>
        )}
      </ValueRow>
      {showSubtitle && item.subtitle && (
        <SubtitleText
          $fontSize={subtitleFontSize}
          $color={cssRgba(subtitleColor)}
          $variant={variant}
          title={item.subtitle}
        >
          {item.subtitle}
        </SubtitleText>
      )}
    </Item>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const MarqueeViz: FC<MarqueeChartProps> = (props) => {
  const {
    items,
    placement,
    orientation,
    speed,
    pauseOnHover,
    autoLoop,
    scrollDirection,
    containerHeight,
    containerBackground,
    dividerColor,
    showSeparators,
    height,
    width: _width,
    variant,
  } = props;

  const [paused, setPaused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackSize, setTrackSize] = useState(0);

  const isVertical = useMemo(
    () => resolveIsVertical(placement, orientation),
    [placement, orientation],
  );

  useEffect(() => {
    if (!trackRef.current) return;
    const measure = () => {
      const el = trackRef.current;
      if (!el) return;
      const size = isVertical ? el.scrollHeight / 2 : el.scrollWidth / 2;
      setTrackSize(size || 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [isVertical, items.length]);

  const animationDuration = useMemo(() => {
    if (!trackSize || speed <= 0) return '20s';
    return `${(trackSize / speed).toFixed(2)}s`;
  }, [trackSize, speed]);

  const handleMouseEnter = useCallback(() => {
    if (pauseOnHover) setPaused(true);
  }, [pauseOnHover]);

  const handleMouseLeave = useCallback(() => {
    setPaused(false);
  }, []);

  if (!items || items.length === 0) {
    return (
      <EmptyState>
        {t('No data available. Configure metrics in the Query section.')}
      </EmptyState>
    );
  }

  const displayItems = autoLoop ? [...items, ...items] : items;

  return (
    <Wrapper
      ref={wrapperRef}
      $containerBackground={cssRgba(containerBackground)}
      $containerHeight={containerHeight}
      $isVertical={isVertical}
      $variant={variant}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ height: isVertical ? height : containerHeight }}
    >
      <Track
        ref={trackRef}
        $isVertical={isVertical}
        $animationDuration={animationDuration}
        $paused={paused || !autoLoop}
        $reverse={scrollDirection === 'reverse'}
      >
        {displayItems.map((item, index) => (
          <React.Fragment key={`${item.id}-${index}`}>
            {showSeparators && index > 0 && (
              <Separator
                $color={cssRgba(dividerColor)}
                $isVertical={isVertical}
                $variant={variant}
              />
            )}
            <KpiCard item={item} props={props} isVertical={isVertical} />
          </React.Fragment>
        ))}
      </Track>
    </Wrapper>
  );
};

export default MarqueeViz;
