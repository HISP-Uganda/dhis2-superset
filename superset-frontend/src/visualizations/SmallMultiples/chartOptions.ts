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
import type { EChartsOption } from 'echarts';
import { PanelData, PanelSeries, MiniChartType } from './types';

export interface MiniPanelConfig {
  chartType: MiniChartType;
  syncYMin: number | undefined;
  syncYMax: number | undefined;
  showXAxis: boolean;
  showYAxis: boolean;
  lineWidth: number;
  yAxisFormat: string;
  yFormatter: (v: number) => string;
  referenceValue: number | null;
  referenceColor: string;
}

function buildMarkLine(
  refVal: number | null,
  color: string,
): any {
  if (refVal == null) return undefined;
  return {
    silent: true,
    symbol: 'none',
    data: [{ yAxis: refVal }],
    lineStyle: { color, type: 'dashed', width: 1 },
    label: { show: false },
  };
}

function baseGrid(showXAxis: boolean, showYAxis: boolean) {
  return {
    top: 6,
    right: 6,
    bottom: showXAxis ? 22 : 6,
    left: showYAxis ? 36 : 6,
  };
}

function baseXAxis(xValues: string[], show: boolean): any {
  return {
    type: 'category',
    data: xValues,
    show,
    axisLabel: { fontSize: 8, color: '#9CA3AF', rotate: xValues.length > 12 ? 45 : 0 },
    axisLine: { show: false },
    axisTick: { show: false },
  };
}

function baseYAxis(
  config: MiniPanelConfig,
  show: boolean,
): any {
  return {
    type: 'value',
    show,
    min: config.syncYMin,
    max: config.syncYMax,
    axisLabel: {
      fontSize: 8,
      color: '#9CA3AF',
      formatter: (v: number) => config.yFormatter(v),
    },
    splitLine: {
      lineStyle: { color: '#E5EAF0', type: 'dashed', width: 0.5 },
    },
  };
}

/** Build ECharts option for line / area / bar with multi-series */
export function buildLineBarAreaOption(
  panel: PanelData,
  config: MiniPanelConfig,
): EChartsOption {
  const { chartType, lineWidth, referenceValue, referenceColor } = config;
  const markLine = buildMarkLine(
    referenceValue ?? panel.referenceValue,
    referenceColor,
  );

  const series = panel.series.map((s: PanelSeries, idx: number) => {
    const base: any = {
      data: s.values,
      smooth: chartType === 'line' || chartType === 'area',
      lineStyle: { width: lineWidth, color: s.color },
      itemStyle: { color: s.color },
      symbol: 'none',
      name: s.metricLabel,
    };

    if (chartType === 'bar') {
      return { ...base, type: 'bar', barMaxWidth: 10, barGap: '10%' };
    }
    if (chartType === 'area') {
      const opacity = 0.12 + idx * 0.04;
      return {
        ...base,
        type: 'line',
        areaStyle: { color: s.color, opacity },
      };
    }
    return { ...base, type: 'line' };
  });

  // Attach markLine to the first series
  if (markLine && series.length > 0) {
    series[0].markLine = markLine;
  }

  return {
    grid: baseGrid(config.showXAxis, config.showYAxis),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: '#CBD5E1' } },
      textStyle: { fontSize: 10 },
      confine: true,
    },
    xAxis: baseXAxis(panel.xValues, config.showXAxis),
    yAxis: baseYAxis(config, config.showYAxis),
    series,
    animation: false,
    legend: { show: false },
  };
}

/** Build ECharts option for pie / donut */
export function buildPieOption(
  panel: PanelData,
  config: MiniPanelConfig,
): EChartsOption {
  // For pie: use x-axis values as categories, first series values as data
  const s = panel.series[0];
  if (!s) return {};

  const data = panel.xValues.map((name, i) => ({
    name,
    value: s.values[i] ?? 0,
  }));

  const radius =
    config.chartType === 'donut' ? ['35%', '65%'] : ['0%', '65%'];

  return {
    tooltip: {
      trigger: 'item',
      textStyle: { fontSize: 10 },
      confine: true,
      formatter: '{b}: {c} ({d}%)',
    },
    series: [
      {
        type: 'pie',
        radius,
        data,
        label: { show: false },
        emphasis: {
          label: { show: true, fontSize: 10, fontWeight: 'bold' },
        },
        itemStyle: {
          borderColor: '#fff',
          borderWidth: 1,
        },
      },
    ],
    animation: false,
    legend: { show: false },
  };
}

/** Build ECharts option for scatter (needs 2+ metrics) */
export function buildScatterOption(
  panel: PanelData,
  config: MiniPanelConfig,
): EChartsOption {
  const xSeries = panel.series[0];
  const ySeries = panel.series[1];
  if (!xSeries || !ySeries) return {};

  const data = xSeries.values.map((x, i) => [x, ySeries.values[i] ?? 0]);

  return {
    grid: baseGrid(true, true),
    tooltip: {
      trigger: 'item',
      textStyle: { fontSize: 10 },
      confine: true,
      formatter: (params: any) =>
        `${panel.xValues[params.dataIndex] || ''}<br/>${xSeries.metricLabel}: ${params.value[0]}<br/>${ySeries.metricLabel}: ${params.value[1]}`,
    },
    xAxis: {
      type: 'value',
      show: true,
      name: xSeries.metricLabel,
      nameTextStyle: { fontSize: 8, color: '#9CA3AF' },
      axisLabel: { fontSize: 8, color: '#9CA3AF' },
      splitLine: { lineStyle: { color: '#E5EAF0', type: 'dashed', width: 0.5 } },
    },
    yAxis: {
      type: 'value',
      show: true,
      name: ySeries.metricLabel,
      nameTextStyle: { fontSize: 8, color: '#9CA3AF' },
      axisLabel: { fontSize: 8, color: '#9CA3AF' },
      splitLine: { lineStyle: { color: '#E5EAF0', type: 'dashed', width: 0.5 } },
    },
    series: [
      {
        type: 'scatter',
        data,
        symbolSize: 6,
        itemStyle: { color: xSeries.color },
      },
    ],
    animation: false,
    legend: { show: false },
  };
}

/** Build ECharts option for heatmap */
export function buildHeatmapOption(
  panel: PanelData,
  config: MiniPanelConfig,
): EChartsOption {
  const metricLabels = panel.series.map(s => s.metricLabel);
  const data: [number, number, number][] = [];
  let min = Infinity;
  let max = -Infinity;

  panel.series.forEach((s, yIdx) => {
    s.values.forEach((v, xIdx) => {
      data.push([xIdx, yIdx, v]);
      if (v < min) min = v;
      if (v > max) max = v;
    });
  });

  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 100;

  return {
    grid: { top: 6, right: 6, bottom: 24, left: 60 },
    tooltip: {
      trigger: 'item',
      textStyle: { fontSize: 10 },
      confine: true,
    },
    xAxis: {
      type: 'category',
      data: panel.xValues,
      show: true,
      axisLabel: { fontSize: 7, color: '#9CA3AF', rotate: 45 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: metricLabels,
      show: true,
      axisLabel: { fontSize: 8, color: '#9CA3AF' },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    visualMap: {
      min,
      max,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      show: false,
      inRange: {
        color: ['#E3F2FD', '#1976D2', '#0D3B66'],
      },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: { show: data.length <= 40, fontSize: 8 },
        emphasis: {
          itemStyle: { shadowBlur: 4, shadowColor: 'rgba(0,0,0,0.2)' },
        },
      },
    ],
    animation: false,
    legend: { show: false },
  };
}

/** Build ECharts option for gauge */
export function buildGaugeOption(
  panel: PanelData,
  config: MiniPanelConfig,
): EChartsOption {
  const s = panel.series[0];
  if (!s) return {};

  const latestValue = s.values[s.values.length - 1] ?? 0;
  const gaugeMax =
    config.syncYMax != null && Number.isFinite(config.syncYMax)
      ? config.syncYMax
      : Math.max(latestValue * 1.2, 100);

  return {
    series: [
      {
        type: 'gauge',
        min: 0,
        max: gaugeMax,
        progress: { show: true, width: 8 },
        axisLine: { lineStyle: { width: 8, color: [[1, '#E5EAF0']] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { fontSize: 8, color: '#9CA3AF', distance: 10 },
        pointer: { show: true, length: '60%', width: 3 },
        detail: {
          fontSize: 14,
          fontWeight: 'bold',
          color: 'var(--pro-navy, #0D3B66)',
          offsetCenter: [0, '70%'],
          formatter: (v: number) => config.yFormatter(v),
        },
        data: [{ value: latestValue, name: s.metricLabel }],
        title: { show: false },
        itemStyle: { color: s.color },
      },
    ],
    animation: false,
  };
}

/** Dispatch to the correct option builder based on chart type */
export function buildOption(
  panel: PanelData,
  config: MiniPanelConfig,
): EChartsOption {
  switch (config.chartType) {
    case 'pie':
    case 'donut':
      return buildPieOption(panel, config);
    case 'scatter':
      return buildScatterOption(panel, config);
    case 'heatmap':
      return buildHeatmapOption(panel, config);
    case 'gauge':
      return buildGaugeOption(panel, config);
    case 'line':
    case 'bar':
    case 'area':
    default:
      return buildLineBarAreaOption(panel, config);
  }
}
