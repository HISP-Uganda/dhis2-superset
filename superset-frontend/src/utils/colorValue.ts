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

export interface RgbaColorValue {
  r: number;
  g: number;
  b: number;
  a?: number;
}

function toFiniteNumber(value: unknown): number | undefined {
  const numericValue =
    typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

export function colorValueToCss(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue || undefined;
  }

  if (typeof value !== 'object') {
    return undefined;
  }

  const rgbaValue = value as Partial<RgbaColorValue>;
  const r = toFiniteNumber(rgbaValue.r);
  const g = toFiniteNumber(rgbaValue.g);
  const b = toFiniteNumber(rgbaValue.b);
  if (r === undefined || g === undefined || b === undefined) {
    return undefined;
  }

  const rawAlpha = toFiniteNumber(rgbaValue.a);
  const alpha =
    rawAlpha === undefined
      ? 1
      : rawAlpha > 1
        ? rawAlpha / 100
        : rawAlpha;
  const clampedAlpha = Math.max(0, Math.min(alpha, 1));

  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(
    b,
  )},${clampedAlpha})`;
}
