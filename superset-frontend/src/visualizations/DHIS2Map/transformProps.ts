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
import { DHIS2MapProps, LevelBorderColor } from './types';

type RGBAColor = { r: number; g: number; b: number; a: number };

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

  // eslint-disable-next-line no-console
  console.log('[DHIS2Map transformProps] Received formData:', {
    boundary_levels: (formData as any)?.boundary_levels,
    boundary_level: (formData as any)?.boundary_level,
    all_keys: Object.keys(formData || {}),
    // Check for any boundary-related keys
    boundary_keys: Object.keys(formData || {}).filter(k => k.toLowerCase().includes('boundary') || k.toLowerCase().includes('level')),
    // Show raw formData for boundary fields
    raw_boundary_levels: JSON.stringify((formData as any)?.boundary_levels),
  });

  // eslint-disable-next-line no-console
  console.log('[DHIS2Map transformProps] 🎨 STYLE PROPS:', {
    color_scheme: (formData as any)?.color_scheme,
    colorScheme: (formData as any)?.colorScheme,
    linear_color_scheme: (formData as any)?.linear_color_scheme,
    linearColorScheme: (formData as any)?.linearColorScheme,
    use_linear_color_scheme: (formData as any)?.use_linear_color_scheme,
    useLinearColorScheme: (formData as any)?.useLinearColorScheme,
    opacity: (formData as any)?.opacity,
    stroke_color: (formData as any)?.stroke_color,
    strokeColor: (formData as any)?.strokeColor,
    stroke_width: (formData as any)?.stroke_width,
    strokeWidth: (formData as any)?.strokeWidth,
    auto_theme_borders: (formData as any)?.auto_theme_borders,
    autoThemeBorders: (formData as any)?.autoThemeBorders,
    show_legend: (formData as any)?.show_legend,
    showLegend: (formData as any)?.showLegend,
    legend_position: (formData as any)?.legend_position,
    legendPosition: (formData as any)?.legendPosition,
    legend_classes: (formData as any)?.legend_classes,
    legendClasses: (formData as any)?.legendClasses,
  });

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

  // Extract style props with camelCase fallback (formData is camelCase, controls are snake_case)
  const color_scheme = formDataAny?.colorScheme || formDataAny?.color_scheme;
  const linear_color_scheme =
    formDataAny?.linearColorScheme || formDataAny?.linear_color_scheme;
  const use_linear_color_scheme =
    formDataAny?.useLinearColorScheme ?? formDataAny?.use_linear_color_scheme;
  const opacity = formDataAny?.opacity;
  const stroke_color = formDataAny?.strokeColor || formDataAny?.stroke_color;
  const stroke_width = formDataAny?.strokeWidth ?? formDataAny?.stroke_width;
  const auto_theme_borders =
    formDataAny?.autoThemeBorders ?? formDataAny?.auto_theme_borders;
  const level_border_colors =
    formDataAny?.levelBorderColors || formDataAny?.level_border_colors;
  const show_all_boundaries =
    formDataAny?.showAllBoundaries ?? formDataAny?.show_all_boundaries;
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
  const legend_min = formDataAny?.legendMin ?? formDataAny?.legend_min;
  const legend_max = formDataAny?.legendMax ?? formDataAny?.legend_max;
  const manual_breaks = formDataAny?.manualBreaks || formDataAny?.manual_breaks;
  const manual_colors = formDataAny?.manualColors || formDataAny?.manual_colors;
  const legend_reverse_colors =
    formDataAny?.legendReverseColors ?? formDataAny?.legend_reverse_colors;
  const legend_no_data_color =
    formDataAny?.legendNoDataColor || formDataAny?.legend_no_data_color;
  // Custom level colors
  const level_1_color = formDataAny?.level1Color || formDataAny?.level_1_color;
  const level_2_color = formDataAny?.level2Color || formDataAny?.level_2_color;
  const level_3_color = formDataAny?.level3Color || formDataAny?.level_3_color;
  const level_4_color = formDataAny?.level4Color || formDataAny?.level_4_color;
  const level_5_color = formDataAny?.level5Color || formDataAny?.level_5_color;
  const level_6_color = formDataAny?.level6Color || formDataAny?.level_6_color;

  const data = queriesData[0]?.data || [];

  // Extract database ID from datasource - try multiple paths
  let databaseId = (datasource as any)?.database?.id;

  // Fallback: Check if database_id is directly on datasource
  if (!databaseId) {
    databaseId = (datasource as any)?.database_id;
  }

  // Fallback: Try to get from formData
  if (!databaseId && formData) {
    databaseId =
      (formData as any)?.database_id || (formData as any)?.database?.id;
  }

  // eslint-disable-next-line no-console
  console.log('[DHIS2Map transformProps] Database ID extraction:', {
    databaseId,
    datasource_keys: datasource ? Object.keys(datasource as object) : [],
    database_obj: (datasource as any)?.database,
  });

  const activeFilters = formData?.filters || [];
  const nativeFilters =
    filterState && Object.keys(filterState).length > 0 ? filterState : {};

  // Get dataset SQL for fallback DHIS2 data fetching (used early for org unit detection)
  const datasetSql = (datasource as any)?.sql || '';
  // Check if this is a DHIS2 dataset (has DHIS2 comment in SQL)
  const isDHIS2Dataset =
    datasetSql.includes('/* DHIS2:') || datasetSql.includes('-- DHIS2:');

  // Get metric - could be string or object with column_name
  const metricString =
    typeof metric === 'string'
      ? metric
      : (metric as any)?.column?.column_name ||
        (metric as any)?.label ||
        (metric as any)?.expressionType ||
        'value';
  const sanitizedMetric = sanitizeDHIS2ColumnName(metricString);

  // Sanitize org_unit_column for matching
  const sanitizedOrgUnitColumn = org_unit_column
    ? sanitizeDHIS2ColumnName(org_unit_column)
    : undefined;

  const sanitizedTooltipColumns = (tooltip_columns || []).map((col: any) => {
    const colString =
      typeof col === 'string' ? col : col?.label || col?.name || String(col);
    return sanitizeDHIS2ColumnName(colString);
  });

  // Backend returns WIDE/PIVOTED format with hierarchy levels as columns
  // Detect hierarchy level columns dynamically from first row
  let hierarchyLevelColumn = '';
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];

  // eslint-disable-next-line no-console
  console.log('[DHIS2Map transformProps] Detecting org unit column:', {
    org_unit_column,
    sanitizedOrgUnitColumn,
    allColumns,
    hasData: data.length > 0,
  });

  // Look for hierarchy level columns
  // Priority 1: Use org_unit_column if explicitly set (try both original and sanitized)
  if (org_unit_column && allColumns.includes(org_unit_column)) {
    hierarchyLevelColumn = org_unit_column;
    // eslint-disable-next-line no-console
    console.log(
      '[DHIS2Map transformProps] Using explicitly set org_unit_column:',
      org_unit_column,
    );
  } else if (
    sanitizedOrgUnitColumn &&
    allColumns.includes(sanitizedOrgUnitColumn)
  ) {
    hierarchyLevelColumn = sanitizedOrgUnitColumn;
    // eslint-disable-next-line no-console
    console.log(
      '[DHIS2Map transformProps] Using sanitized org_unit_column:',
      sanitizedOrgUnitColumn,
    );
  }

  // Priority 2: Look for known hierarchy column patterns
  let levelColumns: string[] = [];
  if (!hierarchyLevelColumn) {
    const hierarchyPatterns = [
      /^(country|national)$/i,
      /^(region|province)$/i,
      /^district$/i,
      /^(subcounty|sub_county|sub-county)$/i,
      /^(parish|town|town_council)$/i,
      /^(village|facility|health_facility)$/i,
      /level.*name/i,
      /org.*unit/i,
      /^(ou|organisationunit|org_unit)$/i,
      /location/i,
    ];

    // Find columns that match hierarchy patterns
    levelColumns = allColumns.filter(col =>
      hierarchyPatterns.some(pattern => pattern.test(col)),
    );

    if (levelColumns.length > 0) {
      // Sort to get consistent ordering
      levelColumns.sort();

      // Determine which level to use based on boundary_level or boundary_levels
      const selectedLevel =
        boundary_level ||
        (Array.isArray(boundary_levels) && boundary_levels.length > 0
          ? boundary_levels[0]
          : 2);

      // Use the boundary level (1-indexed) to pick the corresponding column
      // Level 1 = National, Level 2 = Region, etc.
      const levelIndex = Math.min(selectedLevel - 1, levelColumns.length - 1);
      hierarchyLevelColumn = levelColumns[Math.max(0, levelIndex)];
      // eslint-disable-next-line no-console
      console.log(
        '[DHIS2Map transformProps] Using pattern-matched hierarchy column:',
        {
          hierarchyLevelColumn,
          selectedLevel,
          levelIndex,
          allPatternMatches: levelColumns,
        },
      );
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
        // eslint-disable-next-line no-console
        console.log(
          '[DHIS2Map transformProps] Using first string column as org unit:',
          col,
        );
        break;
      }
    }
  }

  // Priority 4: If we STILL have no hierarchy column and this is DHIS2, use first column as fallback
  // (DHIS2 data should have org units as the first meaningful column)
  if (!hierarchyLevelColumn && isDHIS2Dataset && allColumns.length > 0) {
    const firstRow = data[0];
    // Look for first non-numeric column
    for (const col of allColumns) {
      if (typeof firstRow[col] === 'string') {
        hierarchyLevelColumn = col;
        // eslint-disable-next-line no-console
        console.log(
          '[DHIS2Map transformProps] Using DHIS2 fallback org unit column:',
          col,
        );
        break;
      }
    }
  }

  // Find the metric column dynamically using improved matching logic
  // Backend returns data element columns with IDs and names, all sanitized
  // Example: "105_EP01b_Malaria_Total" (ID_CODE_Name format)
  let metricColumn: string | undefined;

  if (metricString) {
    // Use the comprehensive findMetricColumn function
    // It handles: exact matches, sanitized matches, aggregation functions, and partial matches
    metricColumn = findMetricColumn(metricString, allColumns);
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

  // Convert boundary_levels to array, supporting backward compatibility with boundary_level
  // IMPORTANT: Check Array.isArray first because empty arrays are falsy in JS
  
  // Also check for camelCase variants (sometimes Superset passes these)
  const rawBoundaryLevels = boundary_levels ?? (formData as any)?.boundaryLevels;
  const rawBoundaryLevel = boundary_level ?? (formData as any)?.boundaryLevel;
  
  // Normalize boundary levels - handle various input formats
  // SelectControl can return: number[], string[], number, string, or undefined
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

  // Try boundary_levels first, then boundary_level for backward compatibility
  let selectedLevels = normalizeLevels(rawBoundaryLevels);
  let levelSource = 'boundary_levels';

  if (selectedLevels.length === 0) {
    selectedLevels = normalizeLevels(rawBoundaryLevel);
    levelSource = 'boundary_level';
  }

  // eslint-disable-next-line no-console
  console.log('[DHIS2Map transformProps] Boundary level inputs:', {
    boundary_levels,
    rawBoundaryLevels,
    boundary_levels_type: typeof boundary_levels,
    boundary_levels_isArray: Array.isArray(boundary_levels),
    boundary_level,
    rawBoundaryLevel,
    boundary_level_type: typeof boundary_level,
    boundary_level_isArray: Array.isArray(boundary_level),
    normalizedLevels: selectedLevels,
    levelSource,
  });

  // AUTO-DETECT boundary level from org unit column name if no level explicitly set
  // This helps when users don't explicitly set the boundary level
  if (selectedLevels.length === 0 && hierarchyLevelColumn) {
    const colLower = hierarchyLevelColumn.toLowerCase();
    let detectedLevel: number | null = null;
    
    // Standard Uganda DHIS2 hierarchy mapping
    // Level 1: National (Country)
    // Level 2: Region  
    // Level 3: District
    // Level 4: Sub-county
    // Level 5: Parish/Facility
    if (colLower.includes('national') || colLower.includes('country')) {
      detectedLevel = 1;
    } else if (colLower.includes('region') || colLower.includes('province')) {
      detectedLevel = 2;
    } else if (colLower.includes('district') && !colLower.includes('sub')) {
      detectedLevel = 3;
    } else if (colLower.includes('subcounty') || colLower.includes('sub_county') || colLower.includes('sub-county')) {
      detectedLevel = 4;
    } else if (colLower.includes('parish') || colLower.includes('facility') || colLower.includes('village')) {
      detectedLevel = 5;
    }
    
    if (detectedLevel) {
      selectedLevels = [detectedLevel];
      levelSource = `auto-detected from column "${hierarchyLevelColumn}"`;
      // eslint-disable-next-line no-console
      console.log(
        `[DHIS2Map transformProps] Auto-detected boundary level ${detectedLevel} from column "${hierarchyLevelColumn}"`,
      );
    }
  }
  
  // Final fallback: Default to Level 2 if nothing is specified
  if (selectedLevels.length === 0) {
    selectedLevels = [2];
    levelSource = 'DEFAULT (no level specified)';
    // eslint-disable-next-line no-console
    console.log(
      '[DHIS2Map transformProps] Using DEFAULT (Level 2):',
      selectedLevels,
    );
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

  // eslint-disable-next-line no-console
  console.log('[DHIS2Map transformProps] Level color controls:', {
    level_1_color,
    level_2_color,
    level_3_color,
    level_4_color,
    level_5_color,
    level_6_color,
    customLevelColors,
    selectedLevels,
  });

  // Generate distinct border colors for each boundary level
  // Use custom level_border_colors if provided, then custom level colors, otherwise defaults
  let levelBorderColors: LevelBorderColor[];
  if (
    level_border_colors &&
    Array.isArray(level_border_colors) &&
    level_border_colors.length > 0
  ) {
    levelBorderColors = level_border_colors;
  } else if (Object.keys(customLevelColors).length > 0) {
    // Use custom colors from control panel
    levelBorderColors = generateLevelBorderColors(
      selectedLevels,
      customLevelColors,
    );
  } else {
    levelBorderColors = generateLevelBorderColors(selectedLevels);
  }

  // Debug logging
  // eslint-disable-next-line no-console
  console.log('[DHIS2Map transformProps] Data structure:', {
    total_rows: data.length,
    all_columns: allColumns,
    hierarchy_level_columns: levelColumns,
    selected_hierarchy_column: hierarchyLevelColumn,
    org_unit_column_original: org_unit_column,
    org_unit_column_sanitized: sanitizedOrgUnitColumn,
    selected_metric_column: metricColumn,
    metric_string: metricString,
    sanitized_metric: sanitizedMetric,
    boundary_levels_from_formData: boundary_levels,
    boundary_level_from_formData: boundary_level,
    selected_boundary_levels: selectedLevels,
    level_border_colors: levelBorderColors,
    custom_level_colors: customLevelColors,
    sample_row: data[0],
  });
  if (!metricColumn && data.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[DHIS2Map transformProps] WARNING: No metric column found! Expected metric:',
      metricString,
      'Available columns:',
      allColumns.join(', '),
    );
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

  // Final debug logging for critical props
  // eslint-disable-next-line no-console
  console.log('[DHIS2Map transformProps] FINAL PROPS:', {
    databaseId,
    boundaryLevels: selectedLevels,
    orgUnitColumn: hierarchyLevelColumn,
    metric: metricColumn,
    isDHIS2Dataset,
    dataRowCount: data.length,
  });

  return {
    width,
    height,
    data,
    databaseId,
    orgUnitColumn: hierarchyLevelColumn,
    metric: metricColumn,
    aggregationMethod: aggregation_method || 'sum',
    boundaryLevels: selectedLevels,
    levelBorderColors,
    enableDrill: enable_drill !== false,
    colorScheme: color_scheme || 'supersetColors',
    linearColorScheme: linear_color_scheme || 'superset_seq_1',
    useLinearColorScheme: use_linear_color_scheme !== false,
    opacity: opacity ?? 0.7,
    strokeColor: stroke_color || { r: 255, g: 255, b: 255, a: 1 },
    strokeWidth: stroke_width ?? 1,
    autoThemeBorders: auto_theme_borders ?? false,
    showAllBoundaries: show_all_boundaries !== false,
    showLabels: show_labels !== false,
    labelType: label_type || 'name',
    labelFontSize: label_font_size || 12,
    showLegend: show_legend !== false,
    legendPosition: legend_position || 'bottomright',
    legendClasses: legend_classes || 5,
    legendType: legend_type || 'auto',
    legendMin: legend_min ? Number(legend_min) : undefined,
    legendMax: legend_max ? Number(legend_max) : undefined,
    manualBreaks: parsedManualBreaks,
    manualColors: parsedManualColors,
    legendReverseColors: legend_reverse_colors ?? false,
    legendNoDataColor: legend_no_data_color || { r: 204, g: 204, b: 204, a: 1 },
    tooltipColumns: sanitizedTooltipColumns,
    setDataMask: hooks?.setDataMask,
    activeFilters,
    nativeFilters,
    // DHIS2 specific props for fallback data fetching
    datasetSql,
    isDHIS2Dataset,
    // Boundary loading method - default to geoJSON for better multi-level support
    boundaryLoadMethod: formData.boundary_load_method || 'geoJSON',
  };
}
