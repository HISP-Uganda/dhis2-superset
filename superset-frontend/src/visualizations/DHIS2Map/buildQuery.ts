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
    // Find the period column name from datasource columns (marked with dhis2_is_period)
    const periodColumnName = Array.isArray(datasourceAny?.columns)
      ? (() => {
          const col = datasourceAny.columns.find((c: any) => {
            const extra = parseColumnExtra(c?.extra);
            return extra?.dhis2_is_period === true || extra?.dhis2IsPeriod === true;
          });
          return col ? String(col?.column_name || '').trim() : null;
        })()
      : null;

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
    // Get the metric - could be a string column name or a metric object.
    // Notes on the fallback chain:
    //  • column?.column_name – for simple column metrics
    //  • label – for SQL expression metrics where label carries the column name
    //    (e.g. label='SUM(malaria_cases)' → sqlAggPattern strips the wrapper)
    //  • expressionType is NOT a useful fallback ('SQL' is not a column name)
    //  • Final fallback is '' (not 'value'): 'value' is the raw PostgreSQL
    //    staging-table column that does NOT exist in DuckDB/ClickHouse serving
    //    tables.  Falling back to it generates a DuckDB Binder Error.  An empty
    //    string causes sanitizedMetric to be falsy → aggregatedMetric = undefined
    //    → safeMetrics uses COUNT(*) so the chart renders without crashing.
    let metricColumn =
      typeof metric === 'string'
        ? metric
        : (metric as any)?.column?.column_name ||
          (metric as any)?.label ||
          '';

    // Extract column name from SQL aggregate functions like SUM(column_name)
    const sqlAggPattern =
      /^(SUM|AVG|COUNT|MIN|MAX|STDDEV|VARIANCE)\s*\(\s*([^)]+)\s*\)$/i;
    const sqlMatch = metricColumn.match(sqlAggPattern);
    if (sqlMatch) {
      // Use just the column name, not the SUM() wrapper
      metricColumn = sqlMatch[2].trim();
    }

    // Sanitize the metric name to match backend column naming.
    // Guard: 'value' and 'value_numeric' are raw PostgreSQL staging-table
    // columns that do NOT exist in DuckDB/ClickHouse serving tables.  If a
    // saved chart references them on a staged-local dataset, treat the metric
    // as unset so we fall back to COUNT(*) rather than crashing with a Binder
    // Error.
    const _rawSanitized = sanitizeDHIS2ColumnName(metricColumn);
    const sanitizedMetric =
      isStagedLocalDataset &&
      (_rawSanitized === 'value' || _rawSanitized === 'value_numeric')
        ? ''
        : _rawSanitized;

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
    const isLatestAggregation =
      String(aggregation_method || '').toLowerCase() === 'latest';

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
      // Only GROUP BY up to the target hierarchy level so that SUM/AVG/etc.
      // properly aggregates leaf-level data up to the requested display level.
      // In focus mode the terminal is one level below the selected column so
      // child boundaries are visible within the focused parent.
      const terminalColumn = focusSelectedBoundaryWithChildren
        ? selectedFocusOrgUnitColumn  // one level below selected
        : sanitizedOrgUnitColumn;    // the selected display level

      if (!isLatestAggregation && terminalColumn) {
        const terminalIdx = effectiveHierarchyColumns.indexOf(terminalColumn);
        const colsToGroup =
          terminalIdx >= 0
            ? effectiveHierarchyColumns.slice(0, terminalIdx + 1)
            : effectiveHierarchyColumns;
        colsToGroup.forEach(addColumn);
      } else {
        // Latest aggregation needs all columns for client-side latest selection.
        effectiveHierarchyColumns.forEach(addColumn);
      }
    } else {
      addColumn(sanitizedOrgUnitColumn);
    }

    // Always include the period column if available so the map can show it in
    // tooltips and the user can apply period filters.
    // Use the datasource-derived period column name first; fall back to
    // granularity_sqla (user-selected time column).
    const effectivePeriodColumn = periodColumnName || (granularity_sqla ? sanitizeDHIS2ColumnName(granularity_sqla) : null);
    if (effectivePeriodColumn) {
      addColumn(effectivePeriodColumn);
    }

    // Add tooltip columns
    if (sanitizedTooltipColumns && sanitizedTooltipColumns.length > 0) {
      sanitizedTooltipColumns.forEach(addColumn);
    }

    const aggregateFunction = (() => {
      const method = String(aggregation_method || '').toLowerCase();
      switch (method) {
        case 'none':
          return null; // Special case: no aggregate wrapper
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
      (sanitizedMetric
        ? aggregateFunction
          ? `${aggregateFunction}(${sanitizedMetric})`
          : sanitizedMetric
        : undefined);
    const aggregatedMetric =
      sanitizedMetric && !isLatestAggregation
        ? {
            expressionType: 'SQL' as const,
            sqlExpression: aggregateFunction
              ? `${aggregateFunction}(${sanitizedMetric})`
              : sanitizedMetric,
            label:
              metricLabel ||
              (aggregateFunction
                ? `${aggregateFunction}(${sanitizedMetric})`
                : sanitizedMetric),
          }
        : undefined;

    // Fallback metric so the backend never receives an empty metrics array
    // (which causes a 500). When no user metric is selected we aggregate
    // a non-null constant so the GROUP BY still returns one row per OU.
    const safeMetrics = aggregatedMetric
      ? [aggregatedMetric]
      : [{ expressionType: 'SQL' as const, sqlExpression: 'COUNT(*)', label: '__count' }];

    if (isLatestAggregation) {
      // Latest needs the raw metric rows so the map can resolve the final
      // value client-side after the focused-parent filter is applied.
      addColumn(sanitizedMetric);
    }

    // When the serving table carries data at multiple OU levels (ou_level column
    // present), filter to the target level to prevent double-counting aggregation
    // across levels.
    const ouLevelColumn = Array.isArray(datasourceAny?.columns)
      ? datasourceAny.columns.find((c: any) => {
          const ex = parseColumnExtra(c?.extra);
          return ex?.dhis2_is_ou_level === true;
        })
      : null;

    const ouLevelFilter = (() => {
      if (!ouLevelColumn || !effectiveHierarchyColumns.length) return null;
      // Find the target OU level from the terminal column's extra metadata
      const terminalCol = focusSelectedBoundaryWithChildren
        ? selectedFocusOrgUnitColumn
        : sanitizedOrgUnitColumn;
      if (!terminalCol) return null;
      const colMeta = Array.isArray(datasourceAny?.columns)
        ? datasourceAny.columns.find(
            (c: any) =>
              String(c?.column_name || '').trim() === terminalCol ||
              sanitizeDHIS2ColumnName(String(c?.column_name || '').trim()) ===
                terminalCol,
          )
        : null;
      const colExtra = parseColumnExtra(colMeta?.extra);
      const targetLevel = colExtra?.dhis2_ou_level;
      if (!targetLevel || !Number.isFinite(Number(targetLevel))) return null;
      return {
        col: String(ouLevelColumn.column_name),
        op: '==' as const,
        val: Number(targetLevel),
      };
    })();

    // Build filters from the DHIS2ColumnFilterControl (dhis2_column_filters).
    // Each entry is {column: string, values: string[]} and maps to a SQL
    // WHERE col IN (...) clause.  This replaces the old dhis2_filter_periods
    // + adhoc_filters split and works for any column in the dataset.
    interface Dhis2ColFilter { column: string; values: string[] }
    const columnFilters: Dhis2ColFilter[] = Array.isArray(formDataAny?.dhis2_column_filters)
      ? (formDataAny.dhis2_column_filters as Dhis2ColFilter[]).filter(
          f => f?.column && Array.isArray(f.values) && f.values.length > 0,
        )
      : [];

    const columnExtraFilters = columnFilters.map(f => ({
      col: f.column,
      op: 'IN' as const,
      val: f.values,
    }));

    // Combine existing adhoc filters with the column filters.
    // Never let time_range through for staged local datasets: the period
    // column is a DHIS2 period string (e.g. "2024Q1"), not a SQL datetime,
    // so standard date-range SQL from the backend always fails with 500.
    const existingFilters = Array.isArray((baseQueryObject as any).filters)
      ? (baseQueryObject as any).filters
      : [];
    const combinedFilters = [
      ...existingFilters,
      ...columnExtraFilters,
      ...(ouLevelFilter ? [ouLevelFilter] : []),
    ];

    // For staged serving-table datasets, aggregate on the backend whenever
    // possible so the map receives one row per displayed OU instead of one row
    // per raw metric value. Only "latest" keeps raw rows.
    return [
      {
        ...baseQueryObject,
        extras: dhis2QueryExtras,
        groupby: columns,
        metrics: safeMetrics,
        filters: combinedFilters,
        // Use a reasonable row limit (0 means unlimited which can cause issues)
        row_limit: baseQueryObject.row_limit || 10000,
        // Period column is a DHIS2 string (e.g. "2024Q1"), NOT a SQL datetime.
        // Passing any time_range value causes the backend to generate invalid
        // date-range SQL which always results in a 500.  Use the dedicated
        // dhis2_filter_periods control instead.
        time_range: 'No filter',
      },
    ];
  });
}
