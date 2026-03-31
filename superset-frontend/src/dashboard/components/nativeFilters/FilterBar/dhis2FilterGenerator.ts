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
  makeApi,
  SupersetClient,
  Filter,
  Filters,
  isNativeFilter,
} from '@superset-ui/core';
import { nanoid } from 'nanoid';
import { DASHBOARD_ROOT_ID } from 'src/dashboard/util/constants';
import { getInitialDataMask } from 'src/dataMask/reducer';

const NATIVE_FILTER_PREFIX = 'NATIVE_FILTER-';

/** Shape of a single filter descriptor from the backend blueprint. */
export interface BlueprintFilter {
  key: string;
  label: string;
  column_name: string;
  filter_type: string; // "filter_select"
  category: string; // "ou_hierarchy" | "ou_group" | "ou_group_set" | "period_hierarchy"
  cascade_parent_key: string | null;
  order: number;
  targets?: { datasetId: number; column: { name: string } }[];
  extra?: Record<string, unknown>;
}

export interface BlueprintResponse {
  dashboard_id: number;
  dataset_count: number;
  filters: BlueprintFilter[];
}

/**
 * Fetch the DHIS2 filter blueprint from the dashboard API.
 */
export async function fetchDhis2FilterBlueprint(
  dashboardId: number,
): Promise<BlueprintResponse> {
  const { json } = await SupersetClient.get({
    endpoint: `/api/v1/dashboard/${dashboardId}/dhis2-filter-blueprint`,
  });
  return json?.result as BlueprintResponse;
}

/**
 * Convert a filter blueprint into Superset native filter configurations.
 *
 * Each blueprint filter becomes a `filter_select` native filter.
 * Cascading parent references are resolved to filter IDs.
 *
 * @param blueprint  - The blueprint response from the backend
 * @param existingFilters - Currently configured filters (to detect duplicates)
 * @returns Array of native filter config objects ready for the PUT endpoint
 */
export function blueprintToNativeFilters(
  blueprint: BlueprintResponse,
  existingFilters: Filters = {},
): Record<string, unknown>[] {
  if (!blueprint?.filters?.length) return [];

  // Check which columns already have filters to avoid duplicates
  const existingColumnNames = new Set(
    Object.values(existingFilters)
      .filter(
        (f): f is Filter => isNativeFilter(f) && !!f?.targets?.[0]?.column?.name,
      )
      .map(f => f.targets[0].column!.name),
  );

  // Filter out blueprint items that already have a corresponding native filter
  const newBlueprint = blueprint.filters.filter(
    bf => !existingColumnNames.has(bf.column_name),
  );

  if (!newBlueprint.length) return [];

  // Generate IDs for new filters, keyed by blueprint key
  const idMap: Record<string, string> = {};
  newBlueprint.forEach(bf => {
    idMap[bf.key] = `${NATIVE_FILTER_PREFIX}${nanoid()}`;
  });

  return newBlueprint.map(bf => {
    const filterId = idMap[bf.key];

    // Resolve cascade parent
    const cascadeParentId = bf.cascade_parent_key
      ? idMap[bf.cascade_parent_key] ?? null
      : null;
    const cascadeParentIds = cascadeParentId ? [cascadeParentId] : [];

    // Use the first target's datasetId, or fall back to any available
    const targets = bf.targets?.length
      ? [bf.targets[0]]
      : [];

    // Multi-select for all filters; period filters sort ascending
    const isPeriod = bf.category === 'period_hierarchy';
    const controlValues: Record<string, unknown> = {
      multiSelect: true,
      enableEmptyFilter: false,
      defaultToFirstItem: false,
      inverseSelection: false,
      searchAllOptions: false,
      sortAscending: isPeriod,
    };

    return {
      id: filterId,
      name: bf.label,
      filterType: 'filter_select',
      targets,
      defaultDataMask: getInitialDataMask(filterId),
      cascadeParentId,
      cascadeParentIds,
      scope: {
        rootPath: [DASHBOARD_ROOT_ID],
        excluded: [],
      },
      controlValues,
      type: 'NativeFilter',
      description: `Auto-generated DHIS2 ${bf.category.replace(/_/g, ' ')} filter`,
    };
  });
}

/**
 * Generate and save DHIS2 cascade filters for a dashboard.
 *
 * Fetches the blueprint, converts to native filters, and saves
 * via the dashboard filters PUT endpoint.
 *
 * @returns The number of new filters created, or 0 if none needed.
 */
export async function generateDhis2Filters(
  dashboardId: number,
  existingFilters: Filters = {},
): Promise<{ created: number; filters: Record<string, unknown>[] }> {
  const blueprint = await fetchDhis2FilterBlueprint(dashboardId);
  const newFilters = blueprintToNativeFilters(blueprint, existingFilters);

  if (!newFilters.length) {
    return { created: 0, filters: [] };
  }

  const updateFilters = makeApi<
    { modified: Record<string, unknown>[] },
    { result: unknown }
  >({
    method: 'PUT',
    endpoint: `/api/v1/dashboard/${dashboardId}/filters`,
  });

  await updateFilters({ modified: newFilters });

  return { created: newFilters.length, filters: newFilters };
}
