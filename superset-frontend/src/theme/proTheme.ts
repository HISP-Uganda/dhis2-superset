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
 * Superset Pro Theme — Professional Public-Health Command Center
 *
 * Core design tokens and palette definitions used across all theme layers.
 * CSS custom properties, Ant Design overrides, and utility classes all
 * derive from these constants.
 */

/* ──────────────────────────────────────────────────────────────────────
   Core Palette
   ────────────────────────────────────────────────────────────────────── */
export const PRO_PALETTE = {
  // Brand
  primaryNavy: '#0D3B66',
  primaryBlue: '#1976D2',
  accentBlue: '#4DA3FF',

  // Status
  success: '#2E7D32',
  warning: '#F9A825',
  danger: '#D32F2F',

  // Surfaces — soft white, aligned with Page Studio (#f0f2f5)
  canvas: '#F0F2F5',
  card: '#FFFFFF',
  subSurfaceAlt: '#F8FAFC',
  border: '#E5EAF0',
  borderStrong: '#CBD5E1',

  // Text
  textPrimary: '#1A1F2C',
  textSecondary: '#6B7280',
  textMuted: '#8C98A8',

  // Derived
  navyLight: '#164E8A',
  blueHover: '#1565C0',
  successBg: '#E8F5E9',
  warningBg: '#FFF8E1',
  dangerBg: '#FFEBEE',
  infoBg: '#E3F2FD',
  subSurface: '#F8FAFC',
} as const;

/* ──────────────────────────────────────────────────────────────────────
   Default Chart Palette (8 colors)
   ────────────────────────────────────────────────────────────────────── */
export const PRO_CHART_PALETTE = [
  '#1976D2',
  '#4DA3FF',
  '#2E7D32',
  '#F9A825',
  '#D32F2F',
  '#7B61FF',
  '#00ACC1',
  '#8E24AA',
] as const;

/* ──────────────────────────────────────────────────────────────────────
   Typography
   ────────────────────────────────────────────────────────────────────── */
export const PRO_FONT_FAMILY =
  'Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const PRO_FONT_FAMILY_CODE =
  '"Fira Code", "Cascadia Code", "Consolas", monospace';

/* ──────────────────────────────────────────────────────────────────────
   Spacing Scale (px)
   ────────────────────────────────────────────────────────────────────── */
export const PRO_SPACING = [0, 4, 8, 12, 16, 20, 24, 32] as const;

/* ──────────────────────────────────────────────────────────────────────
   Shape
   ────────────────────────────────────────────────────────────────────── */
export const PRO_RADII = {
  input: 8,
  button: 8,
  card: 12,
  chip: 999, // pill
} as const;

/* ──────────────────────────────────────────────────────────────────────
   Shadows
   ────────────────────────────────────────────────────────────────────── */
export const PRO_SHADOWS = {
  /** Flat design — no card shadows; depth via subtle borders */
  card: 'none',
  cardHover: 'none',
  dropdown: '0 4px 16px rgba(13,59,102,0.10), 0 2px 4px rgba(13,59,102,0.06)',
  modal: '0 8px 32px rgba(13,59,102,0.12), 0 4px 8px rgba(13,59,102,0.06)',
} as const;
