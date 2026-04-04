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

import { QueryFormColumn, getColumnLabel } from '@superset-ui/core';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface OuLevelDefinition {
  level: number;
  columnName: string;
  label: string;
}

export interface DrillBreadcrumb {
  level: number;
  columnName: string;
  label: string;
  /** The OU name the user clicked to drill into */
  selectedValue: string;
}

export interface OuDrillState {
  /** Whether drill-down is currently active */
  active: boolean;
  /** Current drill level number */
  currentLevel: number;
  /** Column name for the current drill level */
  currentColumn: string;
  /** Filter on the parent OU value */
  parentColumn: string;
  parentValue: string;
  /** Full breadcrumb trail */
  breadcrumbs: DrillBreadcrumb[];
}

export interface OuDrillOwnState {
  ouDrill?: OuDrillState;
}

/* ── Legacy level name → level number mapping ──────────────────────── */

const LEGACY_LEVEL_NAMES: Array<[string, number]> = [
  ['national', 1],
  ['region', 2],
  ['district city', 3],
  ['dlg municipality city council', 4],
  ['sub county town council division', 5],
  ['health facility', 6],
  ['ward department', 7],
];

function normalizeName(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[()[\]{}.,/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function getLegacyLevel(
  columnName?: string,
  label?: string,
): number | undefined {
  const names = [normalizeName(columnName), normalizeName(label)].filter(
    Boolean,
  );
  for (const [knownName, level] of LEGACY_LEVEL_NAMES) {
    if (names.includes(knownName)) return level;
  }
  return undefined;
}

/* ── Discover OU hierarchy levels from datasource columns ──────────── */

export function discoverOuLevels(
  datasourceColumns?: Array<{
    column_name?: string;
    verbose_name?: string;
    extra?: unknown;
  }>,
): OuLevelDefinition[] {
  if (!datasourceColumns?.length) return [];

  const definitions = new Map<number, OuLevelDefinition>();

  for (const col of datasourceColumns) {
    const extra = parseExtra(col.extra);
    const isHierarchy =
      extra?.dhis2_is_ou_hierarchy === true ||
      extra?.dhis2IsOuHierarchy === true;
    if (!isHierarchy) continue;

    const columnName = String(col.column_name || '').trim();
    if (!columnName) continue;

    const label =
      String(col.verbose_name || col.column_name || '').trim() ||
      'Boundary level';

    const explicitLevel =
      extra?.dhis2_ou_level ?? extra?.dhis2OuLevel;
    const level =
      (Number.isFinite(Number(explicitLevel)) && Number(explicitLevel) > 0
        ? Number(explicitLevel)
        : undefined) ?? getLegacyLevel(columnName, label);

    if (level !== undefined) {
      // Prefer explicit level metadata over legacy
      const existing = definitions.get(level);
      if (!existing || explicitLevel !== undefined) {
        definitions.set(level, { level, columnName, label });
      }
    }
  }

  return Array.from(definitions.values()).sort((a, b) => a.level - b.level);
}

/* ── Find which groupby column is an OU column ─────────────────────── */

export function findOuGroupbyColumn(
  groupby: QueryFormColumn[],
  ouLevels: OuLevelDefinition[],
): OuLevelDefinition | undefined {
  if (!groupby.length || !ouLevels.length) return undefined;

  for (const col of groupby) {
    const colLabel = getColumnLabel(col);
    const normalized = normalizeName(colLabel);
    const match = ouLevels.find(
      def =>
        normalizeName(def.columnName) === normalized ||
        normalizeName(def.label) === normalized,
    );
    if (match) return match;
  }
  return undefined;
}

/* ── Get next level down ───────────────────────────────────────────── */

export function getChildLevel(
  currentLevel: number,
  ouLevels: OuLevelDefinition[],
): OuLevelDefinition | undefined {
  return ouLevels.find(def => def.level > currentLevel);
}

/* ── Build initial drill state when clicking a slice/bar ───────────── */

export function buildDrillState(
  clickedValue: string,
  currentLevelDef: OuLevelDefinition,
  childLevelDef: OuLevelDefinition,
  existingState?: OuDrillState,
): OuDrillState {
  const breadcrumbs = [
    ...(existingState?.breadcrumbs ?? []),
    {
      level: currentLevelDef.level,
      columnName: currentLevelDef.columnName,
      label: currentLevelDef.label,
      selectedValue: clickedValue,
    },
  ];

  return {
    active: true,
    currentLevel: childLevelDef.level,
    currentColumn: childLevelDef.columnName,
    parentColumn: currentLevelDef.columnName,
    parentValue: clickedValue,
    breadcrumbs,
  };
}

/* ── Navigate back up ──────────────────────────────────────────────── */

export function drillUp(
  state: OuDrillState,
  toIndex: number,
  ouLevels: OuLevelDefinition[],
): OuDrillState | undefined {
  // toIndex = -1 means reset to top (no drill)
  if (toIndex < 0) return undefined;

  const breadcrumbs = state.breadcrumbs.slice(0, toIndex + 1);
  const target = breadcrumbs[toIndex];
  const childLevel = getChildLevel(target.level, ouLevels);
  if (!childLevel) return undefined;

  return {
    active: true,
    currentLevel: childLevel.level,
    currentColumn: childLevel.columnName,
    parentColumn: target.columnName,
    parentValue: target.selectedValue,
    breadcrumbs,
  };
}

/* ── Apply drill state to query formData ───────────────────────────── */

export function applyDrillToFormData(
  formData: Record<string, any>,
  drillState: OuDrillState,
  originalOuColumn: string,
): Record<string, any> {
  // Replace the OU column in groupby with the child level column
  const groupby = (formData.groupby || []).map((col: QueryFormColumn) => {
    const colLabel = getColumnLabel(col);
    if (normalizeName(colLabel) === normalizeName(originalOuColumn)) {
      return drillState.currentColumn;
    }
    return col;
  });

  // Add filter for the parent OU value
  const existingFilters = formData.extra_form_data?.filters || [];
  const drillFilter = {
    col: drillState.parentColumn,
    op: '==' as const,
    val: drillState.parentValue,
  };

  return {
    ...formData,
    groupby,
    extra_form_data: {
      ...(formData.extra_form_data || {}),
      filters: [...existingFilters, drillFilter],
    },
  };
}
