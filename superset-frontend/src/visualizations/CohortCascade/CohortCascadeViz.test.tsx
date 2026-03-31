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
import CohortCascadeViz from './CohortCascadeViz';
import { CohortCascadeChartProps } from './types';

const BASE_PROPS: CohortCascadeChartProps = {
  width: 600,
  height: 400,
  stages: [
    { label: 'Suspected', value: 10000, formattedValue: '10K', percentRetained: 100, percentLost: 0, color: '#1976D2' },
    { label: 'Tested', value: 8500, formattedValue: '8.5K', percentRetained: 85, percentLost: 15, color: '#1565C0' },
    { label: 'Confirmed', value: 3200, formattedValue: '3.2K', percentRetained: 32, percentLost: 62.4, color: '#0D47A1' },
    { label: 'Treated', value: 3000, formattedValue: '3K', percentRetained: 30, percentLost: 6.25, color: '#0D3B66' },
  ],
  orientation: 'vertical',
  showConnectors: true,
  showPercentRetained: true,
  showPercentLost: true,
  showValues: true,
  barBorderRadius: 6,
  barGap: 24,
  labelFontSize: 12,
  valueFontSize: 18,
  percentMode: 'cumulative',
  showDropoffEmphasis: true,
  labelPlacement: 'outside',
  connectorStyle: 'arrow',
  densityTier: 'standard',
  referenceStage: 'first',
  nullValueText: '–',
};

function renderCascade(overrides: Partial<CohortCascadeChartProps> = {}) {
  return render(
    <ThemeProvider theme={supersetTheme}>
      <CohortCascadeViz {...BASE_PROPS} {...overrides} />
    </ThemeProvider>,
  );
}

describe('CohortCascadeViz', () => {
  test('renders all stage labels', () => {
    renderCascade();
    expect(screen.getByText('Suspected')).toBeInTheDocument();
    expect(screen.getByText('Tested')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Treated')).toBeInTheDocument();
  });

  test('renders all stage values', () => {
    renderCascade();
    expect(screen.getByText('10K')).toBeInTheDocument();
    expect(screen.getByText('8.5K')).toBeInTheDocument();
    expect(screen.getByText('3.2K')).toBeInTheDocument();
    expect(screen.getByText('3K')).toBeInTheDocument();
  });

  test('renders retention badges', () => {
    renderCascade();
    expect(screen.getByText('85.0% retained')).toBeInTheDocument();
    expect(screen.getByText('32.0% retained')).toBeInTheDocument();
  });

  test('renders loss badges', () => {
    renderCascade();
    expect(screen.getByText('−15.0% lost')).toBeInTheDocument();
  });

  test('renders connectors', () => {
    renderCascade();
    const arrows = screen.getAllByText('↓');
    expect(arrows.length).toBe(3);
  });

  test('renders empty state when no stages', () => {
    renderCascade({ stages: [] });
    expect(screen.getByText('No cascade stages configured')).toBeInTheDocument();
  });

  test('hides values when showValues is false', () => {
    renderCascade({ showValues: false });
    expect(screen.queryByText('10K')).not.toBeInTheDocument();
  });

  test('hides connectors when showConnectors is false', () => {
    renderCascade({ showConnectors: false });
    expect(screen.queryByText('↓')).not.toBeInTheDocument();
  });

  test('renders horizontal orientation', () => {
    renderCascade({ orientation: 'horizontal' });
    const arrows = screen.getAllByText('→');
    expect(arrows.length).toBe(3);
  });
});
