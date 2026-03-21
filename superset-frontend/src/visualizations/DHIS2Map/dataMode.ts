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
  resolveQueryDimensionColumnName,
  resolveQueryMetricColumnName,
} from './loaderColumns';
import { DHIS2DatasourceColumn } from './types';

const STAGED_LOCAL_SERVING_SQL_PATTERN =
  /select\s+\*\s+from\s+(?:[`"]?[a-z_][\w]*[`"]?\.)?[`"]?sv_(\d+)_[a-z0-9_]+[`"]?/i;

export function hasDHIS2SqlComment(sql?: string | null): boolean {
  if (!sql) {
    return false;
  }
  return (
    /\/\*\s*DHIS2:\s*(.+?)\s*\*\//i.test(sql) ||
    /--\s*DHIS2:\s*(.+)$/im.test(sql)
  );
}

export function hasStagedLocalServingSql(sql?: string | null): boolean {
  if (!sql) {
    return false;
  }
  return STAGED_LOCAL_SERVING_SQL_PATTERN.test(sql);
}

export function getStagedDatasetIdFromSql(
  sql?: string | null,
): number | undefined {
  if (!sql) {
    return undefined;
  }
  const match = sql.match(STAGED_LOCAL_SERVING_SQL_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }
  const parsedValue = Number(match[1]);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : undefined;
}

export function shouldResolveDHIS2DatasetSql({
  datasetId,
  datasetSql,
  isDHIS2Dataset,
  isStagedLocalDataset,
  databaseId,
  sourceInstanceIds,
}: {
  datasetId?: number;
  datasetSql?: string | null;
  isDHIS2Dataset?: boolean;
  isStagedLocalDataset?: boolean;
  databaseId?: number;
  sourceInstanceIds?: number[];
}): boolean {
  if (isStagedLocalDataset) {
    return false;
  }

  const hasSourceContext =
    Boolean(databaseId) &&
    Array.isArray(sourceInstanceIds) &&
    sourceInstanceIds.length > 0;

  if (!datasetId) {
    return false;
  }

  // Staged-local datasets need the embedded DHIS2 params comment before the
  // map can switch from the placeholder chart payload to live DHIS2 rows.
  return Boolean(
    (isDHIS2Dataset || hasSourceContext) && !hasDHIS2SqlComment(datasetSql),
  );
}

export function shouldUseDHIS2LoaderData({
  databaseId,
  datasetSql,
  isStagedLocalDataset,
}: {
  databaseId?: number;
  datasetSql?: string | null;
  isDHIS2Dataset?: boolean;
  isStagedLocalDataset?: boolean;
}): boolean {
  if (isStagedLocalDataset) {
    return false;
  }
  return Boolean(databaseId && datasetSql && hasDHIS2SqlComment(datasetSql));
}

export function resolveDHIS2MapData(
  chartRows: Record<string, any>[] | undefined,
  loaderRows: Record<string, any>[] | null | undefined,
  preferLoader: boolean,
): Record<string, any>[] {
  if (!preferLoader) {
    return Array.isArray(chartRows) ? chartRows : [];
  }
  return Array.isArray(loaderRows) ? loaderRows : [];
}

/**
 * Saved staged-local charts can still carry an older placeholder query context
 * that only returns the thematic parent level. Focus mode needs child-level
 * rows from the staged serving table, so fall back to the local query API when
 * the chart payload cannot resolve the child org-unit column or metric.
 */
export function shouldLoadStagedLocalFocusData({
  isStagedLocalDataset,
  stagedDatasetId,
  focusSelectedBoundaryWithChildren,
  focusedChildLevel,
  chartRows = [],
  chartColumns,
  requestedChildColumn,
  requestedMetric,
  datasourceColumns = [],
  hierarchyColumns = [],
}: {
  isStagedLocalDataset?: boolean;
  stagedDatasetId?: number;
  focusSelectedBoundaryWithChildren?: boolean;
  focusedChildLevel?: number;
  chartRows?: Record<string, any>[];
  chartColumns?: string[];
  requestedChildColumn?: string;
  requestedMetric?: string;
  datasourceColumns?: DHIS2DatasourceColumn[];
  hierarchyColumns?: string[];
}): boolean {
  if (
    !isStagedLocalDataset ||
    !stagedDatasetId ||
    !focusSelectedBoundaryWithChildren ||
    !focusedChildLevel
  ) {
    return false;
  }

  if (!Array.isArray(chartRows) || chartRows.length === 0) {
    return true;
  }

  const availableColumns =
    Array.isArray(chartColumns) && chartColumns.length > 0
      ? chartColumns
      : Array.from(
          new Set(chartRows.flatMap(row => Object.keys(row || {})).filter(Boolean)),
        );

  if (requestedChildColumn) {
    const resolvedChildColumn = resolveQueryDimensionColumnName({
      requestedColumn: requestedChildColumn,
      datasourceColumns,
      availableColumns,
    });
    if (!resolvedChildColumn) {
      return true;
    }

    const hasChildValues = chartRows.some(row => {
      const value = row?.[resolvedChildColumn];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
    if (!hasChildValues) {
      return true;
    }

    const hierarchyColumnIndex = hierarchyColumns.indexOf(requestedChildColumn);
    if (hierarchyColumnIndex >= 0) {
      const deeperColumns = hierarchyColumns
        .slice(hierarchyColumnIndex + 1)
        .map(column =>
          resolveQueryDimensionColumnName({
            requestedColumn: column,
            datasourceColumns,
            availableColumns,
          }),
        )
        .filter((column): column is string => Boolean(column));

      const hasDeeperHierarchyValues = deeperColumns.some(columnName =>
        chartRows.some(row => {
          const value = row?.[columnName];
          return value !== undefined && value !== null && String(value).trim() !== '';
        }),
      );

      if (hasDeeperHierarchyValues) {
        return true;
      }
    }
  }

  if (requestedMetric) {
    const resolvedMetricColumn = resolveQueryMetricColumnName({
      metric: requestedMetric,
      datasourceColumns,
      availableColumns,
      rows: chartRows,
    });
    if (!resolvedMetricColumn) {
      return true;
    }
  }

  return false;
}

export function resolveDisplayedBoundaries<T extends { id: string }>({
  boundaries,
  selectedBoundaryIds,
  showAllBoundaries,
}: {
  boundaries: T[];
  selectedBoundaryIds: Set<string>;
  showAllBoundaries: boolean;
}): T[] {
  if (showAllBoundaries) {
    return boundaries;
  }

  // If no thematic rows matched the rendered boundaries, keep the geometry
  // visible and let the map style everything with the configured no-data color.
  if (selectedBoundaryIds.size === 0) {
    return boundaries;
  }

  return boundaries.filter(feature => selectedBoundaryIds.has(feature.id));
}
