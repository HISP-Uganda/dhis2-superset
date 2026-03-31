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
/* eslint-disable theme-colors/no-literal-colors */
import { getMetricLabel, getNumberFormatter } from '@superset-ui/core';
import { StockStatusFormData, StockStatusChartProps, CommodityRow, StockBand } from './types';

const BAND_CONFIG: Record<StockBand, { color: string; label: string }> = {
  stockout: { color: '#B71C1C', label: 'Stockout' },
  understock: { color: '#D32F2F', label: 'Understock' },
  optimal: { color: '#2E7D32', label: 'Optimal' },
  overstock: { color: '#F9A825', label: 'Overstock' },
};

export default function transformProps(chartProps: any): StockStatusChartProps {
  const { width, height, formData, queriesData } = chartProps;
  const fd = formData as StockStatusFormData;
  const data = queriesData?.[0]?.data || [];

  const commodityCol = Array.isArray(fd.commodity_column)
    ? fd.commodity_column[0]
    : fd.commodity_column;
  const sohLabel = fd.soh_metric ? getMetricLabel(fd.soh_metric) : '';
  const amcLabel = fd.amc_metric ? getMetricLabel(fd.amc_metric) : '';
  const incomingLabel = fd.incoming_metric ? getMetricLabel(fd.incoming_metric) : '';
  const showIncoming = fd.show_incoming ?? false;
  const nullValueText = fd.null_value_text ?? '–';
  const densityTier = fd.density_tier ?? 'compact';
  const valueFmt = getNumberFormatter(fd.value_format || 'SMART_NUMBER');

  const understockThreshold = fd.understock_threshold ?? 2;
  const overstockThreshold = fd.overstock_threshold ?? 6;
  const maxMos = fd.max_mos_display ?? 12;

  let commodities: CommodityRow[] = data.map((row: any) => {
    const name = String(row[commodityCol] ?? '');
    const soh = (row[sohLabel] as number) ?? 0;
    const amc = (row[amcLabel] as number) ?? 0;
    const mos = amc > 0 ? soh / amc : 0;

    let band: StockBand;
    if (soh === 0 || mos === 0) band = 'stockout';
    else if (mos < understockThreshold) band = 'understock';
    else if (mos > overstockThreshold) band = 'overstock';
    else band = 'optimal';

    const cfg = BAND_CONFIG[band];

    const incoming = incomingLabel ? (row[incomingLabel] as number) ?? undefined : undefined;

    return {
      name,
      soh,
      amc,
      mos,
      formattedSoh: valueFmt(soh),
      formattedAmc: valueFmt(amc),
      formattedMos: mos.toFixed(1),
      band,
      bandColor: cfg.color,
      bandLabel: cfg.label,
      barPercent: Math.min(100, (mos / maxMos) * 100),
      incomingQuantity: incoming,
      formattedIncoming: incoming != null ? valueFmt(incoming) : undefined,
    };
  });

  // Sort
  const sortBy = fd.sort_by || 'mos-asc';
  if (sortBy === 'mos-asc') {
    commodities.sort((a, b) => a.mos - b.mos);
  } else if (sortBy === 'mos-desc') {
    commodities.sort((a, b) => b.mos - a.mos);
  } else {
    commodities.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Apply density tier to row height
  const baseRowHeight = fd.row_height ?? 32;
  const rowHeight = densityTier === 'compact'
    ? Math.min(baseRowHeight, 28)
    : baseRowHeight;

  return {
    width,
    height,
    commodities,
    understockThreshold,
    overstockThreshold,
    maxMosDisplay: maxMos,
    rowHeight,
    showSohColumn: fd.show_soh_column ?? true,
    showAmcColumn: fd.show_amc_column ?? true,
    showMosBar: fd.show_mos_bar ?? true,
    displayMode: fd.display_mode ?? 'mixed',
    showRiskBadges: fd.show_risk_badges ?? true,
    showMosValue: fd.show_mos_value ?? true,
    showIncoming: showIncoming && !!incomingLabel,
    densityTier,
    nullValueText,
    showStatusHeader: fd.show_status_header ?? true,
  };
}
