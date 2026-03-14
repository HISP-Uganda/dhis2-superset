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

type DatasourceColumn = {
  column_name?: string;
  verbose_name?: string;
  extra?: unknown;
};

type StagedOrgUnitLevel = {
  level?: number | string;
  displayName?: string;
  name?: string;
};

export type BoundaryLevelDefinition = {
  level: number;
  columnName?: string;
  label: string;
};

function normalizeBoundaryLevels(boundaryLevels?: number[]): number[] {
  if (!Array.isArray(boundaryLevels)) {
    return [];
  }

  return boundaryLevels.filter(
    level => Number.isFinite(level) && Number(level) > 0,
  );
}

function parseColumnExtra(extra: unknown): Record<string, any> | undefined {
  if (!extra) {
    return undefined;
  }
  if (typeof extra === 'string') {
    try {
      return JSON.parse(extra);
    } catch {
      return undefined;
    }
  }
  if (typeof extra === 'object') {
    return extra as Record<string, any>;
  }
  return undefined;
}

function normalizeLevelName(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[()[\]{}.,/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coerceLevelNumber(value: unknown): number | undefined {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }
  return undefined;
}

export function getDatasourceBoundaryLevels(
  datasourceColumns?: DatasourceColumn[],
  stagedOrgUnitLevels?: StagedOrgUnitLevel[],
): BoundaryLevelDefinition[] {
  const definitions = new Map<number, BoundaryLevelDefinition>();

  (datasourceColumns || []).forEach(column => {
    const extra = parseColumnExtra(column.extra);
    const isHierarchyColumn =
      extra?.dhis2_is_ou_hierarchy === true ||
      extra?.dhis2IsOuHierarchy === true;
    const level = coerceLevelNumber(
      extra?.dhis2_ou_level ?? extra?.dhis2OuLevel,
    );
    if (!isHierarchyColumn || !level) {
      return;
    }

    const label =
      String(column.verbose_name || column.column_name || '').trim() ||
      `Level ${level}`;
    definitions.set(level, {
      level,
      columnName: String(column.column_name || '').trim() || undefined,
      label,
    });
  });

  (stagedOrgUnitLevels || []).forEach(levelItem => {
    const level = coerceLevelNumber(levelItem.level);
    if (!level || definitions.has(level)) {
      return;
    }
    const label =
      String(levelItem.displayName || levelItem.name || '').trim() ||
      `Level ${level}`;
    definitions.set(level, { level, label });
  });

  return Array.from(definitions.values()).sort((left, right) => left.level - right.level);
}

export function buildBoundaryLevelLabelMap(
  datasourceColumns?: DatasourceColumn[],
  stagedOrgUnitLevels?: StagedOrgUnitLevel[],
): Record<number, string> {
  return getDatasourceBoundaryLevels(
    datasourceColumns,
    stagedOrgUnitLevels,
  ).reduce<Record<number, string>>((result, definition) => {
    result[definition.level] = definition.label;
    return result;
  }, {});
}

export function inferBoundaryLevelFromOrgUnitColumn(
  orgUnitColumn?: string,
  datasourceColumns?: DatasourceColumn[],
  stagedOrgUnitLevels?: StagedOrgUnitLevel[],
): number | undefined {
  if (!orgUnitColumn) {
    return undefined;
  }

  const normalizedColumnName = normalizeLevelName(orgUnitColumn);
  const explicitLevelMatch = normalizedColumnName.match(
    /(?:^| )level ?(\d+)(?: |$)/,
  );
  if (explicitLevelMatch) {
    return Number(explicitLevelMatch[1]);
  }

  const levelDefinitions = getDatasourceBoundaryLevels(
    datasourceColumns,
    stagedOrgUnitLevels,
  );
  const matchedDefinition = levelDefinitions.find(definition => {
    const columnMatch =
      normalizeLevelName(definition.columnName) === normalizedColumnName;
    const labelMatch = normalizeLevelName(definition.label) === normalizedColumnName;
    return columnMatch || labelMatch;
  });
  if (matchedDefinition) {
    return matchedDefinition.level;
  }

  return undefined;
}

export function resolvePrimaryBoundaryLevel(
  primaryBoundaryLevel?: number,
  boundaryLevels?: number[],
): number {
  if (
    Number.isFinite(primaryBoundaryLevel) &&
    Number(primaryBoundaryLevel) > 0
  ) {
    return Number(primaryBoundaryLevel);
  }

  const normalizedBoundaryLevels = normalizeBoundaryLevels(boundaryLevels);
  if (normalizedBoundaryLevels.length > 0) {
    return normalizedBoundaryLevels[0];
  }

  return 2;
}

export function resolveEffectiveBoundaryLevels(
  primaryBoundaryLevel?: number,
  boundaryLevels?: number[],
): number[] {
  const normalizedBoundaryLevels = normalizeBoundaryLevels(boundaryLevels);
  const resolvedPrimaryBoundaryLevel = resolvePrimaryBoundaryLevel(
    primaryBoundaryLevel,
    normalizedBoundaryLevels,
  );

  // The selected OU column determines the thematic geometry level.
  // If an older chart only has a single stale saved level, prefer the
  // resolved primary level so the map still loads the correct boundaries.
  if (
    normalizedBoundaryLevels.length === 1 &&
    normalizedBoundaryLevels[0] !== resolvedPrimaryBoundaryLevel
  ) {
    return [resolvedPrimaryBoundaryLevel];
  }

  if (normalizedBoundaryLevels.length > 0) {
    return Array.from(
      new Set([resolvedPrimaryBoundaryLevel, ...normalizedBoundaryLevels]),
    );
  }

  return [resolvedPrimaryBoundaryLevel];
}
