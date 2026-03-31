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

export type CascadeOrientation = 'horizontal' | 'vertical';

export interface CascadeStage {
  label: string;
  value: number;
  formattedValue: string;
  percentRetained: number;
  percentLost: number;
  color: string;
}

export interface CohortCascadeFormData extends QueryFormData {
  metrics: any[];
  orientation: CascadeOrientation;
  show_connectors: boolean;
  show_percent_retained: boolean;
  show_percent_lost: boolean;
  show_values: boolean;
  value_format: string;
  bar_color_start: string;
  bar_color_end: string;
  bar_border_radius: number;
  bar_gap: number;
  label_font_size: number;
  value_font_size: number;
  groupby?: string[];
  percent_mode?: 'cumulative' | 'stage-specific';
  show_dropoff_emphasis?: boolean;
  label_placement?: 'inside' | 'outside' | 'below';
  connector_style?: 'arrow' | 'line' | 'none';
  density_tier?: 'compact' | 'standard' | 'presentation';
  reference_stage?: 'first' | 'previous';
  show_stage_annotations?: boolean;
  null_value_text?: string;
}

export interface CohortCascadeChartProps {
  width: number;
  height: number;
  stages: CascadeStage[];
  orientation: CascadeOrientation;
  showConnectors: boolean;
  showPercentRetained: boolean;
  showPercentLost: boolean;
  showValues: boolean;
  barBorderRadius: number;
  barGap: number;
  labelFontSize: number;
  valueFontSize: number;
  percentMode: string;
  showDropoffEmphasis: boolean;
  labelPlacement: string;
  connectorStyle: string;
  densityTier: string;
  referenceStage: string;
  nullValueText: string;
}
