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
import { useState, useEffect, useRef } from 'react';
import { loadDHIS2GeoFeatures } from 'src/utils/dhis2GeoFeatureLoader';
import type { DHIS2GeoJSONFeature } from 'src/utils/dhis2GeoFeatureLoader';

export interface DHIS2BoundaryResult {
  features: DHIS2GeoJSONFeature[];
  loading: boolean;
  error: string | null;
}

/**
 * Hook to load DHIS2 boundary GeoJSON for Small Multiples mini_map panels.
 * Always forces a fresh load on first call per (databaseId, boundaryLevel)
 * pair so that all boundaries are returned — not just the ones that happened
 * to be cached from a previous partial session.
 */
export default function useDHIS2Boundaries(
  databaseId: number | undefined,
  boundaryLevel: number | undefined,
  chartId?: number,
): DHIS2BoundaryResult {
  const [features, setFeatures] = useState<DHIS2GeoJSONFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevKeyRef = useRef('');
  const freshLoadDone = useRef(new Set<string>());

  useEffect(() => {
    if (!databaseId || !boundaryLevel) {
      setFeatures([]);
      setLoading(false);
      setError(null);
      return;
    }

    const key = `${databaseId}_${boundaryLevel}`;
    if (key === prevKeyRef.current && features.length > 0) return;
    prevKeyRef.current = key;

    // Force a fresh API call the first time we see this key in this
    // session.  Subsequent renders reuse the result without re-fetching.
    const forceRefresh = !freshLoadDone.current.has(key);

    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const result = await loadDHIS2GeoFeatures({
          databaseId,
          chartId,
          levels: [boundaryLevel],
          endpoint: 'geoJSON',
          cacheKeyPrefix: 'sm_boundaries',
          enableBackgroundRefresh: true,
          forceRefresh,
        });

        if (cancelled) return;

        if (result.pendingRetry) {
          setError('Boundaries loading… please wait');
          setLoading(false);
          const retryMs = result.retryAfterMs || 8000;
          setTimeout(() => {
            prevKeyRef.current = ''; // force re-fetch
          }, retryMs);
          return;
        }

        if (result.errors.length > 0) {
          setError(result.errors[0]);
        }

        freshLoadDone.current.add(key);
        setFeatures(result.allFeatures);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load DHIS2 boundaries');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [databaseId, boundaryLevel, chartId]);

  return { features, loading, error };
}

/**
 * Build a name-lookup map from DHIS2 boundary features.
 * Keys are lowercased org-unit names for fuzzy matching.
 */
export function buildBoundaryLookup(
  features: DHIS2GeoJSONFeature[],
): Map<string, DHIS2GeoJSONFeature> {
  const map = new Map<string, DHIS2GeoJSONFeature>();
  for (const f of features) {
    const name = f.properties?.name;
    if (name) {
      map.set(name.toLowerCase().trim(), f);
    }
  }
  return map;
}
