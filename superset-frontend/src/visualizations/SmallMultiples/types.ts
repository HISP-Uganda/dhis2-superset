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
  | 'gauge';

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

export type DHIS2SplitPreset =
  | 'custom'
  | 'by_national'
  | 'by_region'
  | 'by_district'
  | 'by_subcounty'
  | 'by_facility'
  | 'by_period_monthly'
  | 'by_period_quarterly'
  | 'by_period_yearly';

export interface SmallMultiplesFormData extends QueryFormData {
  groupby: string[];
  x_axis: string;
  metrics: any[];
  grid_columns: number;
  mini_chart_type: MiniChartType;
  sync_y_axis: boolean;
  show_panel_title: boolean;
  show_x_axis: boolean;
  show_y_axis: boolean;
  panel_padding: number;
  line_width: number;
  y_axis_format: string;
  sort_panels?: SortMode;
  top_n?: number;
  show_reference_line?: boolean;
  reference_value?: number | string;
  reference_line_mode?: ReferenceLineMode;
  reference_color?: string;
  show_panel_subtitle?: boolean;
  density_tier?: 'micro' | 'compact' | 'standard';
  panel_border_radius?: number;
  null_value_text?: string;
  color_scheme?: string;
  show_legend?: boolean;
  legend_position?: 'top' | 'bottom';
  sync_tooltips?: boolean;
  responsive_columns?: boolean;
  min_panel_width?: number;
  dhis2_split_preset?: DHIS2SplitPreset;
}

export interface PanelSeries {
  metricLabel: string;
  values: number[];
  color: string;
}

export interface PanelData {
  title: string;
  xValues: string[];
  /** @deprecated Use series for multi-metric. Kept for simple single-metric path. */
  yValues: number[];
  series: PanelSeries[];
  latestValues: Record<string, number | null>;
  referenceValue: number | null;
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
}
