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
import ViolinDistributionViz from './ViolinDistributionViz';
import transformProps from './transformProps';
import { ViolinDistributionChartProps } from './types';

// Generate sample data
const SAMPLE_DATA = [
  ...Array.from({ length: 30 }, (_, i) => ({
    region: 'Central',
    days: 5 + Math.round(Math.sin(i) * 10 + 10),
  })),
  ...Array.from({ length: 30 }, (_, i) => ({
    region: 'Eastern',
    days: 10 + Math.round(Math.cos(i) * 15 + 15),
  })),
];

function makeChartProps(overrides: any = {}) {
  return {
    width: 600,
    height: 400,
    formData: {
      group_column: 'region',
      value_column: 'days',
      show_jitter: false,
      show_median: true,
      show_iqr: true,
      bandwidth: 1.0,
      density_resolution: 50,
      violin_width: 60,
      jitter_opacity: 0.3,
      jitter_size: 3,
      y_axis_format: 'SMART_NUMBER',
      ...overrides.formData,
    },
    queriesData: [{ data: overrides.data ?? SAMPLE_DATA }],
  };
}

describe('ViolinDistribution transformProps', () => {
  test('creates correct number of groups', () => {
    const result = transformProps(makeChartProps());
    expect(result.groups).toHaveLength(2);
  });

  test('groups have correct names', () => {
    const result = transformProps(makeChartProps());
    const names = result.groups.map(g => g.name).sort();
    expect(names).toEqual(['Central', 'Eastern']);
  });

  test('computes median correctly', () => {
    const result = transformProps(makeChartProps());
    for (const group of result.groups) {
      expect(group.median).toBeGreaterThan(0);
      expect(group.q1).toBeLessThanOrEqual(group.median);
      expect(group.q3).toBeGreaterThanOrEqual(group.median);
    }
  });

  test('generates density points', () => {
    const result = transformProps(makeChartProps());
    for (const group of result.groups) {
      expect(group.densityPoints.length).toBe(50);
      for (const [, density] of group.densityPoints) {
        expect(density).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('handles empty data', () => {
    const result = transformProps(makeChartProps({ data: [] }));
    expect(result.groups).toEqual([]);
  });
});

describe('ViolinDistributionViz component', () => {
  const BASE_PROPS: ViolinDistributionChartProps = {
    width: 600,
    height: 400,
    groups: [],
    showJitter: false,
    showMedian: true,
    showIQR: true,
    violinWidth: 60,
    jitterOpacity: 0.3,
    jitterSize: 3,
    yAxisFormat: 'SMART_NUMBER',
    orientation: 'vertical',
    scaleMode: 'area',
    showBoxOverlay: false,
    colorByGroup: true,
    showLegend: false,
    showMean: false,
    showQuartileLabels: false,
  };

  test('renders empty state when no groups', () => {
    render(
      <ThemeProvider theme={supersetTheme}>
        <ViolinDistributionViz {...BASE_PROPS} />
      </ThemeProvider>,
    );
    expect(
      screen.getByText('No distribution data available'),
    ).toBeInTheDocument();
  });

  test('renders SVG when groups exist', () => {
    const result = transformProps(makeChartProps());
    const { container } = render(
      <ThemeProvider theme={supersetTheme}>
        <ViolinDistributionViz {...result} />
      </ThemeProvider>,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  test('renders group labels', () => {
    const result = transformProps(makeChartProps());
    render(
      <ThemeProvider theme={supersetTheme}>
        <ViolinDistributionViz {...result} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Central')).toBeInTheDocument();
    expect(screen.getByText('Eastern')).toBeInTheDocument();
  });
});
