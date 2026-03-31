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
            name: 'commodity_column',
            config: {
              ...sharedControls.groupby,
              label: t('Commodity Name'),
              description: t('Column containing commodity/product names'),
              multi: false,
            },
          },
        ],
        [
          {
            name: 'soh_metric',
            config: {
              ...sharedControls.metric,
              label: t('Stock on Hand (SOH)'),
            },
          },
        ],
        [
          {
            name: 'amc_metric',
            config: {
              ...sharedControls.metric,
              label: t('Average Monthly Consumption (AMC)'),
            },
          },
        ],
        [
          {
            name: 'groupby',
            config: {
              ...sharedControls.groupby,
              label: t('Group By'),
              description: t('Group by district or facility'),
              multi: false,
              optional: true,
            },
          },
        ],
        [
          {
            name: 'incoming_metric',
            config: {
              ...sharedControls.metric,
              label: t('Incoming / Resupply Quantity'),
              description: t('Metric for incoming or resupply quantity'),
              optional: true,
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Stock Thresholds'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'understock_threshold',
            config: {
              type: 'SliderControl',
              label: t('Understock Threshold (months)'),
              description: t('Below this MOS = Understock (Red)'),
              default: 2,
              min: 0.5,
              max: 6,
              step: 0.5,
              renderTrigger: true,
            },
          },
          {
            name: 'overstock_threshold',
            config: {
              type: 'SliderControl',
              label: t('Overstock Threshold (months)'),
              description: t('Above this MOS = Overstock (Amber)'),
              default: 6,
              min: 3,
              max: 18,
              step: 1,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'max_mos_display',
            config: {
              type: 'SliderControl',
              label: t('Max MOS Bar Scale'),
              description: t('Maximum months to display in the bar'),
              default: 12,
              min: 6,
              max: 24,
              step: 1,
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
              description: t('What to show in the table'),
              default: 'mixed',
              choices: [
                ['quantity', t('Quantity')],
                ['mos', t('Months of Stock')],
                ['status', t('Status Only')],
                ['mixed', t('Mixed')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'density_tier',
            config: {
              type: 'SelectControl',
              label: t('Density'),
              default: 'compact',
              choices: [
                ['compact', t('Compact')],
                ['standard', t('Standard')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'sort_by',
            config: {
              type: 'SelectControl',
              label: t('Sort By'),
              default: 'mos-asc',
              choices: [
                ['mos-asc', t('MOS Ascending (worst first)')],
                ['mos-desc', t('MOS Descending')],
                ['name', t('Alphabetical')],
              ],
              renderTrigger: true,
            },
          },
          {
            name: 'row_height',
            config: {
              type: 'SliderControl',
              label: t('Row Height'),
              default: 32,
              min: 24,
              max: 48,
              step: 4,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_soh_column',
            config: {
              type: 'CheckboxControl',
              label: t('Show SOH Column'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_amc_column',
            config: {
              type: 'CheckboxControl',
              label: t('Show AMC Column'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_mos_bar',
            config: {
              type: 'CheckboxControl',
              label: t('Show MOS Bar'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_risk_badges',
            config: {
              type: 'CheckboxControl',
              label: t('Show Risk Badges'),
              description: t('Show stock status badges (Stockout/Low/OK/Over)'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_mos_value',
            config: {
              type: 'CheckboxControl',
              label: t('Show MOS Value'),
              description: t('Show MOS numeric value'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'show_incoming',
            config: {
              type: 'CheckboxControl',
              label: t('Show Incoming Column'),
              default: false,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                Boolean(controls?.incoming_metric?.value),
            },
          },
        ],
        [
          {
            name: 'show_status_header',
            config: {
              type: 'CheckboxControl',
              label: t('Show Column Headers'),
              description: t('Show status column headers'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'value_format',
            config: {
              type: 'SelectControl',
              freeform: true,
              label: t('Number Format'),
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
