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

export interface AgeSexPyramidFormData extends QueryFormData {
  age_column: string;
  sex_column: string;
  metric: any;
  male_value: string;
  female_value: string;
  baseline_metric: any;
  show_baseline_overlay: boolean;
  male_color: string;
  female_color: string;
  bar_gap: number;
  show_values: boolean;
  y_axis_format: string;
  title: string;
  displayMode?: 'absolute' | 'percent' | 'rate';
  scaleMode?: 'common' | 'independent';
  showCenterLabels?: boolean;
  showLegend?: boolean;
  legendPosition?: 'top' | 'bottom' | 'right';
  maleLabel?: string;
  femaleLabel?: string;
  nullValueText?: string;
}

export interface AgeSexPyramidChartProps {
  width: number;
  height: number;
  echartOptions: Record<string, any>;
  displayMode: string;
  scaleMode: string;
  showCenterLabels: boolean;
  showLegend: boolean;
  legendPosition: string;
  maleLabel: string;
  femaleLabel: string;
  maleColor: string;
  femaleColor: string;
}
