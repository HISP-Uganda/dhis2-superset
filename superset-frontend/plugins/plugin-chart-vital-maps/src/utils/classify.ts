export function quantileBreaks(values: number[], nClasses: number): number[] {
  if (!values || values.length === 0 || nClasses < 2) return [];
  const sorted = [...values].filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const breaks: number[] = [];
  for (let i = 1; i < nClasses; i++) {
    const idx = (i / nClasses) * sorted.length;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const val = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    breaks.push(val);
  }
  breaks.push(sorted[sorted.length - 1]);
  return [...new Set(breaks)];
}

export function equalIntervalBreaks(values: number[], nClasses: number): number[] {
  if (!values || values.length === 0 || nClasses < 2) return [];
  const finite = values.filter(v => Number.isFinite(v));
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return [max];
  const step = (max - min) / nClasses;
  const breaks: number[] = [];
  for (let i = 1; i <= nClasses; i++) {
    breaks.push(min + step * i);
  }
  return breaks;
}

export function parseManualBreaks(raw: string): number[] | null {
  if (!raw || !raw.trim()) return null;
  const parts = raw.split(',').map(s => s.trim());
  const nums = parts.map(Number);
  if (nums.some(n => !Number.isFinite(n))) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted;
}

export function validateManualBreaks(raw: string): boolean {
  return parseManualBreaks(raw) !== null;
}

export function extractCategories(
  rows: Record<string, unknown>[],
  col: string,
): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const val = row[col];
    if (val !== null && val !== undefined) {
      seen.add(String(val));
    }
  }
  return Array.from(seen).sort();
}

export function assignClass(value: number, breaks: number[]): number {
  if (!breaks || breaks.length === 0) return 0;
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]) return i;
  }
  return breaks.length - 1;
}
