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
  hasDHIS2SqlComment,
  resolveDisplayedBoundaries,
  resolveDHIS2MapData,
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
});
