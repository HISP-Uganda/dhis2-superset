import type { BoundsResult } from '../plugin/types';

function extendWithCoord(
  bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null,
  lng: number,
  lat: number,
) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return bounds;
  if (!bounds) return { minLng: lng, minLat: lat, maxLng: lng, maxLat: lat };
  return {
    minLng: Math.min(bounds.minLng, lng),
    minLat: Math.min(bounds.minLat, lat),
    maxLng: Math.max(bounds.maxLng, lng),
    maxLat: Math.max(bounds.maxLat, lat),
  };
}

function processCoordinates(
  coords: unknown,
  depth: number,
  bounds: ReturnType<typeof extendWithCoord>,
): ReturnType<typeof extendWithCoord> {
  if (!Array.isArray(coords)) return bounds;
  if (depth === 0) {
    const [lng, lat] = coords as number[];
    return extendWithCoord(bounds, lng, lat);
  }
  let b = bounds;
  for (const item of coords) {
    b = processCoordinates(item, depth - 1, b);
  }
  return b;
}

const GEOMETRY_DEPTH: Record<string, number> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

export function computeBoundsFromFeatureCollection(
  geojson: GeoJSON.FeatureCollection,
): BoundsResult {
  let bounds: ReturnType<typeof extendWithCoord> = null;

  for (const feature of geojson.features) {
    const geom = feature.geometry;
    if (!geom || geom.type === 'GeometryCollection') continue;
    const depth = GEOMETRY_DEPTH[geom.type];
    if (depth === undefined) continue;
    bounds = processCoordinates((geom as GeoJSON.Point).coordinates, depth, bounds);
  }

  if (!bounds) return null;
  // Add small padding
  const lngPad = Math.max((bounds.maxLng - bounds.minLng) * 0.05, 0.01);
  const latPad = Math.max((bounds.maxLat - bounds.minLat) * 0.05, 0.01);
  return [
    [bounds.minLng - lngPad, bounds.minLat - latPad],
    [bounds.maxLng + lngPad, bounds.maxLat + latPad],
  ];
}

export function expandBounds(
  existing: BoundsResult,
  addition: BoundsResult,
): BoundsResult {
  if (!existing) return addition;
  if (!addition) return existing;
  return [
    [Math.min(existing[0][0], addition[0][0]), Math.min(existing[0][1], addition[0][1])],
    [Math.max(existing[1][0], addition[1][0]), Math.max(existing[1][1], addition[1][1])],
  ];
}

export function bboxToLngLatBounds(
  bounds: BoundsResult,
): [[number, number], [number, number]] | null {
  return bounds;
}
