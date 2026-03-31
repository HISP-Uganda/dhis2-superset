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
import transformProps from './transformProps';

const SAMPLE_DATA = [
  { district: 'Kampala', month: 'Jan', cases: 100 },
  { district: 'Kampala', month: 'Feb', cases: 120 },
  { district: 'Kampala', month: 'Mar', cases: 90 },
  { district: 'Wakiso', month: 'Jan', cases: 80 },
  { district: 'Wakiso', month: 'Feb', cases: 95 },
  { district: 'Wakiso', month: 'Mar', cases: 110 },
  { district: 'Mukono', month: 'Jan', cases: 60 },
  { district: 'Mukono', month: 'Feb', cases: 70 },
  { district: 'Mukono', month: 'Mar', cases: 65 },
];

function makeChartProps(overrides: any = {}) {
  return {
    width: 800,
    height: 600,
    formData: {
      groupby: ['district'],
      x_axis: ['month'],
      metrics: [{ label: 'cases' }],
      columns: 3,
      mini_chart_type: 'line',
      sync_y_axis: true,
      show_panel_title: true,
      show_x_axis: false,
      show_y_axis: false,
      panel_padding: 8,
      line_width: 1.5,
      y_axis_format: 'SMART_NUMBER',
      ...overrides.formData,
    },
    queriesData: [{ data: overrides.data ?? SAMPLE_DATA }],
  };
}

describe('SmallMultiples transformProps', () => {
  test('creates correct number of panels', () => {
    const result = transformProps(makeChartProps());
    expect(result.panels).toHaveLength(3);
  });

  test('panel titles match group values', () => {
    const result = transformProps(makeChartProps());
    const titles = result.panels.map(p => p.title).sort();
    expect(titles).toEqual(['Kampala', 'Mukono', 'Wakiso']);
  });

  test('each panel has correct data points', () => {
    const result = transformProps(makeChartProps());
    const kampala = result.panels.find(p => p.title === 'Kampala');
    expect(kampala?.xValues).toEqual(['Jan', 'Feb', 'Mar']);
    expect(kampala?.yValues).toEqual([100, 120, 90]);
  });

  test('computes global Y min/max when syncYAxis is true', () => {
    const result = transformProps(makeChartProps());
    expect(result.globalYMin).toBe(60);
    expect(result.globalYMax).toBe(120);
  });

  test('handles empty data', () => {
    const result = transformProps(makeChartProps({ data: [] }));
    expect(result.panels).toEqual([]);
  });

  test('respects chart type setting', () => {
    const result = transformProps(
      makeChartProps({ formData: { mini_chart_type: 'bar' } }),
    );
    expect(result.miniChartType).toBe('bar');
  });
});
