import maplibregl from 'maplibre-gl';
import { SRC, LYR } from '../constants/defaults';

const SID = SRC.EXTRUSION;

function ensureSource(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(geojson);
  } else {
    map.addSource(SID, { type: 'geojson', data: geojson, promoteId: '__vm_id' });
  }
}

function colorExpression(
  breaks: number[], colors: string[], metricCol: string, noDataColor: string,
): maplibregl.ExpressionSpecification {
  if (breaks.length === 0 || colors.length === 0) return noDataColor as unknown as maplibregl.ExpressionSpecification;
  const expr: unknown[] = ['step', ['get', metricCol], noDataColor];
  for (let i = 0; i < breaks.length; i++) {
    expr.push(breaks[i]);
    expr.push(colors[i] ?? colors[colors.length - 1]);
  }
  return expr as maplibregl.ExpressionSpecification;
}

export function addOrUpdateExtrusionLayer(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection,
  opts: {
    breaks: number[];
    colors: string[];
    metricCol: string;
    maxHeight: number;
    opacity: number;
    noDataColor: string;
  },
): void {
  const { breaks, colors, metricCol, maxHeight, opacity, noDataColor } = opts;
  ensureSource(map, geojson);

  // Compute min/max for height interpolation
  const values = geojson.features
    .map(f => Number((f.properties ?? {})[metricCol]))
    .filter(Number.isFinite);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 1;
  const safeMax = maxVal === minVal ? minVal + 1 : maxVal;

  const heightExpr: maplibregl.ExpressionSpecification = [
    'interpolate', ['linear'],
    ['get', metricCol],
    minVal, 0,
    safeMax, maxHeight,
  ] as unknown as maplibregl.ExpressionSpecification;

  const fillColor = colorExpression(breaks, colors, metricCol, noDataColor);

  if (!map.getLayer(LYR.EXTRUSION)) {
    map.addLayer({
      id: LYR.EXTRUSION,
      type: 'fill-extrusion',
      source: SID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-extrusion-color': fillColor,
        'fill-extrusion-height': heightExpr,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': opacity,
      },
    });
  } else {
    map.setPaintProperty(LYR.EXTRUSION, 'fill-extrusion-color', fillColor);
    map.setPaintProperty(LYR.EXTRUSION, 'fill-extrusion-height', heightExpr);
    map.setPaintProperty(LYR.EXTRUSION, 'fill-extrusion-opacity', opacity);
  }
}

export function removeExtrusionLayer(map: maplibregl.Map): void {
  if (map.getLayer(LYR.EXTRUSION)) map.removeLayer(LYR.EXTRUSION);
  if (map.getSource(SID)) map.removeSource(SID);
}
