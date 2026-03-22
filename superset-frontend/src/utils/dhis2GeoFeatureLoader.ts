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
  /** Optional chart id for public/guest-safe metadata fallback */
  chartId?: number;
  /** Optional dashboard id for guest dashboard metadata fallback */
  dashboardId?: number;
  /** Optional DHIS2 instance IDs to scope staged/local boundary loading */
  sourceInstanceIds?: number[];
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
  /** Enable progressive/chunked loading for large datasets */
  enableProgressiveLoading?: boolean;
  /** Chunk size for progressive loading (default: 1000 features) */
  chunkSize?: number;
  /** Callback for each chunk loaded (for progressive rendering) */
  onChunkLoaded?: (chunk: DHIS2GeoJSONFeature[], progress: number, isComplete: boolean) => void;
  /** Use Web Worker for parsing (offloads work from main thread) */
  useWebWorker?: boolean;
}

/**
 * Cache metrics for monitoring performance
 */
export interface CacheMetrics {
  /** Cache source: 'memory', 'indexeddb', or 'api' */
  source: 'memory' | 'indexeddb' | 'api';
  /** Cache age in milliseconds */
  cacheAge: number;
  /** Cache staleness status */
  staleness: 'fresh' | 'stale' | 'expired' | 'none';
  /** Whether background refresh was queued */
  backgroundRefreshQueued: boolean;
  /** Cache key used */
  cacheKey: string;
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
  /** Cache metrics for monitoring */
  cacheMetrics?: CacheMetrics;
  /**
   * True when the backend returned status="pending" — boundaries are being
   * prepared asynchronously.  The caller should display a friendly message
   * and retry after `retryAfterMs`.
   */
  pendingRetry?: boolean;
  /** Milliseconds to wait before retrying when pendingRetry is true */
  retryAfterMs?: number;
}

/**
 * Cache structure for geo features
 */
interface GeoFeatureCache {
  features: DHIS2GeoJSONFeature[];
  timestamp: number;
  sourceInstanceIds?: number[];
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

function shouldTryPublicChartFallback(
  error: unknown,
  chartId?: number,
): boolean {
  if (!chartId) {
    return false;
  }
  const status = Number((error as any)?.status);
  const message = String(
    (error as any)?.message ||
      (error as any)?.error ||
      (error as any)?.response?.statusText ||
      '',
  ).toLowerCase();
  return (
    [400, 401, 403, 404].includes(status) ||
    !Number.isFinite(status) ||
    message.includes('missing authorization') ||
    message.includes('unexpected token') ||
    message.includes('<!doctype') ||
    message.includes('<html')
  );
}

function buildMetadataSearchParams(
  params: Record<string, string | undefined>,
): Record<string, string> {
  return Object.entries(params).reduce<Record<string, string>>(
    (result, [key, value]) => {
      if (value !== undefined) {
        result[key] = value;
      }
      return result;
    },
    {},
  );
}

async function fetchDHIS2MetadataWithPublicFallback(
  options: GeoFeatureLoadOptions,
  params: Record<string, string | undefined>,
) {
  const chartContextParams = {
    slice_id: options.chartId ? String(options.chartId) : undefined,
    dashboard_id: options.dashboardId
      ? String(options.dashboardId)
      : undefined,
  };
  const searchParams = buildMetadataSearchParams({
    ...params,
    ...chartContextParams,
  });

  try {
    return await SupersetClient.get({
      endpoint: `/api/v1/database/${options.databaseId}/dhis2_metadata/`,
      searchParams,
    });
  } catch (error) {
    if (!shouldTryPublicChartFallback(error, options.chartId)) {
      throw error;
    }

    return SupersetClient.get({
      endpoint: `/api/v1/database/${options.databaseId}/dhis2_metadata_public/`,
      searchParams: buildMetadataSearchParams({
        ...params,
        ...chartContextParams,
      }),
    });
  }
}

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
 * Detect coordinate nesting depth to determine geometry type
 * Point: [lng, lat] - depth 1
 * Polygon: [[[lng, lat], ...]] - depth 3  
 * MultiPolygon: [[[[lng, lat], ...]]] - depth 4
 */
function detectCoordinateDepth(coords: any): number {
  if (!Array.isArray(coords)) return 0;
  if (coords.length === 0) return 1;
  if (typeof coords[0] === 'number') return 1;
  return 1 + detectCoordinateDepth(coords[0]);
}

/**
 * Normalize coordinates to proper GeoJSON structure
 * DHIS2 sometimes stores Polygons with wrong nesting level
 */
function normalizeCoordinates(
  coords: any,
  targetType: 'Point' | 'Polygon' | 'MultiPolygon',
): any {
  const depth = detectCoordinateDepth(coords);

  if (targetType === 'Point') {
    // Point should be [lng, lat]
    if (depth === 1) return coords;
    // If nested, extract the first coordinate
    let c = coords;
    while (Array.isArray(c) && Array.isArray(c[0])) {
      c = c[0];
    }
    return c;
  }
  
  if (targetType === 'Polygon') {
    // Polygon should be [[[lng, lat], ...]] - depth 3
    if (depth === 3) return coords;
    if (depth === 4) {
      // It's actually a MultiPolygon with one polygon, extract it
      return coords[0];
    }
    if (depth === 2) {
      // Missing outer ring array, wrap it
      return [coords];
    }
    return coords;
  }
  
  if (targetType === 'MultiPolygon') {
    // MultiPolygon should be [[[[lng, lat], ...]]] - depth 4
    if (depth === 4) return coords;
    if (depth === 3) {
      // It's actually a Polygon, wrap it to make MultiPolygon
      return [coords];
    }
    return coords;
  }
  
  return coords;
}

/**
 * Parse geoFeatures using Web Worker (non-blocking)
 */
async function parseGeoFeaturesInWorker(
  geoFeatures: DHIS2GeoFeature[],
): Promise<DHIS2GeoJSONFeature[]> {
  return new Promise((resolve, reject) => {
    try {
      // Create worker from separate file
      const worker = new Worker(
        new URL('./dhis2GeoFeatureWorker.ts', import.meta.url),
      );

      worker.onmessage = (e: MessageEvent) => {
        const response = e.data;

        if (response.type === 'result') {
          worker.terminate();
          resolve(response.features);
        } else if (response.type === 'error') {
          worker.terminate();
          reject(new Error(response.error));
        }
      };

      worker.onerror = (error: ErrorEvent) => {
        worker.terminate();
        reject(error);
      };

      // Send data to worker
      worker.postMessage({
        type: 'parse',
        geoFeatures,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[GeoFeatureLoader] Worker not supported, falling back to main thread');
      reject(error);
    }
  });
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

    // Detect actual coordinate depth
    const depth = detectCoordinateDepth(coordinates);

    // Determine geometry type based on ty field AND coordinate structure
    let geometryType: 'Point' | 'Polygon' | 'MultiPolygon';
    
    // First, use the ty field from DHIS2
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
        // Auto-detect based on coordinate depth
        if (depth === 1) {
          geometryType = 'Point';
        } else if (depth === 4) {
          geometryType = 'MultiPolygon';
        } else {
          geometryType = 'Polygon';
        }
    }
    
    // Validate and correct based on actual coordinate depth
    // This handles DHIS2 instances that mislabel geometry types
    if (geometryType === 'Polygon' && depth === 4) {
      // Declared as Polygon but has MultiPolygon structure
      geometryType = 'MultiPolygon';
    } else if (geometryType === 'MultiPolygon' && depth === 3) {
      // Declared as MultiPolygon but has Polygon structure
      geometryType = 'Polygon';
    }
    
    // Normalize coordinates to match the detected type
    const normalizedCoords = normalizeCoordinates(coordinates, geometryType);

    return {
      type: 'Feature',
      id: geoFeature.id,
      geometry: {
        type: geometryType,
        coordinates: normalizedCoords,
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

interface EndpointLoadResult {
  features: DHIS2GeoJSONFeature[];
  pendingRetry?: boolean;
  retryAfterMs?: number;
}

/**
 * Load geo features using the geoFeatures endpoint
 */
async function loadViaGeoFeaturesEndpoint(
  options: GeoFeatureLoadOptions,
): Promise<EndpointLoadResult> {
  const allFeatures: DHIS2GeoJSONFeature[] = [];
  const {
    levels,
    parentOuIds,
    useWebWorker = false,
    sourceInstanceIds,
  } = options;

  const ouParts: string[] = [];
  levels.forEach(level => {
    ouParts.push(`LEVEL-${level}`);
  });
  if (parentOuIds && parentOuIds.length > 0) {
    ouParts.push(...parentOuIds);
  }

  const ouDimension = ouParts.join(';');

  try {
    const response = await fetchDHIS2MetadataWithPublicFallback(options, {
        type: 'geoFeatures',
        ou: ouDimension,
        staged: 'true',
        instance_ids: sourceInstanceIds?.join(',') || undefined,
    });

    // If the backend returned a pending status (boundaries are being fetched
    // asynchronously in the background), propagate this to the caller.
    const responseStatus = response.json?.status;
    const retryAfterMs = response.json?.retry_after_ms as number | undefined;
    if (responseStatus === 'pending') {
      return { features: [], pendingRetry: true, retryAfterMs: retryAfterMs ?? 8000 };
    }

    const geoFeatures: DHIS2GeoFeature[] = response.json?.result || [];

    // Parse features using Web Worker or main thread
    if (useWebWorker && geoFeatures.length > 100) {
      // Use Web Worker for large datasets (> 100 features)
      try {
        // eslint-disable-next-line no-console
        console.log('[GeoFeatureLoader] Using Web Worker for parsing', geoFeatures.length, 'features');
        const parsedFeatures = await parseGeoFeaturesInWorker(geoFeatures);
        allFeatures.push(...parsedFeatures);
      } catch (workerError) {
        // Fallback to main thread if worker fails
        // eslint-disable-next-line no-console
        console.warn('[GeoFeatureLoader] Worker failed, falling back to main thread:', workerError);
        for (const gf of geoFeatures) {
          const feature = convertGeoFeatureToGeoJSON(gf);
          if (feature) {
            allFeatures.push(feature);
          }
        }
      }
    } else {
      // Parse on main thread for small datasets
      for (const gf of geoFeatures) {
        const feature = convertGeoFeatureToGeoJSON(gf);
        if (feature) {
          allFeatures.push(feature);
        }
      }
    }

  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[GeoFeatureLoader] Error loading geoFeatures:', error);
    throw error;
  }

  return { features: allFeatures };
}

/**
 * Load geo features using the GeoJSON endpoint
 */
async function loadViaGeoJSONEndpoint(
  options: GeoFeatureLoadOptions,
): Promise<EndpointLoadResult> {
  const allFeatures: DHIS2GeoJSONFeature[] = [];
  const { levels, parentOuIds, sourceInstanceIds } = options;

  try {
    const response = await fetchDHIS2MetadataWithPublicFallback(options, {
        type: 'geoJSON',
        levels: levels.join(','),
        parents: parentOuIds?.join(',') || '',
        staged: 'true',
        instance_ids: sourceInstanceIds?.join(',') || undefined,
    });

    // If the backend returned a pending status (boundaries being fetched
    // asynchronously), propagate this to the caller.
    const responseStatus = response.json?.status;
    const retryAfterMs = response.json?.retry_after_ms as number | undefined;
    if (responseStatus === 'pending') {
      return { features: [], pendingRetry: true, retryAfterMs: retryAfterMs ?? 8000 };
    }

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

  return { features: allFeatures };
}

/**
 * Get cache key for the given options
 */
function getCacheKey(options: GeoFeatureLoadOptions): string {
  const prefix = options.cacheKeyPrefix || 'dhis2_geo';
  const levels = options.levels.sort((a, b) => a - b).join('_');
  const parents = options.parentOuIds?.sort().join('_') || 'all';
  const instances =
    options.sourceInstanceIds
      ?.slice()
      .sort((a, b) => a - b)
      .join('_') || 'all';
  const chart = options.chartId ? `C${options.chartId}` : 'Call';
  const dashboard = options.dashboardId ? `D${options.dashboardId}` : 'Dall';
  const endpoint = options.endpoint || 'geoFeatures';
  return `${prefix}_db${options.databaseId}_${endpoint}_${chart}_${dashboard}_I${instances}_L${levels}_P${parents}`;
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

  const cachedInstances = new Set(cache.sourceInstanceIds || []);
  const requestedInstances = new Set(options.sourceInstanceIds || []);
  if (
    cachedInstances.size !== requestedInstances.size ||
    ![...cachedInstances].every(instanceId => requestedInstances.has(instanceId))
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
 * Load from cache (memory first, then IndexedDB) with metrics tracking
 */
async function loadFromCache(
  options: GeoFeatureLoadOptions,
): Promise<{ cache: GeoFeatureCache; source: 'memory' | 'indexeddb' } | null> {
  const cacheKey = getCacheKey(options);

  // Check memory cache first (fastest)
  const memCached = memoryCache.get(cacheKey);
  if (memCached && isCacheValid(memCached, options)) {
    return { cache: memCached, source: 'memory' };
  }

  // Check IndexedDB (persistent)
  const dbCached = await loadFromIndexedDB(cacheKey);
  if (dbCached && isCacheValid(dbCached, options)) {
    // Update memory cache for faster subsequent access
    memoryCache.set(cacheKey, dbCached);
    return { cache: dbCached, source: 'indexeddb' };
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
    sourceInstanceIds: options.sourceInstanceIds,
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

  try {
    let features: DHIS2GeoJSONFeature[];
    if (options.endpoint === 'geoJSON') {
      features = (await loadViaGeoJSONEndpoint(options)).features;
    } else {
      features = (await loadViaGeoFeaturesEndpoint(options)).features;
    }

    if (features.length > 0) {
      await saveToCache(options, features);
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

  // Check cache first (unless force refresh)
  let cacheMetrics: CacheMetrics | undefined;

  if (!options.forceRefresh) {
    const cacheResult = await loadFromCache(options);
    if (cacheResult) {
      const { cache: cached, source } = cacheResult;
      const cacheAge = Date.now() - cached.timestamp;
      const isStale = isCacheStale(cached);
      const isExpired = !isCacheValid(cached, options);

      // Determine staleness status
      let staleness: 'fresh' | 'stale' | 'expired';
      if (isExpired) {
        staleness = 'expired';
      } else if (isStale) {
        staleness = 'stale';
      } else {
        staleness = 'fresh';
      }

      // Trigger background refresh if stale
      const backgroundRefreshQueued = isStale && options.enableBackgroundRefresh !== false;
      if (backgroundRefreshQueued) {
        backgroundRefresh(options);
      }

      // Build cache metrics
      cacheMetrics = {
        source,
        cacheAge,
        staleness,
        backgroundRefreshQueued,
        cacheKey,
      };

      return {
        featuresByLevel: groupFeaturesByLevel(cached.features),
        allFeatures: cached.features,
        totalCount: cached.features.length,
        fromCache: true,
        backgroundRefreshInProgress: backgroundRefreshInProgress.has(cacheKey),
        loadTimeMs: Date.now() - startTime,
        errors: [],
        cacheMetrics,
      };
    }
  }

  // Load from API
  let allFeatures: DHIS2GeoJSONFeature[] = [];
  let pendingRetry: boolean | undefined;
  let retryAfterMs: number | undefined;

  try {
    let endpointResult: EndpointLoadResult;
    if (options.endpoint === 'geoJSON') {
      endpointResult = await loadViaGeoJSONEndpoint(options);
    } else {
      endpointResult = await loadViaGeoFeaturesEndpoint(options);
    }
    allFeatures = endpointResult.features;
    pendingRetry = endpointResult.pendingRetry;
    retryAfterMs = endpointResult.retryAfterMs;
  } catch (error: any) {
    errors.push(error.message || 'Unknown error loading geo features');
    // eslint-disable-next-line no-console
    console.error('[GeoFeatureLoader] API error:', error);
  }

  // If the backend is still preparing boundaries, return early without caching
  // so the next request re-checks the backend.
  if (pendingRetry) {
    return {
      featuresByLevel: new Map(),
      allFeatures: [],
      totalCount: 0,
      fromCache: false,
      backgroundRefreshInProgress: false,
      loadTimeMs: Date.now() - startTime,
      errors,
      pendingRetry: true,
      retryAfterMs: retryAfterMs ?? 8000,
    };
  }

  // Save to cache if we got features
  if (allFeatures.length > 0) {
    await saveToCache(options, allFeatures);
  }

  // Progressive loading for large datasets
  if (
    options.enableProgressiveLoading &&
    options.onChunkLoaded &&
    allFeatures.length > (options.chunkSize || 1000)
  ) {
    const chunkSize = options.chunkSize || 1000;

    // Process chunks progressively
    for (let i = 0; i < allFeatures.length; i += chunkSize) {
      const chunk = allFeatures.slice(i, Math.min(i + chunkSize, allFeatures.length));
      const progress = Math.min(100, ((i + chunkSize) / allFeatures.length) * 100);
      const isComplete = i + chunkSize >= allFeatures.length;

      // Call the chunk callback
      options.onChunkLoaded(chunk, progress, isComplete);

      // Yield to browser to prevent blocking (only if not last chunk)
      if (!isComplete) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  // Build cache metrics for API fetch
  if (!cacheMetrics) {
    cacheMetrics = {
      source: 'api',
      cacheAge: 0,
      staleness: 'none',
      backgroundRefreshQueued: false,
      cacheKey,
    };
  }

  return {
    featuresByLevel: groupFeaturesByLevel(allFeatures),
    allFeatures,
    totalCount: allFeatures.length,
    fromCache: false,
    backgroundRefreshInProgress: false,
    loadTimeMs: Date.now() - startTime,
    errors,
    cacheMetrics,
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

/**
 * Predictively preload adjacent/child levels for faster drill-downs
 *
 * This is critical for slow DHIS2 servers - preloading means drill-downs
 * appear instant (< 100ms) instead of waiting 3-15 seconds.
 *
 * @param databaseId - Database ID
 * @param currentLevel - Current level being viewed
 * @param direction - Which levels to preload ('down' for children, 'up' for parents, 'both')
 * @param endpoint - Which endpoint to use
 *
 * @example
 * ```typescript
 * // User is viewing level 2, preload levels 3 and 4 for instant drill-down
 * preloadAdjacentLevels(2, 2, 'down', 'geoFeatures');
 * ```
 */
export async function preloadAdjacentLevels(
  databaseId: number,
  currentLevel: number,
  direction: 'up' | 'down' | 'both' = 'down',
  endpoint: 'geoFeatures' | 'geoJSON' = 'geoFeatures',
): Promise<void> {
  const levelsToPreload: number[] = [];

  // Determine which levels to preload
  if (direction === 'down' || direction === 'both') {
    // Preload 2 levels down for drill-down
    levelsToPreload.push(currentLevel + 1, currentLevel + 2);
  }

  if (direction === 'up' || direction === 'both') {
    // Preload parent level for zoom-out
    if (currentLevel > 1) {
      levelsToPreload.push(currentLevel - 1);
    }
  }

  // Filter out invalid levels
  const validLevels = levelsToPreload.filter(l => l > 0 && l <= 10);

  if (validLevels.length === 0) {
    return;
  }

  // Use requestIdleCallback if available for low-priority loading
  const preloadFunc = async () => {
    try {
      await loadDHIS2GeoFeatures({
        databaseId,
        levels: validLevels,
        endpoint,
        enableBackgroundRefresh: false, // Don't trigger refresh during preload
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[GeoFeatureLoader] Predictive preload failed:', error);
      // Silent failure - preloading is best-effort
    }
  };

  // Use requestIdleCallback for non-blocking preload
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(preloadFunc as IdleRequestCallback);
  } else {
    // Fallback: use setTimeout with delay
    setTimeout(preloadFunc, 100);
  }
}

export default loadDHIS2GeoFeatures;
