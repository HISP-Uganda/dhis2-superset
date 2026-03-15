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

import { sanitizeDHIS2ColumnName } from '../../features/datasets/AddDataset/DHIS2ParameterBuilder/sanitize';
import {
  DHIS2DatasourceColumn,
  DHIS2LoaderColumnDefinition,
} from './types';
import { resolveColumnName } from './columnCompatibility';

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

function extractMetricBaseColumn(metric: string): string {
  const match = metric.match(
    /^(SUM|AVG|COUNT|MIN|MAX|STDDEV|VARIANCE|MEDIAN)\s*\(\s*([^)]+)\s*\)$/i,
  );
  return match?.[2]?.trim() || metric;
}

function extractMetricAggregator(metric: string): string | undefined {
  const match = metric.match(
    /^(SUM|AVG|COUNT|MIN|MAX|STDDEV|VARIANCE|MEDIAN)\s*\(/i,
  );
  return match?.[1]?.toUpperCase();
}

function normalizeColumnAlias(value: string): string {
  return sanitizeDHIS2ColumnName(value).toLowerCase();
}

function findAvailableColumnMatch(
  availableColumns: string[],
  candidates: Array<string | undefined>,
): string | undefined {
  for (const candidate of candidates) {
    const trimmedCandidate = String(candidate || '').trim();
    if (!trimmedCandidate) {
      continue;
    }

    const exactMatch = availableColumns.find(
      column => String(column || '').trim() === trimmedCandidate,
    );
    if (exactMatch) {
      return exactMatch;
    }

    const caseInsensitiveMatch = availableColumns.find(
      column =>
        String(column || '').trim().toLowerCase() ===
        trimmedCandidate.toLowerCase(),
    );
    if (caseInsensitiveMatch) {
      return caseInsensitiveMatch;
    }

    const normalizedCandidate = normalizeColumnAlias(trimmedCandidate);
    const normalizedMatch = availableColumns.find(
      column =>
        normalizeColumnAlias(String(column || '').trim()) ===
        normalizedCandidate,
    );
    if (normalizedMatch) {
      return normalizedMatch;
    }
  }

  return undefined;
}

function findDatasourceColumn(
  datasourceColumns: DHIS2DatasourceColumn[],
  requestedColumn: string,
): DHIS2DatasourceColumn | undefined {
  const sanitizedRequested = normalizeColumnAlias(requestedColumn);
  return datasourceColumns.find(column => {
    const columnName = String(column.column_name || '').trim();
    const verboseName = String(column.verbose_name || '').trim();
    if (!columnName && !verboseName) {
      return false;
    }
    return (
      columnName === requestedColumn ||
      verboseName === requestedColumn ||
      columnName.toLowerCase() === requestedColumn.toLowerCase() ||
      verboseName.toLowerCase() === requestedColumn.toLowerCase() ||
      normalizeColumnAlias(columnName) === sanitizedRequested ||
      normalizeColumnAlias(verboseName) === sanitizedRequested
    );
  });
}

function findLoaderColumnByTitle(
  loaderColumns: DHIS2LoaderColumnDefinition[],
  titleCandidates: string[],
  availableColumns: string[],
): string | undefined {
  const sanitizedCandidates = titleCandidates
    .map(candidate => sanitizeDHIS2ColumnName(candidate))
    .filter(Boolean);

  return loaderColumns.find(column => {
    const dataIndex = String(column.dataIndex || '').trim();
    if (!dataIndex || !availableColumns.includes(dataIndex)) {
      return false;
    }
    const title = sanitizeDHIS2ColumnName(String(column.title || '').trim());
    return sanitizedCandidates.includes(title);
  })?.dataIndex;
}

function buildMetricColumnCandidates(variableId: string): string[] {
  const trimmed = String(variableId || '').trim();
  if (!trimmed) {
    return [];
  }

  const candidates = new Set<string>([trimmed, `de_${trimmed}`]);
  if (trimmed.startsWith('de_')) {
    candidates.add(`de_${trimmed}`);
    candidates.add(trimmed.replace(/^de_/, ''));
  }
  return Array.from(candidates);
}

export function resolveQueryDimensionColumnName(options: {
  requestedColumn: string;
  datasourceColumns?: DHIS2DatasourceColumn[];
  availableColumns: string[];
}): string | undefined {
  const {
    requestedColumn,
    datasourceColumns = [],
    availableColumns,
  } = options;

  if (!requestedColumn) {
    return undefined;
  }

  const datasourceColumn = findDatasourceColumn(
    datasourceColumns,
    requestedColumn,
  );

  return (
    findAvailableColumnMatch(availableColumns, [
      requestedColumn,
      datasourceColumn?.column_name,
      datasourceColumn?.verbose_name,
    ]) || resolveColumnName(requestedColumn, availableColumns)
  );
}

export function resolveQueryMetricColumnName(options: {
  metric: string;
  datasourceColumns?: DHIS2DatasourceColumn[];
  availableColumns: string[];
  rows?: Record<string, any>[];
}): string | undefined {
  const {
    metric,
    datasourceColumns = [],
    availableColumns,
    rows = [],
  } = options;

  if (!metric) {
    return undefined;
  }

  const metricBaseColumn = extractMetricBaseColumn(metric);
  const metricAggregator = extractMetricAggregator(metric);
  const datasourceColumn =
    findDatasourceColumn(datasourceColumns, metricBaseColumn) ||
    findDatasourceColumn(datasourceColumns, metric);
  const aliasCandidates = [
    metric,
    metricBaseColumn,
    datasourceColumn?.column_name,
    datasourceColumn?.verbose_name,
  ].filter(Boolean) as string[];

  const aggregateCandidates = metricAggregator
    ? aliasCandidates.flatMap(candidate => [
        `${metricAggregator}(${candidate})`,
        `${metricAggregator}( ${candidate} )`,
      ])
    : [];

  const matchedColumn = findAvailableColumnMatch(availableColumns, [
    ...aliasCandidates,
    ...aggregateCandidates,
  ]);
  if (matchedColumn) {
    return matchedColumn;
  }

  const firstRow = rows[0] || {};
  const numericCandidates = availableColumns.filter(columnName => {
    const normalized = normalizeColumnAlias(columnName);
    const matchedDatasourceColumn = findDatasourceColumn(
      datasourceColumns,
      columnName,
    );
    const extra = parseColumnExtra(matchedDatasourceColumn?.extra);
    const isHierarchyColumn =
      extra?.dhis2_is_ou_hierarchy === true ||
      extra?.dhis2IsOuHierarchy === true ||
      Number.isFinite(
        Number(extra?.dhis2_ou_level ?? extra?.dhis2OuLevel ?? NaN),
      );
    if (
      /^ou_level_\d+$/i.test(columnName) ||
      normalized === 'period' ||
      normalized === 'dhis2_instance' ||
      isHierarchyColumn
    ) {
      return false;
    }
    const value = firstRow[columnName];
    if (typeof value === 'number') {
      return Number.isFinite(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      return Number.isFinite(Number(value));
    }
    return false;
  });

  if (numericCandidates.length === 1) {
    return numericCandidates[0];
  }

  return undefined;
}

export function resolveLoaderDimensionColumnName(options: {
  requestedColumn: string;
  datasourceColumns?: DHIS2DatasourceColumn[];
  availableColumns: string[];
}): string | undefined {
  const {
    requestedColumn,
    datasourceColumns = [],
    availableColumns,
  } = options;

  const directMatch = resolveColumnName(requestedColumn, availableColumns);
  if (directMatch && availableColumns.includes(directMatch)) {
    return directMatch;
  }

  const datasourceColumn = findDatasourceColumn(
    datasourceColumns,
    requestedColumn,
  );
  const extra = parseColumnExtra(datasourceColumn?.extra);
  const hierarchyLevel = Number(
    extra?.dhis2_ou_level ?? extra?.dhis2OuLevel ?? NaN,
  );
  if (Number.isFinite(hierarchyLevel) && hierarchyLevel > 0) {
    const loaderColumn = `ou_level_${hierarchyLevel}`;
    if (availableColumns.includes(loaderColumn)) {
      return loaderColumn;
    }
  }

  return directMatch;
}

export function resolveLoaderMetricColumnName(options: {
  metric: string;
  datasourceColumns?: DHIS2DatasourceColumn[];
  loaderColumns?: DHIS2LoaderColumnDefinition[];
  availableColumns: string[];
}): string | undefined {
  const {
    metric,
    datasourceColumns = [],
    loaderColumns = [],
    availableColumns,
  } = options;

  const directMatch = resolveColumnName(metric, availableColumns);
  if (directMatch && availableColumns.includes(directMatch)) {
    return directMatch;
  }

  const metricBaseColumn = extractMetricBaseColumn(metric);
  const directBaseMatch = resolveColumnName(metricBaseColumn, availableColumns);
  if (directBaseMatch && availableColumns.includes(directBaseMatch)) {
    return directBaseMatch;
  }

  const datasourceColumn =
    findDatasourceColumn(datasourceColumns, metricBaseColumn) ||
    findDatasourceColumn(datasourceColumns, metric);
  const extra = parseColumnExtra(datasourceColumn?.extra);
  const variableId = String(
    extra?.dhis2_variable_id ?? extra?.dhis2VariableId ?? '',
  ).trim();

  if (variableId) {
    const loaderColumn = loaderColumns.find(column => {
      const dataIndex = String(column.dataIndex || '').trim();
      return (
        dataIndex &&
        availableColumns.includes(dataIndex) &&
        String(column.de_id || '').trim() === variableId
      );
    })?.dataIndex;
    if (loaderColumn) {
      return loaderColumn;
    }

    const fallbackMatch = buildMetricColumnCandidates(variableId).find(
      candidate => availableColumns.includes(candidate),
    );
    if (fallbackMatch) {
      return fallbackMatch;
    }
  }

  const titleMatch = findLoaderColumnByTitle(
    loaderColumns,
    [
      metricBaseColumn,
      String(datasourceColumn?.verbose_name || '').trim(),
      String(datasourceColumn?.column_name || '').trim(),
    ],
    availableColumns,
  );
  if (titleMatch) {
    return titleMatch;
  }

  const numericCandidates = availableColumns.filter(
    columnName =>
      !/^ou_level_\d+$/i.test(columnName) &&
      columnName !== 'period' &&
      !columnName.toLowerCase().includes('period'),
  );

  if (numericCandidates.length === 1) {
    return numericCandidates[0];
  }

  return directBaseMatch;
}
