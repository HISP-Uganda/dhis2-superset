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
import { AgeSexPyramidFormData, AgeSexPyramidChartProps } from './types';

export default function transformProps(chartProps: any): AgeSexPyramidChartProps {
  const { width, height, formData, queriesData } = chartProps;
  const fd = formData as AgeSexPyramidFormData;
  const data = queriesData?.[0]?.data || [];

  const ageCol = Array.isArray(fd.age_column) ? fd.age_column[0] : fd.age_column;
  const sexCol = Array.isArray(fd.sex_column) ? fd.sex_column[0] : fd.sex_column;
  const metricLabel = fd.metric ? getMetricLabel(fd.metric) : '';
  const baselineLabel = fd.baseline_metric ? getMetricLabel(fd.baseline_metric) : '';
  const valueFmt = getNumberFormatter(fd.y_axis_format || 'SMART_NUMBER');

  const maleVal = (fd.male_value || 'Male').trim();
  const femaleVal = (fd.female_value || 'Female').trim();
  const maleColor = (fd.male_color || '#1976D2').trim();
  const femaleColor = (fd.female_color || '#E91E63').trim();
  const displayMode = (formData.display_mode || 'absolute') as string;
  const scaleMode = (formData.scale_mode || 'common') as string;
  const showCenterLabels = formData.show_center_labels ?? true;
  const showLegend = formData.show_legend ?? true;
  const legendPosition = (formData.legend_position || 'top') as string;
  const maleLabel = (formData.male_label || 'Male').trim();
  const femaleLabel = (formData.female_label || 'Female').trim();

  // Collect unique age groups in order
  const ageGroupsSet = new Set<string>();
  for (const row of data) {
    ageGroupsSet.add(String(row[ageCol] ?? ''));
  }
  const ageGroups = Array.from(ageGroupsSet);

  // Build male/female data maps
  const maleData = new Map<string, number>();
  const femaleData = new Map<string, number>();
  const baselineMale = new Map<string, number>();
  const baselineFemale = new Map<string, number>();

  for (const row of data) {
    const age = String(row[ageCol] ?? '');
    const sex = String(row[sexCol] ?? '');
    const value = (row[metricLabel] as number) ?? 0;
    const baseline = baselineLabel ? ((row[baselineLabel] as number) ?? 0) : 0;

    if (sex === maleVal) {
      maleData.set(age, (maleData.get(age) ?? 0) + value);
      if (baselineLabel) baselineMale.set(age, (baselineMale.get(age) ?? 0) + baseline);
    } else if (sex === femaleVal) {
      femaleData.set(age, (femaleData.get(age) ?? 0) + value);
      if (baselineLabel) baselineFemale.set(age, (baselineFemale.get(age) ?? 0) + baseline);
    }
  }

  // Compute raw values
  let maleRaw = ageGroups.map(ag => maleData.get(ag) ?? 0);
  let femaleRaw = ageGroups.map(ag => femaleData.get(ag) ?? 0);

  // Apply display mode conversion
  if (displayMode === 'percent') {
    const total = maleRaw.reduce((s, v) => s + v, 0) + femaleRaw.reduce((s, v) => s + v, 0);
    if (total > 0) {
      maleRaw = maleRaw.map(v => (v / total) * 100);
      femaleRaw = femaleRaw.map(v => (v / total) * 100);
    }
  }

  // Male values are negative for mirrored effect
  const maleValues = maleRaw.map(v => -v);
  const femaleValues = femaleRaw;

  const maxVal = Math.max(
    Math.max(...maleValues.map(Math.abs)),
    Math.max(...femaleValues),
    1,
  );

  const series: any[] = [
    {
      name: maleLabel,
      type: 'bar',
      stack: 'pyramid',
      data: maleValues,
      itemStyle: { color: maleColor, borderRadius: [4, 0, 0, 4] },
      barGap: `${fd.bar_gap ?? 20}%`,
      label: {
        show: fd.show_values,
        position: 'left',
        fontSize: 10,
        formatter: (p: any) => valueFmt(Math.abs(p.value)),
      },
    },
    {
      name: femaleLabel,
      type: 'bar',
      stack: 'pyramid',
      data: femaleValues,
      itemStyle: { color: femaleColor, borderRadius: [0, 4, 4, 0] },
      label: {
        show: fd.show_values,
        position: 'right',
        fontSize: 10,
        formatter: (p: any) => valueFmt(p.value),
      },
    },
  ];

  // Baseline overlay lines
  if (fd.show_baseline_overlay && baselineLabel) {
    series.push(
      {
        name: `${maleVal} Baseline`,
        type: 'line',
        data: ageGroups.map(ag => -(baselineMale.get(ag) ?? 0)),
        lineStyle: { width: 1.5, type: 'dashed', color: maleColor },
        itemStyle: { color: maleColor },
        symbol: 'circle',
        symbolSize: 4,
      },
      {
        name: `${femaleVal} Baseline`,
        type: 'line',
        data: ageGroups.map(ag => baselineFemale.get(ag) ?? 0),
        lineStyle: { width: 1.5, type: 'dashed', color: femaleColor },
        itemStyle: { color: femaleColor },
        symbol: 'circle',
        symbolSize: 4,
      },
    );
  }

  const echartOptions = {
    title: fd.title
      ? {
          text: fd.title,
          left: 'center',
          textStyle: {
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'var(--pro-font-family, Inter, sans-serif)',
            color: 'var(--pro-text-primary, #1A1F2C)',
          },
        }
      : undefined,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'var(--pro-bg-card, #fff)',
      borderColor: 'var(--pro-border, #E5EAF0)',
      textStyle: {
        fontFamily: 'var(--pro-font-family, Inter, sans-serif)',
        fontSize: 12,
      },
      formatter: (params: any) => {
        const age = params[0]?.axisValue;
        let html = `<strong>${age}</strong><br/>`;
        for (const p of params) {
          html += `${p.seriesName}: ${valueFmt(Math.abs(p.value))}<br/>`;
        }
        return html;
      },
    },
    /* legend is set above via showLegend */
    grid: {
      top: fd.title ? 56 : 36,
      right: 32,
      bottom: 24,
      left: 32,
      containLabel: true,
    },
    legend: showLegend
      ? {
          top: legendPosition === 'bottom' ? undefined : (fd.title ? 30 : 4),
          bottom: legendPosition === 'bottom' ? 4 : undefined,
          right: legendPosition === 'right' ? 16 : undefined,
          left: legendPosition === 'right' ? undefined : undefined,
          textStyle: {
            fontSize: 11,
            fontFamily: 'var(--pro-font-family, Inter, sans-serif)',
            color: 'var(--pro-text-secondary, #6B7280)',
          },
        }
      : { show: false },
    xAxis: {
      type: 'value',
      min: scaleMode === 'independent' ? undefined : -maxVal * 1.15,
      max: scaleMode === 'independent' ? undefined : maxVal * 1.15,
      axisLabel: {
        fontSize: 10,
        color: 'var(--pro-text-muted, #9CA3AF)',
        formatter: (v: number) => valueFmt(Math.abs(v)),
      },
      splitLine: {
        lineStyle: { color: 'var(--pro-border, #E5EAF0)', type: 'dashed' },
      },
    },
    yAxis: {
      type: 'category',
      data: ageGroups,
      axisLabel: {
        show: showCenterLabels,
        fontSize: 11,
        color: 'var(--pro-text-secondary, #6B7280)',
        fontWeight: 500,
      },
      axisLine: { lineStyle: { color: 'var(--pro-border, #E5EAF0)' } },
      axisTick: { show: false },
    },
    series,
  };

  return {
    width,
    height,
    echartOptions,
    displayMode,
    scaleMode,
    showCenterLabels,
    showLegend,
    legendPosition,
    maleLabel,
    femaleLabel,
    maleColor,
    femaleColor,
  };
}
