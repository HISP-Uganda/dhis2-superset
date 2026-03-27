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

import {
  t,
  getCategoricalSchemeRegistry,
  getSequentialSchemeRegistry,
  SequentialScheme,
} from '@superset-ui/core';
import {
  ControlPanelConfig,
  sharedControls,
} from '@superset-ui/chart-controls';
import { getDatasourceBoundaryLevels } from './boundaryLevels';

type DatasourceColumn = {
  column_name?: string;
  verbose_name?: string;
  extra?: unknown;
};

type StagedLegendSet = {
  id?: string;
  displayName?: string;
  name?: string;
  legendDefinition?: {
    items?: Array<unknown>;
    setName?: string;
  };
};

type CachedLegendSetEnvelope = {
  data: StagedLegendSet[];
  timestamp: number;
  status?: string;
};

function parseColumnExtra(extra: unknown): Record<string, any> | undefined {
  if (!extra) {
    return undefined;
  }
  if (typeof extra === 'string') {
    try {
      return JSON.parse(extra);
    } catch {
      return undefined;
    }
  }
  if (typeof extra === 'object') {
    return extra as Record<string, any>;
  }
  return undefined;
}

function getLegendSetsCacheKey(databaseId?: number | string): string | null {
  const dbId = databaseId ? Number(databaseId) : undefined;
  if (!dbId || !Number.isFinite(dbId) || dbId <= 0) {
    return null;
  }
  return `dhis2_legend_sets_db${dbId}`;
}

export function readCachedLegendSetEnvelope(
  databaseId?: number | string,
): CachedLegendSetEnvelope | null {

  if (typeof window === 'undefined') {
    return null;
  }
  const cacheKey = getLegendSetsCacheKey(databaseId);
  if (!cacheKey) {
    return null;
  }

  try {
    const cached = window.localStorage.getItem(cacheKey);
    if (!cached) {
      return null;
    }
    const parsed = JSON.parse(cached) as CachedLegendSetEnvelope;
    if (!Array.isArray(parsed?.data)) {
      return null;
    }
    return {
      data: parsed.data.filter(
        (item: unknown): item is StagedLegendSet =>
          Boolean(item) && typeof item === 'object',
      ),
      timestamp: Number(parsed.timestamp || 0),
      status: String(parsed.status || '').trim() || undefined,
    };
  } catch {
    return null;
  }
}

function readCachedLegendSets(databaseId?: number | string): StagedLegendSet[] {
  return readCachedLegendSetEnvelope(databaseId)?.data || [];
}

function shouldFetchLegendSets(databaseId?: number | string): boolean {
  const envelope = readCachedLegendSetEnvelope(databaseId);
  if (!envelope) {
    return true;
  }

  if (envelope.status === 'pending' || envelope.status === 'failed') {
    return Date.now() - envelope.timestamp > 30000;
  }

  return false;
}

function getDhis2SourceDatabaseId(datasource: any): number | undefined {
  const extra = parseColumnExtra(datasource?.extra);
  const sourceDatabaseId = Number(
    extra?.dhis2_source_database_id ??
      extra?.source_database_id ??
      extra?.dhis2SourceDatabaseId ??
      datasource?.database?.id ??
      datasource?.database_id ??
      NaN,
  );
  if (Number.isFinite(sourceDatabaseId) && sourceDatabaseId > 0) {
    return sourceDatabaseId;
  }
  return undefined;
}

function getLegendSetSelectionValue(legendSet: StagedLegendSet): string | null {
  const legendSetId = String(legendSet.id || '').trim();
  const legendSetName = String(
    legendSet.displayName || legendSet.name || '',
  ).trim();
  const identity = legendSetId || legendSetName;
  return identity ? `legendset:${identity}` : null;
}

function getStagedLegendChoices(
  columns: DatasourceColumn[] = [],
  legendSets: StagedLegendSet[] = [],
) {
  const seenValues = new Set<string>();
  const choices: Array<[string, string]> = [['__metric__', t('Selected metric legend')]];

  const pushChoice = (value: string | null | undefined, label: string) => {
    if (!value || !label || seenValues.has(value)) {
      return;
    }
    seenValues.add(value);
    choices.push([value, label]);
  };

  columns.forEach(column => {
    const columnName = String(column.column_name || '').trim();
    if (!columnName) {
      return;
    }
    const extra = parseColumnExtra(column.extra);
    const legendDefinition = extra?.dhis2_legend ?? extra?.dhis2Legend;
    if (!Array.isArray(legendDefinition?.items) || !legendDefinition.items.length) {
      return;
    }

    const legendLabel = String(
      legendDefinition?.setName || column.verbose_name || columnName,
    ).trim();
    const columnLabel = String(column.verbose_name || columnName).trim();
    pushChoice(columnName, `${legendLabel} (${columnLabel})`);
  });

  legendSets.forEach(legendSet => {
    const legendDefinition = legendSet.legendDefinition;
    if (!Array.isArray(legendDefinition?.items) || !legendDefinition.items.length) {
      return;
    }
    const selectionValue = getLegendSetSelectionValue(legendSet);
    const legendLabel = String(
      legendDefinition?.setName ||
        legendSet.displayName ||
        legendSet.name ||
        legendSet.id ||
        '',
    ).trim();
    pushChoice(
      selectionValue,
      `${legendLabel} (${t('DHIS2 legend set')})`,
    );
  });

  return choices;
}

const categoricalSchemeRegistry = getCategoricalSchemeRegistry();
const sequentialSchemeRegistry = getSequentialSchemeRegistry();

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Map Configuration'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'dhis2_staged_local_dataset',
            config: {
              type: 'HiddenControl',
              hidden: true,
              mapStateToProps: (state: any) => ({
                value: String(
                  parseColumnExtra(state.datasource?.extra)?.dhis2_staged_local ===
                    true,
                ),
              }),
            },
          },
          {
            // Persist the DHIS2 source database ID into formData so that
            // transformProps can read it in the dashboard context where
            // datasource.extra fields may be absent.
            name: 'dhis2_source_database_id',
            config: {
              type: 'HiddenControl',
              hidden: true,
              mapStateToProps: (state: any) => ({
                value: getDhis2SourceDatabaseId(state.datasource),
              }),
            },
          },
          {
            // Persist the DHIS2 source instance IDs into formData for
            // the same reason — dashboard datasource may lack extra fields.
            name: 'dhis2_source_instance_ids',
            config: {
              type: 'HiddenControl',
              hidden: true,
              mapStateToProps: (state: any) => {
                const extra = parseColumnExtra(state.datasource?.extra);
                const ids = Array.isArray(extra?.dhis2_source_instance_ids)
                  ? extra.dhis2_source_instance_ids
                  : Array.isArray(extra?.dhis2SourceInstanceIds)
                    ? extra.dhis2SourceInstanceIds
                    : [];
                return { value: ids };
              },
            },
          },
          {
            name: 'dhis2_hierarchy_columns',
            config: {
              type: 'HiddenControl',
              hidden: true,
              mapStateToProps: (state: any) => ({
                value: getDatasourceBoundaryLevels(state.datasource?.columns)
                  .map(level => level.columnName)
                  .filter(Boolean),
              }),
            },
          },
        ],
        [
          {
            name: 'org_unit_column',
            config: {
              type: 'SelectControl',
              label: t('Organisation Unit Column'),
              description: t('Column containing org unit identifiers (shows only columns with OU tags)'),
              mapStateToProps: (state: any) => ({
                choices:
                  state.datasource?.columns
                    ?.filter((col: any) => {
                      const extra = parseColumnExtra(col.extra);
                      return extra?.dhis2_is_ou_hierarchy === true || extra?.dhis2IsOuHierarchy === true;
                    })
                    .map((col: any) => [
                      col.column_name,
                      col.verbose_name || col.column_name,
                    ]) || [],
              }),
              validators: [],
            },
          },
        ],
        [
          {
            name: 'metric',
            config: {
              ...sharedControls.metric,
              label: t('Metric to Display'),
              description: t('The metric to visualize on the map'),
            },
          },
        ],
        [
          {
            name: 'aggregation_method',
            config: {
              type: 'SelectControl',
              label: t('Aggregation Method'),
              description: t(
                'How to aggregate values when multiple rows exist per org unit (e.g., multiple periods)',
              ),
              default: 'sum',
              choices: [
                ['none', t('None (as is)')],
                ['sum', t('Sum')],
                ['average', t('Average')],
                ['max', t('Maximum')],
                ['min', t('Minimum')],
                ['count', t('Count')],
                ['latest', t('Latest Value')],
              ],
            },
          },
        ],
        [
          {
            // Hierarchy-aware null filtering: exclude rows where the selected
            // OrgUnit hierarchy column is empty/null. Enabled by default.
            // When ON: only rows where the selected OU column has a value are
            //   included — prevents higher-level rows from mixing into the map.
            // When OFF: all rows are included (may cause double-counting when
            //   the serving table has data at multiple hierarchy levels).
            name: 'filter_null_ou_column',
            config: {
              type: 'CheckboxControl',
              label: t('Exclude rows where selected OrgUnit column is empty'),
              default: true,
              description: t(
                'Filter out rows where the selected OrgUnit hierarchy column has no value. ' +
                'This prevents higher-level aggregation rows from appearing at the wrong map grain.',
              ),
            },
          },
        ],
        [
          {
            name: 'granularity_sqla',
            config: {
              ...sharedControls.granularity_sqla,
              label: t('Time Period Column'),
              description: t(
                'Select time period column for filtering (optional)',
              ),
            },
          },
        ],
        [
          {
            name: 'boundary_levels',
            config: {
              type: 'SelectControl',
              label: t('Boundary Levels'),
              description: t(
                'Select one or more organisation unit levels to display. Each level will have a distinct border color.',
              ),
              default: [2],
              multi: true,
              renderTrigger: true,
              freeForm: false,
              mapStateToProps: (state: any) => {
                // Get original DHIS2 database ID from datasource
                const databaseId = getDhis2SourceDatabaseId(state.datasource);
                const datasourceLevels = getDatasourceBoundaryLevels(
                  state.datasource?.columns,
                );

                // Check if we have cached org unit levels in localStorage
                const cacheKey = `dhis2_org_unit_levels_db${databaseId}`;
                let cachedLevels: any[] = [];

                try {
                  const cached = localStorage.getItem(cacheKey);
                  if (cached) {
                    const { data, timestamp } = JSON.parse(cached);
                    // Cache valid for 1 hour
                    if (Date.now() - timestamp < 3600000) {
                      cachedLevels = data;
                    }
                  }
                } catch (e) {
                  // Ignore cache errors
                }

                if (datasourceLevels.length > 0) {
                  return {
                    choices: datasourceLevels.map(level => [
                      level.level,
                      `Level ${level.level} (${level.label})`,
                    ]),
                  };
                }

                // If we have cached levels, use them
                if (cachedLevels.length > 0) {
                  return {
                    choices: cachedLevels.map((level: any) => [
                      level.level,
                      `Level ${level.level} (${level.displayName || level.name})`,
                    ]),
                  };
                }

                // If database ID is available, trigger async fetch
                if (databaseId && typeof window !== 'undefined') {
                  // Fetch org unit levels asynchronously and cache them
                  // This runs in the background; next render will pick up cached data
                  import('@superset-ui/core').then(({ SupersetClient }) => {
                    SupersetClient.get({
                      endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=organisationUnitLevels&staged=true`,
                    })
                      .then(response => {
                        if (response.json?.result) {
                          const levels = response.json.result.sort(
                            (a: any, b: any) => a.level - b.level,
                          );
                          // Cache the results
                          localStorage.setItem(
                            cacheKey,
                            JSON.stringify({
                              data: levels,
                              timestamp: Date.now(),
                            }),
                          );
                          // Trigger re-render by dispatching an action if available
                          // The next interaction will pick up the cached levels
                        }
                      })
                      .catch(() => {
                        // Silently fail - fallback choices will be used
                      });
                  });
                }

                // Fallback to default choices while loading or if no database
                return {
                  choices: [
                    [1, t('Level 1')],
                    [2, t('Level 2')],
                    [3, t('Level 3')],
                    [4, t('Level 4')],
                    [5, t('Level 5')],
                    [6, t('Level 6')],
                  ],
                };
              },
            },
          },
        ],
        [
          {
            name: 'boundary_load_method',
            config: {
              type: 'SelectControl',
              label: t('Boundary Load Method'),
              description: t(
                'Method to load geographic boundaries from DHIS2. ' +
                  'GeoJSON: Uses the organisationUnits.geojson endpoint (recommended for multiple levels). ' +
                  'geoFeatures: Uses the analytics geoFeatures API.',
              ),
              default: 'geoJSON',
              choices: [
                ['geoJSON', t('GeoJSON (recommended)')],
                ['geoFeatures', t('geoFeatures')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'level_1_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Level 1 Border Color'),
              description: t('Border color for level 1 boundaries'),
              default: { r: 0, g: 0, b: 0, a: 1 },
              renderTrigger: true,
              visibility: ({ form_data }: any) => {
                const levels = form_data?.boundary_levels;
                if (Array.isArray(levels)) {
                  return levels.includes(1);
                }
                return false;
              },
            },
          },
          {
            name: 'level_2_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Level 2 Border Color'),
              description: t('Border color for level 2 boundaries'),
              default: { r: 220, g: 53, b: 69, a: 1 },
              renderTrigger: true,
              visibility: ({ form_data }: any) => {
                const levels = form_data?.boundary_levels;
                if (Array.isArray(levels)) {
                  return levels.includes(2);
                }
                return false;
              },
            },
          },
        ],
        [
          {
            name: 'level_3_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Level 3 Border Color'),
              description: t('Border color for level 3 boundaries'),
              default: { r: 40, g: 167, b: 69, a: 1 },
              renderTrigger: true,
              visibility: ({ form_data }: any) => {
                const levels = form_data?.boundary_levels;
                if (Array.isArray(levels)) {
                  return levels.includes(3);
                }
                return false;
              },
            },
          },
          {
            name: 'level_4_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Level 4 Border Color'),
              description: t('Border color for level 4 boundaries'),
              default: { r: 0, g: 123, b: 255, a: 1 },
              renderTrigger: true,
              visibility: ({ form_data }: any) => {
                const levels = form_data?.boundary_levels;
                if (Array.isArray(levels)) {
                  return levels.includes(4);
                }
                return false;
              },
            },
          },
        ],
        [
          {
            name: 'level_5_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Level 5 Border Color'),
              description: t(
                'Border color for level 5 boundaries',
              ),
              default: { r: 255, g: 193, b: 7, a: 1 },
              renderTrigger: true,
              visibility: ({ form_data }: any) => {
                const levels = form_data?.boundary_levels;
                if (Array.isArray(levels)) {
                  return levels.includes(5);
                }
                return false;
              },
            },
          },
          {
            name: 'level_6_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Level 6 Border Color'),
              description: t('Border color for Level 6 boundaries'),
              default: { r: 111, g: 66, b: 193, a: 1 },
              renderTrigger: true,
              visibility: ({ form_data }: any) => {
                const levels = form_data?.boundary_levels;
                if (Array.isArray(levels)) {
                  return levels.includes(6);
                }
                return false;
              },
            },
          },
        ],
        [
          {
            name: 'enable_drill',
            config: {
              type: 'CheckboxControl',
              label: t('Enable Drill Down/Up'),
              description: t(
                'Allow clicking on regions to drill down to child org units',
              ),
              default: true,
            },
          },
          {
            name: 'focus_selected_boundary_with_children',
            config: {
              type: 'CheckboxControl',
              label: t('Focus selected boundaries and show one level down'),
              description: t(
                'When the current map selection is only a subset of the level, zoom to those selected boundaries and render the next child level inside them.',
              ),
              default: false,
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Color schemes'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'use_linear_color_scheme',
            config: {
              type: 'CheckboxControl',
              label: t('Use sequential palette'),
              description: t(
                'When checked, the map uses a sequential palette. When unchecked, it uses a categorical palette.',
              ),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'linear_color_scheme',
            config: {
              type: 'ColorSchemeControl',
              label: t('Sequential color scheme'),
              description: t(
                'Gradient color scheme for choropleth maps. Select from available sequential palettes.',
              ),
              default: sequentialSchemeRegistry.getDefaultKey(),
              choices: () =>
                (sequentialSchemeRegistry.values() as SequentialScheme[]).map(
                  value => [value.id, value.label],
                ),
              schemes: () => sequentialSchemeRegistry.getMap(),
              isLinear: true,
              clearable: false,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.use_linear_color_scheme?.value !== false,
            },
          },
        ],
        [
          {
            name: 'color_scheme',
            config: {
              type: 'ColorSchemeControl',
              label: t('Categorical color scheme'),
              default: categoricalSchemeRegistry.getDefaultKey(),
              renderTrigger: true,
              choices: () =>
                categoricalSchemeRegistry.keys().map(key => [key, key]),
              description: t('The categorical palette for rendering chart'),
              schemes: () => categoricalSchemeRegistry.getMap(),
              visibility: ({ controls }: any) =>
                controls?.use_linear_color_scheme?.value === false,
            },
          },
        ],
        [
          {
            name: 'legend_type',
            config: {
              type: 'SelectControl',
              label: t('Data range colors'),
              description: t(
                'Auto uses staged DHIS2 legend ranges when available, otherwise it calculates ranges from data. Manual allows custom break points and colors.',
              ),
              default: 'auto',
              choices: [
                ['auto', t('Auto (from data)')],
                ['staged', t('DHIS2 Staged Legend')],
                ['equal_interval', t('Equal Interval')],
                ['quantile', t('Quantile')],
                ['manual', t('Manual Breaks')],
              ],
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'staged_legend_column',
            config: {
              type: 'SelectControl',
              label: t('DHIS2 staged legend'),
              description: t(
                'Choose which staged DHIS2 legend set to apply. "Selected metric legend" keeps the legend attached to the current metric column.',
              ),
              default: '__metric__',
              clearable: false,
              renderTrigger: true,
              mapStateToProps: (state: any) => {
                const datasourceColumns = Array.isArray(state.datasource?.columns)
                  ? state.datasource.columns
                  : [];
                const databaseId = getDhis2SourceDatabaseId(state.datasource);
                const cachedLegendSets = readCachedLegendSets(databaseId);
                const cacheKey = getLegendSetsCacheKey(databaseId);

                if (
                  databaseId &&
                  cacheKey &&
                  typeof window !== 'undefined' &&
                  shouldFetchLegendSets(databaseId)
                ) {
                  setTimeout(() => {
                    import('src/utils/dhis2LegendColorSchemes').then(
                      ({ syncDHIS2LegendSchemesForDatabase }) => {
                        syncDHIS2LegendSchemesForDatabase(databaseId).catch(
                          () => {
                            // Fallback to column-attached legends until staged legend sets arrive.
                          },
                        );
                      },
                    );
                  }, 0);
                }

                return {
                  choices: getStagedLegendChoices(
                    datasourceColumns,
                    cachedLegendSets,
                  ),
                };
              },
              visibility: ({ controls }: any) =>
                controls?.legend_type?.value === 'staged',
            },
          },
        ],
        [
          {
            name: 'legend_classes',
            config: {
              type: 'SliderControl',
              label: t('Number of classes'),
              description: t(
                'Number of color classes/intervals in the legend (affects color distribution)',
              ),
              default: 5,
              min: 2,
              max: 9,
              step: 1,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.legend_type?.value !== 'staged' &&
                controls?.legend_type?.value !== 'manual',
            },
          },
        ],
        [
          {
            name: 'manual_breaks',
            config: {
              type: 'TextControl',
              label: t('Manual break points'),
              description: t(
                'Comma-separated break values for manual legend. E.g., "0,100,500,1000,5000" creates 4 intervals.',
              ),
              default: '',
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.legend_type?.value === 'manual',
            },
          },
        ],
        [
          {
            name: 'manual_colors',
            config: {
              type: 'TextControl',
              label: t('Manual colors'),
              description: t(
                'Comma-separated hex colors for each interval. E.g., "#ffffcc,#a1dab4,#41b6c4,#225ea8". Must match number of intervals.',
              ),
              default: '',
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.legend_type?.value === 'manual',
            },
          },
        ],
        [
          {
            name: 'legend_reverse_colors',
            config: {
              type: 'CheckboxControl',
              label: t('Reverse color scheme'),
              description: t('Reverse the order of colors in the legend'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'legend_no_data_color',
            config: {
              type: 'ColorPickerControl',
              label: t('No data color'),
              description: t('Color for areas with no data'),
              default: { r: 204, g: 204, b: 204, a: 1 },
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Map Style'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'opacity',
            config: {
              type: 'SliderControl',
              label: t('Fill Opacity'),
              description: t(
                'Transparency of filled regions (0 = transparent, 1 = solid)',
              ),
              default: 0.7,
              min: 0,
              max: 1,
              step: 0.1,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'chart_background_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Background color'),
              description: t('Background behind the map viewport'),
              default: { r: 255, g: 255, b: 255, a: 1 },
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'stroke_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Border Color'),
              description: t('Default border color for boundaries'),
              default: { r: 255, g: 255, b: 255, a: 1 },
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'auto_theme_borders',
            config: {
              type: 'CheckboxControl',
              label: t('Auto Theme Borders'),
              description: t(
                'Automatically derive border colors from the color scheme (darker shade of fill color)',
              ),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'stroke_width',
            config: {
              type: 'SliderControl',
              label: t('Border Width'),
              description: t('Width of boundary borders in pixels'),
              default: 1,
              min: 0,
              max: 5,
              step: 0.5,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'show_all_boundaries',
            config: {
              type: 'CheckboxControl',
              label: t('Show All Boundaries'),
              description: t(
                'Display all boundary outlines, including areas without data. When unchecked, only boundaries that match your data will be shown (recommended for multi-country DHIS2 instances).',
              ),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'style_unselected_areas',
            config: {
              type: 'CheckboxControl',
              label: t('Style unselected areas'),
              description: t(
                'When showing the full map with only a subset selected, apply a separate border and fill style to the unselected areas.',
              ),
              default: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_all_boundaries?.value === true,
            },
          },
        ],
        [
          {
            name: 'unselected_area_fill_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Unselected Area Fill'),
              description: t('Fill color for boundaries outside the selected area'),
              default: { r: 241, g: 245, b: 249, a: 1 },
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_all_boundaries?.value === true &&
                controls?.style_unselected_areas?.value !== false,
            },
          },
          {
            name: 'unselected_area_fill_opacity',
            config: {
              type: 'SliderControl',
              label: t('Unselected Fill Opacity'),
              description: t('Opacity for boundaries outside the selected area'),
              default: 0.45,
              min: 0,
              max: 1,
              step: 0.05,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_all_boundaries?.value === true &&
                controls?.style_unselected_areas?.value !== false,
            },
          },
        ],
        [
          {
            name: 'unselected_area_border_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Unselected Area Border'),
              description: t('Border color for boundaries outside the selected area'),
              default: { r: 148, g: 163, b: 184, a: 1 },
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_all_boundaries?.value === true &&
                controls?.style_unselected_areas?.value !== false,
            },
          },
          {
            name: 'unselected_area_border_width',
            config: {
              type: 'SliderControl',
              label: t('Unselected Border Width'),
              description: t('Border width for boundaries outside the selected area'),
              default: 0.75,
              min: 0,
              max: 4,
              step: 0.25,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                controls?.show_all_boundaries?.value === true &&
                controls?.style_unselected_areas?.value !== false,
            },
          },
        ],
      ],
    },
    {
      label: t('Labels'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'show_labels',
            config: {
              type: 'CheckboxControl',
              label: t('Show Labels'),
              description: t('Display org unit names on the map'),
              default: true,
            },
          },
        ],
        [
          {
            name: 'label_type',
            config: {
              type: 'SelectControl',
              label: t('Label Content'),
              default: 'name',
              choices: [
                ['name', t('Name Only')],
                ['value', t('Value Only')],
                ['name_value', t('Name and Value')],
                ['percent', t('Percentage')],
              ],
            },
          },
        ],
        [
          {
            name: 'label_font_size',
            config: {
              type: 'SliderControl',
              label: t('Label Font Size'),
              default: 12,
              min: 8,
              max: 24,
              step: 1,
            },
          },
        ],
      ],
    },
    {
      label: t('Legend'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'show_legend',
            config: {
              type: 'CheckboxControl',
              label: t('Show Legend'),
              default: true,
            },
          },
        ],
        [
          {
            name: 'legend_position',
            config: {
              type: 'SelectControl',
              label: t('Legend Position'),
              default: 'bottomright',
              choices: [
                ['topleft', t('Top Left')],
                ['top', t('Top Center')],
                ['topright', t('Top Right')],
                ['left', t('Left')],
                ['right', t('Right')],
                ['bottomleft', t('Bottom Left')],
                ['bottom', t('Bottom Center')],
                ['bottomright', t('Bottom Right')],
              ],
            },
          },
        ],
        [
          {
            name: 'legend_display_type',
            config: {
              type: 'SelectControl',
              label: t('Legend Display'),
              default: 'vertical_list',
              renderTrigger: true,
              choices: [
                ['vertical_list', t('Vertical List')],
                ['horizontal_chips', t('Horizontal Chips')],
                ['compact', t('Compact')],
              ],
            },
          },
        ],
      ],
    },
    {
      label: t('Compass'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'compass_visible',
            config: {
              type: 'CheckboxControl',
              label: t('Show Compass'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'compass_position',
            config: {
              type: 'SelectControl',
              label: t('Compass Position'),
              default: 'topright',
              renderTrigger: true,
              choices: [
                ['topleft', t('Top Left')],
                ['topright', t('Top Right')],
                ['bottomleft', t('Bottom Left')],
                ['bottomright', t('Bottom Right')],
              ],
              visibility: ({ controls }: any) =>
                controls?.compass_visible?.value === true,
            },
          },
        ],
        [
          {
            name: 'compass_style',
            config: {
              type: 'SelectControl',
              label: t('Compass Style'),
              default: 'north_badge',
              renderTrigger: true,
              choices: [
                ['north_badge', t('North Badge (N▲)')],
                ['arrow_north', t('Arrow + N')],
                ['minimal_n', t('Minimal N')],
              ],
              visibility: ({ controls }: any) =>
                controls?.compass_visible?.value === true,
            },
          },
        ],
      ],
    },
    {
      label: t('Filters'),
      expanded: true,
      controlSetRows: [
        // DHIS2ColumnFilterControl — unified column filter for staged datasets.
        // Pick any dataset column; its distinct values are fetched immediately
        // from the backend so users can select from real data (not free-form).
        // Multiple column filters are supported simultaneously.
        // buildQuery.ts translates each {column, values} entry to WHERE col IN (...).
        // For non-staged datasets, standard adhoc_filters is still available below.
        [
          {
            name: 'dhis2_column_filters',
            config: {
              type: 'DHIS2ColumnFilterControl',
              label: t('Data Filters'),
              description: t(
                'Add one or more column filters. ' +
                  'Select a column, then choose from its actual values in the data. ' +
                  'Period column: values like 2024Q1, 2024, 202401. ' +
                  'Multiple filters are combined with AND.',
              ),
              default: [],
              mapStateToProps: (state: any) => ({
                datasource: state.datasource,
              }),
            },
          },
        ],
      ],
    },
    {
      label: t('Tooltip'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'tooltip_columns',
            config: {
              type: 'SelectControl',
              label: t('Tooltip Columns'),
              description: t('Additional columns to show in tooltip'),
              multi: true,
              mapStateToProps: (state: any) => ({
                choices:
                  state.datasource?.columns?.map((col: any) => [
                    col.column_name,
                    col.column_name,
                  ]) || [],
              }),
            },
          },
        ],
      ],
    },
  ],
};

export default config;
