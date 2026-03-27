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

import { applyMetricColors, applyColorBreakpoints } from '../../src/utils/colorApplyUtils';

// ── applyMetricColors ─────────────────────────────────────────────────────────

describe('applyMetricColors', () => {
  it('sets itemStyle.color on matching series', () => {
    const series = [{ name: 'Tests', data: [] }, { name: 'Positives', data: [] }];
    applyMetricColors(series, { Tests: '#ff0000', Positives: '#00ff00' });
    expect((series[0] as any).itemStyle.color).toBe('#ff0000');
    expect((series[1] as any).itemStyle.color).toBe('#00ff00');
  });

  it('preserves existing itemStyle properties', () => {
    const series = [{ name: 'Deaths', data: [], itemStyle: { opacity: 0.8 } }];
    applyMetricColors(series, { Deaths: '#123456' });
    expect((series[0] as any).itemStyle.opacity).toBe(0.8);
    expect((series[0] as any).itemStyle.color).toBe('#123456');
  });

  it('skips series not in the map', () => {
    const series = [{ name: 'Unknown', data: [] }];
    applyMetricColors(series, { Tests: '#ff0000' });
    expect((series[0] as any).itemStyle).toBeUndefined();
  });

  it('skips series with no name', () => {
    const series = [{ data: [] }];
    applyMetricColors(series, { Tests: '#ff0000' });
    expect((series[0] as any).itemStyle).toBeUndefined();
  });

  it('does not throw on empty series', () => {
    expect(() => applyMetricColors([], { Tests: '#red' })).not.toThrow();
  });
});

// ── applyColorBreakpoints ─────────────────────────────────────────────────────

const GREEN = { r: 26, g: 152, b: 80, a: 100 };
const RED = { r: 215, g: 48, b: 39, a: 100 };
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

const BREAKPOINTS = [
  { id: 0, minValue: 0, minOperator: '>=', maxValue: 50, maxOperator: '<', color: GREEN },
  { id: 1, minValue: 50, minOperator: '>=', maxValue: undefined, maxOperator: '<', color: RED },
];

function makeVerticalSeries(values: (number | null)[]) {
  return [
    {
      name: 'Metric',
      data: values.map(v => [Date.now(), v]),
    },
  ];
}

describe('applyColorBreakpoints — basic matching', () => {
  it('applies green to values < 50', () => {
    const series = makeVerticalSeries([25]);
    applyColorBreakpoints(series, BREAKPOINTS, undefined, false);
    const point = (series[0] as any).data[0];
    expect(point.itemStyle.color).toBe('rgba(26,152,80,1)');
  });

  it('applies red to values >= 50', () => {
    const series = makeVerticalSeries([75]);
    applyColorBreakpoints(series, BREAKPOINTS, undefined, false);
    const point = (series[0] as any).data[0];
    expect(point.itemStyle.color).toBe('rgba(215,48,39,1)');
  });

  it('wraps bare array into object with itemStyle', () => {
    const series = makeVerticalSeries([25]);
    applyColorBreakpoints(series, BREAKPOINTS, undefined, false);
    const point = (series[0] as any).data[0];
    // Original point was [timestamp, 25]; it should now be { value: [...], itemStyle: {...} }
    expect(Array.isArray(point)).toBe(false);
    expect(Array.isArray(point.value)).toBe(true);
    expect(point.value[1]).toBe(25);
  });

  it('leaves null values unchanged', () => {
    const series = makeVerticalSeries([null]);
    applyColorBreakpoints(series, BREAKPOINTS, undefined, false);
    const point = (series[0] as any).data[0];
    // null value — still a bare array, no itemStyle added
    expect(Array.isArray(point)).toBe(true);
  });

  it('does not apply colour when no breakpoint matches and no default', () => {
    const series = makeVerticalSeries([-10]);
    applyColorBreakpoints(series, BREAKPOINTS, undefined, false);
    const point = (series[0] as any).data[0];
    // -10 is below the first breakpoint (minValue 0 with >=), so no match
    expect(Array.isArray(point)).toBe(true);
    expect((point as any).itemStyle).toBeUndefined();
  });
});

describe('applyColorBreakpoints — defaultColor', () => {
  it('applies defaultColor to unmatched values when alpha > 0', () => {
    const series = makeVerticalSeries([-10]);
    applyColorBreakpoints(series, BREAKPOINTS, { r: 100, g: 100, b: 100, a: 50 }, false);
    const point = (series[0] as any).data[0];
    expect(point.itemStyle.color).toBe('rgba(100,100,100,1)');
  });

  it('does not apply defaultColor when alpha === 0 (transparent)', () => {
    const series = makeVerticalSeries([-10]);
    applyColorBreakpoints(series, BREAKPOINTS, TRANSPARENT, false);
    const point = (series[0] as any).data[0];
    expect(Array.isArray(point)).toBe(true);
  });

  it('does not apply defaultColor when defaultColor is undefined', () => {
    const series = makeVerticalSeries([-10]);
    applyColorBreakpoints(series, BREAKPOINTS, undefined, false);
    const point = (series[0] as any).data[0];
    expect(Array.isArray(point)).toBe(true);
  });
});

describe('applyColorBreakpoints — horizontal orientation', () => {
  it('reads value from index 0 for horizontal charts', () => {
    // Horizontal: data is [value, category], so index 0 is the value axis
    const series = [
      {
        name: 'Metric',
        data: [[25, 'Category A']],
      },
    ];
    applyColorBreakpoints(series, BREAKPOINTS, undefined, true);
    const point = (series[0] as any).data[0];
    expect(point.itemStyle.color).toBe('rgba(26,152,80,1)'); // 25 matches green
  });
});

describe('applyColorBreakpoints — { value: [...] } data format', () => {
  it('reads value correctly from object-style data items', () => {
    const series = [
      {
        name: 'Metric',
        data: [{ value: [Date.now(), 75], label: { show: true } }],
      },
    ];
    applyColorBreakpoints(series, BREAKPOINTS, undefined, false);
    const point = (series[0] as any).data[0];
    expect(point.itemStyle.color).toBe('rgba(215,48,39,1)');
    // Existing properties preserved
    expect(point.label.show).toBe(true);
  });

  it('preserves existing itemStyle on object-style data items', () => {
    const series = [
      {
        name: 'Metric',
        data: [{ value: [Date.now(), 25], itemStyle: { opacity: 0.5 } }],
      },
    ];
    applyColorBreakpoints(series, BREAKPOINTS, undefined, false);
    const point = (series[0] as any).data[0];
    expect(point.itemStyle.color).toBe('rgba(26,152,80,1)');
    expect(point.itemStyle.opacity).toBe(0.5);
  });
});

describe('applyColorBreakpoints — edge cases', () => {
  it('does not throw on empty series array', () => {
    expect(() => applyColorBreakpoints([], BREAKPOINTS, undefined, false)).not.toThrow();
  });

  it('does not throw on empty breakpoints array', () => {
    const series = makeVerticalSeries([25]);
    expect(() => applyColorBreakpoints(series, [], undefined, false)).not.toThrow();
  });

  it('leaves series without data array untouched', () => {
    const series = [{ name: 'NoData' }];
    expect(() => applyColorBreakpoints(series, BREAKPOINTS, undefined, false)).not.toThrow();
  });
});

// ── colorMode priority enforcement (integration) ──────────────────────────────

describe('colorMode enforcement via caller logic', () => {
  // This tests that the caller's conditional (colorMode !== 'breakpoints')
  // correctly prevents metric colors when breakpoints mode is active.
  // The actual enforcement is in transformProps, not in the utilities themselves.

  it('applyMetricColors is independent: must be called only when appropriate', () => {
    // When colorMode === 'breakpoints', the caller should NOT call applyMetricColors.
    // Simulate: call both and verify breakpoints itemStyle wins (last write wins for series-level).
    const series = [{ name: 'Tests', data: [[0, 25]] }];
    applyMetricColors(series, { Tests: '#aabbcc' });
    applyColorBreakpoints(series, BREAKPOINTS, undefined, false);
    // After breakpoints, the data-point itemStyle was set from green breakpoint
    const point = (series[0] as any).data[0];
    expect(point.itemStyle.color).toBe('rgba(26,152,80,1)');
    // Series-level itemStyle.color from metric still exists but data-point takes priority
    expect((series[0] as any).itemStyle.color).toBe('#aabbcc');
  });
});
