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

import { buildPublicChartEmbedUrl, isMapLikeViz } from './PublicChartContainer';

test('buildPublicChartEmbedUrl applies horizontal legend overrides for embedded public charts', () => {
  const nextUrl = buildPublicChartEmbedUrl(
    '/superset/explore/?slice_id=12&standalone=true',
    { legendPreset: 'horizontal_top' },
  );
  const parsed = new URL(nextUrl, 'http://localhost');
  const formData = JSON.parse(parsed.searchParams.get('form_data') || '{}');

  expect(parsed.pathname).toBe('/superset/explore/public/');
  expect(formData.slice_id).toBe(12);
  expect(formData.show_legend).toBe(true);
  expect(formData.legendOrientation).toBe('top');
  expect(formData.legendType).toBe('scroll');
});

test('buildPublicChartEmbedUrl preserves existing form_data and allows hiding legends', () => {
  const nextUrl = buildPublicChartEmbedUrl(
    '/superset/explore/?slice_id=12&standalone=true&form_data=%7B%22slice_id%22%3A12%2C%22metric%22%3A%22value%22%7D',
    { legendPreset: 'hidden' },
  );
  const formData = JSON.parse(
    new URL(nextUrl, 'http://localhost').searchParams.get('form_data') || '{}',
  );

  expect(formData.metric).toBe('value');
  expect(formData.show_legend).toBe(false);
});

test('buildPublicChartEmbedUrl normalizes public chart routes even without legend overrides', () => {
  const nextUrl = buildPublicChartEmbedUrl(
    '/superset/explore/?slice_id=12&standalone=true',
  );
  const parsed = new URL(nextUrl, 'http://localhost');

  expect(parsed.pathname).toBe('/superset/explore/public/');
  expect(parsed.searchParams.get('slice_id')).toBe('12');
});

test('buildPublicChartEmbedUrl keeps authenticated editor previews on the standard explore route', () => {
  const nextUrl = buildPublicChartEmbedUrl(
    '/superset/explore/public/?slice_id=12&standalone=true',
    { accessMode: 'authenticated' },
  );
  const parsed = new URL(nextUrl, 'http://localhost');

  expect(parsed.pathname).toBe('/superset/explore/');
  expect(parsed.searchParams.get('slice_id')).toBe('12');
});

test('isMapLikeViz detects map-style charts used by public pages', () => {
  expect(isMapLikeViz('dhis2_map')).toBe(true);
  expect(isMapLikeViz('mapbox')).toBe(true);
  expect(isMapLikeViz('line')).toBe(false);
});
