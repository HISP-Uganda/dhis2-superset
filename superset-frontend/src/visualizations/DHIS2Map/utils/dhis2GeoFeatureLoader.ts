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

import { SupersetClient } from '@superset-ui/core';

/**
 * GeoJSON Feature structure from DHIS2
 */
export interface DHIS2GeoJSONFeature {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Point' | 'Polygon' | 'MultiPolygon';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: {
    id: string;
    name: string;
    level: number;
    parent?: string;
    parentName?: string;
    hasCoordinatesDown?: boolean;
    hasCoordinatesUp?: boolean;
    [key: string]: any;
  };
}

/**
 * GeoJSON FeatureCollection structure
 */
export interface DHIS2GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: DHIS2GeoJSONFeature[];
}

/**
 * GeoFeature structure from DHIS2 geoFeatures endpoint
 */
export interface DHIS2GeoFeature {
  id: string;
  na: string; // name
  le: number; // level
  ty: number; // type (1=Point, 2=Polygon, 3=MultiPolygon)
  co: string; // coordinates JSON string
  pg?: string; // parent graph
  pn?: string; // parent name
  pi?: string; // parent id
  hcd?: boolean; // has coordinates down
  hcu?: boolean; // has coordinates up
}

/**
 * Options for loading geo features
 */
export interface GeoFeatureLoadOptions {
  /** Database ID for the DHIS2 connection */
  databaseId: number;
  /** Organization unit levels to load (e.g., [1, 2, 3]) */
  levels: number[];
  /** Parent organization unit IDs to filter by (optional) */
  parentOuIds?: string[];
  /** Which endpoint to use: 'geoFeatures' (default) or 'geoJSON' */
  endpoint?: 'geoFeatures' | 'geoJSON';
  /** Whether to include org units without coordinates */
  includeWithoutCoordinates?: boolean;
  /** Cache key prefix for storage */
  cacheKeyPrefix?: string;
  /** Cache duration in milliseconds (default: 24 hours for persistent storage) */
  cacheDuration?: number;
  /** Force refresh from server (bypasses cache) */
  forceRefresh?: boolean;
  /** Enable background refresh when cache is stale but usable */
  enableBackgroundRefresh?: boolean;
}

/**
 * Result from loading geo features
 */
export interface GeoFeatureLoadResult {
  /** Features grouped by level */
  featuresByLevel: Map<number, DHIS2GeoJSONFeature[]>;
  /** All features combined */
  allFeatures: DHIS2GeoJSONFeature[];
  /** Total count of features loaded */
  totalCount: number;
  /** Whether data was loaded from cache */
  fromCache: boolean;
  /** Whether cache is being refreshed in background */
  backgroundRefreshInProgress: boolean;
  /** Load time in milliseconds */
  loadTimeMs: number;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Cache structure for geo features
 */
interface GeoFeatureCache {
  features: DHIS2GeoJSONFeature[];
  timestamp: number;
  levels: number[];
  parentOuIds?: string[];
  endpoint: 'geoFeatures' | 'geoJSON';
  databaseId: number;
}

// Cache durations
const DEFAULT_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours for persistent storage
const STALE_THRESHOLD = 4 * 60 * 60 * 1000; // 4 hours - after this, trigger background refresh

// IndexedDB configuration
const DB_NAME = 'dhis2_geo_cache';
const DB_VERSION = 1;
const STORE_NAME = 'boundaries';

// In-memory cache for fastest access
const memoryCache = new Map<string, GeoFeatureCache>();

// Track ongoing background refreshes to prevent duplicates
const backgroundRefreshInProgress = new Set<string>();

/**
 * Initialize IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('databaseId', 'databaseId', { unique: false });
      }
    };
  });
}

/**
 * Save cache to IndexedDB
 */
async function saveToIndexedDB(
  cacheKey: string,
  cache: GeoFeatureCache,
): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.put({ cacheKey, ...cache });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
    // eslint-disable-next-line no-console
    console.log(
      `[GeoFeatureLoader] Saved ${cache.features.length} features to IndexedDB`,
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[GeoFeatureLoader] Failed to save to IndexedDB:', error);
  }
}

/**
 * Load cache from IndexedDB
 */
async function loadFromIndexedDB(
  cacheKey: string,
): Promise<GeoFeatureCache | null> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const result = await new Promise<any>((resolve, reject) => {
      const request = store.get(cacheKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();

    if (result) {
      // Remove cacheKey from result as it's not part of GeoFeatureCache
      const { cacheKey: _, ...cache } = result;
      return cache as GeoFeatureCache;
    }
    return null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[GeoFeatureLoader] Failed to load from IndexedDB:', error);
    return null;
  }
}

/**
 * Delete cache from IndexedDB
 */
async function deleteFromIndexedDB(cacheKey: string): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(cacheKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[GeoFeatureLoader] Failed to delete from IndexedDB:', error);
  }
}

/**
 * Convert DHIS2 geoFeature format to GeoJSON Feature format
 */
function convertGeoFeatureToGeoJSON(
  geoFeature: DHIS2GeoFeature,
): DHIS2GeoJSONFeature | null {
  try {
    if (!geoFeature.co) {
      return null;
    }

    // Parse coordinates from JSON string
    let coordinates: any;
    try {
      coordinates = JSON.parse(geoFeature.co);
    } catch {
      return null;
    }

    // Determine geometry type based on ty field
    let geometryType: 'Point' | 'Polygon' | 'MultiPolygon';
    switch (geoFeature.ty) {
      case 1:
        geometryType = 'Point';
        break;
      case 2:
        geometryType = 'Polygon';
        break;
      case 3:
        geometryType = 'MultiPolygon';
        break;
      default:
        if (
          Array.isArray(coordinates) &&
          coordinates.length === 2 &&
          typeof coordinates[0] === 'number'
        ) {
          geometryType = 'Point';
        } else if (
          Array.isArray(coordinates) &&
          Array.isArray(coordinates[0]) &&
          Array.isArray(coordinates[0][0]) &&
          Array.isArray(coordinates[0][0][0])
        ) {
          geometryType = 'MultiPolygon';
        } else {
          geometryType = 'Polygon';
        }
    }

    return {
      type: 'Feature',
      id: geoFeature.id,
      geometry: {
        type: geometryType,
        coordinates,
      },
      properties: {
        id: geoFeature.id,
        name: geoFeature.na,
        level: geoFeature.le,
        parent: geoFeature.pi,
        parentName: geoFeature.pn,
        hasCoordinatesDown: geoFeature.hcd,
        hasCoordinatesUp: geoFeature.hcu,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Load geo features using the geoFeatures endpoint
 */
async function loadViaGeoFeaturesEndpoint(
  databaseId: number,
  levels: number[],
  parentOuIds?: string[],
): Promise<DHIS2GeoJSONFeature[]> {
  const allFeatures: DHIS2GeoJSONFeature[] = [];

  const ouParts: string[] = [];
  levels.forEach(level => {
    ouParts.push(`LEVEL-${level}`);
  });
  if (parentOuIds && parentOuIds.length > 0) {
    ouParts.push(...parentOuIds);
  }

  const ouDimension = ouParts.join(';');

  // eslint-disable-next-line no-console
  console.log('[GeoFeatureLoader] loadViaGeoFeaturesEndpoint:', {
    databaseId,
    levels,
    parentOuIds,
    ouDimension,
    ouParts,
  });

  try {
    const response = await SupersetClient.get({
      endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/`,
      searchParams: {
        type: 'geoFeatures',
        ou: ouDimension,
      },
    });

    // eslint-disable-next-line no-console
    console.log('[GeoFeatureLoader] API response received:', {
      featureCount: response.json?.result?.length || 0,
      levels,
      ouDimension,
    });

    const geoFeatures: DHIS2GeoFeature[] = response.json?.result || [];

    for (const gf of geoFeatures) {
      const feature = convertGeoFeatureToGeoJSON(gf);
      if (feature) {
        allFeatures.push(feature);
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[GeoFeatureLoader] Error loading geoFeatures:', error);
    throw error;
  }

  return allFeatures;
}

/**
 * Load geo features using the GeoJSON endpoint
 */
async function loadViaGeoJSONEndpoint(
  databaseId: number,
  levels: number[],
  parentOuIds?: string[],
): Promise<DHIS2GeoJSONFeature[]> {
  const allFeatures: DHIS2GeoJSONFeature[] = [];

  try {
    const response = await SupersetClient.get({
      endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/`,
      searchParams: {
        type: 'geoJSON',
        levels: levels.join(','),
        parents: parentOuIds?.join(',') || '',
      },
    });

    const featureCollection: DHIS2GeoJSONFeatureCollection = response.json
      ?.result || { type: 'FeatureCollection', features: [] };

    if (featureCollection.features) {
      allFeatures.push(...featureCollection.features);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[GeoFeatureLoader] Error loading GeoJSON:', error);
    throw error;
  }

  return allFeatures;
}

/**
 * Get cache key for the given options
 */
function getCacheKey(options: GeoFeatureLoadOptions): string {
  const prefix = options.cacheKeyPrefix || 'dhis2_geo';
  const levels = options.levels.sort((a, b) => a - b).join('_');
  const parents = options.parentOuIds?.sort().join('_') || 'all';
  const endpoint = options.endpoint || 'geoFeatures';
  return `${prefix}_db${options.databaseId}_${endpoint}_L${levels}_P${parents}`;
}

/**
 * Check if cache is valid (not expired)
 */
function isCacheValid(
  cache: GeoFeatureCache,
  options: GeoFeatureLoadOptions,
): boolean {
  const duration = options.cacheDuration || DEFAULT_CACHE_DURATION;
  const now = Date.now();

  if (now - cache.timestamp > duration) {
    return false;
  }

  // Check if levels match
  const cachedLevels = new Set(cache.levels);
  const requestedLevels = new Set(options.levels);
  if (
    cachedLevels.size !== requestedLevels.size ||
    ![...cachedLevels].every(l => requestedLevels.has(l))
  ) {
    return false;
  }

  // Check if parents match
  const cachedParents = new Set(cache.parentOuIds || []);
  const requestedParents = new Set(options.parentOuIds || []);
  if (
    cachedParents.size !== requestedParents.size ||
    ![...cachedParents].every(p => requestedParents.has(p))
  ) {
    return false;
  }

  return true;
}

/**
 * Check if cache is stale (valid but should be refreshed in background)
 */
function isCacheStale(cache: GeoFeatureCache): boolean {
  const now = Date.now();
  return now - cache.timestamp > STALE_THRESHOLD;
}

/**
 * Load from cache (memory first, then IndexedDB)
 */
async function loadFromCache(
  options: GeoFeatureLoadOptions,
): Promise<GeoFeatureCache | null> {
  const cacheKey = getCacheKey(options);

  // Check memory cache first (fastest)
  const memCached = memoryCache.get(cacheKey);
  if (memCached && isCacheValid(memCached, options)) {
    return memCached;
  }

  // Check IndexedDB (persistent)
  const dbCached = await loadFromIndexedDB(cacheKey);
  if (dbCached && isCacheValid(dbCached, options)) {
    // Update memory cache for faster subsequent access
    memoryCache.set(cacheKey, dbCached);
    return dbCached;
  }

  return null;
}

/**
 * Save to cache (both memory and IndexedDB)
 */
async function saveToCache(
  options: GeoFeatureLoadOptions,
  features: DHIS2GeoJSONFeature[],
): Promise<void> {
  const cacheKey = getCacheKey(options);
  const cache: GeoFeatureCache = {
    features,
    timestamp: Date.now(),
    levels: options.levels,
    parentOuIds: options.parentOuIds,
    endpoint: options.endpoint || 'geoFeatures',
    databaseId: options.databaseId,
  };

  // Save to memory cache
  memoryCache.set(cacheKey, cache);

  // Save to IndexedDB (async, don't block)
  saveToIndexedDB(cacheKey, cache).catch(() => {
    // Silently fail - memory cache still works
  });
}

/**
 * Perform background refresh of cache
 */
async function backgroundRefresh(options: GeoFeatureLoadOptions): Promise<void> {
  const cacheKey = getCacheKey(options);

  // Prevent duplicate background refreshes
  if (backgroundRefreshInProgress.has(cacheKey)) {
    return;
  }

  backgroundRefreshInProgress.add(cacheKey);

  // eslint-disable-next-line no-console
  console.log('[GeoFeatureLoader] Starting background refresh for:', cacheKey);

  try {
    let features: DHIS2GeoJSONFeature[];
    if (options.endpoint === 'geoJSON') {
      features = await loadViaGeoJSONEndpoint(
        options.databaseId,
        options.levels,
        options.parentOuIds,
      );
    } else {
      features = await loadViaGeoFeaturesEndpoint(
        options.databaseId,
        options.levels,
        options.parentOuIds,
      );
    }

    if (features.length > 0) {
      await saveToCache(options, features);
      // eslint-disable-next-line no-console
      console.log(
        `[GeoFeatureLoader] Background refresh complete: ${features.length} features`,
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[GeoFeatureLoader] Background refresh failed:', error);
  } finally {
    backgroundRefreshInProgress.delete(cacheKey);
  }
}

/**
 * Group features by level
 */
function groupFeaturesByLevel(
  features: DHIS2GeoJSONFeature[],
): Map<number, DHIS2GeoJSONFeature[]> {
  const featuresByLevel = new Map<number, DHIS2GeoJSONFeature[]>();
  for (const feature of features) {
    const { level } = feature.properties;
    if (!featuresByLevel.has(level)) {
      featuresByLevel.set(level, []);
    }
    featuresByLevel.get(level)!.push(feature);
  }
  return featuresByLevel;
}

/**
 * Load DHIS2 geo features for multiple levels at once
 *
 * Features:
 * - Persistent storage using IndexedDB (survives browser restarts)
 * - Memory cache for fastest access
 * - Background refresh when cache is stale
 * - Multiple levels loaded in single request
 *
 * @example
 * ```typescript
 * const result = await loadDHIS2GeoFeatures({
 *   databaseId: 2,
 *   levels: [2, 3, 4],
 *   endpoint: 'geoFeatures',
 *   enableBackgroundRefresh: true,
 * });
 *
 * // Access features by level
 * const level2Features = result.featuresByLevel.get(2);
 * ```
 */
export async function loadDHIS2GeoFeatures(
  options: GeoFeatureLoadOptions,
): Promise<GeoFeatureLoadResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const cacheKey = getCacheKey(options);

  // eslint-disable-next-line no-console
  console.log('[GeoFeatureLoader] Loading geo features:', {
    databaseId: options.databaseId,
    levels: options.levels,
    endpoint: options.endpoint || 'geoFeatures',
    forceRefresh: options.forceRefresh,
  });

  // eslint-disable-next-line no-console
  console.log('[GeoFeatureLoader] Cache key generated:', {
    cacheKey,
    requestedLevels: options.levels,
  });

  // Check cache first (unless force refresh)
  if (!options.forceRefresh) {
    const cached = await loadFromCache(options);
    if (cached) {
      const isStale = isCacheStale(cached);

      // eslint-disable-next-line no-console
      console.log('[GeoFeatureLoader] Cache hit:', {
        featureCount: cached.features.length,
        cachedLevels: cached.levels,
        requestedLevels: options.levels,
        levelsMatch: JSON.stringify(cached.levels?.sort()) === JSON.stringify(options.levels?.sort()),
        isStale,
      });

      // Trigger background refresh if stale
      if (isStale && options.enableBackgroundRefresh !== false) {
        backgroundRefresh(options);
      }

      return {
        featuresByLevel: groupFeaturesByLevel(cached.features),
        allFeatures: cached.features,
        totalCount: cached.features.length,
        fromCache: true,
        backgroundRefreshInProgress: backgroundRefreshInProgress.has(cacheKey),
        loadTimeMs: Date.now() - startTime,
        errors: [],
      };
    }
  }

  // Load from API
  let allFeatures: DHIS2GeoJSONFeature[] = [];

  try {
    if (options.endpoint === 'geoJSON') {
      allFeatures = await loadViaGeoJSONEndpoint(
        options.databaseId,
        options.levels,
        options.parentOuIds,
      );
    } else {
      allFeatures = await loadViaGeoFeaturesEndpoint(
        options.databaseId,
        options.levels,
        options.parentOuIds,
      );
    }

    // Verify loaded features have correct levels
    const featureLevelCounts: Record<number, number> = {};
    allFeatures.forEach(f => {
      const level = f.properties.level;
      featureLevelCounts[level] = (featureLevelCounts[level] || 0) + 1;
    });

    // eslint-disable-next-line no-console
    console.log('[GeoFeatureLoader] Features loaded from API:', {
      totalFeatures: allFeatures.length,
      requestedLevels: options.levels,
      featureLevelCounts,
      sampleFeature: allFeatures[0]?.properties,
    });
  } catch (error: any) {
    errors.push(error.message || 'Unknown error loading geo features');
    // eslint-disable-next-line no-console
    console.error('[GeoFeatureLoader] API error:', error);
  }

  // Save to cache if we got features
  if (allFeatures.length > 0) {
    await saveToCache(options, allFeatures);
  }

  return {
    featuresByLevel: groupFeaturesByLevel(allFeatures),
    allFeatures,
    totalCount: allFeatures.length,
    fromCache: false,
    backgroundRefreshInProgress: false,
    loadTimeMs: Date.now() - startTime,
    errors,
  };
}

/**
 * Clear cached geo features
 *
 * @param databaseId - Optional database ID to clear cache for specific database
 * @param cacheKeyPrefix - Optional prefix to match specific cache entries
 */
export async function clearGeoFeatureCache(
  databaseId?: number,
  cacheKeyPrefix?: string,
): Promise<void> {
  const prefix = cacheKeyPrefix || 'dhis2_geo';

  // Clear memory cache
  const keysToDelete: string[] = [];
  memoryCache.forEach((_, key) => {
    if (key.startsWith(prefix)) {
      if (databaseId === undefined || key.includes(`_db${databaseId}_`)) {
        keysToDelete.push(key);
      }
    }
  });
  keysToDelete.forEach(key => memoryCache.delete(key));

  // Clear IndexedDB
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // Get all keys and delete matching ones
    const allKeys = await new Promise<string[]>((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });

    for (const key of allKeys) {
      if (key.startsWith(prefix)) {
        if (databaseId === undefined || key.includes(`_db${databaseId}_`)) {
          await deleteFromIndexedDB(key);
        }
      }
    }

    db.close();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[GeoFeatureLoader] Failed to clear IndexedDB cache:', error);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[GeoFeatureLoader] Cleared ${keysToDelete.length} cache entries`,
  );
}

/**
 * Preload geo features for commonly used levels
 * Useful for warming up the cache on app initialization
 */
export async function preloadGeoFeatures(
  databaseId: number,
  levels: number[] = [1, 2, 3, 4],
  endpoint: 'geoFeatures' | 'geoJSON' = 'geoFeatures',
): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `[GeoFeatureLoader] Preloading levels ${levels.join(', ')} for database ${databaseId}`,
  );

  try {
    await loadDHIS2GeoFeatures({
      databaseId,
      levels,
      endpoint,
      enableBackgroundRefresh: false, // Don't trigger another refresh during preload
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[GeoFeatureLoader] Preload failed:', error);
  }
}

/**
 * Get cache statistics
 */
export async function getGeoFeatureCacheStats(): Promise<{
  memoryCacheSize: number;
  indexedDBSize: number;
  entries: Array<{
    key: string;
    featureCount: number;
    age: number;
    isStale: boolean;
  }>;
}> {
  const entries: Array<{
    key: string;
    featureCount: number;
    age: number;
    isStale: boolean;
  }> = [];

  // Memory cache stats
  memoryCache.forEach((cache, key) => {
    entries.push({
      key,
      featureCount: cache.features.length,
      age: Date.now() - cache.timestamp,
      isStale: isCacheStale(cache),
    });
  });

  // IndexedDB stats
  let indexedDBSize = 0;
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    indexedDBSize = await new Promise<number>((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();
  } catch {
    // Ignore
  }

  return {
    memoryCacheSize: memoryCache.size,
    indexedDBSize,
    entries,
  };
}

export default loadDHIS2GeoFeatures;

