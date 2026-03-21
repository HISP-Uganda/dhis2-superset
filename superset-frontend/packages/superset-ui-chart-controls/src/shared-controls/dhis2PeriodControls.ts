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
  name?: string;
  extra?: unknown;
};

type DatasourceLike = {
  extra?: unknown;
  sql?: string;
  columns?: DatasourceColumn[];
};

type PeriodOption = {
  value?: string | number | null;
  label?: string | null;
};

type PeriodFilterResponse = {
  period_filter?: {
    options?: PeriodOption[];
  } | null;
};

const STAGED_LOCAL_SERVING_SQL_PATTERN =
  /select\s+\*\s+from\s+(?:[`"]?[a-z_][\w]*[`"]?\.)?[`"]?sv_(\d+)_[a-z0-9_]+[`"]?/i;

function parseExtra(extra: unknown): Record<string, any> | undefined {
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

export function resolveDhis2PeriodColumnName(
  datasource?: DatasourceLike | null,
): string | undefined {
  const columns = Array.isArray(datasource?.columns) ? datasource?.columns : [];
  const explicitPeriodColumn = columns.find(column => {
    const extra = parseExtra(column.extra);
    return extra?.dhis2_is_period === true;
  });
  if (explicitPeriodColumn?.column_name) {
    return explicitPeriodColumn.column_name;
  }

  const namedPeriodColumn = columns.find(column =>
    ['period', 'pe'].includes(
      String(column.column_name || column.name || '')
        .trim()
        .toLowerCase(),
    ),
  );
  if (namedPeriodColumn?.column_name) {
    return namedPeriodColumn.column_name;
  }

  return undefined;
}

export function resolveDhis2StagedDatasetId(
  datasource?: DatasourceLike | null,
): number | undefined {
  const extra = parseExtra(datasource?.extra);
  const explicitId = Number(
    extra?.dhis2_staged_dataset_id ?? extra?.dhis2StagedDatasetId ?? NaN,
  );
  if (Number.isFinite(explicitId) && explicitId > 0) {
    return explicitId;
  }

  const sql = String(datasource?.sql || '').trim();
  const sqlMatch = sql.match(STAGED_LOCAL_SERVING_SQL_PATTERN);
  if (sqlMatch?.[1]) {
    const sqlId = Number(sqlMatch[1]);
    if (Number.isFinite(sqlId) && sqlId > 0) {
      return sqlId;
    }
  }

  return undefined;
}

export function buildDhis2PeriodFilterEndpoint(
  datasource?: DatasourceLike | null,
): string | undefined {
  const stagedDatasetId = resolveDhis2StagedDatasetId(datasource);
  if (!stagedDatasetId) {
    return undefined;
  }
  return `/api/v1/dhis2/staged-datasets/${stagedDatasetId}/filters`;
}

export function getDhis2PeriodFilterChoices(
  response: Record<string, any>,
): [string, string][] {
  const result = (response?.result || {}) as PeriodFilterResponse;
  return Array.from(
    new Set(
      (result.period_filter?.options || [])
        .map(option => {
          const value = String(option?.value || '').trim();
          const label = String(option?.label || value).trim();
          if (!value) {
            return null;
          }
          return JSON.stringify([value, label]);
        })
        .filter(Boolean) as string[],
    ),
  )
    .map(item => JSON.parse(item) as [string, string])
    .sort((left, right) => right[0].localeCompare(left[0]));
}
