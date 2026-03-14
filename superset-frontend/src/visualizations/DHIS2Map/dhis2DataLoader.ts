/*
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

import { SupersetClient } from '@superset-ui/core';
import {
  filterRowsAtTerminalOuLevel,
  getOrderedOuHierarchyColumns,
} from './ouTerminalLevel';

interface DHIS2Parameters {
  dataElements: string[];
  periods: string[];
  orgUnits: string[];
  includeChildren: boolean;
  dataLevelScope: string;
  endpoint?: string | null;
}

interface OrgUnitMetadata {
  id: string;
  displayName: string;
  level?: number;
  parent: any;
  path?: string;
}

interface DHIS2Data {
  rows: Record<string, any>[];
  columns: any[];
  total: number;
}

interface CacheEntry {
  timestamp: number;
  data: DHIS2Data;
}

export class DHIS2DataLoader {
  private static readonly CACHE_PREFIX = 'DHIS2_DATA_CACHE_';
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

  private static getCacheKey(databaseId: number, sql: string): string {
    // Create a simple hash of the SQL and database ID
    const hash = `${databaseId}_${sql}`.split('').reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);
    return `${this.CACHE_PREFIX}${Math.abs(hash)}`;
  }

  static getCachedData(databaseId: number, sql: string): DHIS2Data | null {
    try {
      const cacheKey = this.getCacheKey(databaseId, sql);
      const cached = localStorage.getItem(cacheKey);
      
      if (!cached) {
        return null;
      }

      const entry: CacheEntry = JSON.parse(cached);
      const now = Date.now();
      
      // Check if cache is still valid (5 minute TTL)
      if (now - entry.timestamp > this.CACHE_TTL_MS) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      // eslint-disable-next-line no-console
      console.log(`[DHIS2DataLoader] Cache hit for ${databaseId}, returning ${entry.data.rows.length} cached rows`);
      return entry.data;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[DHIS2DataLoader] Cache retrieval failed', e);
      return null;
    }
  }

  static cacheData(databaseId: number, sql: string, data: DHIS2Data): void {
    try {
      const cacheKey = this.getCacheKey(databaseId, sql);
      const entry: CacheEntry = {
        timestamp: Date.now(),
        data,
      };
      localStorage.setItem(cacheKey, JSON.stringify(entry));
      // eslint-disable-next-line no-console
      console.log(`[DHIS2DataLoader] Cached ${data.rows.length} rows for future use`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[DHIS2DataLoader] Failed to cache data', e);
    }
  }

  static clearCache(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Cache cleared');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[DHIS2DataLoader] Failed to clear cache', e);
    }
  }
  private static async fetchOrgUnitMetadata(
    databaseId: number,
    ids: string[],
  ): Promise<OrgUnitMetadata[]> {
    if (ids.length === 0) return [];

    const promises = ids.map(async id => {
      try {
        const response = await SupersetClient.get({
          endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=organisationUnits&search=${id}&staged=true`,
        });
        const items = response.json?.result || [];
        const item = items.find((i: any) => i.id === id);
        if (item) {
          return {
            id: item.id,
            displayName: item.displayName || item.name || id,
            level: item.level,
            parent: item.parent,
            path: item.path,
          };
        }
        return { id, displayName: id, level: 0, parent: null, path: undefined };
      } catch {
        return { id, displayName: id, level: 0, parent: null, path: undefined };
      }
    });

    return Promise.all(promises);
  }

  private static async fetchMetadata(
    databaseId: number,
    ids: string[],
    type: 'dataElements' | 'organisationUnits',
  ): Promise<Record<string, string>> {
    if (ids.length === 0) return {};

    try {
      const map: Record<string, string> = {};

      const dxTypes =
        type === 'dataElements'
          ? ['dataElements', 'indicators', 'dataSets', 'programIndicators']
          : [type];

      const fetchIdMetadata = async (id: string): Promise<void> => {
        // eslint-disable-next-line no-await-in-loop
        for (const dxType of dxTypes) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const response = await SupersetClient.get({
              endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=${dxType}&search=${id}&staged=true`,
            });
            const items = response.json?.result || [];
            const item = items.find((i: any) => i.id === id);
            if (item && item.displayName) {
              map[id] = item.displayName || item.name || id;
              return;
            }
          } catch {
            // Try next type
          }
        }
        if (!map[id]) {
          map[id] = id;
        }
      };

      const promises = ids.map(fetchIdMetadata);
      await Promise.all(promises);
      return map;
    } catch {
      return {};
    }
  }

  static parseDHIS2Parameters(sql: string): DHIS2Parameters | null {
    if (!sql) {
      // eslint-disable-next-line no-console
      console.warn('[DHIS2DataLoader] SQL is empty or null');
      return null;
    }

    // eslint-disable-next-line no-console
    console.log('[DHIS2DataLoader] Parsing SQL:', sql.substring(0, 200));

    const blockCommentMatch = sql.match(/\/\*\s*DHIS2:\s*(.+?)\s*\*\//i);

    if (!blockCommentMatch) {
      // eslint-disable-next-line no-console
      console.warn('[DHIS2DataLoader] No DHIS2 parameters found in SQL');
      return null;
    }

    const paramStr = blockCommentMatch[1].trim();
    // eslint-disable-next-line no-console
    console.log('[DHIS2DataLoader] Raw parameter string:', paramStr);
    const params: Record<string, string> = {};

    try {
      const decodedParamStr = decodeURIComponent(paramStr);
      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Decoded parameter string:', decodedParamStr);
      for (const param of decodedParamStr.split('&')) {
        if (param.includes('=')) {
          const [key, value] = param.split('=', 2);
          params[key.trim()] = value.trim();
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[DHIS2DataLoader] Failed to parse DHIS2 parameters', e);
      return null;
    }

    const deIds = params.dx ? params.dx.split(';').filter(Boolean) : [];
    const periodIds = params.pe ? params.pe.split(';').filter(Boolean) : [];
    const ouIds = params.ou ? params.ou.split(';').filter(Boolean) : [];
    const ouMode = params.ouMode || '';
    const includeChildren = ouMode.toUpperCase() === 'DESCENDANTS';
    const dataLevelScope = includeChildren ? 'all_levels' : 'selected';

    // eslint-disable-next-line no-console
    console.log('[DHIS2DataLoader] Parsed parameters:', {
      dataElements: deIds,
      periods: periodIds,
      orgUnits: ouIds,
      includeChildren,
      dataLevelScope,
    });

    if (deIds.length === 0 || periodIds.length === 0 || ouIds.length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[DHIS2DataLoader] One or more required parameters are empty:', {
        dataElements: deIds,
        periods: periodIds,
        orgUnits: ouIds,
      });
    }

    return {
      dataElements: deIds,
      periods: periodIds,
      orgUnits: ouIds,
      includeChildren,
      dataLevelScope,
      endpoint: params.endpoint || null,
    };
  }

  static async fetchChartData(
    databaseId: number,
    sql: string,
    limit: number = 10000,
    boundaryLevel?: number,
    parentId?: string | null,
  ): Promise<DHIS2Data | null> {
    // eslint-disable-next-line no-console
    console.log('[DHIS2DataLoader] fetchChartData called with:', {
      databaseId,
      sqlLength: sql?.length,
      limit,
      boundaryLevel,
      parentId,
    });

    // Check cache first - use base SQL as key since we always fetch full hierarchy
    // Level filtering happens on the returned data rows, not on the API call
    const cacheKey = sql;
    const cachedData = this.getCachedData(databaseId, cacheKey);
    if (cachedData) {
      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Returning cached data');
      if (boundaryLevel && boundaryLevel > 0 && cachedData.rows.length > 0) {
        const filteredRows = await this.filterRowsByHierarchyLevel(
          databaseId,
          cachedData.rows,
          boundaryLevel,
          parentId,
        );
        return {
          ...cachedData,
          rows: filteredRows,
          total: filteredRows.length,
        };
      }
      return cachedData;
    }

    const params = this.parseDHIS2Parameters(sql);

    if (!params) {
      const errorMsg = 'Invalid DHIS2 SQL format. Expected: /* DHIS2: dx=id1;id2&pe=period&ou=ouId */';
      // eslint-disable-next-line no-console
      console.error('[DHIS2DataLoader]', errorMsg);
      throw new Error(errorMsg);
    }

    // CRITICAL FIX: Do NOT override org units based on boundary level
    // Keep org units from the SQL comment - they define the hierarchy root (e.g., Uganda, Acholi Region)
    // DHIS2 API with ouMode=DESCENDANTS returns all descendants at ALL hierarchy levels
    // The dataset SQL returns all hierarchy level columns (National, Region, District, Facility, etc.)
    // By passing root org units, we get the complete hierarchy structure with all columns populated
    // Filtering by selected level happens on the returned DATA rows via the org unit path, not the API call
    if (boundaryLevel && boundaryLevel > 0) {
      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] User selected boundary level:', boundaryLevel, '- keeping original org units:', params.orgUnits, 'parentId:', parentId);
      // Org units remain unchanged from SQL - DHIS2 API will return full hierarchy
    }

    if (!params.dataElements || params.dataElements.length === 0) {
      const errorMsg = 'No data elements found in DHIS2 parameters';
      // eslint-disable-next-line no-console
      console.error('[DHIS2DataLoader]', errorMsg, params);
      throw new Error(errorMsg);
    }

    if (!params.periods || params.periods.length === 0) {
      const errorMsg = 'No periods found in DHIS2 parameters';
      // eslint-disable-next-line no-console
      console.error('[DHIS2DataLoader]', errorMsg, params);
      throw new Error(errorMsg);
    }

    if (!params.orgUnits || params.orgUnits.length === 0) {
      const errorMsg = 'No org units found in DHIS2 parameters';
      // eslint-disable-next-line no-console
      console.error('[DHIS2DataLoader]', errorMsg, params);
      throw new Error(errorMsg);
    }

    try {
      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Fetching metadata...');
      // Fetch metadata for proper display names
      const deMap = await this.fetchMetadata(
        databaseId,
        params.dataElements,
        'dataElements',
      );
      const ouMetadataList = await this.fetchOrgUnitMetadata(
        databaseId,
        params.orgUnits,
      );

      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Fetching column structure...');

      const columnsPayload = {
        data_elements: params.dataElements.map(id => ({
          id,
          displayName: deMap[id] || id,
        })),
        periods: params.periods.map(id => ({
          id,
          displayName: id.split('|')[1] || id,
        })),
        org_units: ouMetadataList,
        include_children: params.includeChildren,
        data_level_scope: params.dataLevelScope,
      };

      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Sending columns payload:', columnsPayload);
      const columnsResponse = await SupersetClient.post({
        endpoint: `/api/v1/database/${databaseId}/dhis2_preview/columns/`,
        jsonPayload: columnsPayload,
      });

      const columns = columnsResponse.json?.columns || [];
      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Columns response:', columnsResponse.json);

      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Fetching data...');

      const dataPayload = {
        data_elements: params.dataElements,
        periods: params.periods,
        org_units: ouMetadataList,
        endpoint: params.endpoint,
        limit,
        offset: 0,
        include_children: params.includeChildren,
        data_level_scope: params.dataLevelScope,
      };

      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Sending data payload:', dataPayload);
      const dataResponse = await SupersetClient.post({
        endpoint: `/api/v1/database/${databaseId}/dhis2_preview/data/`,
        jsonPayload: dataPayload,
      });

      let rows = dataResponse.json?.rows || [];
      const total = dataResponse.json?.total || 0;

      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Data response:', dataResponse.json);
      // eslint-disable-next-line no-console
      console.log('[DHIS2DataLoader] Fetched data:', {
        rowCount: rows.length,
        columnCount: columns.length,
        total,
        boundaryLevel,
        parentId,
      });

      if (rows.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[DHIS2DataLoader] No rows returned from API. Check that DHIS2 has data for the selected parameters.');
      }

      // If user selected a boundary level, fetch org unit paths to filter rows by level
      if (boundaryLevel && boundaryLevel > 0 && rows.length > 0) {
        try {
          rows = await this.filterRowsByHierarchyLevel(
            databaseId,
            rows,
            boundaryLevel,
            parentId,
          );
          // eslint-disable-next-line no-console
          console.log(`[DHIS2DataLoader] Filtered rows by level ${boundaryLevel}:`, rows.length, 'rows');
        } catch (error: any) {
          // eslint-disable-next-line no-console
          console.warn('[DHIS2DataLoader] Failed to filter rows by hierarchy level:', error);
        }
      }

      const result = {
        rows,
        columns,
        total,
      };

      // Cache the data for future use
      this.cacheData(databaseId, cacheKey, result);

      return result;
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.error('[DHIS2DataLoader] Failed to fetch chart data:', error);
      // eslint-disable-next-line no-console
      console.error('[DHIS2DataLoader] Error stack:', error.stack);
      throw error;
    }
  }

  private static async filterRowsByHierarchyLevel(
    databaseId: number,
    rows: Record<string, any>[],
    targetLevel: number,
    parentId?: string | null,
  ): Promise<Record<string, any>[]> {
    if (!rows || rows.length === 0) {
      return rows;
    }

    try {
      const hierarchyColumns = getOrderedOuHierarchyColumns(
        Array.from(
          new Set(
            rows.flatMap(row => Object.keys(row)).filter(columnName =>
              /^ou_level_\d+$/i.test(columnName),
            ),
          ),
        ),
      );
      const selectedHierarchyColumn = `ou_level_${targetLevel}`;

      if (hierarchyColumns.includes(selectedHierarchyColumn)) {
        // Keep only rows where the selected OU level is the last populated
        // hierarchy column for that record.
        return filterRowsAtTerminalOuLevel(
          rows,
          hierarchyColumns,
          selectedHierarchyColumn,
        );
      }

      // Get all unique org unit IDs from the rows
      const orgUnitIds = new Set<string>();
      rows.forEach(row => {
        Object.values(row).forEach(val => {
          if (typeof val === 'string' && val.match(/^[a-zA-Z][a-zA-Z0-9]{10}$/)) {
            orgUnitIds.add(val);
          }
        });
      });

      if (orgUnitIds.size === 0) {
        return rows;
      }

      // Fetch org unit metadata with paths
      const orgUnitMetadata = await this.fetchOrgUnitMetadata(
        databaseId,
        Array.from(orgUnitIds),
      );

      // Create a map of org unit ID to level (derived from path depth)
      const ouLevelMap: Record<string, number> = {};
      orgUnitMetadata.forEach((ou: any) => {
        if (ou.path) {
          // Path format: /Uganda/Region/District/Facility
          // Level = number of slashes - 1
          const level = (ou.path.match(/\//g) || []).length;
          ouLevelMap[ou.id] = level;
        }
      });

      // Filter rows: keep only those where the org unit is at the target level
      // For parent filtering, also check if parent matches
      const filteredRows = rows.filter(row => {
        // Find the org unit column in this row
        for (const value of Object.values(row)) {
          const ouId = String(value);
          if (ouId.match(/^[a-zA-Z][a-zA-Z0-9]{10}$/) && ouLevelMap[ouId] !== undefined) {
            const rowLevel = ouLevelMap[ouId];
            if (rowLevel === targetLevel) {
              // If parent filtering is active, check that this org unit is under the parent
              if (parentId) {
                const parentMetadata = orgUnitMetadata.find((ou: any) => ou.id === parentId);
                if (parentMetadata?.path) {
                  const ouMetadata = orgUnitMetadata.find((ou: any) => ou.id === ouId);
                  if (ouMetadata?.path?.startsWith(parentMetadata.path)) {
                    return true;
                  }
                }
              } else {
                return true;
              }
            }
            // Only check first org unit column per row
            break;
          }
        }
        return false;
      });

      return filteredRows;
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.error('[DHIS2DataLoader] Error filtering rows by hierarchy level:', error);
      return rows;
    }
  }
}
