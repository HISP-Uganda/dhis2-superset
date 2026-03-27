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

import {
  hexToRgba,
  generateEqualBreakpoints,
  importDHIS2Legend,
  GRADIENT_PRESETS,
  DEFAULT_GRADIENT,
} from './colorBreakpointUtils';

// ── hexToRgba ─────────────────────────────────────────────────────────────────

describe('hexToRgba', () => {
  it('parses a 6-char hex with hash', () => {
    expect(hexToRgba('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 100 });
  });

  it('parses uppercase hex', () => {
    expect(hexToRgba('#FF0000')).toEqual({ r: 255, g: 0, b: 0, a: 100 });
  });

  it('parses a 3-char shorthand hex', () => {
    expect(hexToRgba('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 100 });
  });

  it('parses mixed-case 3-char hex', () => {
    const result = hexToRgba('#ABC');
    expect(result).not.toBeNull();
    expect(result!.r).toBe(0xaa);
    expect(result!.g).toBe(0xbb);
    expect(result!.b).toBe(0xcc);
  });

  it('always sets alpha to 100', () => {
    const result = hexToRgba('#336699');
    expect(result!.a).toBe(100);
  });

  it('returns null for empty string', () => {
    expect(hexToRgba('')).toBeNull();
  });

  it('returns null for invalid length (5 chars)', () => {
    expect(hexToRgba('#12345')).toBeNull();
  });

  it('returns null for non-hex characters', () => {
    expect(hexToRgba('#gggggg')).toBeNull();
  });

  it('parses white (#ffffff)', () => {
    expect(hexToRgba('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 100 });
  });

  it('parses black (#000000)', () => {
    expect(hexToRgba('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 100 });
  });
});

// ── generateEqualBreakpoints ───────────────────────────────────────────────────

describe('generateEqualBreakpoints', () => {
  it('generates the correct number of breakpoints', () => {
    const { breakpoints, error } = generateEqualBreakpoints(5, 0, 100);
    expect(error).toBeNull();
    expect(breakpoints).toHaveLength(5);
  });

  it('first breakpoint starts at min', () => {
    const { breakpoints } = generateEqualBreakpoints(4, 10, 50);
    expect(breakpoints![0].minValue).toBe(10);
  });

  it('last breakpoint ends at max', () => {
    const { breakpoints } = generateEqualBreakpoints(4, 10, 50);
    expect(breakpoints![3].maxValue).toBe(50);
  });

  it('breakpoints are contiguous (each max === next min)', () => {
    const { breakpoints } = generateEqualBreakpoints(5, 0, 100);
    for (let i = 0; i < breakpoints!.length - 1; i += 1) {
      expect(breakpoints![i].maxValue).toBeCloseTo(breakpoints![i + 1].minValue!, 5);
    }
  });

  it('assigns sequential ids starting from 0', () => {
    const { breakpoints } = generateEqualBreakpoints(3, 0, 30);
    expect(breakpoints!.map(b => b.id)).toEqual([0, 1, 2]);
  });

  it('uses the first stop colour for the first breakpoint', () => {
    const preset = GRADIENT_PRESETS[DEFAULT_GRADIENT];
    const { breakpoints } = generateEqualBreakpoints(3, 0, 100, DEFAULT_GRADIENT);
    expect(breakpoints![0].color).toEqual(preset.stops[0].color);
  });

  it('uses the last stop colour for the last breakpoint', () => {
    const preset = GRADIENT_PRESETS[DEFAULT_GRADIENT];
    const { breakpoints } = generateEqualBreakpoints(3, 0, 100, DEFAULT_GRADIENT);
    expect(breakpoints![2].color).toEqual(preset.stops[preset.stops.length - 1].color);
  });

  it('generates a single breakpoint covering the full range', () => {
    const { breakpoints } = generateEqualBreakpoints(1, 0, 100);
    expect(breakpoints).toHaveLength(1);
    expect(breakpoints![0].minValue).toBe(0);
    expect(breakpoints![0].maxValue).toBe(100);
  });

  it('returns an error when min >= max', () => {
    const { error } = generateEqualBreakpoints(5, 100, 0);
    expect(error).toBeTruthy();
  });

  it('returns an error when min === max', () => {
    const { error } = generateEqualBreakpoints(5, 50, 50);
    expect(error).toBeTruthy();
  });

  it('returns an error for count = 0', () => {
    const { error } = generateEqualBreakpoints(0, 0, 100);
    expect(error).toBeTruthy();
  });

  it('returns an error for count > 20', () => {
    const { error } = generateEqualBreakpoints(21, 0, 100);
    expect(error).toBeTruthy();
  });

  it('returns an error for non-integer count', () => {
    const { error } = generateEqualBreakpoints(2.5, 0, 100);
    expect(error).toBeTruthy();
  });

  it('falls back to DEFAULT_GRADIENT for an unknown gradient key', () => {
    const result = generateEqualBreakpoints(3, 0, 100, 'nonexistent-key');
    expect(result.error).toBeNull();
    expect(result.breakpoints).toHaveLength(3);
  });

  it('accepts negative min/max range', () => {
    const { breakpoints, error } = generateEqualBreakpoints(2, -100, -10);
    expect(error).toBeNull();
    expect(breakpoints![0].minValue).toBe(-100);
    expect(breakpoints![1].maxValue).toBe(-10);
  });

  it('works for all built-in gradient presets', () => {
    Object.keys(GRADIENT_PRESETS).forEach(key => {
      const { error } = generateEqualBreakpoints(3, 0, 100, key);
      expect(error).toBeNull();
    });
  });
});

// ── importDHIS2Legend ─────────────────────────────────────────────────────────

describe('importDHIS2Legend', () => {
  const validLegend = {
    name: 'Malaria Incidence',
    items: [
      { startValue: 0, endValue: 10, color: '#fee5d9', name: 'Low' },
      { startValue: 10, endValue: 50, color: '#fc9272', name: 'Medium' },
      { startValue: 50, endValue: 200, color: '#de2d26', name: 'High' },
    ],
  };

  it('converts valid legend items to breakpoints', () => {
    const { breakpoints, error } = importDHIS2Legend(validLegend);
    expect(error).toBeNull();
    expect(breakpoints).toHaveLength(3);
  });

  it('maps startValue → minValue and endValue → maxValue', () => {
    const { breakpoints } = importDHIS2Legend(validLegend);
    expect(breakpoints![0].minValue).toBe(0);
    expect(breakpoints![0].maxValue).toBe(10);
    expect(breakpoints![2].minValue).toBe(50);
    expect(breakpoints![2].maxValue).toBe(200);
  });

  it('parses hex colour strings into rgba objects', () => {
    const { breakpoints } = importDHIS2Legend(validLegend);
    const color = breakpoints![2].color!;
    expect(color.r).toBe(0xde);
    expect(color.g).toBe(0x2d);
    expect(color.b).toBe(0x26);
    expect(color.a).toBe(100);
  });

  it('assigns sequential ids', () => {
    const { breakpoints } = importDHIS2Legend(validLegend);
    expect(breakpoints!.map(b => b.id)).toEqual([0, 1, 2]);
  });

  it('returns error for null input', () => {
    const { error } = importDHIS2Legend(null);
    expect(error).toBeTruthy();
  });

  it('returns error for undefined input', () => {
    const { error } = importDHIS2Legend(undefined);
    expect(error).toBeTruthy();
  });

  it('returns error for legend with no items', () => {
    const { error } = importDHIS2Legend({ items: [] });
    expect(error).toBeTruthy();
  });

  it('skips items with non-numeric startValue', () => {
    const legend = {
      items: [
        { startValue: 'not-a-number' as unknown as number, endValue: 10, color: '#ff0000' },
        { startValue: 10, endValue: 20, color: '#00ff00' },
      ],
    };
    const { breakpoints } = importDHIS2Legend(legend);
    expect(breakpoints).toHaveLength(1);
    expect(breakpoints![0].minValue).toBe(10);
  });

  it('skips items with missing colour', () => {
    const legend = {
      items: [
        { startValue: 0, endValue: 10 },
        { startValue: 10, endValue: 20, color: '#00ff00' },
      ],
    };
    const { breakpoints } = importDHIS2Legend(legend);
    expect(breakpoints).toHaveLength(1);
  });

  it('skips items with invalid hex colour', () => {
    const legend = {
      items: [
        { startValue: 0, endValue: 10, color: 'not-a-color' },
        { startValue: 10, endValue: 20, color: '#00ff00' },
      ],
    };
    const { breakpoints } = importDHIS2Legend(legend);
    expect(breakpoints).toHaveLength(1);
  });

  it('returns error when all items are invalid', () => {
    const legend = {
      items: [
        { startValue: 'bad', endValue: 'bad', color: '#ff0000' } as any,
      ],
    };
    const { error } = importDHIS2Legend(legend);
    expect(error).toBeTruthy();
  });

  it('handles items property being undefined (treated as empty)', () => {
    const { error } = importDHIS2Legend({ name: 'Empty' });
    expect(error).toBeTruthy();
  });
});
