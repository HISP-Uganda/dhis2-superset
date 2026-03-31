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
            name: 'entity_column',
            config: {
              ...sharedControls.groupby,
              label: t('Entity (District / Facility)'),
              description: t('Dimension column for entities to compare'),
              multi: false,
            },
          },
        ],
        [
          {
            name: 'actual_metric',
            config: {
              ...sharedControls.metric,
              label: t('Actual Metric'),
              description: t('The observed/actual performance value'),
            },
          },
        ],
        [
          {
            name: 'target_metric',
            config: {
              ...sharedControls.metric,
              label: t('Target Metric'),
              description: t('The target/goal to compare against'),
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Sorting & Display'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'chart_type',
            config: {
              type: 'SelectControl',
              label: t('Chart Type'),
              description: t('Visual style for the variance chart'),
              default: 'bar',
              choices: [
                ['bar', t('Bar')],
                ['dot', t('Dot')],
                ['lollipop', t('Lollipop')],
                ['diverging', t('Diverging')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'comparison_basis',
            config: {
              type: 'SelectControl',
              label: t('Comparison Basis'),
              default: 'target',
              choices: [
                ['target', t('Target')],
                ['prior-period', t('Prior Period')],
                ['benchmark', t('Benchmark')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'variance_mode',
            config: {
              type: 'SelectControl',
              label: t('Variance Mode'),
              description: t('How variance is calculated'),
              default: 'absolute',
              choices: [
                ['absolute', t('Absolute')],
                ['relative', t('Relative (Percentage)')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'sort_order',
            config: {
              type: 'SelectControl',
              label: t('Sort Order'),
              default: 'worst-first',
              choices: [
                ['worst-first', t('Worst Variance First')],
                ['best-first', t('Best Variance First')],
                ['alphabetical', t('Alphabetical')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'max_entities',
            config: {
              type: 'SliderControl',
              label: t('Max Entities to Show'),
              default: 20,
              min: 5,
              max: 100,
              step: 5,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_values',
            config: {
              type: 'CheckboxControl',
              label: t('Show Variance Values'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_entity_labels',
            config: {
              type: 'CheckboxControl',
              label: t('Show Entity Labels'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_centerline',
            config: {
              type: 'CheckboxControl',
              label: t('Show Center Line'),
              description: t('Show zero/target center line'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_legend',
            config: {
              type: 'CheckboxControl',
              label: t('Show Legend'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Benchmark Band'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'show_benchmark_band',
            config: {
              type: 'CheckboxControl',
              label: t('Show Benchmark Band'),
              description: t('Show an acceptable range band'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'benchmark_lower',
            config: {
              type: 'TextControl',
              isFloat: true,
              label: t('Benchmark Lower Bound'),
              default: '',
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                Boolean(controls?.show_benchmark_band?.value),
            },
          },
          {
            name: 'benchmark_upper',
            config: {
              type: 'TextControl',
              isFloat: true,
              label: t('Benchmark Upper Bound'),
              default: '',
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                Boolean(controls?.show_benchmark_band?.value),
            },
          },
        ],
      ],
    },
    {
      label: t('Grouping'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'entity_grouping',
            config: {
              ...sharedControls.groupby,
              label: t('Entity Grouping'),
              description: t('Optional column to group entities'),
              multi: false,
            },
          },
        ],
      ],
    },
    {
      label: t('Variance Thresholds'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'variance_thresholds',
            config: {
              type: 'TextControl',
              label: t('Color Bands'),
              description: t(
                'Semicolon-separated abs-variance:color. E.g. "5:#2E7D32;15:#F9A825;100:#D32F2F" ' +
                  '(On Track < 5%, Lagging 5-15%, Critical > 15%)',
              ),
              default: '5:#2E7D32;15:#F9A825;100:#D32F2F',
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
            name: 'bar_height',
            config: {
              type: 'SliderControl',
              label: t('Bar Height'),
              default: 20,
              min: 10,
              max: 40,
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
              default: '+,.1%',
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
