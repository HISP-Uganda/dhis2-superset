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
import { QueryFormData, QueryFormMetric } from '@superset-ui/core';

export interface ColorThreshold {
  value: number;
  color: string;
}

export type TransitionType =
  | 'fade'
  | 'slide-horizontal'
  | 'slide-vertical'
  | 'none';

export type HeightMode = 'fixed' | 'adaptive';

export interface SlideshowSlide {
  /** Unique key for the slide */
  key: string;
  /** Display label */
  label: string;
  /** Formatted primary value */
  value: string;
  /** Raw numeric value (for aria / formatting) */
  rawValue: number | null;
  /** Optional delta text */
  delta?: string;
  /** Whether delta is positive */
  deltaPositive?: boolean;
  /** Optional subtitle */
  subtitle?: string;
  /** Metric name used to fetch (for ordering) */
  metricName: string;
  /** Status color resolved from thresholds */
  statusColor?: string | null;
}

export type SlideshowFormData = QueryFormData & {
  metrics?: QueryFormMetric[];

  // Playback
  autoPlay?: boolean;
  slideIntervalMs?: number;
  pauseOnHover?: boolean;
  pauseOnFocus?: boolean;
  loop?: boolean;
  startIndex?: number;

  // Transition
  transitionType?: TransitionType;
  transitionDurationMs?: number;

  // Navigation
  showArrows?: boolean;
  showDots?: boolean;
  showCounter?: boolean;
  showProgressBar?: boolean;
  keyboardNavigation?: boolean;

  // Layout
  heightMode?: HeightMode;
  fixedHeight?: number;
  contentPadding?: number;

  // Appearance
  bgColor?: { r: number; g: number; b: number; a: number } | null;
  valueColor?: { r: number; g: number; b: number; a: number } | null;
  labelColor?: { r: number; g: number; b: number; a: number } | null;
  borderRadius?: number;
  showBorder?: boolean;
  showShadow?: boolean;
  dotColor?: { r: number; g: number; b: number; a: number } | null;
  arrowColor?: { r: number; g: number; b: number; a: number } | null;
  progressBarColor?: { r: number; g: number; b: number; a: number } | null;

  // Value formatting
  yAxisFormat?: string;
  prefix?: string;
  suffix?: string;
  nullText?: string;

  // Optional embedded charts (comma-separated IDs)
  embeddedChartIds?: string;

  // Conditional coloring — semicolon-separated threshold entries: "value:color;..."
  colorThresholds?: string;
};

export interface SlideshowChartProps {
  width: number;
  height: number;
  slides: SlideshowSlide[];

  // Playback
  autoPlay: boolean;
  slideIntervalMs: number;
  pauseOnHover: boolean;
  pauseOnFocus: boolean;
  loop: boolean;
  startIndex: number;

  // Transition
  transitionType: TransitionType;
  transitionDurationMs: number;

  // Navigation
  showArrows: boolean;
  showDots: boolean;
  showCounter: boolean;
  showProgressBar: boolean;
  keyboardNavigation: boolean;

  // Layout
  heightMode: HeightMode;
  fixedHeight: number;
  contentPadding: number;

  // Appearance
  bgColor: string | null;
  valueColor: string | null;
  labelColor: string | null;
  borderRadius: number;
  showBorder: boolean;
  showShadow: boolean;
  dotColor: string | null;
  arrowColor: string | null;
  progressBarColor: string | null;

  // Embedded chart IDs
  embeddedChartIds: number[];

  // Conditional coloring thresholds
  colorThresholds: ColorThreshold[];
}
