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
import { QueryFormData } from '@superset-ui/core';

export type MiniChartType =
  | 'line'
  | 'bar'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'heatmap'
  | 'big_number'
  | 'gauge'
  | 'mini_map';

export type SortMode =
  | 'alphabetical'
  | 'latest-value'
  | 'highest-first'
  | 'lowest-first';

export type ReferenceLineMode =
  | 'none'
  | 'global'
  | 'per-panel-mean'
  | 'per-panel-target';

/** Dynamic preset keys: 'custom', 'by_level_N' (OU), 'by_period_*' */
export type DHIS2SplitPreset = string;

export interface SmallMultiplesFormData extends QueryFormData {
  groupby: string[];
  xAxis: string;
  metrics: any[];
  gridColumns: number;
  miniChartType: MiniChartType;
  syncYAxis: boolean;
  showPanelTitle: boolean;
  showXAxis: boolean;
  showYAxis: boolean;
  panelPadding: number;
  lineWidth: number;
  yAxisFormat: string;
  sortPanels?: SortMode;
  topN?: number;
  showReferenceLine?: boolean;
  referenceValue?: number | string;
  referenceLineMode?: ReferenceLineMode;
  referenceColor?: string;
  showPanelSubtitle?: boolean;
  densityTier?: 'micro' | 'compact' | 'standard';
  panelBorderRadius?: number;
  nullValueText?: string;
  colorScheme?: string;
  linearColorScheme?: string;
  showLegend?: boolean;
  legendPosition?: 'top' | 'bottom';
  syncTooltips?: boolean;
  responsiveColumns?: boolean;
  minPanelWidth?: number;
  dhis2SplitPreset?: DHIS2SplitPreset;
  resolvedSplitCol?: string;
  /* Layout — explicit panel height (0 = auto) */
  panelHeight?: number;
  /* Map-specific — "level:columnName" e.g. "3:district_city" */
  boundaryLevel?: string | number;
}

export interface PanelSeries {
  metricLabel: string;
  values: number[];
  color: string;
}

export interface PanelData {
  title: string;
  xValues: string[];
  /** Raw (unformatted) xValues for data matching (e.g. OU name lookup in mini_map) */
  rawXValues?: string[];
  /** @deprecated Use series for multi-metric. Kept for simple single-metric path. */
  yValues: number[];
  series: PanelSeries[];
  latestValues: Record<string, number | null>;
  referenceValue: number | null;
  /** GeoJSON FeatureCollection for mini_map panels */
  geojson?: GeoJSON.FeatureCollection;
}

export interface SmallMultiplesChartProps {
  width: number;
  height: number;
  panels: PanelData[];
  columns: number;
  miniChartType: MiniChartType;
  syncYAxis: boolean;
  showPanelTitle: boolean;
  showXAxis: boolean;
  showYAxis: boolean;
  panelPadding: number;
  lineWidth: number;
  globalYMin: number;
  globalYMax: number;
  yAxisFormat: string;
  sortPanels: string;
  topN: number;
  showReferenceLine: boolean;
  referenceValue: number | null;
  referenceLineMode: ReferenceLineMode;
  referenceColor: string;
  showPanelSubtitle: boolean;
  densityTier: string;
  panelBorderRadius: number;
  nullValueText: string;
  showLegend: boolean;
  legendPosition: 'top' | 'bottom';
  syncTooltips: boolean;
  responsiveColumns: boolean;
  minPanelWidth: number;
  metricLabels: string[];
  metricColors: string[];
  schemeColors: string[];
  linearColors: string[];
  /* Layout — explicit panel height (0 = auto) */
  fixedPanelHeight?: number;
  /* Map-specific */
  databaseId?: number;
  boundaryLevel?: string | number;
  chartId?: number;
  dashboardId?: number;
}
