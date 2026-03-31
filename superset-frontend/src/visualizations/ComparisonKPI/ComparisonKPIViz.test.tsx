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
import ComparisonKPIViz from './ComparisonKPIViz';
import { ComparisonKPIChartProps } from './types';

const BASE_PROPS: ComparisonKPIChartProps = {
  width: 400,
  height: 300,
  currentValue: 42700,
  formattedCurrentValue: '42.7K',
  comparisonValue: 50000,
  formattedComparisonValue: '50K',
  absoluteDelta: -7300,
  formattedAbsoluteDelta: '-7.3K',
  percentageDelta: -0.146,
  formattedPercentageDelta: '-14.6%',
  trendDirection: 'down',
  semanticState: 'negative',
  comparisonType: 'target',
  trendLogic: 'higher-is-better',
  layoutVariant: 'standard',
  primaryLabel: 'Malaria Cases',
  comparisonLabel: 'Target',
  showAbsoluteDelta: true,
  showPercentageDelta: true,
  showGauge: false,
  gaugePercent: null,
  title: 'Monthly Cases',
  subtitle: 'vs Target',
  titleFontSize: 13,
  valueFontSize: 36,
  deltaFontSize: 14,
  cardPadding: 24,
  borderRadius: 12,
  showComparisonValue: true,
  showSparkline: false,
  densityTier: 'standard',
  nullValueText: '–',
  valuePrefix: '',
  valueSuffix: '',
  showThresholdBand: false,
  thresholdWarning: null,
  thresholdCritical: null,
  colorMode: 'semantic',
};

function renderKPI(overrides: Partial<ComparisonKPIChartProps> = {}) {
  return render(
    <ThemeProvider theme={supersetTheme}>
      <ComparisonKPIViz {...BASE_PROPS} {...overrides} />
    </ThemeProvider>,
  );
}

describe('ComparisonKPIViz', () => {
  test('renders current value', () => {
    renderKPI();
    expect(screen.getByText('42.7K')).toBeInTheDocument();
  });

  test('renders title and subtitle', () => {
    renderKPI();
    expect(screen.getByText('Monthly Cases')).toBeInTheDocument();
    expect(screen.getByText('vs Target')).toBeInTheDocument();
  });

  test('renders absolute delta', () => {
    renderKPI();
    expect(screen.getByText(/\-7\.3K/)).toBeInTheDocument();
  });

  test('renders percentage delta', () => {
    renderKPI();
    expect(screen.getByText('-14.6%')).toBeInTheDocument();
  });

  test('renders comparison value', () => {
    renderKPI();
    expect(screen.getByText('50K')).toBeInTheDocument();
    expect(screen.getByText(/Target/)).toBeInTheDocument();
  });

  test('hides comparison when showComparisonValue is false', () => {
    renderKPI({ showComparisonValue: false });
    expect(screen.queryByText('50K')).not.toBeInTheDocument();
  });

  test('hides delta when showAbsoluteDelta is false', () => {
    renderKPI({ showAbsoluteDelta: false });
    expect(screen.queryByText(/\-7\.3K/)).not.toBeInTheDocument();
  });

  test('renders gauge when enabled', () => {
    const { container } = renderKPI({
      showGauge: true,
      gaugePercent: 85.4,
    });
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  test('renders flat state without arrows', () => {
    renderKPI({ trendDirection: 'flat', semanticState: 'neutral' });
    expect(screen.queryByText('↑')).not.toBeInTheDocument();
    expect(screen.queryByText('↓')).not.toBeInTheDocument();
  });

  test('renders positive state for higher-is-better up trend', () => {
    renderKPI({
      trendDirection: 'up',
      semanticState: 'positive',
      absoluteDelta: 5000,
      formattedAbsoluteDelta: '+5K',
    });
    expect(screen.getByText(/\+5K/)).toBeInTheDocument();
  });
});
