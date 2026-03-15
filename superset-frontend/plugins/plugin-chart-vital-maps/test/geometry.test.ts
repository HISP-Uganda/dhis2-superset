import {
  parseGeometry,
  isValidGeometry,
  isValidCoordinate,
  pointRowToFeature,
  normalizeToFeatureCollection,
  detectDataType,
} from '../src/utils/geometry';

describe('parseGeometry', () => {
  it('parses valid Point object', () => {
    const geom = { type: 'Point', coordinates: [32.5, 0.3] };
    expect(parseGeometry(geom)).toEqual(geom);
  });

  it('parses valid GeoJSON string', () => {
    const str = JSON.stringify({ type: 'Point', coordinates: [32.5, 0.3] });
    const result = parseGeometry(str);
    expect(result?.type).toBe('Point');
  });

  it('returns null for null input', () => {
    expect(parseGeometry(null)).toBeNull();
  });

  it('returns null for invalid JSON string', () => {
    expect(parseGeometry('not-json')).toBeNull();
  });

  it('returns null for non-geometry object', () => {
    expect(parseGeometry({ foo: 'bar' })).toBeNull();
  });
});

describe('isValidGeometry', () => {
  it('validates Point geometry', () => {
    expect(isValidGeometry({ type: 'Point', coordinates: [0, 0] })).toBe(true);
  });

  it('validates Polygon geometry', () => {
    const poly = { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] };
    expect(isValidGeometry(poly)).toBe(true);
  });

  it('rejects unknown geometry type', () => {
    expect(isValidGeometry({ type: 'Star', coordinates: [] })).toBe(false);
  });

  it('rejects geometry with missing coordinates', () => {
    expect(isValidGeometry({ type: 'Point' })).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidGeometry(null)).toBe(false);
  });
});

describe('isValidCoordinate', () => {
  it('accepts valid lat/lon', () => {
    expect(isValidCoordinate(0.3, 32.5)).toBe(true);
  });

  it('rejects out-of-range latitude', () => {
    expect(isValidCoordinate(91, 32.5)).toBe(false);
  });

  it('rejects non-numeric values', () => {
    expect(isValidCoordinate('abc', 32.5)).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidCoordinate(null, 32.5)).toBe(false);
  });
});

describe('pointRowToFeature', () => {
  it('creates a valid Point Feature', () => {
    const row = { lat: 0.3, lon: 32.5, name: 'Test' };
    const feat = pointRowToFeature(row as any, 'lat', 'lon');
    expect(feat?.type).toBe('Feature');
    expect(feat?.geometry.type).toBe('Point');
    expect((feat?.geometry as any).coordinates).toEqual([32.5, 0.3]);
    expect(feat?.properties?.name).toBe('Test');
  });

  it('returns null for missing lat/lon', () => {
    const row = { name: 'Test' };
    expect(pointRowToFeature(row as any, 'lat', 'lon')).toBeNull();
  });

  it('returns null for invalid coordinates', () => {
    const row = { lat: 'invalid', lon: 32.5 };
    expect(pointRowToFeature(row as any, 'lat', 'lon')).toBeNull();
  });
});

describe('normalizeToFeatureCollection', () => {
  it('converts point rows to FeatureCollection', () => {
    const rows = [
      { latitude: 0.3, longitude: 32.5, value: 10 },
      { latitude: 1.0, longitude: 33.0, value: 20 },
    ];
    const fc = normalizeToFeatureCollection(rows as any, { latCol: 'latitude', lonCol: 'longitude' });
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBe(2);
  });

  it('filters out invalid rows', () => {
    const rows = [
      { latitude: 0.3, longitude: 32.5 },
      { latitude: 'bad', longitude: 32.5 },
      { latitude: 999, longitude: 32.5 }, // out of range
    ];
    const fc = normalizeToFeatureCollection(rows as any, { latCol: 'latitude', lonCol: 'longitude' });
    expect(fc.features.length).toBe(1);
  });

  it('returns empty FeatureCollection for empty rows', () => {
    const fc = normalizeToFeatureCollection([], { latCol: 'lat', lonCol: 'lon' });
    expect(fc.features.length).toBe(0);
  });

  it('parses geometry column', () => {
    const rows = [
      { geom: JSON.stringify({ type: 'Point', coordinates: [32.5, 0.3] }) },
    ];
    const fc = normalizeToFeatureCollection(rows as any, { geometryCol: 'geom' });
    expect(fc.features.length).toBe(1);
  });
});

describe('detectDataType', () => {
  it('detects point type from lat/lon', () => {
    const rows = [{ lat: 0.3, lon: 32.5 }];
    expect(detectDataType(rows as any, { latCol: 'lat', lonCol: 'lon' })).toBe('point');
  });

  it('detects geometry type from geometry col', () => {
    const rows = [{ geom: JSON.stringify({ type: 'Point', coordinates: [0, 0] }) }];
    expect(detectDataType(rows as any, { geometryCol: 'geom' })).toBe('geometry');
  });

  it('returns unknown for empty rows', () => {
    expect(detectDataType([], { latCol: 'lat', lonCol: 'lon' })).toBe('unknown');
  });
});
