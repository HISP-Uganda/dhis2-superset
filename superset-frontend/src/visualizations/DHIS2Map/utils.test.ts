/*
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
  buildLegendEntries,
  buildOrgUnitMatchKeys,
  formatValue,
  getColorScale,
  getLegendColorFromDefinition,
  getMapFitViewportConfig,
  getLegendRangeFromDefinition,
  normalizeOrgUnitMatchKey,
  parseCoordinates,
} from './utils';

describe('DHIS2Map Utils', () => {
  describe('formatValue', () => {
    test('should format millions', () => {
      expect(formatValue(1500000)).toBe('1.5M');
    });

    test('should format thousands', () => {
      expect(formatValue(1500)).toBe('1.5K');
    });

    test('should format small numbers', () => {
      expect(formatValue(500)).toBe('500');
    });

    test('should handle zero', () => {
      expect(formatValue(0)).toBe('0');
    });
  });

  describe('parseCoordinates', () => {
    test('should parse valid GeoJSON coordinates', () => {
      const json = '[[[0, 0], [1, 1], [1, 0]]]';
      const result = parseCoordinates(json);
      expect(result).toEqual([
        [
          [0, 0],
          [1, 1],
          [1, 0],
        ],
      ]);
    });

    test('should return null for invalid JSON', () => {
      const result = parseCoordinates('invalid');
      expect(result).toBeNull();
    });

    test('should handle empty coordinates', () => {
      const json = '[]';
      const result = parseCoordinates(json);
      expect(result).toEqual([]);
    });
  });

  describe('org unit matching', () => {
    test('normalizes org unit names consistently', () => {
      expect(normalizeOrgUnitMatchKey('District_City')).toBe('district city');
      expect(normalizeOrgUnitMatchKey(' Gulu   City ')).toBe('gulu city');
    });

    test('builds fallback aliases for administrative suffixes', () => {
      expect(buildOrgUnitMatchKeys('Amuru District')).toEqual(
        expect.arrayContaining(['amuru district', 'amuru']),
      );
      expect(buildOrgUnitMatchKeys('Gulu City Council')).toEqual(
        expect.arrayContaining(['gulu city council', 'gulu city', 'gulu']),
      );
    });
  });

  describe('staged DHIS2 legends', () => {
    const legendDefinition = {
      source: 'dhis2',
      setId: 'legend_set_1',
      setName: 'Malaria Burden',
      min: 0,
      max: 500,
      items: [
        {
          id: 'legend_1',
          label: 'Normal',
          startValue: 0,
          endValue: 100,
          color: '#2ca25f',
        },
        {
          id: 'legend_2',
          label: 'Alert',
          startValue: 100,
          endValue: 500,
          color: '#de2d26',
        },
      ],
    };

    test('returns legend range from staged legend definition', () => {
      expect(getLegendRangeFromDefinition(legendDefinition)).toEqual({
        min: 0,
        max: 500,
      });
    });

    test('matches value colors using staged DHIS2 legend intervals', () => {
      expect(getLegendColorFromDefinition(50, legendDefinition)).toBe('#2ca25f');
      expect(getLegendColorFromDefinition(250, legendDefinition)).toBe(
        '#de2d26',
      );
    });
  });

  describe('color scale', () => {
    test('uses a visible constant color when the value range collapses', () => {
      const colorScale = getColorScale(
        'fire',
        227920,
        227920,
        5,
        false,
        'sequential',
      );

      const collapsedColor = colorScale(227920);
      expect(collapsedColor).toBe(colorScale(1));
      expect(collapsedColor).not.toBe('#ffffff');
      expect(collapsedColor).not.toBe('rgb(255, 255, 255)');
    });

    test('uses data distribution for auto legends when enough values exist', () => {
      const dataValues = [1, 2, 3, 4, 5, 100];
      const colorScale = getColorScale(
        'fire',
        1,
        100,
        5,
        false,
        'sequential',
        undefined,
        undefined,
        undefined,
        'auto',
        dataValues,
      );

      expect(colorScale(1)).not.toBe(colorScale(5));
    });

    test('builds data-driven legend entries for auto mode', () => {
      const entries = buildLegendEntries({
        schemeName: 'fire',
        min: 1,
        max: 100,
        classes: 5,
        legendType: 'auto',
        dataValues: [1, 2, 3, 4, 5, 100],
      });

      expect(entries).toHaveLength(5);
      expect(entries[0].max).toBeLessThan(20);
      expect(entries[4].max).toBe(100);
    });
  });

  describe('map viewport fit config', () => {
    test('allows larger zoom on bigger map panels', () => {
      expect(getMapFitViewportConfig(1280, 720)).toEqual({
        paddingTopLeft: [19, 11],
        paddingBottomRight: [19, 11],
        maxZoom: 18,
      });
    });

    test('keeps compact cards on a safer zoom ceiling', () => {
      expect(getMapFitViewportConfig(320, 240)).toEqual({
        paddingTopLeft: [6, 6],
        paddingBottomRight: [6, 6],
        maxZoom: 14,
      });
    });
  });
});
