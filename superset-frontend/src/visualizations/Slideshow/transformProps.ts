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
import { SlideshowChartProps, SlideshowFormData, SlideshowSlide } from './types';

function cssRgba(
  color: { r: number; g: number; b: number; a: number } | null | undefined,
): string | null {
  if (!color) return null;
  return `rgba(${color.r},${color.g},${color.b},${color.a})`;
}

function resolveMetricLabel(metric: any, index: number): string {
  if (typeof metric === 'string') {
    return metric;
  }
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

export default function transformProps(
  chartProps: ChartProps,
): SlideshowChartProps {
  const { width, height, queriesData, formData } = chartProps;
  const fd = formData as SlideshowFormData;

  const { data = [] } = queriesData?.[0] ?? {};
  const row = data?.[0] ?? {};

  const metrics = (fd.metrics ?? []) as any[];
  const numberFormat = fd.yAxisFormat ?? 'SMART_NUMBER';
  const formatter = getNumberFormatter(numberFormat);
  const prefix = fd.prefix ?? '';
  const suffix = fd.suffix ?? '';
  const nullText = fd.nullText ?? '—';

  const slides: SlideshowSlide[] = metrics.map((metric, idx) => {
    const metricName = resolveMetricLabel(metric, idx);
    const raw = resolveMetricValue(row, metric, idx) ?? null;
    const rawNum = raw === null ? null : Number(raw);
    const isNull = rawNum === null || Number.isNaN(rawNum);
    const formatted = isNull ? nullText : `${prefix}${formatter(rawNum!)}${suffix}`;

    return {
      key: `slide-${idx}`,
      label: metricName,
      value: formatted,
      rawValue: isNull ? null : rawNum,
      metricName,
    };
  });

  // Parse embedded chart IDs
  const embeddedChartIds: number[] = (fd.embeddedChartIds ?? '')
    .split(',')
    .map((s: string) => parseInt(s.trim(), 10))
    .filter((n: number) => Number.isFinite(n) && n > 0);

  return {
    width,
    height,
    slides,

    autoPlay: fd.autoPlay ?? true,
    slideIntervalMs: fd.slideIntervalMs ?? 5000,
    pauseOnHover: fd.pauseOnHover ?? true,
    pauseOnFocus: fd.pauseOnFocus ?? false,
    loop: fd.loop ?? true,
    startIndex: fd.startIndex ?? 0,

    transitionType: fd.transitionType ?? 'fade',
    transitionDurationMs: fd.transitionDurationMs ?? 600,

    showArrows: fd.showArrows ?? true,
    showDots: fd.showDots ?? true,
    showCounter: fd.showCounter ?? false,
    showProgressBar: fd.showProgressBar ?? true,
    keyboardNavigation: fd.keyboardNavigation ?? true,

    heightMode: fd.heightMode ?? 'fixed',
    fixedHeight: fd.fixedHeight ?? 320,
    contentPadding: fd.contentPadding ?? 32,

    bgColor: cssRgba(fd.bgColor),
    valueColor: cssRgba(fd.valueColor),
    labelColor: cssRgba(fd.labelColor),
    borderRadius: fd.borderRadius ?? 12,
    showBorder: fd.showBorder ?? false,
    showShadow: fd.showShadow ?? true,
    dotColor: cssRgba(fd.dotColor),
    arrowColor: cssRgba(fd.arrowColor),
    progressBarColor: cssRgba(fd.progressBarColor),

    embeddedChartIds,
  };
}
