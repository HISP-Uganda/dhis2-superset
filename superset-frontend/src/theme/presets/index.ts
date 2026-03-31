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
 * Superset Pro Theme — 50 Swappable Theme Presets
 *
 * Each preset provides Ant Design seed tokens, CSS variable overrides,
 * and chart color palette. Presets are applied by swapping token values;
 * all component styling adapts automatically through the global CSS layer.
 */

export type PresetCategory =
  | 'clinical'
  | 'earth'
  | 'corporate'
  | 'vibrant'
  | 'monochrome'
  | 'high-contrast'
  | 'dark'
  | 'regional';

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  category: PresetCategory;
  /** Ant Design seed tokens */
  tokens: {
    colorPrimary: string;
    colorSuccess: string;
    colorWarning: string;
    colorError: string;
    colorInfo: string;
    colorBgLayout?: string;
    colorBgContainer?: string;
    borderRadius?: number;
  };
  /** CSS variable overrides (--pro-* namespace) */
  cssVars: {
    '--pro-navy': string;
    '--pro-navy-light': string;
    '--pro-accent': string;
    '--pro-accent-hover': string;
  };
  /** 8-color chart series palette */
  chartPalette: string[];
  /** Whether this is a dark variant */
  isDark?: boolean;
}

// ---------------------------------------------------------------------------
// Helper to create preset entries compactly
// ---------------------------------------------------------------------------
function p(
  id: string,
  name: string,
  desc: string,
  cat: PresetCategory,
  primary: string,
  success: string,
  warning: string,
  error: string,
  info: string,
  navy: string,
  navyLt: string,
  accent: string,
  accentHover: string,
  palette: string[],
  isDark = false,
  extraTokens: Record<string, unknown> = {},
): ThemePreset {
  return {
    id,
    name,
    description: desc,
    category: cat,
    tokens: {
      colorPrimary: primary,
      colorSuccess: success,
      colorWarning: warning,
      colorError: error,
      colorInfo: info,
      ...extraTokens,
    },
    cssVars: {
      '--pro-navy': navy,
      '--pro-navy-light': navyLt,
      '--pro-accent': accent,
      '--pro-accent-hover': accentHover,
    },
    chartPalette: palette,
    isDark,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// CLINICAL / HEALTH (8)
// ═══════════════════════════════════════════════════════════════════════
const clinical: ThemePreset[] = [
  p('pro-default', 'Pro Default', 'Professional blue command-center theme', 'clinical',
    '#1976D2', '#2E7D32', '#F9A825', '#D32F2F', '#4DA3FF',
    '#0D3B66', '#164E8A', '#1976D2', '#1565C0',
    ['#1976D2', '#4DA3FF', '#2E7D32', '#F9A825', '#D32F2F', '#7B61FF', '#00ACC1', '#8E24AA']),
  p('clinical-blue', 'Clinical Blue', 'Cool medical blue tones', 'clinical',
    '#0277BD', '#00897B', '#FFB300', '#C62828', '#29B6F6',
    '#01579B', '#0277BD', '#0288D1', '#01579B',
    ['#0277BD', '#29B6F6', '#00897B', '#FFB300', '#C62828', '#5C6BC0', '#26A69A', '#AB47BC']),
  p('hospital-green', 'Hospital Green', 'Healthcare green primary', 'clinical',
    '#00796B', '#388E3C', '#F9A825', '#D32F2F', '#4FC3F7',
    '#004D40', '#00695C', '#00897B', '#00796B',
    ['#00897B', '#4DB6AC', '#388E3C', '#FFB300', '#E53935', '#7E57C2', '#0097A7', '#C2185B']),
  p('who-standard', 'WHO Standard', 'World Health Organization palette', 'clinical',
    '#009ADE', '#00A950', '#FFB81C', '#E4002B', '#71C5E8',
    '#002F6C', '#005DAA', '#009ADE', '#007DBA',
    ['#009ADE', '#71C5E8', '#00A950', '#FFB81C', '#E4002B', '#8B5CF6', '#00838F', '#BA68C8']),
  p('cdc-palette', 'CDC Palette', 'CDC public health styling', 'clinical',
    '#005EA2', '#2E7D32', '#E5A000', '#B50D12', '#73B3E7',
    '#1A3C5E', '#005EA2', '#0076D6', '#005EA2',
    ['#005EA2', '#73B3E7', '#2E7D32', '#E5A000', '#B50D12', '#6558B1', '#0995AD', '#9C27B0']),
  p('malaria-ops', 'Malaria Operations', 'Malaria surveillance command center', 'clinical',
    '#1565C0', '#2E7D32', '#FF8F00', '#C62828', '#42A5F5',
    '#0A2F5C', '#13448C', '#1565C0', '#0D47A1',
    ['#1565C0', '#42A5F5', '#2E7D32', '#FF8F00', '#C62828', '#5E35B1', '#00838F', '#AD1457']),
  p('tb-response', 'TB Response', 'Tuberculosis programme palette', 'clinical',
    '#5C6BC0', '#43A047', '#FFA000', '#E53935', '#7986CB',
    '#283593', '#3949AB', '#5C6BC0', '#3F51B5',
    ['#5C6BC0', '#7986CB', '#43A047', '#FFA000', '#E53935', '#8E24AA', '#0097A7', '#D81B60']),
  p('immunization', 'Immunization', 'Vaccine programme palette', 'clinical',
    '#00ACC1', '#66BB6A', '#FFB300', '#EF5350', '#4DD0E1',
    '#006064', '#00838F', '#00ACC1', '#00838F',
    ['#00ACC1', '#4DD0E1', '#66BB6A', '#FFB300', '#EF5350', '#AB47BC', '#26A69A', '#EC407A']),
];

// ═══════════════════════════════════════════════════════════════════════
// EARTH / NATURAL (6)
// ═══════════════════════════════════════════════════════════════════════
const earth: ThemePreset[] = [
  p('forest', 'Forest', 'Deep green natural tones', 'earth',
    '#2E7D32', '#1B5E20', '#F9A825', '#C62828', '#66BB6A',
    '#1B3A1B', '#2E5E2E', '#2E7D32', '#1B5E20',
    ['#2E7D32', '#66BB6A', '#0277BD', '#F9A825', '#C62828', '#7B61FF', '#00796B', '#8E24AA']),
  p('ocean', 'Ocean', 'Deep blue oceanic palette', 'earth',
    '#0277BD', '#00796B', '#FFB300', '#D32F2F', '#4FC3F7',
    '#0A1E3D', '#0D3B66', '#0277BD', '#01579B',
    ['#0277BD', '#4FC3F7', '#00796B', '#FFB300', '#D32F2F', '#5C6BC0', '#00BCD4', '#7C4DFF']),
  p('savanna', 'Savanna', 'Warm African savanna tones', 'earth',
    '#E65100', '#558B2F', '#F9A825', '#C62828', '#FF9800',
    '#3E2723', '#5D4037', '#E65100', '#BF360C',
    ['#E65100', '#FF9800', '#558B2F', '#F9A825', '#C62828', '#7B61FF', '#00897B', '#AD1457']),
  p('desert-sand', 'Desert Sand', 'Warm neutral earthy tones', 'earth',
    '#8D6E63', '#6D4C41', '#FFB74D', '#D32F2F', '#A1887F',
    '#3E2723', '#5D4037', '#8D6E63', '#6D4C41',
    ['#8D6E63', '#BCAAA4', '#558B2F', '#FFB74D', '#EF5350', '#7E57C2', '#00897B', '#F06292']),
  p('volcanic', 'Volcanic', 'Intense deep reds and blacks', 'earth',
    '#BF360C', '#2E7D32', '#FFB300', '#B71C1C', '#FF7043',
    '#1A0A00', '#4E2A00', '#BF360C', '#8E2900',
    ['#BF360C', '#FF7043', '#2E7D32', '#FFB300', '#B71C1C', '#6A1B9A', '#00838F', '#C2185B']),
  p('glacier', 'Glacier', 'Icy blue-white tones', 'earth',
    '#4FC3F7', '#26A69A', '#FFD54F', '#E53935', '#81D4FA',
    '#0D2137', '#1A4A6E', '#4FC3F7', '#039BE5',
    ['#4FC3F7', '#81D4FA', '#26A69A', '#FFD54F', '#E53935', '#9575CD', '#00ACC1', '#F48FB1']),
];

// ═══════════════════════════════════════════════════════════════════════
// CORPORATE / FORMAL (6)
// ═══════════════════════════════════════════════════════════════════════
const corporate: ThemePreset[] = [
  p('executive-navy', 'Executive Navy', 'Deep navy corporate', 'corporate',
    '#1A237E', '#2E7D32', '#FFA000', '#C62828', '#3F51B5',
    '#0D1642', '#1A237E', '#283593', '#1A237E',
    ['#1A237E', '#5C6BC0', '#2E7D32', '#FFA000', '#C62828', '#7B61FF', '#0097A7', '#8E24AA']),
  p('slate-professional', 'Slate Professional', 'Neutral slate tones', 'corporate',
    '#455A64', '#2E7D32', '#FFA000', '#C62828', '#78909C',
    '#1C313A', '#37474F', '#455A64', '#37474F',
    ['#455A64', '#90A4AE', '#2E7D32', '#FFA000', '#C62828', '#7E57C2', '#00897B', '#EC407A']),
  p('carbon-dark', 'Carbon Dark', 'Very dark corporate', 'corporate',
    '#90A4AE', '#66BB6A', '#FFD54F', '#EF5350', '#B0BEC5',
    '#121212', '#1E1E1E', '#546E7A', '#455A64',
    ['#64B5F6', '#4DB6AC', '#81C784', '#FFD54F', '#EF5350', '#CE93D8', '#4DD0E1', '#F48FB1'],
    true, { colorBgLayout: '#121212', colorBgContainer: '#1E1E1E' }),
  p('graphite', 'Graphite', 'Warm gray professional', 'corporate',
    '#546E7A', '#43A047', '#FFB300', '#E53935', '#78909C',
    '#263238', '#37474F', '#546E7A', '#455A64',
    ['#546E7A', '#90A4AE', '#43A047', '#FFB300', '#E53935', '#7E57C2', '#26A69A', '#EC407A']),
  p('ivory-classic', 'Ivory Classic', 'Warm light classic', 'corporate',
    '#5D4037', '#2E7D32', '#F9A825', '#C62828', '#8D6E63',
    '#3E2723', '#5D4037', '#795548', '#5D4037',
    ['#795548', '#A1887F', '#2E7D32', '#F9A825', '#C62828', '#7E57C2', '#00897B', '#AD1457']),
  p('midnight', 'Midnight', 'Deep midnight blue', 'corporate',
    '#1565C0', '#2E7D32', '#FFB300', '#D32F2F', '#42A5F5',
    '#0A1628', '#0D2240', '#1565C0', '#0D47A1',
    ['#1565C0', '#42A5F5', '#2E7D32', '#FFB300', '#D32F2F', '#7C4DFF', '#00BCD4', '#E040FB']),
];

// ═══════════════════════════════════════════════════════════════════════
// VIBRANT / MODERN (8)
// ═══════════════════════════════════════════════════════════════════════
const vibrant: ThemePreset[] = [
  p('electric-blue', 'Electric Blue', 'Vivid electric blue', 'vibrant',
    '#2962FF', '#00C853', '#FFD600', '#FF1744', '#448AFF',
    '#0D1B4A', '#1A337A', '#2962FF', '#2952CC',
    ['#2962FF', '#448AFF', '#00C853', '#FFD600', '#FF1744', '#D500F9', '#00B8D4', '#F50057']),
  p('sunset', 'Sunset', 'Warm sunset gradient tones', 'vibrant',
    '#E65100', '#2E7D32', '#FFC400', '#D50000', '#FF6D00',
    '#3E1500', '#7A2B00', '#E65100', '#BF4400',
    ['#E65100', '#FF9100', '#2E7D32', '#FFC400', '#D50000', '#AA00FF', '#00BFA5', '#F50057']),
  p('tropical', 'Tropical', 'Lush tropical greens and blues', 'vibrant',
    '#00BFA5', '#00C853', '#FFD600', '#FF1744', '#1DE9B6',
    '#003D33', '#00695C', '#00BFA5', '#009688',
    ['#00BFA5', '#1DE9B6', '#00C853', '#FFD600', '#FF1744', '#D500F9', '#0091EA', '#F50057']),
  p('neon-minimal', 'Neon Minimal', 'Minimal with neon accents', 'vibrant',
    '#00E676', '#00C853', '#FFEA00', '#FF1744', '#69F0AE',
    '#0A1A0A', '#1A331A', '#00E676', '#00C853',
    ['#00E676', '#69F0AE', '#00B0FF', '#FFEA00', '#FF1744', '#E040FB', '#18FFFF', '#FF4081'],
    true, { colorBgLayout: '#0A0A0A', colorBgContainer: '#1A1A1A' }),
  p('aurora', 'Aurora', 'Northern lights palette', 'vibrant',
    '#7C4DFF', '#00E676', '#FFEA00', '#FF1744', '#B388FF',
    '#1A0A3E', '#2A1A5E', '#7C4DFF', '#651FFF',
    ['#7C4DFF', '#B388FF', '#00E676', '#FFEA00', '#FF1744', '#E040FB', '#18FFFF', '#FF4081']),
  p('coral-reef', 'Coral Reef', 'Warm coral ocean tones', 'vibrant',
    '#FF7043', '#26A69A', '#FFD54F', '#E53935', '#FF8A65',
    '#3E1A0A', '#6E2A15', '#FF7043', '#F4511E',
    ['#FF7043', '#FF8A65', '#26A69A', '#FFD54F', '#E53935', '#AB47BC', '#29B6F6', '#EC407A']),
  p('lavender', 'Lavender', 'Soft purple palette', 'vibrant',
    '#7E57C2', '#66BB6A', '#FFB300', '#EF5350', '#B39DDB',
    '#1A0A33', '#311B92', '#7E57C2', '#673AB7',
    ['#7E57C2', '#B39DDB', '#66BB6A', '#FFB300', '#EF5350', '#4FC3F7', '#26A69A', '#F06292']),
  p('citrus', 'Citrus', 'Fresh citrus yellow-green', 'vibrant',
    '#F57F17', '#558B2F', '#FFEA00', '#D50000', '#FFAB00',
    '#332600', '#664D00', '#F57F17', '#E65100',
    ['#F57F17', '#FFAB00', '#558B2F', '#FFEA00', '#D50000', '#7C4DFF', '#00BCD4', '#F50057']),
];

// ═══════════════════════════════════════════════════════════════════════
// MONOCHROME (4)
// ═══════════════════════════════════════════════════════════════════════
const monochrome: ThemePreset[] = [
  p('pure-grayscale', 'Pure Grayscale', 'Strictly grayscale', 'monochrome',
    '#424242', '#616161', '#9E9E9E', '#424242', '#757575',
    '#1A1A1A', '#333333', '#616161', '#424242',
    ['#424242', '#757575', '#9E9E9E', '#BDBDBD', '#616161', '#888888', '#555555', '#AAAAAA']),
  p('warm-gray', 'Warm Gray', 'Warm-toned grayscale', 'monochrome',
    '#5D4037', '#6D4C41', '#A1887F', '#795548', '#8D6E63',
    '#2C1E17', '#3E2723', '#6D4C41', '#5D4037',
    ['#5D4037', '#8D6E63', '#A1887F', '#BCAAA4', '#795548', '#6D4C41', '#4E342E', '#D7CCC8']),
  p('cool-steel', 'Cool Steel', 'Cool blue-gray steel', 'monochrome',
    '#546E7A', '#607D8B', '#90A4AE', '#455A64', '#78909C',
    '#1C2A33', '#263238', '#455A64', '#37474F',
    ['#455A64', '#78909C', '#90A4AE', '#B0BEC5', '#546E7A', '#607D8B', '#37474F', '#CFD8DC']),
  p('ink', 'Ink', 'Deep ink-black tones', 'monochrome',
    '#212121', '#424242', '#9E9E9E', '#212121', '#616161',
    '#0A0A0A', '#1A1A1A', '#424242', '#212121',
    ['#212121', '#616161', '#9E9E9E', '#BDBDBD', '#424242', '#757575', '#333333', '#E0E0E0']),
];

// ═══════════════════════════════════════════════════════════════════════
// HIGH CONTRAST (4)
// ═══════════════════════════════════════════════════════════════════════
const highContrast: ThemePreset[] = [
  p('wcag-aaa-light', 'WCAG AAA Light', 'Maximum contrast light theme', 'high-contrast',
    '#0050C8', '#006B3F', '#B45000', '#B30000', '#0050C8',
    '#000000', '#1A1A1A', '#0050C8', '#003D99',
    ['#0050C8', '#006B3F', '#B45000', '#B30000', '#6B00B3', '#006B6B', '#5C3D00', '#B3006B']),
  p('wcag-aaa-dark', 'WCAG AAA Dark', 'Maximum contrast dark theme', 'high-contrast',
    '#82B1FF', '#69F0AE', '#FFD740', '#FF8A80', '#82B1FF',
    '#000000', '#0A0A0A', '#82B1FF', '#448AFF',
    ['#82B1FF', '#69F0AE', '#FFD740', '#FF8A80', '#EA80FC', '#84FFFF', '#FFE57F', '#FF80AB'],
    true, { colorBgLayout: '#000000', colorBgContainer: '#0A0A0A' }),
  p('large-print', 'Large Print', 'High contrast for large displays', 'high-contrast',
    '#0D47A1', '#1B5E20', '#E65100', '#B71C1C', '#0D47A1',
    '#000000', '#0D1B3E', '#0D47A1', '#0A3580',
    ['#0D47A1', '#1B5E20', '#E65100', '#B71C1C', '#4A148C', '#004D40', '#BF360C', '#880E4F']),
  p('deuteranopia-safe', 'Deuteranopia Safe', 'Color-blind friendly', 'high-contrast',
    '#0072B2', '#E69F00', '#F0E442', '#CC79A7', '#56B4E9',
    '#001A33', '#003366', '#0072B2', '#005A8C',
    ['#0072B2', '#56B4E9', '#E69F00', '#F0E442', '#CC79A7', '#D55E00', '#009E73', '#000000']),
];

// ═══════════════════════════════════════════════════════════════════════
// DARK VARIANTS (8)
// ═══════════════════════════════════════════════════════════════════════
const dark: ThemePreset[] = [
  p('pro-dark', 'Pro Dark', 'Dark variant of Pro Default', 'dark',
    '#42A5F5', '#66BB6A', '#FFD54F', '#EF5350', '#64B5F6',
    '#0A1929', '#0D2137', '#42A5F5', '#1E88E5',
    ['#42A5F5', '#64B5F6', '#66BB6A', '#FFD54F', '#EF5350', '#CE93D8', '#4DD0E1', '#F48FB1'],
    true, { colorBgLayout: '#0A1929', colorBgContainer: '#132F4C' }),
  p('midnight-ops', 'Midnight Operations', 'Deep midnight operational', 'dark',
    '#29B6F6', '#66BB6A', '#FFD54F', '#EF5350', '#4FC3F7',
    '#050E1A', '#0A1A2E', '#29B6F6', '#0288D1',
    ['#29B6F6', '#4FC3F7', '#66BB6A', '#FFD54F', '#EF5350', '#BA68C8', '#26C6DA', '#F06292'],
    true, { colorBgLayout: '#050E1A', colorBgContainer: '#0F2236' }),
  p('dark-clinical', 'Dark Clinical', 'Dark medical theme', 'dark',
    '#4FC3F7', '#81C784', '#FFD54F', '#EF5350', '#81D4FA',
    '#0A1A28', '#0D2A3A', '#4FC3F7', '#0288D1',
    ['#4FC3F7', '#81D4FA', '#81C784', '#FFD54F', '#EF5350', '#CE93D8', '#80CBC4', '#F48FB1'],
    true, { colorBgLayout: '#0A1A28', colorBgContainer: '#132F42' }),
  p('dark-earth', 'Dark Earth', 'Dark earthy tones', 'dark',
    '#A1887F', '#81C784', '#FFD54F', '#EF5350', '#BCAAA4',
    '#1A1210', '#2C1E17', '#A1887F', '#8D6E63',
    ['#A1887F', '#BCAAA4', '#81C784', '#FFD54F', '#EF5350', '#CE93D8', '#80CBC4', '#F48FB1'],
    true, { colorBgLayout: '#1A1210', colorBgContainer: '#2C1E17' }),
  p('dark-vibrant', 'Dark Vibrant', 'Dark with vivid accents', 'dark',
    '#448AFF', '#69F0AE', '#FFD740', '#FF5252', '#82B1FF',
    '#0A0A1A', '#15152A', '#448AFF', '#2962FF',
    ['#448AFF', '#82B1FF', '#69F0AE', '#FFD740', '#FF5252', '#EA80FC', '#18FFFF', '#FF4081'],
    true, { colorBgLayout: '#0A0A1A', colorBgContainer: '#15152A' }),
  p('dark-carbon', 'Dark Carbon', 'Pure carbon dark', 'dark',
    '#78909C', '#66BB6A', '#FFD54F', '#EF5350', '#90A4AE',
    '#0A0A0A', '#1A1A1A', '#78909C', '#607D8B',
    ['#78909C', '#B0BEC5', '#66BB6A', '#FFD54F', '#EF5350', '#CE93D8', '#4DD0E1', '#F48FB1'],
    true, { colorBgLayout: '#0A0A0A', colorBgContainer: '#1A1A1A' }),
  p('dark-ocean', 'Dark Ocean', 'Deep ocean dark', 'dark',
    '#00BCD4', '#26A69A', '#FFD54F', '#EF5350', '#4DD0E1',
    '#001A22', '#002F3A', '#00BCD4', '#0097A7',
    ['#00BCD4', '#4DD0E1', '#26A69A', '#FFD54F', '#EF5350', '#BA68C8', '#29B6F6', '#F06292'],
    true, { colorBgLayout: '#001A22', colorBgContainer: '#002F3A' }),
  p('dark-forest', 'Dark Forest', 'Dark green forest', 'dark',
    '#4CAF50', '#00897B', '#FFD54F', '#EF5350', '#81C784',
    '#0A1A0A', '#152A15', '#4CAF50', '#388E3C',
    ['#4CAF50', '#81C784', '#00897B', '#FFD54F', '#EF5350', '#BA68C8', '#4DD0E1', '#F48FB1'],
    true, { colorBgLayout: '#0A1A0A', colorBgContainer: '#152A15' }),
];

// ═══════════════════════════════════════════════════════════════════════
// REGIONAL / CULTURAL (6)
// ═══════════════════════════════════════════════════════════════════════
const regional: ThemePreset[] = [
  p('uganda-national', 'Uganda National', 'Uganda flag-inspired palette', 'regional',
    '#D90000', '#009A44', '#FCE300', '#D90000', '#1E90FF',
    '#1A1A1A', '#333333', '#D90000', '#B30000',
    ['#D90000', '#009A44', '#FCE300', '#1E90FF', '#FF6B35', '#9C27B0', '#00BCD4', '#F44336']),
  p('east-africa', 'East Africa', 'East African Community palette', 'regional',
    '#003893', '#006B3F', '#FCD116', '#CE1126', '#4A90D9',
    '#001A4A', '#002D7A', '#003893', '#002B72',
    ['#003893', '#4A90D9', '#006B3F', '#FCD116', '#CE1126', '#7B61FF', '#00ACC1', '#E040FB']),
  p('pan-african', 'Pan-African', 'Pan-African movement palette', 'regional',
    '#009639', '#009639', '#FCD116', '#CE1126', '#D90000',
    '#1A1A1A', '#333333', '#009639', '#007A2E',
    ['#009639', '#CE1126', '#FCD116', '#1A1A1A', '#D90000', '#7B61FF', '#00BCD4', '#FF6F00']),
  p('nordic-clean', 'Nordic Clean', 'Scandinavian minimal', 'regional',
    '#2E6DA4', '#4CAF50', '#FFB300', '#E53935', '#5C9FD6',
    '#1A2A3A', '#2E4A5A', '#2E6DA4', '#256090',
    ['#2E6DA4', '#5C9FD6', '#4CAF50', '#FFB300', '#E53935', '#9575CD', '#26A69A', '#EC407A']),
  p('mediterranean', 'Mediterranean', 'Warm Mediterranean tones', 'regional',
    '#1565C0', '#00796B', '#FF8F00', '#C62828', '#1E88E5',
    '#0A2040', '#0D3060', '#1565C0', '#0D47A1',
    ['#1565C0', '#42A5F5', '#00796B', '#FF8F00', '#C62828', '#8E24AA', '#00BCD4', '#F44336']),
  p('asia-pacific', 'Asia Pacific', 'Asia Pacific region palette', 'regional',
    '#C62828', '#2E7D32', '#F9A825', '#D32F2F', '#EF5350',
    '#1A0A0A', '#3E1A1A', '#C62828', '#B71C1C',
    ['#C62828', '#EF5350', '#2E7D32', '#F9A825', '#0277BD', '#7B61FF', '#00ACC1', '#FF6F00']),
];

// ═══════════════════════════════════════════════════════════════════════
// FULL REGISTRY
// ═══════════════════════════════════════════════════════════════════════

export const ALL_PRESETS: ThemePreset[] = [
  ...clinical,
  ...earth,
  ...corporate,
  ...vibrant,
  ...monochrome,
  ...highContrast,
  ...dark,
  ...regional,
];

export const PRESETS_BY_ID: Record<string, ThemePreset> = {};
ALL_PRESETS.forEach(preset => {
  PRESETS_BY_ID[preset.id] = preset;
});

export const PRESETS_BY_CATEGORY: Record<PresetCategory, ThemePreset[]> = {
  clinical,
  earth,
  corporate,
  vibrant,
  monochrome,
  'high-contrast': highContrast,
  dark,
  regional,
};

export const DEFAULT_PRESET_ID = 'pro-default';

export function getPreset(id: string): ThemePreset | undefined {
  return PRESETS_BY_ID[id];
}
