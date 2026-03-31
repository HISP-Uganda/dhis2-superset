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
import { useRef, useEffect, useMemo } from 'react';
import * as echarts from 'echarts';
import { styled, getNumberFormatter } from '@superset-ui/core';
import { SmallMultiplesChartProps, PanelData, MiniChartType } from './types';

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;
  font-family: var(--pro-font-family, Inter, 'Segoe UI', Roboto, sans-serif);
`;

interface GridContainerProps {
  $columns: number;
  $gap: number;
}

const GridContainer = styled.div<GridContainerProps>`
  display: grid;
  grid-template-columns: repeat(${({ $columns }) => $columns}, 1fr);
  gap: ${({ $gap }) => $gap}px;
  padding: ${({ $gap }) => $gap}px;
  height: 100%;
  width: 100%;
  align-content: start;
`;

interface PanelCardProps {
  $padding: number;
}

const PanelCard = styled.div<PanelCardProps>`
  background: var(--pro-bg-card, #FFFFFF);
  border: 1px solid var(--pro-border, #E5EAF0);
  border-radius: 8px;
  padding: ${({ $padding }) => $padding}px;
  overflow: hidden;
  min-height: 100px;
`;

const PanelTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: var(--pro-text-secondary, #6B7280);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--pro-text-muted, #9CA3AF);
  font-size: 14px;
`;

/* ── Mini EChart panel ─────────────────────────────── */

function MiniPanel({
  panel,
  chartType,
  syncYMin,
  syncYMax,
  showXAxis,
  showYAxis,
  lineWidth,
  yAxisFormat,
  chartHeight,
}: {
  panel: PanelData;
  chartType: MiniChartType;
  syncYMin: number | undefined;
  syncYMax: number | undefined;
  showXAxis: boolean;
  showYAxis: boolean;
  lineWidth: number;
  yAxisFormat: string;
  chartHeight: number;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  const yFmt = useMemo(() => getNumberFormatter(yAxisFormat), [yAxisFormat]);
  const color = 'var(--pro-accent, #1976D2)';

  useEffect(() => {
    if (!chartRef.current) return;
    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current);
    }

    const seriesBase: any = {
      data: panel.yValues,
      smooth: chartType === 'line',
      lineStyle: { width: lineWidth, color },
      itemStyle: { color },
      symbol: 'none',
    };

    let series: any;
    if (chartType === 'bar') {
      series = { ...seriesBase, type: 'bar', barMaxWidth: 8 };
    } else if (chartType === 'area') {
      series = {
        ...seriesBase,
        type: 'line',
        areaStyle: { color: 'rgba(25,118,210,0.12)' },
      };
    } else {
      series = { ...seriesBase, type: 'line' };
    }

    instanceRef.current.setOption(
      {
        grid: {
          top: 4,
          right: 4,
          bottom: showXAxis ? 20 : 4,
          left: showYAxis ? 32 : 4,
        },
        xAxis: {
          type: 'category',
          data: panel.xValues,
          show: showXAxis,
          axisLabel: { fontSize: 8, color: '#9CA3AF' },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          show: showYAxis,
          min: syncYMin,
          max: syncYMax,
          axisLabel: {
            fontSize: 8,
            color: '#9CA3AF',
            formatter: (v: number) => yFmt(v),
          },
          splitLine: {
            lineStyle: { color: '#E5EAF0', type: 'dashed', width: 0.5 },
          },
        },
        series: [series],
        animation: false,
      },
      true,
    );

    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, [panel, chartType, syncYMin, syncYMax, showXAxis, showYAxis, lineWidth, yFmt]);

  return (
    <div ref={chartRef} style={{ width: '100%', height: chartHeight }} />
  );
}

/* ── Main Component ────────────────────────────────── */

export default function SmallMultiplesViz(props: SmallMultiplesChartProps) {
  const {
    width,
    height,
    panels,
    columns,
    miniChartType,
    syncYAxis,
    showPanelTitle,
    showXAxis,
    showYAxis,
    panelPadding,
    lineWidth,
    globalYMin,
    globalYMax,
    yAxisFormat,
  } = props;

  if (!panels || panels.length === 0) {
    return (
      <Wrapper style={{ width, height }}>
        <EmptyState>No data to display</EmptyState>
      </Wrapper>
    );
  }

  const rows = Math.ceil(panels.length / columns);
  const panelHeight = Math.max(
    60,
    (height - panelPadding * (rows + 1)) / rows - (showPanelTitle ? 20 : 0) - panelPadding * 2,
  );

  return (
    <Wrapper style={{ width, height }}>
      <GridContainer $columns={columns} $gap={panelPadding}>
        {panels.map(panel => (
          <PanelCard key={panel.title} $padding={panelPadding}>
            {showPanelTitle && <PanelTitle>{panel.title}</PanelTitle>}
            <MiniPanel
              panel={panel}
              chartType={miniChartType}
              syncYMin={syncYAxis ? globalYMin : undefined}
              syncYMax={syncYAxis ? globalYMax : undefined}
              showXAxis={showXAxis}
              showYAxis={showYAxis}
              lineWidth={lineWidth}
              yAxisFormat={yAxisFormat}
              chartHeight={panelHeight}
            />
          </PanelCard>
        ))}
      </GridContainer>
    </Wrapper>
  );
}
