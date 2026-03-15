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

import {
  buildFocusedStagedLocalAggregateQuery,
  buildFocusedStagedLocalQueryFilters,
  buildHierarchyColumns,
  buildTerminalHierarchyQueryFilters,
  serializeStagedLocalQueryFilters,
} from './stagedLocalFilters';

describe('DHIS2Map stagedLocalFilters', () => {
  test('builds hierarchy columns in level order', () => {
    expect(
      buildHierarchyColumns({
        4: 'dlg_municipality_city_council',
        2: 'region',
        3: 'district_city',
      }),
    ).toEqual(['region', 'district_city', 'dlg_municipality_city_council']);
  });

  test('builds terminal hierarchy filters for the selected child column', () => {
    expect(
      buildTerminalHierarchyQueryFilters({
        selectedColumn: 'district_city',
        hierarchyColumns: ['region', 'district_city', 'dlg_municipality_city_council'],
      }),
    ).toEqual([
      {
        column: 'district_city',
        operator: 'not_empty',
      },
      {
        column: 'dlg_municipality_city_council',
        operator: 'is_empty',
      },
    ]);
  });

  test('combines parent, active, and terminal focused filters', () => {
    const filters = buildFocusedStagedLocalQueryFilters({
      parentSelectionColumn: 'region',
      parentValues: ['Acholi'],
      activeFilters: [
        { col: 'period', op: 'IN', val: ['202503'] },
        { col: 'district_city', op: '!=', val: 'Unknown' },
      ],
      selectedOrgUnitColumn: 'district_city',
      hierarchyColumns: ['region', 'district_city', 'dlg_municipality_city_council'],
    });

    expect(filters).toEqual([
      {
        column: 'period',
        operator: 'in',
        value: ['202503'],
      },
      {
        column: 'district_city',
        operator: 'neq',
        value: 'Unknown',
      },
      {
        column: 'region',
        operator: 'in',
        value: ['Acholi'],
      },
      {
        column: 'district_city',
        operator: 'not_empty',
      },
      {
        column: 'dlg_municipality_city_council',
        operator: 'is_empty',
      },
    ]);

    expect(serializeStagedLocalQueryFilters(filters)).toBe(
      '[{"column":"period","operator":"in","value":["202503"]},{"column":"district_city","operator":"neq","value":"Unknown"},{"column":"region","operator":"in","value":["Acholi"]},{"column":"district_city","operator":"not_empty"},{"column":"dlg_municipality_city_council","operator":"is_empty"}]',
    );
  });

  test('builds a grouped aggregate query for focused staged-local maps', () => {
    expect(
      buildFocusedStagedLocalAggregateQuery({
        aggregationMethod: 'sum',
        metric: 'SUM(c_105_ep01b_malaria_tested_b_s_rdt)',
        selectedOrgUnitColumn: 'district_city',
        parentSelectionColumn: 'region',
        tooltipColumns: ['dhis2_instance', 'period'],
        datasourceColumns: [
          { column_name: 'period', extra: '{"dhis2_is_period": true}' },
          { column_name: 'district_city' },
          { column_name: 'region' },
          { column_name: 'dhis2_instance' },
        ],
      }),
    ).toEqual({
      aggregationMethod: 'sum',
      groupByColumns: ['region', 'district_city', 'dhis2_instance'],
      metricColumn: 'c_105_ep01b_malaria_tested_b_s_rdt',
      metricAlias: 'SUM(c_105_ep01b_malaria_tested_b_s_rdt)',
    });
  });

  test('skips grouped aggregation for latest mode', () => {
    expect(
      buildFocusedStagedLocalAggregateQuery({
        aggregationMethod: 'latest',
        metric: 'c_105_ep01b_malaria_tested_b_s_rdt',
        selectedOrgUnitColumn: 'district_city',
      }),
    ).toBeNull();
  });
});
