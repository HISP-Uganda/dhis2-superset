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
import { DHIS2SplitPreset } from './types';

type DatasourceColumn = {
  column_name?: string;
  verbose_name?: string;
  extra?: unknown;
};

export interface SplitPresetOption {
  presetKey: DHIS2SplitPreset;
  label: string;
  columnName: string;
}

/** Maps period presets to column name patterns. */
const PERIOD_PRESET_MAP: Array<{
  preset: DHIS2SplitPreset;
  label: string;
  patterns: string[];
}> = [
  {
    preset: 'by_period_monthly',
    label: 'By Month',
    patterns: ['month', 'period_month', 'monthly'],
  },
  {
    preset: 'by_period_quarterly',
    label: 'By Quarter',
    patterns: ['quarter', 'period_quarter', 'quarterly'],
  },
  {
    preset: 'by_period_yearly',
    label: 'By Year',
    patterns: ['year', 'period_year', 'yearly', 'financial_year'],
  },
];

function parseExtra(extra: unknown): Record<string, any> | undefined {
  if (!extra) return undefined;
  if (typeof extra === 'string') {
    try {
      return JSON.parse(extra);
    } catch {
      return undefined;
    }
  }
  if (typeof extra === 'object') return extra as Record<string, any>;
  return undefined;
}

function normalize(name?: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .trim();
}

/**
 * Detect which DHIS2 split presets are available based on the datasource columns.
 * Uses column metadata (dhis2_is_ou_hierarchy, dhis2_ou_level, dhis2_is_period)
 * so it works with any DHIS2 instance regardless of OU level names.
 */
export function detectAvailablePresets(
  datasourceColumns: DatasourceColumn[] = [],
): SplitPresetOption[] {
  const options: SplitPresetOption[] = [];
  const columnNames = datasourceColumns.map(c => normalize(c.column_name));
  const rawColumnNames = datasourceColumns.map(c =>
    String(c.column_name || ''),
  );

  // Detect OU hierarchy columns from metadata
  for (const col of datasourceColumns) {
    const extra = parseExtra(col.extra);
    if (!extra) continue;
    const isHierarchy =
      extra.dhis2_is_ou_hierarchy === true ||
      extra.dhis2IsOuHierarchy === true;
    if (!isHierarchy) continue;
    const level = Number(extra.dhis2_ou_level ?? extra.dhis2OuLevel ?? 0);
    if (level <= 0) continue;
    const colName = String(col.column_name || '').trim();
    const label = col.verbose_name || colName || `Level ${level}`;
    // Map level to a generic preset key (by_national, by_region, etc.)
    const presetKey = `by_level_${level}` as DHIS2SplitPreset;
    options.push({
      presetKey,
      label: `By ${label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
      columnName: colName,
    });
  }

  // Detect period columns from metadata or name patterns
  for (const col of datasourceColumns) {
    const extra = parseExtra(col.extra);
    const isPeriod =
      extra?.dhis2_is_period === true || extra?.dhis2IsPeriod === true;
    if (isPeriod) {
      const colName = String(col.column_name || '').trim();
      options.push({
        presetKey: 'by_period_monthly',
        label: 'By Period',
        columnName: colName,
      });
      break;
    }
  }

  // Fallback: detect period columns by name patterns if no metadata found
  if (!options.some(o => o.presetKey.startsWith('by_period'))) {
    for (const def of PERIOD_PRESET_MAP) {
      for (const pattern of def.patterns) {
        const idx = columnNames.findIndex(
          n => n === pattern || n.includes(pattern),
        );
        if (idx >= 0) {
          options.push({
            presetKey: def.preset,
            label: def.label,
            columnName: rawColumnNames[idx],
          });
          break;
        }
      }
    }
  }

  return options;
}

export function resolvePresetColumn(
  preset: DHIS2SplitPreset | undefined,
  datasourceColumns: DatasourceColumn[] = [],
  availableDataColumns: string[] = [],
): string | null {
  if (!preset || preset === 'custom') return null;

  const presets = detectAvailablePresets(datasourceColumns);
  const match = presets.find(p => p.presetKey === preset);
  if (!match) return null;

  // Exact match in data columns
  if (availableDataColumns.includes(match.columnName)) {
    return match.columnName;
  }

  // Try normalized match
  const normalizedTarget = normalize(match.columnName);
  const found = availableDataColumns.find(
    col => normalize(col) === normalizedTarget,
  );
  return found || null;
}
