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
  getCategoricalSchemeRegistry,
  getSequentialSchemeRegistry,
} from '@superset-ui/core';
import {
  SmallMultiplesFormData,
  SmallMultiplesChartProps,
  PanelData,
  PanelSeries,
  ReferenceLineMode,
} from './types';
import { resolvePresetColumn } from './dhis2Presets';
import { formatDhis2Period } from './periodUtils';

const DEFAULT_COLORS = [
  '#1976D2', '#E53935', '#43A047', '#FB8C00', '#8E24AA',
  '#00ACC1', '#D81B60', '#3949AB', '#00897B', '#F4511E',
];

function resolveDatabaseId(datasource: any, formData: any): number | undefined {
  const dsAny = datasource || {};
  const extra = dsAny.extra ? (typeof dsAny.extra === 'string' ? JSON.parse(dsAny.extra) : dsAny.extra) : {};
  return (
    extra.dhis2_source_database_id ||
    extra.dhis2SourceDatabaseId ||
    extra.source_database_id ||
    dsAny.database?.id ||
    dsAny.database_id ||
    formData?.dhis2SourceDatabaseId ||
    formData?.dhis2_source_database_id ||
    formData?.database_id ||
    undefined
  );
}

export default function transformProps(chartProps: any): SmallMultiplesChartProps {
  const { width, height, formData, queriesData, datasource } = chartProps;
  const fd = formData as SmallMultiplesFormData;
  const data: Record<string, any>[] = queriesData?.[0]?.data || [];

  // Resolve split column — DHIS2 preset takes priority over manual groupby
  const dataColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const dsColumns = datasource?.columns || [];
  let groupCol: string;

  // Hidden control _resolved_split_col → camelCase resolvedSplitCol
  const presetCol = fd.resolvedSplitCol || resolvePresetColumn(
    fd.dhis2SplitPreset,
    dsColumns,
    dataColumns,
  );
  if (presetCol) {
    groupCol = presetCol;
  } else {
    groupCol = Array.isArray(fd.groupby) ? fd.groupby[0] : fd.groupby;
  }

  const isMiniMap = (fd.miniChartType || 'line') === 'mini_map';
  let xCol = Array.isArray(fd.xAxis) ? fd.xAxis[0] : fd.xAxis;

  // For mini_map: boundary_level value is "level:columnName" (e.g. "3:district_city").
  // camelCase conversion: boundary_level → boundaryLevel
  // Extract the column name and use it as xCol (replaces manual x_axis).
  if (isMiniMap) {
    const blValue = String(fd.boundaryLevel || '');
    const colonIdx = blValue.indexOf(':');
    if (colonIdx >= 0) {
      const ouCol = blValue.slice(colonIdx + 1);
      if (ouCol && dataColumns.includes(ouCol)) {
        xCol = ouCol;
      }
    }
  }

  // Resolve metric labels
  const rawMetrics = Array.isArray(fd.metrics) ? fd.metrics : [fd.metrics];
  const metricLabels = rawMetrics
    .filter(Boolean)
    .map((m: any) => getMetricLabel(m));

  // ── Unified color scheme resolution ──
  // Single merged color_scheme control lists both categorical and sequential schemes.
  // Try categorical registry first, then sequential. The resolved palette is used
  // for ALL chart types automatically.
  const schemeKey = fd.colorScheme || 'supersetColors';

  let schemeColors: string[] = DEFAULT_COLORS;
  let linearColors: string[] = [];
  let metricColors: string[];
  let resolved = false;

  // Try categorical registry first
  try {
    const catRegistry = getCategoricalSchemeRegistry();
    const catScheme = catRegistry.get(schemeKey);
    if (catScheme && catScheme.colors.length > 0) {
      schemeColors = catScheme.colors;
      // Derive a linear gradient from categorical colors for heatmap/map
      linearColors = schemeColors.slice(0, Math.min(9, schemeColors.length));
      resolved = true;
    }
  } catch { /* try sequential */ }

  // Try sequential registry if not found in categorical
  if (!resolved) {
    try {
      const seqRegistry = getSequentialSchemeRegistry();
      const seqScheme = seqRegistry.get(schemeKey);
      if (seqScheme) {
        linearColors = seqScheme.getColors(9);
        // For series/pie/donut, sample distinct colors from the gradient
        schemeColors = seqScheme.getColors(
          Math.max(metricLabels.length, 8),
        );
        resolved = true;
      }
    } catch { /* use defaults */ }
  }

  // Fallback linear gradient if still empty
  if (linearColors.length === 0) {
    linearColors = schemeColors.length >= 3
      ? schemeColors.slice(0, Math.min(9, schemeColors.length))
      : ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6',
         '#2171b5', '#08519c', '#08306b', '#041733'];
  }

  metricColors = metricLabels.map(
    (_: string, i: number) => schemeColors[i % schemeColors.length],
  );

  // Group data by split dimension → panels
  const groups = new Map<
    string,
    {
      xValues: string[];
      seriesMap: Map<string, number[]>;
    }
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

  const refMode = (fd.referenceLineMode || 'none') as ReferenceLineMode;
  const globalRefVal =
    fd.referenceValue !== '' && fd.referenceValue != null
      ? Number(fd.referenceValue)
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

    // mini_map GeoJSON is built client-side from DHIS2 boundaries (in SmallMultiplesViz)
    panels.push({
      title: formatDhis2Period(title),
      xValues: group.xValues.map(formatDhis2Period),
      rawXValues: group.xValues,
      yValues: series[0]?.values || [],
      series,
      latestValues,
      referenceValue,
    });
  }

  if (!Number.isFinite(globalYMin)) globalYMin = 0;
  if (!Number.isFinite(globalYMax)) globalYMax = 100;

  // Sort panels
  const sortPanels = (fd.sortPanels || 'alphabetical') as string;
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
  const topN = fd.topN ?? 0;
  if (topN > 0) {
    panels = panels.slice(0, topN);
  }

  return {
    width,
    height,
    panels,
    columns: fd.gridColumns ?? 4,
    miniChartType: fd.miniChartType || 'line',
    syncYAxis: fd.syncYAxis ?? true,
    showPanelTitle: fd.showPanelTitle ?? true,
    showXAxis: fd.showXAxis ?? false,
    showYAxis: fd.showYAxis ?? false,
    panelPadding: fd.panelPadding ?? 8,
    lineWidth: fd.lineWidth ?? 1.5,
    globalYMin,
    globalYMax,
    yAxisFormat: fd.yAxisFormat || 'SMART_NUMBER',
    sortPanels,
    topN,
    showReferenceLine: refMode !== 'none',
    referenceValue: globalRefVal,
    referenceLineMode: refMode,
    referenceColor: fd.referenceColor || '#E53935',
    showPanelSubtitle: fd.showPanelSubtitle ?? false,
    densityTier: (fd.densityTier || 'compact') as string,
    panelBorderRadius: fd.panelBorderRadius ?? 8,
    nullValueText: fd.nullValueText || '–',
    showLegend: fd.showLegend ?? metricLabels.length > 1,
    legendPosition: fd.legendPosition || 'top',
    syncTooltips: fd.syncTooltips ?? true,
    responsiveColumns: fd.responsiveColumns ?? true,
    minPanelWidth: fd.minPanelWidth ?? 180,
    fixedPanelHeight: fd.panelHeight ?? 0,
    metricLabels,
    metricColors,
    schemeColors,
    linearColors,
    databaseId: resolveDatabaseId(datasource, formData),
    boundaryLevel: fd.boundaryLevel || undefined,
    chartId: fd.sliceId ? Number(fd.sliceId) : undefined,
  };
}
