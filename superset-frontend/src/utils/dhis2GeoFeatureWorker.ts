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

/**
 * Web Worker for parsing DHIS2 GeoFeatures in background thread
 *
 * This offloads heavy coordinate parsing from the main thread,
 * keeping the UI smooth during large dataset loads.
 *
 * Critical for slow DHIS2 servers where datasets can be 10k+ features.
 */

import type { DHIS2GeoFeature, DHIS2GeoJSONFeature } from './dhis2GeoFeatureLoader';

interface WorkerMessage {
  type: 'parse';
  geoFeatures: DHIS2GeoFeature[];
}

interface WorkerResponse {
  type: 'result' | 'error';
  features?: DHIS2GeoJSONFeature[];
  error?: string;
  stats?: {
    total: number;
    successful: number;
    failed: number;
    parseTimeMs: number;
  };
}

/**
 * Detect coordinate nesting depth to determine geometry type
 */
function detectCoordinateDepth(coords: any): number {
  if (!Array.isArray(coords)) return 0;
  if (coords.length === 0) return 1;
  if (typeof coords[0] === 'number') return 1;
  return 1 + detectCoordinateDepth(coords[0]);
}

/**
 * Normalize coordinates to proper GeoJSON structure
 */
function normalizeCoordinates(
  coords: any,
  targetType: 'Point' | 'Polygon' | 'MultiPolygon',
): any {
  const depth = detectCoordinateDepth(coords);

  if (targetType === 'Point') {
    if (depth === 1) return coords;
    let c = coords;
    while (Array.isArray(c) && Array.isArray(c[0])) {
      c = c[0];
    }
    return c;
  }

  if (targetType === 'Polygon') {
    if (depth === 3) return coords;
    if (depth === 4) return coords[0];
    if (depth === 2) return [coords];
    return coords;
  }

  if (targetType === 'MultiPolygon') {
    if (depth === 4) return coords;
    if (depth === 3) return [coords];
    return coords;
  }

  return coords;
}

/**
 * Convert DHIS2 geoFeature to GeoJSON Feature
 */
function convertGeoFeatureToGeoJSON(
  geoFeature: DHIS2GeoFeature,
): DHIS2GeoJSONFeature | null {
  try {
    if (!geoFeature.co) {
      return null;
    }

    // Parse coordinates
    let coordinates: any;
    try {
      coordinates = JSON.parse(geoFeature.co);
    } catch {
      return null;
    }

    const depth = detectCoordinateDepth(coordinates);

    // Determine geometry type
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
        if (depth === 1) {
          geometryType = 'Point';
        } else if (depth === 4) {
          geometryType = 'MultiPolygon';
        } else {
          geometryType = 'Polygon';
        }
    }

    // Auto-correct based on coordinate depth
    if (geometryType === 'Polygon' && depth === 4) {
      geometryType = 'MultiPolygon';
    } else if (geometryType === 'MultiPolygon' && depth === 3) {
      geometryType = 'Polygon';
    }

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

// Worker message handler
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const startTime = performance.now();

  if (e.data.type === 'parse') {
    const { geoFeatures } = e.data;

    try {
      const features: DHIS2GeoJSONFeature[] = [];
      let successful = 0;
      let failed = 0;

      for (const gf of geoFeatures) {
        const feature = convertGeoFeatureToGeoJSON(gf);
        if (feature) {
          features.push(feature);
          successful++;
        } else {
          failed++;
        }
      }

      const parseTimeMs = performance.now() - startTime;

      const response: WorkerResponse = {
        type: 'result',
        features,
        stats: {
          total: geoFeatures.length,
          successful,
          failed,
          parseTimeMs,
        },
      };

      self.postMessage(response);
    } catch (error: any) {
      const response: WorkerResponse = {
        type: 'error',
        error: error.message || 'Unknown parsing error',
      };
      self.postMessage(response);
    }
  }
};

// Export empty object for TypeScript
export {};
