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

/** Maps OU presets to legacy column name patterns. */
const OU_PRESET_MAP: Array<{
  preset: DHIS2SplitPreset;
  label: string;
  level: number;
  patterns: string[];
}> = [
  { preset: 'by_national', label: 'By National', level: 1, patterns: ['national'] },
  { preset: 'by_region', label: 'By Region', level: 2, patterns: ['region'] },
  {
    preset: 'by_district',
    label: 'By District',
    level: 3,
    patterns: ['district', 'district_city', 'district city'],
  },
  {
    preset: 'by_subcounty',
    label: 'By Sub-County',
    level: 5,
    patterns: ['sub_county', 'sub county', 'town council', 'division'],
  },
  {
    preset: 'by_facility',
    label: 'By Facility',
    level: 6,
    patterns: ['facility', 'health_facility', 'health facility'],
  },
];

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
 */
export function detectAvailablePresets(
  datasourceColumns: DatasourceColumn[] = [],
): SplitPresetOption[] {
  const options: SplitPresetOption[] = [];
  const columnNames = datasourceColumns.map(c => normalize(c.column_name));
  const rawColumnNames = datasourceColumns.map(c =>
    String(c.column_name || ''),
  );

  // Detect OU hierarchy columns
  for (const def of OU_PRESET_MAP) {
    // Check by explicit extra metadata
    const hierarchyCol = datasourceColumns.find(col => {
      const extra = parseExtra(col.extra);
      if (!extra) return false;
      const isHierarchy =
        extra.dhis2_is_ou_hierarchy === true ||
        extra.dhis2IsOuHierarchy === true;
      if (!isHierarchy) return false;
      const level = Number(
        extra.dhis2_ou_level ?? extra.dhis2OuLevel ?? 0,
      );
      return level === def.level;
    });

    if (hierarchyCol) {
      options.push({
        presetKey: def.preset,
        label: def.label,
        columnName: String(hierarchyCol.column_name),
      });
      continue;
    }

    // Fallback: match by column name patterns
    for (const pattern of def.patterns) {
      const idx = columnNames.findIndex(n => n.includes(pattern));
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

  // Detect period columns
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

  return options;
}

/**
 * Given a preset key, resolve the actual column name in the data.
 * Falls back to null if the column cannot be found.
 */
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
