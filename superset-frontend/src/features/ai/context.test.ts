import {
  buildChartInsightContext,
  buildDashboardInsightContext,
  buildQueryResponseSummary,
} from './context';

describe('AI insight context helpers', () => {
  test('buildQueryResponseSummary trims rows and columns and preserves filter metadata', () => {
    const summary = buildQueryResponseSummary(
      {
        rowcount: 3,
        colnames: ['region', 'metric', 'period'],
        data: [
          { region: 'Kampala', metric: 10, period: '2026Q1', ignored: 'x' },
          { region: 'Gulu', metric: 8, period: '2026Q1', ignored: 'y' },
          { region: 'Lira', metric: 7, period: '2026Q1', ignored: 'z' },
        ],
        applied_filters: [{ column: 'period', op: 'IN' }],
        rejected_filters: [],
      },
      2,
      2,
    );

    expect(summary).toEqual({
      row_count: 3,
      columns: ['region', 'metric'],
      sample_rows: [
        { region: 'Kampala', metric: 10 },
        { region: 'Gulu', metric: 8 },
      ],
      applied_filters: [{ column: 'period', op: 'IN' }],
      rejected_filters: [],
      error: null,
    });
  });

  test('buildChartInsightContext keeps chart metadata and query summary', () => {
    const context = buildChartInsightContext({
      chartId: 12,
      sliceName: 'Admissions by region',
      vizType: 'echarts_timeseries_bar',
      formData: { groupby: ['region'] },
      datasource: { id: 7, table_name: 'admissions_mart' },
      queryResponse: {
        rowcount: 1,
        colnames: ['region', 'value'],
        data: [{ region: 'Kampala', value: 12 }],
      },
    });

    expect(context.chart).toEqual({
      id: 12,
      name: 'Admissions by region',
      viz_type: 'echarts_timeseries_bar',
      form_data: { groupby: ['region'] },
    });
    expect(context.datasource).toEqual({ id: 7, table_name: 'admissions_mart' });
    expect(context.query_result.sample_rows).toEqual([
      { region: 'Kampala', value: 12 },
    ]);
  });

  test('buildDashboardInsightContext maps all charts into chart contexts', () => {
    const context = buildDashboardInsightContext({
      dashboardId: 22,
      dashboardTitle: 'MART dashboard',
      activeFilters: { period: '2026Q1' },
      charts: [
        {
          id: 10,
          slice_name: 'Admissions',
          viz_type: 'table',
          form_data: { metrics: ['sum__admissions'] },
          queryResponse: {
            rowcount: 1,
            colnames: ['region', 'value'],
            data: [{ region: 'Kampala', value: 85125 }],
          },
        },
      ],
    });

    expect(context.dashboard).toEqual({
      id: 22,
      title: 'MART dashboard',
      active_filters: { period: '2026Q1' },
    });
    expect(context.charts).toHaveLength(1);
    expect(context.charts[0].chart.name).toBe('Admissions');
    expect(context.charts[0].query_result.row_count).toBe(1);
  });
});
