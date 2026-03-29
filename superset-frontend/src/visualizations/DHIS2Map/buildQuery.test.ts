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
import buildQuery from './buildQuery';

describe('DHIS2Map buildQuery', () => {
  test('keeps staged-local datasets on the serving-table query path', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'SUM(c_105_ep01b_2019_malaria_total)',
      org_unit_column: 'district_city',
      granularity_sqla: 'period',
      tooltip_columns: ['region'],
      dhis2_staged_local_dataset: 'true',
      dhis2_hierarchy_columns: [
        'national',
        'region',
        'district_city',
        'dlg_municipality_city_council',
      ],
    } as any);

    expect(queryContext.queries).toHaveLength(1);
    const [query] = queryContext.queries;
    expect(query.is_dhis2).toBeUndefined();
    expect(query.metrics).toEqual([
      {
        expressionType: 'SQL',
        sqlExpression: 'SUM(c_105_ep01b_2019_malaria_total)',
        label: 'SUM(c_105_ep01b_2019_malaria_total)',
      },
    ]);
    expect(query.groupby).toEqual([
      'national',
      'region',
      'district_city',
      'dlg_municipality_city_council',
      'period',
    ]);
    expect(query.extras).toMatchObject({
      dhis2_selected_org_unit_column: 'district_city',
    });
    expect(query.row_limit).toBe(10000);
  });

  test('uses the child OU column as the terminal filter for focused child-boundary maps', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'SUM(c_105_ep01b_malaria_tested_b_s_rdt)',
      org_unit_column: 'region',
      focus_selected_boundary_with_children: true,
      dhis2_staged_local_dataset: 'true',
      dhis2_hierarchy_columns: [
        'national',
        'region',
        'district_city',
        'dlg_municipality_city_council',
      ],
    } as any);

    expect(queryContext.queries).toHaveLength(1);
    const [query] = queryContext.queries;
    expect(query.groupby).toEqual([
      'national',
      'region',
      'district_city',
      'dlg_municipality_city_council',
    ]);
    expect(query.metrics).toEqual([
      {
        expressionType: 'SQL',
        sqlExpression: 'SUM(c_105_ep01b_malaria_tested_b_s_rdt)',
        label: 'SUM(c_105_ep01b_malaria_tested_b_s_rdt)',
      },
    ]);
    expect(query.extras).toMatchObject({
      dhis2_selected_org_unit_column: 'district_city',
    });
  });

  test('keeps the selected OU column when focus mode is already at the deepest hierarchy level', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'SUM(c_105_ep01b_malaria_tested_b_s_rdt)',
      org_unit_column: 'dlg_municipality_city_council',
      focus_selected_boundary_with_children: true,
      dhis2_staged_local_dataset: 'true',
      dhis2_hierarchy_columns: [
        'national',
        'region',
        'district_city',
        'dlg_municipality_city_council',
      ],
    } as any);

    const [query] = queryContext.queries;
    expect(query.extras).toMatchObject({
      dhis2_selected_org_unit_column: 'dlg_municipality_city_council',
    });
  });

  test('uses the next child OU column dynamically for district to dlg focus maps', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'SUM(c_105_ep01b_malaria_tested_b_s_rdt)',
      org_unit_column: 'district_city',
      focus_selected_boundary_with_children: true,
      dhis2_staged_local_dataset: 'true',
      dhis2_hierarchy_columns: [
        'national',
        'region',
        'district_city',
        'dlg_municipality_city_council',
      ],
    } as any);

    const [query] = queryContext.queries;
    expect(query.extras).toMatchObject({
      dhis2_selected_org_unit_column: 'dlg_municipality_city_council',
    });
  });

  test('keeps raw metric rows only for latest aggregation', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'c_105_ep01b_malaria_tested_b_s_rdt',
      org_unit_column: 'district_city',
      aggregation_method: 'latest',
      dhis2_staged_local_dataset: 'true',
      dhis2_hierarchy_columns: [
        'national',
        'region',
        'district_city',
        'dlg_municipality_city_council',
      ],
    } as any);

    const [query] = queryContext.queries;
    expect(query.metrics).toEqual([]);
    expect(query.groupby).toEqual([
      'national',
      'region',
      'district_city',
      'dlg_municipality_city_council',
      'c_105_ep01b_malaria_tested_b_s_rdt',
    ]);
  });

  test('keeps raw metric rows for none aggregation', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'c_105_ep01b_malaria_tested_b_s_rdt',
      org_unit_column: 'district_city',
      aggregation_method: 'none',
      dhis2_staged_local_dataset: 'true',
      dhis2_hierarchy_columns: [
        'national',
        'region',
        'district_city',
        'dlg_municipality_city_council',
      ],
    } as any);

    const [query] = queryContext.queries;
    expect(query.metrics).toEqual([]);
    expect(query.groupby).toEqual([
      'national',
      'region',
      'district_city',
      'dlg_municipality_city_council',
      'c_105_ep01b_malaria_tested_b_s_rdt',
    ]);
  });

  test('defaults unsaved legacy maps to the serving-table query path', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'SUM(c_105_ep01b_2019_malaria_total)',
      org_unit_column: 'district_city',
      boundary_levels: [3],
    } as any);

    expect(queryContext.queries).toHaveLength(1);
    const [query] = queryContext.queries;
    expect(query.is_dhis2).toBeUndefined();
    expect(query.metrics).toEqual([
      {
        expressionType: 'SQL',
        sqlExpression: 'SUM(c_105_ep01b_2019_malaria_total)',
        label: 'SUM(c_105_ep01b_2019_malaria_total)',
      },
    ]);
    expect(query.groupby).toEqual([
      'district_city',
    ]);
    expect(query.extras).toMatchObject({
      dhis2_selected_org_unit_column: 'district_city',
    });
    expect(query.row_limit).toBe(10000);
  });

  test('adds IS NOT NULL filter on terminal hierarchy column for staged datasets (fixes No Data bug)', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'SUM(malaria_cases)',
      org_unit_column: 'district_city',
      dhis2_staged_local_dataset: 'true',
      dhis2_hierarchy_columns: ['national', 'region', 'district_city'],
      // filter_null_ou_column defaults to true when not set
    } as any);

    const [query] = queryContext.queries;
    const nullExclusionFilter = (query.filters || []).find(
      (f: any) => f.op === 'IS NOT NULL',
    );
    expect(nullExclusionFilter).toBeDefined();
    expect(nullExclusionFilter?.col).toBe('district_city');
  });

  test('does NOT add IS NOT NULL filter when filter_null_ou_column is false', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'SUM(malaria_cases)',
      org_unit_column: 'district_city',
      dhis2_staged_local_dataset: 'true',
      dhis2_hierarchy_columns: ['national', 'region', 'district_city'],
      filter_null_ou_column: false,
    } as any);

    const [query] = queryContext.queries;
    const nullExclusionFilter = (query.filters || []).find(
      (f: any) => f.op === 'IS NOT NULL',
    );
    expect(nullExclusionFilter).toBeUndefined();
  });

  test('uses child OU column for IS NOT NULL filter in focus-with-children mode', () => {
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'SUM(malaria_cases)',
      org_unit_column: 'region',
      focus_selected_boundary_with_children: true,
      dhis2_staged_local_dataset: 'true',
      dhis2_hierarchy_columns: ['national', 'region', 'district_city'],
    } as any);

    const [query] = queryContext.queries;
    const nullExclusionFilter = (query.filters || []).find(
      (f: any) => f.op === 'IS NOT NULL',
    );
    expect(nullExclusionFilter).toBeDefined();
    // Focus mode: terminal column is one level below 'region' → 'district_city'
    expect(nullExclusionFilter?.col).toBe('district_city');
  });

  test('does NOT add IS NOT NULL filter when no hierarchy columns are configured', () => {
    // Non-hierarchy map (plain datasource): null filter must not be injected
    const queryContext = buildQuery({
      datasource: '4__table',
      viz_type: 'dhis2_map',
      metric: 'SUM(malaria_cases)',
      org_unit_column: 'district_city',
      dhis2_staged_local_dataset: 'true',
      // no dhis2_hierarchy_columns
    } as any);

    const [query] = queryContext.queries;
    const nullExclusionFilter = (query.filters || []).find(
      (f: any) => f.op === 'IS NOT NULL',
    );
    expect(nullExclusionFilter).toBeUndefined();
  });
});
