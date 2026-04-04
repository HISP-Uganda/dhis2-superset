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

import React, { useMemo } from 'react';
import { t } from '@superset-ui/core';
import { ComputedLegendEntry, formatValue } from '../utils';
import {
  DHIS2LegendDefinition,
  LegendDisplayType,
  LevelBorderColor,
  MapCornerPosition,
} from '../types';

interface LegendPanelProps {
  colorScale: (value: number) => string;
  valueRange: { min: number; max: number };
  position: MapCornerPosition;
  displayType?: LegendDisplayType;
  classes: number;
  metricName: string;
  noDataColor?: { r: number; g: number; b: number; a: number };
  levelBorderColors?: LevelBorderColor[];
  levelLabels?: Record<number, string>;
  showBoundaryLegend?: boolean;
  manualBreaks?: number[];
  manualColors?: string[];
  stagedLegendDefinition?: DHIS2LegendDefinition;
  legendEntries?: ComputedLegendEntry[];
}

/* eslint-disable theme-colors/no-literal-colors */

// Position the overlay on the map canvas
function getPositionStyle(position: MapCornerPosition): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    zIndex: 3,
    maxWidth: 220,
    maxHeight: '70%',
    overflowY: 'auto',
    overflowX: 'hidden',
    pointerEvents: 'auto',
    // Scrollbar styling falls back gracefully
  };

  switch (position) {
    case 'topleft':
      return { ...base, top: 8, left: 8 };
    case 'top':
      return { ...base, top: 8, left: '50%', transform: 'translateX(-50%)' };
    case 'topright':
      return { ...base, top: 8, right: 8 };
    case 'left':
      return { ...base, top: '50%', left: 8, transform: 'translateY(-50%)' };
    case 'right':
      return { ...base, top: '50%', right: 8, transform: 'translateY(-50%)' };
    case 'bottomleft':
      return { ...base, bottom: 36, left: 8 };
    case 'bottom':
      return {
        ...base,
        bottom: 36,
        left: '50%',
        transform: 'translateX(-50%)',
      };
    case 'bottomright':
    default:
      return { ...base, bottom: 36, right: 8 };
  }
}

function colorWithAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const normalizedHex =
      hex.length === 3
        ? hex
            .split('')
            .map(char => `${char}${char}`)
            .join('')
        : hex;
    if (normalizedHex.length === 6) {
      const r = parseInt(normalizedHex.slice(0, 2), 16);
      const g = parseInt(normalizedHex.slice(2, 4), 16);
      const b = parseInt(normalizedHex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  const rgbMatch = color.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/i,
  );
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }
  return `rgba(241, 245, 249, ${alpha})`;
}

function LegendPanel({
  colorScale,
  valueRange,
  position = 'bottomright',
  displayType = 'vertical_list',
  classes,
  metricName,
  noDataColor = { r: 204, g: 204, b: 204, a: 1 },
  levelBorderColors = [],
  levelLabels = {},
  showBoundaryLegend = false,
  manualBreaks,
  manualColors,
  stagedLegendDefinition,
  legendEntries = [],
}: LegendPanelProps): React.ReactElement | null {
  const breaks = useMemo(() => {
    if (stagedLegendDefinition?.items?.length) {
      const boundaries = stagedLegendDefinition.items.flatMap(item =>
        [item.startValue, item.endValue].filter(
          (value): value is number =>
            typeof value === 'number' && Number.isFinite(value),
        ),
      );
      return Array.from(new Set(boundaries)).sort((a, b) => a - b);
    }
    if (manualBreaks && manualBreaks.length > 1) {
      return [...manualBreaks].sort((a, b) => a - b);
    }
    const step = (valueRange.max - valueRange.min) / classes;
    return Array.from(
      { length: classes + 1 },
      (_, i) => valueRange.min + step * i,
    );
  }, [classes, manualBreaks, stagedLegendDefinition, valueRange]);

  const getLevelName = (level: number): string =>
    levelLabels[level] || `Level ${level}`;

  // Build the list of items to render.
  // PRIORITY: legendEntries (pre-computed from staged) > stagedLegendDefinition
  // items (direct DHIS2 legend set) > auto-computed breaks (fallback only).
  // When a staged legend set exists, ONLY its items show — no auto-computed.
  const items = useMemo(() => {
    // 1. Pre-computed entries from buildLegendEntries (uses staged if available)
    if (legendEntries.length) {
      return legendEntries.map(entry => ({
        key: entry.key,
        color: entry.color,
        label: entry.label,
      }));
    }
    // 2. Direct staged legend definition items (DHIS2 legend sets)
    if (stagedLegendDefinition?.items?.length) {
      return stagedLegendDefinition.items.map((item, index) => {
        const startValue = item.startValue;
        const endValue = item.endValue;
        const displayColor = item.color;
        const formattedRange =
          typeof startValue === 'number' && typeof endValue === 'number'
            ? `${formatValue(startValue)} – ${formatValue(endValue)}`
            : item.label || t('Legend item');
        const label = item.label
          ? `${item.label}: ${formattedRange}`
          : formattedRange;
        return {
          key: item.id || `${index}-${displayColor}`,
          color: displayColor,
          label,
        };
      });
    }
    // 3. Fallback: auto-computed breaks (only when no staged legend exists)
    return breaks.slice(0, -1).map((breakValue, index) => {
      const endValue = breaks[index + 1];
      const midValue =
        typeof breakValue === 'number' && typeof endValue === 'number'
          ? (breakValue + endValue) / 2
          : typeof breakValue === 'number'
            ? breakValue
            : 0;
      const displayColor =
        manualColors && manualColors[index]
          ? manualColors[index]
          : colorScale(midValue);
      const label =
        typeof breakValue === 'number' && typeof endValue === 'number'
          ? `${formatValue(breakValue)} – ${formatValue(endValue)}`
          : t('Legend item');
      return {
        key: `${index}-${displayColor}`,
        color: displayColor,
        label,
      };
    });
  }, [legendEntries, stagedLegendDefinition, breaks, manualColors, colorScale]);

  const noDataColorStr = `rgba(${noDataColor.r},${noDataColor.g},${noDataColor.b},${noDataColor.a})`;

  const isCompact = displayType === 'compact';
  const isHorizontal = displayType === 'horizontal_chips';

  // Container styles — uses Pro theme CSS vars with fallbacks
  const containerStyle: React.CSSProperties = {
    ...getPositionStyle(position),
    background: 'var(--pro-legend-bg)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid var(--pro-border)',
    borderRadius: 'var(--pro-radius-sm, 8px)' as any,
    boxShadow: 'var(--pro-shadow-md, 0 2px 12px rgba(0,0,0,0.1))',
    padding: isCompact ? '4px 7px' : '8px 12px',
    minWidth: isCompact ? 100 : 120,
    fontFamily: 'var(--pro-font-family, Inter, "Segoe UI", Roboto, sans-serif)',
  };

  // Title style
  const titleStyle: React.CSSProperties = {
    fontSize: isCompact ? 9 : 10,
    fontWeight: 600,
    color: 'var(--pro-text-primary)',
    marginBottom: isCompact ? 2 : 5,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 200,
  };

  // Item list style
  const listStyle: React.CSSProperties = isHorizontal
    ? {
        display: 'flex',
        flexWrap: 'wrap' as const,
        gap: '3px 6px',
        alignItems: 'center',
      }
    : {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: isCompact ? 1 : 3,
      };

  // Single item style
  const itemStyle: React.CSSProperties = isHorizontal
    ? {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        color: 'var(--pro-text-secondary)',
        background: 'var(--pro-bg-canvas)',
        border: '1px solid var(--pro-border)',
        borderRadius: 999,
        padding: '1px 6px',
        whiteSpace: 'nowrap' as const,
      }
    : {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: isCompact ? 9 : 10,
        color: 'var(--pro-text-secondary)',
        lineHeight: isCompact ? '1.2' : '1.3',
      };

  const swatchStyle = (color: string): React.CSSProperties => ({
    width: isCompact ? 10 : 12,
    minWidth: isCompact ? 10 : 12,
    height: isCompact ? 10 : 12,
    background: color,
    borderRadius: 2,
    border: `1px solid ${colorWithAlpha(color, 0.5)}`,
    flexShrink: 0,
  });

  return (
    <div style={containerStyle}>
      {/* Metric title */}
      <div style={titleStyle} title={metricName}>
        {metricName}
      </div>

      {/* Legend items */}
      <div style={listStyle}>
        {items.map(entry => (
          <div key={entry.key} style={itemStyle}>
            <div style={swatchStyle(entry.color)} />
            <span>{entry.label}</span>
          </div>
        ))}

        {/* No data */}
        <div style={itemStyle}>
          <div style={swatchStyle(noDataColorStr)} />
          <span style={{ color: 'var(--pro-text-muted)' }}>{t('No data')}</span>
        </div>
      </div>

      {/* Boundary level legend */}
      {showBoundaryLegend && levelBorderColors && levelBorderColors.length > 1 && (
        <>
          <div
            style={{
              height: 1,
              background: 'rgba(148,163,184,0.25)',
              margin: '5px 0 4px',
            }}
          />
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--pro-text-secondary)',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
              marginBottom: 3,
            }}
          >
            {t('Boundary Levels')}
          </div>
          <div style={listStyle}>
            {levelBorderColors.map(levelConfig => {
              const levelColor = `rgba(${levelConfig.color.r},${levelConfig.color.g},${levelConfig.color.b},${levelConfig.color.a})`;
              return (
                <div key={levelConfig.level} style={itemStyle}>
                  <div
                    style={{
                      width: isCompact ? 10 : 12,
                      minWidth: isCompact ? 10 : 12,
                      height: Math.max((levelConfig.width || 1) * 2, 2),
                      background: levelColor,
                      borderRadius: 1,
                      flexShrink: 0,
                    }}
                  />
                  <span>{getLevelName(levelConfig.level)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* eslint-enable theme-colors/no-literal-colors */

export default LegendPanel;
