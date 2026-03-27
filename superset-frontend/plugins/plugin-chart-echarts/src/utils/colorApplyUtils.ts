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
 * Shared colour-application helpers used by ECharts chart transformProps.
 *
 * Three colour modes are supported:
 *  - `'metric'`      — fixed colour per series label (MetricColorControl)
 *  - `'breakpoints'` — value-range colours (ColorBreakpointsControl)
 *  - `'default'`     — no overrides, use the chart's colour scheme
 *
 * When `colorMode` is not set (legacy/undefined), both metric colours and
 * breakpoints may apply simultaneously; breakpoints win on a per-data-point
 * basis because they are set at the highest ECharts priority level.
 */

import { matchesBreakpoint } from 'src/explore/components/controls/ColorBreakpointsControl/colorBreakpointUtils';

/** RGBA colour object as stored by ColorPickerControl and ColorBreakpointsControl. */
export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  /** Alpha in [0, 100] — 0 = fully transparent. */
  a: number;
}

/**
 * Apply per-metric fixed colour overrides to series `itemStyle`.
 * Colours are stored as hex strings in `metricColorsMap` keyed by series name.
 * Mutates `series` in-place.
 */
export function applyMetricColors(
  series: any[],
  metricColorsMap: Record<string, string>,
): void {
  series.forEach(s => {
    const hex: string | undefined = s.name
      ? metricColorsMap[s.name]
      : undefined;
    if (hex) {
      s.itemStyle = { ...(s.itemStyle ?? {}), color: hex };
    }
  });
}

/**
 * Apply `colorBreakpoints` per data-point (highest ECharts rendering priority).
 *
 * For data points that match a breakpoint the matching colour is applied via
 * `itemStyle.color` on the individual data item, which overrides any
 * series-level `itemStyle.color` set by `applyMetricColors`.
 *
 * For data points that match no breakpoint, `defaultColor` is applied when
 * its alpha channel is > 0 (a fully-transparent default = "no override").
 *
 * @param series        ECharts series array (mutated in-place).
 * @param breakpoints   Array of `ColorBreakpointType`-shaped objects.
 * @param defaultColor  Fallback colour for unmatched values; pass `undefined`
 *                      or an object with `a === 0` to leave unmatched points
 *                      at their series colour.
 * @param isHorizontal  When `true` the value axis is at index 0 (horizontal
 *                      bar); when `false` it is at index 1 (vertical/default).
 */
export function applyColorBreakpoints(
  series: any[],
  breakpoints: any[],
  defaultColor: RgbaColor | undefined,
  isHorizontal: boolean,
): void {
  const valueIndex = isHorizontal ? 0 : 1;
  const hasDefault =
    defaultColor != null &&
    typeof defaultColor.a === 'number' &&
    defaultColor.a > 0;
  const defaultCss = hasDefault
    ? `rgba(${defaultColor!.r},${defaultColor!.g},${defaultColor!.b},1)`
    : undefined;

  series.forEach(s => {
    if (!Array.isArray(s.data)) return;
    s.data = s.data.map((point: any) => {
      // Data items are either [x, y] arrays or { value: [x, y], ... } objects.
      const raw: any[] | null = Array.isArray(point)
        ? point
        : Array.isArray(point?.value)
        ? point.value
        : null;
      if (!raw) return point;

      const val = raw[valueIndex];
      if (val === null || val === undefined || typeof val !== 'number') return point;

      const bp = breakpoints.find(b => matchesBreakpoint(val, b));
      const color: string | undefined = bp?.color
        ? `rgba(${bp.color.r},${bp.color.g},${bp.color.b},1)`
        : defaultCss;

      if (!color) return point;

      if (Array.isArray(point)) {
        // Wrap bare array into an object so we can attach itemStyle.
        return { value: point, itemStyle: { color } };
      }
      return { ...point, itemStyle: { ...(point.itemStyle ?? {}), color } };
    });
  });
}
