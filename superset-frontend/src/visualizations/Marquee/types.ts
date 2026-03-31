/*
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

export type MarqueePlacement = 'top' | 'bottom' | 'left' | 'right' | 'custom_section';
export type MarqueeOrientation = 'auto' | 'horizontal' | 'vertical';
export type MarqueeDirection = 'forward' | 'reverse';
export type MarqueeVariant = 'default' | 'glass' | 'dark';

export interface ColorThreshold {
  value: number;
  color: string;
}

export interface MarqueeKpiItem {
  id: string;
  label: string;
  value: string | number | null;
  formattedValue: string;
  deltaValue?: number | null;
  formattedDelta?: string;
  deltaPositive?: boolean;
  subtitle?: string;
  prefix?: string;
  suffix?: string;
  unit?: string;
  statusColor?: string;
}

export interface MarqueeFormData {
  // Data
  metrics: any[];
  adhoc_filters?: any[];
  groupby?: string[];
  label_columns?: string[];
  subtitle_column?: string | null;
  delta_column?: string | null;
  // Placement
  placement: MarqueePlacement;
  orientation: MarqueeOrientation;
  custom_section_id?: string;
  // Animation
  speed: number;
  pause_on_hover: boolean;
  auto_loop: boolean;
  scroll_direction: MarqueeDirection;
  // Layout
  item_spacing: number;
  item_padding: number;
  item_min_width: number;
  item_max_width: number;
  container_height: number;
  gap_between_items: number;
  // Typography - Title/Label
  label_font_size: number;
  label_font_weight: string;
  label_color: string;
  // Typography - Value
  value_font_size: number;
  value_font_weight: string;
  value_color: string;
  // Typography - Subtitle
  subtitle_font_size: number;
  subtitle_color: string;
  // Colors
  container_background: string;
  item_background: string;
  item_border_color: string;
  item_border_width: number;
  item_border_radius: number;
  show_shadow: boolean;
  hover_background: string;
  delta_positive_color: string;
  delta_negative_color: string;
  divider_color: string;
  // Formatting
  number_format: string;
  prefix: string;
  suffix: string;
  null_text: string;
  // Visibility
  show_label: boolean;
  show_subtitle: boolean;
  show_delta: boolean;
  show_separators: boolean;
  responsive_wrap: boolean;
  // Pro Theme
  variant: MarqueeVariant;
  // Conditional coloring — semicolon-separated threshold entries: "value:color;..."
  color_thresholds: string;
}

export interface MarqueeChartProps {
  height: number;
  width: number;
  items: MarqueeKpiItem[];
  placement: MarqueePlacement;
  orientation: MarqueeOrientation;
  // Animation
  speed: number;
  pauseOnHover: boolean;
  autoLoop: boolean;
  scrollDirection: MarqueeDirection;
  // Layout
  itemSpacing: number;
  itemPadding: number;
  itemMinWidth: number;
  itemMaxWidth: number;
  containerHeight: number;
  gapBetweenItems: number;
  // Typography
  labelFontSize: number;
  labelFontWeight: string;
  labelColor: string;
  valueFontSize: number;
  valueFontWeight: string;
  valueColor: string;
  subtitleFontSize: number;
  subtitleColor: string;
  // Colors
  containerBackground: string;
  itemBackground: string;
  itemBorderColor: string;
  itemBorderWidth: number;
  itemBorderRadius: number;
  showShadow: boolean;
  hoverBackground: string;
  deltaPositiveColor: string;
  deltaNegativeColor: string;
  dividerColor: string;
  // Visibility
  showLabel: boolean;
  showSubtitle: boolean;
  showDelta: boolean;
  showSeparators: boolean;
  // Pro Theme
  variant: MarqueeVariant;
  // Conditional coloring thresholds
  colorThresholds: ColorThreshold[];
}
