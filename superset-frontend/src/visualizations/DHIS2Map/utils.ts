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

import L from 'leaflet';
import {
  scaleQuantize,
  scaleQuantile,
  scaleThreshold,
  scaleSqrt,
} from 'd3-scale';
import { interpolateRgbBasis } from 'd3-interpolate';
import {
  getSequentialSchemeRegistry,
  getCategoricalSchemeRegistry,
} from '@superset-ui/core';
import {
  BoundaryFeature,
  DHIS2LegendDefinition,
  DHIS2LegendItem,
  LegendType,
  MapCornerPosition,
} from './types';

const ORG_UNIT_SUFFIX_PATTERNS = [
  /\bdistrict local government\b/g,
  /\bdistrict\b/g,
  /\bcity council\b/g,
  /\bmunicipal council\b/g,
  /\bmunicipality\b/g,
  /\bcity\b/g,
  /\bregion\b/g,
  /\bprovince\b/g,
  /\bdivision\b/g,
  /\bsub county\b/g,
  /\bsubcounty\b/g,
  /\btown council\b/g,
  /\bparish\b/g,
  /\bward\b/g,
  /\bfacility\b/g,
  /\bhealth facility\b/g,
  /\bdlg\b/g,
];

function generateDefaultColors(count: number): string[] {
  const colors = [
    '#edf8fb',
    '#b2e2e2',
    '#66c2a5',
    '#3d8c8c',
    '#238b45',
    '#006d2c',
    '#00441b',
    '#08519c',
    '#3182bd',
  ];
  return colors.slice(0, Math.min(count, colors.length));
}

/**
 * Interpolate colors from a scheme to get exactly the number of classes needed.
 * This ensures we get the correct number of distinct colors regardless of
 * how many colors are in the original scheme.
 */
function interpolateColors(
  baseColors: string[],
  targetCount: number,
): string[] {
  if (baseColors.length === targetCount) {
    return baseColors;
  }

  if (baseColors.length >= targetCount) {
    // Sample evenly from the available colors
    const result: string[] = [];
    for (let i = 0; i < targetCount; i++) {
      const index = Math.round(
        (i / (targetCount - 1)) * (baseColors.length - 1),
      );
      result.push(baseColors[Math.min(index, baseColors.length - 1)]);
    }
    return result;
  }

  // Need more colors than available - interpolate
  const interpolator = interpolateRgbBasis(baseColors);
  const result: string[] = [];
  for (let i = 0; i < targetCount; i++) {
    const t = targetCount > 1 ? i / (targetCount - 1) : 0;
    result.push(interpolator(t));
  }
  return result;
}

function getCollapsedRangeColor(colorRange: string[]): string {
  if (!colorRange.length) {
    return '#2c7fb8';
  }
  const middleIndex = Math.floor(colorRange.length / 2);
  return colorRange[middleIndex] ?? colorRange[colorRange.length - 1];
}

export interface ColorScaleOptions {
  schemeName: string;
  min: number;
  max: number;
  classes: number;
  reverseColors?: boolean;
  schemeType?: string;
  manualBreaks?: number[];
  manualColors?: string[];
}

export interface ComputedLegendEntry {
  key: string;
  color: string;
  label: string;
  min?: number;
  max?: number;
}

function getFiniteLegendValues(dataValues?: number[]): number[] {
  if (!Array.isArray(dataValues)) {
    return [];
  }
  return dataValues.filter(
    value => typeof value === 'number' && Number.isFinite(value),
  );
}

function hasEnoughVariationForQuantiles(
  dataValues: number[],
  classes: number,
  requireDenseDistribution: boolean,
): boolean {
  const uniqueValues = new Set(dataValues.map(value => `${value}`)).size;
  if (uniqueValues < 2) {
    return false;
  }
  if (requireDenseDistribution) {
    return dataValues.length >= classes;
  }
  return true;
}

function resolveColorRange(
  schemeName: string,
  classes: number,
  reverseColors: boolean,
  schemeType: string,
): string[] {
  let colors: string[] | undefined;

  if (schemeType === 'categorical') {
    const schemeRegistry = getCategoricalSchemeRegistry();
    const scheme = schemeRegistry.get(schemeName);
    colors = scheme?.colors ? [...scheme.colors] : undefined;

    if (!colors) {
      const allSchemes = schemeRegistry.keys();
      const matchingKey = allSchemes.find(
        key =>
          key.toLowerCase().includes(schemeName.toLowerCase()) ||
          schemeName.toLowerCase().includes(key.toLowerCase()),
      );

      if (matchingKey) {
        const matchedScheme = schemeRegistry.get(matchingKey);
        colors = matchedScheme?.colors ? [...matchedScheme.colors] : undefined;
      } else {
        const defaultKey = schemeRegistry.getDefaultKey();
        if (defaultKey) {
          const defaultScheme = schemeRegistry.get(defaultKey);
          colors = defaultScheme?.colors
            ? [...defaultScheme.colors]
            : undefined;
        }
      }
    }
  } else {
    const schemeRegistry = getSequentialSchemeRegistry();
    const scheme = schemeRegistry.get(schemeName);
    colors = scheme?.colors ? [...scheme.colors] : undefined;

    if (!colors) {
      const allSchemes = schemeRegistry.keys();
      const matchingKey = allSchemes.find(
        key =>
          key.toLowerCase().includes(schemeName.toLowerCase()) ||
          schemeName.toLowerCase().includes(key.toLowerCase()),
      );

      if (matchingKey) {
        const matchedScheme = schemeRegistry.get(matchingKey);
        colors = matchedScheme?.colors ? [...matchedScheme.colors] : undefined;
      } else {
        const defaultKey = schemeRegistry.getDefaultKey();
        if (defaultKey) {
          const defaultScheme = schemeRegistry.get(defaultKey);
          colors = defaultScheme?.colors
            ? [...defaultScheme.colors]
            : undefined;
        }
      }
    }
  }

  if (!colors || colors.length === 0) {
    colors = generateDefaultColors(classes);
  }

  let colorRange = interpolateColors(colors, classes);
  if (reverseColors) {
    colorRange = colorRange.reverse();
  }
  return colorRange;
}

function hasLegendItems(
  stagedLegendDefinition?: DHIS2LegendDefinition,
): stagedLegendDefinition is DHIS2LegendDefinition {
  return Boolean(stagedLegendDefinition?.items?.length);
}

function normalizeLegendItems(
  stagedLegendDefinition?: DHIS2LegendDefinition,
): DHIS2LegendItem[] {
  if (!hasLegendItems(stagedLegendDefinition)) {
    return [];
  }

  return [...stagedLegendDefinition.items]
    .filter(
      item =>
        Boolean(item?.color) &&
        (item?.startValue !== undefined ||
          item?.endValue !== undefined ||
          item?.label),
    )
    .sort((left, right) => {
      const leftStart =
        left.startValue === undefined || left.startValue === null
          ? Number.NEGATIVE_INFINITY
          : left.startValue;
      const rightStart =
        right.startValue === undefined || right.startValue === null
          ? Number.NEGATIVE_INFINITY
          : right.startValue;
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      const leftEnd =
        left.endValue === undefined || left.endValue === null
          ? Number.POSITIVE_INFINITY
          : left.endValue;
      const rightEnd =
        right.endValue === undefined || right.endValue === null
          ? Number.POSITIVE_INFINITY
          : right.endValue;
      return leftEnd - rightEnd;
    });
}

export function getLegendRangeFromDefinition(
  stagedLegendDefinition?: DHIS2LegendDefinition,
): { min: number; max: number } | undefined {
  const legendItems = normalizeLegendItems(stagedLegendDefinition);
  if (!legendItems.length) {
    return undefined;
  }

  const explicitMin = stagedLegendDefinition?.min;
  const explicitMax = stagedLegendDefinition?.max;
  if (
    typeof explicitMin === 'number' &&
    Number.isFinite(explicitMin) &&
    typeof explicitMax === 'number' &&
    Number.isFinite(explicitMax)
  ) {
    return { min: explicitMin, max: explicitMax };
  }

  const min = legendItems.find(item => Number.isFinite(item.startValue as number))
    ?.startValue;
  const max = [...legendItems]
    .reverse()
    .find(item => Number.isFinite(item.endValue as number))?.endValue;
  if (typeof min === 'number' && typeof max === 'number') {
    return { min, max };
  }
  return undefined;
}

function matchesLegendItem(
  item: DHIS2LegendItem,
  value: number,
  index: number,
  legendItems: DHIS2LegendItem[],
): boolean {
  const hasLowerBound =
    typeof item.startValue === 'number' && Number.isFinite(item.startValue);
  const hasUpperBound =
    typeof item.endValue === 'number' && Number.isFinite(item.endValue);
  const lowerMatches = !hasLowerBound || value >= (item.startValue as number);
  const upperMatches =
    !hasUpperBound ||
    value < (item.endValue as number) ||
    (index === legendItems.length - 1 && value <= (item.endValue as number));
  return lowerMatches && upperMatches;
}

export function getLegendColorFromDefinition(
  value: number,
  stagedLegendDefinition?: DHIS2LegendDefinition,
): string | undefined {
  const legendItems = normalizeLegendItems(stagedLegendDefinition);
  if (!legendItems.length || !Number.isFinite(value)) {
    return undefined;
  }

  for (let index = 0; index < legendItems.length; index += 1) {
    if (matchesLegendItem(legendItems[index], value, index, legendItems)) {
      return legendItems[index].color;
    }
  }

  const firstItem = legendItems[0];
  const lastItem = legendItems[legendItems.length - 1];
  if (
    typeof firstItem.startValue === 'number' &&
    Number.isFinite(firstItem.startValue) &&
    value < firstItem.startValue
  ) {
    return firstItem.color;
  }
  if (
    typeof lastItem.endValue === 'number' &&
    Number.isFinite(lastItem.endValue) &&
    value > lastItem.endValue
  ) {
    return lastItem.color;
  }
  return legendItems[0].color;
}

function formatLegendRangeLabel(
  startValue?: number,
  endValue?: number,
): string {
  if (
    typeof startValue === 'number' &&
    Number.isFinite(startValue) &&
    typeof endValue === 'number' &&
    Number.isFinite(endValue)
  ) {
    if (startValue === endValue) {
      return formatValue(startValue);
    }
    return `${formatValue(startValue)} - ${formatValue(endValue)}`;
  }
  if (typeof startValue === 'number' && Number.isFinite(startValue)) {
    return `>= ${formatValue(startValue)}`;
  }
  if (typeof endValue === 'number' && Number.isFinite(endValue)) {
    return `<= ${formatValue(endValue)}`;
  }
  return 'Legend item';
}

function buildEqualIntervalLegendEntries(
  min: number,
  max: number,
  colorRange: string[],
): ComputedLegendEntry[] {
  if (!colorRange.length || !Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  if (min === max) {
    const collapsedColor = getCollapsedRangeColor(colorRange);
    return [
      {
        key: 'collapsed',
        color: collapsedColor,
        min,
        max,
        label: formatLegendRangeLabel(min, max),
      },
    ];
  }

  const step = (max - min) / colorRange.length;
  return colorRange.map((color, index) => {
    const startValue = min + step * index;
    const endValue =
      index === colorRange.length - 1 ? max : min + step * (index + 1);
    return {
      key: `equal-${index}`,
      color,
      min: startValue,
      max: endValue,
      label: formatLegendRangeLabel(startValue, endValue),
    };
  });
}

function buildQuantileLegendEntries(
  dataValues: number[],
  colorRange: string[],
): ComputedLegendEntry[] {
  if (!dataValues.length || !colorRange.length) {
    return [];
  }

  const scale = scaleQuantile<string>().domain(dataValues).range(colorRange);
  const thresholds = scale.quantiles();
  const minValue = Math.min(...dataValues);
  const maxValue = Math.max(...dataValues);

  return colorRange.map((color, index) => {
    const startValue = index === 0 ? minValue : thresholds[index - 1];
    const endValue =
      index === colorRange.length - 1 ? maxValue : thresholds[index];

    return {
      key: `quantile-${index}`,
      color,
      min: startValue,
      max: endValue,
      label: formatLegendRangeLabel(startValue, endValue),
    };
  });
}

function buildManualLegendEntries(
  manualBreaks: number[],
  manualColors: string[],
  reverseColors: boolean,
): ComputedLegendEntry[] {
  const sortedBreaks = [...manualBreaks].sort((left, right) => left - right);
  if (sortedBreaks.length < 2 || !manualColors.length) {
    return [];
  }

  let colorRange = interpolateColors(manualColors, Math.max(sortedBreaks.length - 1, 1));
  if (reverseColors) {
    colorRange = colorRange.reverse();
  }

  return sortedBreaks.slice(0, -1).map((startValue, index) => ({
    key: `manual-${index}`,
    color: colorRange[index] ?? colorRange[colorRange.length - 1],
    min: startValue,
    max: sortedBreaks[index + 1],
    label: formatLegendRangeLabel(startValue, sortedBreaks[index + 1]),
  }));
}

export function buildLegendEntries(options: {
  schemeName: string;
  min: number;
  max: number;
  classes: number;
  reverseColors?: boolean;
  schemeType?: string;
  legendType?: LegendType;
  manualBreaks?: number[];
  manualColors?: string[];
  stagedLegendDefinition?: DHIS2LegendDefinition;
  dataValues?: number[];
}): ComputedLegendEntry[] {
  const {
    schemeName,
    min,
    max,
    classes,
    reverseColors = false,
    schemeType = 'sequential',
    legendType = 'auto',
    manualBreaks,
    manualColors,
    stagedLegendDefinition,
    dataValues,
  } = options;

  if (hasLegendItems(stagedLegendDefinition)) {
    const legendItems = normalizeLegendItems(stagedLegendDefinition);

    return legendItems.map((item, index) => ({
      key: item.id || `staged-${index}`,
      color: item.color,
      min: item.startValue ?? undefined,
      max: item.endValue ?? undefined,
      label:
        item.label ||
        formatLegendRangeLabel(
          item.startValue ?? undefined,
          item.endValue ?? undefined,
        ),
    }));
  }

  if (
    legendType === 'manual' &&
    Array.isArray(manualBreaks) &&
    manualBreaks.length > 1 &&
    Array.isArray(manualColors) &&
    manualColors.length > 0
  ) {
    return buildManualLegendEntries(
      manualBreaks,
      manualColors,
      reverseColors,
    );
  }

  const colorRange = resolveColorRange(
    schemeName,
    classes,
    reverseColors,
    schemeType,
  );
  const finiteValues = getFiniteLegendValues(dataValues);
  const shouldUseQuantiles =
    (legendType === 'quantile' &&
      hasEnoughVariationForQuantiles(finiteValues, classes, false)) ||
    (legendType === 'auto' &&
      hasEnoughVariationForQuantiles(finiteValues, classes, true));

  if (shouldUseQuantiles) {
    return buildQuantileLegendEntries(finiteValues, colorRange);
  }

  return buildEqualIntervalLegendEntries(min, max, colorRange);
}

export function getColorScale(
  schemeName: string,
  min: number,
  max: number,
  classes: number,
  reverseColors: boolean = false,
  schemeType: string = 'sequential',
  manualBreaks?: number[],
  manualColors?: string[],
  stagedLegendDefinition?: DHIS2LegendDefinition,
  legendType: LegendType = 'auto',
  dataValues?: number[],
): (value: number) => string {
  if (
    (legendType === 'auto' || legendType === 'staged') &&
    hasLegendItems(stagedLegendDefinition)
  ) {
    return (value: number): string =>
      getLegendColorFromDefinition(value, stagedLegendDefinition) ??
      stagedLegendDefinition.items[0].color;
  }

  // If manual breaks and colors are provided, use them
  if (
    legendType === 'manual' &&
    manualBreaks &&
    manualBreaks.length > 1 &&
    manualColors &&
    manualColors.length > 0
  ) {
    // Sort breaks in ascending order
    const sortedBreaks = [...manualBreaks].sort((a, b) => a - b);

    // We need N colors for N-1 breaks (breaks define boundaries)
    // Or if breaks define start/end of each interval, we need same number of colors
    let colors = [...manualColors];

    // Reverse if requested
    if (reverseColors) {
      colors = colors.reverse();
    }

    // Use scaleThreshold for manual breaks
    // Threshold scale: domain has N-1 values, range has N values
    // Values < domain[0] get range[0], values >= domain[N-2] get range[N-1]
    const thresholdDomain = sortedBreaks.slice(1, -1); // Remove first and last (min/max)

    if (thresholdDomain.length === 0) {
      // Only 2 breaks (min, max) - use simple quantize
      const scale = scaleQuantize<string>()
        .domain([sortedBreaks[0], sortedBreaks[sortedBreaks.length - 1]])
        .range(colors);
      return (value: number): string => scale(value) ?? colors[0];
    }

    const scale = scaleThreshold<number, string>()
      .domain(thresholdDomain)
      .range(colors);

    return (value: number): string => scale(value) ?? colors[0];
  }

  const colorRange = resolveColorRange(
    schemeName,
    classes,
    reverseColors,
    schemeType,
  );

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const collapsedColor = getCollapsedRangeColor(colorRange);
    return () => collapsedColor;
  }

  const finiteValues = getFiniteLegendValues(dataValues);
  const shouldUseQuantiles =
    (legendType === 'quantile' &&
      hasEnoughVariationForQuantiles(finiteValues, classes, false)) ||
    (legendType === 'auto' &&
      hasEnoughVariationForQuantiles(finiteValues, classes, true));

  if (shouldUseQuantiles) {
    const scale = scaleQuantile<string>().domain(finiteValues).range(colorRange);
    return (value: number): string => scale(value) ?? colorRange[0];
  }

  const scale = scaleQuantize<string>().domain([min, max]).range(colorRange);

  return (value: number): string => scale(value) ?? colorRange[0];
}

/**
 * Darken a color by a given factor (0-1).
 * Used for auto-theming borders to match fill colors.
 */
export function darkenColor(color: string, factor: number = 0.3): string {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    const darkenedR = Math.round(r * (1 - factor));
    const darkenedG = Math.round(g * (1 - factor));
    const darkenedB = Math.round(b * (1 - factor));

    return `rgb(${darkenedR}, ${darkenedG}, ${darkenedB})`;
  }

  // Handle rgb/rgba colors
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = Math.round(parseInt(rgbMatch[1], 10) * (1 - factor));
    const g = Math.round(parseInt(rgbMatch[2], 10) * (1 - factor));
    const b = Math.round(parseInt(rgbMatch[3], 10) * (1 - factor));
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Return original if format not recognized
  return color;
}

export function formatValue(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

export function normalizeOrgUnitMatchKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[()[\]{}.,/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildOrgUnitMatchKeys(value: unknown): string[] {
  const normalized = normalizeOrgUnitMatchKey(value);
  if (!normalized) {
    return [];
  }

  const keys = new Set<string>([normalized]);
  let stripped = normalized;

  ORG_UNIT_SUFFIX_PATTERNS.forEach(pattern => {
    stripped = stripped.replace(pattern, ' ');
  });
  stripped = stripped.replace(/\s+/g, ' ').trim();

  if (stripped && stripped !== normalized) {
    keys.add(stripped);
  }

  if (normalized.includes('city council')) {
    keys.add(normalized.replace(/\bcity council\b/g, 'city').trim());
  }
  if (normalized.includes('municipal council')) {
    keys.add(normalized.replace(/\bmunicipal council\b/g, 'municipality').trim());
  }

  return Array.from(keys).filter(Boolean);
}

function buildBounds(features: BoundaryFeature[]): L.LatLngBounds {
  const featureCollection = {
    type: 'FeatureCollection' as const,
    features: features as GeoJSON.Feature[],
  };
  const geojsonLayer = L.geoJSON(
    featureCollection as GeoJSON.FeatureCollection,
  );
  return geojsonLayer.getBounds();
}

export function calculateBounds(features: BoundaryFeature[]): L.LatLngBounds {
  return buildBounds(features);
}

export interface MapFitViewportConfig {
  paddingTopLeft: [number, number];
  paddingBottomRight: [number, number];
  maxZoom: number;
}

export interface MapFitViewportOptions {
  legendPosition?: MapCornerPosition;
  reserveLegendSpace?: boolean;
}

const getFeatureBoundsCenter = (
  feature: BoundaryFeature,
): L.LatLng | null => {
  try {
    const featureBounds = L.geoJSON(feature as any).getBounds();
    return featureBounds.isValid() ? featureBounds.getCenter() : null;
  } catch {
    return null;
  }
};

function getLegendCornerCoordinates(
  position: MapCornerPosition,
): { x: number; y: number } {
  return {
    x: position.includes('right') ? 1 : 0,
    y: position.includes('bottom') ? 1 : 0,
  };
}

export function resolveStrategicLegendPosition(
  features: BoundaryFeature[],
  preferredPosition: MapCornerPosition = 'bottomright',
): MapCornerPosition {
  if (!features.length) {
    return preferredPosition;
  }

  const bounds = buildBounds(features);
  if (!bounds.isValid()) {
    return preferredPosition;
  }

  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();
  const latSpan = Math.max(0.000001, northEast.lat - southWest.lat);
  const lngSpan = Math.max(0.000001, northEast.lng - southWest.lng);

  const centroids = features
    .map(getFeatureBoundsCenter)
    .filter(Boolean)
    .map(center => ({
      x: ((center as L.LatLng).lng - southWest.lng) / lngSpan,
      y: (northEast.lat - (center as L.LatLng).lat) / latSpan,
    }));

  if (!centroids.length) {
    return preferredPosition;
  }

  const candidatePositions: MapCornerPosition[] = [
    'topright',
    'bottomright',
    'bottomleft',
    'topleft',
  ];

  return candidatePositions.reduce<MapCornerPosition>((best, candidate) => {
    const bestCorner = getLegendCornerCoordinates(best);
    const candidateCorner = getLegendCornerCoordinates(candidate);
    const bestScore = centroids.reduce((total, centroid) => {
      const distance = Math.hypot(bestCorner.x - centroid.x, bestCorner.y - centroid.y);
      return total + 1 / Math.max(distance, 0.15);
    }, 0);
    const candidateScore = centroids.reduce((total, centroid) => {
      const distance = Math.hypot(
        candidateCorner.x - centroid.x,
        candidateCorner.y - centroid.y,
      );
      return total + 1 / Math.max(distance, 0.15);
    }, 0);

    if (candidateScore < bestScore) {
      return candidate;
    }
    if (candidateScore === bestScore && candidate === preferredPosition) {
      return candidate;
    }
    return best;
  }, preferredPosition);
}

export function getMapFitViewportConfig(
  mapWidth: number,
  mapHeight: number,
  options: MapFitViewportOptions = {},
): MapFitViewportConfig {
  const safeWidth = Math.max(0, Math.round(mapWidth || 0));
  const safeHeight = Math.max(0, Math.round(mapHeight || 0));
  const horizontalPadding = Math.max(
    2,
    Math.min(8, Math.round(safeWidth * 0.004)),
  );
  const verticalPadding = Math.max(
    2,
    Math.min(8, Math.round(safeHeight * 0.004)),
  );

  const minDimension = Math.min(safeWidth, safeHeight);
  let maxZoom = 20;
  if (minDimension < 180) {
    maxZoom = 14;
  } else if (minDimension < 260) {
    maxZoom = 15;
  } else if (minDimension < 360) {
    maxZoom = 16;
  } else if (minDimension < 460) {
    maxZoom = 17;
  } else if (minDimension < 620) {
    maxZoom = 18;
  } else if (minDimension < 820) {
    maxZoom = 19;
  }

  const paddingTopLeft: [number, number] = [
    horizontalPadding,
    verticalPadding,
  ];
  const paddingBottomRight: [number, number] = [
    horizontalPadding,
    verticalPadding,
  ];

  if (options.reserveLegendSpace && options.legendPosition) {
    const legendHorizontalReserve = Math.max(
      44,
      Math.min(88, Math.round(safeWidth * 0.12)),
    );
    const legendVerticalReserve = Math.max(
      44,
      Math.min(84, Math.round(safeHeight * 0.1)),
    );

    if (options.legendPosition.includes('left')) {
      paddingTopLeft[0] += legendHorizontalReserve;
    } else {
      paddingBottomRight[0] += legendHorizontalReserve;
    }

    if (options.legendPosition.includes('top')) {
      paddingTopLeft[1] += legendVerticalReserve;
    } else {
      paddingBottomRight[1] += legendVerticalReserve;
    }
  }

  return {
    paddingTopLeft,
    paddingBottomRight,
    maxZoom,
  };
}

/**
 * Calculate the centroid (center point) of all features.
 * Useful for initial map positioning.
 */
export function getCentroid(features: BoundaryFeature[]): [number, number] {
  if (features.length === 0) {
    // Default to center of Africa if no features
    return [1.3733, 32.2903]; // Uganda center
  }

  const bounds = calculateBounds(features);
  const center = bounds.getCenter();
  return [center.lat, center.lng];
}

/**
 * Calculate optimal zoom level to fit all features within the given dimensions.
 */
export function getOptimalZoom(
  features: BoundaryFeature[],
  mapWidth: number,
  mapHeight: number,
): number {
  if (features.length === 0) {
    return 6; // Default zoom for country view
  }

  const bounds = calculateBounds(features);
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();

  // Calculate the span in degrees
  const latSpan = ne.lat - sw.lat;
  const lngSpan = ne.lng - sw.lng;

  // Approximate zoom calculation based on span
  // Higher span = lower zoom needed
  const latZoom = Math.log2(mapHeight / (latSpan * 111)); // 111km per degree latitude
  const lngZoom = Math.log2(mapWidth / (lngSpan * 85)); // ~85km per degree longitude at equator

  // Use the smaller zoom to ensure all features fit
  const zoom = Math.min(latZoom, lngZoom);

  // Clamp zoom between reasonable values
  return Math.max(4, Math.min(18, Math.floor(zoom)));
}

export function getRadiusScale(
  min: number,
  max: number,
  minRadius: number = 5,
  maxRadius: number = 30,
): (value: number) => number {
  const scale = scaleSqrt().domain([min, max]).range([minRadius, maxRadius]);
  return (value: number): number => scale(value) ?? minRadius;
}

export function parseCoordinates(coordString: string): number[][][] | null {
  try {
    return JSON.parse(coordString);
  } catch {
    return null;
  }
}

export function getFeatureCenter(feature: BoundaryFeature): [number, number] {
  const geojsonLayer = L.geoJSON(feature as unknown as GeoJSON.GeoJsonObject);
  const center = geojsonLayer.getBounds().getCenter();
  return [center.lat, center.lng];
}

/**
 * Check if a coordinate pair is valid [lng, lat]
 * Must be exactly 2 numbers within valid ranges
 * Allows for some tolerance in coordinate ranges for edge cases
 */
function isValidCoordPair(coord: unknown): coord is [number, number] {
  if (!Array.isArray(coord) || coord.length < 2) {
    return false;
  }
  const [lng, lat] = coord;
  // Check if they're numbers and not NaN
  if (
    typeof lng !== 'number' ||
    typeof lat !== 'number' ||
    Number.isNaN(lng) ||
    Number.isNaN(lat)
  ) {
    return false;
  }
  // Allow slightly extended ranges for coordinates at edges
  // Some GeoJSON data may have slight precision issues
  const lngValid = lng >= -180 && lng <= 180;
  const latValid = lat >= -90 && lat <= 90;
  return lngValid && latValid;
}

/**
 * Check if a ring (array of coord pairs) is valid
 */
function isValidRing(ring: unknown): boolean {
  if (!Array.isArray(ring)) {
    return false;
  }
  // A valid ring needs at least 3 points (to form a closed polygon)
  // Some GIS systems might have fewer points in edge cases
  if (ring.length < 3) {
    return false;
  }
  // Check that all elements are valid coordinate pairs
  return ring.every(isValidCoordPair);
}

/**
 * Check if polygon coordinates are valid
 * Polygon: [[[lng, lat], [lng, lat], ...]] - array of rings
 */
function isValidPolygonCoords(coords: unknown): boolean {
  if (!Array.isArray(coords) || coords.length < 1) {
    return false;
  }
  // Each element should be a ring (array of coordinate pairs)
  return coords.every(isValidRing);
}

/**
 * Check if multipolygon coordinates are valid
 * MultiPolygon: [[[[lng, lat], ...]]] - array of polygons
 */
function isValidMultiPolygonCoords(coords: unknown): boolean {
  if (!Array.isArray(coords) || coords.length < 1) {
    return false;
  }
  // Each element should be a polygon (array of rings)
  return coords.every(isValidPolygonCoords);
}

/**
 * Detect the nesting depth of coordinates to determine actual geometry type.
 * DHIS2 sometimes mislabels geometry types (e.g., ty=2 for Polygon but coords are
 * actually MultiPolygon format with 4 levels of nesting).
 *
 * Nesting depth meanings:
 * - 1: Point [lng, lat]
 * - 2: LineString [[lng, lat], ...]
 * - 3: Polygon [[[lng, lat], ...]]
 * - 4: MultiPolygon [[[[lng, lat], ...]]]
 */
function detectCoordinateNestingDepth(coords: unknown): number {
  if (!Array.isArray(coords) || coords.length === 0) {
    return 0;
  }

  let depth = 1;
  let current: unknown = coords;
  while (Array.isArray(current) && current.length > 0) {
    const firstElement = current[0];
    if (typeof firstElement === 'number') {
      // Found a number, this is the coordinate level
      return depth;
    }
    if (Array.isArray(firstElement)) {
      depth += 1;
      current = firstElement;
    } else {
      break;
    }
  }

  return depth;
}

/**
 * Fix geometry type if it doesn't match actual coordinate structure.
 * Returns a corrected geometry object or null if invalid.
 */
function fixGeometryType(geometry: {
  type: string;
  coordinates: unknown;
}): { type: string; coordinates: unknown } | null {
  const { type, coordinates } = geometry;

  // First, detect the actual nesting depth
  const nestingDepth = detectCoordinateNestingDepth(coordinates);

  // Check if declared type matches coordinates
  let isValidForType = false;
  switch (type) {
    case 'Point':
      isValidForType = isValidCoordPair(coordinates);
      break;
    case 'Polygon':
      isValidForType = isValidPolygonCoords(coordinates);
      break;
    case 'MultiPolygon':
      isValidForType = isValidMultiPolygonCoords(coordinates);
      break;
    default:
      isValidForType = false;
  }

  if (isValidForType) {
    return geometry;
  }

  // Auto-detect and fix geometry type based on nesting depth
  // This is critical for DHIS2 which often mislabels Polygon vs MultiPolygon
  let detectedType: string | null = null;
  switch (nestingDepth) {
    case 1:
      detectedType = 'Point';
      break;
    case 3:
      detectedType = 'Polygon';
      break;
    case 4:
      detectedType = 'MultiPolygon';
      break;
    case 2:
      // Depth 2 could be LineString or improperly formatted data
      // Try to interpret as Polygon if the declared type was Polygon
      detectedType = type === 'Polygon' ? 'Polygon' : null;
      break;
    default:
      detectedType = null;
  }

  if (!detectedType) {
    // eslint-disable-next-line no-console
    console.warn(
      `[fixGeometryType] Cannot determine geometry type: declared=${type}, depth=${nestingDepth}`,
    );
    return null;
  }

  // Validate with detected type
  let isValidForDetected = false;
  switch (detectedType) {
    case 'Polygon':
      isValidForDetected = isValidPolygonCoords(coordinates);
      break;
    case 'MultiPolygon':
      isValidForDetected = isValidMultiPolygonCoords(coordinates);
      break;
    case 'Point':
      isValidForDetected = isValidCoordPair(coordinates);
      break;
    default:
      isValidForDetected = false;
  }

  if (isValidForDetected) {
    if (detectedType !== type) {
      // eslint-disable-next-line no-console
      console.log(
        `[fixGeometryType] Correcting geometry type: ${type} → ${detectedType} (depth=${nestingDepth})`,
      );
    }
    return { type: detectedType, coordinates };
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[fixGeometryType] Invalid geometry: declared=${type}, detected=${detectedType}, depth=${nestingDepth}`,
  );
  return null;
}

/**
 * Filter out features with invalid geometries to prevent Leaflet errors.
 * Also auto-corrects geometry types when DHIS2 mislabels them.
 */
export function filterValidFeatures(
  features: BoundaryFeature[],
): BoundaryFeature[] {
  // eslint-disable-next-line no-console
  console.log(
    `[filterValidFeatures] Processing ${features.length} features from API`,
  );

  const validFeatures: BoundaryFeature[] = [];
  const correctedFeatures: string[] = [];

  features.forEach(feature => {
    if (!feature || !feature.geometry) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping feature ${feature?.id} due to missing geometry`);
      return;
    }

    const geo = feature.geometry as { type: string; coordinates: unknown };
    const featureName = feature.properties?.name || feature.id;
    const nestingDepth = detectCoordinateNestingDepth(geo.coordinates);

    // Log every feature for debugging
    // eslint-disable-next-line no-console
    console.debug(
      `[filterValidFeatures] Feature "${featureName}": declared_type=${geo.type}, nesting_depth=${nestingDepth}`,
    );

    const fixedGeometry = fixGeometryType(geo);

    if (fixedGeometry) {
      // Track if we corrected the geometry type
      if (fixedGeometry.type !== geo.type) {
        correctedFeatures.push(
          `${feature.properties?.name || feature.id}: ${geo.type} → ${fixedGeometry.type}`,
        );
        // Update the feature's geometry with corrected type
        (feature.geometry as { type: string }).type = fixedGeometry.type;
      }
      validFeatures.push(feature);
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[filterValidFeatures] Skipping feature "${feature.properties?.name || feature.id}" due to invalid geometry:`,
        {
          type: geo.type,
          hasCoordinates: !!geo.coordinates,
          coordinatesLength: Array.isArray(geo.coordinates)
            ? geo.coordinates.length
            : 'N/A',
          nestingDepth: detectCoordinateNestingDepth(geo.coordinates),
          sampleCoord: getSampleCoordinate(feature.geometry),
        },
      );
    }
  });

  // Log corrected features
  if (correctedFeatures.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[filterValidFeatures] Auto-corrected geometry types for ${correctedFeatures.length} features:`,
      correctedFeatures,
    );
  }

  const invalidCount = features.length - validFeatures.length;
  if (invalidCount > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[filterValidFeatures] Filtered out ${invalidCount} features with invalid geometries`,
    );
    // Log the names of filtered features
    const filtered = features.filter(f => !validFeatures.includes(f));
    const filteredNames = filtered
      .map(f => f.properties?.name || f.id)
      .join(', ');
    // eslint-disable-next-line no-console
    console.log(`[filterValidFeatures] Filtered features: ${filteredNames}`);
  }

  return validFeatures;
}

/**
 * Get a sample coordinate from geometry for debugging
 */
function getSampleCoordinate(geometry: unknown): unknown {
  try {
    const geo = geometry as { coordinates?: unknown };
    if (!geo.coordinates) return null;

    let coords = geo.coordinates;
    // Drill down to get an actual coordinate pair
    while (
      Array.isArray(coords) &&
      coords.length > 0 &&
      Array.isArray(coords[0])
    ) {
      if (coords[0].length === 2 && typeof coords[0][0] === 'number') {
        return coords[0]; // Found a coordinate pair
      }
      coords = coords[0];
    }
    return coords;
  } catch {
    return null;
  }
}
