/**
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

export default function buildQuery(formData: QueryFormData) {
  const fd = formData as Record<string, any>;

  return buildQueryContext(formData, baseQueryObject => {
    const query = { ...baseQueryObject } as Record<string, any>;

    // NOTE: buildQuery receives raw formData with snake_case keys (control names).
    // camelCase conversion only happens in ChartProps for transformProps.

    // ── Resolve the split column ──
    const resolvedSplitCol: string | null = fd._resolved_split_col || null;
    const manualGroupby = Array.isArray(fd.groupby) ? fd.groupby[0] : fd.groupby;
    const splitCol = resolvedSplitCol || manualGroupby || null;

    // ── Resolve X-axis column ──
    let xAxisCol = Array.isArray(fd.x_axis) ? fd.x_axis[0] : fd.x_axis;

    // For mini_map: boundary_level value is "level:columnName" (e.g. "3:district_city").
    // Extract the column name and use it as the OU disaggregation column,
    // REPLACING the manual x_axis.
    const isMiniMap = fd.mini_chart_type === 'mini_map';
    if (isMiniMap) {
      const blValue = String(fd.boundary_level || '');
      const colonIdx = blValue.indexOf(':');
      const ouCol = colonIdx >= 0 ? blValue.slice(colonIdx + 1) : null;
      if (ouCol) {
        xAxisCol = ouCol;
      }
    }

    // ── Build the columns list ──
    const columns: string[] = [];
    if (splitCol) columns.push(splitCol);
    if (xAxisCol) columns.push(xAxisCol);

    // Deduplicate
    const uniqueColumns = [...new Set(columns.filter(Boolean))];

    // If we have columns, this is a grouped query: columns are the GROUP BY
    // dimensions and metrics are the aggregations.
    if (uniqueColumns.length > 0) {
      query.columns = uniqueColumns;
    }

    return [query];
  });
}
