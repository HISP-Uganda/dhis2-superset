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
import { styled, t } from '@superset-ui/core';
import { ComputedLegendEntry, formatValue } from '../utils';
import {
  DHIS2LegendDefinition,
  LevelBorderColor,
  MapCornerPosition,
} from '../types';

interface LegendPanelProps {
  colorScale: (value: number) => string;
  valueRange: { min: number; max: number };
  position: MapCornerPosition;
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

/* eslint-disable theme-colors/no-literal-colors */
const LegendContainer = styled.div<{
  position: MapCornerPosition;
}>`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  justify-content: ${({ position }) =>
    position.includes('left') ? 'flex-start' : 'flex-end'};
  pointer-events: none;
`;

const LegendContent = styled.div`
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 3px 6px;
`;

const LegendTitle = styled.div`
  flex: 1 0 100%;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  width: fit-content;
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(191, 219, 254, 0.28);
  font-weight: 500;
  margin-bottom: 0;
  font-size: 7px;
  line-height: 1.15;
  color: #334155;
  text-align: right;
  white-space: normal;
  overflow-wrap: anywhere;
`;

const LegendItem = styled.div<{
  $backgroundColor?: string;
  $borderColor?: string;
}>`
  display: inline-flex;
  align-items: center;
  font-size: 7px;
  line-height: 1.1;
  font-weight: 400;
  color: #334155;
  white-space: normal;
  max-width: 100%;
  padding: 2px 5px;
  border-radius: 999px;
  background: ${({ $backgroundColor }) =>
    $backgroundColor || 'rgba(248, 250, 252, 0.88)'};
  border: 1px solid
    ${({ $borderColor }) => $borderColor || 'rgba(148, 163, 184, 0.28)'};
`;

const ColorBox = styled.div<{ color: string }>`
  width: 8px;
  min-width: 8px;
  height: 7px;
  background: ${({ color }) => color};
  margin-right: 3px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 2px;
`;

const LegendDivider = styled.hr`
  width: 1px;
  align-self: stretch;
  border: none;
  background: rgba(15, 23, 42, 0.1);
  margin: 0 2px;
`;

const BoundaryLegendTitle = styled.div`
  font-weight: 500;
  font-size: 7px;
  line-height: 1.1;
  color: #475569;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(226, 232, 240, 0.5);
`;

const BorderLineBox = styled.div<{ color: string; width: number }>`
  width: 8px;
  min-width: 8px;
  background: ${({ color }) => color};
  margin-right: 3px;
  border-radius: 1px;
  height: ${({ width }) => Math.max(width * 2, 2)}px;
`;
/* eslint-enable theme-colors/no-literal-colors */

function LegendPanel({
  colorScale,
  valueRange,
  position,
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
  // Calculate breaks - use manual breaks if provided, otherwise auto-calculate
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
      // For manual breaks, sort them and return all break points
      return [...manualBreaks].sort((a, b) => a - b);
    }
    // Auto-calculate equal interval breaks
    const step = (valueRange.max - valueRange.min) / classes;
    return Array.from(
      { length: classes + 1 },
      (_, i) => valueRange.min + step * i,
    );
  }, [classes, manualBreaks, stagedLegendDefinition, valueRange]);

  // Helper to get level name
  const getLevelName = (level: number): string =>
    levelLabels[level] || `Level ${level}`;

  return (
    <LegendContainer position={position}>
      <LegendContent>
        <LegendTitle>{metricName}</LegendTitle>
        {(legendEntries.length
        ? legendEntries
        : (stagedLegendDefinition?.items?.length
            ? stagedLegendDefinition.items.map((item, index) => ({
                item,
                index,
                breakValue: undefined as number | undefined,
              }))
            : breaks.slice(0, -1).map((breakValue, index) => ({
                item: undefined,
                index,
                breakValue,
              }))
          ).map(({ item, index, breakValue }) => {
            const startValue = item?.startValue ?? breakValue ?? breaks[index];
            const endValue = item?.endValue ?? breaks[index + 1];
            const midValue =
              typeof startValue === 'number' && typeof endValue === 'number'
                ? (startValue + endValue) / 2
                : typeof startValue === 'number'
                  ? startValue
                  : 0;
            const displayColor =
              item?.color ||
              (manualColors && manualColors[index]
                ? manualColors[index]
                : colorScale(midValue));
            const formattedRange =
              typeof startValue === 'number' && typeof endValue === 'number'
                ? `${formatValue(startValue)} - ${formatValue(endValue)}`
                : item?.label || t('Legend item');
            const label = item?.label
              ? `${item.label}: ${formattedRange}`
              : formattedRange;
            return {
              key: item?.id || `${index}-${displayColor}`,
              color: displayColor,
              label,
            };
          })).map(entry => {
        return (
          <LegendItem
            key={entry.key}
            $backgroundColor={colorWithAlpha(entry.color, 0.14)}
            $borderColor={colorWithAlpha(entry.color, 0.28)}
          >
            <ColorBox color={entry.color} />
            <span>{entry.label}</span>
          </LegendItem>
        );
      })}
        <LegendItem
          $backgroundColor={colorWithAlpha(
            `rgba(${noDataColor.r},${noDataColor.g},${noDataColor.b},${noDataColor.a})`,
            0.12,
          )}
          $borderColor={colorWithAlpha(
            `rgba(${noDataColor.r},${noDataColor.g},${noDataColor.b},${noDataColor.a})`,
            0.22,
          )}
        >
          <ColorBox
            color={`rgba(${noDataColor.r},${noDataColor.g},${noDataColor.b},${noDataColor.a})`}
          />
          <span>{t('No data')}</span>
        </LegendItem>

        {/* Boundary Level Legend */}
        {showBoundaryLegend &&
          levelBorderColors &&
          levelBorderColors.length > 1 && (
            <>
              <LegendDivider />
              <BoundaryLegendTitle>{t('Boundary Levels')}</BoundaryLegendTitle>
              {levelBorderColors.map(levelConfig => (
                <LegendItem
                  key={levelConfig.level}
                  $backgroundColor={colorWithAlpha(
                    `rgba(${levelConfig.color.r},${levelConfig.color.g},${levelConfig.color.b},${levelConfig.color.a})`,
                    0.12,
                  )}
                  $borderColor={colorWithAlpha(
                    `rgba(${levelConfig.color.r},${levelConfig.color.g},${levelConfig.color.b},${levelConfig.color.a})`,
                    0.26,
                  )}
                >
                  <BorderLineBox
                    color={`rgba(${levelConfig.color.r},${levelConfig.color.g},${levelConfig.color.b},${levelConfig.color.a})`}
                    width={levelConfig.width || 1}
                  />
                  <span>{getLevelName(levelConfig.level)}</span>
                </LegendItem>
              ))}
            </>
          )}
      </LegendContent>
    </LegendContainer>
  );
};

export default LegendPanel;
