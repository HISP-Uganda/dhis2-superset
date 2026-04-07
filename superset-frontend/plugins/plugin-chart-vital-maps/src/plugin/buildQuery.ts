import { buildQueryContext, QueryFormData } from '@superset-ui/core';

export default function buildQuery(formData: QueryFormData) {
  const fd = formData as Record<string, any>;
  const { metric, lat_col, lon_col, geometry_col, label_col, category_col, icon_col, tooltip_cols = [] } = fd;

  // Collect columns from both explicit role assignments and the all_columns multi-select
  const roleColumns: string[] = [lat_col, lon_col, geometry_col, label_col, category_col, icon_col, ...tooltip_cols]
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

  const allColumns: string[] = Array.isArray(fd.all_columns) ? fd.all_columns : [];

  // Merge: all_columns provides the base set, role columns add any that were missed
  const columns = [...new Set([...allColumns, ...roleColumns])];

  const metrics = metric ? [metric] : [];

  return buildQueryContext(formData, baseParams => {
    const base = baseParams[0] as Record<string, any>;

    // Superset requires at least one column or metric to build a valid SQL query.
    // If user hasn't configured any columns yet, request a simple COUNT(*) so the
    // query remains valid and the chart shows a placeholder instead of an error.
    if (columns.length === 0 && metrics.length === 0) {
      return [
        {
          ...base,
          metrics: [{
            expressionType: 'SQL',
            sqlExpression: 'COUNT(*)',
            label: 'count',
          }],
          columns: [],
          orderby: [],
          row_limit: 1,
        },
      ];
    }

    return [
      {
        ...base,
        metrics,
        columns,
        orderby: [],
        row_limit: fd.row_limit ?? 50000,
      },
    ];
  });
}
