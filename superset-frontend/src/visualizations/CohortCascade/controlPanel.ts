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
  getStandardizedControls,
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
            name: 'metrics',
            config: {
              ...sharedControls.metrics,
              label: t('Cascade Stages (in order)'),
              description: t(
                'Each metric represents a stage in the cascade. ' +
                  'Order matters: Suspected → Tested → Confirmed → Treated',
              ),
              multi: true,
            },
          },
        ],
        [
          {
            name: 'groupby',
            config: {
              ...sharedControls.groupby,
              label: t('Split Dimension'),
              description: t('Optional dimension for side-by-side cascades'),
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
                ['vertical', t('Vertical (top to bottom)')],
                ['horizontal', t('Horizontal (left to right)')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'bar_gap',
            config: {
              type: 'SliderControl',
              label: t('Stage Gap'),
              default: 24,
              min: 8,
              max: 48,
              step: 4,
              renderTrigger: true,
            },
          },
          {
            name: 'bar_border_radius',
            config: {
              type: 'SliderControl',
              label: t('Bar Radius'),
              default: 6,
              min: 0,
              max: 16,
              step: 2,
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
            name: 'show_values',
            config: {
              type: 'CheckboxControl',
              label: t('Show Values'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_connectors',
            config: {
              type: 'CheckboxControl',
              label: t('Show Connectors'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_percent_retained',
            config: {
              type: 'CheckboxControl',
              label: t('Show % Retained'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_percent_lost',
            config: {
              type: 'CheckboxControl',
              label: t('Show % Lost'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_dropoff_emphasis',
            config: {
              type: 'CheckboxControl',
              label: t('Emphasize Drop-off'),
              description: t('Visually emphasize the loss between stages'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_stage_annotations',
            config: {
              type: 'CheckboxControl',
              label: t('Show Stage Annotations'),
              description: t('Show annotation text per stage'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'percent_mode',
            config: {
              type: 'SelectControl',
              label: t('Percentage Mode'),
              description: t('How percentages are calculated'),
              default: 'cumulative',
              choices: [
                ['cumulative', t('Cumulative (vs first stage)')],
                ['stage-specific', t('Stage-specific (vs previous)')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'reference_stage',
            config: {
              type: 'SelectControl',
              label: t('Reference Stage'),
              description: t('Which stage to calculate % against'),
              default: 'first',
              choices: [
                ['first', t('First Stage')],
                ['previous', t('Previous Stage')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'label_placement',
            config: {
              type: 'SelectControl',
              label: t('Label Placement'),
              default: 'outside',
              choices: [
                ['inside', t('Inside')],
                ['outside', t('Outside')],
                ['below', t('Below')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'connector_style',
            config: {
              type: 'SelectControl',
              label: t('Connector Style'),
              default: 'arrow',
              choices: [
                ['arrow', t('Arrow')],
                ['line', t('Line')],
                ['none', t('None')],
              ],
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
              default: 'standard',
              choices: [
                ['compact', t('Compact')],
                ['standard', t('Standard')],
                ['presentation', t('Presentation')],
              ],
              renderTrigger: true,
            },
          },
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
      label: t('Typography'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'label_font_size',
            config: {
              type: 'SliderControl',
              label: t('Label Font Size'),
              default: 12,
              min: 9,
              max: 18,
              step: 1,
              renderTrigger: true,
            },
          },
          {
            name: 'value_font_size',
            config: {
              type: 'SliderControl',
              label: t('Value Font Size'),
              default: 18,
              min: 12,
              max: 36,
              step: 1,
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Formatting'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'value_format',
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
  ],
  formDataOverrides: formData => ({
    ...formData,
    metrics: getStandardizedControls().popAllMetrics(),
  }),
};

export default config;
