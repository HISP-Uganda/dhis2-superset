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

/**
 * Utilities for generating and importing color breakpoints.
 *
 * Three sources of breakpoints are supported:
 *  1. **Manual** — user defines each range boundary and colour individually.
 *  2. **Auto-generated** — equal-width intervals across [min, max] with a
 *     colour gradient interpolated between anchor colours.
 *  3. **DHIS2 legend set** — converts a DHIS2 `legendDefinition` object
 *     (stored in `column.extra.dhis2_legend` or fetched from the API) into
 *     breakpoints directly.
 *  4. **Health presets** — named WHO/epidemiology standard thresholds for
 *     common malaria and public-health indicators.
 */

import { ColorBreakpointType, ColorType, MinOperator, MaxOperator } from './types';

// ── Range matching ──────────────────────────────────────────────────────────────

/**
 * Return `true` when `value` falls within a breakpoint's range, respecting
 * `minOperator` (default `>=`) and `maxOperator` (default `<`).
 *
 * Open-ended ranges are supported:
 * - No `minValue` → no lower bound check.
 * - No `maxValue` → no upper bound check.
 */
export function matchesBreakpoint(value: number, bp: ColorBreakpointType): boolean {
  const minOp: MinOperator = bp.minOperator ?? '>=';
  const maxOp: MaxOperator = bp.maxOperator ?? '<';

  if (bp.minValue !== undefined && bp.minValue !== null) {
    if (minOp === '>=' && !(value >= bp.minValue)) return false;
    if (minOp === '>' && !(value > bp.minValue)) return false;
  }
  if (bp.maxValue !== undefined && bp.maxValue !== null) {
    if (maxOp === '<' && !(value < bp.maxValue)) return false;
    if (maxOp === '<=' && !(value <= bp.maxValue)) return false;
  }
  return true;
}

/**
 * Format a breakpoint's range as a human-readable string,
 * e.g. `≥0 – <25`, `≥100`, `<0`.
 */
export function formatBreakpointRange(bp: ColorBreakpointType): string {
  const minOp: MinOperator = bp.minOperator ?? '>=';
  const maxOp: MaxOperator = bp.maxOperator ?? '<';
  const minSym = minOp === '>=' ? '≥' : '>';
  const maxSym = maxOp === '<' ? '<' : '≤';

  const hasMin = bp.minValue !== undefined && bp.minValue !== null;
  const hasMax = bp.maxValue !== undefined && bp.maxValue !== null;

  if (hasMin && hasMax) return `${minSym}${bp.minValue} – ${maxSym}${bp.maxValue}`;
  if (hasMin) return `${minSym}${bp.minValue}`;
  if (hasMax) return `${maxSym}${bp.maxValue}`;
  return '∞';
}

// ── Colour helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a CSS hex colour string (``#RRGGBB`` or ``#RGB``) into an RGBA object.
 * Returns ``null`` when the string is not a valid hex colour.
 */
export function hexToRgba(hex: string): ColorType | null {
  const clean = hex.replace(/^#/, '');
  let r: number;
  let g: number;
  let b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  } else {
    return null;
  }
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b, a: 100 };
}

/**
 * Linearly interpolate between two colours at position ``t ∈ [0, 1]``.
 */
function lerpColor(from: ColorType, to: ColorType, t: number): ColorType {
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  return {
    r: lerp(from.r, to.r),
    g: lerp(from.g, to.g),
    b: lerp(from.b, to.b),
    a: lerp(from.a, to.a),
  };
}

/** One anchor in a multi-stop gradient definition. */
export interface GradientStop {
  /** Position in the range 0–1 (0 = start, 1 = end). */
  at: number;
  color: ColorType;
}

/**
 * Interpolate a multi-stop gradient at position ``t ∈ [0, 1]``.
 * Stops must be sorted ascending by ``at``.
 */
function lerpMultiStop(stops: GradientStop[], t: number): ColorType {
  if (stops.length === 1) return stops[0].color;
  // Clamp to first/last stop
  if (t <= stops[0].at) return stops[0].color;
  if (t >= stops[stops.length - 1].at) return stops[stops.length - 1].color;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (t <= s1.at) {
      const segT = (t - s0.at) / (s1.at - s0.at);
      return lerpColor(s0.color, s1.color, segT);
    }
  }
  return stops[stops.length - 1].color;
}

// ── Auto-generation gradients ──────────────────────────────────────────────────

export interface GradientPreset {
  label: string;
  stops: GradientStop[];
}

/**
 * Named gradient presets for auto-generation.
 * Each entry defines a multi-stop colour gradient (2–5 stops).
 * Stops must be listed in ascending ``at`` order.
 */
export const GRADIENT_PRESETS: Record<string, GradientPreset> = {
  // ── Traffic-light / epidemiology ──────────────────────────────────────────
  'green-yellow-red': {
    label: 'Green → Yellow → Red (traffic light)',
    stops: [
      { at: 0,   color: { r: 26,  g: 152, b: 80,  a: 100 } }, // green
      { at: 0.5, color: { r: 253, g: 174, b: 97,  a: 100 } }, // orange-yellow
      { at: 1,   color: { r: 215, g: 48,  b: 39,  a: 100 } }, // red
    ],
  },
  'red-yellow-green': {
    label: 'Red → Yellow → Green (inverse: higher is better)',
    stops: [
      { at: 0,   color: { r: 215, g: 48,  b: 39,  a: 100 } }, // red
      { at: 0.5, color: { r: 253, g: 174, b: 97,  a: 100 } }, // orange-yellow
      { at: 1,   color: { r: 26,  g: 152, b: 80,  a: 100 } }, // green
    ],
  },
  // ── Sequential — cases/incidence intensity ────────────────────────────────
  'white-orange-red': {
    label: 'White → Orange → Dark Red (incidence)',
    stops: [
      { at: 0,    color: { r: 255, g: 245, b: 235, a: 100 } }, // near-white
      { at: 0.45, color: { r: 253, g: 141, b: 60,  a: 100 } }, // orange
      { at: 1,    color: { r: 127, g: 0,   b: 0,   a: 100 } }, // dark red
    ],
  },
  'white-blue': {
    label: 'White → Dark Blue (intensity)',
    stops: [
      { at: 0, color: { r: 247, g: 251, b: 255, a: 100 } },
      { at: 1, color: { r: 8,   g: 48,  b: 107, a: 100 } },
    ],
  },
  'white-green': {
    label: 'White → Dark Green (coverage)',
    stops: [
      { at: 0, color: { r: 247, g: 252, b: 245, a: 100 } },
      { at: 1, color: { r: 0,   g: 68,  b: 27,  a: 100 } },
    ],
  },
  // ── Diverging ─────────────────────────────────────────────────────────────
  'blue-white-red': {
    label: 'Blue → White → Red (diverging: below / above target)',
    stops: [
      { at: 0,    color: { r: 49,  g: 130, b: 189, a: 100 } }, // blue
      { at: 0.5,  color: { r: 245, g: 245, b: 245, a: 100 } }, // white
      { at: 1,    color: { r: 215, g: 25,  b: 28,  a: 100 } }, // red
    ],
  },
  // ── Legacy 2-stop presets (kept for compatibility) ────────────────────────
  'blue-red': {
    label: 'Blue → Red',
    stops: [
      { at: 0, color: { r: 44,  g: 123, b: 182, a: 100 } },
      { at: 1, color: { r: 215, g: 25,  b: 28,  a: 100 } },
    ],
  },
  'green-red': {
    label: 'Green → Red',
    stops: [
      { at: 0, color: { r: 26,  g: 152, b: 80, a: 100 } },
      { at: 1, color: { r: 215, g: 48,  b: 39, a: 100 } },
    ],
  },
  'yellow-red': {
    label: 'Yellow → Red (heatmap)',
    stops: [
      { at: 0, color: { r: 255, g: 255, b: 178, a: 100 } },
      { at: 1, color: { r: 189, g: 0,   b: 38,  a: 100 } },
    ],
  },
};

export const DEFAULT_GRADIENT = 'green-yellow-red';

/**
 * Generate ``count`` equal-width colour breakpoints spanning [``min``, ``max``].
 *
 * Colours are interpolated through the multi-stop gradient defined by
 * ``gradientKey``.  When ``count`` is 1 the single range covers the full
 * [min, max] span and uses the first gradient stop colour.
 *
 * Validates inputs and returns ``null`` with a human-readable error when they
 * are invalid.
 */
export function generateEqualBreakpoints(
  count: number,
  min: number,
  max: number,
  gradientKey: string = DEFAULT_GRADIENT,
): { breakpoints: ColorBreakpointType[]; error: null } | { breakpoints: null; error: string } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { breakpoints: null, error: 'Min and Max must be finite numbers.' };
  }
  if (min >= max) {
    return { breakpoints: null, error: 'Min must be strictly less than Max.' };
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    return { breakpoints: null, error: 'Count must be an integer between 1 and 20.' };
  }

  const preset = GRADIENT_PRESETS[gradientKey] ?? GRADIENT_PRESETS[DEFAULT_GRADIENT];
  const step = (max - min) / count;
  const breakpoints: ColorBreakpointType[] = [];

  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    breakpoints.push({
      id: i,
      minValue: parseFloat((min + i * step).toFixed(6)),
      minOperator: '>=',
      maxValue: parseFloat((min + (i + 1) * step).toFixed(6)),
      // Last bucket is inclusive on the upper bound so the max value itself
      // is captured; all others are exclusive to avoid double-counting at
      // shared boundaries (e.g. 0–25, 25–50 pattern).
      maxOperator: i === count - 1 ? '<=' : '<',
      color: lerpMultiStop(preset.stops, t),
    });
  }

  return { breakpoints, error: null };
}

// ── Health / epidemiology preset breakpoints ───────────────────────────────────

export interface HealthPreset {
  label: string;
  description: string;
  breakpoints: Array<Omit<ColorBreakpointType, 'id'>>;
}

/**
 * Named preset breakpoint sets for common public-health and malaria indicators.
 * These encode WHO/international standard thresholds and use internationally
 * recognised colour conventions (red = bad, green = good).
 *
 * Apply via `getHealthPresetBreakpoints(key)`.
 */
export const HEALTH_PRESETS: Record<string, HealthPreset> = {
  'malaria-positivity': {
    label: 'Malaria Test Positivity Rate (%)',
    description: 'WHO thresholds: <5% low, 5–15% moderate, 15–35% high, ≥35% very high',
    breakpoints: [
      { minValue: 0,  minOperator: '>=', maxValue: 5,  maxOperator: '<', color: { r: 26,  g: 152, b: 80,  a: 100 } }, // green
      { minValue: 5,  minOperator: '>=', maxValue: 15, maxOperator: '<', color: { r: 253, g: 174, b: 97,  a: 100 } }, // yellow-orange
      { minValue: 15, minOperator: '>=', maxValue: 35, maxOperator: '<', color: { r: 215, g: 48,  b: 39,  a: 100 } }, // red
      { minValue: 35, minOperator: '>=', maxValue: undefined, maxOperator: '<', color: { r: 128, g: 0, b: 38, a: 100 } }, // dark red
    ],
  },
  'malaria-incidence': {
    label: 'Malaria Incidence (per 1,000 population)',
    description: 'WHO elimination ladder: <1 pre-elimination, 1–10 low, 10–100 moderate, ≥100 high',
    breakpoints: [
      { minValue: 0,   minOperator: '>=', maxValue: 1,   maxOperator: '<', color: { r: 26,  g: 152, b: 80,  a: 100 } }, // green
      { minValue: 1,   minOperator: '>=', maxValue: 10,  maxOperator: '<', color: { r: 166, g: 217, b: 106, a: 100 } }, // light green
      { minValue: 10,  minOperator: '>=', maxValue: 100, maxOperator: '<', color: { r: 253, g: 174, b: 97,  a: 100 } }, // orange
      { minValue: 100, minOperator: '>=', maxValue: undefined, maxOperator: '<', color: { r: 215, g: 48, b: 39, a: 100 } }, // red
    ],
  },
  'coverage-rate': {
    label: 'Coverage / Completion Rate (%)',
    description: 'Standard tiers: <50% critical, 50–80% low, 80–100% adequate, >100% over-target',
    breakpoints: [
      { minValue: 0,   minOperator: '>=', maxValue: 50,  maxOperator: '<', color: { r: 215, g: 48,  b: 39,  a: 100 } }, // red
      { minValue: 50,  minOperator: '>=', maxValue: 80,  maxOperator: '<', color: { r: 253, g: 174, b: 97,  a: 100 } }, // orange
      { minValue: 80,  minOperator: '>=', maxValue: 100, maxOperator: '<', color: { r: 26,  g: 152, b: 80,  a: 100 } }, // green
      { minValue: 100, minOperator: '>=', maxValue: undefined, maxOperator: '<', color: { r: 49, g: 130, b: 189, a: 100 } }, // blue (over-target)
    ],
  },
  'itn-coverage': {
    label: 'ITN / LLIN Coverage (%)',
    description: 'Net distribution targets: <40% very low, 40–60% low, 60–80% moderate, ≥80% high',
    breakpoints: [
      { minValue: 0,  minOperator: '>=', maxValue: 40, maxOperator: '<', color: { r: 215, g: 48, b: 39,  a: 100 } }, // red
      { minValue: 40, minOperator: '>=', maxValue: 60, maxOperator: '<', color: { r: 253, g: 174, b: 97, a: 100 } }, // orange
      { minValue: 60, minOperator: '>=', maxValue: 80, maxOperator: '<', color: { r: 166, g: 217, b: 106, a: 100 } }, // light green
      { minValue: 80, minOperator: '>=', maxValue: 100, maxOperator: '<=', color: { r: 26, g: 152, b: 80, a: 100 } }, // green
    ],
  },
  'stock-months': {
    label: 'Stock Coverage (Months of Stock)',
    description: 'Supply chain: <1 stockout risk, 1–3 low, 3–6 adequate, >6 overstock',
    breakpoints: [
      { minValue: undefined, minOperator: '>=', maxValue: 1, maxOperator: '<', color: { r: 215, g: 48, b: 39, a: 100 } }, // red
      { minValue: 1, minOperator: '>=', maxValue: 3, maxOperator: '<', color: { r: 253, g: 174, b: 97, a: 100 } }, // orange
      { minValue: 3, minOperator: '>=', maxValue: 6, maxOperator: '<', color: { r: 26, g: 152, b: 80, a: 100 } }, // green
      { minValue: 6, minOperator: '>=', maxValue: undefined, maxOperator: '<', color: { r: 49, g: 130, b: 189, a: 100 } }, // blue (overstock)
    ],
  },
  'mortality-rate': {
    label: 'Mortality / Case Fatality Rate (%)',
    description: 'CFR tiers: <0.5% low, 0.5–2% moderate, 2–5% high, ≥5% severe',
    breakpoints: [
      { minValue: 0,   minOperator: '>=', maxValue: 0.5, maxOperator: '<', color: { r: 26,  g: 152, b: 80,  a: 100 } }, // green
      { minValue: 0.5, minOperator: '>=', maxValue: 2,   maxOperator: '<', color: { r: 253, g: 174, b: 97,  a: 100 } }, // orange
      { minValue: 2,   minOperator: '>=', maxValue: 5,   maxOperator: '<', color: { r: 215, g: 48,  b: 39,  a: 100 } }, // red
      { minValue: 5,   minOperator: '>=', maxValue: undefined, maxOperator: '<', color: { r: 128, g: 0, b: 38, a: 100 } }, // dark red
    ],
  },
  'irs-coverage': {
    label: 'IRS / Vector Control Coverage (%)',
    description: 'Spray coverage: <50% inadequate, 50–75% partial, 75–85% target, >85% optimal',
    breakpoints: [
      { minValue: 0,  minOperator: '>=', maxValue: 50, maxOperator: '<', color: { r: 215, g: 48, b: 39,  a: 100 } }, // red
      { minValue: 50, minOperator: '>=', maxValue: 75, maxOperator: '<', color: { r: 253, g: 174, b: 97, a: 100 } }, // orange
      { minValue: 75, minOperator: '>=', maxValue: 85, maxOperator: '<', color: { r: 26, g: 152, b: 80,  a: 100 } }, // green
      { minValue: 85, minOperator: '>=', maxValue: 100, maxOperator: '<=', color: { r: 0, g: 104, b: 55, a: 100 } }, // dark green
    ],
  },
};

/**
 * Return a full `ColorBreakpointType[]` for a named health preset,
 * with sequential ``id`` fields assigned.
 */
export function getHealthPresetBreakpoints(key: string): ColorBreakpointType[] | null {
  const preset = HEALTH_PRESETS[key];
  if (!preset) return null;
  return preset.breakpoints.map((bp, idx) => ({ ...bp, id: idx }));
}

// ── DHIS2 legend-set import ────────────────────────────────────────────────────

/** Shape of a single item inside a DHIS2 ``legendDefinition``. */
export interface DHIS2LegendItem {
  startValue?: number;
  endValue?: number;
  color?: string;
  name?: string;
}

/** Shape of the ``dhis2_legend`` stored in ``column.extra``. */
export interface DHIS2LegendDefinition {
  items?: DHIS2LegendItem[];
  /** Optional human-readable legend set name. */
  name?: string;
}

/**
 * Convert a DHIS2 ``legendDefinition`` (from ``column.extra.dhis2_legend`` or
 * the staged legend-sets API) into Superset ``ColorBreakpointType`` items,
 * ready for insertion into the breakpoints control.
 *
 * Items with missing or non-numeric boundaries are silently skipped.
 * Returns ``{ breakpoints: null, error }`` when the input is malformed or
 * produces no usable items.
 */
export function importDHIS2Legend(
  legendDefinition: DHIS2LegendDefinition | null | undefined,
): { breakpoints: ColorBreakpointType[]; error: null } | { breakpoints: null; error: string } {
  if (!legendDefinition) {
    return { breakpoints: null, error: 'No DHIS2 legend definition available.' };
  }
  const items = legendDefinition.items ?? [];
  if (!items.length) {
    return { breakpoints: null, error: 'DHIS2 legend has no items.' };
  }

  const breakpoints: ColorBreakpointType[] = [];
  items.forEach((item, idx) => {
    const minValue = Number(item.startValue);
    const maxValue = Number(item.endValue);
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return;

    const color = item.color ? hexToRgba(item.color) : null;
    if (!color) return;

    breakpoints.push({
      id: idx,
      minValue,
      minOperator: '>=',
      maxValue,
      maxOperator: '<',
      color,
    });
  });

  if (!breakpoints.length) {
    return {
      breakpoints: null,
      error:
        'Could not convert any DHIS2 legend items — ' +
        'check that all items have valid numeric boundaries and hex colours.',
    };
  }
  return { breakpoints, error: null };
}
