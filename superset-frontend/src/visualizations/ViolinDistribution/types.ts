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

export interface ViolinGroup {
  name: string;
  values: number[];
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
  densityPoints: [number, number][]; // [value, density]
  mean: number;
}

export interface ViolinDistributionFormData extends QueryFormData {
  group_column: string;
  value_column: string;
  show_jitter: boolean;
  show_median: boolean;
  show_iqr: boolean;
  bandwidth: number;
  density_resolution: number;
  violin_width: number;
  jitter_opacity: number;
  jitter_size: number;
  y_axis_format: string;
  violin_color: string;
  orientation?: 'vertical' | 'horizontal';
  scale_mode?: 'area' | 'count' | 'width';
  show_box_overlay?: boolean;
  color_by_group?: boolean;
  show_legend?: boolean;
  null_value_text?: string;
  show_mean?: boolean;
  show_quartile_labels?: boolean;
}

export interface ViolinDistributionChartProps {
  width: number;
  height: number;
  groups: ViolinGroup[];
  showJitter: boolean;
  showMedian: boolean;
  showIQR: boolean;
  violinWidth: number;
  jitterOpacity: number;
  jitterSize: number;
  yAxisFormat: string;
  orientation: string;
  scaleMode: string;
  showBoxOverlay: boolean;
  colorByGroup: boolean;
  showLegend: boolean;
  showMean: boolean;
  showQuartileLabels: boolean;
}
