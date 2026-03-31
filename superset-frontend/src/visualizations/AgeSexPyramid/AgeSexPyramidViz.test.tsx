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
  { age: '0-4', sex: 'Male', cases: 500 },
  { age: '0-4', sex: 'Female', cases: 480 },
  { age: '5-14', sex: 'Male', cases: 300 },
  { age: '5-14', sex: 'Female', cases: 320 },
  { age: '15-24', sex: 'Male', cases: 200 },
  { age: '15-24', sex: 'Female', cases: 250 },
  { age: '25-34', sex: 'Male', cases: 180 },
  { age: '25-34', sex: 'Female', cases: 200 },
];

function makeChartProps(overrides: any = {}) {
  return {
    width: 600,
    height: 400,
    formData: {
      age_column: 'age',
      sex_column: 'sex',
      metric: { label: 'cases' },
      male_value: 'Male',
      female_value: 'Female',
      show_baseline_overlay: false,
      bar_gap: 20,
      show_values: false,
      y_axis_format: 'SMART_NUMBER',
      title: '',
      ...overrides.formData,
    },
    queriesData: [{ data: overrides.data ?? SAMPLE_DATA }],
  };
}

describe('AgeSexPyramid transformProps', () => {
  test('produces valid echartOptions', () => {
    const result = transformProps(makeChartProps());
    expect(result.echartOptions).toBeDefined();
    expect(result.echartOptions.series.length).toBeGreaterThanOrEqual(2);
  });

  test('male values are negative (mirrored)', () => {
    const result = transformProps(makeChartProps());
    const maleSeries = result.echartOptions.series.find(
      (s: any) => s.name === 'Male',
    );
    expect(maleSeries).toBeDefined();
    maleSeries.data.forEach((v: number) => {
      expect(v).toBeLessThanOrEqual(0);
    });
  });

  test('female values are positive', () => {
    const result = transformProps(makeChartProps());
    const femaleSeries = result.echartOptions.series.find(
      (s: any) => s.name === 'Female',
    );
    expect(femaleSeries).toBeDefined();
    femaleSeries.data.forEach((v: number) => {
      expect(v).toBeGreaterThanOrEqual(0);
    });
  });

  test('has correct number of age groups', () => {
    const result = transformProps(makeChartProps());
    expect(result.echartOptions.yAxis.data).toHaveLength(4);
  });

  test('handles empty data', () => {
    const result = transformProps(makeChartProps({ data: [] }));
    expect(result.echartOptions.yAxis.data).toEqual([]);
  });

  test('title appears when set', () => {
    const result = transformProps(
      makeChartProps({ formData: { title: 'Malaria by Age/Sex' } }),
    );
    expect(result.echartOptions.title.text).toBe('Malaria by Age/Sex');
  });

  test('baseline overlay adds extra series', () => {
    const dataWithBaseline = SAMPLE_DATA.map(r => ({
      ...r,
      population: r.cases * 10,
    }));
    const result = transformProps(
      makeChartProps({
        data: dataWithBaseline,
        formData: {
          baseline_metric: { label: 'population' },
          show_baseline_overlay: true,
        },
      }),
    );
    // 2 bar series + 2 line series
    expect(result.echartOptions.series.length).toBe(4);
  });
});
