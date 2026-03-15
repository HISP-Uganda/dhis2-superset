export const COLOR_RAMPS: Record<string, string[]> = {
  YlOrRd: ['#ffffb2', '#fed976', '#feb24c', '#fd8d3c', '#f03b20', '#bd0026'],
  Blues: ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'],
  Greens: ['#edf8e9', '#bae4b3', '#74c476', '#41ab5d', '#238b45', '#005a32'],
  Reds: ['#fee5d9', '#fcbba1', '#fc9272', '#fb6a4a', '#de2d26', '#a50f15'],
  Purples: ['#f2f0f7', '#dadaeb', '#bcbddc', '#9e9ac8', '#756bb1', '#54278f'],
  Oranges: ['#feedde', '#fdd0a2', '#fdae6b', '#fd8d3c', '#e6550d', '#a63603'],
  YlGn: ['#ffffcc', '#d9f0a3', '#addd8e', '#78c679', '#31a354', '#006837'],
  BuPu: ['#edf8fb', '#bfd3e6', '#9ebcda', '#8c96c6', '#8856a7', '#810f7c'],
  GnBu: ['#f0f9e8', '#bae4bc', '#7bccc4', '#43a2ca', '#0868ac', '#084081'],
  RdPu: ['#feebe2', '#fcc5c0', '#fa9fb5', '#f768a1', '#c51b8a', '#7a0177'],
  Viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725', '#fde725'],
  Plasma: ['#0d0887', '#7e03a8', '#cc4778', '#f89441', '#f0f921', '#f0f921'],
  Health: ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c', '#a50026'],
};

export const CATEGORICAL_PALETTES: Record<string, string[]> = {
  Tableau10: [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
    '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  ],
  Set1: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf'],
  Set2: ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
  Set3: ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5'],
  Pastel1: ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6', '#ffffcc', '#e5d8bd', '#fddaec'],
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
}

export function interpolateColor(colorA: string, colorB: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(colorA);
  const [r2, g2, b2] = hexToRgb(colorB);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function rampColors(ramp: string[], n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [ramp[Math.floor(ramp.length / 2)]];
  if (n >= ramp.length) return ramp;
  const colors: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rawIdx = t * (ramp.length - 1);
    const lo = Math.floor(rawIdx);
    const hi = Math.min(Math.ceil(rawIdx), ramp.length - 1);
    colors.push(lo === hi ? ramp[lo] : interpolateColor(ramp[lo], ramp[hi], rawIdx - lo));
  }
  return colors;
}

export function getRamp(scheme: string): string[] {
  return COLOR_RAMPS[scheme] ?? COLOR_RAMPS.YlOrRd;
}

export function getCategoricalPalette(name: string): string[] {
  return CATEGORICAL_PALETTES[name] ?? CATEGORICAL_PALETTES.Tableau10;
}
