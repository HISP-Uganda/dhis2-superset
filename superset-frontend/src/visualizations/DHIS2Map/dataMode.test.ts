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
  getStagedDatasetIdFromSql,
  hasDHIS2SqlComment,
  hasStagedLocalServingSql,
  resolveDisplayedBoundaries,
  resolveDHIS2MapData,
  shouldLoadStagedLocalFocusData,
  shouldResolveDHIS2DatasetSql,
  shouldUseDHIS2LoaderData,
} from './dataMode';

describe('DHIS2Map dataMode', () => {
  test('detects DHIS2 SQL comments', () => {
    expect(
      hasDHIS2SqlComment('SELECT * FROM table /* DHIS2: dx=a&pe=b&ou=c */'),
    ).toBe(true);
    expect(hasDHIS2SqlComment('SELECT * FROM table')).toBe(false);
  });

  test('detects staged-local serving SQL and extracts the staged dataset id', () => {
    const sql = 'SELECT * FROM sv_4_test_test_ds';
    expect(hasStagedLocalServingSql(sql)).toBe(true);
    expect(getStagedDatasetIdFromSql(sql)).toBe(4);
    expect(hasStagedLocalServingSql('SELECT * FROM table')).toBe(false);
    expect(getStagedDatasetIdFromSql('SELECT * FROM table')).toBeUndefined();
  });

  test('prefers loader mode only when the SQL already carries DHIS2 params', () => {
    expect(
      shouldUseDHIS2LoaderData({
        databaseId: 2,
        datasetSql: 'SELECT * FROM table /* DHIS2: dx=a&pe=b&ou=c */',
      }),
    ).toBe(true);

    expect(
      shouldUseDHIS2LoaderData({
        databaseId: 2,
        datasetSql: 'SELECT * FROM table',
      }),
    ).toBe(false);

    expect(
      shouldUseDHIS2LoaderData({
        databaseId: 2,
        datasetSql: '',
      }),
    ).toBe(false);

    expect(
      shouldUseDHIS2LoaderData({
        databaseId: 2,
        datasetSql: 'SELECT * FROM table /* DHIS2: dx=a&pe=b&ou=c */',
        isStagedLocalDataset: true,
      }),
    ).toBe(false);
  });

  test('resolves staged-local dataset SQL when source context exists but params are missing', () => {
    expect(
      shouldResolveDHIS2DatasetSql({
        datasetId: 7,
        datasetSql: '',
        isDHIS2Dataset: true,
        databaseId: 2,
        sourceInstanceIds: [101, 102],
      }),
    ).toBe(true);

    expect(
      shouldResolveDHIS2DatasetSql({
        datasetId: 7,
        datasetSql: 'SELECT * FROM table /* DHIS2: dx=a&pe=b&ou=c */',
        isDHIS2Dataset: true,
        databaseId: 2,
        sourceInstanceIds: [101, 102],
      }),
    ).toBe(false);

    expect(
      shouldResolveDHIS2DatasetSql({
        datasetSql: '',
        isDHIS2Dataset: true,
        databaseId: 2,
        sourceInstanceIds: [101, 102],
      }),
    ).toBe(false);

    expect(
      shouldResolveDHIS2DatasetSql({
        datasetId: 7,
        datasetSql: '',
        isDHIS2Dataset: true,
        isStagedLocalDataset: true,
        databaseId: 2,
        sourceInstanceIds: [101, 102],
      }),
    ).toBe(false);
  });

  test('ignores placeholder chart rows when loader mode is active', () => {
    const chartRows = [{ district_city: 'Gulu City', 'SUM(c_cases)': 10 }];

    expect(resolveDHIS2MapData(chartRows, null, true)).toEqual([]);
    expect(resolveDHIS2MapData(chartRows, [{ district_city: 'Kitgum' }], true))
      .toEqual([{ district_city: 'Kitgum' }]);
    expect(resolveDHIS2MapData(chartRows, null, false)).toEqual(chartRows);
  });

  test('keeps boundaries visible for no-data renders when show-all is off', () => {
    const boundaries = [{ id: 'a' }, { id: 'b' }];

    expect(
      resolveDisplayedBoundaries({
        boundaries,
        selectedBoundaryIds: new Set(),
        showAllBoundaries: false,
      }),
    ).toEqual(boundaries);

    expect(
      resolveDisplayedBoundaries({
        boundaries,
        selectedBoundaryIds: new Set(['b']),
        showAllBoundaries: false,
      }),
    ).toEqual([{ id: 'b' }]);
  });

  test('loads staged-local focus rows when the saved chart payload lacks child columns', () => {
    expect(
      shouldLoadStagedLocalFocusData({
        isStagedLocalDataset: true,
        stagedDatasetId: 4,
        focusSelectedBoundaryWithChildren: true,
        focusedChildLevel: 4,
        chartRows: [{ region: 'Acholi', c_cases: 10 }],
        requestedChildColumn: 'district_city',
        requestedMetric: 'c_cases',
        datasourceColumns: [
          { column_name: 'region' },
          { column_name: 'district_city' },
          { column_name: 'c_cases' },
        ],
      }),
    ).toBe(true);
  });

  test('skips staged-local focus fallback when chart rows already contain child data', () => {
    expect(
      shouldLoadStagedLocalFocusData({
        isStagedLocalDataset: true,
        stagedDatasetId: 4,
        focusSelectedBoundaryWithChildren: true,
        focusedChildLevel: 4,
        chartRows: [{ region: 'Acholi', district_city: 'Gulu City', c_cases: 10 }],
        requestedChildColumn: 'district_city',
        requestedMetric: 'c_cases',
        datasourceColumns: [
          { column_name: 'region' },
          { column_name: 'district_city' },
          { column_name: 'c_cases' },
        ],
        hierarchyColumns: ['region', 'district_city', 'dlg_municipality_city_council'],
      }),
    ).toBe(false);
  });

  test('loads staged-local focus rows when chart rows still include deeper hierarchy values', () => {
    expect(
      shouldLoadStagedLocalFocusData({
        isStagedLocalDataset: true,
        stagedDatasetId: 4,
        focusSelectedBoundaryWithChildren: true,
        focusedChildLevel: 3,
        chartRows: [
          {
            region: 'Acholi',
            district_city: 'Kitgum District',
            dlg_municipality_city_council: 'Kitgum Municipality',
            c_cases: 10,
          },
        ],
        requestedChildColumn: 'district_city',
        requestedMetric: 'c_cases',
        datasourceColumns: [
          { column_name: 'region' },
          { column_name: 'district_city' },
          { column_name: 'dlg_municipality_city_council' },
          { column_name: 'c_cases' },
        ],
        hierarchyColumns: ['region', 'district_city', 'dlg_municipality_city_council'],
      }),
    ).toBe(true);
  });
});
