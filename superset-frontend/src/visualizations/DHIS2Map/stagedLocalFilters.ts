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
  AggregationMethod,
  DHIS2DatasourceColumn,
} from './types';

export type StagedLocalQueryFilter = {
  column: string;
  operator: string;
  value?: any;
};

export type FocusedStagedLocalAggregateQuery = {
  aggregationMethod: Exclude<AggregationMethod, 'latest'>;
  groupByColumns: string[];
  metricColumn: string;
  metricAlias: string;
};

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

function normalizeStagedLocalFilterOperator(
  operator: unknown,
): string | undefined {
  const normalized = String(operator || '').trim().toLowerCase();
  switch (normalized) {
    case 'in':
      return 'in';
    case 'eq':
    case '==':
      return 'eq';
    case 'neq':
    case '!=':
    case '<>':
      return 'neq';
    case 'gt':
    case '>':
      return 'gt';
    case 'gte':
    case '>=':
      return 'gte';
    case 'lt':
    case '<':
      return 'lt';
    case 'lte':
    case '<=':
      return 'lte';
    case 'contains':
      return 'contains';
    case 'starts_with':
    case 'startswith':
      return 'starts_with';
    default:
      return undefined;
  }
}

function extractMetricBaseColumn(metric: string): string {
  const match = String(metric || '').match(
    /^(SUM|AVG|COUNT|MIN|MAX|STDDEV|VARIANCE|MEDIAN)\s*\(\s*([^)]+)\s*\)$/i,
  );
  return sanitizeDHIS2ColumnName(match?.[2]?.trim() || metric);
}

function normalizeSupportedAggregationMethod(
  aggregationMethod: AggregationMethod | undefined,
): Exclude<AggregationMethod, 'latest'> | undefined {
  const normalized = String(aggregationMethod || '').trim().toLowerCase();
  switch (normalized) {
    case 'sum':
    case 'average':
    case 'max':
    case 'min':
    case 'count':
      return normalized as Exclude<AggregationMethod, 'latest'>;
    default:
      return undefined;
  }
}

export function buildFocusedStagedLocalAggregateQuery(options: {
  aggregationMethod?: AggregationMethod;
  metric?: string;
  selectedOrgUnitColumn?: string;
  parentSelectionColumn?: string;
  tooltipColumns?: string[];
  datasourceColumns?: DHIS2DatasourceColumn[];
}): FocusedStagedLocalAggregateQuery | null {
  const normalizedAggregation = normalizeSupportedAggregationMethod(
    options.aggregationMethod,
  );
  const metricAlias = String(options.metric || '').trim();
  const metricColumn = extractMetricBaseColumn(metricAlias);
  const selectedOrgUnitColumn = sanitizeDHIS2ColumnName(
    String(options.selectedOrgUnitColumn || ''),
  );
  if (!normalizedAggregation || !metricAlias || !metricColumn || !selectedOrgUnitColumn) {
    return null;
  }

  const datasourceColumns = Array.isArray(options.datasourceColumns)
    ? options.datasourceColumns
    : [];
  const periodColumns = new Set(
    datasourceColumns
      .filter(column => {
        const extra = parseColumnExtra(column.extra);
        return (
          extra?.dhis2_is_period === true || extra?.dhis2IsPeriod === true
        );
      })
      .map(column => sanitizeDHIS2ColumnName(String(column.column_name || '')))
      .filter(Boolean),
  );

  const groupByColumns = Array.from(
    new Set(
      [
        options.parentSelectionColumn,
        selectedOrgUnitColumn,
        ...(options.tooltipColumns || []),
      ]
        .map(column => sanitizeDHIS2ColumnName(String(column || '')))
        .filter(
          column =>
            Boolean(column) &&
            column !== metricColumn &&
            !periodColumns.has(column),
        ),
    ),
  );

  if (!groupByColumns.length) {
    return null;
  }

  return {
    aggregationMethod: normalizedAggregation,
    groupByColumns,
    metricColumn,
    metricAlias,
  };
}

export function buildHierarchyColumns(
  boundaryLevelColumns: Record<number, string> = {},
): string[] {
  return Object.entries(boundaryLevelColumns)
    .map(([level, column]) => ({
      level: Number(level),
      column: sanitizeDHIS2ColumnName(String(column || '')),
    }))
    .filter(
      ({ level, column }) => Number.isFinite(level) && level > 0 && Boolean(column),
    )
    .sort((left, right) => left.level - right.level)
    .map(({ column }) => column)
    .filter((column, index, columns) => columns.indexOf(column) === index);
}

export function buildTerminalHierarchyQueryFilters(options: {
  selectedColumn?: string;
  hierarchyColumns?: string[];
}): StagedLocalQueryFilter[] {
  const selectedColumn = sanitizeDHIS2ColumnName(
    String(options.selectedColumn || ''),
  );
  const hierarchyColumns = Array.isArray(options.hierarchyColumns)
    ? options.hierarchyColumns.map(column =>
        sanitizeDHIS2ColumnName(String(column || '')),
      )
    : [];

  if (!selectedColumn || !hierarchyColumns.includes(selectedColumn)) {
    return [];
  }

  const selectedIndex = hierarchyColumns.indexOf(selectedColumn);
  return [
    {
      column: selectedColumn,
      operator: 'not_empty',
    },
    ...hierarchyColumns.slice(selectedIndex + 1).map(column => ({
      column,
      operator: 'is_empty',
    })),
  ];
}

export function buildFocusedStagedLocalQueryFilters(options: {
  parentSelectionColumn?: string;
  parentValues?: string[];
  activeFilters?: Array<{
    col?: string;
    op?: string;
    val?: any;
  }>;
  selectedOrgUnitColumn?: string;
  hierarchyColumns?: string[];
}): StagedLocalQueryFilter[] {
  const filters: StagedLocalQueryFilter[] = [];

  for (const filter of options.activeFilters || []) {
    const column = sanitizeDHIS2ColumnName(String(filter?.col || ''));
    const operator = normalizeStagedLocalFilterOperator(filter?.op);
    if (!column || !operator) {
      continue;
    }

    if (operator === 'in') {
      const values = Array.isArray(filter?.val)
        ? filter.val
            .map(value => String(value ?? '').trim())
            .filter(Boolean)
        : String(filter?.val ?? '').trim()
          ? [String(filter?.val).trim()]
          : [];
      if (!values.length) {
        continue;
      }
      filters.push({
        column,
        operator,
        value: values,
      });
      continue;
    }

    if (filter?.val === undefined || filter?.val === null) {
      continue;
    }
    if (typeof filter.val === 'string' && !filter.val.trim()) {
      continue;
    }

    filters.push({
      column,
      operator,
      value: filter.val,
    });
  }

  const parentSelectionColumn = sanitizeDHIS2ColumnName(
    String(options.parentSelectionColumn || ''),
  );
  const parentValues = Array.from(
    new Set(
      (options.parentValues || [])
        .map(value => String(value || '').trim())
        .filter(Boolean),
    ),
  );
  if (parentSelectionColumn && parentValues.length > 0) {
    filters.push({
      column: parentSelectionColumn,
      operator: 'in',
      value: parentValues,
    });
  }

  filters.push(
    ...buildTerminalHierarchyQueryFilters({
      selectedColumn: options.selectedOrgUnitColumn,
      hierarchyColumns: options.hierarchyColumns,
    }),
  );

  return filters.filter(
    (filter, index, allFilters) =>
      allFilters.findIndex(candidate => {
        const leftValue = Array.isArray(candidate.value)
          ? [...candidate.value].sort()
          : candidate.value;
        const rightValue = Array.isArray(filter.value)
          ? [...filter.value].sort()
          : filter.value;
        return (
          candidate.column === filter.column &&
          candidate.operator === filter.operator &&
          JSON.stringify(leftValue) === JSON.stringify(rightValue)
        );
      }) === index,
  );
}

export function serializeStagedLocalQueryFilters(
  filters: StagedLocalQueryFilter[],
): string {
  return JSON.stringify(
    filters.map(filter => ({
      column: filter.column,
      operator: filter.operator,
      value: Array.isArray(filter.value)
        ? [...filter.value].sort()
        : filter.value,
    })),
  );
}
