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
  buildBoundaryLevelLabelMap,
  getDatasourceBoundaryLevels,
  inferBoundaryLevelFromOrgUnitColumn,
  resolveEffectiveBoundaryLevels,
  resolvePrimaryBoundaryLevel,
} from './boundaryLevels';

describe('DHIS2Map boundaryLevels', () => {
  test('prefers the resolved primary OU level over a stale single boundary level', () => {
    expect(resolvePrimaryBoundaryLevel(2, [3])).toBe(2);
    expect(resolveEffectiveBoundaryLevels(2, [3])).toEqual([2]);
  });

  test('preserves explicit overlay levels when multiple levels are configured', () => {
    expect(resolveEffectiveBoundaryLevels(2, [3, 4])).toEqual([2, 3, 4]);
  });

  test('falls back to configured levels when no primary OU level is available', () => {
    expect(resolvePrimaryBoundaryLevel(undefined, [4])).toBe(4);
    expect(resolveEffectiveBoundaryLevels(undefined, [4])).toEqual([4]);
  });

  test('falls back to level 2 when neither primary nor configured levels exist', () => {
    expect(resolvePrimaryBoundaryLevel(undefined, undefined)).toBe(2);
    expect(resolveEffectiveBoundaryLevels(undefined, undefined)).toEqual([2]);
  });

  test('infers boundary levels from staged dataset column metadata', () => {
    const datasourceColumns = [
      {
        column_name: 'province_name',
        verbose_name: 'Province',
        extra: JSON.stringify({
          dhis2_is_ou_hierarchy: true,
          dhis2_ou_level: 2,
        }),
      },
      {
        column_name: 'county_name',
        verbose_name: 'County',
        extra: JSON.stringify({
          dhis2_is_ou_hierarchy: true,
          dhis2_ou_level: 3,
        }),
      },
    ];

    expect(
      inferBoundaryLevelFromOrgUnitColumn('province_name', datasourceColumns),
    ).toBe(2);
    expect(
      inferBoundaryLevelFromOrgUnitColumn('County', datasourceColumns),
    ).toBe(3);
  });

  test('builds dynamic boundary level definitions and labels from staged metadata', () => {
    const datasourceColumns = [
      {
        column_name: 'province_name',
        verbose_name: 'Province',
        extra: JSON.stringify({
          dhis2_is_ou_hierarchy: true,
          dhis2_ou_level: 2,
        }),
      },
    ];
    const stagedLevels = [
      { level: 1, displayName: 'Country' },
      { level: 2, displayName: 'Province' },
      { level: 3, displayName: 'County' },
    ];

    expect(getDatasourceBoundaryLevels(datasourceColumns, stagedLevels)).toEqual([
      { level: 1, label: 'Country' },
      { level: 2, columnName: 'province_name', label: 'Province' },
      { level: 3, label: 'County' },
    ]);
    expect(buildBoundaryLevelLabelMap(datasourceColumns, stagedLevels)).toEqual({
      1: 'Country',
      2: 'Province',
      3: 'County',
    });
  });
});
