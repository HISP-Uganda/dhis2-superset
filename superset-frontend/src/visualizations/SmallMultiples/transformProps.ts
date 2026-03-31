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
import { getMetricLabel } from '@superset-ui/core';
import { SmallMultiplesFormData, SmallMultiplesChartProps, PanelData } from './types';

export default function transformProps(chartProps: any): SmallMultiplesChartProps {
  const { width, height, formData, queriesData } = chartProps;
  const fd = formData as SmallMultiplesFormData;
  const data = queriesData?.[0]?.data || [];

  const groupCol = Array.isArray(fd.groupby) ? fd.groupby[0] : fd.groupby;
  const xCol = Array.isArray(fd.x_axis) ? fd.x_axis[0] : fd.x_axis;
  const metricLabel = fd.metrics?.[0] ? getMetricLabel(fd.metrics[0]) : '';

  // Group data by split dimension
  const groups = new Map<string, { x: string; y: number }[]>();
  for (const row of data) {
    const groupKey = String(row[groupCol] ?? 'All');
    const xVal = String(row[xCol] ?? '');
    const yVal = (row[metricLabel] as number) ?? 0;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push({ x: xVal, y: yVal });
  }

  let panels: PanelData[] = [];
  let globalYMin = Infinity;
  let globalYMax = -Infinity;

  for (const [title, points] of groups) {
    const xValues = points.map(p => p.x);
    const yValues = points.map(p => p.y);
    panels.push({ title, xValues, yValues });
    for (const y of yValues) {
      if (y < globalYMin) globalYMin = y;
      if (y > globalYMax) globalYMax = y;
    }
  }

  if (!Number.isFinite(globalYMin)) globalYMin = 0;
  if (!Number.isFinite(globalYMax)) globalYMax = 100;

  // Sort panels
  const sortPanels = (formData.sort_panels || 'alphabetical') as string;
  if (sortPanels === 'alphabetical') {
    panels.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortPanels === 'latest-value') {
    panels.sort((a, b) => (b.yValues[b.yValues.length - 1] ?? 0) - (a.yValues[a.yValues.length - 1] ?? 0));
  } else if (sortPanels === 'highest-first') {
    panels.sort((a, b) => Math.max(...b.yValues) - Math.max(...a.yValues));
  } else if (sortPanels === 'lowest-first') {
    panels.sort((a, b) => Math.min(...a.yValues) - Math.min(...b.yValues));
  }

  // Top N filtering
  const topN = formData.top_n ?? 0;
  if (topN > 0) {
    panels = panels.slice(0, topN);
  }

  // Reference line
  const showReferenceLine = formData.show_reference_line ?? false;
  const rawRef = formData.reference_value;
  const referenceValue = rawRef !== '' && rawRef != null ? Number(rawRef) : null;

  return {
    width,
    height,
    panels,
    columns: fd.grid_columns ?? 4,
    miniChartType: fd.mini_chart_type || 'line',
    syncYAxis: fd.sync_y_axis ?? true,
    showPanelTitle: fd.show_panel_title ?? true,
    showXAxis: fd.show_x_axis ?? false,
    showYAxis: fd.show_y_axis ?? false,
    panelPadding: fd.panel_padding ?? 8,
    lineWidth: fd.line_width ?? 1.5,
    globalYMin,
    globalYMax,
    yAxisFormat: fd.y_axis_format || 'SMART_NUMBER',
    sortPanels,
    topN,
    showReferenceLine,
    referenceValue: showReferenceLine ? referenceValue : null,
    showPanelSubtitle: formData.show_panel_subtitle ?? false,
    densityTier: (formData.density_tier || 'compact') as string,
    panelBorderRadius: formData.panel_border_radius ?? 8,
  };
}
