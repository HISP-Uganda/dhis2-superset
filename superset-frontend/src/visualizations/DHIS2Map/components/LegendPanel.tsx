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

import React, { useState, useMemo } from 'react';
import { styled, t } from '@superset-ui/core';
import { ComputedLegendEntry, formatValue } from '../utils';
import { DHIS2LegendDefinition, LevelBorderColor } from '../types';

export type LegendMode = 'compact' | 'detailed' | 'hidden';
export type LegendPosition =
  | 'topleft'
  | 'topright'
  | 'bottomleft'
  | 'bottomright';

interface LegendPanelProps {
  colorScale: (value: number) => string;
  valueRange: { min: number; max: number };
  position: LegendPosition;
  classes: number;
  metricName: string;
  mode?: LegendMode;
  onModeChange?: (mode: LegendMode) => void;
  backgroundColor?: string;
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
const LegendContainer = styled.div<{
  position: LegendPosition;
  isCompact: boolean;
  backgroundColor: string;
}>`
  position: absolute;
  ${({ position }) => {
    const [vertical, horizontal] = [
      position.includes('top') ? 'top: 12px' : 'bottom: 18px',
      position.includes('left') ? 'left: 12px' : 'right: 12px',
    ];
    return `${vertical}; ${horizontal};`;
  }}
  background: ${({ backgroundColor }) => backgroundColor};
  padding: ${({ isCompact }) => (isCompact ? '4px 6px' : '6px 8px')};
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  min-width: ${({ isCompact }) => (isCompact ? '88px' : '112px')};
  max-width: ${({ isCompact }) => (isCompact ? '160px' : '190px')};
  max-height: ${({ isCompact }) => (isCompact ? '34px' : '240px')};
  overflow-y: auto;
  opacity: 0.95;
  backdrop-filter: blur(2px);
`;

const LegendHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
`;

const LegendTitle = styled.div`
  font-weight: 600;
  margin-bottom: 2px;
  font-size: 10px;
  line-height: 1.2;
  max-width: 132px;
  word-break: break-word;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  margin: 2px 0;
  font-size: 9px;
  line-height: 1.2;
`;

const ColorBox = styled.div<{ color: string }>`
  width: 14px;
  min-width: 14px;
  height: 10px;
  background: ${({ color }) => color};
  margin-right: 6px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 2px;
`;

const ModeButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  font-size: 10px;
  color: #666;
  padding: 0 2px;

  &:hover {
    color: #000;
  }
`;

const CompactLegend = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  line-height: 1.1;
`;

const LegendDivider = styled.hr`
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  margin: 6px 0;
`;

const BoundaryLegendTitle = styled.div`
  font-weight: 600;
  font-size: 9px;
  margin-bottom: 3px;
  color: #666;
`;

const BorderLineBox = styled.div<{ color: string; width: number }>`
  width: 14px;
  min-width: 14px;
  background: ${({ color }) => color};
  margin-right: 6px;
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
  mode = 'detailed',
  onModeChange,
  backgroundColor = 'rgba(255, 255, 255, 0.95)',
  noDataColor = { r: 204, g: 204, b: 204, a: 1 },
  levelBorderColors = [],
  levelLabels = {},
  showBoundaryLegend = false,
  manualBreaks,
  manualColors,
  stagedLegendDefinition,
  legendEntries = [],
}: LegendPanelProps): React.ReactElement | null {
  const [currentMode, setCurrentMode] = useState<LegendMode>(mode);

  const handleModeChange = (newMode: LegendMode) => {
    setCurrentMode(newMode);
    onModeChange?.(newMode);
  };

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

  if (currentMode === 'compact') {
    return (
      <LegendContainer
        position={position}
        isCompact
        backgroundColor={backgroundColor}
      >
        <CompactLegend>
          <span>{metricName}:</span>
          <span>
            {formatValue(valueRange.min)} – {formatValue(valueRange.max)}
          </span>
          <ModeButton
            onClick={() => handleModeChange('detailed')}
            title={t('Expand')}
          >
            ▼
          </ModeButton>
        </CompactLegend>
      </LegendContainer>
    );
  }

  return (
    <LegendContainer
      position={position}
      isCompact={false}
      backgroundColor={backgroundColor}
    >
      <LegendHeader>
        <LegendTitle>{metricName}</LegendTitle>
        <div>
          <ModeButton
            onClick={() => handleModeChange('compact')}
            title={t('Compact')}
          >
            ▲
          </ModeButton>
        </div>
      </LegendHeader>
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
          <LegendItem key={entry.key}>
            <ColorBox color={entry.color} />
            <span>{entry.label}</span>
          </LegendItem>
        );
      })}
      <LegendItem>
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
              <LegendItem key={levelConfig.level}>
                <BorderLineBox
                  color={`rgba(${levelConfig.color.r},${levelConfig.color.g},${levelConfig.color.b},${levelConfig.color.a})`}
                  width={levelConfig.width || 1}
                />
                <span>{getLevelName(levelConfig.level)}</span>
              </LegendItem>
            ))}
          </>
        )}
    </LegendContainer>
  );
};

export default LegendPanel;
