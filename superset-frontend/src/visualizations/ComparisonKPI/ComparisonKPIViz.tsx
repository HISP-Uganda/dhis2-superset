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
import { styled } from '@superset-ui/core';
import { ComparisonKPIChartProps } from './types';

/* ── Styled Components ─────────────────────────────── */

interface CardWrapperProps {
  $padding: number;
  $radius: number;
}

const CardWrapper = styled.div<CardWrapperProps>`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  padding: ${({ $padding }) => $padding}px;
  background: transparent;
  font-family: var(--pro-font-family, Inter, 'Segoe UI', Roboto, sans-serif);
  overflow: hidden;
`;

const Title = styled.div<{ $size: number }>`
  font-size: ${({ $size }) => $size}px;
  font-weight: 600;
  color: var(--pro-text-secondary, #6B7280);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
`;

const Subtitle = styled.div`
  font-size: 11px;
  color: var(--pro-text-muted, #9CA3AF);
  margin-bottom: 12px;
`;

const ValueText = styled.div<{ $size: number }>`
  font-size: ${({ $size }) => $size}px;
  font-weight: 700;
  color: var(--pro-text-primary, #1A1F2C);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
`;

const DeltaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
`;

interface DeltaBadgeProps {
  $state: 'positive' | 'negative' | 'neutral';
  $size: number;
}

const DeltaBadge = styled.span<DeltaBadgeProps>`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: ${({ $size }) => $size}px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--pro-radius-chip, 999px);
  background: ${({ $state }) =>
    $state === 'positive'
      ? 'var(--pro-success-bg, rgba(46,125,50,0.08))'
      : $state === 'negative'
        ? 'var(--pro-danger-bg, rgba(211,47,47,0.08))'
        : 'var(--pro-info-bg, rgba(25,118,210,0.06))'};
  color: ${({ $state }) =>
    $state === 'positive'
      ? 'var(--pro-success, #2E7D32)'
      : $state === 'negative'
        ? 'var(--pro-danger, #D32F2F)'
        : 'var(--pro-text-muted, #9CA3AF)'};
`;

const ComparisonRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--pro-text-muted, #9CA3AF);
`;

const ComparisonLabel = styled.span`
  font-weight: 500;
`;

const ComparisonVal = styled.span`
  font-weight: 600;
  color: var(--pro-text-secondary, #6B7280);
`;

/* ── Gauge SVG ─────────────────────────────────────── */

interface GaugeProps {
  percent: number;
  state: 'positive' | 'negative' | 'neutral';
  size?: number;
}

function GaugeRing({ percent, state, size = 80 }: GaugeProps) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  const colorMap = {
    positive: 'var(--pro-success, #2E7D32)',
    negative: 'var(--pro-danger, #D32F2F)',
    neutral: 'var(--pro-accent, #4DA3FF)',
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ marginBottom: 8 }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--pro-border, #E5EAF0)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={colorMap[state]}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="14"
        fontWeight="700"
        fill="var(--pro-text-primary, #1A1F2C)"
      >
        {Math.round(percent)}%
      </text>
    </svg>
  );
}

/* ── Main Component ────────────────────────────────── */

export default function ComparisonKPIViz(props: ComparisonKPIChartProps) {
  const {
    width,
    height,
    formattedCurrentValue,
    formattedComparisonValue,
    formattedAbsoluteDelta,
    formattedPercentageDelta,
    trendDirection,
    semanticState,
    comparisonLabel,
    showAbsoluteDelta,
    showPercentageDelta,
    showGauge,
    gaugePercent,
    title,
    subtitle,
    titleFontSize,
    valueFontSize,
    deltaFontSize,
    cardPadding,
    borderRadius,
    showComparisonValue,
  } = props;

  const arrow =
    trendDirection === 'up' ? '↑' : trendDirection === 'down' ? '↓' : '';

  return (
    <CardWrapper
      $padding={cardPadding}
      $radius={borderRadius}
      style={{ width, height }}
    >
      {title && <Title $size={titleFontSize}>{title}</Title>}
      {subtitle && <Subtitle>{subtitle}</Subtitle>}

      {showGauge && gaugePercent !== null && (
        <GaugeRing percent={gaugePercent} state={semanticState} />
      )}

      <ValueText $size={valueFontSize}>{formattedCurrentValue}</ValueText>

      {(showAbsoluteDelta || showPercentageDelta) &&
        trendDirection !== 'flat' && (
          <DeltaRow>
            {showAbsoluteDelta && formattedAbsoluteDelta && (
              <DeltaBadge $state={semanticState} $size={deltaFontSize}>
                {arrow} {formattedAbsoluteDelta}
              </DeltaBadge>
            )}
            {showPercentageDelta && formattedPercentageDelta && (
              <DeltaBadge $state={semanticState} $size={deltaFontSize}>
                {formattedPercentageDelta}
              </DeltaBadge>
            )}
          </DeltaRow>
        )}

      {showComparisonValue && formattedComparisonValue && (
        <ComparisonRow>
          <ComparisonLabel>{comparisonLabel}:</ComparisonLabel>
          <ComparisonVal>{formattedComparisonValue}</ComparisonVal>
        </ComparisonRow>
      )}
    </CardWrapper>
  );
}
