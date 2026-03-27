import { QueryData } from '@superset-ui/core';
import {
  ChartInsightContext,
  DashboardInsightContext,
  QueryDataLike,
  QueryResponseSummary,
} from './types';

const DEFAULT_MAX_ROWS = 20;
const DEFAULT_MAX_COLUMNS = 25;

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

  return {
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
      form_data: input.formData,
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
  return {
    dashboard: {
      id: input.dashboardId,
      title: input.dashboardTitle,
      active_filters: input.activeFilters,
    },
    charts: input.charts.map(chart =>
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

