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
import {
  t,
  getCategoricalSchemeRegistry,
  getSequentialSchemeRegistry,
  SequentialScheme,
} from '@superset-ui/core';
import {
  ControlPanelConfig,
  D3_FORMAT_OPTIONS,
  sharedControls,
} from '@superset-ui/chart-controls';
import { detectAvailablePresets, resolvePresetColumn } from './dhis2Presets';
import { getDatasourceBoundaryLevels } from '../DHIS2Map/boundaryLevels';

const categoricalSchemeRegistry = getCategoricalSchemeRegistry();
const sequentialSchemeRegistry = getSequentialSchemeRegistry();

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'dhis2_split_preset',
            config: {
              type: 'SelectControl',
              label: t('Split Dimension'),
              description: t(
                'Column that creates panels. Each unique value becomes one panel. ' +
                  'DHIS2 presets auto-detect OU levels and period columns. ' +
                  'Choose "Custom Column" to pick any column manually.',
              ),
              default: 'custom',
              choices: [['custom', t('Custom Column')]],
              mapStateToProps: (state: any) => {
                const columns = state.datasource?.columns || [];
                const presets = detectAvailablePresets(columns);
                const choices: [string, string][] = [
                  ['custom', t('Custom Column')],
                  ...presets.map(
                    p => [p.presetKey, t(p.label)] as [string, string],
                  ),
                ];
                return { choices };
              },
              renderTrigger: false,
            },
          },
        ],
        [
          {
            name: '_resolved_split_col',
            config: {
              type: 'HiddenControl',
              hidden: true,
              mapStateToProps: (state: any) => {
                const preset = state.controls?.dhis2_split_preset?.value;
                const dsColumns = state.datasource?.columns || [];
                const dataColumns = dsColumns.map((c: any) => String(c.column_name || ''));
                const resolved = resolvePresetColumn(preset, dsColumns, dataColumns);
                return { value: resolved || null };
              },
            },
          },
        ],
        [
          {
            name: 'groupby',
            config: {
              ...sharedControls.groupby,
              label: t('Custom Split Column'),
              description: t(
                'Column to split data into panels (e.g. District or Period). ' +
                  'Only used when "Custom Column" is selected above.',
              ),
              multi: false,
              visibility: ({ controls }: any) =>
                !controls?.dhis2_split_preset?.value ||
                controls?.dhis2_split_preset?.value === 'custom',
            },
          },
        ],
        [
          {
            name: 'x_axis',
            config: {
              ...sharedControls.groupby,
              label: t('X-Axis / Category'),
              description: t(
                'Column for the X-axis within each panel (e.g. Period for charts, ' +
                  'Region name for maps).',
              ),
              multi: false,
            },
          },
        ],
        [
          {
            name: 'metrics',
            config: {
              ...sharedControls.metrics,
              label: t('Metrics'),
              description: t(
                'One or more metrics. Multiple metrics show as overlaid series in each panel.',
              ),
              multi: true,
            },
          },
        ],
        [
          {
            name: 'boundary_level',
            config: {
              type: 'SelectControl',
              label: t('DHIS2 Boundary Level'),
              description: t(
                'Organization unit level for the map. Loads boundaries and ' +
                  'disaggregates data by the matching OU column.',
              ),
              default: '2:region',
              choices: [
                ['2:region', t('Level 2 (Region)')],
              ],
              mapStateToProps: (state: any) => {
                const dsColumns = state.datasource?.columns || [];
                const levels = getDatasourceBoundaryLevels(dsColumns);
                if (levels.length > 0) {
                  return {
                    choices: levels.map(l => [
                      `${l.level}:${l.columnName || ''}`,
                      `Level ${l.level} (${l.label})`,
                    ]),
                  };
                }
                return {
                  choices: [
                    ['1:national', t('Level 1 (National)')],
                    ['2:region', t('Level 2 (Region)')],
                    ['3:district_city', t('Level 3 (District)')],
                    ['4:dlg_municipality_city_council', t('Level 4 (County)')],
                    ['5:sub_county_town_council_division', t('Level 5 (Sub-county)')],
                    ['6:health_facility', t('Level 6 (Facility)')],
                  ],
                };
              },
              renderTrigger: false,
              visibility: ({ controls }: any) =>
                controls?.mini_chart_type?.value === 'mini_map',
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
              description: t(
                'Number of columns in the grid. When responsive mode is on, ' +
                  'columns auto-reduce on smaller widths.',
              ),
              default: 4,
              min: 1,
              max: 12,
              step: 1,
              renderTrigger: true,
            },
          },
          {
            name: 'panel_padding',
            config: {
              type: 'SliderControl',
              label: t('Panel Gap'),
              default: 8,
              min: 0,
              max: 24,
              step: 2,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'panel_height',
            config: {
              type: 'SliderControl',
              label: t('Panel Height (px)'),
              description: t(
                'Fixed height for each panel chart area. Set to 0 for auto-sizing.',
              ),
              default: 0,
              min: 0,
              max: 800,
              step: 10,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'responsive_columns',
            config: {
              type: 'CheckboxControl',
              label: t('Responsive Columns'),
              description: t(
                'Auto-reduce columns on smaller screen widths based on minimum panel width.',
              ),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'min_panel_width',
            config: {
              type: 'SliderControl',
              label: t('Min Panel Width (px)'),
              description: t(
                'Minimum width for each panel before reducing column count.',
              ),
              default: 180,
              min: 100,
              max: 400,
              step: 10,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                Boolean(controls?.responsive_columns?.value),
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
                ['pie', t('Pie')],
                ['donut', t('Donut')],
                ['scatter', t('Scatter (needs 2+ metrics)')],
                ['heatmap', t('Heatmap (needs 2+ metrics)')],
                ['big_number', t('Big Number / KPI')],
                ['gauge', t('Gauge')],
                ['mini_map', t('Map (Choropleth)')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
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
              visibility: ({ controls }: any) =>
                ['line', 'area'].includes(controls?.mini_chart_type?.value),
            },
          },
          {
            name: 'sync_y_axis',
            config: {
              type: 'CheckboxControl',
              label: t('Synchronize Y-Axes'),
              description: t(
                'Use the same Y-axis range across all panels for fair comparison.',
              ),
              default: true,
              renderTrigger: true,
              visibility: ({ controls }: any) => {
                const ct = controls?.mini_chart_type?.value;
                return ['line', 'bar', 'area', 'scatter', 'gauge'].includes(ct);
              },
            },
          },
        ],
      ],
    },
    {
      label: t('Color Schemes'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'color_scheme',
            config: {
              type: 'ColorSchemeControl',
              label: t('Color Scheme'),
              description: t(
                'Categorical and sequential palettes merged. ' +
                  'Selecting any scheme auto-applies to all chart types.',
              ),
              default: categoricalSchemeRegistry.getDefaultKey(),
              renderTrigger: true,
              choices: () => {
                const cat: [string, string][] = categoricalSchemeRegistry
                  .keys()
                  .map(key => [key, key]);
                const seq: [string, string][] = (
                  sequentialSchemeRegistry.values() as SequentialScheme[]
                ).map(s => [s.id, s.label || s.id]);
                return [...cat, ...seq];
              },
              schemes: () => {
                const merged: Record<string, any> = {};
                categoricalSchemeRegistry.keys().forEach(key => {
                  merged[key] = categoricalSchemeRegistry.get(key);
                });
                (sequentialSchemeRegistry.values() as SequentialScheme[]).forEach(s => {
                  merged[s.id] = s;
                });
                return merged;
              },
            },
          },
        ],
      ],
    },
    {
      label: t('Tooltip & Legend'),
      tabOverride: 'customize',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'sync_tooltips',
            config: {
              type: 'CheckboxControl',
              label: t('Synchronize Tooltips'),
              description: t(
                'Hovering one panel highlights the same position in all other panels.',
              ),
              default: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                ['line', 'bar', 'area'].includes(
                  controls?.mini_chart_type?.value,
                ),
            },
          },
          {
            name: 'show_legend',
            config: {
              type: 'CheckboxControl',
              label: t('Show Shared Legend'),
              description: t(
                'Show a shared legend below the grid (once) for all panels.',
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
            name: 'reference_line_mode',
            config: {
              type: 'SelectControl',
              label: t('Reference Line'),
              default: 'none',
              choices: [
                ['none', t('None')],
                ['global', t('Global Value')],
                ['per-panel-mean', t('Panel Mean')],
                ['per-panel-target', t('Panel Target Value')],
              ],
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                ['line', 'bar', 'area'].includes(
                  controls?.mini_chart_type?.value,
                ),
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
                ['global', 'per-panel-target'].includes(
                  controls?.reference_line_mode?.value,
                ),
            },
          },
        ],
        [
          {
            name: 'reference_color',
            config: {
              type: 'TextControl',
              label: t('Reference Line Color'),
              default: '#E53935',
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.reference_line_mode?.value !== 'none',
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
              description: t('Show subtitle with latest metric values'),
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
              visibility: ({ controls }: any) =>
                !['pie', 'donut', 'big_number', 'gauge', 'mini_map'].includes(
                  controls?.mini_chart_type?.value,
                ),
            },
          },
          {
            name: 'show_y_axis',
            config: {
              type: 'CheckboxControl',
              label: t('Show Y-Axis Labels'),
              default: false,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                !['pie', 'donut', 'big_number', 'gauge', 'mini_map'].includes(
                  controls?.mini_chart_type?.value,
                ),
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
