import maplibregl from 'maplibre-gl';
import { SRC, LYR, DEFAULT_NO_DATA_COLOR } from '../constants/defaults';
import { assignClass } from '../utils/classify';

const SID = SRC.CHOROPLETH;

function ensureSource(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(geojson);
  } else {
    map.addSource(SID, { type: 'geojson', data: geojson, promoteId: '__vm_id' });
  }
}

function colorExpression(breaks: number[], colors: string[], metricCol: string, noDataColor: string): maplibregl.ExpressionSpecification {
  if (breaks.length === 0 || colors.length === 0) return noDataColor as unknown as maplibregl.ExpressionSpecification;
  // Build step expression: ['step', ['get', col], noData, b0, c0, b1, c1, ...]
  const expr: unknown[] = ['step', ['get', metricCol], noDataColor];
  for (let i = 0; i < breaks.length; i++) {
    expr.push(breaks[i]);
    expr.push(colors[i] ?? colors[colors.length - 1]);
  }
  return expr as maplibregl.ExpressionSpecification;
}

export function addOrUpdateChoroplethLayer(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection,
  opts: {
    breaks: number[];
    colors: string[];
    metricCol: string;
    opacity: number;
    borderColor: string;
    borderWidth: number;
    noDataColor: string;
    hoveredId: string | number | null;
  },
): void {
  const { breaks, colors, metricCol, opacity, borderColor, borderWidth, noDataColor } = opts;
  ensureSource(map, geojson);

  const fillColor = colorExpression(breaks, colors, metricCol, noDataColor);

  if (!map.getLayer(LYR.CHOROPLETH_FILL)) {
    map.addLayer({
      id: LYR.CHOROPLETH_FILL,
      type: 'fill',
      source: SID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': fillColor,
        'fill-opacity': opacity,
      },
    });
  } else {
    map.setPaintProperty(LYR.CHOROPLETH_FILL, 'fill-color', fillColor);
    map.setPaintProperty(LYR.CHOROPLETH_FILL, 'fill-opacity', opacity);
  }

  if (!map.getLayer(LYR.CHOROPLETH_OUTLINE)) {
    map.addLayer({
      id: LYR.CHOROPLETH_OUTLINE,
      type: 'line',
      source: SID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'line-color': borderColor,
        'line-width': borderWidth,
      },
    });
  } else {
    map.setPaintProperty(LYR.CHOROPLETH_OUTLINE, 'line-color', borderColor);
    map.setPaintProperty(LYR.CHOROPLETH_OUTLINE, 'line-width', borderWidth);
  }

  // Hover highlight outline
  if (!map.getLayer(LYR.CHOROPLETH_HOVER)) {
    map.addLayer({
      id: LYR.CHOROPLETH_HOVER,
      type: 'line',
      source: SID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'line-color': '#333',
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0],
      },
    });
  }
}

export function removeChoroplethLayer(map: maplibregl.Map): void {
  [LYR.CHOROPLETH_HOVER, LYR.CHOROPLETH_OUTLINE, LYR.CHOROPLETH_FILL].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource(SID)) map.removeSource(SID);
}
