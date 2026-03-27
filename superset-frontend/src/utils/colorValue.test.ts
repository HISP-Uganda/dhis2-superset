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
import { colorValueToCss } from './colorValue';

describe('colorValueToCss', () => {
  test('returns trimmed string colors unchanged', () => {
    expect(colorValueToCss('  #ffffff  ')).toBe('#ffffff');
  });

  test('converts rgba color objects with fractional alpha', () => {
    expect(colorValueToCss({ r: 15, g: 23, b: 42, a: 0.4 })).toBe(
      'rgba(15,23,42,0.4)',
    );
  });

  test('converts percent-style alpha values from color picker objects', () => {
    expect(colorValueToCss({ r: 15, g: 23, b: 42, a: 40 })).toBe(
      'rgba(15,23,42,0.4)',
    );
  });

  test('returns undefined for invalid values', () => {
    expect(colorValueToCss(null)).toBeUndefined();
    expect(colorValueToCss({ r: 'oops', g: 23, b: 42 })).toBeUndefined();
  });
});
