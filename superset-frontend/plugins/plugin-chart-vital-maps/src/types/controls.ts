export type LayerType = 'point' | 'bubble' | 'choropleth' | 'heatmap' | 'boundary' | 'labels';

export type ClassificationMethod = 'quantile' | 'equal_interval' | 'manual' | 'categorical';

export type LegendPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type VitalMapsFormData = {
  layer_type: LayerType;
  latitude_col?: string;
  longitude_col?: string;
  geometry_col?: string;
  metric?: string;
  category_col?: string;
  label_col?: string;
  basemap_preset: string;
  basemap_style_url?: string;
  color_scheme: string;
  opacity: number;
  border_color: string;
  border_width: number;
  point_radius: number;
  bubble_radius_min: number;
  bubble_radius_max: number;
  classification_method: ClassificationMethod;
  class_count: number;
  manual_breaks?: string;
  show_labels: boolean;
  label_zoom_threshold: number;
  show_legend: boolean;
  legend_position: LegendPosition;
  fit_bounds: boolean;
  show_layer_panel: boolean;
  show_basemap_switcher: boolean;
  tooltip_fields?: string[];
  adhoc_filters?: any[];
  row_limit?: number;
  [key: string]: any;
};
