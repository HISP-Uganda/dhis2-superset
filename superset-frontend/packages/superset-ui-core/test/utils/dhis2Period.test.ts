/* eslint-disable no-restricted-globals */
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
  formatDHIS2Period,
  getDHIS2PeriodColumnNames,
  isDHIS2Period,
  isDHIS2PeriodColumn,
  periodSelectLabel,
} from '../../src/utils/dhis2Period';

describe('formatDHIS2Period', () => {
  // Daily
  test('daily', () => {
    expect(formatDHIS2Period('20250101')).toBe('1 January 2025');
    expect(formatDHIS2Period('20251231')).toBe('31 December 2025');
  });

  // Monthly
  test('monthly', () => {
    expect(formatDHIS2Period('202501')).toBe('January 2025');
    expect(formatDHIS2Period('202512')).toBe('December 2025');
    expect(formatDHIS2Period('202506')).toBe('June 2025');
  });

  // Bi-monthly
  test('bi-monthly', () => {
    expect(formatDHIS2Period('202501B')).toBe('January – February 2025');
    expect(formatDHIS2Period('202511B')).toBe('November – December 2025');
  });

  // Quarterly
  test('quarterly (Jan-based)', () => {
    expect(formatDHIS2Period('2025Q1')).toBe('January – March 2025');
    expect(formatDHIS2Period('2025Q2')).toBe('April – June 2025');
    expect(formatDHIS2Period('2025Q3')).toBe('July – September 2025');
    expect(formatDHIS2Period('2025Q4')).toBe('October – December 2025');
  });

  test('quarterly April', () => {
    expect(formatDHIS2Period('2025AprilQ1')).toBe('April – June 2025');
    expect(formatDHIS2Period('2025AprilQ2')).toBe('July – September 2025');
    expect(formatDHIS2Period('2025AprilQ3')).toBe('October – December 2025');
    expect(formatDHIS2Period('2025AprilQ4')).toBe('January – March 2026');
  });

  test('quarterly July', () => {
    expect(formatDHIS2Period('2025JulyQ1')).toBe('July – September 2025');
    expect(formatDHIS2Period('2025JulyQ2')).toBe('October – December 2025');
    expect(formatDHIS2Period('2025JulyQ3')).toBe('January – March 2026');
    expect(formatDHIS2Period('2025JulyQ4')).toBe('April – June 2026');
  });

  test('quarterly October', () => {
    expect(formatDHIS2Period('2025OctQ1')).toBe('October – December 2025');
    expect(formatDHIS2Period('2025OctQ2')).toBe('January – March 2026');
    expect(formatDHIS2Period('2025OctQ3')).toBe('April – June 2026');
    expect(formatDHIS2Period('2025OctQ4')).toBe('July – September 2026');
  });

  // Six-monthly
  test('six-monthly (Jan-based)', () => {
    expect(formatDHIS2Period('2025S1')).toBe('January – June 2025');
    expect(formatDHIS2Period('2025S2')).toBe('July – December 2025');
  });

  test('six-monthly April', () => {
    expect(formatDHIS2Period('2025AprilS1')).toBe('April – September 2025');
    expect(formatDHIS2Period('2025AprilS2')).toBe('October 2025 – March 2026');
  });

  test('six-monthly November', () => {
    expect(formatDHIS2Period('2025NovS1')).toBe('November 2025 – April 2026');
    expect(formatDHIS2Period('2025NovS2')).toBe('May – October 2026');
  });

  // Yearly
  test('yearly', () => {
    expect(formatDHIS2Period('2025')).toBe('2025');
    expect(formatDHIS2Period('2000')).toBe('2000');
  });

  // Financial years
  test('financial April', () => {
    expect(formatDHIS2Period('2025April')).toBe('April 2025 – March 2026');
  });

  test('financial July', () => {
    expect(formatDHIS2Period('2025July')).toBe('July 2025 – June 2026');
  });

  test('financial October', () => {
    expect(formatDHIS2Period('2025Oct')).toBe('October 2025 – September 2026');
  });

  test('financial November', () => {
    expect(formatDHIS2Period('2025Nov')).toBe('November 2025 – October 2026');
  });

  // Weekly
  test('weekly Mon', () => {
    expect(formatDHIS2Period('2025W1')).toBe('Week 1, 2025');
    expect(formatDHIS2Period('2025W52')).toBe('Week 52, 2025');
  });

  test('weekly variants', () => {
    expect(formatDHIS2Period('2025WedW1')).toBe('Wednesday Week 1, 2025');
    expect(formatDHIS2Period('2025ThuW3')).toBe('Thursday Week 3, 2025');
    expect(formatDHIS2Period('2025SatW10')).toBe('Saturday Week 10, 2025');
    expect(formatDHIS2Period('2025SunW22')).toBe('Sunday Week 22, 2025');
  });

  test('bi-weekly', () => {
    expect(formatDHIS2Period('2025BiW1')).toBe('Bi-week 1, 2025');
    expect(formatDHIS2Period('2025BiW26')).toBe('Bi-week 26, 2025');
  });

  // Unknown / passthrough
  test('unknown format returns as-is', () => {
    expect(formatDHIS2Period('FOO')).toBe('FOO');
    expect(formatDHIS2Period('')).toBe('');
    expect(formatDHIS2Period('2025-01')).toBe('2025-01');
  });
});

describe('isDHIS2Period', () => {
  test('recognises valid periods', () => {
    expect(isDHIS2Period('202501')).toBe(true);
    expect(isDHIS2Period('2025Q1')).toBe(true);
    expect(isDHIS2Period('2025S1')).toBe(true);
    expect(isDHIS2Period('20250101')).toBe(true);
    expect(isDHIS2Period('2025W1')).toBe(true);
    expect(isDHIS2Period('2025April')).toBe(true);
  });

  test('yearly is not detected (label equals raw)', () => {
    // "2025" → formatDHIS2Period returns "2025" (same), so isDHIS2Period is false
    expect(isDHIS2Period('2025')).toBe(false);
  });

  test('rejects non-period strings', () => {
    expect(isDHIS2Period('FOO')).toBe(false);
    expect(isDHIS2Period('Uganda')).toBe(false);
  });
});

describe('periodSelectLabel', () => {
  test('shows label and code together', () => {
    expect(periodSelectLabel('202501')).toBe('January 2025  (202501)');
    expect(periodSelectLabel('2025Q1')).toBe('January – March 2025  (2025Q1)');
  });

  test('yearly returns as-is (no duplication)', () => {
    expect(periodSelectLabel('2025')).toBe('2025');
  });

  test('unknown returns as-is', () => {
    expect(periodSelectLabel('FOO')).toBe('FOO');
  });
});

describe('DHIS2 period column helpers', () => {
  test('detects raw and hierarchy period columns from metadata', () => {
    expect(
      isDHIS2PeriodColumn({
        column_name: 'period',
        extra: { dhis2_is_period: true },
      }),
    ).toBe(true);
    expect(
      isDHIS2PeriodColumn({
        column_name: 'monthly_period',
        extra: { dhis2_is_period_hierarchy: true, dhis2_period_key: 'monthly' },
      }),
    ).toBe(true);
    expect(
      isDHIS2PeriodColumn({
        column_name: 'org_unit',
        extra: { dhis2_is_ou_hierarchy: true },
      }),
    ).toBe(false);
  });

  test('collects raw and verbose period column names', () => {
    expect(
      Array.from(
        getDHIS2PeriodColumnNames([
          {
            column_name: 'monthly_period',
            verbose_name: 'Monthly Period',
            extra: { dhis2_is_period_hierarchy: true },
          },
          {
            column_name: 'org_unit',
            verbose_name: 'Organisation Unit',
            extra: { dhis2_is_ou_hierarchy: true },
          },
        ]),
      ),
    ).toEqual(['monthly_period', 'Monthly Period']);
  });
});
