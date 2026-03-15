import maplibregl from 'maplibre-gl';
import { SRC, LYR } from '../constants/defaults';

const SID = SRC.LABELS;

function ensureSource(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (src) { src.setData(geojson); } else { map.addSource(SID, { type: 'geojson', data: geojson }); }
}

export function addOrUpdateLabelsLayer(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection,
  opts: {
    labelCol: string;
    minZoom?: number;
    fontSize?: number;
    color?: string;
    haloColor?: string;
  },
): void {
  const { labelCol, minZoom = 6, fontSize = 12, color = '#333333', haloColor = 'rgba(255,255,255,0.8)' } = opts;
  ensureSource(map, geojson);
  if (!map.getLayer(LYR.LABELS)) {
    map.addLayer({
      id: LYR.LABELS,
      type: 'symbol',
      source: SID,
      minzoom: minZoom,
      layout: {
        'text-field': ['get', labelCol] as unknown as maplibregl.ExpressionSpecification,
        'text-size': fontSize,
        'text-anchor': 'center',
        'text-allow-overlap': false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': color,
        'text-halo-color': haloColor,
        'text-halo-width': 1.5,
      },
    });
  } else {
    map.setLayoutProperty(LYR.LABELS, 'text-field', ['get', labelCol] as unknown as maplibregl.ExpressionSpecification);
    map.setLayoutProperty(LYR.LABELS, 'text-size', fontSize);
    map.setPaintProperty(LYR.LABELS, 'text-color', color);
    (map as any).setLayerZoomRange(LYR.LABELS, minZoom, 24);
  }
}

export function removeLabelsLayer(map: maplibregl.Map): void {
  if (map.getLayer(LYR.LABELS)) map.removeLayer(LYR.LABELS);
  if (map.getSource(SID)) map.removeSource(SID);
}
