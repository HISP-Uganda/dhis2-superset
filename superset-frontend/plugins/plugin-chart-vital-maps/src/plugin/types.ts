import type { QueryFormData } from '@superset-ui/core';
import type { BasemapStyleDefinition } from '../constants/basemaps';

export type LayerType = 'point' | 'bubble' | 'choropleth' | 'heatmap' | 'boundary';
export type ClassificationMethod = 'quantile' | 'equal_interval' | 'manual' | 'categorical';
export type LegendPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface LegendItem {
  label: string;
  color: string;
  valueMin?: number;
  valueMax?: number;
  count?: number;
  isNoData?: boolean;
}

export interface LegendModel {
  title?: string;
  type: 'continuous' | 'classed' | 'categorical';
  items: LegendItem[];
}

export interface TooltipPayload {
  title?: string;
  subtitle?: string;
  metricLabel?: string;
  metricValue?: string | number;
  category?: string;
  fields?: Array<{ label: string; value: unknown }>;
}

export type BoundsResult = [[number, number], [number, number]] | null;

export interface VitalMapsFormData extends QueryFormData {
  layer_type?: LayerType;
  lat_col?: string;
  lon_col?: string;
  geometry_col?: string;
  metric?: string;
  category_col?: string;
  label_col?: string;
  basemap_id?: string;
  basemap_style_url?: string;
  color_scheme?: string;
  opacity?: number;
  border_color?: string | { r: number; g: number; b: number; a: number };
  border_width?: number;
  point_radius?: number;
  point_radius_min?: number;
  point_radius_max?: number;
  class_count?: number;
  classification_method?: ClassificationMethod;
  manual_breaks?: string;
  show_labels?: boolean;
  label_zoom_threshold?: number;
  show_legend?: boolean;
  legend_position?: LegendPosition;
  fit_to_bounds?: boolean;
  show_layer_panel?: boolean;
  show_basemap_switcher?: boolean;
  show_status_bar?: boolean;
  tooltip_cols?: string[];
}

export interface VitalMapsTransformedProps {
  width: number;
  height: number;
  layerType: LayerType;
  geojson: GeoJSON.FeatureCollection;
  bounds: BoundsResult;
  breaks: number[];
  colors: string[];
  legend: LegendModel | null;
  basemap: BasemapStyleDefinition;
  metricCol: string;
  labelCol: string;
  categoryCol: string;
  tooltipCols: string[];
  opacity: number;
  borderColor: string;
  borderWidth: number;
  pointRadius: number;
  pointRadiusMin: number;
  pointRadiusMax: number;
  showLabels: boolean;
  labelZoomThreshold: number;
  showLegend: boolean;
  legendPosition: LegendPosition;
  fitToBounds: boolean;
  showLayerPanel: boolean;
  showBasemapSwitcher: boolean;
  showStatusBar: boolean;
  noDataColor: string;
}
