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
import { useMemo } from 'react';
import { styled, getNumberFormatter } from '@superset-ui/core';
import { ViolinDistributionChartProps, ViolinGroup } from './types';

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;
  font-family: var(--pro-font-family, Inter, 'Segoe UI', Roboto, sans-serif);
  background: transparent;
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--pro-text-muted, #9CA3AF);
  font-size: 14px;
`;

/* ── Pseudo-random jitter (deterministic) ──────────── */

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/* ── SVG Violin ────────────────────────────────────── */

function ViolinPanel({
  group,
  cx,
  yScale,
  maxDensity,
  halfWidth,
  plotHeight,
  plotTop,
  showMedian,
  showIQR,
  showJitter,
  jitterOpacity,
  jitterSize,
  color,
}: {
  group: ViolinGroup;
  cx: number;
  yScale: (v: number) => number;
  maxDensity: number;
  halfWidth: number;
  plotHeight: number;
  plotTop: number;
  showMedian: boolean;
  showIQR: boolean;
  showJitter: boolean;
  jitterOpacity: number;
  jitterSize: number;
  color: string;
}) {
  // Build violin path (symmetric)
  const dScale = maxDensity > 0 ? halfWidth / maxDensity : 0;
  const leftPath: string[] = [];
  const rightPath: string[] = [];

  for (const [val, density] of group.densityPoints) {
    const y = yScale(val);
    const dx = density * dScale;
    leftPath.push(`${cx - dx},${y}`);
    rightPath.push(`${cx + dx},${y}`);
  }

  const pathStr = `M ${leftPath.join(' L ')} L ${rightPath.reverse().join(' L ')} Z`;

  return (
    <g>
      {/* Violin shape */}
      <path d={pathStr} fill={color} opacity={0.25} stroke={color} strokeWidth={1} />

      {/* IQR box */}
      {showIQR && (
        <rect
          x={cx - halfWidth * 0.15}
          y={yScale(group.q3)}
          width={halfWidth * 0.3}
          height={Math.max(1, yScale(group.q1) - yScale(group.q3))}
          fill={color}
          opacity={0.5}
          rx={2}
        />
      )}

      {/* Median line */}
      {showMedian && (
        <line
          x1={cx - halfWidth * 0.25}
          x2={cx + halfWidth * 0.25}
          y1={yScale(group.median)}
          y2={yScale(group.median)}
          stroke="#FFFFFF"
          strokeWidth={2.5}
        />
      )}

      {/* Jitter points */}
      {showJitter &&
        group.values.map((v, i) => {
          const jx = cx + (seededRandom(i + v) - 0.5) * halfWidth * 0.6;
          return (
            <circle
              key={i}
              cx={jx}
              cy={yScale(v)}
              r={jitterSize}
              fill={color}
              opacity={jitterOpacity}
            />
          );
        })}
    </g>
  );
}

/* ── Main Component ────────────────────────────────── */

const VIOLIN_COLORS = [
  '#1976D2', '#2E7D32', '#D32F2F', '#F9A825',
  '#7B1FA2', '#00838F', '#E64A19', '#0D3B66',
];

export default function ViolinDistributionViz(
  props: ViolinDistributionChartProps,
) {
  const {
    width,
    height,
    groups,
    showJitter,
    showMedian,
    showIQR,
    violinWidth,
    jitterOpacity,
    jitterSize,
    yAxisFormat,
  } = props;

  const yFmt = useMemo(
    () => getNumberFormatter(yAxisFormat),
    [yAxisFormat],
  );

  if (!groups || groups.length === 0) {
    return (
      <Wrapper style={{ width, height }}>
        <EmptyState>No distribution data available</EmptyState>
      </Wrapper>
    );
  }

  const margin = { top: 24, right: 24, bottom: 40, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  // Compute global Y range
  const allValues = groups.flatMap(g => g.values);
  const globalMin = Math.min(...allValues);
  const globalMax = Math.max(...allValues);
  const yRange = globalMax - globalMin || 1;
  const yPad = yRange * 0.05;

  const yScale = (v: number): number => {
    return (
      margin.top +
      plotHeight -
      ((v - (globalMin - yPad)) / (yRange + 2 * yPad)) * plotHeight
    );
  };

  // Max density across all groups
  const maxDensity = Math.max(
    ...groups.flatMap(g => g.densityPoints.map(([, d]) => d)),
    0.001,
  );

  const halfWidth = violinWidth / 2;
  const groupWidth = plotWidth / groups.length;

  // Y-axis ticks
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const v = globalMin - yPad + ((yRange + 2 * yPad) * i) / tickCount;
    return v;
  });

  return (
    <Wrapper style={{ width, height }}>
      <svg width={width} height={height}>
        {/* Y-axis grid lines and labels */}
        {ticks.map((v, i) => {
          const y = yScale(v);
          return (
            <g key={i}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y}
                y2={y}
                stroke="#E5EAF0"
                strokeDasharray="3,3"
                strokeWidth={0.5}
              />
              <text
                x={margin.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={10}
                fill="#9CA3AF"
              >
                {yFmt(v)}
              </text>
            </g>
          );
        })}

        {/* Violins */}
        {groups.map((group, idx) => {
          const cx = margin.left + groupWidth * idx + groupWidth / 2;
          return (
            <g key={group.name}>
              <ViolinPanel
                group={group}
                cx={cx}
                yScale={yScale}
                maxDensity={maxDensity}
                halfWidth={halfWidth}
                plotHeight={plotHeight}
                plotTop={margin.top}
                showMedian={showMedian}
                showIQR={showIQR}
                showJitter={showJitter}
                jitterOpacity={jitterOpacity}
                jitterSize={jitterSize}
                color={VIOLIN_COLORS[idx % VIOLIN_COLORS.length]}
              />
              {/* Group label */}
              <text
                x={cx}
                y={height - margin.bottom + 20}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="#6B7280"
              >
                {group.name}
              </text>
            </g>
          );
        })}
      </svg>
    </Wrapper>
  );
}
