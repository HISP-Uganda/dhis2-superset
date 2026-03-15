import maplibregl from 'maplibre-gl';
import { SRC, LYR } from '../constants/defaults';

const SID = SRC.BUBBLE;

function ensureSource(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (src) { src.setData(geojson); } else { map.addSource(SID, { type: 'geojson', data: geojson }); }
}

export function addOrUpdateBubbleLayer(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection,
  opts: {
    metricCol: string;
    minRadius: number;
    maxRadius: number;
    color: string;
    opacity: number;
    borderColor: string;
    borderWidth: number;
    hoveredId: string | number | null;
  },
): void {
  const { metricCol, minRadius, maxRadius, color, opacity, borderColor, borderWidth } = opts;
  ensureSource(map, geojson);

  // Collect metric values for interpolation range
  const values = geojson.features
    .map(f => Number((f.properties ?? {})[metricCol]))
    .filter(Number.isFinite);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 1;
  const safeMax = maxVal === minVal ? minVal + 1 : maxVal;

  const radiusExpr: maplibregl.ExpressionSpecification = [
    'interpolate', ['linear'],
    ['get', metricCol],
    minVal, minRadius,
    safeMax, maxRadius,
  ];

  const borderExpr: maplibregl.ExpressionSpecification = [
    'case',
    ['boolean', ['feature-state', 'hover'], false],
    borderWidth + 1.5,
    borderWidth,
  ] as unknown as maplibregl.ExpressionSpecification;

  if (!map.getLayer(LYR.BUBBLE)) {
    map.addLayer({
      id: LYR.BUBBLE,
      type: 'circle',
      source: SID,
      paint: {
        'circle-radius': radiusExpr,
        'circle-color': color,
        'circle-opacity': opacity,
        'circle-stroke-color': borderColor,
        'circle-stroke-width': borderExpr,
      },
    });
  } else {
    map.setPaintProperty(LYR.BUBBLE, 'circle-radius', radiusExpr);
    map.setPaintProperty(LYR.BUBBLE, 'circle-color', color);
    map.setPaintProperty(LYR.BUBBLE, 'circle-opacity', opacity);
    map.setPaintProperty(LYR.BUBBLE, 'circle-stroke-color', borderColor);
    map.setPaintProperty(LYR.BUBBLE, 'circle-stroke-width', borderExpr);
  }
}

export function removeBubbleLayer(map: maplibregl.Map): void {
  if (map.getLayer(LYR.BUBBLE)) map.removeLayer(LYR.BUBBLE);
  if (map.getSource(SID)) map.removeSource(SID);
}
