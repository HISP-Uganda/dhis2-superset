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
import { CohortCascadeFormData, CohortCascadeChartProps, CascadeStage } from './types';

/* eslint-disable theme-colors/no-literal-colors */
const STAGE_COLORS = [
  '#1976D2', '#1565C0', '#0D47A1', '#0D3B66',
  '#2E7D32', '#1B5E20', '#F9A825', '#D32F2F',
];

export default function transformProps(chartProps: any): CohortCascadeChartProps {
  const { width, height, formData, queriesData } = chartProps;
  const fd = formData as CohortCascadeFormData;
  const data = queriesData?.[0]?.data || [];
  const lastRow = data[data.length - 1] || {};

  const valueFmt = getNumberFormatter(fd.value_format || 'SMART_NUMBER');
  const metrics = fd.metrics || [];

  const rawValues = metrics.map((m: any) => {
    const label = getMetricLabel(m);
    return (lastRow[label] as number) ?? 0;
  });

  const firstValue = rawValues[0] || 1;
  const referenceStage = fd.reference_stage || 'first';

  const stages: CascadeStage[] = metrics.map((m: any, idx: number) => {
    const label = getMetricLabel(m);
    const value = rawValues[idx];
    const refValue = referenceStage === 'previous' && idx > 0
      ? rawValues[idx - 1]
      : firstValue;
    const percentRetained = refValue > 0 ? (value / refValue) * 100 : 0;
    const prevValue = idx > 0 ? rawValues[idx - 1] : value;
    const percentLost = prevValue > 0 ? ((prevValue - value) / prevValue) * 100 : 0;

    return {
      label,
      value,
      formattedValue: valueFmt(value),
      percentRetained,
      percentLost: idx === 0 ? 0 : percentLost,
      color: STAGE_COLORS[idx % STAGE_COLORS.length],
    };
  });

  return {
    width,
    height,
    stages,
    orientation: fd.orientation || 'vertical',
    showConnectors: fd.show_connectors ?? true,
    showPercentRetained: fd.show_percent_retained ?? true,
    showPercentLost: fd.show_percent_lost ?? true,
    showValues: fd.show_values ?? true,
    barBorderRadius: fd.bar_border_radius ?? 6,
    barGap: fd.bar_gap ?? 24,
    labelFontSize: fd.label_font_size ?? 12,
    valueFontSize: fd.value_font_size ?? 18,
    percentMode: fd.percent_mode || 'cumulative',
    showDropoffEmphasis: fd.show_dropoff_emphasis ?? true,
    labelPlacement: fd.label_placement || 'outside',
    connectorStyle: fd.connector_style || 'arrow',
    densityTier: fd.density_tier || 'standard',
    referenceStage,
    nullValueText: fd.null_value_text || '–',
  };
}
