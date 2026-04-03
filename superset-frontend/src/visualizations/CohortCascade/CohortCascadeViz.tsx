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
import React from 'react';
import { styled } from '@superset-ui/core';
import { CohortCascadeChartProps, CascadeOrientation } from './types';

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 16px;
  font-family: var(--pro-font-family, Inter, 'Segoe UI', Roboto, sans-serif);
`;

interface ContainerProps {
  $orientation: CascadeOrientation;
  $gap: number;
}

const Container = styled.div<ContainerProps>`
  display: flex;
  flex-direction: ${({ $orientation }) =>
    $orientation === 'horizontal' ? 'row' : 'column'};
  align-items: ${({ $orientation }) =>
    $orientation === 'horizontal' ? 'flex-end' : 'stretch'};
  gap: ${({ $gap }) => $gap}px;
  height: 100%;
  width: 100%;
`;

interface StageBlockProps {
  $orientation: CascadeOrientation;
}

const StageBlock = styled.div<StageBlockProps>`
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: ${({ $orientation }) => ($orientation === 'horizontal' ? 1 : 'unset')};
  min-width: 0;
`;

interface BarProps {
  $heightPercent: number;
  $color: string;
  $radius: number;
  $orientation: CascadeOrientation;
}

const Bar = styled.div<BarProps>`
  width: ${({ $orientation }) => ($orientation === 'horizontal' ? '100%' : '100%')};
  height: ${({ $orientation, $heightPercent }) =>
    $orientation === 'vertical'
      ? '48px'
      : `${Math.max(20, $heightPercent)}%`};
  background: ${({ $color }) => $color};
  border-radius: ${({ $radius }) => $radius}px;
  position: relative;
  transition: all 0.3s ease;
  min-height: 20px;

  /* Width represents proportion in vertical layout */
  ${({ $orientation, $heightPercent }) =>
    $orientation === 'vertical'
      ? `width: ${Math.max(10, $heightPercent)}%; margin: 0 auto;`
      : ''}
`;

const StageLabel = styled.div<{ $size: number }>`
  font-size: ${({ $size }) => $size}px;
  font-weight: 600;
  color: var(--pro-text-secondary);
  text-align: center;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
`;

const StageValue = styled.div<{ $size: number }>`
  font-size: ${({ $size }) => $size}px;
  font-weight: 700;
  color: var(--pro-text-primary);
  text-align: center;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
`;

const PercentBadge = styled.div<{ $type: 'retained' | 'lost' }>`
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--pro-radius-chip, 999px);
  margin-top: 4px;
  background: ${({ $type }) =>
    $type === 'retained'
      ? 'var(--pro-success-bg)'
      : 'var(--pro-danger-bg)'};
  color: ${({ $type }) =>
    $type === 'retained'
      ? 'var(--pro-success)'
      : 'var(--pro-danger)'};
`;

interface ConnectorProps {
  $orientation: CascadeOrientation;
}

const Connector = styled.div<ConnectorProps>`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pro-text-muted);
  font-size: 16px;
  flex-shrink: 0;
  ${({ $orientation }) =>
    $orientation === 'horizontal'
      ? 'width: 24px;'
      : 'height: 12px; margin: -8px auto;'}
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--pro-text-muted);
  font-size: 14px;
`;

export default function CohortCascadeViz(props: CohortCascadeChartProps) {
  const {
    width,
    height,
    stages,
    orientation,
    showConnectors,
    showPercentRetained,
    showPercentLost,
    showValues,
    barBorderRadius,
    barGap,
    labelFontSize,
    valueFontSize,
  } = props;

  if (!stages || stages.length === 0) {
    return (
      <Wrapper style={{ width, height }}>
        <EmptyState>No cascade stages configured</EmptyState>
      </Wrapper>
    );
  }

  const maxValue = Math.max(...stages.map(s => s.value), 1);

  return (
    <Wrapper style={{ width, height }}>
      <Container $orientation={orientation} $gap={barGap}>
        {stages.map((stage, idx) => (
          <React.Fragment key={stage.label}>
            {idx > 0 && showConnectors && (
              <Connector $orientation={orientation}>
                {orientation === 'horizontal' ? '→' : '↓'}
              </Connector>
            )}
            <StageBlock $orientation={orientation}>
              <StageLabel $size={labelFontSize}>{stage.label}</StageLabel>
              <Bar
                $heightPercent={(stage.value / maxValue) * 100}
                $color={stage.color}
                $radius={barBorderRadius}
                $orientation={orientation}
              />
              {showValues && (
                <StageValue $size={valueFontSize}>
                  {stage.formattedValue}
                </StageValue>
              )}
              {showPercentRetained && idx > 0 && (
                <PercentBadge $type="retained">
                  {stage.percentRetained.toFixed(1)}% retained
                </PercentBadge>
              )}
              {showPercentLost && stage.percentLost > 0 && (
                <PercentBadge $type="lost">
                  −{stage.percentLost.toFixed(1)}% lost
                </PercentBadge>
              )}
            </StageBlock>
          </React.Fragment>
        ))}
      </Container>
    </Wrapper>
  );
}
