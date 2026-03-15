import maplibregl from 'maplibre-gl';
import { SRC, LYR } from '../constants/defaults';

const SID = SRC.BOUNDARY;

function ensureSource(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (src) { src.setData(geojson); } else { map.addSource(SID, { type: 'geojson', data: geojson }); }
}

export function addOrUpdateBoundaryLayer(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection,
  opts: { color: string; width: number; opacity: number },
): void {
  const { color, width, opacity } = opts;
  ensureSource(map, geojson);
  if (!map.getLayer(LYR.BOUNDARY)) {
    map.addLayer({
      id: LYR.BOUNDARY,
      type: 'line',
      source: SID,
      paint: { 'line-color': color, 'line-width': width, 'line-opacity': opacity },
    });
  } else {
    map.setPaintProperty(LYR.BOUNDARY, 'line-color', color);
    map.setPaintProperty(LYR.BOUNDARY, 'line-width', width);
    map.setPaintProperty(LYR.BOUNDARY, 'line-opacity', opacity);
  }
}

export function removeBoundaryLayer(map: maplibregl.Map): void {
  if (map.getLayer(LYR.BOUNDARY)) map.removeLayer(LYR.BOUNDARY);
  if (map.getSource(SID)) map.removeSource(SID);
}
