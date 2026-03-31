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

export type ThresholdMethod = 'mean_2sd' | 'mean_3sd' | 'q3' | 'csum';

export interface ControlChartFormData extends QueryFormData {
  x_axis: string;
  metrics: any[];
  threshold_method: ThresholdMethod;
  baseline_periods: number;
  show_mean_line: boolean;
  show_ucl: boolean;
  show_lcl: boolean;
  highlight_breaches: boolean;
  shade_alert_zone: boolean;
  line_width: number;
  point_size: number;
  ucl_color: string;
  lcl_color: string;
  mean_color: string;
  alert_color: string;
  y_axis_format: string;
  show_legend: boolean;
  csum_weight: number;
  time_grain?: 'day' | 'week' | 'month' | 'epi-week';
  show_trend_smoothing?: boolean;
  smoothing_window?: number;
  manual_ucl?: string;
  manual_lcl?: string;
  show_annotations?: boolean;
  annotation_text?: string;
  null_value_text?: string;
}

export interface ControlChartDataPoint {
  x: string;
  value: number;
  isBreach: boolean;
}

export interface ControlChartChartProps {
  width: number;
  height: number;
  echartOptions: Record<string, any>;
  timeGrain: string;
  showTrendSmoothing: boolean;
  smoothingWindow: number;
  manualUcl: number | null;
  manualLcl: number | null;
  nullValueText: string;
}
