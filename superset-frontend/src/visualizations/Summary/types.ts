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
import { ChartProps, QueryFormData } from '@superset-ui/core';

/* ── Enums ────────────────────────────────────────── */

export type Layout =
  | 'grid'
  | 'horizontal'
  | 'vertical'
  | 'split'
  | 'micro-card'
  | 'compact-kpi';

export type ValuePosition =
  | 'above'
  | 'below'
  | 'left'
  | 'right'
  | 'inline';

export type DensityTier = 'micro' | 'compact' | 'standard' | 'comfortable';

export type CardStyle = 'elevated' | 'flat' | 'transparent';

export type MicroVisualType =
  | 'none'
  | 'sparkline'
  | 'mini-bar'
  | 'progress-bar'
  | 'bullet';

export type TrendDisplay = 'arrow' | 'value' | 'both' | 'badge';

export type TrendLogic = 'higher-is-better' | 'lower-is-better';

export type ValueColorMode = 'threshold' | 'metric' | 'fixed' | 'scheme';

export type Alignment = 'start' | 'center' | 'end' | 'stretch';

export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'none';

export type ImagePlacement = 'before' | 'after' | 'above' | 'below';

/* ── Per-variable configuration (from VariableConfigControl) ── */

export interface VariableConfig {
  label?: string;
  subtitle?: string;
  numberFormat?: string;
  prefix?: string;
  suffix?: string;
  nullText?: string;
  cardColor?: string;
  labelColor?: string;
  borderColor?: string;
  imageUrl?: string;
}

export type VariableConfigMap = Record<string, VariableConfig>;

/* ── RGBColor (from ColorPickerControl) ──────────── */

export interface RGBColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/* ── Form data from control panel ──────────────────── */

export interface SummaryChartFormData extends QueryFormData {
  metrics: any[];
  groupby?: string[];

  /* Per-variable config */
  variableConfig?: VariableConfigMap;

  /* Layout */
  layoutMode?: Layout;
  gridColumns?: number | 'auto';
  densityTier?: DensityTier;
  valuePosition?: ValuePosition;
  cardStyle?: CardStyle;

  /* Trend & comparison */
  showTrendIndicator?: boolean;
  invertSemanticColors?: boolean;
  trendDisplay?: TrendDisplay;
  trendLogic?: TrendLogic;

  /* Thresholds */
  thresholdUpper?: number;
  thresholdLower?: number;

  /* Micro visualizations */
  microVisualType?: MicroVisualType;
  progressMax?: number;

  /* Global formatting defaults */
  globalNumberFormat?: string;
  trendValueFormat?: string;
  nullValueText?: string;

  /* Images */
  imagePlacement?: ImagePlacement;
  imageSize?: number;

  /* Typography */
  labelFontSize?: string;
  valueFontSize?: string;
  fontFamily?: string;
  labelFontWeight?: string;
  valueFontWeight?: string;
  labelTextTransform?: string;
  labelColor?: RGBColor | null;

  /* Value coloring */
  valueColorMode?: ValueColorMode;
  fixedValueColor?: RGBColor | null;

  /* Alignment */
  alignment?: Alignment;

  /* Visibility */
  showLabels?: boolean;
  showMicroViz?: boolean;
  showDividers?: boolean;

  /* Spacing & appearance */
  itemPadding?: number;
  itemGap?: number;
  itemBorderRadius?: number;

  /* Border styling */
  borderWidth?: number;
  borderColor?: RGBColor | null;
  borderStyle?: BorderStyle;

  /* Color */
  colorScheme?: string;

  /* Pagination (when groupby active) */
  groupsPerPage?: number;
}

/* ── Chart props (extends core ChartProps) ─────────── */

export interface SummaryPluginChartProps extends ChartProps {
  formData: SummaryChartFormData;
  queriesData: any[];
}

/* ── Per-metric item produced by transformProps ─────── */

export interface SummaryItem {
  key: string;
  label: string;
  subtitle?: string;
  rawValue: number | null;
  formattedValue: string;
  trendValue?: number;
  formattedTrendValue?: string;
  trendDirection: 'up' | 'down' | 'flat';
  sparklineData?: number[];
  progressPercent?: number;
  statusColor: string | null;
  accentColor: string;
  cardColor?: string;
  labelColor?: string;
  borderColor?: string;
  imageUrl?: string;
}

/* ── Group of items for a single group-by value ────── */

export interface SummaryGroup {
  groupKey: string;
  groupLabel: string;
  items: SummaryItem[];
}

/* ── Props passed to the React rendering component ─── */

export interface SummaryTransformedProps {
  width: number;
  height: number;
  items: SummaryItem[];

  /* Grouped data (present when groupby is active) */
  groups?: SummaryGroup[];
  groupsPerPage?: number;

  /* Layout */
  layoutMode: Layout;
  gridColumns: number | 'auto';
  densityTier: DensityTier;
  valuePosition: ValuePosition;
  cardStyle: CardStyle;

  /* Typography */
  labelFontSize: string;
  valueFontSize: string;
  fontFamily: string;
  labelFontWeight: string;
  valueFontWeight: string;
  labelTextTransform: string;
  labelColor: string;

  /* Value coloring */
  valueColorMode: ValueColorMode;
  fixedValueColor: string;

  /* Alignment */
  alignment: Alignment;

  /* Visibility */
  showLabels: boolean;
  showTrendIndicator: boolean;
  showMicroViz: boolean;
  showDividers: boolean;

  /* Trend */
  invertSemanticColors: boolean;
  trendDisplay: TrendDisplay;
  trendLogic: TrendLogic;

  /* Micro viz */
  microVisualType: MicroVisualType;

  /* Formatting */
  nullValueText: string;

  /* Thresholds */
  thresholdUpper: number | null;
  thresholdLower: number | null;

  /* Images */
  imagePlacement: ImagePlacement;
  imageSize: number;

  /* Spacing */
  itemPadding: number;
  itemGap: number;
  itemBorderRadius: number;

  /* Border */
  borderWidth: number;
  borderColor: string;
  borderStyle: BorderStyle;
}
