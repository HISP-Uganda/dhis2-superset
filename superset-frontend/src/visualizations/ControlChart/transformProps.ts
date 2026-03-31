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
import { getMetricLabel, getNumberFormatter } from '@superset-ui/core';
import { ControlChartFormData, ControlChartChartProps, ThresholdMethod } from './types';

/* ── Statistical helpers ───────────────────────────── */

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeThresholds(
  values: number[],
  method: ThresholdMethod,
  baselinePeriods: number,
  csumWeight: number,
): { meanVal: number; ucl: number; lcl: number } {
  const baseline = values.slice(0, Math.min(baselinePeriods, values.length));
  if (baseline.length === 0) return { meanVal: 0, ucl: 0, lcl: 0 };

  const m = mean(baseline);
  const sd = stdDev(baseline);

  switch (method) {
    case 'mean_2sd':
      return { meanVal: m, ucl: m + 2 * sd, lcl: Math.max(0, m - 2 * sd) };
    case 'mean_3sd':
      return { meanVal: m, ucl: m + 3 * sd, lcl: Math.max(0, m - 3 * sd) };
    case 'q3':
      return {
        meanVal: m,
        ucl: percentile(baseline, 75),
        lcl: percentile(baseline, 25),
      };
    case 'csum': {
      const target = m + csumWeight * sd;
      return { meanVal: m, ucl: target, lcl: Math.max(0, m - csumWeight * sd) };
    }
    default:
      return { meanVal: m, ucl: m + 2 * sd, lcl: Math.max(0, m - 2 * sd) };
  }
}

/* ── ECharts option builder ────────────────────────── */

export default function transformProps(chartProps: any): ControlChartChartProps {
  const { width, height, formData, queriesData } = chartProps;
  const fd = formData as ControlChartFormData;
  const data = queriesData?.[0]?.data || [];

  const xCol = fd.x_axis;
  const metricLabel = fd.metrics?.[0] ? getMetricLabel(fd.metrics[0]) : '';
  const yFmt = getNumberFormatter(fd.y_axis_format || 'SMART_NUMBER');

  const xValues: string[] = data.map((r: any) => String(r[xCol] ?? ''));
  const yValues: number[] = data.map((r: any) => (r[metricLabel] as number) ?? 0);

  const manualUclRaw = fd.manual_ucl ? parseFloat(String(fd.manual_ucl)) : null;
  const manualLclRaw = fd.manual_lcl ? parseFloat(String(fd.manual_lcl)) : null;
  const manualUcl = Number.isFinite(manualUclRaw) ? manualUclRaw : null;
  const manualLcl = Number.isFinite(manualLclRaw) ? manualLclRaw : null;

  const computed = computeThresholds(
    yValues,
    fd.threshold_method || 'mean_2sd',
    fd.baseline_periods ?? 52,
    fd.csum_weight ?? 0.5,
  );
  const meanVal = computed.meanVal;
  const ucl = manualUcl !== null ? manualUcl : computed.ucl;
  const lcl = manualLcl !== null ? manualLcl : computed.lcl;

  // Smoothed trend series
  const showTrendSmoothing = fd.show_trend_smoothing ?? false;
  const smoothingWindow = fd.smoothing_window ?? 3;
  const smoothedValues: number[] = [];
  if (showTrendSmoothing) {
    for (let i = 0; i < yValues.length; i++) {
      const start = Math.max(0, i - Math.floor(smoothingWindow / 2));
      const end = Math.min(yValues.length, start + smoothingWindow);
      const window = yValues.slice(start, end);
      smoothedValues.push(mean(window));
    }
  }

  const breachColor = 'var(--pro-danger, #D32F2F)';
  const normalColor = 'var(--pro-accent, #1976D2)';
  const uclColor = '#D32F2F';
  const lclColor = '#F9A825';
  const meanColor = '#2E7D32';

  // Breach detection
  const breachIndices = new Set<number>();
  yValues.forEach((v, i) => {
    if (v > ucl) breachIndices.add(i);
  });

  // Build scatter data for breach markers
  const breachData: any[] = [];
  if (fd.highlight_breaches !== false) {
    yValues.forEach((v, i) => {
      if (breachIndices.has(i)) {
        breachData.push([i, v]);
      }
    });
  }

  const series: any[] = [
    {
      name: metricLabel || 'Observed',
      type: 'line',
      data: yValues,
      smooth: false,
      lineStyle: { width: fd.line_width ?? 2, color: normalColor },
      itemStyle: { color: normalColor },
      symbolSize: fd.point_size ?? 4,
      z: 3,
    },
  ];

  if (fd.highlight_breaches !== false && breachData.length > 0) {
    series.push({
      name: 'Breach',
      type: 'scatter',
      data: breachData,
      symbolSize: (fd.point_size ?? 4) * 2.5,
      itemStyle: { color: breachColor },
      z: 4,
    });
  }

  if (fd.show_mean_line !== false) {
    series.push({
      name: 'Mean',
      type: 'line',
      data: new Array(xValues.length).fill(meanVal),
      lineStyle: { width: 1.5, type: 'dashed', color: meanColor },
      itemStyle: { color: meanColor },
      symbol: 'none',
      z: 1,
    });
  }

  if (fd.show_ucl !== false) {
    series.push({
      name: 'UCL',
      type: 'line',
      data: new Array(xValues.length).fill(ucl),
      lineStyle: { width: 1.5, type: 'dotted', color: uclColor },
      itemStyle: { color: uclColor },
      symbol: 'none',
      z: 1,
      ...(fd.shade_alert_zone !== false
        ? {
            areaStyle: {
              color: 'rgba(211, 47, 47, 0.06)',
              origin: 'start',
            },
            markArea: {
              silent: true,
              data: [
                [
                  { yAxis: ucl, itemStyle: { color: 'rgba(211, 47, 47, 0.06)' } },
                  { yAxis: Math.max(...yValues, ucl) * 1.2 },
                ],
              ],
            },
          }
        : {}),
    });
  }

  if (fd.show_lcl) {
    series.push({
      name: 'LCL',
      type: 'line',
      data: new Array(xValues.length).fill(lcl),
      lineStyle: { width: 1, type: 'dotted', color: lclColor },
      itemStyle: { color: lclColor },
      symbol: 'none',
      z: 1,
    });
  }

  if (showTrendSmoothing && smoothedValues.length > 0) {
    series.push({
      name: 'Smoothed Trend',
      type: 'line',
      data: smoothedValues,
      smooth: true,
      lineStyle: { width: 2, type: 'solid', color: '#7C4DFF' },
      itemStyle: { color: '#7C4DFF' },
      symbol: 'none',
      z: 2,
    });
  }

  const echartOptions = {
    grid: {
      top: fd.show_legend !== false ? 40 : 16,
      right: 16,
      bottom: 40,
      left: 56,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'var(--pro-bg-card, #fff)',
      borderColor: 'var(--pro-border, #E5EAF0)',
      textStyle: {
        fontFamily: 'var(--pro-font-family, Inter, sans-serif)',
        fontSize: 12,
      },
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex;
        const observed = yValues[idx];
        const isBreach = breachIndices.has(idx);
        let html = `<strong>${xValues[idx]}</strong><br/>`;
        html += `Observed: <strong>${yFmt(observed)}</strong>`;
        if (isBreach) html += ` <span style="color:${uclColor}">⚠ BREACH</span>`;
        html += `<br/>Mean: ${yFmt(meanVal)} | UCL: ${yFmt(ucl)}`;
        return html;
      },
    },
    legend: {
      show: fd.show_legend !== false,
      top: 4,
      textStyle: {
        fontFamily: 'var(--pro-font-family, Inter, sans-serif)',
        fontSize: 11,
        color: 'var(--pro-text-secondary, #6B7280)',
      },
    },
    xAxis: {
      type: 'category',
      data: xValues,
      axisLabel: {
        fontSize: 10,
        color: 'var(--pro-text-muted, #9CA3AF)',
        rotate: xValues.length > 20 ? 45 : 0,
      },
      axisLine: { lineStyle: { color: 'var(--pro-border, #E5EAF0)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        fontSize: 10,
        color: 'var(--pro-text-muted, #9CA3AF)',
        formatter: (v: number) => yFmt(v),
      },
      splitLine: {
        lineStyle: { color: 'var(--pro-border, #E5EAF0)', type: 'dashed' },
      },
      axisLine: { show: false },
    },
    series,
  };

  return {
    width,
    height,
    echartOptions,
    timeGrain: fd.time_grain || 'week',
    showTrendSmoothing,
    smoothingWindow,
    manualUcl,
    manualLcl,
    nullValueText: fd.null_value_text || '–',
  };
}
