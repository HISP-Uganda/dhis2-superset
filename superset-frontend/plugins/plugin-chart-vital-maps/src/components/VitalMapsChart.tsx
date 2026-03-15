import React, { useRef, useState, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { VitalMapsTransformedProps, TooltipPayload } from '../plugin/types';
import { BASEMAP_PRESETS, BASEMAP_PRESETS_BY_ID, DEFAULT_BASEMAP_ID } from '../constants/basemaps';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../constants/defaults';
import { MapStateManager } from '../utils/mapState';
import { buildTooltipPayload } from '../utils/tooltip';
import { computeBoundsFromFeatureCollection } from '../utils/bounds';

import { addOrUpdateChoroplethLayer, removeChoroplethLayer } from '../layers/choropleth';
import { addOrUpdateBubbleLayer, removeBubbleLayer } from '../layers/bubble';
import { addOrUpdatePointLayer, removePointLayer } from '../layers/point';
import { addOrUpdateHeatmapLayer, removeHeatmapLayer } from '../layers/heatmap';
import { addOrUpdateBoundaryLayer, removeBoundaryLayer } from '../layers/boundary';
import { addOrUpdateLabelsLayer, removeLabelsLayer } from '../layers/labels';

import LegendPanel from './LegendPanel';
import TooltipCard from './TooltipCard';
import ZoomControls from './ZoomControls';
import BasemapSwitcher from './BasemapSwitcher';
import MapStatusBar from './MapStatusBar';
import LayerPanel from './LayerPanel';

type HoveredFeature = { id: string | number; source: string } | null;

const mapStateManager = new MapStateManager();

type Props = VitalMapsTransformedProps;

const ALL_REMOVERS = [
  removeChoroplethLayer,
  removeBubbleLayer,
  removePointLayer,
  removeHeatmapLayer,
  removeBoundaryLayer,
  removeLabelsLayer,
];

function removeAllLayers(map: maplibregl.Map): void {
  ALL_REMOVERS.forEach(fn => {
    try { fn(map); } catch { /* ignore */ }
  });
}

const VitalMapsChart: React.FC<Props> = (props) => {
  const {
    width, height, layerType, geojson, bounds, breaks, colors, legend,
    basemap, metricCol, labelCol, categoryCol, tooltipCols, opacity,
    borderColor, borderWidth, pointRadius, pointRadiusMin, pointRadiusMax,
    showLabels, labelZoomThreshold, showLegend, legendPosition, fitToBounds,
    showLayerPanel, showBasemapSwitcher, showStatusBar, noDataColor,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredRef = useRef<HoveredFeature>(null);
  const [basemapId, setBasemapId] = useState(basemap?.id ?? DEFAULT_BASEMAP_ID);
  const [tooltip, setTooltip] = useState<{ payload: TooltipPayload; x: number; y: number } | null>(null);
  const [pinnedTooltip, setPinnedTooltip] = useState<{ payload: TooltipPayload; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [localOpacity, setLocalOpacity] = useState(opacity);

  // Update localOpacity when prop changes
  useEffect(() => { setLocalOpacity(opacity); }, [opacity]);

  // Resolve basemap style
  const resolveStyle = useCallback((id: string): string | Record<string, unknown> => {
    const preset = BASEMAP_PRESETS_BY_ID[id] ?? BASEMAP_PRESETS_BY_ID[DEFAULT_BASEMAP_ID];
    return preset.style;
  }, []);

  // Apply data layers after basemap loads
  const applyDataLayers = useCallback((map: maplibregl.Map) => {
    removeAllLayers(map);

    if (!geojson || geojson.features.length === 0) return;

    const eff = localOpacity;

    switch (layerType) {
      case 'choropleth':
        addOrUpdateChoroplethLayer(map, geojson, {
          breaks, colors, metricCol, opacity: eff,
          borderColor, borderWidth, noDataColor, hoveredId: null,
        });
        break;
      case 'bubble':
        addOrUpdateBubbleLayer(map, geojson, {
          metricCol, minRadius: pointRadiusMin, maxRadius: pointRadiusMax,
          color: colors[colors.length - 1] ?? '#4e79a7', opacity: eff,
          borderColor, borderWidth, hoveredId: null,
        });
        break;
      case 'point':
        addOrUpdatePointLayer(map, geojson, {
          radius: pointRadius, color: colors[colors.length - 1] ?? '#4e79a7',
          opacity: eff, borderColor, borderWidth, hoveredId: null,
        });
        break;
      case 'heatmap':
        addOrUpdateHeatmapLayer(map, geojson, { metricCol, opacity: eff });
        break;
      case 'boundary':
        addOrUpdateBoundaryLayer(map, geojson, { color: borderColor, width: borderWidth, opacity: eff });
        break;
      default:
        break;
    }

    if (showLabels && labelCol) {
      addOrUpdateLabelsLayer(map, geojson, { labelCol, minZoom: labelZoomThreshold });
    }

    // Fit to bounds on first render
    if (fitToBounds && mapStateManager.needsInitialFit()) {
      const computedBounds = bounds ?? computeBoundsFromFeatureCollection(geojson);
      if (computedBounds) {
        map.fitBounds(computedBounds as maplibregl.LngLatBoundsLike, { padding: 40, duration: 600 });
        mapStateManager.markInitialFitDone();
      }
    }
  }, [geojson, layerType, breaks, colors, metricCol, localOpacity, borderColor, borderWidth,
      noDataColor, pointRadius, pointRadiusMin, pointRadiusMax, showLabels, labelCol,
      labelZoomThreshold, fitToBounds, bounds]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const style = resolveStyle(basemapId);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: style as maplibregl.StyleSpecification,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.once('load', () => {
      applyDataLayers(map);
    });

    map.on('zoom', () => { setZoom(map.getZoom()); });
    map.on('moveend', () => { mapStateManager.saveState(map); });

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        mapStateManager.reset();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Update data layers when data/config changes (after initial mount)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyDataLayers(map);
  }, [applyDataLayers]);

  // Switch basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = resolveStyle(basemapId);
    mapStateManager.saveState(map);
    // Re-apply data layers after style loads
    map.once('styledata', () => {
      setTimeout(() => {
        if (map.isStyleLoaded()) {
          applyDataLayers(map);
          // Restore camera position
          const c = mapStateManager.getCenter();
          const z = mapStateManager.getZoom();
          if (c && z !== null) {
            map.jumpTo({ center: c, zoom: z });
          }
        }
      }, 100);
    });
    map.setStyle(style as maplibregl.StyleSpecification);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapId]);

  // Hover interaction — attach/detach on layer type change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const HOVERABLE: Partial<Record<typeof layerType, string>> = {
      choropleth: 'vitalmap-choropleth-fill',
      bubble: 'vitalmap-bubble-circle',
      point: 'vitalmap-point-circle',
    };
    const sourceMap: Partial<Record<typeof layerType, string>> = {
      choropleth: 'vitalmap-choropleth',
      bubble: 'vitalmap-bubble',
      point: 'vitalmap-point',
    };

    const layerId = HOVERABLE[layerType];
    const sourceId = sourceMap[layerType];
    if (!layerId || !sourceId) return;

    const onMouseMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const fid = feat.id;

      if (hoveredRef.current && hoveredRef.current.id !== fid) {
        map.setFeatureState({ source: hoveredRef.current.source, id: hoveredRef.current.id }, { hover: false });
      }
      if (fid !== undefined) {
        map.setFeatureState({ source: sourceId, id: fid }, { hover: true });
        hoveredRef.current = { id: fid, source: sourceId };
      }

      const props = feat.properties ?? {};
      const payload = buildTooltipPayload(props as Record<string, unknown>, {
        metricCol, labelCol, categoryCol, extraCols: tooltipCols, metricLabel: metricCol,
      });
      setTooltip({ payload, x: e.point.x, y: e.point.y });
      map.getCanvas().style.cursor = 'pointer';
    };

    const onMouseLeave = () => {
      if (hoveredRef.current) {
        map.setFeatureState({ source: hoveredRef.current.source, id: hoveredRef.current.id }, { hover: false });
        hoveredRef.current = null;
      }
      setTooltip(null);
      map.getCanvas().style.cursor = '';
    };

    const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties ?? {};
      const payload = buildTooltipPayload(props as Record<string, unknown>, {
        metricCol, labelCol, categoryCol, extraCols: tooltipCols, metricLabel: metricCol,
      });
      setPinnedTooltip({ payload, x: e.point.x, y: e.point.y });
    };

    // Defer to next tick to give layer time to be added
    const attach = () => {
      if (map.getLayer(layerId)) {
        map.on('mousemove', layerId, onMouseMove);
        map.on('mouseleave', layerId, onMouseLeave);
        map.on('click', layerId, onClick);
      }
    };
    const timer = setTimeout(attach, 200);

    return () => {
      clearTimeout(timer);
      try {
        map.off('mousemove', layerId, onMouseMove);
        map.off('mouseleave', layerId, onMouseLeave);
        map.off('click', layerId, onClick);
      } catch { /* layer may not exist */ }
    };
  }, [layerType, metricCol, labelCol, categoryCol, tooltipCols]);

  // Resize map when container size changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.resize();
  }, [width, height]);

  // ResizeObserver for dynamic container changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const handleZoomIn = useCallback(() => { mapRef.current?.zoomIn(); }, []);
  const handleZoomOut = useCallback(() => { mapRef.current?.zoomOut(); }, []);

  const isEmpty = !geojson || geojson.features.length === 0;

  return (
    <div style={{ position: 'relative', width, height, fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {isEmpty && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(248,249,250,0.9)', zIndex: 5, color: '#888', fontSize: 14, flexDirection: 'column', gap: 8,
        }}>
          <span style={{ fontSize: 32 }}>🗺</span>
          <span>No data to display</span>
          <span style={{ fontSize: 11, color: '#bbb' }}>Configure latitude/longitude or geometry columns</span>
        </div>
      )}

      <LegendPanel legend={legend} position={legendPosition} visible={showLegend} />

      {!pinnedTooltip && tooltip && (
        <TooltipCard
          payload={tooltip.payload}
          x={tooltip.x}
          y={tooltip.y}
          pinned={false}
          containerWidth={width}
          containerHeight={height}
          onClose={() => {}}
        />
      )}
      {pinnedTooltip && (
        <TooltipCard
          payload={pinnedTooltip.payload}
          x={pinnedTooltip.x}
          y={pinnedTooltip.y}
          pinned
          containerWidth={width}
          containerHeight={height}
          onClose={() => setPinnedTooltip(null)}
        />
      )}

      <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />

      {showBasemapSwitcher && (
        <BasemapSwitcher
          currentId={basemapId}
          presets={BASEMAP_PRESETS}
          onChange={id => setBasemapId(id)}
        />
      )}

      {showLayerPanel && (
        <LayerPanel
          layerType={layerType}
          opacity={localOpacity}
          onOpacityChange={v => {
            setLocalOpacity(v);
            const map = mapRef.current;
            if (!map) return;
            // Apply opacity to current layer in real-time
            try {
              if (layerType === 'choropleth') map.setPaintProperty('vitalmap-choropleth-fill', 'fill-opacity', v);
              if (layerType === 'bubble') map.setPaintProperty('vitalmap-bubble-circle', 'circle-opacity', v);
              if (layerType === 'point') map.setPaintProperty('vitalmap-point-circle', 'circle-opacity', v);
              if (layerType === 'heatmap') map.setPaintProperty('vitalmap-heatmap', 'heatmap-opacity', v);
              if (layerType === 'boundary') map.setPaintProperty('vitalmap-boundary-line', 'line-opacity', v);
            } catch { /* layer may not exist yet */ }
          }}
        />
      )}

      {showStatusBar && (
        <MapStatusBar zoom={zoom} featureCount={geojson?.features.length ?? 0} />
      )}
    </div>
  );
};

export default VitalMapsChart;
