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

import React, { FC, useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { styled, t } from '@superset-ui/core';
import { MarqueeChartProps, MarqueeKpiItem, MarqueePlacement, MarqueeOrientation } from './types';

// ─── Styled Components ───────────────────────────────────────────────────────

interface WrapperProps {
  $containerBackground: string;
  $containerHeight: number;
  $isVertical: boolean;
}

const Wrapper = styled.div<WrapperProps>`
  position: relative;
  width: 100%;
  height: ${({ $isVertical, $containerHeight }) =>
    $isVertical ? '100%' : `${$containerHeight}px`};
  background: ${({ $containerBackground }) => $containerBackground};
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  box-sizing: border-box;
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
  $hoverBackground: string;
}

const Item = styled.div<ItemProps>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  background: ${({ $background }) => $background};
  border: ${({ $borderWidth, $borderColor }) =>
    $borderWidth > 0 ? `${$borderWidth}px solid ${$borderColor}` : 'none'};
  border-radius: ${({ $borderRadius }) => $borderRadius}px;
  padding: ${({ $padding }) => $padding}px ${({ $padding }) => Math.round($padding * 1.4)}px;
  min-width: ${({ $isVertical, $minWidth }) => ($isVertical ? 'auto' : `${$minWidth}px`)};
  max-width: ${({ $isVertical, $maxWidth }) => ($isVertical ? 'none' : `${$maxWidth}px`)};
  flex-shrink: 0;
  margin: ${({ $isVertical, $gap }) =>
    $isVertical ? `${Math.round($gap / 2)}px 4px` : `0 ${Math.round($gap / 2)}px`};
  box-shadow: ${({ $shadow }) =>
    $shadow ? '0 1px 3px 0 rgba(0,0,0,.08), 0 1px 2px -1px rgba(0,0,0,.06)' : 'none'};
  transition: background 0.15s ease, box-shadow 0.15s ease;
  cursor: default;

  &:hover {
    background: ${({ $hoverBackground }) => $hoverBackground};
    box-shadow: ${({ $shadow }) =>
      $shadow ? '0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.08)' : 'none'};
  }
`;

interface SeparatorProps {
  $color: string;
  $isVertical: boolean;
}

const Separator = styled.div<SeparatorProps>`
  flex-shrink: 0;
  background: ${({ $color }) => $color};
  ${({ $isVertical }) =>
    $isVertical
      ? 'width: 100%; height: 1px; margin: 4px 0;'
      : 'width: 1px; height: 60%; margin: 0 8px; align-self: center;'}
`;

interface LabelTextProps {
  $fontSize: number;
  $fontWeight: string;
  $color: string;
}

const LabelText = styled.div<LabelTextProps>`
  font-size: ${({ $fontSize }) => $fontSize}px;
  font-weight: ${({ $fontWeight }) => $fontWeight};
  color: ${({ $color }) => $color};
  letter-spacing: 0.02em;
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
}

const ValueText = styled.div<ValueTextProps>`
  font-size: ${({ $fontSize }) => $fontSize}px;
  font-weight: ${({ $fontWeight }) => $fontWeight};
  color: ${({ $color }) => $color};
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  font-variant-numeric: tabular-nums;
`;

interface DeltaTextProps {
  $positive: boolean;
  $positiveColor: string;
  $negativeColor: string;
  $fontSize: number;
}

const DeltaText = styled.span<DeltaTextProps>`
  font-size: ${({ $fontSize }) => $fontSize}px;
  font-weight: 600;
  color: ${({ $positive, $positiveColor, $negativeColor }) =>
    $positive ? $positiveColor : $negativeColor};
  margin-left: 6px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
`;

interface SubtitleTextProps {
  $fontSize: number;
  $color: string;
}

const SubtitleText = styled.div<SubtitleTextProps>`
  font-size: ${({ $fontSize }) => $fontSize}px;
  color: ${({ $color }) => $color};
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
  color: #9ca3af;
  font-size: 13px;
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function resolveIsVertical(
  placement: MarqueePlacement,
  orientation: MarqueeOrientation,
): boolean {
  if (orientation === 'vertical') return true;
  if (orientation === 'horizontal') return false;
  // auto: derive from placement
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
    hoverBackground,
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
  } = props;

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
      $hoverBackground={cssRgba(hoverBackground)}
    >
      {showLabel && (
        <LabelText
          $fontSize={labelFontSize}
          $fontWeight={labelFontWeight}
          $color={cssRgba(labelColor)}
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
          >
            {item.deltaPositive ? '▲' : '▼'} {item.formattedDelta}
          </DeltaText>
        )}
      </ValueRow>
      {showSubtitle && item.subtitle && (
        <SubtitleText
          $fontSize={subtitleFontSize}
          $color={cssRgba(subtitleColor)}
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
  } = props;

  const [paused, setPaused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackSize, setTrackSize] = useState(0);

  const isVertical = useMemo(
    () => resolveIsVertical(placement, orientation),
    [placement, orientation],
  );

  // Measure the single-copy track size to compute animation duration
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

  // Duration = trackSize / speed (pixels per second)
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

  // Duplicate items for seamless loop when autoLoop is enabled
  const displayItems = autoLoop ? [...items, ...items] : items;

  return (
    <Wrapper
      ref={wrapperRef}
      $containerBackground={cssRgba(containerBackground)}
      $containerHeight={containerHeight}
      $isVertical={isVertical}
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
