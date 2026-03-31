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
import { render, screen } from '@testing-library/react';
import { ThemeProvider, supersetTheme } from '@superset-ui/core';
import StockStatusViz from './StockStatusViz';
import { StockStatusChartProps } from './types';
import transformProps from './transformProps';

const BASE_PROPS: StockStatusChartProps = {
  width: 800,
  height: 400,
  commodities: [
    { name: 'ACT', soh: 0, amc: 500, mos: 0, formattedSoh: '0', formattedAmc: '500', formattedMos: '0.0', band: 'stockout', bandColor: '#B71C1C', bandLabel: 'Stockout', barPercent: 0 },
    { name: 'RDTs', soh: 500, amc: 500, mos: 1.0, formattedSoh: '500', formattedAmc: '500', formattedMos: '1.0', band: 'understock', bandColor: '#D32F2F', bandLabel: 'Understock', barPercent: 8.3 },
    { name: 'LLINs', soh: 2000, amc: 500, mos: 4.0, formattedSoh: '2K', formattedAmc: '500', formattedMos: '4.0', band: 'optimal', bandColor: '#2E7D32', bandLabel: 'Optimal', barPercent: 33.3 },
    { name: 'SP', soh: 5000, amc: 500, mos: 10.0, formattedSoh: '5K', formattedAmc: '500', formattedMos: '10.0', band: 'overstock', bandColor: '#F9A825', bandLabel: 'Overstock', barPercent: 83.3 },
  ],
  understockThreshold: 2,
  overstockThreshold: 6,
  maxMosDisplay: 12,
  rowHeight: 32,
  showSohColumn: true,
  showAmcColumn: true,
  showMosBar: true,
  displayMode: 'mixed',
  showRiskBadges: true,
  showMosValue: true,
  showIncoming: false,
  densityTier: 'compact',
  nullValueText: '–',
  showStatusHeader: true,
};

function renderStock(overrides: Partial<StockStatusChartProps> = {}) {
  return render(
    <ThemeProvider theme={supersetTheme}>
      <StockStatusViz {...BASE_PROPS} {...overrides} />
    </ThemeProvider>,
  );
}

describe('StockStatusViz', () => {
  test('renders all commodity names', () => {
    renderStock();
    expect(screen.getByText('ACT')).toBeInTheDocument();
    expect(screen.getByText('RDTs')).toBeInTheDocument();
    expect(screen.getByText('LLINs')).toBeInTheDocument();
    expect(screen.getByText('SP')).toBeInTheDocument();
  });

  test('renders status pills', () => {
    renderStock();
    expect(screen.getByText('Stockout')).toBeInTheDocument();
    expect(screen.getByText('Understock')).toBeInTheDocument();
    expect(screen.getByText('Optimal')).toBeInTheDocument();
    expect(screen.getByText('Overstock')).toBeInTheDocument();
  });

  test('renders MOS values', () => {
    renderStock();
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('4.0')).toBeInTheDocument();
    expect(screen.getByText('10.0')).toBeInTheDocument();
  });

  test('renders empty state', () => {
    renderStock({ commodities: [] });
    expect(screen.getByText('No stock data available')).toBeInTheDocument();
  });

  test('hides SOH column when disabled', () => {
    renderStock({ showSohColumn: false });
    expect(screen.queryByText('SOH')).not.toBeInTheDocument();
  });

  test('hides AMC column when disabled', () => {
    renderStock({ showAmcColumn: false });
    expect(screen.queryByText('AMC')).not.toBeInTheDocument();
  });
});

describe('StockStatus transformProps', () => {
  test('computes MOS correctly', () => {
    const result = transformProps({
      width: 800,
      height: 400,
      formData: {
        commodity_column: 'item',
        soh_metric: { label: 'soh' },
        amc_metric: { label: 'amc' },
        understock_threshold: 2,
        overstock_threshold: 6,
        max_mos_display: 12,
      },
      queriesData: [
        {
          data: [
            { item: 'ACT', soh: 1000, amc: 500 },
            { item: 'RDTs', soh: 0, amc: 100 },
          ],
        },
      ],
    });
    expect(result.commodities).toHaveLength(2);
    const act = result.commodities.find(c => c.name === 'ACT');
    expect(act?.mos).toBe(2);
    expect(act?.band).toBe('optimal');
    const rdts = result.commodities.find(c => c.name === 'RDTs');
    expect(rdts?.mos).toBe(0);
    expect(rdts?.band).toBe('stockout');
  });
});
