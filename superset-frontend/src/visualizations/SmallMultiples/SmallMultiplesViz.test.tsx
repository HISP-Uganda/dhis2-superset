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
import { detectAvailablePresets, resolvePresetColumn } from './dhis2Presets';

const SAMPLE_DATA = [
  { district: 'Kampala', month: 'Jan', cases: 100, deaths: 5 },
  { district: 'Kampala', month: 'Feb', cases: 120, deaths: 8 },
  { district: 'Kampala', month: 'Mar', cases: 90, deaths: 3 },
  { district: 'Wakiso', month: 'Jan', cases: 80, deaths: 4 },
  { district: 'Wakiso', month: 'Feb', cases: 95, deaths: 6 },
  { district: 'Wakiso', month: 'Mar', cases: 110, deaths: 7 },
  { district: 'Mukono', month: 'Jan', cases: 60, deaths: 2 },
  { district: 'Mukono', month: 'Feb', cases: 70, deaths: 3 },
  { district: 'Mukono', month: 'Mar', cases: 65, deaths: 1 },
];

function makeChartProps(overrides: any = {}) {
  return {
    width: 800,
    height: 600,
    formData: {
      groupby: ['district'],
      x_axis: ['month'],
      metrics: [{ label: 'cases' }],
      grid_columns: 3,
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
    datasource: overrides.datasource,
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

  test('supports new chart types', () => {
    for (const type of ['pie', 'donut', 'scatter', 'heatmap', 'big_number', 'gauge']) {
      const result = transformProps(
        makeChartProps({ formData: { mini_chart_type: type } }),
      );
      expect(result.miniChartType).toBe(type);
    }
  });

  test('multi-metric produces series per metric', () => {
    const result = transformProps(
      makeChartProps({
        formData: {
          metrics: [{ label: 'cases' }, { label: 'deaths' }],
        },
      }),
    );
    const kampala = result.panels.find(p => p.title === 'Kampala');
    expect(kampala?.series).toHaveLength(2);
    expect(kampala?.series[0].metricLabel).toBe('cases');
    expect(kampala?.series[1].metricLabel).toBe('deaths');
    expect(kampala?.series[0].values).toEqual([100, 120, 90]);
    expect(kampala?.series[1].values).toEqual([5, 8, 3]);
  });

  test('latest values computed for subtitle', () => {
    const result = transformProps(makeChartProps());
    const kampala = result.panels.find(p => p.title === 'Kampala');
    expect(kampala?.latestValues.cases).toBe(90);
  });

  test('per-panel-mean reference line', () => {
    const result = transformProps(
      makeChartProps({
        formData: { reference_line_mode: 'per-panel-mean' },
      }),
    );
    const kampala = result.panels.find(p => p.title === 'Kampala');
    // (100 + 120 + 90) / 3 ≈ 103.33
    expect(kampala?.referenceValue).toBeCloseTo(103.33, 1);
  });

  test('responsive columns default enabled', () => {
    const result = transformProps(makeChartProps());
    expect(result.responsiveColumns).toBe(true);
  });

  test('metric colors assigned', () => {
    const result = transformProps(makeChartProps());
    expect(result.metricColors.length).toBeGreaterThan(0);
  });

  test('top N filtering', () => {
    const result = transformProps(
      makeChartProps({ formData: { top_n: 2, sort_panels: 'alphabetical' } }),
    );
    expect(result.panels).toHaveLength(2);
  });
});

describe('DHIS2 presets', () => {
  const DHIS2_COLUMNS = [
    {
      column_name: 'national',
      verbose_name: 'National',
      extra: JSON.stringify({ dhis2_is_ou_hierarchy: true, dhis2_ou_level: 1 }),
    },
    {
      column_name: 'region',
      verbose_name: 'Region',
      extra: JSON.stringify({ dhis2_is_ou_hierarchy: true, dhis2_ou_level: 2 }),
    },
    {
      column_name: 'district_city',
      verbose_name: 'District',
      extra: JSON.stringify({ dhis2_is_ou_hierarchy: true, dhis2_ou_level: 3 }),
    },
    { column_name: 'period', verbose_name: 'Period' },
    { column_name: 'quarter', verbose_name: 'Quarter' },
    { column_name: 'month', verbose_name: 'Month' },
  ];

  test('detects OU hierarchy presets from metadata', () => {
    const presets = detectAvailablePresets(DHIS2_COLUMNS);
    const keys = presets.map(p => p.presetKey);
    expect(keys).toContain('by_national');
    expect(keys).toContain('by_region');
    expect(keys).toContain('by_district');
  });

  test('detects period presets from column names', () => {
    const presets = detectAvailablePresets(DHIS2_COLUMNS);
    const keys = presets.map(p => p.presetKey);
    expect(keys).toContain('by_period_monthly');
    expect(keys).toContain('by_period_quarterly');
  });

  test('resolves preset to correct column name', () => {
    const dataColumns = ['national', 'region', 'district_city', 'period', 'month', 'quarter'];
    expect(resolvePresetColumn('by_region', DHIS2_COLUMNS, dataColumns)).toBe('region');
    expect(resolvePresetColumn('by_district', DHIS2_COLUMNS, dataColumns)).toBe('district_city');
    expect(resolvePresetColumn('by_period_monthly', DHIS2_COLUMNS, dataColumns)).toBe('month');
  });

  test('returns null for custom preset', () => {
    expect(resolvePresetColumn('custom', DHIS2_COLUMNS, [])).toBeNull();
  });

  test('returns null when column not in data', () => {
    expect(resolvePresetColumn('by_facility', DHIS2_COLUMNS, ['region'])).toBeNull();
  });

  test('DHIS2 preset splits data via transformProps', () => {
    const dhis2Data = [
      { region: 'Central', month: 'Jan', cases: 100 },
      { region: 'Central', month: 'Feb', cases: 110 },
      { region: 'Western', month: 'Jan', cases: 80 },
      { region: 'Western', month: 'Feb', cases: 90 },
    ];

    const result = transformProps(
      makeChartProps({
        data: dhis2Data,
        formData: {
          dhis2_split_preset: 'by_region',
          groupby: ['should_be_ignored'],
          x_axis: ['month'],
          metrics: [{ label: 'cases' }],
        },
        datasource: { columns: DHIS2_COLUMNS },
      }),
    );

    expect(result.panels).toHaveLength(2);
    const titles = result.panels.map(p => p.title).sort();
    expect(titles).toEqual(['Central', 'Western']);
  });
});
