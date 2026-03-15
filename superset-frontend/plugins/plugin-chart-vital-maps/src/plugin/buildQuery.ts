import { buildQueryContext, QueryFormData } from '@superset-ui/core';

export default function buildQuery(formData: QueryFormData) {
  const { metric, lat_col, lon_col, geometry_col, label_col, category_col, tooltip_cols = [] } = formData as Record<string, any>;

  const columns = [lat_col, lon_col, geometry_col, label_col, category_col, ...tooltip_cols]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  return buildQueryContext(formData, params => [
    {
      ...params[0],
      metrics: metric ? [metric] : [],
      columns,
      orderby: [],
      row_limit: (formData as any).row_limit ?? 50000,
    },
  ]);
}
