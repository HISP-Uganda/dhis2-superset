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

describe('DHIS2Map transformProps', () => {
  test('falls back to camelCase orgUnitColumn when dashboard hydration omits snake_case', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'mal_test_positivity_rate',
        orgUnitColumn: 'district_city',
        boundaryLevels: [3],
        tooltipColumns: [],
      },
      queriesData: [
        {
          data: [
            {
              district_city: 'Abim District',
              mal_test_positivity_rate: 14.3,
            },
          ],
        },
      ],
      datasource: {
        id: 19,
        database: { id: 4 },
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 5,
          dhis2_source_instance_ids: [4],
        }),
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.orgUnitColumn).toBe('district_city');
    expect(result.boundaryLevels).toEqual([3]);
  });

  test('uses dhis2_source_database_id for staged-local datasets', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'c_cases',
        org_unit_column: 'region',
        boundary_levels: [2],
        tooltip_columns: [],
        slice_id: 77,
        dashboard_id: 11,
      },
      queriesData: [
        {
          data: [
            {
              region: 'Acholi',
              period: '202401',
              c_cases: 10,
            },
          ],
        },
      ],
      datasource: {
        id: 4,
        database: { id: 3 },
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_staged_dataset_id: 4,
          dhis2_source_database_id: 2,
          dhis2_source_instance_ids: [101, 102],
          dhis2_serving_database_id: 3,
        }),
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.databaseId).toBe(2);
    expect(result.isStagedLocalDataset).toBe(true);
    expect(result.stagedDatasetId).toBe(4);
    expect(result.sourceInstanceIds).toEqual([101, 102]);
    expect(result.isDHIS2Dataset).toBe(true);
    expect(result.chartId).toBe(77);
    expect(result.dashboardId).toBe(11);
    expect(result.datasourceColumns).toEqual([]);
    expect(result.orgUnitColumn).toBe('region');
    expect(result.metric).toBe('c_cases');
  });

  test('keeps the selected OU column level as the primary boundary level', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'c_cases',
        org_unit_column: 'region',
        boundary_levels: [3],
        tooltip_columns: [],
      },
      queriesData: [
        {
          data: [
            {
              region: 'Acholi',
              period: '202401',
              c_cases: 10,
            },
          ],
        },
      ],
      datasource: {
        id: 4,
        database: { id: 3 },
        columns: [
          {
            column_name: 'region',
            extra: JSON.stringify({
              dhis2_is_ou_hierarchy: true,
              dhis2_ou_level: 2,
            }),
          },
          {
            column_name: 'district_city',
            extra: JSON.stringify({
              dhis2_is_ou_hierarchy: true,
              dhis2_ou_level: 3,
            }),
          },
          {
            column_name: 'c_cases',
          },
        ],
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 2,
          dhis2_source_instance_ids: [101, 102],
          dhis2_serving_database_id: 3,
        }),
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.primaryBoundaryLevel).toBe(2);
    expect(result.boundaryLevels).toEqual([2, 3]);
    expect(result.boundaryLevelLabels).toEqual({
      2: 'region',
      3: 'district_city',
    });
    expect(result.boundaryLevelColumns).toEqual({
      2: 'region',
      3: 'district_city',
    });
    expect(result.orgUnitColumn).toBe('region');
  });

  test('infers legacy MART hierarchy levels from ordered hierarchy columns when explicit levels are missing', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'mal_testing_rate',
        org_unit_column: 'district_city',
        boundary_levels: [3],
        tooltip_columns: [],
      },
      queriesData: [
        {
          data: [
            {
              district_city: 'Abim District',
              mal_testing_rate: 114.3,
            },
          ],
        },
      ],
      datasource: {
        id: 19,
        database: { id: 4 },
        columns: [
          {
            column_name: 'national',
            verbose_name: 'National',
            extra: JSON.stringify({ dhis2_is_ou_hierarchy: true }),
          },
          {
            column_name: 'region',
            verbose_name: 'Region',
            extra: JSON.stringify({ dhis2_is_ou_hierarchy: true }),
          },
          {
            column_name: 'district_city',
            verbose_name: 'District City',
            extra: JSON.stringify({ dhis2_is_ou_hierarchy: true }),
          },
          {
            column_name: 'mal_testing_rate',
            extra: JSON.stringify({ dhis2_variable_type: 'indicator' }),
          },
        ],
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 5,
          dhis2_source_instance_ids: [4],
        }),
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.primaryBoundaryLevel).toBe(3);
    expect(result.boundaryLevels).toEqual([3]);
    expect(result.boundaryLevelColumns).toEqual({
      1: 'national',
      2: 'region',
      3: 'district_city',
    });
    expect(result.orgUnitColumn).toBe('district_city');
  });

  test('ignores mis-tagged legacy helper columns when resolving the primary boundary level', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'mal_testing_rate',
        org_unit_column: 'district_city',
        boundary_levels: [4],
        tooltip_columns: [],
      },
      queriesData: [
        {
          data: [
            {
              district_city: 'Abim District',
              mal_testing_rate: 114.3,
            },
          ],
        },
      ],
      datasource: {
        id: 19,
        database: { id: 4 },
        columns: [
          {
            column_name: 'period_variant',
            verbose_name: 'Period Variant',
            extra: JSON.stringify({ dhis2_is_ou_hierarchy: true }),
          },
          {
            column_name: 'national',
            verbose_name: 'National',
            extra: JSON.stringify({ dhis2_is_ou_hierarchy: true }),
          },
          {
            column_name: 'region',
            verbose_name: 'Region',
            extra: JSON.stringify({ dhis2_is_ou_hierarchy: true }),
          },
          {
            column_name: 'district_city',
            verbose_name: 'District City',
            extra: JSON.stringify({ dhis2_is_ou_hierarchy: true }),
          },
          {
            column_name: 'mal_testing_rate',
            extra: JSON.stringify({ dhis2_variable_type: 'indicator' }),
          },
        ],
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 5,
          dhis2_source_instance_ids: [4],
        }),
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.primaryBoundaryLevel).toBe(3);
    expect(result.boundaryLevels).toEqual([3, 4]);
    expect(result.boundaryLevelColumns).toEqual({
      1: 'national',
      2: 'region',
      3: 'district_city',
    });
    expect(result.ouHierarchyColumns).toEqual(['district_city']);
  });

  test('normalizes legacy default categorical color settings to sequential map colors', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'mal_testing_rate',
        org_unit_column: 'district_city',
        boundary_levels: [3],
        color_scheme: 'supersetColors',
        linear_color_scheme: 'blue_white_yellow',
        use_linear_color_scheme: false,
        legend_type: 'auto',
        tooltip_columns: [],
      },
      queriesData: [
        {
          data: [
            {
              district_city: 'Abim District',
              mal_testing_rate: 114.3,
            },
          ],
        },
      ],
      datasource: {
        id: 19,
        database: { id: 4 },
        columns: [
          {
            column_name: 'district_city',
            extra: JSON.stringify({ dhis2_is_ou_hierarchy: true }),
          },
          {
            column_name: 'mal_testing_rate',
          },
        ],
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 5,
          dhis2_source_instance_ids: [4],
        }),
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.useLinearColorScheme).toBe(true);
    expect(result.linearColorScheme).toBe('blue_white_yellow');
  });

  test('extracts staged DHIS2 legend metadata from the selected metric column', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'SUM(c_cases)',
        org_unit_column: 'region',
        boundary_levels: [2],
        tooltip_columns: [],
      },
      queriesData: [
        {
          data: [
            {
              region: 'Acholi',
              period: '202401',
              c_cases: 10,
            },
          ],
        },
      ],
      datasource: {
        id: 4,
        database: { id: 3 },
        columns: [
          {
            column_name: 'region',
            extra: JSON.stringify({
              dhis2_is_ou_hierarchy: true,
              dhis2_ou_level: 2,
            }),
          },
          {
            column_name: 'c_cases',
            extra: JSON.stringify({
              dhis2_legend: {
                source: 'dhis2',
                setId: 'legend_set_1',
                setName: 'Malaria Burden',
                min: 0,
                max: 500,
                items: [
                  {
                    id: 'legend_1',
                    label: 'Normal',
                    startValue: 0,
                    endValue: 100,
                    color: '#2ca25f',
                  },
                ],
              },
            }),
          },
        ],
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 2,
          dhis2_source_instance_ids: [101],
          dhis2_serving_database_id: 3,
        }),
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.stagedLegendDefinition?.setName).toBe('Malaria Burden');
    expect(result.stagedLegendDefinition?.items[0].color).toBe('#2ca25f');
  });

  test('uses the explicitly selected staged legend column when provided', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'SUM(c_cases)',
        org_unit_column: 'region',
        boundary_levels: [2],
        legend_type: 'staged',
        staged_legend_column: 'c_admissions',
        tooltip_columns: [],
      },
      queriesData: [
        {
          data: [
            {
              region: 'Acholi',
              period: '202401',
              c_cases: 10,
              c_admissions: 4,
            },
          ],
        },
      ],
      datasource: {
        id: 4,
        database: { id: 3 },
        columns: [
          {
            column_name: 'region',
            extra: JSON.stringify({
              dhis2_is_ou_hierarchy: true,
              dhis2_ou_level: 2,
            }),
          },
          {
            column_name: 'c_cases',
            extra: JSON.stringify({
              dhis2_legend: {
                setName: 'Cases Legend',
                items: [{ startValue: 0, endValue: 10, color: '#2ca25f' }],
              },
            }),
          },
          {
            column_name: 'c_admissions',
            extra: JSON.stringify({
              dhis2_legend: {
                setName: 'Admissions Legend',
                items: [{ startValue: 0, endValue: 5, color: '#de2d26' }],
              },
            }),
          },
        ],
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 2,
        }),
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.stagedLegendDefinition?.setName).toBe('Admissions Legend');
    expect(result.stagedLegendDefinition?.items[0].color).toBe('#de2d26');
  });

  test('resolves a selected staged legend set from cached staged metadata', () => {
    window.localStorage.setItem(
      'dhis2_legend_sets_db2',
      JSON.stringify({
        data: [
          {
            id: 'legend_set_99',
            displayName: 'Incidence Legend',
            legendDefinition: {
              source: 'dhis2',
              setId: 'legend_set_99',
              setName: 'Incidence Legend',
              min: 0,
              max: 100,
              items: [
                {
                  id: 'legend_low',
                  label: 'Low',
                  startValue: 0,
                  endValue: 50,
                  color: '#2ca25f',
                },
                {
                  id: 'legend_high',
                  label: 'High',
                  startValue: 50,
                  endValue: 100,
                  color: '#de2d26',
                },
              ],
            },
          },
        ],
        timestamp: Date.now(),
      }),
    );

    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'SUM(c_cases)',
        org_unit_column: 'region',
        boundary_levels: [2],
        legend_type: 'staged',
        staged_legend_column: 'legendset:legend_set_99',
        tooltip_columns: [],
      },
      queriesData: [
        {
          data: [
            {
              region: 'Acholi',
              period: '202401',
              c_cases: 10,
            },
          ],
        },
      ],
      datasource: {
        id: 4,
        database: { id: 3 },
        columns: [
          {
            column_name: 'region',
            extra: JSON.stringify({
              dhis2_is_ou_hierarchy: true,
              dhis2_ou_level: 2,
            }),
          },
          {
            column_name: 'c_cases',
          },
        ],
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 2,
          dhis2_source_instance_ids: [101],
          dhis2_serving_database_id: 3,
        }),
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.stagedLegendDefinition?.setId).toBe('legend_set_99');
    expect(result.stagedLegendDefinition?.items[1].color).toBe('#de2d26');

    window.localStorage.removeItem('dhis2_legend_sets_db2');
  });

  test('passes through focused sub-boundary and unselected area styling options', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        metric: 'c_cases',
        org_unit_column: 'region',
        boundary_levels: [2],
        focus_selected_boundary_with_children: true,
        show_all_boundaries: true,
        style_unselected_areas: true,
        unselected_area_fill_color: { r: 210, g: 220, b: 230, a: 1 },
        unselected_area_fill_opacity: 0.3,
        unselected_area_border_color: { r: 100, g: 110, b: 120, a: 1 },
        unselected_area_border_width: 1.25,
        tooltip_columns: [],
      },
      queriesData: [
        {
          data: [
            {
              region: 'Acholi',
              period: '202401',
              c_cases: 10,
            },
          ],
        },
      ],
      datasource: {
        id: 4,
        database: { id: 3 },
        columns: [
          {
            column_name: 'region',
            extra: JSON.stringify({
              dhis2_is_ou_hierarchy: true,
              dhis2_ou_level: 2,
            }),
          },
          {
            column_name: 'c_cases',
          },
        ],
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.focusSelectedBoundaryWithChildren).toBe(true);
    expect(result.showAllBoundaries).toBe(true);
    expect(result.styleUnselectedAreas).toBe(true);
    expect(result.unselectedAreaFillColor).toEqual({
      r: 210,
      g: 220,
      b: 230,
      a: 1,
    });
    expect(result.unselectedAreaFillOpacity).toBe(0.3);
    expect(result.unselectedAreaBorderColor).toEqual({
      r: 100,
      g: 110,
      b: 120,
      a: 1,
    });
    expect(result.unselectedAreaBorderWidth).toBe(1.25);
  });

  test('treats public dhis2 map charts as DHIS2 datasets even without dataset sql', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        viz_type: 'dhis2_map',
        metric: 'c_cases',
        org_unit_column: 'region',
        boundary_levels: [2],
        tooltip_columns: [],
        slice_id: 91,
      },
      queriesData: [{ data: [] }],
      datasource: {
        id: 4,
        database: { id: 3 },
        columns: [
          {
            column_name: 'region',
            extra: JSON.stringify({
              dhis2_is_ou_hierarchy: true,
              dhis2_ou_level: 2,
            }),
          },
        ],
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.isDHIS2Dataset).toBe(true);
    expect(result.chartId).toBe(91);
  });

  test('converts chart background colors from color picker values', () => {
    const chartProps = {
      width: 800,
      height: 600,
      formData: {
        viz_type: 'dhis2_map',
        metric: 'c_cases',
        org_unit_column: 'region',
        boundary_levels: [2],
        chart_background_color: { r: 15, g: 23, b: 42, a: 0.4 },
        tooltip_columns: [],
      },
      queriesData: [{ data: [] }],
      datasource: {
        id: 4,
        database: { id: 3 },
        columns: [
          {
            column_name: 'region',
            extra: JSON.stringify({
              dhis2_is_ou_hierarchy: true,
              dhis2_ou_level: 2,
            }),
          },
        ],
      },
      hooks: {},
      filterState: {},
    } as any;

    const result = transformProps(chartProps);

    expect(result.chartBackgroundColor).toBe('rgba(15,23,42,0.4)');
  });
});
