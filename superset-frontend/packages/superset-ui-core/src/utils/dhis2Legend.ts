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
import getMetricLabel from '../query/getMetricLabel';
import type { Datasource } from '../query/types/Datasource';

type DatasourceColumn = {
  column_name?: string;
  verbose_name?: string;
  extra?: unknown;
};

export interface DHIS2LegendItem {
  id?: string | null;
  label?: string | null;
  startValue?: number | null;
  endValue?: number | null;
  color: string;
}

export interface DHIS2LegendDefinition {
  source?: string;
  setId?: string | null;
  setName?: string | null;
  min?: number | null;
  max?: number | null;
  items: DHIS2LegendItem[];
}

function sanitizeDHIS2ColumnName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  let sanitized = name.trim();
  sanitized = sanitized.replace(/[\W]/gu, '_');
  sanitized = sanitized.replace(/_+/g, '_');
  sanitized = sanitized.replace(/^_+|_+$/g, '');

  return sanitized;
}

function findOriginalColumnName(
  sanitizedName: string,
  availableColumns: string[],
): string | undefined {
  if (!sanitizedName || availableColumns.length === 0) {
    return undefined;
  }

  if (availableColumns.includes(sanitizedName)) {
    return sanitizedName;
  }

  return availableColumns.find(
    columnName => sanitizeDHIS2ColumnName(columnName) === sanitizedName,
  );
}

function findMetricColumn(
  metricExpression: string,
  availableColumns: string[],
): string | undefined {
  if (!metricExpression || availableColumns.length === 0) {
    return undefined;
  }

  const sanitizedMetric = sanitizeDHIS2ColumnName(metricExpression);
  const metricLower = sanitizedMetric.toLowerCase();

  if (
    metricLower === 'period' ||
    metricLower === 'level' ||
    metricLower === 'time' ||
    metricLower === 'date'
  ) {
    return undefined;
  }

  const directMatch = findOriginalColumnName(sanitizedMetric, availableColumns);
  if (directMatch) {
    const directLower = directMatch.toLowerCase();
    if (
      directLower !== 'period' &&
      directLower !== 'level' &&
      directLower !== 'time' &&
      directLower !== 'date'
    ) {
      return directMatch;
    }
  }

  const aggFunctionMatch = metricExpression.match(
    /^(SUM|AVG|COUNT|MIN|MAX|STDDEV|VARIANCE|MEDIAN)\s*\(\s*([^)]+)\s*\)$/i,
  );

  if (aggFunctionMatch) {
    const innerColumn = aggFunctionMatch[2].trim();
    const extractedMatch = findOriginalColumnName(
      sanitizeDHIS2ColumnName(innerColumn),
      availableColumns,
    );
    if (extractedMatch) {
      return extractedMatch;
    }
  }

  return availableColumns.find(columnName => {
    const columnSanitized = sanitizeDHIS2ColumnName(columnName).toLowerCase();
    return (
      columnSanitized.includes(metricLower) &&
      !columnSanitized.includes('period') &&
      !columnSanitized.includes('level') &&
      !columnSanitized.includes('time') &&
      !columnSanitized.includes('date')
    );
  });
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

function resolveMetricReference(metric: unknown): string {
  if (metric == null) {
    return '';
  }

  try {
    return String(getMetricLabel(metric as any) || '').trim();
  } catch {
    return String((metric as any)?.label ?? metric).trim();
  }
}

function getDatasourceColumns(
  datasource?: Partial<Datasource> | { columns?: unknown[] },
): DatasourceColumn[] {
  const rawColumns = (datasource as { columns?: unknown[] } | undefined)?.columns;
  if (!Array.isArray(rawColumns)) {
    return [];
  }
  return rawColumns.filter(
    (column): column is DatasourceColumn =>
      Boolean(column) && typeof column === 'object',
  );
}

export function parseDHIS2LegendDefinition(
  value: unknown,
): DHIS2LegendDefinition | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Record<string, any>;
  if (!Array.isArray(candidate.items) || candidate.items.length === 0) {
    return undefined;
  }

  const items = candidate.items.reduce<DHIS2LegendDefinition['items']>(
    (result, item) => {
      if (!item || typeof item !== 'object') {
        return result;
      }

      const rawItem = item as Record<string, any>;
      const color = String(rawItem.color ?? '').trim();
      if (!color) {
        return result;
      }

      const startValue =
        rawItem.startValue == null || rawItem.startValue === ''
          ? undefined
          : Number(rawItem.startValue);
      const endValue =
        rawItem.endValue == null || rawItem.endValue === ''
          ? undefined
          : Number(rawItem.endValue);

      result.push({
        id:
          rawItem.id === undefined || rawItem.id === null
            ? undefined
            : String(rawItem.id),
        label:
          rawItem.label === undefined || rawItem.label === null
            ? undefined
            : String(rawItem.label),
        startValue: Number.isFinite(startValue) ? startValue : undefined,
        endValue: Number.isFinite(endValue) ? endValue : undefined,
        color,
      });
      return result;
    },
    [],
  );

  if (!items.length) {
    return undefined;
  }

  const minCandidate =
    candidate.min == null || candidate.min === ''
      ? undefined
      : Number(candidate.min);
  const maxCandidate =
    candidate.max == null || candidate.max === ''
      ? undefined
      : Number(candidate.max);

  return {
    source:
      candidate.source === undefined || candidate.source === null
        ? undefined
        : String(candidate.source),
    setId:
      candidate.setId === undefined || candidate.setId === null
        ? undefined
        : String(candidate.setId),
    setName:
      candidate.setName === undefined || candidate.setName === null
        ? undefined
        : String(candidate.setName),
    min: Number.isFinite(minCandidate) ? minCandidate : undefined,
    max: Number.isFinite(maxCandidate) ? maxCandidate : undefined,
    items,
  };
}

export function getNormalizedDHIS2LegendItems(
  legendDefinition?: DHIS2LegendDefinition,
): DHIS2LegendItem[] {
  if (!legendDefinition?.items?.length) {
    return [];
  }

  return [...legendDefinition.items]
    .filter(
      item =>
        Boolean(item?.color) &&
        (item?.startValue !== undefined ||
          item?.endValue !== undefined ||
          item?.label),
    )
    .sort((left, right) => {
      const leftStart =
        left.startValue === undefined || left.startValue === null
          ? Number.NEGATIVE_INFINITY
          : left.startValue;
      const rightStart =
        right.startValue === undefined || right.startValue === null
          ? Number.NEGATIVE_INFINITY
          : right.startValue;

      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      const leftEnd =
        left.endValue === undefined || left.endValue === null
          ? Number.POSITIVE_INFINITY
          : left.endValue;
      const rightEnd =
        right.endValue === undefined || right.endValue === null
          ? Number.POSITIVE_INFINITY
          : right.endValue;

      return leftEnd - rightEnd;
    });
}

export function hasDHIS2LegendItems(
  legendDefinition?: DHIS2LegendDefinition,
): legendDefinition is DHIS2LegendDefinition {
  return getNormalizedDHIS2LegendItems(legendDefinition).length > 0;
}

export function formatDHIS2LegendItemLabel(
  item: DHIS2LegendItem,
  formatter?: (value: number) => string,
): string {
  const formatValue = formatter ?? (value => `${value}`);
  if (item.label) {
    return item.label;
  }
  if (
    typeof item.startValue === 'number' &&
    Number.isFinite(item.startValue) &&
    typeof item.endValue === 'number' &&
    Number.isFinite(item.endValue)
  ) {
    return `${formatValue(item.startValue)} - ${formatValue(item.endValue)}`;
  }
  if (typeof item.startValue === 'number' && Number.isFinite(item.startValue)) {
    return `>= ${formatValue(item.startValue)}`;
  }
  if (typeof item.endValue === 'number' && Number.isFinite(item.endValue)) {
    return `<= ${formatValue(item.endValue)}`;
  }
  return item.color;
}

export function resolveDHIS2LegendDefinition(
  datasource: Partial<Datasource> | { columns?: unknown[] } | undefined,
  metric: unknown,
): DHIS2LegendDefinition | undefined {
  const columns = getDatasourceColumns(datasource);
  if (!columns.length) {
    return undefined;
  }

  const availableColumnNames = columns
    .map(column => String(column.column_name ?? '').trim())
    .filter(Boolean);
  const metricReference = resolveMetricReference(metric);
  const sanitizedMetricReference = sanitizeDHIS2ColumnName(metricReference);

  const matchedColumnName =
    findMetricColumn(metricReference, availableColumnNames) ||
    availableColumnNames.find(
      columnName =>
        columnName === metricReference ||
        sanitizeDHIS2ColumnName(columnName) === sanitizedMetricReference,
    );

  const matchedColumn =
    columns.find(
      column =>
        String(column.column_name ?? '').trim() === matchedColumnName,
    ) ||
    columns.find(
      column =>
        String(column.verbose_name ?? '').trim() === metricReference ||
        sanitizeDHIS2ColumnName(String(column.verbose_name ?? '').trim()) ===
          sanitizedMetricReference,
    );

  const extra = parseColumnExtra(matchedColumn?.extra);
  return parseDHIS2LegendDefinition(extra?.dhis2_legend ?? extra?.dhis2Legend);
}

function matchesLegendItem(
  item: DHIS2LegendItem,
  value: number,
  index: number,
  items: DHIS2LegendItem[],
): boolean {
  const hasLowerBound =
    typeof item.startValue === 'number' && Number.isFinite(item.startValue);
  const hasUpperBound =
    typeof item.endValue === 'number' && Number.isFinite(item.endValue);
  const lowerMatches = !hasLowerBound || value >= (item.startValue as number);
  const upperMatches =
    !hasUpperBound ||
    value < (item.endValue as number) ||
    (index === items.length - 1 && value <= (item.endValue as number));
  return lowerMatches && upperMatches;
}

export function getDHIS2LegendIndexForValue(
  value: number,
  legendDefinition?: DHIS2LegendDefinition,
): number {
  const items = getNormalizedDHIS2LegendItems(legendDefinition);
  if (!items.length || !Number.isFinite(value)) {
    return 0;
  }

  for (let index = 0; index < items.length; index += 1) {
    if (matchesLegendItem(items[index], value, index, items)) {
      return index + 1;
    }
  }

  const firstItem = items[0];
  const lastItem = items[items.length - 1];
  if (
    typeof firstItem.startValue === 'number' &&
    Number.isFinite(firstItem.startValue) &&
    value < firstItem.startValue
  ) {
    return 1;
  }
  if (
    typeof lastItem.endValue === 'number' &&
    Number.isFinite(lastItem.endValue) &&
    value > lastItem.endValue
  ) {
    return items.length;
  }
  return 0;
}

export function getDHIS2LegendColorForValue(
  value: number,
  legendDefinition?: DHIS2LegendDefinition,
): string | undefined {
  const items = getNormalizedDHIS2LegendItems(legendDefinition);
  const colorIndex = getDHIS2LegendIndexForValue(value, legendDefinition);
  if (!items.length || colorIndex <= 0) {
    return undefined;
  }
  return items[colorIndex - 1]?.color;
}

export function getDHIS2LegendRange(
  legendDefinition?: DHIS2LegendDefinition,
): { min: number; max: number } | undefined {
  const items = getNormalizedDHIS2LegendItems(legendDefinition);
  if (!items.length) {
    return undefined;
  }

  if (
    typeof legendDefinition?.min === 'number' &&
    Number.isFinite(legendDefinition.min) &&
    typeof legendDefinition?.max === 'number' &&
    Number.isFinite(legendDefinition.max)
  ) {
    return {
      min: legendDefinition.min,
      max: legendDefinition.max,
    };
  }

  const min = items.find(item => Number.isFinite(item.startValue as number))
    ?.startValue;
  const max = [...items]
    .reverse()
    .find(item => Number.isFinite(item.endValue as number))?.endValue;

  if (typeof min === 'number' && typeof max === 'number') {
    return { min, max };
  }
  return undefined;
}

export function buildDHIS2LegendPieces(
  legendDefinition?: DHIS2LegendDefinition,
  formatter?: (value: number) => string,
) {
  return getNormalizedDHIS2LegendItems(legendDefinition).map(item => {
    const piece: Record<string, any> = {
      label: formatDHIS2LegendItemLabel(item, formatter),
      color: item.color,
    };

    if (typeof item.startValue === 'number' && Number.isFinite(item.startValue)) {
      piece.min = item.startValue;
    }
    if (typeof item.endValue === 'number' && Number.isFinite(item.endValue)) {
      piece.max = item.endValue;
    }
    return piece;
  });
}
