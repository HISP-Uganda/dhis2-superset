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

/**
 * DHIS2 Data Cache Service
 *
 * A global caching layer for DHIS2 data that works across all chart types.
 * Uses IndexedDB for persistent storage and provides:
 *
 * 1. Fast cache lookups (~1ms vs 5-30s API calls)
 * 2. Stale-while-revalidate pattern for instant loading
 * 3. Background data refresh
 * 4. Cache invalidation and management
 * 5. Integration with Superset's chart data flow
 */

import { isDirectDhis2Datasource } from 'src/utils/dhis2Datasource';

// Configuration
const CACHE_DB_NAME = 'superset_dhis2_cache';
const CACHE_DB_VERSION = 2;
const DATA_STORE = 'chart_data';
const METADATA_STORE = 'metadata';
const DEFAULT_TTL_HOURS = 2;
const MAX_CACHE_SIZE_MB = 100;

// Types
export interface CachedChartData {
  key: string;
  datasourceId: number;
  datasourceType: string;
  queryHash: string;
  data: any[];
  colnames: string[];
  coltypes: number[];
  rowcount: number;
  timestamp: number;
  ttlMs: number;
  accessCount: number;
  lastAccess: number;
  sizeBytes: number;
  isDHIS2: boolean;
  isStale?: boolean;
}

export interface CacheStats {
  totalEntries: number;
  totalSizeMB: number;
  dhis2Entries: number;
  hitRate: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

export interface QueryContext {
  datasource: {
    id: number;
    type: string;
  };
  queries: any[];
  form_data?: Record<string, any>;
  result_format?: string;
  result_type?: string;
}

// Singleton instance
let cacheInstance: DHIS2DataCacheService | null = null;

/**
 * Global DHIS2 Data Cache Service
 */
class DHIS2DataCacheService {
  private db: IDBDatabase | null = null;

  private isInitializing = false;

  private initPromise: Promise<void> | null = null;

  private stats = { hits: 0, misses: 0 };

  constructor() {
    this.initPromise = this.initDB();
  }

  /**
   * Initialize IndexedDB
   */
  private async initDB(): Promise<void> {
    if (this.db || this.isInitializing) {
      return this.initPromise || Promise.resolve();
    }

    if (typeof indexedDB === 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[DHIS2Cache] IndexedDB not available');
      return Promise.resolve();
    }

    this.isInitializing = true;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

      request.onerror = () => {
        this.isInitializing = false;
        // eslint-disable-next-line no-console
        console.error('[DHIS2Cache] Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitializing = false;
        // eslint-disable-next-line no-console
        console.log('[DHIS2Cache] IndexedDB initialized');
        resolve();
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Chart data store
        if (!db.objectStoreNames.contains(DATA_STORE)) {
          const dataStore = db.createObjectStore(DATA_STORE, {
            keyPath: 'key',
          });
          dataStore.createIndex('datasourceId', 'datasourceId', {
            unique: false,
          });
          dataStore.createIndex('timestamp', 'timestamp', { unique: false });
          dataStore.createIndex('lastAccess', 'lastAccess', { unique: false });
          dataStore.createIndex('isDHIS2', 'isDHIS2', { unique: false });
        }

        // Metadata store (org units, levels, etc.)
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          const metaStore = db.createObjectStore(METADATA_STORE, {
            keyPath: 'key',
          });
          metaStore.createIndex('type', 'type', { unique: false });
          metaStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * Ensure DB is ready
   */
  private async ensureDB(): Promise<boolean> {
    if (this.db) return true;
    if (this.initPromise) {
      await this.initPromise;
      return !!this.db;
    }
    return false;
  }

  /**
   * Generate cache key from query context
   */
  generateCacheKey(queryContext: QueryContext): string {
    const { datasource, queries, form_data } = queryContext;

    // Create a deterministic hash of the query
    const queryData = {
      datasourceId: datasource.id,
      datasourceType: datasource.type,
      queries: queries.map(q => ({
        filters: q.filters,
        columns: q.columns,
        metrics: q.metrics,
        orderby: q.orderby,
        row_limit: q.row_limit,
        time_range: q.time_range,
        granularity: q.granularity,
        extras: q.extras,
      })),
      formData: form_data
        ? {
            time_range: form_data.time_range,
            granularity_sqla: form_data.granularity_sqla,
            filters: form_data.filters,
          }
        : null,
    };

    const jsonStr = JSON.stringify(queryData);
    return `ds${datasource.id}_${this.hashString(jsonStr)}`;
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Check if a datasource is DHIS2
   */
  isDHIS2Datasource(datasource: any): boolean {
    return isDirectDhis2Datasource(datasource);
  }

  /**
   * Get cached data
   */
  async get(key: string): Promise<CachedChartData | null> {
    if (!(await this.ensureDB())) return null;

    return new Promise(resolve => {
      const transaction = this.db!.transaction([DATA_STORE], 'readwrite');
      const store = transaction.objectStore(DATA_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const cached = request.result as CachedChartData | undefined;

        if (!cached) {
          this.stats.misses += 1;
          resolve(null);
          return;
        }

        // Check if expired
        const isExpired = Date.now() - cached.timestamp > cached.ttlMs;
        if (isExpired) {
          // Return stale data but mark for refresh
          this.stats.hits += 1;
          // eslint-disable-next-line no-console
          console.log(`[DHIS2Cache] Stale hit for ${key} (expired)`);
          resolve({ ...cached, isStale: true });
          return;
        }

        // Update access stats
        cached.accessCount += 1;
        cached.lastAccess = Date.now();
        store.put(cached);

        this.stats.hits += 1;
        // eslint-disable-next-line no-console
        console.log(`[DHIS2Cache] Hit for ${key}: ${cached.rowcount} rows`);
        resolve(cached);
      };

      request.onerror = () => {
        this.stats.misses += 1;
        resolve(null);
      };
    });
  }

  /**
   * Store data in cache
   */
  async set(
    key: string,
    queryContext: QueryContext,
    response: any,
    isDHIS2: boolean,
    ttlHours: number = DEFAULT_TTL_HOURS,
  ): Promise<void> {
    if (!(await this.ensureDB())) return;

    const result = response.result?.[0] || response;
    const data = result.data || [];
    const colnames = result.colnames || Object.keys(data[0] || {});
    const coltypes = result.coltypes || [];

    const sizeBytes = new Blob([JSON.stringify(data)]).size;

    // Evict if needed before storing
    await this.evictIfNeeded(sizeBytes);

    const cached: CachedChartData = {
      key,
      datasourceId: queryContext.datasource.id,
      datasourceType: queryContext.datasource.type,
      queryHash: key,
      data,
      colnames,
      coltypes,
      rowcount: data.length,
      timestamp: Date.now(),
      ttlMs: ttlHours * 60 * 60 * 1000,
      accessCount: 1,
      lastAccess: Date.now(),
      sizeBytes,
      isDHIS2,
    };

    await new Promise<void>(resolve => {
      const transaction = this.db!.transaction([DATA_STORE], 'readwrite');
      const store = transaction.objectStore(DATA_STORE);
      store.put(cached);

      transaction.oncomplete = () => {
        // eslint-disable-next-line no-console
        console.log(
          `[DHIS2Cache] Stored ${data.length} rows (${(sizeBytes / 1024).toFixed(1)} KB) for ${key}`,
        );
        resolve();
      };

      transaction.onerror = () => resolve();
    });
  }

  /**
   * Evict old/least used entries if over size limit
   */
  private async evictIfNeeded(newDataSize: number): Promise<void> {
    if (!(await this.ensureDB())) return;

    await new Promise<void>(resolve => {
      const transaction = this.db!.transaction([DATA_STORE], 'readwrite');
      const store = transaction.objectStore(DATA_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const allCached = request.result as CachedChartData[];
        const totalSize = allCached.reduce((sum, c) => sum + c.sizeBytes, 0);
        const maxSize = MAX_CACHE_SIZE_MB * 1024 * 1024;

        if (totalSize + newDataSize <= maxSize) {
          resolve();
          return;
        }

        // Sort by score (older and less accessed = lower score)
        allCached.sort((a, b) => {
          const scoreA =
            a.accessCount * 0.3 + (a.lastAccess / 1000000000) * 0.7;
          const scoreB =
            b.accessCount * 0.3 + (b.lastAccess / 1000000000) * 0.7;
          return scoreA - scoreB;
        });

        // Evict until we have space
        let freedSpace = 0;
        const targetFree = newDataSize + maxSize * 0.1;

        for (const entry of allCached) {
          if (totalSize - freedSpace + newDataSize <= maxSize - targetFree) {
            break;
          }
          store.delete(entry.key);
          freedSpace += entry.sizeBytes;
          // eslint-disable-next-line no-console
          console.log(`[DHIS2Cache] Evicted ${entry.key}`);
        }

        resolve();
      };

      request.onerror = () => resolve();
    });
  }

  /**
   * Invalidate cache entries
   */
  async invalidate(datasourceId?: number): Promise<number> {
    if (!(await this.ensureDB())) return 0;

    return new Promise(resolve => {
      const transaction = this.db!.transaction([DATA_STORE], 'readwrite');
      const store = transaction.objectStore(DATA_STORE);
      let count = 0;

      if (datasourceId) {
        const index = store.index('datasourceId');
        const request = index.openCursor(IDBKeyRange.only(datasourceId));

        request.onsuccess = event => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            cursor.delete();
            count += 1;
            cursor.continue();
          }
        };
      } else {
        const request = store.clear();
        request.onsuccess = () => {
          count = -1; // Indicate all cleared
        };
      }

      transaction.oncomplete = () => {
        // eslint-disable-next-line no-console
        console.log(
          `[DHIS2Cache] Invalidated ${count === -1 ? 'all' : count} entries`,
        );
        resolve(count);
      };

      transaction.onerror = () => resolve(0);
    });
  }

  /**
   * Invalidate all DHIS2 entries
   */
  async invalidateDHIS2(): Promise<number> {
    if (!(await this.ensureDB())) return 0;

    return new Promise(resolve => {
      const transaction = this.db!.transaction([DATA_STORE], 'readwrite');
      const store = transaction.objectStore(DATA_STORE);
      const index = store.index('isDHIS2');
      const request = index.openCursor(IDBKeyRange.only(true));
      let count = 0;

      request.onsuccess = event => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          count += 1;
          cursor.continue();
        }
      };

      transaction.oncomplete = () => {
        // eslint-disable-next-line no-console
        console.log(`[DHIS2Cache] Invalidated ${count} DHIS2 entries`);
        resolve(count);
      };

      transaction.onerror = () => resolve(0);
    });
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    if (!(await this.ensureDB())) {
      return {
        totalEntries: 0,
        totalSizeMB: 0,
        dhis2Entries: 0,
        hitRate: 0,
        oldestEntry: null,
        newestEntry: null,
      };
    }

    return new Promise(resolve => {
      const transaction = this.db!.transaction([DATA_STORE], 'readonly');
      const store = transaction.objectStore(DATA_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const allCached = request.result as CachedChartData[];

        if (allCached.length === 0) {
          resolve({
            totalEntries: 0,
            totalSizeMB: 0,
            dhis2Entries: 0,
            hitRate: this.getHitRate(),
            oldestEntry: null,
            newestEntry: null,
          });
          return;
        }

        const totalSize = allCached.reduce((sum, c) => sum + c.sizeBytes, 0);
        const dhis2Count = allCached.filter(c => c.isDHIS2).length;
        const timestamps = allCached.map(c => c.timestamp);

        resolve({
          totalEntries: allCached.length,
          totalSizeMB: totalSize / (1024 * 1024),
          dhis2Entries: dhis2Count,
          hitRate: this.getHitRate(),
          oldestEntry: new Date(Math.min(...timestamps)),
          newestEntry: new Date(Math.max(...timestamps)),
        });
      };

      request.onerror = () =>
        resolve({
          totalEntries: 0,
          totalSizeMB: 0,
          dhis2Entries: 0,
          hitRate: 0,
          oldestEntry: null,
          newestEntry: null,
        });
    });
  }

  /**
   * Get hit rate percentage
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return Math.round((this.stats.hits / total) * 100);
  }

  /**
   * Clear all cache
   */
  async clearAll(): Promise<void> {
    if (!(await this.ensureDB())) return;

    await new Promise<void>(resolve => {
      const transaction = this.db!.transaction(
        [DATA_STORE, METADATA_STORE],
        'readwrite',
      );
      transaction.objectStore(DATA_STORE).clear();
      transaction.objectStore(METADATA_STORE).clear();

      transaction.oncomplete = () => {
        this.stats = { hits: 0, misses: 0 };
        // eslint-disable-next-line no-console
        console.log('[DHIS2Cache] All cache cleared');
        resolve();
      };

      transaction.onerror = () => resolve();
    });
  }
}

/**
 * Get the singleton cache instance
 */
export function getDHIS2DataCache(): DHIS2DataCacheService {
  if (!cacheInstance) {
    cacheInstance = new DHIS2DataCacheService();
  }
  return cacheInstance;
}

/**
 * Wrapper for chart data fetching with caching
 * This can be used to wrap the standard Superset chart data API calls
 */
export async function fetchChartDataWithCache(
  queryContext: QueryContext,
  fetchFn: () => Promise<any>,
  options: {
    forceRefresh?: boolean;
    ttlHours?: number;
    isDHIS2?: boolean;
  } = {},
): Promise<{ data: any; fromCache: boolean; isStale?: boolean }> {
  const cache = getDHIS2DataCache();
  const {
    forceRefresh = false,
    ttlHours = DEFAULT_TTL_HOURS,
    isDHIS2,
  } = options;

  const cacheKey = cache.generateCacheKey(queryContext);

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await cache.get(cacheKey);

    if (cached) {
      const { isStale } = cached;

      // If stale, trigger background refresh
      if (isStale) {
        // Fire and forget background refresh
        fetchFn()
          .then(response => {
            cache.set(
              cacheKey,
              queryContext,
              response,
              isDHIS2 ?? false,
              ttlHours,
            );
          })
          .catch(() => {
            // Ignore background refresh errors
          });
      }

      // Return cached data (including stale)
      return {
        data: {
          result: [
            {
              data: cached.data,
              colnames: cached.colnames,
              coltypes: cached.coltypes,
              rowcount: cached.rowcount,
            },
          ],
        },
        fromCache: true,
        isStale,
      };
    }
  }

  // Cache miss or force refresh - fetch from API
  const startTime = performance.now();
  const response = await fetchFn();
  const fetchTime = performance.now() - startTime;

  // eslint-disable-next-line no-console
  console.log(`[DHIS2Cache] Fetched data in ${fetchTime.toFixed(0)}ms`);

  // Cache the response
  await cache.set(cacheKey, queryContext, response, isDHIS2 ?? false, ttlHours);

  return {
    data: response,
    fromCache: false,
  };
}

/**
 * Background preloading status tracker
 */
const preloadingInProgress: Set<number> = new Set();

/**
 * Preload DHIS2 dataset data in the background when a dataset is selected.
 * This ensures data is available by the time the user finishes configuring a chart.
 *
 * @param datasourceId - The dataset ID
 * @param datasourceType - The datasource type (typically 'table')
 * @param datasource - The full datasource object with SQL and metadata
 */
export async function preloadDHIS2DatasetData(
  datasourceId: number,
  datasourceType: string,
  datasource?: {
    sql?: string;
    database?: { id: number; backend?: string };
  },
): Promise<void> {
  // Prevent duplicate preloading
  if (preloadingInProgress.has(datasourceId)) {
    // eslint-disable-next-line no-console
    console.log(
      `[DHIS2Cache] Preloading already in progress for dataset ${datasourceId}`,
    );
    return;
  }

  const cache = getDHIS2DataCache();

  // Check if datasource is DHIS2
  if (datasource && !cache.isDHIS2Datasource(datasource)) {
    // eslint-disable-next-line no-console
    console.log(`[DHIS2Cache] Dataset ${datasourceId} is not DHIS2, skipping preload`);
    return;
  }

  preloadingInProgress.add(datasourceId);
  // eslint-disable-next-line no-console
  console.log(`[DHIS2Cache] 🚀 Starting background preload for dataset ${datasourceId}`);

  try {
    const { SupersetClient } = await import('@superset-ui/core');
    const databaseId = datasource?.database?.id;

    if (!databaseId) {
      // eslint-disable-next-line no-console
      console.warn(`[DHIS2Cache] No database ID for dataset ${datasourceId}`);
      return;
    }

    // Use the dhis2_chart_data endpoint to preload data
    // This uses the same data loading path as the actual chart
    const response = await SupersetClient.post({
      endpoint: `/api/v1/database/${databaseId}/dhis2_chart_data/`,
      jsonPayload: {
        sql: datasource.sql || '',
        limit: 50000, // Preload a large chunk
      },
      timeout: 300000, // 5 minute timeout for preloading (runs in background)
    });

    if (response?.json) {
      const result = response.json;

      // Generate a cache key for this dataset
      const queryContext: QueryContext = {
        datasource: {
          id: datasourceId,
          type: datasourceType,
        },
        queries: [{}], // Empty query means "all data"
      };

      const cacheKey = `ds${datasourceId}_preload`;

      // Store in cache
      await cache.set(cacheKey, queryContext, result, true, 4); // 4 hour TTL

      // eslint-disable-next-line no-console
      console.log(
        `[DHIS2Cache] ✅ Preloaded ${result.data?.length || 0} rows for dataset ${datasourceId}`,
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `[DHIS2Cache] Background preload failed for dataset ${datasourceId}:`,
      error,
    );
    // Don't throw - this is a background operation
  } finally {
    preloadingInProgress.delete(datasourceId);
  }
}

/**
 * Check if dataset is currently being preloaded
 */
export function isPreloadingDataset(datasourceId: number): boolean {
  return preloadingInProgress.has(datasourceId);
}

/**
 * Get preloaded data for a dataset if available
 */
export async function getPreloadedData(
  datasourceId: number,
): Promise<CachedChartData | null> {
  const cache = getDHIS2DataCache();
  const cacheKey = `ds${datasourceId}_preload`;
  return cache.get(cacheKey);
}

export { DHIS2DataCacheService };
