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
  sharedControls,
} from '@superset-ui/chart-controls';
import { detectAvailablePresets } from './dhis2Presets';

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'dhis2_split_preset',
            config: {
              type: 'SelectControl',
              label: t('Compare By (DHIS2)'),
              description: t(
                'Auto-detected comparison dimensions from the DHIS2 dataset. ' +
                  'Select one to split data into panels by OU level or period. ' +
                  'Choose "Custom Column" to pick any column manually.',
              ),
              default: 'custom',
              choices: [['custom', t('Custom Column')]],
              mapStateToProps: (state: any) => {
                const columns = state.datasource?.columns || [];
                const presets = detectAvailablePresets(columns);
                const choices: [string, string][] = [
                  ['custom', t('Custom Column')],
                  ...presets.map(
                    p => [p.presetKey, t(p.label)] as [string, string],
                  ),
                ];
                return { choices };
              },
              renderTrigger: false,
            },
          },
        ],
        [
          {
            name: 'groupby',
            config: {
              ...sharedControls.groupby,
              label: t('Split Dimension'),
              description: t(
                'Column to split data into panels (e.g. District). ' +
                  'Ignored when a DHIS2 preset is selected above.',
              ),
              multi: false,
              visibility: ({ controls }: any) =>
                !controls?.dhis2_split_preset?.value ||
                controls?.dhis2_split_preset?.value === 'custom',
            },
          },
        ],
        [
          {
            name: 'x_axis',
            config: {
              ...sharedControls.groupby,
              label: t('X-Axis (Time / Category)'),
              description: t('Column for the X-axis within each panel'),
              multi: false,
            },
          },
        ],
        [
          {
            name: 'metrics',
            config: {
              ...sharedControls.metrics,
              label: t('Metrics'),
              description: t(
                'One or more metrics. Multiple metrics show as overlaid series in each panel.',
              ),
              multi: true,
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Layout'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'grid_columns',
            config: {
              type: 'SliderControl',
              label: t('Max Grid Columns'),
              description: t(
                'Maximum columns in the grid. When responsive mode is on, ' +
                  'columns auto-reduce on smaller widths.',
              ),
              default: 4,
              min: 1,
              max: 8,
              step: 1,
              renderTrigger: true,
            },
          },
          {
            name: 'panel_padding',
            config: {
              type: 'SliderControl',
              label: t('Panel Padding'),
              default: 8,
              min: 0,
              max: 24,
              step: 2,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'responsive_columns',
            config: {
              type: 'CheckboxControl',
              label: t('Responsive Columns'),
              description: t(
                'Auto-reduce columns on smaller screen widths based on minimum panel width.',
              ),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'min_panel_width',
            config: {
              type: 'SliderControl',
              label: t('Min Panel Width (px)'),
              description: t(
                'Minimum width for each panel before reducing column count.',
              ),
              default: 180,
              min: 100,
              max: 400,
              step: 10,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                Boolean(controls?.responsive_columns?.value),
            },
          },
        ],
      ],
    },
    {
      label: t('Chart Style'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'mini_chart_type',
            config: {
              type: 'SelectControl',
              label: t('Chart Type'),
              default: 'line',
              choices: [
                ['line', t('Line')],
                ['bar', t('Bar')],
                ['area', t('Area')],
                ['pie', t('Pie')],
                ['donut', t('Donut')],
                ['scatter', t('Scatter (needs 2+ metrics)')],
                ['heatmap', t('Heatmap (needs 2+ metrics)')],
                ['big_number', t('Big Number / KPI')],
                ['gauge', t('Gauge')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'color_scheme',
            config: {
              type: 'ColorSchemeControl',
              label: t('Color Scheme'),
              default: 'supersetColors',
              renderTrigger: true,
              schemes: () => {
                try {
                  // eslint-disable-next-line global-require
                  const { getCategoricalSchemeRegistry } = require('@superset-ui/core');
                  return getCategoricalSchemeRegistry().getMap();
                } catch {
                  return {};
                }
              },
              isLinear: false,
            },
          },
        ],
        [
          {
            name: 'line_width',
            config: {
              type: 'SliderControl',
              label: t('Line Width'),
              default: 1.5,
              min: 0.5,
              max: 4,
              step: 0.5,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                ['line', 'area'].includes(controls?.mini_chart_type?.value),
            },
          },
          {
            name: 'sync_y_axis',
            config: {
              type: 'CheckboxControl',
              label: t('Synchronize Y-Axes'),
              description: t(
                'Use the same Y-axis range across all panels for fair comparison.',
              ),
              default: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                ['line', 'bar', 'area', 'scatter', 'gauge'].includes(
                  controls?.mini_chart_type?.value,
                ),
            },
          },
        ],
      ],
    },
    {
      label: t('Tooltip & Legend'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'sync_tooltips',
            config: {
              type: 'CheckboxControl',
              label: t('Synchronize Tooltips'),
              description: t(
                'Hovering one panel highlights the same position in all other panels.',
              ),
              default: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                ['line', 'bar', 'area'].includes(
                  controls?.mini_chart_type?.value,
                ),
            },
          },
          {
            name: 'show_legend',
            config: {
              type: 'CheckboxControl',
              label: t('Show Shared Legend'),
              description: t(
                'Show a shared legend above or below the grid when using multiple metrics.',
              ),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'legend_position',
            config: {
              type: 'SelectControl',
              label: t('Legend Position'),
              default: 'top',
              choices: [
                ['top', t('Top')],
                ['bottom', t('Bottom')],
              ],
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                Boolean(controls?.show_legend?.value),
            },
          },
        ],
      ],
    },
    {
      label: t('Sorting & Filtering'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'sort_panels',
            config: {
              type: 'SelectControl',
              label: t('Sort Panels'),
              default: 'alphabetical',
              choices: [
                ['alphabetical', t('Alphabetical')],
                ['latest-value', t('Latest Value')],
                ['highest-first', t('Highest First')],
                ['lowest-first', t('Lowest First')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'top_n',
            config: {
              type: 'SliderControl',
              label: t('Top N Panels (0 = all)'),
              default: 0,
              min: 0,
              max: 50,
              step: 1,
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Reference Line'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'reference_line_mode',
            config: {
              type: 'SelectControl',
              label: t('Reference Line'),
              default: 'none',
              choices: [
                ['none', t('None')],
                ['global', t('Global Value')],
                ['per-panel-mean', t('Panel Mean')],
                ['per-panel-target', t('Panel Target Value')],
              ],
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                ['line', 'bar', 'area'].includes(
                  controls?.mini_chart_type?.value,
                ),
            },
          },
          {
            name: 'reference_value',
            config: {
              type: 'TextControl',
              isFloat: true,
              label: t('Reference Value'),
              default: '',
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                ['global', 'per-panel-target'].includes(
                  controls?.reference_line_mode?.value,
                ),
            },
          },
        ],
        [
          {
            name: 'reference_color',
            config: {
              type: 'TextControl',
              label: t('Reference Line Color'),
              default: '#E53935',
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.reference_line_mode?.value !== 'none',
            },
          },
        ],
      ],
    },
    {
      label: t('Display'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'show_panel_title',
            config: {
              type: 'CheckboxControl',
              label: t('Show Panel Titles'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_panel_subtitle',
            config: {
              type: 'CheckboxControl',
              label: t('Show Panel Subtitle'),
              description: t('Show subtitle with latest metric values'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_x_axis',
            config: {
              type: 'CheckboxControl',
              label: t('Show X-Axis Labels'),
              default: false,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                !['pie', 'donut', 'big_number', 'gauge'].includes(
                  controls?.mini_chart_type?.value,
                ),
            },
          },
          {
            name: 'show_y_axis',
            config: {
              type: 'CheckboxControl',
              label: t('Show Y-Axis Labels'),
              default: false,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                !['pie', 'donut', 'big_number', 'gauge'].includes(
                  controls?.mini_chart_type?.value,
                ),
            },
          },
        ],
        [
          {
            name: 'density_tier',
            config: {
              type: 'SelectControl',
              label: t('Density Tier'),
              default: 'compact',
              choices: [
                ['micro', t('Micro')],
                ['compact', t('Compact')],
                ['standard', t('Standard')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'panel_border_radius',
            config: {
              type: 'SliderControl',
              label: t('Panel Border Radius'),
              default: 8,
              min: 0,
              max: 16,
              step: 2,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'y_axis_format',
            config: {
              type: 'SelectControl',
              freeform: true,
              label: t('Value Format'),
              default: 'SMART_NUMBER',
              choices: D3_FORMAT_OPTIONS,
              renderTrigger: true,
            },
          },
          {
            name: 'null_value_text',
            config: {
              type: 'TextControl',
              label: t('Null Value Text'),
              description: t('Text to display for null or missing values'),
              default: '–',
              renderTrigger: true,
            },
          },
        ],
      ],
    },
  ],
};

export default config;
