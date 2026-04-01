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
import {
  getMetricLabel,
  CategoricalColorNamespace,
} from '@superset-ui/core';
import {
  SmallMultiplesFormData,
  SmallMultiplesChartProps,
  PanelData,
  PanelSeries,
  ReferenceLineMode,
} from './types';
import { resolvePresetColumn } from './dhis2Presets';

const DEFAULT_COLORS = [
  '#1976D2', '#E53935', '#43A047', '#FB8C00', '#8E24AA',
  '#00ACC1', '#D81B60', '#3949AB', '#00897B', '#F4511E',
];

export default function transformProps(chartProps: any): SmallMultiplesChartProps {
  const { width, height, formData, queriesData, datasource } = chartProps;
  const fd = formData as SmallMultiplesFormData;
  const data: Record<string, any>[] = queriesData?.[0]?.data || [];

  // Resolve split column — DHIS2 preset takes priority over manual groupby
  const dataColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const dsColumns = datasource?.columns || [];
  let groupCol: string;

  const presetCol = resolvePresetColumn(
    fd.dhis2_split_preset,
    dsColumns,
    dataColumns,
  );
  if (presetCol) {
    groupCol = presetCol;
  } else {
    groupCol = Array.isArray(fd.groupby) ? fd.groupby[0] : fd.groupby;
  }

  const xCol = Array.isArray(fd.x_axis) ? fd.x_axis[0] : fd.x_axis;

  // Resolve metric labels
  const rawMetrics = Array.isArray(fd.metrics) ? fd.metrics : [fd.metrics];
  const metricLabels = rawMetrics
    .filter(Boolean)
    .map((m: any) => getMetricLabel(m));

  // Resolve colors from scheme or defaults
  const colorScheme = fd.color_scheme || 'supersetColors';
  let metricColors: string[];
  try {
    const ns = CategoricalColorNamespace.getScale(colorScheme);
    metricColors = metricLabels.map((label: string) => ns(label));
  } catch {
    metricColors = metricLabels.map(
      (_: string, i: number) => DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    );
  }

  // Group data by split dimension → panels
  const groups = new Map<
    string,
    { xValues: string[]; seriesMap: Map<string, number[]> }
  >();

  for (const row of data) {
    const groupKey = String(row[groupCol] ?? 'All');
    const xVal = String(row[xCol] ?? '');

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        xValues: [],
        seriesMap: new Map(metricLabels.map((ml: string) => [ml, []])),
      });
    }

    const group = groups.get(groupKey)!;
    group.xValues.push(xVal);

    for (const ml of metricLabels) {
      const val = (row[ml] as number) ?? 0;
      group.seriesMap.get(ml)!.push(val);
    }
  }

  // Build panel data
  let panels: PanelData[] = [];
  let globalYMin = Infinity;
  let globalYMax = -Infinity;

  const refMode = (fd.reference_line_mode || 'none') as ReferenceLineMode;
  const globalRefVal =
    fd.reference_value !== '' && fd.reference_value != null
      ? Number(fd.reference_value)
      : null;

  for (const [title, group] of groups) {
    const series: PanelSeries[] = metricLabels.map(
      (ml: string, idx: number) => {
        const values = group.seriesMap.get(ml) || [];
        return {
          metricLabel: ml,
          values,
          color: metricColors[idx],
        };
      },
    );

    // Track global min/max across all series
    for (const s of series) {
      for (const v of s.values) {
        if (v < globalYMin) globalYMin = v;
        if (v > globalYMax) globalYMax = v;
      }
    }

    // Latest values for subtitle
    const latestValues: Record<string, number | null> = {};
    for (const s of series) {
      const vals = s.values.filter(v => v != null && Number.isFinite(v));
      latestValues[s.metricLabel] = vals.length > 0 ? vals[vals.length - 1] : null;
    }

    // Per-panel reference value
    let referenceValue: number | null = null;
    if (refMode === 'global' || refMode === 'per-panel-target') {
      referenceValue = globalRefVal;
    } else if (refMode === 'per-panel-mean' && series.length > 0) {
      const primary = series[0].values.filter(v => Number.isFinite(v));
      referenceValue =
        primary.length > 0
          ? primary.reduce((a, b) => a + b, 0) / primary.length
          : null;
    }

    panels.push({
      title,
      xValues: group.xValues,
      yValues: series[0]?.values || [],
      series,
      latestValues,
      referenceValue,
    });
  }

  if (!Number.isFinite(globalYMin)) globalYMin = 0;
  if (!Number.isFinite(globalYMax)) globalYMax = 100;

  // Sort panels
  const sortPanels = (fd.sort_panels || 'alphabetical') as string;
  if (sortPanels === 'alphabetical') {
    panels.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortPanels === 'latest-value') {
    panels.sort(
      (a, b) =>
        (b.yValues[b.yValues.length - 1] ?? 0) -
        (a.yValues[a.yValues.length - 1] ?? 0),
    );
  } else if (sortPanels === 'highest-first') {
    panels.sort(
      (a, b) => Math.max(...b.yValues, 0) - Math.max(...a.yValues, 0),
    );
  } else if (sortPanels === 'lowest-first') {
    panels.sort(
      (a, b) => Math.min(...a.yValues, Infinity) - Math.min(...b.yValues, Infinity),
    );
  }

  // Top N filtering
  const topN = fd.top_n ?? 0;
  if (topN > 0) {
    panels = panels.slice(0, topN);
  }

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
    showReferenceLine: refMode !== 'none',
    referenceValue: globalRefVal,
    referenceLineMode: refMode,
    referenceColor: fd.reference_color || '#E53935',
    showPanelSubtitle: fd.show_panel_subtitle ?? false,
    densityTier: (fd.density_tier || 'compact') as string,
    panelBorderRadius: fd.panel_border_radius ?? 8,
    nullValueText: fd.null_value_text || '–',
    showLegend: fd.show_legend ?? metricLabels.length > 1,
    legendPosition: fd.legend_position || 'top',
    syncTooltips: fd.sync_tooltips ?? true,
    responsiveColumns: fd.responsive_columns ?? true,
    minPanelWidth: fd.min_panel_width ?? 180,
    metricLabels,
    metricColors,
  };
}
