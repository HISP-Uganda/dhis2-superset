import type { LegendItem, LegendModel } from '../plugin/types';
import { DEFAULT_NO_DATA_COLOR } from '../constants/defaults';

function formatBreakLabel(min: number, max: number): string {
  const fmt = (v: number) =>
    Math.abs(v) >= 1000
      ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : v.toLocaleString(undefined, { maximumSignificantDigits: 3 });
  return `${fmt(min)} – ${fmt(max)}`;
}

export function buildClassedLegend(
  breaks: number[],
  colors: string[],
  title?: string,
): LegendModel {
  if (!breaks || breaks.length === 0 || !colors || colors.length === 0) {
    return { type: 'classed', items: [], title };
  }
  const items: LegendItem[] = [];
  let prev = -Infinity;
  for (let i = 0; i < breaks.length; i++) {
    const curr = breaks[i];
    items.push({
      label: formatBreakLabel(prev === -Infinity ? breaks[0] - 1 : prev, curr),
      color: colors[i] ?? colors[colors.length - 1],
      valueMin: prev,
      valueMax: curr,
    });
    prev = curr;
  }
  return { type: 'classed', title, items };
}

export function buildCategoricalLegend(
  categories: string[],
  colors: string[],
  title?: string,
): LegendModel {
  const items: LegendItem[] = categories.map((cat, i) => ({
    label: cat,
    color: colors[i % colors.length],
  }));
  return { type: 'categorical', title, items };
}

export function buildNoDataItem(): LegendItem {
  return {
    label: 'No data',
    color: DEFAULT_NO_DATA_COLOR,
    isNoData: true,
  };
}

export function addNoDataItem(model: LegendModel): LegendModel {
  return { ...model, items: [...model.items, buildNoDataItem()] };
}
