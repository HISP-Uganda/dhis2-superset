type AnyFeature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>;

export function parseGeometry(raw: unknown): GeoJSON.Geometry | null {
  if (!raw) return null;
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.type === 'string' && ('coordinates' in obj || obj.type === 'GeometryCollection')) {
      return obj as unknown as GeoJSON.Geometry;
    }
    return null;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parseGeometry(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

export function isValidGeometry(geom: unknown): geom is GeoJSON.Geometry {
  if (!geom || typeof geom !== 'object') return false;
  const g = geom as Record<string, unknown>;
  const validTypes = [
    'Point', 'MultiPoint', 'LineString', 'MultiLineString',
    'Polygon', 'MultiPolygon', 'GeometryCollection',
  ];
  if (!validTypes.includes(g.type as string)) return false;
  if (g.type === 'GeometryCollection') return Array.isArray(g.geometries);
  if (!Array.isArray(g.coordinates)) return false;
  return true;
}

export function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return false;
  if (typeof lat === 'string' && lat.trim() === '') return false;
  if (typeof lon === 'string' && lon.trim() === '') return false;
  const la = Number(lat);
  const lo = Number(lon);
  return Number.isFinite(la) && Number.isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
}

export function pointRowToFeature(
  row: Record<string, unknown>,
  latCol: string,
  lonCol: string,
): AnyFeature | null {
  const lat = row[latCol];
  const lon = row[lonCol];
  if (!isValidCoordinate(lat, lon)) return null;
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [Number(lon), Number(lat)],
    },
    properties: row as Record<string, unknown>,
  };
}

export function detectDataType(
  rows: Record<string, unknown>[],
  opts: { latCol?: string; lonCol?: string; geometryCol?: string },
): 'point' | 'geometry' | 'unknown' {
  if (!rows || rows.length === 0) return 'unknown';
  const sample = rows.slice(0, 20);
  const { latCol, lonCol, geometryCol } = opts;

  if (geometryCol) {
    const hasGeom = sample.some(r => parseGeometry(r[geometryCol]) !== null);
    if (hasGeom) return 'geometry';
  }
  if (latCol && lonCol) {
    const hasPoint = sample.some(r => isValidCoordinate(r[latCol], r[lonCol]));
    if (hasPoint) return 'point';
  }
  return 'unknown';
}

export function normalizeToFeatureCollection(
  rows: Record<string, unknown>[],
  opts: {
    latCol?: string;
    lonCol?: string;
    geometryCol?: string;
    metricCol?: string;
    labelCol?: string;
    categoryCol?: string;
  },
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const { latCol, lonCol, geometryCol } = opts;
  const dataType = detectDataType(rows, opts);

  for (const row of rows) {
    let geom: GeoJSON.Geometry | null = null;

    if (dataType === 'geometry' && geometryCol) {
      geom = parseGeometry(row[geometryCol]);
    } else if (dataType === 'point' && latCol && lonCol) {
      if (isValidCoordinate(row[latCol], row[lonCol])) {
        geom = {
          type: 'Point',
          coordinates: [Number(row[lonCol]), Number(row[latCol])],
        };
      }
    }

    if (!geom || !isValidGeometry(geom)) continue;

    features.push({
      type: 'Feature',
      geometry: geom,
      properties: { ...row } as Record<string, unknown>,
    });
  }

  return { type: 'FeatureCollection', features };
}
