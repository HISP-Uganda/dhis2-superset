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
            name: 'metric',
            config: {
              ...sharedControls.metric,
              label: t('Current Metric'),
              description: t('The primary KPI value to display'),
            },
          },
        ],
        [
          {
            name: 'comparison_metric',
            config: {
              ...sharedControls.metric,
              label: t('Comparison Metric'),
              description: t('Target, previous period, or benchmark metric'),
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Comparison Settings'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'comparison_type',
            config: {
              type: 'SelectControl',
              label: t('Comparison Type'),
              default: 'target',
              choices: [
                ['target', t('Target')],
                ['previous', t('Previous Period')],
                ['benchmark', t('Benchmark')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'trend_logic',
            config: {
              type: 'SelectControl',
              label: t('Trend Logic'),
              description: t(
                'Higher Malaria cases = Red. Higher vaccination = Green.',
              ),
              default: 'higher-is-better',
              choices: [
                ['higher-is-better', t('Higher is Better (e.g. Coverage)')],
                ['lower-is-better', t('Lower is Better (e.g. Cases)')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_absolute_delta',
            config: {
              type: 'CheckboxControl',
              label: t('Show Absolute Delta'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_percentage_delta',
            config: {
              type: 'CheckboxControl',
              label: t('Show Percentage Change'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_comparison_value',
            config: {
              type: 'CheckboxControl',
              label: t('Show Comparison Value'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_sparkline',
            config: {
              type: 'CheckboxControl',
              label: t('Show Sparkline'),
              description: t('Show mini trend line'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'color_mode',
            config: {
              type: 'SelectControl',
              label: t('Color Mode'),
              default: 'semantic',
              choices: [
                ['semantic', t('Semantic')],
                ['fixed', t('Fixed')],
                ['theme', t('Theme')],
              ],
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Gauge'),
      tabOverride: 'customize',
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'show_gauge',
            config: {
              type: 'CheckboxControl',
              label: t('Show Progress Gauge'),
              description: t('Show a circular gauge based on current / max'),
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'gauge_max',
            config: {
              type: 'TextControl',
              label: t('Gauge Max Value'),
              description: t('If blank, uses comparison metric as 100%'),
              default: '',
              isFloat: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_gauge?.value === true,
            },
          },
        ],
        [
          {
            name: 'show_threshold_band',
            config: {
              type: 'CheckboxControl',
              label: t('Show Threshold Band'),
              description: t('Show threshold zone on gauge'),
              default: false,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_gauge?.value === true,
            },
          },
        ],
        [
          {
            name: 'threshold_warning',
            config: {
              type: 'TextControl',
              label: t('Warning Threshold'),
              default: '',
              isFloat: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_gauge?.value === true &&
                controls?.show_threshold_band?.value === true,
            },
          },
          {
            name: 'threshold_critical',
            config: {
              type: 'TextControl',
              label: t('Critical Threshold'),
              default: '',
              isFloat: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_gauge?.value === true &&
                controls?.show_threshold_band?.value === true,
            },
          },
        ],
      ],
    },
    {
      label: t('Labels'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'title',
            config: {
              type: 'TextControl',
              label: t('Card Title'),
              default: '',
              renderTrigger: true,
            },
          },
          {
            name: 'subtitle',
            config: {
              type: 'TextControl',
              label: t('Subtitle'),
              default: '',
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'primary_label',
            config: {
              type: 'TextControl',
              label: t('Current Value Label'),
              description: t('Override label for current metric'),
              default: '',
              renderTrigger: true,
            },
          },
          {
            name: 'comparison_label',
            config: {
              type: 'TextControl',
              label: t('Comparison Label'),
              default: '',
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Layout & Sizing'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'layout_variant',
            config: {
              type: 'SelectControl',
              label: t('Layout'),
              default: 'standard',
              choices: [
                ['standard', t('Standard')],
                ['compact', t('Compact')],
                ['wide', t('Wide')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'density_tier',
            config: {
              type: 'SelectControl',
              label: t('Density Tier'),
              default: 'standard',
              choices: [
                ['micro', t('Micro')],
                ['compact', t('Compact')],
                ['standard', t('Standard')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'title_font_size',
            config: {
              type: 'SliderControl',
              label: t('Title Font Size'),
              default: 13,
              min: 10,
              max: 24,
              step: 1,
              renderTrigger: true,
            },
          },
          {
            name: 'value_font_size',
            config: {
              type: 'SliderControl',
              label: t('Value Font Size'),
              default: 36,
              min: 16,
              max: 72,
              step: 2,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'delta_font_size',
            config: {
              type: 'SliderControl',
              label: t('Delta Font Size'),
              default: 14,
              min: 10,
              max: 28,
              step: 1,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'card_padding',
            config: {
              type: 'SliderControl',
              label: t('Card Padding'),
              default: 24,
              min: 8,
              max: 48,
              step: 4,
              renderTrigger: true,
            },
          },
          {
            name: 'border_radius',
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
      ],
    },
    {
      label: t('Formatting'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'primary_value_format',
            config: {
              type: 'SelectControl',
              freeform: true,
              label: t('Primary Number Format'),
              default: 'SMART_NUMBER',
              choices: D3_FORMAT_OPTIONS,
              renderTrigger: true,
            },
          },
          {
            name: 'comparison_value_format',
            config: {
              type: 'SelectControl',
              freeform: true,
              label: t('Comparison Number Format'),
              default: 'SMART_NUMBER',
              choices: D3_FORMAT_OPTIONS,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'delta_format',
            config: {
              type: 'SelectControl',
              freeform: true,
              label: t('Delta Number Format'),
              default: 'SMART_NUMBER',
              choices: D3_FORMAT_OPTIONS,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'value_prefix',
            config: {
              type: 'TextControl',
              label: t('Value Prefix'),
              default: '',
              renderTrigger: true,
            },
          },
          {
            name: 'value_suffix',
            config: {
              type: 'TextControl',
              label: t('Value Suffix'),
              default: '',
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
              description: t('Text to display when value is null'),
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
