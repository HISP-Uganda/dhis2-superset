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

export interface BoundaryFeature {
  type: 'Feature';
  id: string;
  properties: {
    id: string;
    name: string;
    level: number;
    parentId: string;
    parentName: string;
    hasChildrenWithCoordinates: boolean;
    hasParentWithCoordinates: boolean;
  };
  geometry: {
    type: 'Point' | 'Polygon' | 'MultiPolygon';
    coordinates: number[] | number[][] | number[][][];
  };
}

export interface DrillState {
  currentLevel: number;
  parentId: string | null;
  parentName: string | null;
  breadcrumbs: Array<{
    id: string;
    name: string;
    level: number;
  }>;
}

export interface LevelBorderColor {
  level: number;
  color: { r: number; g: number; b: number; a: number };
  width?: number;
}

export type AggregationMethod =
  | 'sum'
  | 'average'
  | 'max'
  | 'min'
  | 'count'
  | 'latest';
export type LegendType =
  | 'auto'
  | 'equal_interval'
  | 'quantile'
  | 'manual'
  | 'staged';

export interface DHIS2LegendItem {
  id?: string | null;
  label?: string | null;
  startValue?: number | null;
  endValue?: number | null;
  color: string;
}

export interface DHIS2LegendDefinition {
  source?: string;
  setId?: string | null;
  setName?: string | null;
  min?: number | null;
  max?: number | null;
  items: DHIS2LegendItem[];
}

export interface DHIS2MapProps {
  width: number;
  height: number;
  data: Record<string, any>[];
  databaseId: number;
  sourceInstanceIds?: number[];
  orgUnitColumn: string;
  metric: string;
  primaryBoundaryLevel?: number;
  aggregationMethod?: AggregationMethod;
  boundaryLevels: number[];
  boundaryLevelLabels?: Record<number, string>;
  enableDrill: boolean;
  colorScheme: string;
  linearColorScheme?: string;
  useLinearColorScheme?: boolean;
  opacity: number;
  strokeColor: { r: number; g: number; b: number; a: number };
  strokeWidth: number;
  autoThemeBorders?: boolean;
  levelBorderColors?: LevelBorderColor[];
  showAllBoundaries?: boolean;
  focusSelectedBoundaryWithChildren?: boolean;
  styleUnselectedAreas?: boolean;
  unselectedAreaFillColor?: { r: number; g: number; b: number; a: number };
  unselectedAreaFillOpacity?: number;
  unselectedAreaBorderColor?: { r: number; g: number; b: number; a: number };
  unselectedAreaBorderWidth?: number;
  showLabels: boolean;
  labelType: 'name' | 'value' | 'name_value' | 'percent';
  labelFontSize: number;
  showLegend: boolean;
  legendPosition: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
  legendClasses: number;
  legendType?: LegendType;
  legendMin?: number;
  legendMax?: number;
  manualBreaks?: number[];
  manualColors?: string[];
  stagedLegendDefinition?: DHIS2LegendDefinition;
  legendReverseColors?: boolean;
  legendNoDataColor?: { r: number; g: number; b: number; a: number };
  tooltipColumns: string[];
  onDrillDown?: (orgUnitId: string, orgUnitName: string) => void;
  setDataMask?: (dataMask: any) => void;
  activeFilters?: Array<{
    col: string;
    op: string;
    val: any;
  }>;
  nativeFilters?: Record<string, any>;
  // DHIS2 specific props for fallback data fetching
  datasetSql?: string;
  isDHIS2Dataset?: boolean;
  datasetId?: number;
  chartId?: number;
  dashboardId?: number;
  // Boundary loading method: 'geoFeatures' (default) or 'geoJSON'
  boundaryLoadMethod?: 'geoFeatures' | 'geoJSON';
}

export interface ThematicLayerConfig {
  boundaries: BoundaryFeature[];
  metric: string;
  colorScale: (value: number) => string;
  opacity: number;
  strokeColor: string;
  strokeWidth: number;
}

export interface FacilityData {
  id: string;
  name: string;
  coordinates: {
    lat: number;
    lng: number;
  } | null;
  level: number;
  parentId: string;
}

export interface MapLegendBreak {
  min: number;
  max: number;
  color: string;
  label: string;
}
