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

type ColumnLike = {
  column_name?: string;
  columnName?: string;
  verbose_name?: string | null;
  extra?: unknown;
};

type MetricLike = {
  label?: string;
  hasCustomLabel?: boolean;
  expressionType?: string;
  aggregate?: string;
  sqlExpression?: string | null;
  column?: ColumnLike | null;
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

export function isDHIS2VariableColumn(column?: ColumnLike | null): boolean {
  if (!column) {
    return false;
  }
  const extra = parseColumnExtra(column.extra);
  return Boolean(extra?.dhis2_variable_id ?? extra?.dhis2VariableId);
}

export function cleanDHIS2MetricDisplayLabel(value: string): string {
  const trimmedValue = String(value || '').trim();
  if (!trimmedValue) {
    return '';
  }

  return trimmedValue
    .replace(/^\s*[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*\.\s*/, '')
    .replace(/_/g, ' ')
    .replace(/\(([^)]+)\)/g, ' $1 ')
    .replace(/\s*&\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\b([A-Za-z])\/([A-Za-z])\b/g, (_, left, right) =>
      `${String(left).toUpperCase()}/${String(right).toUpperCase()}`,
    )
    .trim();
}

export function getDHIS2MetricDefaultLabel(
  column?: ColumnLike | null,
): string | undefined {
  if (!isDHIS2VariableColumn(column)) {
    return undefined;
  }

  const verboseName = String(column?.verbose_name || '').trim();
  if (verboseName) {
    const cleanedVerboseName = cleanDHIS2MetricDisplayLabel(verboseName);
    if (cleanedVerboseName) {
      return cleanedVerboseName;
    }
  }

  const columnName = String(
    column?.column_name || column?.columnName || '',
  ).trim();
  if (!columnName) {
    return undefined;
  }

  return cleanDHIS2MetricDisplayLabel(columnName.replace(/^c_+/i, ''));
}

export function resolveDHIS2MetricLabel(metric?: MetricLike | null): string | undefined {
  if (!metric) {
    return undefined;
  }

  if (metric.hasCustomLabel && metric.label) {
    return String(metric.label).trim() || undefined;
  }

  if (metric.expressionType === 'SIMPLE') {
    const defaultLabel = getDHIS2MetricDefaultLabel(metric.column);
    if (defaultLabel) {
      return defaultLabel;
    }
  }

  return metric.label ? String(metric.label).trim() || undefined : undefined;
}

