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

function makeChartProps(overrides: any = {}) {
  const data = Array.from({ length: 52 }, (_, i) => ({
    week: `W${i + 1}`,
    cases: 50 + Math.round(Math.sin(i / 4) * 20) + (i === 40 ? 80 : 0),
  }));

  return {
    width: 800,
    height: 400,
    formData: {
      x_axis: 'week',
      metrics: [{ label: 'cases' }],
      threshold_method: 'mean_2sd',
      baseline_periods: 52,
      show_mean_line: true,
      show_ucl: true,
      show_lcl: false,
      highlight_breaches: true,
      shade_alert_zone: true,
      line_width: 2,
      point_size: 4,
      y_axis_format: 'SMART_NUMBER',
      show_legend: true,
      csum_weight: 0.5,
      ...overrides.formData,
    },
    queriesData: [{ data }],
  };
}

describe('ControlChart transformProps', () => {
  test('produces valid echartOptions', () => {
    const result = transformProps(makeChartProps());
    expect(result.echartOptions).toBeDefined();
    expect(result.echartOptions.series.length).toBeGreaterThanOrEqual(2);
    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
  });

  test('includes mean line series', () => {
    const result = transformProps(makeChartProps());
    const meanSeries = result.echartOptions.series.find(
      (s: any) => s.name === 'Mean',
    );
    expect(meanSeries).toBeDefined();
    expect(meanSeries.lineStyle.type).toBe('dashed');
  });

  test('includes UCL series', () => {
    const result = transformProps(makeChartProps());
    const uclSeries = result.echartOptions.series.find(
      (s: any) => s.name === 'UCL',
    );
    expect(uclSeries).toBeDefined();
  });

  test('detects breaches', () => {
    const result = transformProps(makeChartProps());
    const breachSeries = result.echartOptions.series.find(
      (s: any) => s.name === 'Breach',
    );
    // The spike at i=40 (+80) should breach
    expect(breachSeries).toBeDefined();
    expect(breachSeries.data.length).toBeGreaterThanOrEqual(1);
  });

  test('hides mean line when show_mean_line is false', () => {
    const result = transformProps(
      makeChartProps({ formData: { show_mean_line: false } }),
    );
    const meanSeries = result.echartOptions.series.find(
      (s: any) => s.name === 'Mean',
    );
    expect(meanSeries).toBeUndefined();
  });

  test('supports Q3 method', () => {
    const result = transformProps(
      makeChartProps({ formData: { threshold_method: 'q3' } }),
    );
    expect(result.echartOptions.series.length).toBeGreaterThanOrEqual(2);
  });

  test('supports C-SUM method', () => {
    const result = transformProps(
      makeChartProps({ formData: { threshold_method: 'csum' } }),
    );
    expect(result.echartOptions.series.length).toBeGreaterThanOrEqual(2);
  });

  test('handles empty data gracefully', () => {
    const result = transformProps({
      width: 800,
      height: 400,
      formData: {
        x_axis: 'week',
        metrics: [{ label: 'cases' }],
        threshold_method: 'mean_2sd',
        baseline_periods: 52,
      },
      queriesData: [{ data: [] }],
    });
    expect(result.echartOptions).toBeDefined();
    expect(result.echartOptions.xAxis.data).toEqual([]);
  });
});
