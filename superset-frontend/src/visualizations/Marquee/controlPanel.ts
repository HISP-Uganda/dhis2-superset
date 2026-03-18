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
import { ControlPanelConfig } from '@superset-ui/chart-controls';

const controlPanel: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        ['metrics'],
        ['adhoc_filters'],
        [
          {
            name: 'subtitle_column',
            config: {
              type: 'TextControl',
              label: t('Subtitle Column'),
              description: t('Exact column name to show as subtitle under each value'),
              default: '',
              renderTrigger: false,
            },
          },
        ],
        [
          {
            name: 'delta_column',
            config: {
              type: 'TextControl',
              label: t('Delta / Change Column'),
              description: t('Exact column name containing the numeric change/delta value'),
              default: '',
              renderTrigger: false,
            },
          },
        ],
      ],
    },
    {
      label: t('Layout & Placement'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'placement',
            config: {
              type: 'SelectControl',
              label: t('Placement'),
              description: t('Where the marquee is placed on the page'),
              default: 'top',
              choices: [
                ['top', t('Top')],
                ['bottom', t('Bottom')],
                ['left', t('Left')],
                ['right', t('Right')],
                ['custom_section', t('Custom Page Section')],
              ],
            },
          },
        ],
        [
          {
            name: 'orientation',
            config: {
              type: 'SelectControl',
              label: t('Orientation'),
              description: t('Scrolling direction. Auto adapts to placement.'),
              default: 'auto',
              choices: [
                ['auto', t('Auto (follows placement)')],
                ['horizontal', t('Horizontal')],
                ['vertical', t('Vertical')],
              ],
            },
          },
        ],
        [
          {
            name: 'custom_section_id',
            config: {
              type: 'TextControl',
              label: t('Custom Section ID'),
              description: t('Identifier of the target page section/slot when placement is Custom Section'),
              default: '',
              visibility: ({ controls }: any) => controls?.placement?.value === 'custom_section',
            },
          },
        ],
        [
          {
            name: 'container_height',
            config: {
              type: 'SliderControl',
              label: t('Container Height (px)'),
              description: t('Height of the marquee container in pixels'),
              default: 72,
              min: 40,
              max: 200,
              step: 4,
            },
          },
        ],
        [
          {
            name: 'item_spacing',
            config: {
              type: 'SliderControl',
              label: t('Item Spacing (px)'),
              default: 12,
              min: 0,
              max: 48,
              step: 2,
            },
          },
          {
            name: 'item_padding',
            config: {
              type: 'SliderControl',
              label: t('Item Padding (px)'),
              default: 16,
              min: 4,
              max: 48,
              step: 2,
            },
          },
        ],
        [
          {
            name: 'item_min_width',
            config: {
              type: 'SliderControl',
              label: t('Item Min Width (px)'),
              default: 140,
              min: 80,
              max: 400,
              step: 10,
            },
          },
          {
            name: 'item_max_width',
            config: {
              type: 'SliderControl',
              label: t('Item Max Width (px)'),
              default: 260,
              min: 100,
              max: 600,
              step: 10,
            },
          },
        ],
        [
          {
            name: 'gap_between_items',
            config: {
              type: 'SliderControl',
              label: t('Gap Between Items (px)'),
              default: 32,
              min: 0,
              max: 120,
              step: 4,
            },
          },
        ],
      ],
    },
    {
      label: t('Animation'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'speed',
            config: {
              type: 'SliderControl',
              label: t('Scroll Speed'),
              description: t('Pixels per second. Higher = faster.'),
              default: 30,
              min: 5,
              max: 200,
              step: 5,
            },
          },
        ],
        [
          {
            name: 'pause_on_hover',
            config: {
              type: 'CheckboxControl',
              label: t('Pause on Hover'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'auto_loop',
            config: {
              type: 'CheckboxControl',
              label: t('Auto Loop'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'scroll_direction',
            config: {
              type: 'SelectControl',
              label: t('Scroll Direction'),
              default: 'forward',
              choices: [
                ['forward', t('Forward (left-to-right / top-to-bottom)')],
                ['reverse', t('Reverse (right-to-left / bottom-to-top)')],
              ],
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Value Formatting'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'number_format',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Number Format'),
              description: t('D3 number format string, e.g. ".2f" for 2 decimal places'),
              default: 'SMART_NUMBER',
              choices: [
                ['SMART_NUMBER', t('Smart')],
                [',d', t('Comma integer')],
                ['.2f', t('2 decimal places')],
                ['.1%', t('Percentage 1dp')],
                ['.0%', t('Percentage 0dp')],
                ['$,.2f', t('USD currency')],
                [',.0d', t('Thousands separator')],
              ],
            },
          },
        ],
        [
          {
            name: 'prefix',
            config: {
              type: 'TextControl',
              label: t('Prefix'),
              description: t('Text to display before each value'),
              default: '',
              renderTrigger: true,
            },
          },
          {
            name: 'suffix',
            config: {
              type: 'TextControl',
              label: t('Suffix'),
              description: t('Text to display after each value'),
              default: '',
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'null_text',
            config: {
              type: 'TextControl',
              label: t('Null / Empty Value Text'),
              default: 'N/A',
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Typography'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'label_font_size',
            config: {
              type: 'SliderControl',
              label: t('Label Font Size'),
              default: 11,
              min: 8,
              max: 24,
              step: 1,
              renderTrigger: true,
            },
          },
          {
            name: 'label_font_weight',
            config: {
              type: 'SelectControl',
              label: t('Label Font Weight'),
              default: '500',
              choices: [
                ['400', t('Regular')],
                ['500', t('Medium')],
                ['600', t('Semi-Bold')],
                ['700', t('Bold')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'label_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Label Color'),
              default: { r: 107, g: 114, b: 128, a: 1 },
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'value_font_size',
            config: {
              type: 'SliderControl',
              label: t('Value Font Size'),
              default: 22,
              min: 10,
              max: 64,
              step: 1,
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
                ['400', t('Regular')],
                ['500', t('Medium')],
                ['600', t('Semi-Bold')],
                ['700', t('Bold')],
                ['800', t('Extra Bold')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'value_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Value Color'),
              default: { r: 17, g: 24, b: 39, a: 1 },
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'subtitle_font_size',
            config: {
              type: 'SliderControl',
              label: t('Subtitle Font Size'),
              default: 11,
              min: 8,
              max: 20,
              step: 1,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'subtitle_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Subtitle Color'),
              default: { r: 156, g: 163, b: 175, a: 1 },
              renderTrigger: true,
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
            name: 'container_background',
            config: {
              type: 'ColorPickerControl',
              label: t('Container Background'),
              default: { r: 255, g: 255, b: 255, a: 0 },
              renderTrigger: true,
            },
          },
          {
            name: 'item_background',
            config: {
              type: 'ColorPickerControl',
              label: t('Item Background'),
              default: { r: 255, g: 255, b: 255, a: 1 },
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'item_border_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Item Border Color'),
              default: { r: 229, g: 231, b: 235, a: 1 },
              renderTrigger: true,
            },
          },
          {
            name: 'item_border_width',
            config: {
              type: 'SliderControl',
              label: t('Item Border Width (px)'),
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
            name: 'item_border_radius',
            config: {
              type: 'SliderControl',
              label: t('Item Border Radius (px)'),
              default: 8,
              min: 0,
              max: 24,
              step: 2,
              renderTrigger: true,
            },
          },
          {
            name: 'show_shadow',
            config: {
              type: 'CheckboxControl',
              label: t('Show Shadow'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'delta_positive_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Delta Positive Color'),
              default: { r: 16, g: 185, b: 129, a: 1 },
              renderTrigger: true,
            },
          },
          {
            name: 'delta_negative_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Delta Negative Color'),
              default: { r: 239, g: 68, b: 68, a: 1 },
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'divider_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Divider Color'),
              default: { r: 229, g: 231, b: 235, a: 1 },
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Visibility'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'show_label',
            config: {
              type: 'CheckboxControl',
              label: t('Show Label / Title'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_subtitle',
            config: {
              type: 'CheckboxControl',
              label: t('Show Subtitle'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_delta',
            config: {
              type: 'CheckboxControl',
              label: t('Show Delta / Change'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_separators',
            config: {
              type: 'CheckboxControl',
              label: t('Show Item Separators'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'responsive_wrap',
            config: {
              type: 'CheckboxControl',
              label: t('Responsive Wrap on Small Screens'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
      ],
    },
  ],
};

export default controlPanel;
