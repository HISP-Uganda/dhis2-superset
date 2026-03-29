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
  getDhis2LegendSetDatabaseId,
  isDirectDhis2Datasource,
} from './dhis2Datasource';

describe('getDhis2LegendSetDatabaseId', () => {
  test('returns the original source database id for staged local DHIS2 datasets', () => {
    expect(
      getDhis2LegendSetDatabaseId({
        database: { id: 4, backend: 'postgresql' },
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 5,
        }),
      }),
    ).toBe(5);
  });

  test('falls back to the active database id for direct DHIS2 connections', () => {
    expect(
      getDhis2LegendSetDatabaseId({
        database: { id: 7, backend: 'dhis2' },
      }),
    ).toBe(7);
  });

  test('returns undefined for non-DHIS2 datasets', () => {
    expect(
      getDhis2LegendSetDatabaseId({
        database: { id: 4, backend: 'postgresql' },
      }),
    ).toBeUndefined();
  });
});

describe('isDirectDhis2Datasource', () => {
  test('returns true for direct DHIS2 connections', () => {
    expect(
      isDirectDhis2Datasource({
        database: { id: 7, backend: 'dhis2' },
      }),
    ).toBe(true);
  });

  test('returns false for staged local serving datasets even when the database name includes dhis2', () => {
    expect(
      isDirectDhis2Datasource({
        database: {
          id: 4,
          backend: 'clickhousedb',
          name: 'DHIS2 Serving (ClickHouse)',
          sqlalchemy_uri: 'clickhousedb://dhis2_user@127.0.0.1:8123/dhis2_serving',
        },
        extra: JSON.stringify({
          dhis2_staged_local: true,
          dhis2_source_database_id: 5,
        }),
      }),
    ).toBe(false);
  });

  test('returns false for serving databases identified only by name', () => {
    expect(
      isDirectDhis2Datasource({
        database: {
          id: 4,
          backend: 'clickhousedb',
          name: 'DHIS2 Serving (ClickHouse)',
        },
      }),
    ).toBe(false);
  });
});
