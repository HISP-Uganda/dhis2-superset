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
import { QueryFormData } from '@superset-ui/core';

export type StockBand = 'stockout' | 'understock' | 'optimal' | 'overstock';

export interface CommodityRow {
  name: string;
  soh: number;
  amc: number;
  mos: number;
  formattedSoh: string;
  formattedAmc: string;
  formattedMos: string;
  band: StockBand;
  bandColor: string;
  bandLabel: string;
  barPercent: number;
  incomingQuantity?: number;
  formattedIncoming?: string;
}

export interface StockStatusFormData extends QueryFormData {
  commodity_column: string;
  soh_metric: any;
  amc_metric: any;
  understock_threshold: number;
  overstock_threshold: number;
  max_mos_display: number;
  row_height: number;
  show_soh_column: boolean;
  show_amc_column: boolean;
  show_mos_bar: boolean;
  value_format: string;
  sort_by: 'mos-asc' | 'mos-desc' | 'name';
  groupby?: string[];
  incoming_metric?: any;
  display_mode?: 'quantity' | 'mos' | 'status' | 'mixed';
  show_risk_badges?: boolean;
  show_mos_value?: boolean;
  show_incoming?: boolean;
  density_tier?: 'compact' | 'standard';
  null_value_text?: string;
  show_status_header?: boolean;
}

export interface StockStatusChartProps {
  width: number;
  height: number;
  commodities: CommodityRow[];
  understockThreshold: number;
  overstockThreshold: number;
  maxMosDisplay: number;
  rowHeight: number;
  showSohColumn: boolean;
  showAmcColumn: boolean;
  showMosBar: boolean;
  displayMode: string;
  showRiskBadges: boolean;
  showMosValue: boolean;
  showIncoming: boolean;
  densityTier: string;
  nullValueText: string;
  showStatusHeader: boolean;
}
