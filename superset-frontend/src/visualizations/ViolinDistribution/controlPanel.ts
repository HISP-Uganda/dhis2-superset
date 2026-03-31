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
            name: 'group_column',
            config: {
              ...sharedControls.groupby,
              label: t('Group Column'),
              description: t('Categorical column to split violins (e.g. Region)'),
              multi: false,
            },
          },
        ],
        [
          {
            name: 'value_column',
            config: {
              ...sharedControls.groupby,
              label: t('Value Column'),
              description: t(
                'Continuous variable to plot (e.g. Days to Report)',
              ),
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
            name: 'orientation',
            config: {
              type: 'SelectControl',
              label: t('Orientation'),
              default: 'vertical',
              choices: [
                ['vertical', t('Vertical')],
                ['horizontal', t('Horizontal')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'scale_mode',
            config: {
              type: 'SelectControl',
              label: t('Scale Mode'),
              description: t('Normalization mode for violin density'),
              default: 'area',
              choices: [
                ['area', t('Area')],
                ['count', t('Count')],
                ['width', t('Width')],
              ],
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Violin Settings'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'bandwidth',
            config: {
              type: 'SliderControl',
              label: t('Bandwidth'),
              description: t('Kernel density estimation bandwidth'),
              default: 1.0,
              min: 0.1,
              max: 5.0,
              step: 0.1,
              renderTrigger: true,
            },
          },
          {
            name: 'density_resolution',
            config: {
              type: 'SliderControl',
              label: t('Resolution'),
              description: t('Number of points for density estimation'),
              default: 50,
              min: 20,
              max: 200,
              step: 10,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'violin_width',
            config: {
              type: 'SliderControl',
              label: t('Violin Width'),
              default: 60,
              min: 20,
              max: 120,
              step: 5,
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
            name: 'show_median',
            config: {
              type: 'CheckboxControl',
              label: t('Show Median'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_iqr',
            config: {
              type: 'CheckboxControl',
              label: t('Show IQR Box'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_box_overlay',
            config: {
              type: 'CheckboxControl',
              label: t('Show Box Plot Overlay'),
              description: t('Show full box plot overlay on the violin'),
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'color_by_group',
            config: {
              type: 'CheckboxControl',
              label: t('Color by Group'),
              description: t('Color each violin by its group'),
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
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'show_mean',
            config: {
              type: 'CheckboxControl',
              label: t('Show Mean'),
              description: t('Show mean marker in addition to median'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_quartile_labels',
            config: {
              type: 'CheckboxControl',
              label: t('Show Quartile Labels'),
              description: t('Show Q1/Q3 values'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_jitter',
            config: {
              type: 'CheckboxControl',
              label: t('Show Data Points (Jitter)'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'jitter_opacity',
            config: {
              type: 'SliderControl',
              label: t('Jitter Opacity'),
              default: 0.3,
              min: 0.05,
              max: 1.0,
              step: 0.05,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_jitter?.value === true,
            },
          },
          {
            name: 'jitter_size',
            config: {
              type: 'SliderControl',
              label: t('Jitter Point Size'),
              default: 3,
              min: 1,
              max: 8,
              step: 0.5,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_jitter?.value === true,
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
