/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { t } from '@superset-ui/core';
import {
  ControlPanelConfig,
  D3_FORMAT_OPTIONS,
  ControlPanelState,
  getStandardizedControls,
  sharedControls,
} from '@superset-ui/chart-controls';

const config: ControlPanelConfig = {
  controlPanelSections: [
    /* ── Query / Data ──────────────────────────────── */
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'metrics',
            config: {
              ...sharedControls.metrics,
              label: t('Metrics'),
              description: t('Indicator values to display'),
              multi: true,
            },
          },
        ],
        [
          {
            name: 'groupby',
            config: {
              ...sharedControls.groupby,
              label: t('Group By'),
              description: t(
                'Optional dimension to split metrics into groups',
              ),
              multi: true,
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },

    /* ── Per-Variable Configuration ────────────────── */
    {
      label: t('Variable Configuration'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'variable_config',
            config: {
              type: 'VariableConfigControl',
              label: t('Per-Variable Settings'),
              description: t(
                'Configure label, subtitle, formatting, colors, and image for each metric variable.',
              ),
              default: {},
              renderTrigger: true,
              mapStateToProps: (state: ControlPanelState) => ({
                metrics: state.form_data?.metrics || [],
              }),
            },
          },
        ],
      ],
    },

    /* ── Layout ─────────────────────────────────────── */
    {
      label: t('Layout'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'layout_mode',
            config: {
              type: 'SelectControl',
              label: t('Layout Mode'),
              default: 'grid',
              choices: [
                ['grid', t('Grid')],
                ['horizontal', t('Horizontal Row')],
                ['vertical', t('Vertical List')],
                ['split', t('Split (Label ← → Value)')],
                ['micro-card', t('Micro Cards')],
                ['compact-kpi', t('Compact KPI Matrix')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'grid_columns',
            config: {
              type: 'SelectControl',
              label: t('Grid Columns'),
              default: 3,
              choices: [
                [1, '1'],
                [2, '2'],
                [3, '3'],
                [4, '4'],
                [5, '5'],
                [6, '6'],
                ['auto', t('Auto')],
              ],
              renderTrigger: true,
              visibility: ({ controls }: any) => {
                const mode = controls?.layout_mode?.value;
                return (
                  mode === 'grid' ||
                  mode === 'micro-card' ||
                  mode === 'compact-kpi'
                );
              },
            },
          },
        ],
        [
          {
            name: 'value_position',
            config: {
              type: 'SelectControl',
              label: t('Value Position'),
              description: t('Where to place the value relative to the label'),
              default: 'below',
              choices: [
                ['above', t('Above Label')],
                ['below', t('Below Label')],
                ['left', t('Left of Label')],
                ['right', t('Right of Label')],
                ['inline', t('Inline with Label')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'density_tier',
            config: {
              type: 'SelectControl',
              label: t('Visual Density'),
              default: 'compact',
              choices: [
                ['micro', t('Micro')],
                ['compact', t('Compact')],
                ['standard', t('Standard')],
                ['comfortable', t('Comfortable')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'alignment',
            config: {
              type: 'SelectControl',
              label: t('Content Alignment'),
              default: 'start',
              choices: [
                ['start', t('Left / Start')],
                ['center', t('Center')],
                ['end', t('Right / End')],
                ['stretch', t('Stretch')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'card_style',
            config: {
              type: 'SelectControl',
              label: t('Card Style'),
              default: 'elevated',
              choices: [
                ['elevated', t('Elevated (Shadow + Border)')],
                ['flat', t('Flat (Border Only)')],
                ['transparent', t('Transparent')],
              ],
              renderTrigger: true,
            },
          },
        ],
      ],
    },

    /* ── Visibility ─────────────────────────────────── */
    {
      label: t('Visibility'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'show_labels',
            config: {
              type: 'CheckboxControl',
              label: t('Show Labels'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_dividers',
            config: {
              type: 'CheckboxControl',
              label: t('Show Dividers'),
              description: t(
                'Show separator lines between items (list/split layouts)',
              ),
              default: false,
              renderTrigger: true,
            },
          },
        ],
      ],
    },

    /* ── Images ─────────────────────────────────────── */
    {
      label: t('Card Images'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'image_placement',
            config: {
              type: 'SelectControl',
              label: t('Image Placement'),
              description: t(
                'Where to place per-variable images relative to card content',
              ),
              default: 'before',
              choices: [
                ['before', t('Before (Left)')],
                ['after', t('After (Right)')],
                ['above', t('Above')],
                ['below', t('Below')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'image_size',
            config: {
              type: 'SliderControl',
              label: t('Image Size'),
              description: t('Image width/height in pixels'),
              default: 32,
              min: 16,
              max: 80,
              step: 4,
              renderTrigger: true,
            },
          },
        ],
      ],
    },

    /* ── Value Coloring ────────────────────────────── */
    {
      label: t('Value Coloring'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'value_color_mode',
            config: {
              type: 'SelectControl',
              label: t('Value Color Mode'),
              description: t('How metric values are colored'),
              default: 'threshold',
              choices: [
                ['threshold', t('By Threshold Ranges')],
                ['metric', t('By Metric (from Color Scheme)')],
                ['fixed', t('Fixed Color')],
                ['scheme', t('Default (Theme Text Color)')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'fixed_value_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Fixed Value Color'),
              default: null,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.value_color_mode?.value === 'fixed',
            },
          },
        ],
      ],
    },

    /* ── Trend & Comparison ────────────────────────── */
    {
      label: t('Trend & Comparison'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'show_trend_indicator',
            config: {
              type: 'CheckboxControl',
              label: t('Show Trend Indicator'),
              description: t(
                'Display change direction and value for each metric',
              ),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'invert_semantic_colors',
            config: {
              type: 'CheckboxControl',
              label: t('Invert Semantic Colors'),
              description: t(
                'Swap green/red meaning (use when "down" is good, e.g. malaria cases)',
              ),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'trend_display',
            config: {
              type: 'SelectControl',
              label: t('Trend Display'),
              default: 'both',
              choices: [
                ['arrow', t('Arrow Only')],
                ['value', t('Value Only')],
                ['both', t('Arrow + Value')],
                ['badge', t('Badge')],
              ],
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_trend_indicator?.value === true,
            },
          },
          {
            name: 'trend_logic',
            config: {
              type: 'SelectControl',
              label: t('Trend Logic'),
              description: t(
                'Determines whether "up" is positive (green) or negative (red)',
              ),
              default: 'higher-is-better',
              choices: [
                ['higher-is-better', t('Higher is Better')],
                ['lower-is-better', t('Lower is Better')],
              ],
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_trend_indicator?.value === true,
            },
          },
        ],
      ],
    },

    /* ── Thresholds / Conditional Coloring ─────────── */
    {
      label: t('Thresholds'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'threshold_upper',
            config: {
              type: 'TextControl',
              label: t('Upper Threshold'),
              description: t(
                'Values >= this are colored green (or red if inverted). Leave blank to disable.',
              ),
              default: '',
              isFloat: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.value_color_mode?.value === 'threshold',
            },
          },
          {
            name: 'threshold_lower',
            config: {
              type: 'TextControl',
              label: t('Lower Threshold'),
              description: t(
                'Values <= this are colored red (or green if inverted). Leave blank to disable.',
              ),
              default: '',
              isFloat: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.value_color_mode?.value === 'threshold',
            },
          },
        ],
      ],
    },

    /* ── Micro Visualizations ──────────────────────── */
    {
      label: t('Micro Visualizations'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'show_micro_viz',
            config: {
              type: 'CheckboxControl',
              label: t('Show Micro Visualizations'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'micro_visual_type',
            config: {
              type: 'SelectControl',
              label: t('Micro Chart Type'),
              default: 'none',
              choices: [
                ['none', t('None')],
                ['sparkline', t('Sparkline')],
                ['mini-bar', t('Mini Bar')],
                ['progress-bar', t('Progress Bar')],
                ['bullet', t('Bullet / Target Indicator')],
              ],
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_micro_viz?.value === true,
            },
          },
          {
            name: 'progress_max',
            config: {
              type: 'TextControl',
              label: t('Progress / Bullet Max Value'),
              description: t(
                'Maximum value for 100%. Leave blank to auto-detect from data.',
              ),
              default: '',
              isFloat: true,
              renderTrigger: true,
              visibility: ({ controls }: any) => {
                const viz = controls?.micro_visual_type?.value;
                return (
                  controls?.show_micro_viz?.value === true &&
                  (viz === 'progress-bar' || viz === 'bullet')
                );
              },
            },
          },
        ],
      ],
    },

    /* ── Global Formatting Defaults ────────────────── */
    {
      label: t('Formatting Defaults'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'global_number_format',
            config: {
              type: 'SelectControl',
              freeform: true,
              label: t('Default Number Format'),
              description: t(
                'Fallback number format when per-variable format is not set',
              ),
              default: 'SMART_NUMBER',
              choices: D3_FORMAT_OPTIONS,
              renderTrigger: true,
            },
          },
          {
            name: 'trend_value_format',
            config: {
              type: 'SelectControl',
              freeform: true,
              label: t('Trend Number Format'),
              default: '+,.1%',
              choices: D3_FORMAT_OPTIONS,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'null_value_text',
            config: {
              type: 'TextControl',
              label: t('Default Null Text'),
              description: t(
                'Fallback text when a metric value is null (overridden by per-variable setting)',
              ),
              default: '–',
              renderTrigger: true,
            },
          },
        ],
        ['currency_format'],
      ],
    },

    /* ── Typography ─────────────────────────────────── */
    {
      label: t('Typography'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'font_family',
            config: {
              type: 'SelectControl',
              label: t('Font Family'),
              default: 'Inter',
              choices: [
                ['Inter', 'Inter'],
                ['Roboto', 'Roboto'],
                [
                  'system-ui, -apple-system, sans-serif',
                  t('System Default'),
                ],
                [
                  "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                  t('Monospace'),
                ],
                ["Georgia, 'Times New Roman', serif", t('Serif')],
                [
                  "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                  t('Segoe UI'),
                ],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'label_font_size',
            config: {
              type: 'TextControl',
              label: t('Label Font Size'),
              description: t(
                'CSS font-size (e.g. 11px, 0.75rem). Blank = density default.',
              ),
              default: '',
              renderTrigger: true,
            },
          },
          {
            name: 'value_font_size',
            config: {
              type: 'TextControl',
              label: t('Value Font Size'),
              description: t(
                'CSS font-size (e.g. 26px, 1.5rem). Blank = density default.',
              ),
              default: '',
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'label_font_weight',
            config: {
              type: 'SelectControl',
              label: t('Label Font Weight'),
              default: '600',
              choices: [
                ['400', t('Normal (400)')],
                ['500', t('Medium (500)')],
                ['600', t('Semi-Bold (600)')],
                ['700', t('Bold (700)')],
                ['800', t('Extra-Bold (800)')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'value_font_weight',
            config: {
              type: 'SelectControl',
              label: t('Value Font Weight'),
              default: '700',
              choices: [
                ['400', t('Normal (400)')],
                ['500', t('Medium (500)')],
                ['600', t('Semi-Bold (600)')],
                ['700', t('Bold (700)')],
                ['800', t('Extra-Bold (800)')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'label_text_transform',
            config: {
              type: 'SelectControl',
              label: t('Label Text Transform'),
              default: 'uppercase',
              choices: [
                ['uppercase', t('UPPERCASE')],
                ['capitalize', t('Capitalize')],
                ['none', t('None')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'label_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Default Label Color'),
              description: t(
                'Global label color. Per-variable label color overrides this.',
              ),
              default: null,
              renderTrigger: true,
            },
          },
        ],
      ],
    },

    /* ── Borders & Appearance ─────────────────────── */
    {
      label: t('Borders & Appearance'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'border_style',
            config: {
              type: 'SelectControl',
              label: t('Border Style'),
              default: 'solid',
              choices: [
                ['solid', t('Solid')],
                ['dashed', t('Dashed')],
                ['dotted', t('Dotted')],
                ['none', t('None')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'border_width',
            config: {
              type: 'SliderControl',
              label: t('Border Width'),
              default: 1,
              min: 0,
              max: 4,
              step: 1,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'border_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Default Border Color'),
              description: t(
                'Global border color. Per-variable border color overrides this.',
              ),
              default: null,
              renderTrigger: true,
            },
          },
          {
            name: 'item_border_radius',
            config: {
              type: 'SliderControl',
              label: t('Border Radius'),
              default: 12,
              min: 0,
              max: 24,
              step: 2,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'item_padding',
            config: {
              type: 'SliderControl',
              label: t('Item Padding'),
              description: t(
                'Override density-based padding. 0 = use density default.',
              ),
              default: 0,
              min: 0,
              max: 40,
              step: 2,
              renderTrigger: true,
            },
          },
          {
            name: 'item_gap',
            config: {
              type: 'SliderControl',
              label: t('Item Gap'),
              description: t(
                'Override density-based gap between items. 0 = use density default.',
              ),
              default: 0,
              min: 0,
              max: 32,
              step: 2,
              renderTrigger: true,
            },
          },
        ],
        ['color_scheme'],
      ],
    },
  ],
  formDataOverrides: formData => ({
    ...formData,
    metrics: getStandardizedControls().popAllMetrics(),
  }),
};

export default config;
