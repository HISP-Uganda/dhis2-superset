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

function parseDatasourceExtra(
  extra: unknown,
): Record<string, any> | undefined {
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

export function getDhis2LegendSetDatabaseId(
  datasource: Record<string, any> | undefined,
): number | undefined {
  const extra = parseDatasourceExtra(datasource?.extra);
  const stagedLocal =
    extra?.dhis2_staged_local === true ||
    extra?.dhis2_staged_local === 'true' ||
    extra?.dhis2StagedLocal === true ||
    extra?.dhis2StagedLocal === 'true';
  const databaseBackend = String(
    datasource?.database?.backend || datasource?.database?.engine || '',
  )
    .trim()
    .toLowerCase();
  const isDhis2Connection = databaseBackend.includes('dhis2');

  if (!stagedLocal && !isDhis2Connection) {
    return undefined;
  }

  const sourceDatabaseId = Number(
    extra?.dhis2_source_database_id ??
      extra?.source_database_id ??
      extra?.dhis2SourceDatabaseId ??
      datasource?.database?.id ??
      datasource?.database_id ??
      NaN,
  );
  if (Number.isFinite(sourceDatabaseId) && sourceDatabaseId > 0) {
    return sourceDatabaseId;
  }
  return undefined;
}
