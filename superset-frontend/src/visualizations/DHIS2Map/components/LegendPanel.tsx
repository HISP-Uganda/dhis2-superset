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
import { formatValue } from '../utils';
import { LevelBorderColor } from '../types';

export type LegendMode = 'compact' | 'detailed' | 'hidden';
export type LegendPosition =
  | 'topleft'
  | 'topright'
  | 'bottomleft'
  | 'bottomright';

// Level names for display
const LEVEL_NAMES: Record<number, string> = {
  1: 'National',
  2: 'Region',
  3: 'District',
  4: 'Sub-county',
  5: 'Parish',
  6: 'Village/Facility',
  7: 'Level 7',
};

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
  showBoundaryLegend?: boolean;
  manualBreaks?: number[];
  manualColors?: string[];
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
      position.includes('top') ? 'top: 10px' : 'bottom: 30px',
      position.includes('left') ? 'left: 10px' : 'right: 10px',
    ];
    return `${vertical}; ${horizontal};`;
  }}
  background: ${({ backgroundColor }) => backgroundColor};
  padding: ${({ isCompact }) => (isCompact ? '6px 8px' : '10px')};
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  min-width: 120px;
  max-height: ${({ isCompact }) => (isCompact ? '40px' : '400px')};
  overflow-y: auto;
  opacity: 0.95;
  backdrop-filter: blur(2px);
`;

const LegendHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const LegendTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 12px;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  margin: 4px 0;
  font-size: 11px;
`;

const ColorBox = styled.div<{ color: string }>`
  width: 20px;
  height: 14px;
  background: ${({ color }) => color};
  margin-right: 8px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 2px;
`;

const ModeButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  padding: 2px 4px;

  &:hover {
    color: #000;
  }
`;

const CompactLegend = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
`;

const LegendDivider = styled.hr`
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  margin: 8px 0;
`;

const BoundaryLegendTitle = styled.div`
  font-weight: 600;
  font-size: 11px;
  margin-bottom: 4px;
  color: #666;
`;

const BorderLineBox = styled.div<{ color: string; width: number }>`
  width: 20px;
  background: ${({ color }) => color};
  margin-right: 8px;
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
  showBoundaryLegend = false,
  manualBreaks,
  manualColors,
}: LegendPanelProps): React.ReactElement | null {
  const [currentMode, setCurrentMode] = useState<LegendMode>(mode);

  const handleModeChange = (newMode: LegendMode) => {
    setCurrentMode(newMode);
    onModeChange?.(newMode);
  };

  // Calculate breaks - use manual breaks if provided, otherwise auto-calculate
  const breaks = useMemo(() => {
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
  }, [manualBreaks, valueRange, classes]);

  // Helper to get level name
  const getLevelName = (level: number): string =>
    LEVEL_NAMES[level] || `Level ${level}`;

  if (currentMode === 'hidden') {
    return null;
  }

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
          <ModeButton
            onClick={() => handleModeChange('hidden')}
            title={t('Hide')}
          >
            ✕
          </ModeButton>
        </div>
      </LegendHeader>
      {breaks.slice(0, -1).map((breakValue, index) => {
        const nextValue = breaks[index + 1];
        // Use the midpoint of the interval to get the color
        const midValue = (breakValue + nextValue) / 2;
        // For manual colors, use the index directly if available
        const displayColor =
          manualColors && manualColors[index]
            ? manualColors[index]
            : colorScale(midValue);
        return (
          <LegendItem key={index}>
            <ColorBox color={displayColor} />
            <span>
              {formatValue(breakValue)} - {formatValue(nextValue)}
            </span>
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
