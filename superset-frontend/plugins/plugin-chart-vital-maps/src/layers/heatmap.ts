import maplibregl from 'maplibre-gl';
import { SRC, LYR } from '../constants/defaults';

const SID = SRC.HEATMAP;

function ensureSource(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (src) { src.setData(geojson); } else { map.addSource(SID, { type: 'geojson', data: geojson }); }
}

export function addOrUpdateHeatmapLayer(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection,
  opts: {
    metricCol?: string;
    radius?: number;
    intensity?: number;
    opacity?: number;
  } = {},
): void {
  const { radius = 20, intensity = 1, opacity = 0.8 } = opts;
  ensureSource(map, geojson);

  if (!map.getLayer(LYR.HEATMAP)) {
    map.addLayer({
      id: LYR.HEATMAP,
      type: 'heatmap',
      source: SID,
      paint: {
        'heatmap-radius': radius,
        'heatmap-intensity': intensity,
        'heatmap-opacity': opacity,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(33,102,172,0)',
          0.2, '#abd9e9',
          0.4, '#ffffbf',
          0.6, '#fdae61',
          0.8, '#d7191c',
          1, '#a50026',
        ] as unknown as maplibregl.ExpressionSpecification,
        'heatmap-weight': opts.metricCol
          ? (['interpolate', ['linear'], ['get', opts.metricCol], 0, 0, 1, 1] as unknown as maplibregl.ExpressionSpecification)
          : 1,
      },
    });
  } else {
    map.setPaintProperty(LYR.HEATMAP, 'heatmap-radius', radius);
    map.setPaintProperty(LYR.HEATMAP, 'heatmap-intensity', intensity);
    map.setPaintProperty(LYR.HEATMAP, 'heatmap-opacity', opacity);
  }
}

export function removeHeatmapLayer(map: maplibregl.Map): void {
  if (map.getLayer(LYR.HEATMAP)) map.removeLayer(LYR.HEATMAP);
  if (map.getSource(SID)) map.removeSource(SID);
}
