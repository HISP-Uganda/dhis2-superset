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

export type SortOrder = 'worst-first' | 'best-first' | 'alphabetical';

export interface RankedVarianceFormData extends QueryFormData {
  entity_column: string;
  actual_metric: any;
  target_metric: any;
  sort_order: SortOrder;
  variance_thresholds: string;
  bar_height: number;
  show_values: boolean;
  show_entity_labels: boolean;
  y_axis_format: string;
  max_entities: number;
  chartType?: 'bar' | 'dot' | 'lollipop' | 'diverging';
  comparisonBasis?: 'target' | 'prior-period' | 'benchmark';
  varianceMode?: 'absolute' | 'relative';
  showCenterline?: boolean;
  showBenchmarkBand?: boolean;
  benchmarkLower?: number;
  benchmarkUpper?: number;
  entityGrouping?: string;
  nullValueText?: string;
  showLegend?: boolean;
}

export interface RankedVarianceChartProps {
  width: number;
  height: number;
  echartOptions: Record<string, any>;
  chartType: string;
  comparisonBasis: string;
  varianceMode: string;
  showCenterline: boolean;
  showBenchmarkBand: boolean;
  benchmarkLower: number | null;
  benchmarkUpper: number | null;
  showLegend: boolean;
}
