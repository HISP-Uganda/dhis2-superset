import React, { useRef, useState, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { VitalMapsTransformedProps, TooltipPayload, LayerType } from '../plugin/types';
import { BASEMAP_PRESETS, BASEMAP_PRESETS_BY_ID, DEFAULT_BASEMAP_ID } from '../constants/basemaps';
import { DEFAULT_CENTER, DEFAULT_ZOOM, LYR, SRC } from '../constants/defaults';
import { MapStateManager } from '../utils/mapState';
import { buildTooltipPayload } from '../utils/tooltip';
import { computeBoundsFromFeatureCollection } from '../utils/bounds';
import { assignClass } from '../utils/classify';

import { addOrUpdateChoroplethLayer, removeChoroplethLayer } from '../layers/choropleth';
import { addOrUpdateBubbleLayer, removeBubbleLayer } from '../layers/bubble';
import { addOrUpdatePointLayer, removePointLayer } from '../layers/point';
import { addOrUpdateHeatmapLayer, removeHeatmapLayer } from '../layers/heatmap';
import { addOrUpdateBoundaryLayer, removeBoundaryLayer } from '../layers/boundary';
import { addOrUpdateLabelsLayer, removeLabelsLayer } from '../layers/labels';
import { addOrUpdateClusterLayer, removeClusterLayer, expandCluster } from '../layers/cluster';
import { addOrUpdateExtrusionLayer, removeExtrusionLayer } from '../layers/extrusion';
import { addOrUpdateMarkerLayer, removeMarkerLayer, loadMarkerIcons } from '../layers/marker';

import LegendPanel from './LegendPanel';
import TooltipCard from './TooltipCard';
import ZoomControls from './ZoomControls';
import BasemapSwitcher from './BasemapSwitcher';
import MapStatusBar from './MapStatusBar';
import LayerPanel from './LayerPanel';
import FullscreenButton from './FullscreenButton';
import ExportButton from './ExportButton';
import SearchBar from './SearchBar';

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
  removeClusterLayer,
  removeExtrusionLayer,
  removeMarkerLayer,
];

function removeAllLayers(map: maplibregl.Map): void {
  ALL_REMOVERS.forEach(fn => {
    try { fn(map); } catch { /* ignore */ }
  });
}

/** Look up the color for a feature value from breaks/colors arrays */
function getFeatureColor(
  value: unknown, breaks: number[], colors: string[], noDataColor: string,
): string {
  const v = Number(value);
  if (!Number.isFinite(v) || breaks.length === 0) return noDataColor;
  const idx = assignClass(v, breaks);
  return colors[idx] ?? noDataColor;
}

const VitalMapsChart: React.FC<Props> = (props) => {
  const {
    width, height, layerType, geojson, bounds, breaks, colors, legend,
    basemap, metricCol, labelCol, categoryCol, tooltipCols, opacity,
    borderColor, borderWidth, pointRadius, pointRadiusMin, pointRadiusMax,
    showLabels, labelZoomThreshold, showLegend, legendPosition, fitToBounds,
    showLayerPanel, showBasemapSwitcher, showStatusBar, noDataColor,
    heatmapRadius, heatmapIntensity, heatmapWeightEnabled,
    showBoundaryOverlay, enableClustering, clusterRadius,
    extrusionMaxHeight, iconCol, iconSize, defaultIcon,
    totalMetricSum,
  } = props;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredRef = useRef<HoveredFeature>(null);
  const [basemapId, setBasemapId] = useState(basemap?.id ?? DEFAULT_BASEMAP_ID);
  const [tooltip, setTooltip] = useState<{ payload: TooltipPayload; x: number; y: number } | null>(null);
  const [pinnedTooltip, setPinnedTooltip] = useState<{ payload: TooltipPayload; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [localOpacity, setLocalOpacity] = useState(opacity);
  const [hiddenLegendItems, setHiddenLegendItems] = useState<Set<number>>(new Set());
  const [markerIconsLoaded, setMarkerIconsLoaded] = useState(false);
  const prevLayerTypeRef = useRef<LayerType | null>(null);

  // Update localOpacity when prop changes
  useEffect(() => { setLocalOpacity(opacity); }, [opacity]);

  // Reset hidden legend items when layer or data changes
  useEffect(() => { setHiddenLegendItems(new Set()); }, [layerType, geojson]);

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
        if (enableClustering) {
          addOrUpdateClusterLayer(map, geojson, {
            clusterRadius, clusterMaxZoom: 14,
            color: colors[colors.length - 1] ?? '#4e79a7',
            pointRadius, opacity: eff, borderColor, borderWidth,
          });
        } else {
          addOrUpdateBubbleLayer(map, geojson, {
            metricCol, minRadius: pointRadiusMin, maxRadius: pointRadiusMax,
            color: colors[colors.length - 1] ?? '#4e79a7', opacity: eff,
            borderColor, borderWidth, hoveredId: null,
          });
        }
        break;
      case 'point':
        if (enableClustering) {
          addOrUpdateClusterLayer(map, geojson, {
            clusterRadius, clusterMaxZoom: 14,
            color: colors[colors.length - 1] ?? '#4e79a7',
            pointRadius, opacity: eff, borderColor, borderWidth,
          });
        } else {
          addOrUpdatePointLayer(map, geojson, {
            radius: pointRadius, color: colors[colors.length - 1] ?? '#4e79a7',
            opacity: eff, borderColor, borderWidth, hoveredId: null,
          });
        }
        break;
      case 'heatmap':
        addOrUpdateHeatmapLayer(map, geojson, {
          metricCol: heatmapWeightEnabled ? metricCol : undefined,
          radius: heatmapRadius,
          intensity: heatmapIntensity,
          opacity: eff,
        });
        break;
      case 'boundary':
        addOrUpdateBoundaryLayer(map, geojson, { color: borderColor, width: borderWidth, opacity: eff });
        break;
      case 'extrusion':
        addOrUpdateExtrusionLayer(map, geojson, {
          breaks, colors, metricCol, maxHeight: extrusionMaxHeight,
          opacity: eff, noDataColor,
        });
        break;
      case 'marker':
        if (enableClustering) {
          addOrUpdateClusterLayer(map, geojson, {
            clusterRadius, clusterMaxZoom: 14,
            color: '#4e79a7', pointRadius, opacity: eff, borderColor, borderWidth,
          });
        } else if (markerIconsLoaded) {
          addOrUpdateMarkerLayer(map, geojson, {
            iconCol: iconCol || undefined, iconSize, defaultIcon,
            labelCol: labelCol || undefined, opacity: eff,
          });
        }
        break;
      default:
        break;
    }

    // Boundary overlay on choropleth/heatmap/extrusion
    if (showBoundaryOverlay && layerType !== 'boundary') {
      addOrUpdateBoundaryLayer(map, geojson, { color: borderColor, width: borderWidth, opacity: eff });
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
      labelZoomThreshold, fitToBounds, bounds, heatmapRadius, heatmapIntensity,
      heatmapWeightEnabled, showBoundaryOverlay, enableClustering, clusterRadius,
      extrusionMaxHeight, iconCol, iconSize, defaultIcon, markerIconsLoaded]);

  // Initialize map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const style = resolveStyle(basemapId);
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: style as maplibregl.StyleSpecification,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      preserveDrawingBuffer: true, // enables PNG export via canvas.toDataURL
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.once('load', () => {
      // Pre-load marker icons
      loadMarkerIcons(map).then(() => {
        setMarkerIconsLoaded(true);
      });
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

  // Manage pitch for 3D extrusion layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerType === 'extrusion' && prevLayerTypeRef.current !== 'extrusion') {
      map.easeTo({ pitch: 45, duration: 800 });
    } else if (layerType !== 'extrusion' && prevLayerTypeRef.current === 'extrusion') {
      map.easeTo({ pitch: 0, duration: 400 });
    }
    prevLayerTypeRef.current = layerType;
  }, [layerType]);

  // Switch basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = resolveStyle(basemapId);
    mapStateManager.saveState(map);
    map.once('styledata', () => {
      setTimeout(() => {
        if (map.isStyleLoaded()) {
          // Re-load marker icons after style change
          loadMarkerIcons(map).then(() => {
            applyDataLayers(map);
          });
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

  // Interactive legend — apply filter when hidden items change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || hiddenLegendItems.size === 0) {
      // Clear any applied filters
      const map2 = mapRef.current;
      if (map2) {
        try {
          if (map2.getLayer(LYR.CHOROPLETH_FILL)) {
            map2.setFilter(LYR.CHOROPLETH_FILL, ['==', ['geometry-type'], 'Polygon']);
          }
          if (map2.getLayer(LYR.EXTRUSION)) {
            map2.setFilter(LYR.EXTRUSION, ['==', ['geometry-type'], 'Polygon']);
          }
        } catch { /* layer may not exist */ }
      }
      return;
    }

    if (!legend || !metricCol) return;

    // Build filter to hide classes
    if (legend.type === 'classed' && breaks.length > 0) {
      const visibleRanges: Array<[number, number]> = [];
      // Legend items correspond to break ranges
      legend.items.forEach((item, i) => {
        if (hiddenLegendItems.has(i)) return;
        if (item.isNoData) return;
        if (item.valueMin !== undefined && item.valueMax !== undefined) {
          visibleRanges.push([item.valueMin, item.valueMax]);
        }
      });

      const filter: any = ['all',
        ['==', ['geometry-type'], 'Polygon'],
        ['any',
          ...visibleRanges.map(([min, max]) =>
            ['all', ['>=', ['get', metricCol], min], ['<=', ['get', metricCol], max]],
          ),
        ],
      ];

      try {
        if (map.getLayer(LYR.CHOROPLETH_FILL)) map.setFilter(LYR.CHOROPLETH_FILL, filter);
        if (map.getLayer(LYR.CHOROPLETH_OUTLINE)) map.setFilter(LYR.CHOROPLETH_OUTLINE, filter);
        if (map.getLayer(LYR.CHOROPLETH_HOVER)) map.setFilter(LYR.CHOROPLETH_HOVER, filter);
        if (map.getLayer(LYR.EXTRUSION)) map.setFilter(LYR.EXTRUSION, filter);
      } catch { /* layer may not exist */ }
    } else if (legend.type === 'categorical' && categoryCol) {
      const visibleCats: string[] = [];
      legend.items.forEach((item, i) => {
        if (hiddenLegendItems.has(i) || item.isNoData) return;
        visibleCats.push(item.label);
      });

      const filter: any = ['in', ['get', categoryCol], ['literal', visibleCats]];
      try {
        if (map.getLayer(LYR.POINT)) map.setFilter(LYR.POINT, filter);
        if (map.getLayer(LYR.BUBBLE)) map.setFilter(LYR.BUBBLE, filter);
      } catch { /* layer may not exist */ }
    }
  }, [hiddenLegendItems, legend, breaks, metricCol, categoryCol]);

  // Hover interaction — attach/detach on layer type change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const HOVERABLE: Partial<Record<LayerType, string>> = {
      choropleth: LYR.CHOROPLETH_FILL,
      bubble: LYR.BUBBLE,
      point: LYR.POINT,
      extrusion: LYR.EXTRUSION,
    };
    const sourceMap: Partial<Record<LayerType, string>> = {
      choropleth: SRC.CHOROPLETH,
      bubble: SRC.BUBBLE,
      point: SRC.POINT,
      extrusion: SRC.EXTRUSION,
    };

    // If clustering is active, hover unclustered points + click to expand clusters
    const isClusteredMode = enableClustering && (layerType === 'point' || layerType === 'bubble' || layerType === 'marker');

    const layerId = isClusteredMode ? LYR.CLUSTER_UNCLUSTERED : HOVERABLE[layerType];
    const sourceId = isClusteredMode ? SRC.CLUSTER : sourceMap[layerType];

    const onMouseMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const fid = feat.id;

      if (hoveredRef.current && hoveredRef.current.id !== fid && hoveredRef.current.source === sourceId) {
        try {
          map.setFeatureState({ source: hoveredRef.current.source, id: hoveredRef.current.id }, { hover: false });
        } catch { /* ignore */ }
      }
      if (fid !== undefined && sourceId) {
        try {
          map.setFeatureState({ source: sourceId, id: fid }, { hover: true });
          hoveredRef.current = { id: fid, source: sourceId };
        } catch { /* ignore */ }
      }

      const featureProps = feat.properties ?? {};
      const featureColor = metricCol ? getFeatureColor(featureProps[metricCol], breaks, colors, noDataColor) : undefined;
      const payload = buildTooltipPayload(featureProps as Record<string, unknown>, {
        metricCol, labelCol, categoryCol, extraCols: tooltipCols, metricLabel: metricCol,
        featureColor,
      });
      setTooltip({ payload, x: e.point.x, y: e.point.y });
      map.getCanvas().style.cursor = 'pointer';
    };

    const onMouseLeave = () => {
      if (hoveredRef.current) {
        try {
          map.setFeatureState({ source: hoveredRef.current.source, id: hoveredRef.current.id }, { hover: false });
        } catch { /* ignore */ }
        hoveredRef.current = null;
      }
      setTooltip(null);
      map.getCanvas().style.cursor = '';
    };

    const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features || e.features.length === 0) return;
      const featureProps = e.features[0].properties ?? {};
      const featureColor = metricCol ? getFeatureColor(featureProps[metricCol], breaks, colors, noDataColor) : undefined;
      const payload = buildTooltipPayload(featureProps as Record<string, unknown>, {
        metricCol, labelCol, categoryCol, extraCols: tooltipCols, metricLabel: metricCol,
        featureColor,
      });
      setPinnedTooltip({ payload, x: e.point.x, y: e.point.y });
    };

    // Cluster expand handler
    const onClusterClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const clusterId = feat.properties?.cluster_id;
      if (clusterId !== undefined) {
        const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];
        expandCluster(map, clusterId, coords);
      }
    };

    const attach = () => {
      // Attach hover/click on the data layer
      if (layerId && map.getLayer(layerId)) {
        map.on('mousemove', layerId, onMouseMove);
        map.on('mouseleave', layerId, onMouseLeave);
        map.on('click', layerId, onClick);
      }
      // Attach cluster expand click
      if (isClusteredMode && map.getLayer(LYR.CLUSTER_CIRCLE)) {
        map.on('click', LYR.CLUSTER_CIRCLE, onClusterClick);
      }
      // Marker layer click/hover
      if (layerType === 'marker' && !enableClustering && map.getLayer(LYR.MARKER)) {
        map.on('click', LYR.MARKER, onClick);
        map.on('mousemove', LYR.MARKER, (e: any) => {
          if (e.features && e.features.length > 0) {
            const featureProps = e.features[0].properties ?? {};
            const payload = buildTooltipPayload(featureProps as Record<string, unknown>, {
              metricCol, labelCol, categoryCol, extraCols: tooltipCols, metricLabel: metricCol,
            });
            setTooltip({ payload, x: e.point.x, y: e.point.y });
            map.getCanvas().style.cursor = 'pointer';
          }
        });
        map.on('mouseleave', LYR.MARKER, () => {
          setTooltip(null);
          map.getCanvas().style.cursor = '';
        });
      }
    };
    const timer = setTimeout(attach, 200);

    return () => {
      clearTimeout(timer);
      try {
        if (layerId) {
          map.off('mousemove', layerId, onMouseMove);
          map.off('mouseleave', layerId, onMouseLeave);
          map.off('click', layerId, onClick);
        }
        if (isClusteredMode) {
          map.off('click', LYR.CLUSTER_CIRCLE, onClusterClick);
        }
        if (layerType === 'marker' && !enableClustering) {
          // MapLibre cleans up on removeLayer; explicit cleanup not always possible
        }
      } catch { /* layer may not exist */ }
    };
  }, [layerType, metricCol, labelCol, categoryCol, tooltipCols, enableClustering, breaks, colors, noDataColor]);

  // Resize map when container size changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.resize();
  }, [width, height]);

  // ResizeObserver for dynamic container changes
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const handleZoomIn = useCallback(() => { mapRef.current?.zoomIn(); }, []);
  const handleZoomOut = useCallback(() => { mapRef.current?.zoomOut(); }, []);

  const handleLegendToggle = useCallback((index: number) => {
    setHiddenLegendItems(prev => {
      const next = new Set(prev);
      if (next.has(index)) { next.delete(index); } else { next.add(index); }
      return next;
    });
  }, []);

  const handleSearchSelect = useCallback((feature: GeoJSON.Feature) => {
    const map = mapRef.current;
    if (!map || !feature.geometry) return;
    const geom = feature.geometry;
    if (geom.type === 'Point') {
      const [lng, lat] = geom.coordinates;
      map.easeTo({ center: [lng, lat], zoom: 10, duration: 600 });
    } else {
      // Compute bbox of feature
      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [feature] };
      const b = computeBoundsFromFeatureCollection(fc);
      if (b) {
        map.fitBounds(b as maplibregl.LngLatBoundsLike, { padding: 60, duration: 600 });
      }
    }
  }, []);

  const isEmpty = !geojson || geojson.features.length === 0;

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width, height, fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {isEmpty && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(248,249,250,0.9)', zIndex: 5, color: '#888', fontSize: 14, flexDirection: 'column', gap: 8,
        }}>
          <span style={{ fontSize: 32 }}>{'\uD83D\uDDFA'}</span>
          <span>No data to display</span>
          <span style={{ fontSize: 11, color: '#bbb' }}>Configure latitude/longitude or geometry columns</span>
        </div>
      )}

      <FullscreenButton containerRef={wrapperRef} />
      <ExportButton mapRef={mapRef} />

      {labelCol && (
        <SearchBar geojson={geojson} labelCol={labelCol} onSelect={handleSearchSelect} />
      )}

      <LegendPanel
        legend={legend}
        position={legendPosition}
        visible={showLegend}
        hiddenItems={hiddenLegendItems}
        onToggleItem={handleLegendToggle}
      />

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
            try {
              if (layerType === 'choropleth') map.setPaintProperty(LYR.CHOROPLETH_FILL, 'fill-opacity', v);
              if (layerType === 'bubble') map.setPaintProperty(LYR.BUBBLE, 'circle-opacity', v);
              if (layerType === 'point') map.setPaintProperty(LYR.POINT, 'circle-opacity', v);
              if (layerType === 'heatmap') map.setPaintProperty(LYR.HEATMAP, 'heatmap-opacity', v);
              if (layerType === 'boundary') map.setPaintProperty(LYR.BOUNDARY, 'line-opacity', v);
              if (layerType === 'extrusion') map.setPaintProperty(LYR.EXTRUSION, 'fill-extrusion-opacity', v);
              if (layerType === 'marker') map.setPaintProperty(LYR.MARKER, 'icon-opacity', v);
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
