import { QueryData } from '@superset-ui/core';
import {
  ChartInsightContext,
  DashboardInsightContext,
  QueryDataLike,
  QueryResponseSummary,
} from './types';

const DEFAULT_MAX_ROWS = 15;
const DEFAULT_MAX_COLUMNS = 20;
const DEFAULT_MAX_DASHBOARD_CHARTS = 12;

/**
 * Semantic form_data keys that are analytically meaningful.
 * UI-styling keys (colors, label formats, legend settings, etc.)
 * are stripped to save tokens.
 */
const FORM_DATA_KEEP_KEYS = new Set([
  'datasource',
  'viz_type',
  'metrics',
  'metric',
  'percent_metrics',
  'groupby',
  'columns',
  'all_columns',
  'order_by_cols',
  'row_limit',
  'time_range',
  'granularity_sqla',
  'time_grain_sqla',
  'adhoc_filters',
  'where',
  'having',
  'order_desc',
  'contribution',
  'series',
  'entity',
  'x_axis',
  'query_mode',
  'include_time',
]);

function pruneFormData(
  formData?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!formData) return undefined;
  const pruned: Record<string, unknown> = {};
  Object.keys(formData).forEach(key => {
    if (FORM_DATA_KEEP_KEYS.has(key)) {
      pruned[key] = formData[key];
    }
  });
  return pruned;
}

function getSampleRows(
  queryResponse: QueryDataLike,
  columns: string[],
  maxRows = DEFAULT_MAX_ROWS,
): Record<string, unknown>[] {
  const data = Array.isArray((queryResponse as QueryData | undefined)?.data)
    ? ((queryResponse as QueryData).data as Record<string, unknown>[])
    : [];

  return data.slice(0, maxRows).map(row =>
    columns.reduce<Record<string, unknown>>((acc, column) => {
      acc[column] = row?.[column];
      return acc;
    }, {}),
  );
}

export function buildQueryResponseSummary(
  queryResponse: QueryDataLike,
  maxRows = DEFAULT_MAX_ROWS,
  maxColumns = DEFAULT_MAX_COLUMNS,
): QueryResponseSummary {
  const typedResponse = (queryResponse || {}) as QueryData;
  const columns =
    (Array.isArray(typedResponse.colnames) ? typedResponse.colnames : []) ||
    [];
  const trimmedColumns = columns.slice(0, maxColumns);

  const summary: QueryResponseSummary = {
    row_count: Number(
      typedResponse.rowcount ??
        typedResponse.sql_rowcount ??
        typedResponse.data?.length ??
        0,
    ),
    columns: trimmedColumns,
    sample_rows: getSampleRows(typedResponse, trimmedColumns, maxRows),
    applied_filters: typedResponse.applied_filters,
    rejected_filters: typedResponse.rejected_filters,
    error: typedResponse.error || null,
  };

  // Drop empty filter arrays to save tokens
  if (
    !summary.applied_filters ||
    (Array.isArray(summary.applied_filters) &&
      summary.applied_filters.length === 0)
  ) {
    delete (summary as Record<string, unknown>).applied_filters;
  }
  if (
    !summary.rejected_filters ||
    (Array.isArray(summary.rejected_filters) &&
      summary.rejected_filters.length === 0)
  ) {
    delete (summary as Record<string, unknown>).rejected_filters;
  }
  if (!summary.error) {
    delete (summary as Record<string, unknown>).error;
  }
  return summary;
}

export function buildChartInsightContext(input: {
  chartId?: number;
  sliceName?: string;
  vizType?: string;
  formData?: Record<string, unknown>;
  datasource?: unknown;
  queryResponse?: QueryDataLike;
}): ChartInsightContext {
  return {
    chart: {
      id: input.chartId,
      name: input.sliceName,
      viz_type: input.vizType,
      form_data: pruneFormData(input.formData),
    },
    datasource: input.datasource,
    query_result: buildQueryResponseSummary(input.queryResponse),
  };
}

export function buildDashboardInsightContext(input: {
  dashboardId?: number | string;
  dashboardTitle?: string;
  activeFilters?: unknown;
  charts: Array<{
    id?: number;
    slice_name?: string;
    viz_type?: string;
    form_data?: Record<string, unknown>;
    datasource?: unknown;
    queryResponse?: QueryDataLike;
  }>;
}): DashboardInsightContext {
  // Limit the number of charts sent to the AI to save tokens
  const limitedCharts = input.charts.slice(0, DEFAULT_MAX_DASHBOARD_CHARTS);

  return {
    dashboard: {
      id: input.dashboardId,
      title: input.dashboardTitle,
      active_filters: input.activeFilters,
    },
    charts: limitedCharts.map(chart =>
      buildChartInsightContext({
        chartId: chart.id,
        sliceName: chart.slice_name,
        vizType: chart.viz_type,
        formData: chart.form_data,
        datasource: chart.datasource,
        queryResponse: chart.queryResponse,
      }),
    ),
  };
}

