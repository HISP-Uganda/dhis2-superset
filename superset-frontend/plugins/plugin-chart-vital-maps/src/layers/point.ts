import maplibregl from 'maplibre-gl';
import { SRC, LYR } from '../constants/defaults';

const SID = SRC.POINT;

function ensureSource(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (src) { src.setData(geojson); } else { map.addSource(SID, { type: 'geojson', data: geojson }); }
}

export function addOrUpdatePointLayer(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection,
  opts: {
    radius: number;
    color: string;
    opacity: number;
    borderColor: string;
    borderWidth: number;
    categoryCol?: string;
    categoryColors?: Record<string, string>;
    hoveredId: string | number | null;
  },
): void {
  const { radius, color, opacity, borderColor, borderWidth, categoryCol, categoryColors } = opts;
  ensureSource(map, geojson);

  let circleColor: maplibregl.ExpressionSpecification | string = color;
  if (categoryCol && categoryColors && Object.keys(categoryColors).length > 0) {
    const matchExpr: unknown[] = ['match', ['get', categoryCol]];
    for (const [cat, c] of Object.entries(categoryColors)) {
      matchExpr.push(cat, c);
    }
    matchExpr.push(color); // default
    circleColor = matchExpr as unknown as maplibregl.ExpressionSpecification;
  }

  const hoverRadius: maplibregl.ExpressionSpecification = [
    'case', ['boolean', ['feature-state', 'hover'], false], radius + 3, radius,
  ] as unknown as maplibregl.ExpressionSpecification;

  if (!map.getLayer(LYR.POINT)) {
    map.addLayer({
      id: LYR.POINT,
      type: 'circle',
      source: SID,
      paint: {
        'circle-radius': hoverRadius,
        'circle-color': circleColor,
        'circle-opacity': opacity,
        'circle-stroke-color': borderColor,
        'circle-stroke-width': borderWidth,
      },
    });
  } else {
    map.setPaintProperty(LYR.POINT, 'circle-radius', hoverRadius);
    map.setPaintProperty(LYR.POINT, 'circle-color', circleColor);
    map.setPaintProperty(LYR.POINT, 'circle-opacity', opacity);
    map.setPaintProperty(LYR.POINT, 'circle-stroke-color', borderColor);
    map.setPaintProperty(LYR.POINT, 'circle-stroke-width', borderWidth);
  }
}

export function removePointLayer(map: maplibregl.Map): void {
  if (map.getLayer(LYR.POINT)) map.removeLayer(LYR.POINT);
  if (map.getSource(SID)) map.removeSource(SID);
}
