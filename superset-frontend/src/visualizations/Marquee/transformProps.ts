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

import {
  ChartProps,
  getMetricLabel as getMetricLabelFromCore,
  getNumberFormatter,
  t,
} from '@superset-ui/core';
import { MarqueeChartProps, MarqueeFormData, MarqueeKpiItem } from './types';

function resolveMetricLabel(metric: any, index: number): string {
  if (typeof metric === 'string') return metric;
  if (metric && typeof metric === 'object') {
    return (
      getMetricLabelFromCore(metric) ||
      metric.column?.verbose_name ||
      metric.column?.column_name ||
      metric.metric_name ||
      `${t('Metric')} ${index + 1}`
    );
  }
  return `${t('Metric')} ${index + 1}`;
}

function resolveMetricValue(row: Record<string, any>, metric: any, index: number) {
  const candidateKeys = new Set<string>();

  if (typeof metric === 'string') {
    candidateKeys.add(metric);
  } else if (metric && typeof metric === 'object') {
    [
      getMetricLabelFromCore(metric),
      metric.label,
      metric.metric_name,
      metric.column?.verbose_name,
      metric.column?.column_name,
      metric.column?.columnName,
      metric.sqlExpression,
    ]
      .filter((value: unknown): value is string => Boolean(value))
      .forEach(value => candidateKeys.add(value));
  }

  candidateKeys.add(String(index));

  for (const key of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }

  return undefined;
}

function formatDelta(value: number | null | undefined): { str: string; positive: boolean } {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return { str: '', positive: true };
  }
  const positive = value >= 0;
  const abs = Math.abs(value);
  const str = positive ? `+${abs.toLocaleString()}` : `-${abs.toLocaleString()}`;
  return { str, positive };
}

export default function transformProps(chartProps: ChartProps): MarqueeChartProps {
  const { formData, queriesData, height, width } = chartProps;
  const fd = formData as MarqueeFormData;

  const metrics: any[] = fd.metrics || [];
  const numberFormat = fd.number_format || 'SMART_NUMBER';
  const formatter = getNumberFormatter(numberFormat);
  const prefix = fd.prefix || '';
  const suffix = fd.suffix || '';
  const nullText = fd.null_text || t('N/A');

  // Extract the first (aggregated) row from query results
  const row = queriesData?.[0]?.data?.[0] || {};

  const items: MarqueeKpiItem[] = metrics.map((metric, index) => {
    const label = resolveMetricLabel(metric, index);
    const rawValue = resolveMetricValue(row, metric, index);

    let formattedValue = nullText;
    let numericValue: number | null = null;
    if (rawValue !== null && rawValue !== undefined) {
      numericValue = Number(rawValue);
      if (!Number.isNaN(numericValue)) {
        formattedValue = `${prefix}${formatter(numericValue)}${suffix}`;
      } else {
        formattedValue = String(rawValue);
      }
    }

    const deltaRaw = fd.delta_column ? row[fd.delta_column] : undefined;
    const deltaValue = deltaRaw !== undefined ? Number(deltaRaw) : null;
    const delta = formatDelta(deltaValue);

    return {
      id: `item-${index}`,
      label,
      value: numericValue,
      formattedValue,
      deltaValue: deltaValue,
      formattedDelta: delta.str || undefined,
      deltaPositive: delta.positive,
      subtitle: fd.subtitle_column ? String(row[fd.subtitle_column] ?? '') : undefined,
      prefix,
      suffix,
    };
  });

  return {
    height,
    width,
    items,
    placement: fd.placement || 'top',
    orientation: fd.orientation || 'auto',
    speed: fd.speed ?? 30,
    pauseOnHover: fd.pause_on_hover ?? true,
    autoLoop: fd.auto_loop ?? true,
    scrollDirection: fd.scroll_direction || 'forward',
    itemSpacing: fd.item_spacing ?? 12,
    itemPadding: fd.item_padding ?? 16,
    itemMinWidth: fd.item_min_width ?? 140,
    itemMaxWidth: fd.item_max_width ?? 260,
    containerHeight: fd.container_height ?? 72,
    gapBetweenItems: fd.gap_between_items ?? 32,
    labelFontSize: fd.label_font_size ?? 11,
    labelFontWeight: fd.label_font_weight || '500',
    labelColor: fd.label_color || '#6b7280',
    valueFontSize: fd.value_font_size ?? 22,
    valueFontWeight: fd.value_font_weight || '700',
    valueColor: fd.value_color || '#111827',
    subtitleFontSize: fd.subtitle_font_size ?? 11,
    subtitleColor: fd.subtitle_color || '#9ca3af',
    containerBackground: fd.container_background || 'transparent',
    itemBackground: fd.item_background || '#ffffff',
    itemBorderColor: fd.item_border_color || '#e5e7eb',
    itemBorderWidth: fd.item_border_width ?? 1,
    itemBorderRadius: fd.item_border_radius ?? 8,
    showShadow: fd.show_shadow ?? true,
    hoverBackground: fd.hover_background || '#f9fafb',
    deltaPositiveColor: fd.delta_positive_color || '#10b981',
    deltaNegativeColor: fd.delta_negative_color || '#ef4444',
    dividerColor: fd.divider_color || '#e5e7eb',
    showLabel: fd.show_label ?? true,
    showSubtitle: fd.show_subtitle ?? true,
    showDelta: fd.show_delta ?? true,
    showSeparators: fd.show_separators ?? false,
  };
}
