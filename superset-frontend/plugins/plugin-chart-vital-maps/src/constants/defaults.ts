export const DEFAULT_LAYER_TYPE = 'choropleth';
export const DEFAULT_OPACITY = 0.65;
export const DEFAULT_BORDER_WIDTH = 1.2;
export const DEFAULT_BORDER_COLOR = '#ffffff';
export const DEFAULT_POINT_RADIUS = 8;
export const DEFAULT_POINT_RADIUS_MIN = 4;
export const DEFAULT_POINT_RADIUS_MAX = 40;
export const DEFAULT_LABEL_ZOOM = 7;
export const DEFAULT_CLASS_COUNT = 5;
export const DEFAULT_NO_DATA_COLOR = '#cccccc';
export const DEFAULT_HOVER_BORDER_WIDTH = 2.5;
export const DEFAULT_HOVER_BORDER_COLOR = '#333333';
export const DEFAULT_CENTER: [number, number] = [0, 20];
export const DEFAULT_ZOOM = 3;

// Deterministic source/layer ID prefixes
export const SRC = {
  CHOROPLETH: 'vitalmap-choropleth',
  BUBBLE: 'vitalmap-bubble',
  POINT: 'vitalmap-point',
  HEATMAP: 'vitalmap-heatmap',
  BOUNDARY: 'vitalmap-boundary',
  LABELS: 'vitalmap-labels',
};

export const LYR = {
  CHOROPLETH_FILL: 'vitalmap-choropleth-fill',
  CHOROPLETH_OUTLINE: 'vitalmap-choropleth-outline',
  CHOROPLETH_HOVER: 'vitalmap-choropleth-hover',
  BUBBLE: 'vitalmap-bubble-circle',
  BUBBLE_OUTLINE: 'vitalmap-bubble-outline',
  POINT: 'vitalmap-point-circle',
  POINT_OUTLINE: 'vitalmap-point-outline',
  HEATMAP: 'vitalmap-heatmap',
  BOUNDARY: 'vitalmap-boundary-line',
  LABELS: 'vitalmap-labels-text',
};
