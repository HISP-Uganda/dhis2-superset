import maplibregl from 'maplibre-gl';
import { SRC, LYR } from '../constants/defaults';

const SID = SRC.CLUSTER;

export function addOrUpdateClusterLayer(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection,
  opts: {
    clusterRadius: number;
    clusterMaxZoom: number;
    color: string;
    pointRadius: number;
    opacity: number;
    borderColor: string;
    borderWidth: number;
  },
): void {
  const { clusterRadius, clusterMaxZoom, color, pointRadius, opacity, borderColor, borderWidth } = opts;

  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(geojson);
  } else {
    map.addSource(SID, {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterRadius,
      clusterMaxZoom,
    });
  }

  // Cluster circle layer — sized by point_count
  if (!map.getLayer(LYR.CLUSTER_CIRCLE)) {
    map.addLayer({
      id: LYR.CLUSTER_CIRCLE,
      type: 'circle',
      source: SID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#51bbd6',   // < 10
          10, '#2196f3', // 10-50
          50, '#f1a340', // 50-100
          100, '#e65100', // > 100
        ] as unknown as maplibregl.ExpressionSpecification,
        'circle-radius': [
          'step', ['get', 'point_count'],
          18,    // < 10
          10, 24, // 10-50
          50, 32, // 50-100
          100, 40, // > 100
        ] as unknown as maplibregl.ExpressionSpecification,
        'circle-opacity': opacity,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });
  } else {
    map.setPaintProperty(LYR.CLUSTER_CIRCLE, 'circle-opacity', opacity);
  }

  // Cluster count labels
  if (!map.getLayer(LYR.CLUSTER_COUNT)) {
    map.addLayer({
      id: LYR.CLUSTER_COUNT,
      type: 'symbol',
      source: SID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'] as unknown as maplibregl.ExpressionSpecification,
        'text-size': 13,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
      },
    });
  }

  // Unclustered individual points
  if (!map.getLayer(LYR.CLUSTER_UNCLUSTERED)) {
    map.addLayer({
      id: LYR.CLUSTER_UNCLUSTERED,
      type: 'circle',
      source: SID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': pointRadius,
        'circle-color': color,
        'circle-opacity': opacity,
        'circle-stroke-color': borderColor,
        'circle-stroke-width': borderWidth,
      },
    });
  } else {
    map.setPaintProperty(LYR.CLUSTER_UNCLUSTERED, 'circle-radius', pointRadius);
    map.setPaintProperty(LYR.CLUSTER_UNCLUSTERED, 'circle-color', color);
    map.setPaintProperty(LYR.CLUSTER_UNCLUSTERED, 'circle-opacity', opacity);
    map.setPaintProperty(LYR.CLUSTER_UNCLUSTERED, 'circle-stroke-color', borderColor);
    map.setPaintProperty(LYR.CLUSTER_UNCLUSTERED, 'circle-stroke-width', borderWidth);
  }
}

/** Expand a cluster on click — call from VitalMapsChart click handler */
export function expandCluster(
  map: maplibregl.Map,
  clusterId: number,
  coordinates: [number, number],
): void {
  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  src.getClusterExpansionZoom(clusterId).then(zoom => {
    map.easeTo({ center: coordinates, zoom: zoom + 0.5, duration: 400 });
  });
}

export function removeClusterLayer(map: maplibregl.Map): void {
  [LYR.CLUSTER_COUNT, LYR.CLUSTER_UNCLUSTERED, LYR.CLUSTER_CIRCLE].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource(SID)) map.removeSource(SID);
}
