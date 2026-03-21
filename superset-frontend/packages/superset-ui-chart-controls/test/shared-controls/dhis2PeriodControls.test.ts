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
  buildDhis2PeriodFilterEndpoint,
  getDhis2PeriodFilterChoices,
  resolveDhis2PeriodColumnName,
  resolveDhis2StagedDatasetId,
} from '../../src/shared-controls/dhis2PeriodControls';

describe('dhis2PeriodControls', () => {
  it('prefers the staged period column marker from datasource metadata', () => {
    expect(
      resolveDhis2PeriodColumnName({
        columns: [
          { column_name: 'region' },
          { column_name: 'reporting_period', extra: { dhis2_is_period: true } },
        ],
      }),
    ).toBe('reporting_period');
  });

  it('falls back to the conventional period column name', () => {
    expect(
      resolveDhis2PeriodColumnName({
        columns: [{ column_name: 'period' }],
      }),
    ).toBe('period');
  });

  it('resolves the staged dataset id from datasource extra metadata', () => {
    expect(
      resolveDhis2StagedDatasetId({
        extra: { dhis2_staged_dataset_id: 11 },
      }),
    ).toBe(11);
  });

  it('resolves the staged dataset id from serving-table SQL', () => {
    expect(
      resolveDhis2StagedDatasetId({
        sql: 'SELECT * FROM dhis2_staging.sv_42_hmis_test',
      }),
    ).toBe(42);
    expect(
      resolveDhis2StagedDatasetId({
        sql: 'SELECT * FROM "dhis2_serving"."sv_7_ep_malaria"',
      }),
    ).toBe(7);
  });

  it('builds the staged local period endpoint from datasource context', () => {
    expect(
      buildDhis2PeriodFilterEndpoint({
        sql: 'SELECT * FROM sv_42_hmis_test',
      }),
    ).toBe('/api/v1/dhis2/staged-datasets/42/filters');
  });

  it('normalizes staged period options for the async select control', () => {
    expect(
      getDhis2PeriodFilterChoices({
        result: {
          period_filter: {
            options: [
              { label: '2025-03', value: '202503' },
              { label: '2025-02', value: '202502' },
              { label: '2025-03', value: '202503' },
            ],
          },
        },
      }),
    ).toEqual([
      ['202503', '2025-03'],
      ['202502', '2025-02'],
    ]);
  });
});
