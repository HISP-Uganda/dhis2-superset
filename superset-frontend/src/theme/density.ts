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

/**
 * Density tier definitions for the Pro Theme.
 *
 * Each tier provides CSS variable values consumed by AppGlobalStyles,
 * DashboardWrapper, chart containers, and utility classes.
 */

export type DensityTier = 'micro' | 'compact' | 'standard' | 'map-focused';

export interface DensityConfig {
  /** Internal card padding (px) */
  cardPadding: number;
  /** Table row height (px) */
  rowHeight: number;
  /** Chart header vertical padding (px) */
  headerPaddingV: number;
  /** Chart header horizontal padding (px) */
  headerPaddingH: number;
  /** Chart title font size (px) */
  chartTitleSize: number;
  /** Grid gutter between cards (px) */
  gutter: number;
  /** Input/button height (px) */
  controlHeight: number;
  /** Body font size (px) */
  bodyFontSize: number;
  /** KPI value font size (px) */
  kpiValueSize: number;
  /** KPI label font size (px) */
  kpiLabelSize: number;
}

export const DENSITY_TIERS: Record<DensityTier, DensityConfig> = {
  micro: {
    cardPadding: 8,
    rowHeight: 28,
    headerPaddingV: 4,
    headerPaddingH: 8,
    chartTitleSize: 12,
    gutter: 4,
    controlHeight: 28,
    bodyFontSize: 13,
    kpiValueSize: 22,
    kpiLabelSize: 10,
  },
  compact: {
    cardPadding: 12,
    rowHeight: 32,
    headerPaddingV: 8,
    headerPaddingH: 12,
    chartTitleSize: 13,
    gutter: 8,
    controlHeight: 32,
    bodyFontSize: 14,
    kpiValueSize: 26,
    kpiLabelSize: 11,
  },
  standard: {
    cardPadding: 16,
    rowHeight: 40,
    headerPaddingV: 12,
    headerPaddingH: 16,
    chartTitleSize: 14,
    gutter: 12,
    controlHeight: 36,
    bodyFontSize: 14,
    kpiValueSize: 28,
    kpiLabelSize: 11,
  },
  'map-focused': {
    cardPadding: 4,
    rowHeight: 32,
    headerPaddingV: 4,
    headerPaddingH: 8,
    chartTitleSize: 12,
    gutter: 4,
    controlHeight: 28,
    bodyFontSize: 13,
    kpiValueSize: 22,
    kpiLabelSize: 10,
  },
};

export const DEFAULT_DENSITY: DensityTier = 'compact';
export const PUBLIC_DENSITY: DensityTier = 'standard';

/**
 * Generate CSS custom property declarations for a density tier.
 */
export function densityCssVars(tier: DensityTier): string {
  const d = DENSITY_TIERS[tier];
  return `
    --pro-density-card-padding: ${d.cardPadding}px;
    --pro-density-row-height: ${d.rowHeight}px;
    --pro-density-header-v: ${d.headerPaddingV}px;
    --pro-density-header-h: ${d.headerPaddingH}px;
    --pro-density-chart-title: ${d.chartTitleSize}px;
    --pro-density-gutter: ${d.gutter}px;
    --pro-density-control-height: ${d.controlHeight}px;
    --pro-density-body-font: ${d.bodyFontSize}px;
    --pro-density-kpi-value: ${d.kpiValueSize}px;
    --pro-density-kpi-label: ${d.kpiLabelSize}px;
  `;
}
