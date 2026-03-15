import { computeBoundsFromFeatureCollection, expandBounds } from '../src/utils/bounds';

const makePoint = (lng: number, lat: number): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: {},
});

const makePolygon = (coords: [number,number][]): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [coords.map(c => [c[0], c[1]])] },
  properties: {},
});

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: features as any,
});

describe('computeBoundsFromFeatureCollection', () => {
  it('returns null for empty collection', () => {
    expect(computeBoundsFromFeatureCollection(fc([]))).toBeNull();
  });

  it('computes bounds from points', () => {
    const bounds = computeBoundsFromFeatureCollection(fc([
      makePoint(30, 0),
      makePoint(35, 5),
    ]));
    expect(bounds).not.toBeNull();
    expect(bounds![0][0]).toBeLessThan(30);
    expect(bounds![0][1]).toBeLessThan(0);
    expect(bounds![1][0]).toBeGreaterThan(35);
    expect(bounds![1][1]).toBeGreaterThan(5);
  });

  it('computes bounds from polygons', () => {
    const poly = makePolygon([[29, -1], [34, -1], [34, 4], [29, 4], [29, -1]]);
    const bounds = computeBoundsFromFeatureCollection(fc([poly]));
    expect(bounds).not.toBeNull();
    expect(bounds![0][0]).toBeLessThan(29);
    expect(bounds![1][0]).toBeGreaterThan(34);
  });

  it('handles single point with padding', () => {
    const bounds = computeBoundsFromFeatureCollection(fc([makePoint(32, 1)]));
    expect(bounds).not.toBeNull();
    expect(bounds![0][0]).toBeLessThan(32);
    expect(bounds![1][0]).toBeGreaterThan(32);
  });

  it('skips null geometry features', () => {
    const withNull: GeoJSON.Feature = { type: 'Feature', geometry: null as any, properties: {} };
    const bounds = computeBoundsFromFeatureCollection(fc([withNull, makePoint(32, 1)]));
    expect(bounds).not.toBeNull();
  });
});

describe('expandBounds', () => {
  it('returns other when one is null', () => {
    const b: [[number,number],[number,number]] = [[0,0],[1,1]];
    expect(expandBounds(null, b)).toEqual(b);
    expect(expandBounds(b, null)).toEqual(b);
  });

  it('expands bounds correctly', () => {
    const a: [[number,number],[number,number]] = [[0,0],[5,5]];
    const b: [[number,number],[number,number]] = [[-1,-1],[10,10]];
    const result = expandBounds(a, b);
    expect(result).toEqual([[-1,-1],[10,10]]);
  });
});
