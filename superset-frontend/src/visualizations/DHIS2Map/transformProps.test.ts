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
    expect(result.sourceInstanceIds).toEqual([101, 102]);
    expect(result.isDHIS2Dataset).toBe(true);
    expect(result.chartId).toBe(77);
    expect(result.dashboardId).toBe(11);
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
    expect(result.boundaryLevelLabels).toEqual({ 2: 'region' });
    expect(result.orgUnitColumn).toBe('region');
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
});
