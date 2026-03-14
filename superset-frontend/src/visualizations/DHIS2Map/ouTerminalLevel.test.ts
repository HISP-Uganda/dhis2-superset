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
  filterRowsAtTerminalOuLevel,
  getOrderedOuHierarchyColumns,
  hasOuValue,
  isTerminalAtSelectedLevel,
} from './ouTerminalLevel';

describe('ouTerminalLevel', () => {
  const hierarchyColumns = getOrderedOuHierarchyColumns([
    'value',
    'ou_level_3',
    'ou_level_1',
    'ou_level_2',
    'period',
  ]);

  it('treats null, undefined, and empty strings as not populated', () => {
    expect(hasOuValue(null)).toBe(false);
    expect(hasOuValue(undefined)).toBe(false);
    expect(hasOuValue('')).toBe(false);
    expect(hasOuValue('   ')).toBe(false);
    expect(hasOuValue('Kampala')).toBe(true);
  });

  it('includes rows when the selected level is the last populated level', () => {
    expect(
      isTerminalAtSelectedLevel(
        {
          ou_level_1: 'Uganda',
          ou_level_2: 'Kampala',
          ou_level_3: '',
        },
        hierarchyColumns,
        'ou_level_2',
      ),
    ).toBe(true);
  });

  it('excludes rows when a deeper level is populated after the selected level', () => {
    expect(
      isTerminalAtSelectedLevel(
        {
          ou_level_1: 'Uganda',
          ou_level_2: 'Kampala',
          ou_level_3: 'Central Division',
        },
        hierarchyColumns,
        'ou_level_2',
      ),
    ).toBe(false);
  });

  it('excludes rows when the selected level is empty', () => {
    expect(
      isTerminalAtSelectedLevel(
        {
          ou_level_1: 'Uganda',
          ou_level_2: '',
          ou_level_3: '',
        },
        hierarchyColumns,
        'ou_level_2',
      ),
    ).toBe(false);
  });

  it('works across different selected levels', () => {
    const rows = [
      {
        key: 'a',
        ou_level_1: 'Uganda',
        ou_level_2: 'Kampala',
        ou_level_3: '',
      },
      {
        key: 'b',
        ou_level_1: 'Uganda',
        ou_level_2: 'Kampala',
        ou_level_3: 'Central Division',
      },
      {
        key: 'c',
        ou_level_1: 'Uganda',
        ou_level_2: '',
        ou_level_3: '',
      },
    ];

    expect(
      filterRowsAtTerminalOuLevel(rows, hierarchyColumns, 'ou_level_2').map(
        row => row.key,
      ),
    ).toEqual(['a']);

    expect(
      filterRowsAtTerminalOuLevel(rows, hierarchyColumns, 'ou_level_3').map(
        row => row.key,
      ),
    ).toEqual(['b']);
  });
});
