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

export type MiniChartType = 'line' | 'bar' | 'area';

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
  sortPanels?: 'alphabetical' | 'latest-value' | 'highest-first' | 'lowest-first';
  topN?: number;
  showReferenceLine?: boolean;
  referenceValue?: number;
  showPanelSubtitle?: boolean;
  densityTier?: 'micro' | 'compact' | 'standard';
  panelBorderRadius?: number;
  nullValueText?: string;
}

export interface PanelData {
  title: string;
  xValues: string[];
  yValues: number[];
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
  showPanelSubtitle: boolean;
  densityTier: string;
  panelBorderRadius: number;
}
