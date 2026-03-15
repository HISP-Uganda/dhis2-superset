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

import { buildQueryContext, QueryFormData } from '@superset-ui/core';
import { sanitizeDHIS2ColumnName } from '../../features/datasets/AddDataset/DHIS2ParameterBuilder/sanitize';
import { resolveDHIS2MetricLabel } from '../../utils/dhis2MetricLabel';

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

export default function buildQuery(formData: QueryFormData) {
  const formDataAny = formData as any;
  const {
    metric,
    tooltip_columns = [],
    granularity_sqla,
    org_unit_column,
    boundary_levels,
    boundary_level,
    aggregation_method,
  } = formData;
  const focusSelectedBoundaryWithChildren = Boolean(
    formDataAny?.focusSelectedBoundaryWithChildren ??
      formDataAny?.focus_selected_boundary_with_children,
  );

  const hierarchyColumnsValue = formDataAny?.dhis2_hierarchy_columns;
  const rawHierarchyColumns = Array.isArray(hierarchyColumnsValue)
    ? hierarchyColumnsValue
    : typeof hierarchyColumnsValue === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(hierarchyColumnsValue);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  const sanitizedHierarchyColumns = rawHierarchyColumns
    .map((column: unknown) => sanitizeDHIS2ColumnName(String(column || '')))
    .filter(Boolean);

  return buildQueryContext(formData, baseQueryObject => {
    // Check if this is a DHIS2 dataset by looking at the datasource SQL
    // For DHIS2 datasets, we don't execute SQL through the standard chart API
    // Instead, DHIS2Map will fetch data via DHIS2DataLoader
    const datasourceAny = (baseQueryObject as any)?.datasource || {};
    const datasourceSql = datasourceAny?.sql || '';
    const extraRaw = datasourceAny?.extra;
    let extraParsed: any;
    try {
      extraParsed =
        typeof extraRaw === 'string' ? JSON.parse(extraRaw) : extraRaw;
    } catch {
      extraParsed = null;
    }
    const hierarchyColumnsFromDatasource = Array.isArray(datasourceAny?.columns)
      ? datasourceAny.columns
          .filter((column: any) => {
            const extra = parseColumnExtra(column?.extra);
            return (
              extra?.dhis2_is_ou_hierarchy === true ||
              extra?.dhis2IsOuHierarchy === true ||
              Number.isFinite(
                Number(extra?.dhis2_ou_level ?? extra?.dhis2OuLevel ?? NaN),
              )
            );
          })
          .sort((left: any, right: any) => {
            const leftExtra = parseColumnExtra(left?.extra);
            const rightExtra = parseColumnExtra(right?.extra);
            const leftLevel = Number(
              leftExtra?.dhis2_ou_level ?? leftExtra?.dhis2OuLevel ?? 0,
            );
            const rightLevel = Number(
              rightExtra?.dhis2_ou_level ?? rightExtra?.dhis2OuLevel ?? 0,
            );
            return leftLevel - rightLevel;
          })
          .map((column: any) => String(column?.column_name || '').trim())
          .filter(Boolean)
      : [];
    const effectiveHierarchyColumns =
      sanitizedHierarchyColumns.length > 0
        ? sanitizedHierarchyColumns
        : hierarchyColumnsFromDatasource.map((column: string) =>
            sanitizeDHIS2ColumnName(column),
          );
    const isStagedLocalDataset =
      extraParsed?.dhis2_staged_local === true ||
      extraParsed?.dhis2StagedLocal === true ||
      formDataAny?.dhis2_staged_local_dataset === true ||
      formDataAny?.dhis2_staged_local_dataset === 'true' ||
      formDataAny?.dhis2StagedLocalDataset === true;
    let isDHIS2Dataset =
      datasourceSql.includes('/* DHIS2:') ||
      datasourceSql.includes('-- DHIS2:');

    if (!isDHIS2Dataset) {
      if (extraParsed?.dhis2_params) {
        isDHIS2Dataset = true;
      }
    }

    // eslint-disable-next-line no-console
    console.log('[DHIS2Map buildQuery] Dataset type:', {
      isDHIS2Dataset,
      isStagedLocalDataset,
      hasSQL: !!datasourceSql,
      sqlPreview: datasourceSql.substring(0, 100),
    });

    // For DHIS2 datasets, return a minimal safe query.
    // Explore still calls /api/v1/chart/data; an empty query triggers a 400.
    // We keep it tiny to avoid heavy backend work while letting DHIS2Map fetch via DHIS2DataLoader.
    if (isDHIS2Dataset && !isStagedLocalDataset) {
      // Determine the selected boundary level for hierarchy column selection
      let selectedLevel = 2;
      if (Array.isArray(boundary_levels) && boundary_levels.length > 0) {
        selectedLevel = Math.min(...boundary_levels);
      } else if (boundary_level) {
        selectedLevel = Array.isArray(boundary_level) ? boundary_level[0] : boundary_level;
      }
      
      const minimalGroupby: string[] = org_unit_column
        ? [sanitizeDHIS2ColumnName(org_unit_column)]
        : [];

      const minimalMetric =
        metric && metric !== ''
          ? metric
          : {
              expressionType: 'SQL',
              sqlExpression: 'COUNT(*)',
              label: '__count',
            };

      // eslint-disable-next-line no-console
      console.log(
        '[DHIS2Map buildQuery] DHIS2 dataset detected - ' +
          'returning minimal query for component-level data fetching',
        {
          selectedLevel,
          boundary_levels,
          boundary_level,
          minimalGroupby,
          isStagedLocalDataset,
        },
      );
      return [
        {
          ...baseQueryObject,
          // Minimal query to avoid "Empty query" backend error
          groupby: minimalGroupby,
          metrics: [minimalMetric],
          row_limit: 1,
          // Mark this as a DHIS2 query so we know to skip chart API execution
          is_dhis2: true,
          // Pass the selected boundary level so data loading can fetch appropriate org units
          dhis2_boundary_level: selectedLevel,
          dhis2_boundary_levels: boundary_levels || [selectedLevel],
        },
      ];
    }

    // For non-DHIS2 datasets, use standard query building
    // Get the metric - could be a string column name or a metric object
    let metricColumn =
      typeof metric === 'string'
        ? metric
        : (metric as any)?.column?.column_name ||
          (metric as any)?.label ||
          (metric as any)?.expressionType ||
          'value';

    // Extract column name from SQL aggregate functions like SUM(column_name)
    const sqlAggPattern =
      /^(SUM|AVG|COUNT|MIN|MAX|STDDEV|VARIANCE)\s*\(\s*([^)]+)\s*\)$/i;
    const sqlMatch = metricColumn.match(sqlAggPattern);
    if (sqlMatch) {
      // Use just the column name, not the SUM() wrapper
      metricColumn = sqlMatch[2].trim();
    }

    // Sanitize the metric name to match backend column naming
    const sanitizedMetric = sanitizeDHIS2ColumnName(metricColumn);

    // Sanitize org_unit_column if provided
    const sanitizedOrgUnitColumn = org_unit_column
      ? sanitizeDHIS2ColumnName(org_unit_column)
      : undefined;
    const selectedFocusOrgUnitColumn = (() => {
      if (
        !focusSelectedBoundaryWithChildren ||
        !sanitizedOrgUnitColumn ||
        effectiveHierarchyColumns.length === 0
      ) {
        return sanitizedOrgUnitColumn;
      }

      const currentIndex = effectiveHierarchyColumns.indexOf(
        sanitizedOrgUnitColumn,
      );
      if (
        currentIndex >= 0 &&
        currentIndex < effectiveHierarchyColumns.length - 1
      ) {
        // Focus mode colors the next hierarchy level down, so the terminal OU
        // restriction must also target that child column rather than the
        // original parent selection.
        return effectiveHierarchyColumns[currentIndex + 1];
      }

      return sanitizedOrgUnitColumn;
    })();
    const dhis2QueryExtras = {
      ...(baseQueryObject.extras || {}),
      ...(selectedFocusOrgUnitColumn
        ? {
            dhis2_selected_org_unit_column: selectedFocusOrgUnitColumn,
          }
        : {}),
    };

    // Sanitize tooltip columns
    const sanitizedTooltipColumns = (tooltip_columns || []).map((col: any) => {
      const colString =
        typeof col === 'string' ? col : col?.label || col?.name || String(col);
      return sanitizeDHIS2ColumnName(colString);
    });

    // Build columns array - request all needed columns as dimensions
    const columns: string[] = [];
    const addColumn = (columnName?: string) => {
      if (columnName && !columns.includes(columnName)) {
        columns.push(columnName);
      }
    };

    // Staged-local maps need the full staged OU path in the query results so
    // focused "one level down" rendering can still color child boundaries from
    // serving-table rows without reloading from the live DHIS2 preview path.
    if (isStagedLocalDataset && effectiveHierarchyColumns.length > 0) {
      effectiveHierarchyColumns.forEach(addColumn);
    } else {
      addColumn(sanitizedOrgUnitColumn);
    }

    // Always include Period if available (time/granularity column)
    if (granularity_sqla) {
      addColumn(sanitizeDHIS2ColumnName(granularity_sqla));
    }

    // Add tooltip columns
    if (sanitizedTooltipColumns && sanitizedTooltipColumns.length > 0) {
      sanitizedTooltipColumns.forEach(addColumn);
    }

    const isLatestAggregation =
      String(aggregation_method || '').toLowerCase() === 'latest';
    const aggregateFunction = (() => {
      switch (String(aggregation_method || '').toLowerCase()) {
        case 'average':
          return 'AVG';
        case 'max':
          return 'MAX';
        case 'min':
          return 'MIN';
        case 'count':
          return 'COUNT';
        default:
          return 'SUM';
      }
    })();
    const metricLabel =
      (typeof metric === 'string'
        ? undefined
        : resolveDHIS2MetricLabel(metric as any)) ||
      (sanitizedMetric ? `${aggregateFunction}(${sanitizedMetric})` : undefined);
    const aggregatedMetric =
      sanitizedMetric && !isLatestAggregation
        ? {
            expressionType: 'SQL' as const,
            sqlExpression: `${aggregateFunction}(${sanitizedMetric})`,
            label:
              metricLabel || `${aggregateFunction}(${sanitizedMetric})`,
          }
        : undefined;

    if (isLatestAggregation) {
      // Latest needs the raw metric rows so the map can resolve the final
      // value client-side after the focused-parent filter is applied.
      addColumn(sanitizedMetric);
    }

    // eslint-disable-next-line no-console
    console.log('[DHIS2Map buildQuery] Building query with:', {
      isDHIS2Dataset,
      isStagedLocalDataset,
      originalMetric: metricColumn,
      sanitizedMetric,
      sanitizedOrgUnitColumn,
      selectedFocusOrgUnitColumn,
      focusSelectedBoundaryWithChildren,
      aggregationMethod: aggregation_method,
      isLatestAggregation,
      metricLabel,
      aggregatedMetricLabel: aggregatedMetric?.label,
      columns,
      granularity: granularity_sqla,
      tooltip_columns: sanitizedTooltipColumns,
      row_limit: baseQueryObject.row_limit,
    });

    // For staged serving-table datasets, aggregate on the backend whenever
    // possible so the map receives one row per displayed OU instead of one row
    // per raw metric value. Only "latest" keeps raw rows.
    return [
      {
        ...baseQueryObject,
        extras: dhis2QueryExtras,
        groupby: columns,
        metrics: aggregatedMetric ? [aggregatedMetric] : [],
        // Use a reasonable row limit (0 means unlimited which can cause issues)
        row_limit: baseQueryObject.row_limit || 10000,
        // Disable time range filtering if not needed for DHIS2
        time_range: baseQueryObject.time_range || 'No filter',
      },
    ];
  });
}
