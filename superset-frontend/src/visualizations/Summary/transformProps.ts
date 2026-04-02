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
import {
  CategoricalColorNamespace,
  getMetricLabel,
  getNumberFormatter,
} from '@superset-ui/core';
import {
  SummaryChartFormData,
  SummaryGroup,
  SummaryItem,
  SummaryTransformedProps,
  RGBColor,
  VariableConfigMap,
} from './types';

/* ── Density-tier defaults ────────────────────────── */

const DENSITY_DEFAULTS: Record<
  string,
  {
    labelFontSize: string;
    valueFontSize: string;
    padding: number;
    gap: number;
  }
> = {
  micro: {
    labelFontSize: '9px',
    valueFontSize: '14px',
    padding: 4,
    gap: 4,
  },
  compact: {
    labelFontSize: '11px',
    valueFontSize: '22px',
    padding: 8,
    gap: 8,
  },
  standard: {
    labelFontSize: '13px',
    valueFontSize: '30px',
    padding: 16,
    gap: 12,
  },
  comfortable: {
    labelFontSize: '14px',
    valueFontSize: '36px',
    padding: 24,
    gap: 16,
  },
};

/* ── RGBColor → CSS string ───────────────────────── */

function rgbToCss(color: RGBColor | null | undefined): string {
  if (!color) return '';
  const { r, g, b, a } = color;
  if (a !== undefined && a !== 1) {
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  }
  const toHex = (v: number) => {
    const hex = Math.round(v).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/* ── Threshold color resolution ───────────────────── */

function resolveStatusColor(
  value: number | null,
  thresholdUpper: number | null,
  thresholdLower: number | null,
  invertSemanticColors: boolean,
): string | null {
  if (value === null) return null;
  if (thresholdUpper === null && thresholdLower === null) return null;

  const goodColor = invertSemanticColors ? '#D32F2F' : '#2E7D32';
  const badColor = invertSemanticColors ? '#2E7D32' : '#D32F2F';
  const warnColor = '#F9A825';

  if (thresholdUpper !== null && value >= thresholdUpper) return goodColor;
  if (thresholdLower !== null && value <= thresholdLower) return badColor;
  if (thresholdUpper !== null && thresholdLower !== null) return warnColor;

  return null;
}

/* ── Main transform ───────────────────────────────── */

export default function transformProps(
  chartProps: any,
): SummaryTransformedProps {
  const { width, height, formData, queriesData } = chartProps;
  const fd = formData as SummaryChartFormData;
  const data = queriesData?.[0]?.data || [];

  /* Per-variable config map */
  const varConfig: VariableConfigMap = fd.variableConfig || {};

  /* Global formatters (fallback when per-variable not set) */
  const globalFmt = getNumberFormatter(
    fd.globalNumberFormat || 'SMART_NUMBER',
  );
  const trendFmt = getNumberFormatter(fd.trendValueFormat || '+,.1%');
  const colorScale = CategoricalColorNamespace.getScale(fd.colorScheme);

  /* Global options */
  const globalNullText = fd.nullValueText ?? '–';
  const invertSemanticColors = fd.invertSemanticColors ?? false;
  const microVisualType = fd.microVisualType || 'none';
  const progressMax = fd.progressMax
    ? parseFloat(String(fd.progressMax))
    : 0;
  const valueColorMode = fd.valueColorMode || 'threshold';

  const thresholdUpper =
    fd.thresholdUpper !== undefined &&
    fd.thresholdUpper !== null &&
    String(fd.thresholdUpper).trim() !== ''
      ? Number(fd.thresholdUpper)
      : null;
  const thresholdLower =
    fd.thresholdLower !== undefined &&
    fd.thresholdLower !== null &&
    String(fd.thresholdLower).trim() !== ''
      ? Number(fd.thresholdLower)
      : null;

  const metrics = fd.metrics || [];
  const groupbyColumns: string[] = fd.groupby || [];
  const hasGroupby = groupbyColumns.length > 0 && data.length > 0;

  /* ── Helper: build SummaryItem[] for a single data row ─── */
  function buildItems(
    row: Record<string, any>,
    keyPrefix: string,
    allRowsForSparkline?: Record<string, any>[],
  ): SummaryItem[] {
    return metrics.map((metric: any, idx: number) => {
      const metricLabel = getMetricLabel(metric);
      const cfg = varConfig[metricLabel] || {};

      const label = cfg.label || metricLabel;
      const subtitle = cfg.subtitle || undefined;
      const itemFmt = cfg.numberFormat
        ? getNumberFormatter(cfg.numberFormat)
        : globalFmt;
      const itemPrefix = cfg.prefix ?? '';
      const itemSuffix = cfg.suffix ?? '';
      const itemNullText = cfg.nullText || globalNullText;

      const raw = row[metricLabel];
      const rawValue: number | null =
        raw === null || raw === undefined ? null : Number(raw);
      const formattedValue =
        rawValue !== null
          ? `${itemPrefix}${itemFmt(rawValue)}${itemSuffix}`
          : itemNullText;

      /* Trend — not available in grouped mode (single row per group) */
      let trendValue: number | undefined;
      let formattedTrendValue: string | undefined;
      let trendDirection: 'up' | 'down' | 'flat' = 'flat';

      if (!hasGroupby && data.length >= 2 && rawValue !== null) {
        const prevRow = data[data.length - 2];
        const prevVal = Number(prevRow[metricLabel] ?? 0);
        if (prevVal !== 0) {
          trendValue = (rawValue - prevVal) / Math.abs(prevVal);
          formattedTrendValue = trendFmt(trendValue);
          if (trendValue > 0) trendDirection = 'up';
          else if (trendValue < 0) trendDirection = 'down';
        }
      }

      /* Sparkline / mini-bar data */
      const sparkRows = allRowsForSparkline || data;
      const sparklineData: number[] | undefined =
        microVisualType === 'sparkline' || microVisualType === 'mini-bar'
          ? sparkRows.map((r: any) => Number(r[metricLabel] ?? 0))
          : undefined;

      /* Progress / bullet percentage */
      let progressPercent: number | undefined;
      if (
        (microVisualType === 'progress-bar' || microVisualType === 'bullet') &&
        rawValue !== null
      ) {
        const maxVal =
          progressMax > 0
            ? progressMax
            : Math.max(
                ...metrics.map(
                  (m: any) => Number(row[getMetricLabel(m)] ?? 0),
                ),
                1,
              );
        progressPercent = Math.min(100, (rawValue / maxVal) * 100);
      }

      /* Color resolution */
      const accentColor = colorScale(metricLabel);
      let statusColor: string | null = null;
      if (valueColorMode === 'threshold') {
        statusColor = resolveStatusColor(
          rawValue,
          thresholdUpper,
          thresholdLower,
          invertSemanticColors,
        );
      } else if (valueColorMode === 'metric') {
        statusColor = accentColor;
      } else if (valueColorMode === 'fixed') {
        statusColor = rgbToCss(fd.fixedValueColor) || null;
      }

      return {
        key: `${keyPrefix}-${idx}`,
        label,
        subtitle,
        rawValue,
        formattedValue,
        trendValue,
        formattedTrendValue,
        trendDirection,
        sparklineData,
        progressPercent,
        statusColor,
        accentColor,
        cardColor: cfg.cardColor || undefined,
        labelColor: cfg.labelColor || undefined,
        borderColor: cfg.borderColor || undefined,
        imageUrl: cfg.imageUrl || undefined,
      };
    });
  }

  /* ── Build flat items (no groupby or legacy fallback) ── */
  const lastRow = data[data.length - 1] || {};
  const items: SummaryItem[] = hasGroupby ? [] : buildItems(lastRow, 'summary');

  /* ── Build grouped items when groupby is active ──────── */
  let groups: SummaryGroup[] | undefined;
  if (hasGroupby) {
    groups = data.map((row: Record<string, any>, rowIdx: number) => {
      const groupLabel = groupbyColumns
        .map(col => String(row[col] ?? ''))
        .join(' / ');
      const groupKey = `group-${rowIdx}`;
      return {
        groupKey,
        groupLabel,
        items: buildItems(row, groupKey),
      };
    });
  }

  /* Density defaults */
  const densityTier = fd.densityTier || 'compact';
  const defaults = DENSITY_DEFAULTS[densityTier] || DENSITY_DEFAULTS.compact;

  /* Spacing: user override > 0 wins, else density default */
  const itemPadding =
    (fd.itemPadding ?? 0) > 0 ? fd.itemPadding! : defaults.padding;
  const itemGap = (fd.itemGap ?? 0) > 0 ? fd.itemGap! : defaults.gap;

  return {
    width,
    height,
    items,
    groups,
    groupsPerPage: fd.groupsPerPage ?? 6,

    /* Layout */
    layoutMode: fd.layoutMode || 'grid',
    gridColumns: fd.gridColumns ?? 3,
    densityTier,
    valuePosition: fd.valuePosition || 'below',
    cardStyle: fd.cardStyle || 'elevated',

    /* Typography */
    labelFontSize: fd.labelFontSize || defaults.labelFontSize,
    valueFontSize: fd.valueFontSize || defaults.valueFontSize,
    fontFamily: fd.fontFamily || 'Inter',
    labelFontWeight: fd.labelFontWeight || '600',
    valueFontWeight: fd.valueFontWeight || '700',
    labelTextTransform: fd.labelTextTransform || 'uppercase',
    labelColor: rgbToCss(fd.labelColor),

    /* Value coloring */
    valueColorMode: fd.valueColorMode || 'threshold',
    fixedValueColor: rgbToCss(fd.fixedValueColor),

    /* Alignment */
    alignment: fd.alignment || 'start',

    /* Visibility */
    showLabels: fd.showLabels ?? true,
    showTrendIndicator: fd.showTrendIndicator ?? true,
    showMicroViz: fd.showMicroViz ?? true,
    showDividers: fd.showDividers ?? false,

    /* Trend */
    invertSemanticColors,
    trendDisplay: fd.trendDisplay || 'both',
    trendLogic: fd.trendLogic || 'higher-is-better',

    /* Micro viz */
    microVisualType,

    /* Formatting */
    nullValueText: globalNullText,

    /* Thresholds */
    thresholdUpper,
    thresholdLower,

    /* Images */
    imagePlacement: fd.imagePlacement || 'before',
    imageSize: fd.imageSize ?? 32,

    /* Spacing */
    itemPadding,
    itemGap,
    itemBorderRadius: fd.itemBorderRadius ?? 12,

    /* Border */
    borderWidth: fd.borderWidth ?? 1,
    borderColor: rgbToCss(fd.borderColor),
    borderStyle: fd.borderStyle || 'solid',
  };
}
