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
            name: 'age_column',
            config: {
              ...sharedControls.groupby,
              label: t('Age Group Column'),
              description: t('Column with age groups (Y-axis)'),
              multi: false,
            },
          },
        ],
        [
          {
            name: 'sex_column',
            config: {
              ...sharedControls.groupby,
              label: t('Sex / Gender Column'),
              description: t('Column to split Male vs Female'),
              multi: false,
            },
          },
        ],
        [
          {
            name: 'metric',
            config: {
              ...sharedControls.metric,
              label: t('Metric (Count / Rate)'),
            },
          },
        ],
        [
          {
            name: 'baseline_metric',
            config: {
              ...sharedControls.metric,
              label: t('Baseline Metric (optional)'),
              description: t(
                'Population baseline or reference to overlay as a line',
              ),
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Data Mapping'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'male_value',
            config: {
              type: 'TextControl',
              label: t('Male Value'),
              description: t(
                'Value in sex column that represents Male (e.g. "Male", "M")',
              ),
              default: 'Male',
              renderTrigger: true,
            },
          },
          {
            name: 'female_value',
            config: {
              type: 'TextControl',
              label: t('Female Value'),
              description: t(
                'Value in sex column that represents Female (e.g. "Female", "F")',
              ),
              default: 'Female',
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
            name: 'display_mode',
            config: {
              type: 'SelectControl',
              label: t('Display Mode'),
              description: t('How values are displayed'),
              default: 'absolute',
              choices: [
                ['absolute', t('Absolute')],
                ['percent', t('Percent of Total')],
                ['rate', t('Rate')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'scale_mode',
            config: {
              type: 'SelectControl',
              label: t('Scale Mode'),
              description: t('Whether male/female share the same axis scale'),
              default: 'common',
              choices: [
                ['common', t('Common Scale')],
                ['independent', t('Independent Scale')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_baseline_overlay',
            config: {
              type: 'CheckboxControl',
              label: t('Show Baseline Overlay'),
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'show_values',
            config: {
              type: 'CheckboxControl',
              label: t('Show Values on Bars'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_center_labels',
            config: {
              type: 'CheckboxControl',
              label: t('Show Center Age Labels'),
              description: t('Show age group labels on the center axis'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
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
              default: 'top',
              choices: [
                ['top', t('Top')],
                ['bottom', t('Bottom')],
                ['right', t('Right')],
              ],
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                Boolean(controls?.show_legend?.value),
            },
          },
        ],
        [
          {
            name: 'title',
            config: {
              type: 'TextControl',
              label: t('Chart Title'),
              default: '',
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'bar_gap',
            config: {
              type: 'SliderControl',
              label: t('Bar Gap (%)'),
              default: 20,
              min: 0,
              max: 50,
              step: 5,
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
        ],
      ],
    },
    {
      label: t('Labels & Colors'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'male_label',
            config: {
              type: 'TextControl',
              label: t('Male Label'),
              description: t('Override the male group label'),
              default: 'Male',
              renderTrigger: true,
            },
          },
          {
            name: 'female_label',
            config: {
              type: 'TextControl',
              label: t('Female Label'),
              description: t('Override the female group label'),
              default: 'Female',
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'male_color',
            config: {
              type: 'TextControl',
              label: t('Male Color'),
              description: t('Hex color for male bars'),
              default: '#1976D2',
              renderTrigger: true,
            },
          },
          {
            name: 'female_color',
            config: {
              type: 'TextControl',
              label: t('Female Color'),
              description: t('Hex color for female bars'),
              default: '#E91E63',
              renderTrigger: true,
            },
          },
        ],
        [
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
