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

export function hasDHIS2SqlComment(sql?: string | null): boolean {
  if (!sql) {
    return false;
  }
  return (
    /\/\*\s*DHIS2:\s*(.+?)\s*\*\//i.test(sql) ||
    /--\s*DHIS2:\s*(.+)$/im.test(sql)
  );
}

export function shouldResolveDHIS2DatasetSql({
  datasetId,
  datasetSql,
  isDHIS2Dataset,
  databaseId,
  sourceInstanceIds,
}: {
  datasetId?: number;
  datasetSql?: string | null;
  isDHIS2Dataset?: boolean;
  databaseId?: number;
  sourceInstanceIds?: number[];
}): boolean {
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
}: {
  databaseId?: number;
  datasetSql?: string | null;
  isDHIS2Dataset?: boolean;
}): boolean {
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
