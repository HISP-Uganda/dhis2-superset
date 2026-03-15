import type { TooltipPayload } from '../plugin/types';

export function formatMetricValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value) >= 1_000_000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(value);
}

export function buildTooltipPayload(
  properties: Record<string, unknown> | null | undefined,
  opts: {
    metricCol?: string;
    labelCol?: string;
    categoryCol?: string;
    extraCols?: string[];
    metricLabel?: string;
  },
): TooltipPayload {
  if (!properties) return {};
  const { metricCol, labelCol, categoryCol, extraCols = [], metricLabel } = opts;
  const excludedCols = new Set([metricCol, labelCol, categoryCol, ...extraCols].filter(Boolean) as string[]);

  const payload: TooltipPayload = {};
  if (labelCol && properties[labelCol] !== undefined) {
    payload.title = String(properties[labelCol]);
  }
  if (metricCol && properties[metricCol] !== undefined) {
    payload.metricLabel = metricLabel ?? metricCol;
    payload.metricValue = formatMetricValue(properties[metricCol]);
  }
  if (categoryCol && properties[categoryCol] !== undefined) {
    payload.category = String(properties[categoryCol]);
  }

  if (extraCols.length > 0) {
    payload.fields = extraCols
      .filter(col => properties[col] !== undefined)
      .map(col => ({ label: col, value: properties[col] }));
  }

  return payload;
}
