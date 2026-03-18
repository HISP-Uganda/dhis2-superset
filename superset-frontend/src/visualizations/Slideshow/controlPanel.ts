/*
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
import { ControlPanelConfig, getStandardizedControls } from '@superset-ui/chart-controls';

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [['metrics'], ['adhoc_filters']],
    },
    {
      label: t('Playback'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'auto_play',
            config: {
              type: 'CheckboxControl',
              label: t('Auto Play'),
              renderTrigger: true,
              default: true,
              description: t('Automatically advance slides'),
            },
          },
        ],
        [
          {
            name: 'slide_interval_ms',
            config: {
              type: 'SliderControl',
              label: t('Slide Duration (ms)'),
              renderTrigger: true,
              min: 1000,
              max: 30000,
              step: 500,
              default: 5000,
              description: t('How long each slide is shown (milliseconds)'),
            },
          },
        ],
        [
          {
            name: 'pause_on_hover',
            config: {
              type: 'CheckboxControl',
              label: t('Pause on Hover'),
              renderTrigger: true,
              default: true,
            },
          },
          {
            name: 'pause_on_focus',
            config: {
              type: 'CheckboxControl',
              label: t('Pause on Focus'),
              renderTrigger: true,
              default: false,
              description: t('Pause auto-play when the slideshow receives keyboard focus'),
            },
          },
        ],
        [
          {
            name: 'loop',
            config: {
              type: 'CheckboxControl',
              label: t('Loop'),
              renderTrigger: true,
              default: true,
            },
          },
        ],
        [
          {
            name: 'start_index',
            config: {
              type: 'SliderControl',
              label: t('Start Slide Index'),
              renderTrigger: true,
              min: 0,
              max: 20,
              step: 1,
              default: 0,
            },
          },
        ],
      ],
    },
    {
      label: t('Transition'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'transition_type',
            config: {
              type: 'SelectControl',
              label: t('Transition Effect'),
              renderTrigger: true,
              clearable: false,
              default: 'fade',
              choices: [
                ['fade', t('Fade')],
                ['slide-horizontal', t('Slide Horizontal')],
                ['slide-vertical', t('Slide Vertical')],
                ['none', t('None')],
              ],
            },
          },
        ],
        [
          {
            name: 'transition_duration_ms',
            config: {
              type: 'SliderControl',
              label: t('Transition Duration (ms)'),
              renderTrigger: true,
              min: 0,
              max: 2000,
              step: 50,
              default: 600,
            },
          },
        ],
      ],
    },
    {
      label: t('Navigation'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'show_arrows',
            config: {
              type: 'CheckboxControl',
              label: t('Show Arrows'),
              renderTrigger: true,
              default: true,
            },
          },
          {
            name: 'show_dots',
            config: {
              type: 'CheckboxControl',
              label: t('Show Dots'),
              renderTrigger: true,
              default: true,
            },
          },
        ],
        [
          {
            name: 'show_counter',
            config: {
              type: 'CheckboxControl',
              label: t('Show Counter'),
              renderTrigger: true,
              default: false,
            },
          },
          {
            name: 'show_progress_bar',
            config: {
              type: 'CheckboxControl',
              label: t('Show Progress Bar'),
              renderTrigger: true,
              default: true,
            },
          },
        ],
        [
          {
            name: 'keyboard_navigation',
            config: {
              type: 'CheckboxControl',
              label: t('Keyboard Navigation'),
              renderTrigger: true,
              default: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Layout'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'height_mode',
            config: {
              type: 'SelectControl',
              label: t('Height Mode'),
              renderTrigger: true,
              clearable: false,
              default: 'fixed',
              choices: [
                ['fixed', t('Fixed')],
                ['adaptive', t('Adaptive')],
              ],
            },
          },
        ],
        [
          {
            name: 'fixed_height',
            config: {
              type: 'SliderControl',
              label: t('Fixed Height (px)'),
              renderTrigger: true,
              min: 120,
              max: 800,
              step: 8,
              default: 320,
              visibility: ({ controls }) =>
                controls?.height_mode?.value === 'fixed',
              resetOnHide: false,
            },
          },
        ],
        [
          {
            name: 'content_padding',
            config: {
              type: 'SliderControl',
              label: t('Content Padding (px)'),
              renderTrigger: true,
              min: 0,
              max: 80,
              step: 4,
              default: 32,
            },
          },
        ],
      ],
    },
    {
      label: t('Value Formatting'),
      expanded: false,
      controlSetRows: [
        ['y_axis_format'],
        [
          {
            name: 'prefix',
            config: {
              type: 'TextControl',
              label: t('Prefix'),
              renderTrigger: true,
              default: '',
            },
          },
          {
            name: 'suffix',
            config: {
              type: 'TextControl',
              label: t('Suffix'),
              renderTrigger: true,
              default: '',
            },
          },
        ],
        [
          {
            name: 'null_text',
            config: {
              type: 'TextControl',
              label: t('Null Display'),
              renderTrigger: true,
              default: '—',
            },
          },
        ],
      ],
    },
    {
      label: t('Appearance'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'show_border',
            config: {
              type: 'CheckboxControl',
              label: t('Show Border'),
              renderTrigger: true,
              default: false,
            },
          },
          {
            name: 'show_shadow',
            config: {
              type: 'CheckboxControl',
              label: t('Show Shadow'),
              renderTrigger: true,
              default: true,
            },
          },
        ],
        [
          {
            name: 'border_radius',
            config: {
              type: 'SliderControl',
              label: t('Border Radius'),
              renderTrigger: true,
              min: 0,
              max: 32,
              step: 2,
              default: 12,
            },
          },
        ],
        [
          {
            name: 'bg_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Background Color'),
              renderTrigger: true,
              default: null,
            },
          },
        ],
        [
          {
            name: 'value_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Value Color'),
              renderTrigger: true,
              default: null,
            },
          },
          {
            name: 'label_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Label Color'),
              renderTrigger: true,
              default: null,
            },
          },
        ],
        [
          {
            name: 'dot_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Dot Color'),
              renderTrigger: true,
              default: null,
            },
          },
          {
            name: 'arrow_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Arrow Color'),
              renderTrigger: true,
              default: null,
            },
          },
        ],
        [
          {
            name: 'progress_bar_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Progress Bar Color'),
              renderTrigger: true,
              default: null,
            },
          },
        ],
      ],
    },
    {
      label: t('Embedded Charts (Advanced)'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'embedded_chart_ids',
            config: {
              type: 'TextControl',
              label: t('Chart IDs'),
              renderTrigger: false,
              default: '',
              description: t(
                'Comma-separated saved chart IDs to embed as slides. ' +
                'If provided, these charts are shown instead of metric slides. ' +
                'Example: 42, 77, 103',
              ),
            },
          },
        ],
      ],
    },
  ],
  controlOverrides: {
    y_axis_format: {
      label: t('Number format'),
    },
  },
  formDataOverrides: formData => ({
    ...formData,
    metrics: getStandardizedControls().popAllMetrics(),
  }),
};

export default config;
