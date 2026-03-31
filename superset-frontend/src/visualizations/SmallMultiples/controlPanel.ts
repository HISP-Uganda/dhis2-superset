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

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'groupby',
            config: {
              ...sharedControls.groupby,
              label: t('Split Dimension'),
              description: t(
                'Column to split data into panels (e.g. District)',
              ),
              multi: false,
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
              label: t('Metric'),
              multi: false,
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
              label: t('Grid Columns'),
              default: 4,
              min: 2,
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
              ],
              renderTrigger: true,
            },
          },
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
            },
          },
        ],
        [
          {
            name: 'sync_y_axis',
            config: {
              type: 'CheckboxControl',
              label: t('Synchronize Y-Axes'),
              description: t(
                'Use the same Y-axis range across all panels for fair comparison',
              ),
              default: true,
              renderTrigger: true,
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
            name: 'show_reference_line',
            config: {
              type: 'CheckboxControl',
              label: t('Show Reference Line'),
              description: t('Show a threshold / reference line on each panel'),
              default: false,
              renderTrigger: true,
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
                Boolean(controls?.show_reference_line?.value),
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
              description: t('Show subtitle with latest value'),
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
            },
          },
          {
            name: 'show_y_axis',
            config: {
              type: 'CheckboxControl',
              label: t('Show Y-Axis Labels'),
              default: false,
              renderTrigger: true,
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
              label: t('Y-Axis Format'),
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
