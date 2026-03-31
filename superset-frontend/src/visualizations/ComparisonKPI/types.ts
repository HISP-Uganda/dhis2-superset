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

export type ComparisonType = 'target' | 'previous' | 'benchmark';
export type TrendLogic = 'higher-is-better' | 'lower-is-better';
export type LayoutVariant = 'standard' | 'compact' | 'wide';

export interface ComparisonKPIFormData extends QueryFormData {
  metric: any;
  comparison_metric: any;
  comparison_type: ComparisonType;
  trend_logic: TrendLogic;
  layout_variant: LayoutVariant;
  primary_label: string;
  comparison_label: string;
  primary_value_format: string;
  comparison_value_format: string;
  delta_format: string;
  show_absolute_delta: boolean;
  show_percentage_delta: boolean;
  show_gauge: boolean;
  gauge_max: string;
  title: string;
  subtitle: string;
  title_font_size: number;
  value_font_size: number;
  delta_font_size: number;
  card_padding: number;
  border_radius: number;
  show_comparison_value: boolean;
  show_sparkline?: boolean;
  density_tier?: 'micro' | 'compact' | 'standard';
  null_value_text?: string;
  value_prefix?: string;
  value_suffix?: string;
  show_threshold_band?: boolean;
  threshold_warning?: string;
  threshold_critical?: string;
  color_mode?: 'semantic' | 'fixed' | 'theme';
}

export interface ComparisonKPIChartProps {
  width: number;
  height: number;
  currentValue: number;
  formattedCurrentValue: string;
  comparisonValue: number | null;
  formattedComparisonValue: string | null;
  absoluteDelta: number | null;
  formattedAbsoluteDelta: string | null;
  percentageDelta: number | null;
  formattedPercentageDelta: string | null;
  trendDirection: 'up' | 'down' | 'flat';
  semanticState: 'positive' | 'negative' | 'neutral';
  comparisonType: ComparisonType;
  trendLogic: TrendLogic;
  layoutVariant: LayoutVariant;
  primaryLabel: string;
  comparisonLabel: string;
  showAbsoluteDelta: boolean;
  showPercentageDelta: boolean;
  showGauge: boolean;
  gaugePercent: number | null;
  title: string;
  subtitle: string;
  titleFontSize: number;
  valueFontSize: number;
  deltaFontSize: number;
  cardPadding: number;
  borderRadius: number;
  showComparisonValue: boolean;
  showSparkline: boolean;
  densityTier: string;
  nullValueText: string;
  valuePrefix: string;
  valueSuffix: string;
  showThresholdBand: boolean;
  thresholdWarning: number | null;
  thresholdCritical: number | null;
  colorMode: string;
}
