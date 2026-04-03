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

import { ChartProps, QueryFormData } from '@superset-ui/core';
import {
  sanitizeDHIS2ColumnName,
  findMetricColumn,
} from '../../features/datasets/AddDataset/DHIS2ParameterBuilder/sanitize';
import { resolveDHIS2MetricLabel } from '../../utils/dhis2MetricLabel';
import { colorValueToCss } from 'src/utils/colorValue';
import {
  DHIS2LegendDefinition,
  DHIS2MapProps,
  LevelBorderColor,
} from './types';
import {
  buildBoundaryLevelLabelMap,
  getDatasourceBoundaryLevels,
  inferBoundaryLevelFromOrgUnitColumn,
} from './boundaryLevels';

type RGBAColor = { r: number; g: number; b: number; a: number };
type DatasourceColumn = {
  column_name?: string;
  verbose_name?: string;
  extra?: unknown;
};

type StagedOrgUnitLevel = {
  level?: number | string;
  displayName?: string;
  name?: string;
};

type StagedLegendColumnDefinition = {
  columnName: string;
  definition: DHIS2LegendDefinition;
};

type StagedLegendSetMetadata = {
  id?: string;
  displayName?: string;
  name?: string;
  legendDefinition?: unknown;
};

function generateLevelBorderColors(
  levels: number[],
  customColors?: Record<number, RGBAColor>,
): LevelBorderColor[] {
  // Distinct, vibrant colors for different boundary levels
  // Colors chosen for high visual contrast when overlaid
  const defaultColors: RGBAColor[] = [
    { r: 0, g: 0, b: 0, a: 1 }, // Level 1: Black (National) - highest visibility
    { r: 220, g: 53, b: 69, a: 1 }, // Level 2: Red (Region) - bold, stands out
    { r: 40, g: 167, b: 69, a: 1 }, // Level 3: Green (District) - contrasts with red
    { r: 0, g: 123, b: 255, a: 1 }, // Level 4: Blue (Sub-county)
    { r: 255, g: 193, b: 7, a: 1 }, // Level 5: Yellow/Gold (Parish)
    { r: 111, g: 66, b: 193, a: 1 }, // Level 6: Purple (Facility)
    { r: 23, g: 162, b: 184, a: 1 }, // Level 7: Cyan (if needed)
  ];

  // Border widths decrease with level (higher admin level = broader boundaries)
  const widths = [4, 3, 2.5, 2, 1.5, 1, 0.5];

  return levels.map(level => ({
    level,
    color:
      customColors?.[level] ||
      defaultColors[Math.min(level - 1, defaultColors.length - 1)],
    width: widths[Math.min(level - 1, widths.length - 1)],
  }));
}

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

function resolveHierarchyLevelFromDatasourceColumn(
  datasourceColumns: DatasourceColumn[],
  hierarchyLevelColumn: string,
  stagedOrgUnitLevels: StagedOrgUnitLevel[] = [],
): number | undefined {
  const exactMatch = datasourceColumns.find(
    column => column.column_name === hierarchyLevelColumn,
  );
  const sanitizedMatch = datasourceColumns.find(
    column =>
      column.column_name &&
      sanitizeDHIS2ColumnName(column.column_name) === hierarchyLevelColumn,
  );
  const matchedColumn = exactMatch || sanitizedMatch;
  const extra = parseColumnExtra(matchedColumn?.extra);
  const explicitLevel = Number(
    extra?.dhis2_ou_level ?? extra?.dhis2OuLevel ?? NaN,
  );
  if (Number.isFinite(explicitLevel) && explicitLevel > 0) {
    return explicitLevel;
  }
  return inferBoundaryLevelFromOrgUnitColumn(
    hierarchyLevelColumn,
    datasourceColumns,
    stagedOrgUnitLevels,
  );
}

function parseLegendDefinition(
  value: unknown,
): DHIS2LegendDefinition | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Record<string, any>;
  if (!Array.isArray(candidate.items) || candidate.items.length === 0) {
    return undefined;
  }

  const items = candidate.items.reduce<DHIS2LegendDefinition['items']>(
    (result, item) => {
      if (!item || typeof item !== 'object') {
        return result;
      }
      const rawItem = item as Record<string, any>;
      const color = String(rawItem.color ?? '').trim();
      if (!color) {
        return result;
      }

      const startValue =
        rawItem.startValue == null || rawItem.startValue === ''
          ? undefined
          : Number(rawItem.startValue);
      const endValue =
        rawItem.endValue == null || rawItem.endValue === ''
          ? undefined
          : Number(rawItem.endValue);

      result.push({
        id:
          rawItem.id === undefined || rawItem.id === null
            ? undefined
            : String(rawItem.id),
        label:
          rawItem.label === undefined || rawItem.label === null
            ? undefined
            : String(rawItem.label),
        startValue: Number.isFinite(startValue) ? startValue : undefined,
        endValue: Number.isFinite(endValue) ? endValue : undefined,
        color,
      });
      return result;
    },
    [],
  );

  if (!items.length) {
    return undefined;
  }

  const minCandidate =
    candidate.min == null || candidate.min === ''
      ? undefined
      : Number(candidate.min);
  const maxCandidate =
    candidate.max == null || candidate.max === ''
      ? undefined
      : Number(candidate.max);

  return {
    source:
      candidate.source === undefined || candidate.source === null
        ? undefined
        : String(candidate.source),
    setId:
      candidate.setId === undefined || candidate.setId === null
        ? undefined
        : String(candidate.setId),
    setName:
      candidate.setName === undefined || candidate.setName === null
        ? undefined
        : String(candidate.setName),
    min: Number.isFinite(minCandidate) ? minCandidate : undefined,
    max: Number.isFinite(maxCandidate) ? maxCandidate : undefined,
    items,
  };
}

function resolveMetricLegendDefinition(
  datasourceColumns: DatasourceColumn[],
  metricColumnName: string,
): DHIS2LegendDefinition | undefined {
  if (!metricColumnName) {
    return undefined;
  }

  const matchedColumn = datasourceColumns.find(column => {
    const colName = String(column.column_name || '').trim();
    return (
      colName === metricColumnName ||
      sanitizeDHIS2ColumnName(colName) === metricColumnName
    );
  });
  const extra = parseColumnExtra(matchedColumn?.extra);
  return parseLegendDefinition(extra?.dhis2_legend ?? extra?.dhis2Legend);
}

function collectStagedLegendDefinitions(
  datasourceColumns: DatasourceColumn[],
): StagedLegendColumnDefinition[] {
  return datasourceColumns.reduce<StagedLegendColumnDefinition[]>(
    (result, column) => {
      const colName = String(column.column_name || '').trim();
      const columnName = sanitizeDHIS2ColumnName(colName);
      if (!columnName) {
        return result;
      }

      const extra = parseColumnExtra(column.extra);
      const definition = parseLegendDefinition(
        extra?.dhis2_legend ?? extra?.dhis2Legend,
      );
      if (definition) {
        result.push({
          columnName,
          definition,
        });
      }
      return result;
    },
    [],
  );
}

function readCachedLegendSets(databaseId?: number): StagedLegendSetMetadata[] {
  if (!databaseId || typeof window === 'undefined') {
    return [];
  }

  try {
    const cached = window.localStorage.getItem(
      `dhis2_legend_sets_db${databaseId}`,
    );
    if (!cached) {
      return [];
    }

    const parsed = JSON.parse(cached);
    if (!Array.isArray(parsed?.data)) {
      return [];
    }

    return parsed.data.filter(
      (item: unknown): item is StagedLegendSetMetadata =>
        Boolean(item) && typeof item === 'object',
    );
  } catch {
    return [];
  }
}

function resolveCachedLegendSetDefinition(
  stagedLegendSets: StagedLegendSetMetadata[],
  selectedLegendColumn?: string,
): DHIS2LegendDefinition | undefined {
  if (
    !selectedLegendColumn ||
    !selectedLegendColumn.startsWith('legendset:') ||
    !stagedLegendSets.length
  ) {
    return undefined;
  }

  const requestedLegendIdentity = selectedLegendColumn
    .slice('legendset:'.length)
    .trim();
  if (!requestedLegendIdentity) {
    return undefined;
  }

  const matchedLegendSet = stagedLegendSets.find(legendSet => {
    const legendSetId = String(legendSet.id || '').trim();
    const legendSetName = String(
      legendSet.displayName || legendSet.name || '',
    ).trim();
    return (
      legendSetId === requestedLegendIdentity ||
      legendSetName === requestedLegendIdentity
    );
  });

  if (!matchedLegendSet) {
    return undefined;
  }

  return parseLegendDefinition(
    matchedLegendSet.legendDefinition || matchedLegendSet,
  );
}

function resolveSelectedStagedLegendDefinition(
  datasourceColumns: DatasourceColumn[],
  metricColumnName: string,
  selectedLegendColumn?: string,
  stagedLegendSets: StagedLegendSetMetadata[] = [],
): DHIS2LegendDefinition | undefined {
  const availableDefinitions = collectStagedLegendDefinitions(datasourceColumns);

  const cachedLegendSetDefinition = resolveCachedLegendSetDefinition(
    stagedLegendSets,
    selectedLegendColumn,
  );
  if (cachedLegendSetDefinition) {
    return cachedLegendSetDefinition;
  }

  if (!availableDefinitions.length) {
    return undefined;
  }

  if (
    selectedLegendColumn &&
    selectedLegendColumn !== '__metric__' &&
    !selectedLegendColumn.startsWith('legendset:') &&
    selectedLegendColumn.trim()
  ) {
    const matched = availableDefinitions.find(
      definition => definition.columnName === selectedLegendColumn,
    );
    if (matched) {
      return matched.definition;
    }
  }

  return resolveMetricLegendDefinition(datasourceColumns, metricColumnName);
}

function readCachedOrgUnitLevels(databaseId?: number): StagedOrgUnitLevel[] {
  if (!databaseId || typeof window === 'undefined') {
    return [];
  }

  try {
    const cached = window.localStorage.getItem(
      `dhis2_org_unit_levels_db${databaseId}`,
    );
    if (!cached) {
      return [];
    }

    const parsed = JSON.parse(cached);
    if (!Array.isArray(parsed?.data)) {
      return [];
    }

    return parsed.data.filter(
      (item: unknown): item is StagedOrgUnitLevel =>
        Boolean(item) && typeof item === 'object',
    );
  } catch {
    return [];
  }
}

function isPeriodColumn(col: DatasourceColumn): boolean {
  const extra = parseColumnExtra(col.extra);
  return (
    (extra as any)?.dhis2_is_period === true ||
    (extra as any)?.dhis2IsPeriod === true
  );
}

function mergeBoundaryLevels(
  primaryBoundaryLevel: number | undefined,
  configuredLevels: number[],
): number[] {
  if (!Number.isFinite(primaryBoundaryLevel) || !primaryBoundaryLevel) {
    return configuredLevels;
  }
  return [
    primaryBoundaryLevel,
    ...configuredLevels.filter(level => level !== primaryBoundaryLevel),
  ];
}

function coercePositiveInteger(value: unknown): number | undefined {
  const parsedValue = Number(value);
  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue;
  }
  return undefined;
}

export default function transformProps(chartProps: ChartProps): DHIS2MapProps {
  const {
    width,
    height,
    formData,
    queriesData,
    datasource,
    hooks,
    filterState,
  } = chartProps;

  const formDataAny = formData as any;

  const {
    metric,
    org_unit_column,
    aggregation_method,
    boundary_levels,
    boundary_level,
    enable_drill,
    tooltip_columns,
  } = formData as QueryFormData;
  const selectedOrgUnitColumn =
    formDataAny?.orgUnitColumn || formDataAny?.org_unit_column || org_unit_column;
  const selectedAggregationMethod =
    formDataAny?.aggregationMethod ||
    formDataAny?.aggregation_method ||
    aggregation_method;
  const selectedBoundaryLevels =
    formDataAny?.boundaryLevels || formDataAny?.boundary_levels || boundary_levels;
  const selectedBoundaryLevel =
    formDataAny?.boundaryLevel || formDataAny?.boundary_level || boundary_level;
  const drillEnabled =
    formDataAny?.enableDrill ?? formDataAny?.enable_drill ?? enable_drill;
  const selectedTooltipColumns =
    formDataAny?.tooltipColumns || formDataAny?.tooltip_columns || tooltip_columns;

  // Extract style props with camelCase fallback (formData is camelCase, controls are snake_case)
  const color_scheme = formDataAny?.colorScheme || formDataAny?.color_scheme;
  const linear_color_scheme =
    formDataAny?.linearColorScheme || formDataAny?.linear_color_scheme;
  const use_linear_color_scheme =
    formDataAny?.useLinearColorScheme ?? formDataAny?.use_linear_color_scheme;
  const chart_background_color = colorValueToCss(
    formDataAny?.chartBackgroundColor || formDataAny?.chart_background_color,
  );
  const opacity = formDataAny?.opacity;
  const stroke_color = formDataAny?.strokeColor || formDataAny?.stroke_color;
  const stroke_width = formDataAny?.strokeWidth ?? formDataAny?.stroke_width;
  const auto_theme_borders =
    formDataAny?.autoThemeBorders ?? formDataAny?.auto_theme_borders;
  const level_border_colors =
    formDataAny?.levelBorderColors || formDataAny?.level_border_colors;
  const show_all_boundaries =
    formDataAny?.showAllBoundaries ?? formDataAny?.show_all_boundaries;
  const focus_selected_boundary_with_children =
    formDataAny?.focusSelectedBoundaryWithChildren ??
    formDataAny?.focus_selected_boundary_with_children;
  const style_unselected_areas =
    formDataAny?.styleUnselectedAreas ?? formDataAny?.style_unselected_areas;
  const unselected_area_fill_color =
    formDataAny?.unselectedAreaFillColor ||
    formDataAny?.unselected_area_fill_color;
  const unselected_area_fill_opacity =
    formDataAny?.unselectedAreaFillOpacity ??
    formDataAny?.unselected_area_fill_opacity;
  const unselected_area_border_color =
    formDataAny?.unselectedAreaBorderColor ||
    formDataAny?.unselected_area_border_color;
  const unselected_area_border_width =
    formDataAny?.unselectedAreaBorderWidth ??
    formDataAny?.unselected_area_border_width;
  const show_labels = formDataAny?.showLabels ?? formDataAny?.show_labels;
  const label_type = formDataAny?.labelType || formDataAny?.label_type;
  const label_font_size =
    formDataAny?.labelFontSize ?? formDataAny?.label_font_size;
  const show_legend = formDataAny?.showLegend ?? formDataAny?.show_legend;
  const legend_position =
    formDataAny?.legendPosition || formDataAny?.legend_position;
  const legend_classes =
    formDataAny?.legendClasses ?? formDataAny?.legend_classes;
  const legend_type = formDataAny?.legendType || formDataAny?.legend_type;
  const staged_legend_column =
    formDataAny?.stagedLegendColumn || formDataAny?.staged_legend_column;
  const legend_min = formDataAny?.legendMin ?? formDataAny?.legend_min;
  const legend_max = formDataAny?.legendMax ?? formDataAny?.legend_max;
  const manual_breaks = formDataAny?.manualBreaks || formDataAny?.manual_breaks;
  const manual_colors = formDataAny?.manualColors || formDataAny?.manual_colors;
  const legend_reverse_colors =
    formDataAny?.legendReverseColors ?? formDataAny?.legend_reverse_colors;
  const legend_no_data_color =
    formDataAny?.legendNoDataColor || formDataAny?.legend_no_data_color;
  const legend_display_type =
    formDataAny?.legendDisplayType || formDataAny?.legend_display_type;
  // Compass
  const compass_visible =
    formDataAny?.compassVisible ?? formDataAny?.compass_visible;
  const compass_position =
    formDataAny?.compassPosition || formDataAny?.compass_position;
  const compass_style =
    formDataAny?.compassStyle || formDataAny?.compass_style;
  // Custom level colors - check both camelCase and snake_case
  const level_1_color = formDataAny?.level1Color || formDataAny?.level_1_color;
  const level_2_color = formDataAny?.level2Color || formDataAny?.level_2_color;
  const level_3_color = formDataAny?.level3Color || formDataAny?.level_3_color;
  const level_4_color = formDataAny?.level4Color || formDataAny?.level_4_color;
  const level_5_color = formDataAny?.level5Color || formDataAny?.level_5_color;
  const level_6_color = formDataAny?.level6Color || formDataAny?.level_6_color;

  const data = queriesData[0]?.data || [];
  const datasourceAny = datasource as any;
  const datasourceColumns = Array.isArray(datasourceAny?.columns)
    ? (datasourceAny.columns as DatasourceColumn[])
    : [];

  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];

  const ouHierarchyColumns = getDatasourceBoundaryLevels(datasourceColumns)
    .map(level => level.columnName)
    .filter(
      (columnName): columnName is string =>
        Boolean(columnName) && allColumns.includes(columnName),
    );

  const periodColumns = datasourceColumns
    .filter(c => isPeriodColumn(c) && c.column_name && allColumns.includes(c.column_name))
    .map(c => c.column_name as string);

  const extraRaw = datasourceAny?.extra;
  let extraParsed: any;
  try {
    extraParsed = typeof extraRaw === 'string' ? JSON.parse(extraRaw) : extraRaw;
  } catch {
    extraParsed = null;
  }

  const sourceDatabaseIdFromExtra =
    extraParsed?.dhis2_source_database_id ??
    extraParsed?.source_database_id ??
    extraParsed?.dhis2SourceDatabaseId;
  const stagedDatasetId =
    coercePositiveInteger(extraParsed?.dhis2_staged_dataset_id) ||
    coercePositiveInteger(extraParsed?.dhis2StagedDatasetId);
  const isStagedLocalDataset =
    extraParsed?.dhis2_staged_local === true ||
    extraParsed?.dhis2StagedLocal === true ||
    (formData as any)?.dhis2_staged_local_dataset === true ||
    (formData as any)?.dhis2_staged_local_dataset === 'true' ||
    (formData as any)?.dhis2StagedLocalDataset === true;
  const rawSourceInstanceIds = Array.isArray(extraParsed?.dhis2_source_instance_ids)
    ? extraParsed.dhis2_source_instance_ids
    : Array.isArray(extraParsed?.dhis2SourceInstanceIds)
      ? extraParsed.dhis2SourceInstanceIds
      : Array.isArray((formData as any)?.dhis2_source_instance_ids)
        ? (formData as any).dhis2_source_instance_ids
        : [];
  const sourceInstanceIdsFromExtra = rawSourceInstanceIds
    .map((value: unknown) => Number(value))
    .filter((value: number) => Number.isFinite(value) && value > 0);

  // Extract database ID used for DHIS2 metadata/boundaries.
  // For staged-local datasets this must be the original DHIS2 source database,
  // not the local serving database attached to the SQL dataset itself.
  let databaseId = sourceDatabaseIdFromExtra || datasourceAny?.database?.id;

  // Fallback: Check if database_id is directly on datasource
  if (!databaseId) {
    databaseId = datasourceAny?.database_id;
  }

  // Fallback: Try to get from formData (also check DHIS2-specific formData keys
  // that buildQuery writes — these are present in dashboard context where
  // datasource.extra fields may be absent)
  if (!databaseId && formData) {
    databaseId =
      (formData as any)?.dhis2_source_database_id ||
      (formData as any)?.dhis2SourceDatabaseId ||
      (formData as any)?.database_id ||
      (formData as any)?.database?.id;
  }

  const cachedOrgUnitLevels = readCachedOrgUnitLevels(databaseId);
  const cachedLegendSets = readCachedLegendSets(databaseId);
  const datasourceHierarchyLevels = getDatasourceBoundaryLevels(
    datasourceColumns,
    cachedOrgUnitLevels,
  );

  const activeFilters = formData?.filters || [];
  const nativeFilters =
    filterState && Object.keys(filterState).length > 0 ? filterState : {};

  // Get dataset SQL for fallback DHIS2 data fetching (used early for org unit detection)
  // If SQL is missing DHIS2 comment, try to reconstruct from datasource.extra.dhis2_params
  let datasetSql = datasourceAny?.sql || '';
  let isDHIS2Dataset =
    datasetSql.includes('/* DHIS2:') || datasetSql.includes('-- DHIS2:');

  if (
    !isDHIS2Dataset &&
    (sourceDatabaseIdFromExtra || sourceInstanceIdsFromExtra.length > 0)
  ) {
    isDHIS2Dataset = true;
  }

  if (!isDHIS2Dataset && formDataAny?.viz_type === 'dhis2_map' && !datasetSql) {
    isDHIS2Dataset = true;
  }

  if (!isDHIS2Dataset) {
    const dhis2ParamsMap = extraParsed?.dhis2_params;
    if (dhis2ParamsMap) {
      const tableName =
        datasourceAny?.table_name || datasourceAny?.table?.name || datasourceAny?.name;
      let dhis2Params: string | undefined =
        (tableName && dhis2ParamsMap[tableName]) || undefined;

      if (!dhis2Params) {
        const values = Object.values(dhis2ParamsMap);
        if (values.length === 1) {
          dhis2Params = String(values[0]);
        }
      }

      if (dhis2Params) {
        const safeTable = tableName || 'analytics';
        datasetSql = `SELECT * FROM ${safeTable}\n/* DHIS2: ${dhis2Params} */`;
        isDHIS2Dataset = true;
      }
    }
  }

  // Get metric - could be string or object with column_name
  const metricString =
    typeof metric === 'string'
      ? metric
      : (metric as any)?.column?.column_name ||
        (metric as any)?.label ||
        (metric as any)?.expressionType ||
        'value';
  const metricDisplayLabel =
    (typeof metric === 'string'
      ? undefined
      : resolveDHIS2MetricLabel(metric as any)) || metricString;
  // Sanitize org_unit_column for matching
  const sanitizedOrgUnitColumn = selectedOrgUnitColumn
    ? sanitizeDHIS2ColumnName(selectedOrgUnitColumn)
    : undefined;

  const sanitizedTooltipColumns = (selectedTooltipColumns || []).map((col: any) => {
    const colString =
      typeof col === 'string' ? col : col?.label || col?.name || String(col);
    return sanitizeDHIS2ColumnName(colString);
  });

  // Convert boundary_levels to array, supporting backward compatibility with boundary_level.
  const rawBoundaryLevels = selectedBoundaryLevels;
  const rawBoundaryLevel = selectedBoundaryLevel;
  const normalizeLevels = (
    levels: number | string | (number | string)[] | undefined,
  ): number[] => {
    if (!levels) return [];
    if (Array.isArray(levels)) {
      return levels
        .map(l => (typeof l === 'string' ? parseInt(String(l), 10) : l))
        .filter(l => !Number.isNaN(l) && l > 0);
    }
    const parsed = typeof levels === 'string' ? parseInt(levels, 10) : levels;
    return !Number.isNaN(parsed) && parsed > 0 ? [parsed] : [];
  };
  const requestedBoundaryLevels = normalizeLevels(rawBoundaryLevels);
  const requestedBoundaryLevelFallback = normalizeLevels(rawBoundaryLevel);
  const requestedPrimaryLevel =
    requestedBoundaryLevels[0] || requestedBoundaryLevelFallback[0];

  // Backend returns WIDE/PIVOTED format with hierarchy levels as columns
  // Detect hierarchy level columns dynamically from first row
  let hierarchyLevelColumn = '';

  // Look for hierarchy level columns
  // Priority 1: Use org_unit_column if explicitly set (try both original and sanitized)
  if (selectedOrgUnitColumn && allColumns.includes(selectedOrgUnitColumn)) {
    hierarchyLevelColumn = selectedOrgUnitColumn;
  } else if (
    sanitizedOrgUnitColumn &&
    allColumns.includes(sanitizedOrgUnitColumn)
  ) {
    hierarchyLevelColumn = sanitizedOrgUnitColumn;
  }

  // Priority 2: Use staged hierarchy metadata carried on the dataset columns.
  if (!hierarchyLevelColumn) {
    const levelColumnsFound = datasourceHierarchyLevels
      .map(level => level.columnName)
      .filter((columnName): columnName is string => Boolean(columnName))
      .filter(columnName => allColumns.includes(columnName));

    if (levelColumnsFound.length > 0) {
      const preferredHierarchyLevel =
        datasourceHierarchyLevels.find(
          level =>
            level.level === requestedPrimaryLevel &&
            level.columnName &&
            allColumns.includes(level.columnName),
        ) ||
        datasourceHierarchyLevels
          .filter(
            level => level.columnName && allColumns.includes(level.columnName),
          )
          .slice(-1)[0];

      hierarchyLevelColumn = preferredHierarchyLevel?.columnName || '';
    }
  }

  // Priority 3: If still no match, try to find any non-metric column
  // (columns that are strings, not numbers)
  if (!hierarchyLevelColumn && data.length > 0) {
    const firstRow = data[0];
    for (const col of allColumns) {
      const colLower = col.toLowerCase();
      // Skip metric-like columns
      if (
        colLower.includes('period') ||
        colLower.includes('year') ||
        colLower.includes('month') ||
        colLower.includes('quarter') ||
        typeof firstRow[col] === 'number'
      ) {
        continue;
      }
      // Use first string column as hierarchy column
      if (typeof firstRow[col] === 'string') {
        hierarchyLevelColumn = col;
        break;
      }
    }
  }

  // Priority 4: If we STILL have no hierarchy column and this is DHIS2, use first column as fallback
  if (!hierarchyLevelColumn && isDHIS2Dataset && allColumns.length > 0) {
    const firstRow = data[0];
    for (const col of allColumns) {
      if (typeof firstRow[col] === 'string') {
        hierarchyLevelColumn = col;
        break;
      }
    }
  }

  // Find the metric column dynamically using improved matching logic
  // Backend returns data element columns with IDs and names, all sanitized
  // Example: "105_EP01b_Malaria_Total" (ID_CODE_Name format)
  let metricColumn: string | undefined;

  const metricCandidates = Array.from(
    new Set(
      [
        metricDisplayLabel,
        metricString,
        typeof metric === 'string'
          ? undefined
          : (metric as any)?.sqlExpression,
        typeof metric === 'string'
          ? undefined
          : (metric as any)?.column?.verbose_name,
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean),
    ),
  );

  for (const candidate of metricCandidates) {
    metricColumn = findMetricColumn(candidate, allColumns);
    if (metricColumn) {
      break;
    }
  }

  // Fallback: First numeric column if metric not found
  if (!metricColumn && data.length > 0) {
    const firstRow = data[0];
    for (const col of allColumns) {
      const colLower = col.toLowerCase();
      if (
        !colLower.includes('period') &&
        !colLower.includes('level') &&
        (typeof firstRow[col] === 'number' || firstRow[col] !== null)
      ) {
        metricColumn = col;
        break;
      }
    }
  }

  // Final fallback: Use first column if nothing found (should not happen with valid data)
  if (!metricColumn && allColumns.length > 0) {
    metricColumn = allColumns[0];
  }

  // Default to 'value' if absolutely no columns available
  if (!metricColumn) {
    metricColumn = 'value';
  }

  const stagedLegendDefinition = resolveSelectedStagedLegendDefinition(
    datasourceColumns,
    metricColumn,
    staged_legend_column,
    cachedLegendSets,
  );
  const boundaryLevelLabels = buildBoundaryLevelLabelMap(
    datasourceColumns,
    cachedOrgUnitLevels,
  );
  const boundaryLevelColumns = datasourceHierarchyLevels.reduce<
    Record<number, string>
  >((result, definition) => {
    if (definition.columnName) {
      result[definition.level] = definition.columnName;
    }
    return result;
  }, {});

  const primaryBoundaryLevel = hierarchyLevelColumn
    ? resolveHierarchyLevelFromDatasourceColumn(
        datasourceColumns,
        hierarchyLevelColumn,
        cachedOrgUnitLevels,
      )
    : requestedPrimaryLevel;

  // Try boundary_levels first, then boundary_level for backward compatibility
  let selectedLevels = requestedBoundaryLevels;
  if (selectedLevels.length === 0) {
    selectedLevels = requestedBoundaryLevelFallback;
  }

  // Keep the selected OU hierarchy column as the primary boundary level so stale
  // saved boundary config does not request the wrong administrative geometry.
  if (selectedLevels.length === 0 && primaryBoundaryLevel) {
    selectedLevels = [primaryBoundaryLevel];
  } else if (primaryBoundaryLevel) {
    selectedLevels = mergeBoundaryLevels(primaryBoundaryLevel, selectedLevels);
  }

  // Final fallback: Default to Level 2 if nothing is specified
  if (selectedLevels.length === 0) {
    selectedLevels = [2];
  }

  // Build custom colors map from individual level color controls
  const customLevelColors: Record<
    number,
    { r: number; g: number; b: number; a: number }
  > = {};

  if (level_1_color) customLevelColors[1] = level_1_color;
  if (level_2_color) customLevelColors[2] = level_2_color;
  if (level_3_color) customLevelColors[3] = level_3_color;
  if (level_4_color) customLevelColors[4] = level_4_color;
  if (level_5_color) customLevelColors[5] = level_5_color;
  if (level_6_color) customLevelColors[6] = level_6_color;

  // Generate distinct border colors for each boundary level
  let levelBorderColors: LevelBorderColor[];
  if (
    level_border_colors &&
    Array.isArray(level_border_colors) &&
    level_border_colors.length > 0
  ) {
    levelBorderColors = level_border_colors;
  } else if (Object.keys(customLevelColors).length > 0) {
    levelBorderColors = generateLevelBorderColors(
      selectedLevels,
      customLevelColors,
    );
  } else {
    levelBorderColors = generateLevelBorderColors(selectedLevels);
  }

  // Parse manual breaks from comma-separated string to number array
  const parsedManualBreaks: number[] | undefined = manual_breaks
    ? manual_breaks
        .split(',')
        .map((v: string) => parseFloat(v.trim()))
        .filter((v: number) => !Number.isNaN(v))
    : undefined;

  // Parse manual colors from comma-separated string to string array
  const parsedManualColors: string[] | undefined = manual_colors
    ? manual_colors
        .split(',')
        .map((c: string) => c.trim())
        .filter((c: string) => c.length > 0)
    : undefined;

  const usesLegacyDefaultCategoricalScale =
    use_linear_color_scheme === false &&
    (!color_scheme || color_scheme === 'supersetColors') &&
    legend_type !== 'staged' &&
    legend_type !== 'manual' &&
    !parsedManualColors?.length;
  const effectiveUseLinearColorScheme =
    usesLegacyDefaultCategoricalScale || use_linear_color_scheme !== false;

  // Derive datasetId if datasource payload is minimal (e.g., dashboards)
  const datasetId =
    (datasource as any)?.id ||
    (typeof (formData as any)?.datasource === 'string'
      ? parseInt((formData as any).datasource.split('__')[0], 10)
      : undefined);
  const chartId =
    coercePositiveInteger(formDataAny?.slice_id) ||
    coercePositiveInteger(formDataAny?.sliceId) ||
    (typeof window !== 'undefined'
      ? coercePositiveInteger(
          new URLSearchParams(window.location.search).get('slice_id'),
        )
      : undefined);
  const dashboardId =
    coercePositiveInteger(formDataAny?.dashboard_id) ||
    coercePositiveInteger(formDataAny?.dashboardId);

  const effectiveAggregationMethod = (() => {
    if (selectedAggregationMethod) {
      return selectedAggregationMethod;
    }
    const metricCol = datasourceColumns.find(
      c =>
        c.column_name === metricColumn ||
        (c.column_name && sanitizeDHIS2ColumnName(c.column_name) === metricColumn),
    );
    const extra = parseColumnExtra(metricCol?.extra);
    if (extra?.dhis2_is_indicator === true) {
      return 'average';
    }
    return 'sum';
  })();

  return {
    width,
    height,
    data,
    databaseId,
    isStagedLocalDataset,
    stagedDatasetId,
    sourceInstanceIds: sourceInstanceIdsFromExtra,
    datasetId,
    datasourceColumns,
    orgUnitColumn: hierarchyLevelColumn,
    metric: metricColumn,
    metricLabel: metricDisplayLabel || metricColumn,
    aggregationMethod: effectiveAggregationMethod,
    primaryBoundaryLevel,
    boundaryLevels: selectedLevels,
    boundaryLevelLabels,
    boundaryLevelColumns,
    levelBorderColors,
    enableDrill: drillEnabled !== false,
    colorScheme: color_scheme || 'supersetColors',
    linearColorScheme: linear_color_scheme || 'superset_seq_1',
    useLinearColorScheme: effectiveUseLinearColorScheme,
    chartBackgroundColor: chart_background_color,
    opacity: opacity ?? 0.7,
    strokeColor: stroke_color || { r: 255, g: 255, b: 255, a: 1 },
    strokeWidth: stroke_width ?? 1,
    autoThemeBorders: auto_theme_borders ?? false,
    showAllBoundaries: show_all_boundaries ?? false,
    focusSelectedBoundaryWithChildren:
      focus_selected_boundary_with_children ?? false,
    styleUnselectedAreas: style_unselected_areas ?? true,
    unselectedAreaFillColor: unselected_area_fill_color || {
      r: 241,
      g: 245,
      b: 249,
      a: 1,
    },
    unselectedAreaFillOpacity: unselected_area_fill_opacity ?? 0.45,
    unselectedAreaBorderColor: unselected_area_border_color || {
      r: 148,
      g: 163,
      b: 184,
      a: 1,
    },
    unselectedAreaBorderWidth: unselected_area_border_width ?? 0.75,
    showLabels: show_labels !== false,
    labelType: label_type || 'name',
    labelFontSize: label_font_size || 12,
    showLegend: show_legend !== false,
    legendPosition: legend_position || 'bottomright',
    legendDisplayType: legend_display_type || 'vertical_list',
    legendClasses: legend_classes || 5,
    legendType: legend_type || 'auto',
    legendMin: legend_min ? Number(legend_min) : undefined,
    legendMax: legend_max ? Number(legend_max) : undefined,
    manualBreaks: parsedManualBreaks,
    manualColors: parsedManualColors,
    stagedLegendDefinition,
    legendReverseColors: legend_reverse_colors ?? false,
    legendNoDataColor: legend_no_data_color || { r: 204, g: 204, b: 204, a: 1 },
    compassVisible: compass_visible === true,
    compassPosition: compass_position || 'topright',
    compassStyle: compass_style || 'north_badge',
    tooltipColumns: sanitizedTooltipColumns,
    setDataMask: hooks?.setDataMask,
    activeFilters,
    nativeFilters,
    // DHIS2 specific props for fallback data fetching
    datasetSql,
    isDHIS2Dataset,
    // Boundary loading method - default to geoJSON for better multi-level support
    boundaryLoadMethod: formData.boundary_load_method || 'geoJSON',
    chartId,
    dashboardId,
    ouHierarchyColumns,
    periodColumns,
  };
}
