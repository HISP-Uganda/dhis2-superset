import type { ChartProps } from '@superset-ui/core';
import type { VitalMapsFormData, VitalMapsTransformedProps, ClassificationMethod, LayerType, LegendPosition } from './types';
import { BASEMAP_PRESETS_BY_ID, DEFAULT_BASEMAP_ID } from '../constants/basemaps';
import {
  DEFAULT_OPACITY, DEFAULT_BORDER_WIDTH, DEFAULT_BORDER_COLOR, DEFAULT_POINT_RADIUS,
  DEFAULT_POINT_RADIUS_MIN, DEFAULT_POINT_RADIUS_MAX, DEFAULT_LABEL_ZOOM,
  DEFAULT_CLASS_COUNT, DEFAULT_NO_DATA_COLOR,
  DEFAULT_HEATMAP_RADIUS, DEFAULT_HEATMAP_INTENSITY,
  DEFAULT_CLUSTER_RADIUS, DEFAULT_EXTRUSION_MAX_HEIGHT,
  DEFAULT_ICON_SIZE, DEFAULT_ICON,
} from '../constants/defaults';
import { normalizeToFeatureCollection } from '../utils/geometry';
import { computeBoundsFromFeatureCollection } from '../utils/bounds';
import { quantileBreaks, equalIntervalBreaks, parseManualBreaks, extractCategories } from '../utils/classify';
import { getRamp, getCategoricalPalette, rampColors } from '../utils/colorScales';
import { buildClassedLegend, buildCategoricalLegend, addNoDataItem } from '../utils/legend';

function rgbaToHex(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    const { r = 0, g = 0, b = 0 } = val as Record<string, number>;
    return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
  }
  return DEFAULT_BORDER_COLOR;
}

export default function transformProps(chartProps: ChartProps): VitalMapsTransformedProps {
  const { width, height, formData, queriesData } = chartProps;
  const fd = formData as VitalMapsFormData;

  const rows: Record<string, unknown>[] = (queriesData?.[0]?.data ?? []) as Record<string, unknown>[];

  const layerType: LayerType = (fd.layer_type as LayerType) ?? 'choropleth';
  const metricCol = String(fd.metric ?? '');
  const latCol = fd.lat_col ?? '';
  const lonCol = fd.lon_col ?? '';
  const geometryCol = fd.geometry_col ?? '';
  const labelCol = fd.label_col ?? '';
  const categoryCol = fd.category_col ?? '';
  const tooltipCols: string[] = Array.isArray(fd.tooltip_cols) ? fd.tooltip_cols : [];

  const classificationMethod: ClassificationMethod = (fd.classification_method as ClassificationMethod) ?? 'quantile';
  const classCount = fd.class_count ?? DEFAULT_CLASS_COUNT;
  const colorScheme = fd.color_scheme ?? 'YlOrRd';

  const opacity = fd.opacity ?? DEFAULT_OPACITY;
  const borderColor = rgbaToHex(fd.border_color);
  const borderWidth = fd.border_width ?? DEFAULT_BORDER_WIDTH;
  const pointRadius = fd.point_radius ?? DEFAULT_POINT_RADIUS;
  const pointRadiusMin = fd.point_radius_min ?? DEFAULT_POINT_RADIUS_MIN;
  const pointRadiusMax = fd.point_radius_max ?? DEFAULT_POINT_RADIUS_MAX;

  // Normalize data to GeoJSON
  const geojson = normalizeToFeatureCollection(rows, {
    latCol: latCol || undefined,
    lonCol: lonCol || undefined,
    geometryCol: geometryCol || undefined,
    metricCol: metricCol || undefined,
    labelCol: labelCol || undefined,
    categoryCol: categoryCol || undefined,
  });

  // Compute bounds
  const bounds = computeBoundsFromFeatureCollection(geojson);

  // Compute class breaks and colors
  let breaks: number[] = [];
  let colors: string[] = [];
  let legend = null;

  if (classificationMethod === 'categorical' && categoryCol) {
    const cats = extractCategories(rows, categoryCol);
    colors = getCategoricalPalette('Tableau10').slice(0, cats.length);
    legend = addNoDataItem(buildCategoricalLegend(cats, colors, metricCol || categoryCol));
  } else {
    const values = geojson.features
      .map(f => Number((f.properties ?? {})[metricCol]))
      .filter(Number.isFinite);

    if (classificationMethod === 'manual' && fd.manual_breaks) {
      breaks = parseManualBreaks(fd.manual_breaks) ?? quantileBreaks(values, classCount);
    } else if (classificationMethod === 'equal_interval') {
      breaks = equalIntervalBreaks(values, classCount);
    } else {
      breaks = quantileBreaks(values, classCount);
    }

    const ramp = getRamp(colorScheme);
    colors = rampColors(ramp, breaks.length);

    if (breaks.length > 0 && values.length > 0) {
      legend = addNoDataItem(buildClassedLegend(breaks, colors, metricCol));
    }
  }

  // Pre-compute metric totals for enhanced tooltips
  let totalMetricSum = 0;
  if (metricCol) {
    let rank = 0;
    const featureValues = geojson.features
      .map((f, idx) => ({ idx, val: Number((f.properties ?? {})[metricCol]) }))
      .filter(x => Number.isFinite(x.val));
    totalMetricSum = featureValues.reduce((s, x) => s + x.val, 0);

    // Sort descending for rank assignment
    featureValues.sort((a, b) => b.val - a.val);
    const rankMap = new Map<number, number>();
    featureValues.forEach((x, i) => { rankMap.set(x.idx, i + 1); });

    // Annotate features with rank and percentage
    const total = featureValues.length;
    geojson.features.forEach((f, idx) => {
      if (!f.properties) f.properties = {};
      const r = rankMap.get(idx);
      if (r !== undefined) {
        f.properties.__vm_rank = `${r} of ${total}`;
        const val = Number(f.properties[metricCol]);
        f.properties.__vm_pct = totalMetricSum > 0
          ? `${(val / totalMetricSum * 100).toFixed(1)}%`
          : '—';
      }
    });
  }

  // Resolve basemap
  const basemapStyleUrl = fd.basemap_style_url;
  let basemap = BASEMAP_PRESETS_BY_ID[fd.basemap_id ?? DEFAULT_BASEMAP_ID] ?? BASEMAP_PRESETS_BY_ID[DEFAULT_BASEMAP_ID];
  if (basemapStyleUrl) {
    basemap = { ...basemap, style: basemapStyleUrl };
  }

  return {
    width: width ?? 800,
    height: height ?? 600,
    layerType,
    geojson,
    bounds,
    breaks,
    colors,
    legend,
    basemap,
    metricCol,
    labelCol,
    categoryCol,
    tooltipCols,
    opacity,
    borderColor,
    borderWidth,
    pointRadius,
    pointRadiusMin,
    pointRadiusMax,
    showLabels: fd.show_labels ?? false,
    labelZoomThreshold: fd.label_zoom_threshold ?? DEFAULT_LABEL_ZOOM,
    showLegend: fd.show_legend ?? true,
    legendPosition: (fd.legend_position as LegendPosition) ?? 'bottom-right',
    fitToBounds: fd.fit_to_bounds ?? true,
    showLayerPanel: fd.show_layer_panel ?? false,
    showBasemapSwitcher: fd.show_basemap_switcher ?? false,
    showStatusBar: fd.show_status_bar ?? false,
    noDataColor: DEFAULT_NO_DATA_COLOR,
    // Heatmap controls
    heatmapRadius: fd.heatmap_radius ?? DEFAULT_HEATMAP_RADIUS,
    heatmapIntensity: fd.heatmap_intensity ?? DEFAULT_HEATMAP_INTENSITY,
    heatmapWeightEnabled: fd.heatmap_weight_enabled ?? true,
    // Multi-layer overlay
    showBoundaryOverlay: fd.show_boundary_overlay ?? false,
    // Clustering
    enableClustering: fd.enable_clustering ?? false,
    clusterRadius: fd.cluster_radius ?? DEFAULT_CLUSTER_RADIUS,
    // 3D Extrusion
    extrusionMaxHeight: fd.extrusion_max_height ?? DEFAULT_EXTRUSION_MAX_HEIGHT,
    // Marker/Icon
    iconCol: fd.icon_col ?? '',
    iconSize: fd.icon_size ?? DEFAULT_ICON_SIZE,
    defaultIcon: fd.default_icon ?? DEFAULT_ICON,
    // Enhanced tooltips
    totalMetricSum,
  };
}
