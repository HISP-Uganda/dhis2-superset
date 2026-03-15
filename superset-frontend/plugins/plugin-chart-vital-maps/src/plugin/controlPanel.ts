import { t } from '@superset-ui/core';
import { ControlPanelConfig } from '@superset-ui/chart-controls';
import {
  DEFAULT_OPACITY, DEFAULT_BORDER_WIDTH,
  DEFAULT_POINT_RADIUS, DEFAULT_POINT_RADIUS_MIN, DEFAULT_POINT_RADIUS_MAX,
  DEFAULT_LABEL_ZOOM, DEFAULT_CLASS_COUNT, DEFAULT_LAYER_TYPE,
} from '../constants/defaults';
import { BASEMAP_PRESETS, DEFAULT_BASEMAP_ID } from '../constants/basemaps';

const controlPanel: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Layer Configuration'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'layer_type',
            config: {
              type: 'SelectControl',
              label: t('Layer Type'),
              default: DEFAULT_LAYER_TYPE,
              choices: [
                ['choropleth', t('Choropleth')],
                ['point', t('Point')],
                ['bubble', t('Bubble')],
                ['heatmap', t('Heatmap')],
                ['boundary', t('Boundary')],
              ],
              renderTrigger: false,
              description: t('Type of map layer to render'),
            },
          },
        ],
        [
          {
            name: 'geometry_col',
            config: {
              type: 'SelectControl',
              label: t('Geometry Column'),
              default: null,
              mapStateToProps: (state: any) => ({
                choices: (state.datasource?.columns || [])
                  .filter((c: any) => c.type_generic === 6 || String(c.column_name).toLowerCase().includes('geo'))
                  .map((c: any) => [c.column_name, c.column_name]),
              }),
              description: t('Column containing GeoJSON geometry or WKT'),
            },
          },
        ],
        [
          {
            name: 'lat_col',
            config: {
              type: 'SelectControl',
              label: t('Latitude Column'),
              default: null,
              mapStateToProps: (state: any) => ({
                choices: (state.datasource?.columns || [])
                  .map((c: any) => [c.column_name, c.column_name]),
              }),
              description: t('Column containing latitude values'),
            },
          },
          {
            name: 'lon_col',
            config: {
              type: 'SelectControl',
              label: t('Longitude Column'),
              default: null,
              mapStateToProps: (state: any) => ({
                choices: (state.datasource?.columns || [])
                  .map((c: any) => [c.column_name, c.column_name]),
              }),
              description: t('Column containing longitude values'),
            },
          },
        ],
        [
          {
            name: 'metric',
            config: {
              type: 'MetricsControl',
              label: t('Metric'),
              default: null,
              description: t('Metric to visualize (used for choropleth, bubble, heatmap)'),
              multi: false,
            },
          },
        ],
        [
          {
            name: 'category_col',
            config: {
              type: 'SelectControl',
              label: t('Category Column'),
              default: null,
              mapStateToProps: (state: any) => ({
                choices: (state.datasource?.columns || [])
                  .map((c: any) => [c.column_name, c.column_name]),
              }),
              description: t('Column for categorical coloring (point layer)'),
            },
          },
          {
            name: 'label_col',
            config: {
              type: 'SelectControl',
              label: t('Label Column'),
              default: null,
              mapStateToProps: (state: any) => ({
                choices: (state.datasource?.columns || [])
                  .map((c: any) => [c.column_name, c.column_name]),
              }),
              description: t('Column to use for feature labels'),
            },
          },
        ],
        [
          {
            name: 'tooltip_cols',
            config: {
              type: 'SelectControl',
              label: t('Tooltip Extra Columns'),
              default: [],
              multi: true,
              mapStateToProps: (state: any) => ({
                choices: (state.datasource?.columns || [])
                  .map((c: any) => [c.column_name, c.column_name]),
              }),
              description: t('Additional columns to show in tooltip'),
            },
          },
        ],
      ],
    },
    {
      label: t('Basemap'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'basemap_id',
            config: {
              type: 'SelectControl',
              label: t('Basemap Style'),
              default: DEFAULT_BASEMAP_ID,
              choices: BASEMAP_PRESETS.map(p => [p.id, p.label]),
              description: t('Preset basemap style'),
            },
          },
        ],
        [
          {
            name: 'basemap_style_url',
            config: {
              type: 'TextControl',
              label: t('Custom Style URL'),
              default: '',
              description: t('MapLibre Style JSON URL to use instead of preset (optional)'),
            },
          },
        ],
      ],
    },
    {
      label: t('Symbology'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'color_scheme',
            config: {
              type: 'ColorSchemeControl',
              label: t('Color Scheme'),
              default: 'YlOrRd',
              renderTrigger: true,
              description: t('Color ramp for quantitative layers'),
            },
          },
        ],
        [
          {
            name: 'opacity',
            config: {
              type: 'SliderControl',
              label: t('Opacity'),
              default: DEFAULT_OPACITY,
              min: 0,
              max: 1,
              step: 0.05,
              renderTrigger: true,
              description: t('Layer fill opacity'),
            },
          },
        ],
        [
          {
            name: 'border_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Border Color'),
              default: { r: 255, g: 255, b: 255, a: 1 },
              renderTrigger: true,
              description: t('Polygon or circle border color'),
            },
          },
          {
            name: 'border_width',
            config: {
              type: 'SliderControl',
              label: t('Border Width'),
              default: DEFAULT_BORDER_WIDTH,
              min: 0,
              max: 5,
              step: 0.1,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'point_radius',
            config: {
              type: 'SliderControl',
              label: t('Point Radius'),
              default: DEFAULT_POINT_RADIUS,
              min: 2,
              max: 30,
              step: 1,
              renderTrigger: true,
              description: t('Fixed radius for point layer'),
            },
          },
        ],
        [
          {
            name: 'point_radius_min',
            config: {
              type: 'SliderControl',
              label: t('Bubble Min Radius'),
              default: DEFAULT_POINT_RADIUS_MIN,
              min: 2,
              max: 20,
              step: 1,
              renderTrigger: true,
            },
          },
          {
            name: 'point_radius_max',
            config: {
              type: 'SliderControl',
              label: t('Bubble Max Radius'),
              default: DEFAULT_POINT_RADIUS_MAX,
              min: 5,
              max: 60,
              step: 1,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'classification_method',
            config: {
              type: 'SelectControl',
              label: t('Classification Method'),
              default: 'quantile',
              choices: [
                ['quantile', t('Quantile')],
                ['equal_interval', t('Equal Interval')],
                ['manual', t('Manual Breaks')],
                ['categorical', t('Categorical')],
              ],
              description: t('Method for creating class breaks'),
            },
          },
          {
            name: 'class_count',
            config: {
              type: 'SliderControl',
              label: t('Number of Classes'),
              default: DEFAULT_CLASS_COUNT,
              min: 2,
              max: 10,
              step: 1,
            },
          },
        ],
        [
          {
            name: 'manual_breaks',
            config: {
              type: 'TextControl',
              label: t('Manual Class Breaks'),
              default: '',
              description: t('Comma-separated break values, e.g.: 10,50,100,500'),
            },
          },
        ],
      ],
    },
    {
      label: t('Labels'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'show_labels',
            config: {
              type: 'CheckboxControl',
              label: t('Show Labels'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'label_zoom_threshold',
            config: {
              type: 'SliderControl',
              label: t('Label Zoom Threshold'),
              default: DEFAULT_LABEL_ZOOM,
              min: 1,
              max: 18,
              step: 1,
              renderTrigger: true,
              description: t('Labels appear at or above this zoom level'),
            },
          },
        ],
      ],
    },
    {
      label: t('Display'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'show_legend',
            config: {
              type: 'CheckboxControl',
              label: t('Show Legend'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'legend_position',
            config: {
              type: 'SelectControl',
              label: t('Legend Position'),
              default: 'bottom-right',
              choices: [
                ['top-left', t('Top Left')],
                ['top-right', t('Top Right')],
                ['bottom-left', t('Bottom Left')],
                ['bottom-right', t('Bottom Right')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'fit_to_bounds',
            config: {
              type: 'CheckboxControl',
              label: t('Fit to Bounds'),
              default: true,
              description: t('Automatically zoom to data extent on first load'),
            },
          },
        ],
        [
          {
            name: 'show_layer_panel',
            config: {
              type: 'CheckboxControl',
              label: t('Show Layer Panel'),
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'show_basemap_switcher',
            config: {
              type: 'CheckboxControl',
              label: t('Show Basemap Switcher'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_status_bar',
            config: {
              type: 'CheckboxControl',
              label: t('Show Status Bar'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
      ],
    },
  ],
};

export default controlPanel;
