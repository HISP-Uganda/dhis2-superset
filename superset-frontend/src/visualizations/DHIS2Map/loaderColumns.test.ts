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
  resolveLoaderDimensionColumnName,
  resolveLoaderMetricColumnName,
  resolveQueryDimensionColumnName,
  resolveQueryMetricColumnName,
} from './loaderColumns';

describe('DHIS2Map loaderColumns', () => {
  test('maps staged hierarchy columns to preview ou_level columns', () => {
    expect(
      resolveLoaderDimensionColumnName({
        requestedColumn: 'district_city',
        datasourceColumns: [
          {
            column_name: 'district_city',
            extra: JSON.stringify({ dhis2_ou_level: 3 }),
          },
        ],
        availableColumns: ['ou_level_1', 'ou_level_2', 'ou_level_3', 'period'],
      }),
    ).toBe('ou_level_3');
  });

  test('maps staged metric columns to loader de_* columns via variable id', () => {
    expect(
      resolveLoaderMetricColumnName({
        metric: 'SUM(c_cases)',
        datasourceColumns: [
          {
            column_name: 'c_cases',
            extra: JSON.stringify({ dhis2_variable_id: 'JhvC7ZR9hUe' }),
          },
        ],
        loaderColumns: [
          {
            title: 'Cases',
            dataIndex: 'de_JhvC7ZR9hUe',
            de_id: 'JhvC7ZR9hUe',
          },
        ],
        availableColumns: ['ou_level_2', 'period', 'de_JhvC7ZR9hUe'],
      }),
    ).toBe('de_JhvC7ZR9hUe');
  });

  test('supports prefixed staged variable ids when preview columns use de_id metadata', () => {
    expect(
      resolveLoaderMetricColumnName({
        metric: 'anc_1st_visit',
        datasourceColumns: [
          {
            column_name: 'anc_1st_visit',
            extra: JSON.stringify({ dhis2_variable_id: 'de_anc' }),
          },
        ],
        loaderColumns: [
          {
            title: 'ANC 1st Visit',
            dataIndex: 'de_de_anc',
            de_id: 'de_anc',
          },
        ],
        availableColumns: ['ou_level_1', 'period', 'de_de_anc'],
      }),
    ).toBe('de_de_anc');
  });

  test('maps staged hierarchy columns to verbose query result labels', () => {
    expect(
      resolveQueryDimensionColumnName({
        requestedColumn: 'district_city',
        datasourceColumns: [
          {
            column_name: 'district_city',
            verbose_name: 'District/City',
            extra: JSON.stringify({ dhis2_ou_level: 3 }),
          },
        ],
        availableColumns: ['District/City', 'Malaria Total'],
      }),
    ).toBe('District/City');
  });

  test('maps staged metric columns to verbose query result labels', () => {
    expect(
      resolveQueryMetricColumnName({
        metric: 'SUM(c_105_ep01b_malaria_tested_b_s_rdt)',
        datasourceColumns: [
          {
            column_name: 'c_105_ep01b_malaria_tested_b_s_rdt',
            verbose_name: '105-EP01b. Malaria Tested (B/s & RDT )',
          },
        ],
        availableColumns: [
          'District/City',
          '105-EP01b. Malaria Tested (B/s & RDT )',
        ],
        rows: [
          {
            'District/City': 'Gulu City',
            '105-EP01b. Malaria Tested (B/s & RDT )': 979,
          },
        ],
      }),
    ).toBe('105-EP01b. Malaria Tested (B/s & RDT )');
  });

  test('maps aggregated verbose metric labels when query rows keep the aggregate alias', () => {
    expect(
      resolveQueryMetricColumnName({
        metric: 'SUM(c_cases)',
        datasourceColumns: [
          {
            column_name: 'c_cases',
            verbose_name: 'Cases',
          },
        ],
        availableColumns: ['Region', 'SUM(Cases)'],
        rows: [
          {
            Region: 'Acholi',
            'SUM(Cases)': 51380,
          },
        ],
      }),
    ).toBe('SUM(Cases)');
  });
});
