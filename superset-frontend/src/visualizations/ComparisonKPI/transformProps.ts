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
import { getMetricLabel, getNumberFormatter } from '@superset-ui/core';
import { ComparisonKPIFormData, ComparisonKPIChartProps } from './types';

export default function transformProps(chartProps: any): ComparisonKPIChartProps {
  const { width, height, formData, queriesData } = chartProps;
  const fd = formData as ComparisonKPIFormData;
  const data = queriesData?.[0]?.data || [];
  const lastRow = data[data.length - 1] || {};

  const primaryFmt = getNumberFormatter(fd.primary_value_format || 'SMART_NUMBER');
  const compFmt = getNumberFormatter(fd.comparison_value_format || 'SMART_NUMBER');
  const deltaFmt = getNumberFormatter(fd.delta_format || 'SMART_NUMBER');

  const metricLabel = fd.metric ? getMetricLabel(fd.metric) : '';
  const compLabel = fd.comparison_metric ? getMetricLabel(fd.comparison_metric) : '';

  const nullValueText = fd.null_value_text || '–';
  const valuePrefix = fd.value_prefix || '';
  const valueSuffix = fd.value_suffix || '';

  const currentValue = (lastRow[metricLabel] as number) ?? 0;
  const currentValueIsNull = lastRow[metricLabel] == null;
  const comparisonValue = compLabel ? ((lastRow[compLabel] as number) ?? null) : null;

  // Delta calculations
  let absoluteDelta: number | null = null;
  let percentageDelta: number | null = null;
  let trendDirection: 'up' | 'down' | 'flat' = 'flat';

  if (comparisonValue !== null) {
    absoluteDelta = currentValue - comparisonValue;
    if (comparisonValue !== 0) {
      percentageDelta = absoluteDelta / Math.abs(comparisonValue);
    }
    if (absoluteDelta > 0) trendDirection = 'up';
    else if (absoluteDelta < 0) trendDirection = 'down';
  }

  // Semantic state based on trend logic
  const logic = fd.trend_logic || 'higher-is-better';
  let semanticState: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (trendDirection !== 'flat') {
    const isUp = trendDirection === 'up';
    semanticState =
      (isUp && logic === 'higher-is-better') ||
      (!isUp && logic === 'lower-is-better')
        ? 'positive'
        : 'negative';
  }

  // Gauge
  const gaugeMaxRaw = fd.gauge_max ? parseFloat(String(fd.gauge_max)) : 0;
  const gaugeMax = gaugeMaxRaw > 0 ? gaugeMaxRaw : (comparisonValue ?? 0);
  const gaugePercent =
    fd.show_gauge && gaugeMax > 0
      ? Math.min(100, (currentValue / gaugeMax) * 100)
      : null;

  const pctFmt = getNumberFormatter('+,.1%');

  // Threshold parsing
  const thresholdWarning = fd.threshold_warning
    ? parseFloat(String(fd.threshold_warning))
    : null;
  const thresholdCritical = fd.threshold_critical
    ? parseFloat(String(fd.threshold_critical))
    : null;

  // Format with prefix/suffix, respecting null
  const applyAffixes = (formatted: string) =>
    `${valuePrefix}${formatted}${valueSuffix}`;

  const formattedCurrentValue = currentValueIsNull
    ? nullValueText
    : applyAffixes(primaryFmt(currentValue));

  return {
    width,
    height,
    currentValue,
    formattedCurrentValue,
    comparisonValue,
    formattedComparisonValue: comparisonValue !== null ? applyAffixes(compFmt(comparisonValue)) : null,
    absoluteDelta,
    formattedAbsoluteDelta: absoluteDelta !== null ? deltaFmt(absoluteDelta) : null,
    percentageDelta,
    formattedPercentageDelta: percentageDelta !== null ? pctFmt(percentageDelta) : null,
    trendDirection,
    semanticState,
    comparisonType: fd.comparison_type || 'target',
    trendLogic: logic,
    layoutVariant: fd.layout_variant || 'standard',
    primaryLabel: fd.primary_label || metricLabel || 'Current',
    comparisonLabel: fd.comparison_label || compLabel || 'Comparison',
    showAbsoluteDelta: fd.show_absolute_delta ?? true,
    showPercentageDelta: fd.show_percentage_delta ?? true,
    showGauge: fd.show_gauge ?? false,
    gaugePercent,
    title: fd.title || '',
    subtitle: fd.subtitle || '',
    titleFontSize: fd.title_font_size ?? 13,
    valueFontSize: fd.value_font_size ?? 36,
    deltaFontSize: fd.delta_font_size ?? 14,
    cardPadding: fd.card_padding ?? 24,
    borderRadius: fd.border_radius ?? 12,
    showComparisonValue: fd.show_comparison_value ?? true,
    showSparkline: fd.show_sparkline ?? false,
    densityTier: fd.density_tier || 'standard',
    nullValueText,
    valuePrefix,
    valueSuffix,
    showThresholdBand: fd.show_threshold_band ?? false,
    thresholdWarning: Number.isFinite(thresholdWarning) ? thresholdWarning : null,
    thresholdCritical: Number.isFinite(thresholdCritical) ? thresholdCritical : null,
    colorMode: fd.color_mode || 'semantic',
  };
}
