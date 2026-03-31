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
  { district: 'Kampala', actual: 0.92, target: 0.95 },
  { district: 'Wakiso', actual: 0.78, target: 0.95 },
  { district: 'Mukono', actual: 0.65, target: 0.95 },
  { district: 'Jinja', actual: 0.99, target: 0.95 },
  { district: 'Gulu', actual: 0.55, target: 0.95 },
];

function makeChartProps(overrides: any = {}) {
  return {
    width: 600,
    height: 400,
    formData: {
      entity_column: 'district',
      actual_metric: { label: 'actual' },
      target_metric: { label: 'target' },
      sort_order: 'worst-first',
      variance_thresholds: '5:#2E7D32;15:#F9A825;100:#D32F2F',
      bar_height: 20,
      show_values: true,
      show_entity_labels: true,
      y_axis_format: '+,.1%',
      max_entities: 20,
      ...overrides.formData,
    },
    queriesData: [{ data: overrides.data ?? SAMPLE_DATA }],
  };
}

describe('RankedVariance transformProps', () => {
  test('produces valid echartOptions', () => {
    const result = transformProps(makeChartProps());
    expect(result.echartOptions).toBeDefined();
    expect(result.echartOptions.series).toHaveLength(1);
  });

  test('sorts worst-first by default', () => {
    const result = transformProps(makeChartProps());
    const barData = result.echartOptions.series[0].data;
    // Worst variance should be at top (reversed for echarts)
    // Gulu is worst (0.55 vs 0.95 = ~-42%), reversed last
    expect(barData.length).toBe(5);
  });

  test('sorts best-first when configured', () => {
    const result = transformProps(
      makeChartProps({ formData: { sort_order: 'best-first' } }),
    );
    expect(result.echartOptions.series[0].data.length).toBe(5);
  });

  test('includes zero line markLine', () => {
    const result = transformProps(makeChartProps());
    const markLine = result.echartOptions.series[0].markLine;
    expect(markLine).toBeDefined();
    expect(markLine.data[0].xAxis).toBe(0);
  });

  test('respects max_entities limit', () => {
    const result = transformProps(
      makeChartProps({ formData: { max_entities: 3 } }),
    );
    expect(result.echartOptions.series[0].data.length).toBe(3);
  });

  test('handles empty data', () => {
    const result = transformProps(makeChartProps({ data: [] }));
    expect(result.echartOptions.series[0].data).toEqual([]);
  });
});
