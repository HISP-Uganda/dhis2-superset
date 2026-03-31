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
            name: 'x_axis',
            config: {
              ...sharedControls.groupby,
              label: t('Time Dimension'),
              description: t('Column for X-axis (Day, Week, Month)'),
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
              description: t('The observed count/incidence to monitor'),
              multi: false,
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
        ['timeseries_limit_metric'],
      ],
    },
    {
      label: t('Statistical Method'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'threshold_method',
            config: {
              type: 'SelectControl',
              label: t('Threshold Method'),
              description: t(
                'Statistical method to compute Upper Control Limit (UCL)',
              ),
              default: 'mean_2sd',
              choices: [
                ['mean_2sd', t('Mean + 2 SD')],
                ['mean_3sd', t('Mean + 3 SD')],
                ['q3', t('3rd Quartile (P75)')],
                ['csum', t('C-SUM (Cumulative Sum)')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'baseline_periods',
            config: {
              type: 'SliderControl',
              label: t('Baseline Periods'),
              description: t(
                'Number of historical periods to compute baseline statistics',
              ),
              default: 52,
              min: 4,
              max: 260,
              step: 1,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'csum_weight',
            config: {
              type: 'SliderControl',
              label: t('C-SUM Weight (k)'),
              description: t('Sensitivity factor for C-SUM method'),
              default: 0.5,
              min: 0.1,
              max: 2.0,
              step: 0.1,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.threshold_method?.value === 'csum',
            },
          },
        ],
      ],
    },
    {
      label: t('Time & Smoothing'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'time_grain',
            config: {
              type: 'SelectControl',
              label: t('Time Granularity'),
              default: 'week',
              choices: [
                ['day', t('Day')],
                ['week', t('Week')],
                ['month', t('Month')],
                ['epi-week', t('Epi-Week')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_trend_smoothing',
            config: {
              type: 'CheckboxControl',
              label: t('Show Smoothed Trend'),
              description: t('Overlay smoothed trend line'),
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'smoothing_window',
            config: {
              type: 'SliderControl',
              label: t('Smoothing Window'),
              default: 3,
              min: 2,
              max: 12,
              step: 1,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_trend_smoothing?.value === true,
            },
          },
        ],
        [
          {
            name: 'manual_ucl',
            config: {
              type: 'TextControl',
              label: t('Manual UCL Override'),
              description: t('Override the calculated Upper Control Limit'),
              default: '',
              isFloat: true,
              renderTrigger: true,
            },
          },
          {
            name: 'manual_lcl',
            config: {
              type: 'TextControl',
              label: t('Manual LCL Override'),
              description: t('Override the calculated Lower Control Limit'),
              default: '',
              isFloat: true,
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Display'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'show_mean_line',
            config: {
              type: 'CheckboxControl',
              label: t('Show Mean Line'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_ucl',
            config: {
              type: 'CheckboxControl',
              label: t('Show Upper Control Limit'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_lcl',
            config: {
              type: 'CheckboxControl',
              label: t('Show Lower Control Limit'),
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'show_legend',
            config: {
              type: 'CheckboxControl',
              label: t('Show Legend'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'highlight_breaches',
            config: {
              type: 'CheckboxControl',
              label: t('Highlight Breach Points'),
              description: t('Mark points that exceed the UCL with alert color'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'shade_alert_zone',
            config: {
              type: 'CheckboxControl',
              label: t('Shade Alert Zone'),
              description: t('Fill the area above UCL with a transparent alert color'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_annotations',
            config: {
              type: 'CheckboxControl',
              label: t('Show Annotations'),
              description: t('Show annotation markers on chart'),
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'annotation_text',
            config: {
              type: 'TextControl',
              label: t('Annotation Text'),
              default: '',
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_annotations?.value === true,
            },
          },
        ],
        [
          {
            name: 'null_value_text',
            config: {
              type: 'TextControl',
              label: t('Null Value Text'),
              description: t('Text to display when value is null'),
              default: '–',
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Styling'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'line_width',
            config: {
              type: 'SliderControl',
              label: t('Line Width'),
              default: 2,
              min: 1,
              max: 5,
              step: 0.5,
              renderTrigger: true,
            },
          },
          {
            name: 'point_size',
            config: {
              type: 'SliderControl',
              label: t('Point Size'),
              default: 4,
              min: 0,
              max: 10,
              step: 1,
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
        ],
      ],
    },
  ],
};

export default config;
