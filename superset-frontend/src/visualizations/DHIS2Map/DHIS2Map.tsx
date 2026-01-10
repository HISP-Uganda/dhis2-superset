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
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  ReactElement,
} from 'react';
import { styled, SupersetClient, t } from '@superset-ui/core';
import { Spin } from 'antd';
import { MapContainer, GeoJSON, ZoomControl, useMap } from 'react-leaflet';
// @ts-ignore - react-leaflet types
import L from 'leaflet';
// @ts-ignore - leaflet styles
import 'leaflet/dist/leaflet.css';
import { DHIS2MapProps, BoundaryFeature, DrillState } from './types';
import { DHIS2DataLoader } from './dhis2DataLoader';
import {
  loadDHIS2GeoFeatures,
  DHIS2GeoJSONFeature,
} from 'src/utils/dhis2GeoFeatureLoader';
import LegendPanel from './components/LegendPanel';
import DrillControls from './components/DrillControls';
import DataPreviewPanel from './components/DataPreviewPanel';
import {
  BaseMapSelector,
  BaseMapLayer,
  BaseMapType,
} from './components/BaseMaps';
import {
  getColorScale,
  formatValue,
  calculateBounds,
  filterValidFeatures,
  darkenColor,
} from './utils';

/* eslint-disable theme-colors/no-literal-colors */
// Use hardcoded values for map styling to avoid theme context issues
// These are legitimate map styling values, not UI theming
const MapWrapper = styled.div`
  width: 100%;
  height: 100%;
  position: relative;

  .leaflet-container {
    width: 100%;
    height: 100%;
    background: #f0f0f0;
  }

  .map-label {
    background: transparent;
    border: none;
    box-shadow: none;
    font-weight: 500;
    text-shadow:
      1px 1px 1px #ffffff,
      -1px -1px 1px #ffffff,
      1px -1px 1px #ffffff,
      -1px 1px 1px #ffffff;
  }

  .map-loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    min-height: 50vh;
    background: rgba(255, 255, 255, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 16px;
    z-index: 999;
  }

  .map-error-message {
    position: absolute;
    top: 8px;
    right: 8px;
    background: #ff4d4f;
    color: #ffffff;
    padding: 8px 16px;
    border-radius: 4px;
    z-index: 999;
  }

  .auto-focus-button {
    position: absolute;
    bottom: 80px;
    right: 8px;
    z-index: 1000;
    background: #ffffff;
    border: 2px solid rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 16px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);

    &:hover {
      background: #f4f4f4;
    }
  }
`;
/* eslint-enable theme-colors/no-literal-colors */

// Component to auto-fit map bounds when boundaries change
interface MapAutoFocusProps {
  boundaries: BoundaryFeature[];
  enabled: boolean;
}

function MapAutoFocus({ boundaries, enabled }: MapAutoFocusProps): ReactElement | null {
  const map = useMap();
  // Use refs to track state without causing re-renders
  const lastFocusedIdsRef = useRef<string>('');
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFocusedRef = useRef<boolean>(false);

  // Create a stable key from boundary IDs to detect actual changes
  const boundaryIdsKey = useMemo(
    () =>
      boundaries
        .map(b => b.id)
        .sort()
        .join(','),
    [boundaries],
  );

  useEffect(() => {
    // Only auto-focus if:
    // 1. We're enabled (not loading)
    // 2. We have boundaries
    // 3. The boundary set has actually changed (different IDs)
    // 4. We haven't already focused on this exact boundary set
    const boundariesChanged = boundaryIdsKey !== lastFocusedIdsRef.current;
    const shouldFocus =
      enabled && boundaries.length > 0 && map && boundariesChanged;

    if (!shouldFocus) {
      return undefined;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[MapAutoFocus] Auto-fitting map to ${boundaries.length} boundaries`,
    );

    // Clear any pending timeout
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
    }

    // Small delay to ensure map is fully initialized
    focusTimeoutRef.current = setTimeout(() => {
      try {
        const bounds = calculateBounds(boundaries);
        // eslint-disable-next-line no-console
        console.log('[MapAutoFocus] Calculated bounds for auto-fit:', bounds);

        if (bounds && bounds.isValid()) {
          // Calculate bounds area to determine appropriate zoom
          const boundsSize = bounds
            .getNorthEast()
            .distanceTo(bounds.getSouthWest());
          // eslint-disable-next-line no-console
          console.log(
            '[MapAutoFocus] Bounds diagonal distance (m):',
            boundsSize,
          );

          // Fit bounds with padding - ensure all features are visible
          // Use higher maxZoom for smaller areas, lower for larger areas
          const maxZoomLevel =
            boundsSize < 50000 ? 15 : boundsSize < 200000 ? 13 : 11;

          // eslint-disable-next-line no-console
          console.log(
            `[MapAutoFocus] Setting maxZoom to ${maxZoomLevel} based on bounds size`,
          );

          map.fitBounds(bounds, {
            padding: [40, 40], // More padding for better visibility
            maxZoom: maxZoomLevel,
            animate: true,
            duration: 0.5,
          });

          // Force invalidate size after bounds change
          map.invalidateSize();

          // Mark that we've focused on this boundary set
          lastFocusedIdsRef.current = boundaryIdsKey;
          hasFocusedRef.current = true;
        } else {
          // eslint-disable-next-line no-console
          console.warn('[MapAutoFocus] Calculated bounds are invalid');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[MapAutoFocus] Failed to auto-focus map:', err);
      }
    }, 100);

    return () => {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
      }
    };
    // Use boundaryIdsKey instead of boundaries to prevent infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaryIdsKey, enabled, map]);

  return null;
};

// Component for manual focus button
interface FocusButtonProps {
  boundaries: BoundaryFeature[];
}

function FocusButton({ boundaries }: FocusButtonProps): ReactElement | null {
  const map = useMap();

  const handleFocus = () => {
    if (boundaries.length > 0 && map) {
      try {
        const bounds = calculateBounds(boundaries);
        if (bounds && bounds.isValid()) {
          map.fitBounds(bounds, {
            padding: [30, 30], // More padding for better visibility
            maxZoom: 12, // Limit max zoom to show context
            animate: true,
            duration: 0.5,
          });
          map.invalidateSize();
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Failed to focus map:', err);
      }
    }
  };

  return (
    <button
      className="auto-focus-button"
      onClick={handleFocus}
      title="Fit to boundaries"
      type="button"
    >
      🎯
    </button>
  );
}

function DHIS2Map({
  data,
  width,
  height,
  databaseId,
  orgUnitColumn,
  metric,
  aggregationMethod = 'sum',
  boundaryLevels,
  levelBorderColors,
  enableDrill,
  colorScheme,
  linearColorScheme,
  useLinearColorScheme = true,
  opacity,
  strokeColor,
  strokeWidth,
  autoThemeBorders = false,
  showAllBoundaries = true,
  showLabels,
  labelType,
  labelFontSize,
  showLegend,
  legendPosition,
  legendClasses,
  legendType = 'auto',
  legendMin,
  legendMax,
  manualBreaks,
  manualColors,
  legendReverseColors = false,
  legendNoDataColor = { r: 204, g: 204, b: 204, a: 1 },
  tooltipColumns,
  onDrillDown,
  setDataMask,
  activeFilters = [],
  nativeFilters = {},
  datasetSql = '',
  isDHIS2Dataset = false,
  boundaryLoadMethod = 'geoFeatures',
}: DHIS2MapProps): ReactElement {
  // Debug logging for props
  // eslint-disable-next-line no-console
  console.log('[DHIS2Map] Component rendered with props:', {
    databaseId,
    boundaryLevels,
    boundaryLoadMethod,
    orgUnitColumn,
    metric,
    dataLength: data?.length,
    isDHIS2Dataset,
    hasDatasetSql: !!datasetSql,
  });

  const [boundaries, setBoundaries] = useState<BoundaryFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillState, setDrillState] = useState<DrillState>({
    currentLevel:
      Array.isArray(boundaryLevels) && boundaryLevels.length > 0
        ? Math.min(...boundaryLevels)
        : 1,
    parentId: null,
    parentName: null,
    breadcrumbs: [],
  });
  const [hoveredFeature, setHoveredFeature] = useState<string | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [filteredData, setFilteredData] = useState<Record<string, any>[]>(data);
  const [baseMapType, setBaseMapType] = useState<BaseMapType>('osmLight');
  const [loadTime, setLoadTime] = useState<number | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const [dhis2Data, setDhis2Data] = useState<Record<string, any>[] | null>(
    null,
  );
  const [dhis2DataLoading, setDhis2DataLoading] = useState(false);
  const [showDataPreview, setShowDataPreview] = useState(false);

  // Fetch and cache org unit levels for the control panel dropdown
  // This ensures the boundary_levels control shows actual DHIS2 levels
  useEffect(() => {
    if (!databaseId) return;

    const cacheKey = `dhis2_org_unit_levels_db${databaseId}`;

    // Check if already cached and valid
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { timestamp } = JSON.parse(cached);
        // Cache valid for 1 hour
        if (Date.now() - timestamp < 3600000) {
          return; // Already cached and valid
        }
      }
    } catch (e) {
      // Ignore cache check errors
    }

    // Fetch org unit levels from DHIS2
    SupersetClient.get({
      endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=organisationUnitLevels`,
    })
      .then(response => {
        if (response.json?.result) {
          const levels = response.json.result.sort(
            (a: any, b: any) => a.level - b.level,
          );
          // Cache for the control panel
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              data: levels,
              timestamp: Date.now(),
            }),
          );
          // eslint-disable-next-line no-console
          console.log(
            `[DHIS2Map] Cached ${levels.length} org unit levels for database ${databaseId}`,
          );
        }
      })
      .catch(() => {
        // Silently fail - control panel will use fallback choices
      });
  }, [databaseId]);

  // Fetch DHIS2 data using the preview endpoint when standard data is empty
  // This uses the same approach as DataPreview which successfully loads DHIS2 data
  useEffect(() => {
    // Auto-detect if this is a DHIS2 dataset by checking SQL for DHIS2 parameters
    const hasDHIS2Params = datasetSql && /\/\*\s*DHIS2:\s*(.+?)\s*\*\//i.test(datasetSql);
    const shouldFetchDHIS2 = isDHIS2Dataset || hasDHIS2Params;

    // eslint-disable-next-line no-console
    console.log('[DHIS2Map] DHIS2 detection:', {
      isDHIS2Dataset,
      hasDHIS2Params,
      shouldFetchDHIS2,
      datasetSqlLength: datasetSql?.length,
    });

    // Only fetch if:
    // 1. Standard data is empty or undefined
    // 2. This is a DHIS2 dataset (either from prop or auto-detected from SQL)
    // 3. We have a database ID and dataset SQL
    // 4. We're not already loading
    if (
      (data && data.length > 0) ||
      !shouldFetchDHIS2 ||
      !databaseId ||
      !datasetSql ||
      dhis2DataLoading
    ) {
      // eslint-disable-next-line no-console
      console.log('[DHIS2Map] Skipping DHIS2 data fetch:', {
        hasData: data && data.length > 0,
        shouldFetchDHIS2,
        hasDatabaseId: !!databaseId,
        hasDatasetSql: !!datasetSql,
        isLoading: dhis2DataLoading,
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      '[DHIS2Map] Standard data empty, fetching via DHIS2 chart data API',
    );
    // eslint-disable-next-line no-console
    console.log('[DHIS2Map] Dataset SQL:', datasetSql);

    setDhis2DataLoading(true);
    setError(null);

    // eslint-disable-next-line no-console
    console.log('[DHIS2Map] Fetching data with boundary level:', drillState.currentLevel, 'parent:', drillState.parentId);

    DHIS2DataLoader.fetchChartData(databaseId, datasetSql, 10000, drillState.currentLevel, drillState.parentId)
      .then(result => {
        if (result && result.rows.length > 0) {
          // eslint-disable-next-line no-console
          console.log('[DHIS2Map] Fetched DHIS2 data:', {
            rowCount: result.rows.length,
            columnCount: result.columns.length,
            sampleRow: result.rows[0],
            boundaryLevel: drillState.currentLevel,
          });

          setDhis2Data(result.rows);
          setFilteredData(result.rows);
          setLoading(false);
        } else {
          // eslint-disable-next-line no-console
          console.warn('[DHIS2Map] Empty data returned from DHIS2');
          setError(
            'No data returned from DHIS2. Verify: 1) DHIS2 database connection, 2) Dataset has DHIS2 parameters in SQL comment /* DHIS2: ... */, 3) Selected period and org units have data in DHIS2',
          );
          setLoading(false);
        }
      })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.error('[DHIS2Map] Failed to fetch DHIS2 data:', err);
        const errorMessage = err.message || 'Unknown error';
        // eslint-disable-next-line no-console
        console.error('[DHIS2Map] Error details:', {
          message: errorMessage,
          isDHIS2Format: errorMessage.includes('DHIS2'),
          isParameterError: errorMessage.includes('parameters'),
        });
        
        let displayError = `Failed to load DHIS2 data: ${errorMessage}`;
        if (errorMessage.includes('DHIS2 SQL format')) {
          displayError = `Invalid dataset SQL. Expected format: /* DHIS2: dx=id1;id2&pe=period&ou=ouId&ouMode=DESCENDANTS */`;
        }
        setError(displayError);
        setLoading(false);
      })
      .finally(() => {
        setDhis2DataLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isDHIS2Dataset, databaseId, datasetSql, drillState.currentLevel]);

  // Use DHIS2 data if available, otherwise use standard data
  const effectiveData = useMemo(() => {
    if (dhis2Data && dhis2Data.length > 0) {
      return dhis2Data;
    }
    return data;
  }, [data, dhis2Data]);

  const applyFilters = useCallback(
    (sourceData: Record<string, any>[]): Record<string, any>[] => {
      let result = [...sourceData];

      if (activeFilters && activeFilters.length > 0) {
        result = result.filter(row =>
          activeFilters.every(filter => {
            const cellValue = row[filter.col];
            const filterValues = Array.isArray(filter.val)
              ? filter.val
              : [filter.val];

            switch (filter.op) {
              case 'IN':
                return filterValues.includes(cellValue);
              case 'NOT IN':
                return !filterValues.includes(cellValue);
              case '==':
              case 'eq':
                return cellValue === filter.val;
              case '!=':
              case 'neq':
                return cellValue !== filter.val;
              case '>':
              case 'gt':
                return cellValue > filter.val;
              case '<':
              case 'lt':
                return cellValue < filter.val;
              case '>=':
              case 'gte':
                return cellValue >= filter.val;
              case '<=':
              case 'lte':
                return cellValue <= filter.val;
              default:
                return true;
            }
          }),
        );
      }

      if (nativeFilters && Object.keys(nativeFilters).length > 0) {
        result = result.filter(row =>
          Object.entries(nativeFilters).every(([filterId, filterValue]) => {
            if (!filterValue) {
              return true;
            }

            const filterVal = Array.isArray(filterValue)
              ? filterValue
              : [filterValue];
            const rowValue = row[filterId];

            return filterVal.includes(rowValue) || !filterVal.length;
          }),
        );
      }

      return result;
    },
    [activeFilters, nativeFilters],
  );

  useEffect(() => {
    const newFilteredData = applyFilters(effectiveData);
    setFilteredData(newFilteredData);
  }, [effectiveData, activeFilters, nativeFilters, applyFilters]);

  // Aggregate data by OrgUnit using the selected aggregation method
  // Build maps by both ID and name to support different data formats
  const { dataMap, dataMapByName } = useMemo(() => {
    const metricMapById = new Map<string, number>();
    const metricMapByName = new Map<string, number>();
    const orgUnitData = new Map<
      string,
      { values: number[]; rows: Record<string, any>[] }
    >();

    if (filteredData.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[DHIS2Map] No filtered data available');
      return {
        dataMap: metricMapById,
        dataMapByName: metricMapByName,
        aggregatedData: orgUnitData,
      };
    }

    const firstRow = filteredData[0];
    const availableColumns = Object.keys(firstRow);

    // eslint-disable-next-line no-console
    console.log(
      `[DHIS2Map] Data structure - orgUnitColumn="${orgUnitColumn}", metric="${metric}", aggregation="${aggregationMethod}"`,
    );
    // eslint-disable-next-line no-console
    console.log(`[DHIS2Map] Available columns (${availableColumns.length}):`, availableColumns);
    // eslint-disable-next-line no-console
    console.log(`[DHIS2Map] Total rows: ${filteredData.length}`);
    // eslint-disable-next-line no-console
    console.log(`[DHIS2Map] First row sample:`, firstRow);
    // eslint-disable-next-line no-console
    console.log('[DHIS2Map] Column value types:', Object.entries(firstRow).reduce((acc, [k, v]) => {
      acc[k] = typeof v;
      return acc;
    }, {} as Record<string, string>));

    // Find the actual column name - handle sanitized names
    const findColumn = (targetCol: string): string | undefined => {
      // Direct match first
      if (availableColumns.includes(targetCol)) {
        return targetCol;
      }
      // Try to find sanitized version (spaces replaced with underscores, etc.)
      const sanitized = targetCol
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '');
      const found = availableColumns.find(col => {
        const colSanitized = col
          .replace(/\s+/g, '_')
          .replace(/[^a-zA-Z0-9_]/g, '');
        return (
          colSanitized.toLowerCase() === sanitized.toLowerCase() ||
          col.toLowerCase() === targetCol.toLowerCase()
        );
      });
      return found;
    };

    const actualOrgUnitCol = findColumn(orgUnitColumn);
    const actualMetricCol = findColumn(metric);

    // eslint-disable-next-line no-console
    console.log('[DHIS2Map] Column resolution:', {
      requestedOrgUnit: orgUnitColumn,
      foundOrgUnit: actualOrgUnitCol,
      requestedMetric: metric,
      foundMetric: actualMetricCol,
      allColumnsCount: availableColumns.length,
    });

    if (!actualOrgUnitCol) {
      // Try alternative org unit column names as fallback
      let fallbackOrgUnitCol: string | undefined;
      const orgUnitPatterns = [
        'organisationunit',
        'orgunit',
        'ou',
        'facility',
        'region',
        'district',
        'level',
      ];
      
      for (const pattern of orgUnitPatterns) {
        const found = availableColumns.find(col =>
          col.toLowerCase().includes(pattern),
        );
        if (found) {
          fallbackOrgUnitCol = found;
          // eslint-disable-next-line no-console
          console.warn(
            `[DHIS2Map] OrgUnit column "${orgUnitColumn}" not found, using fallback: "${fallbackOrgUnitCol}"`,
          );
          break;
        }
      }

      if (!fallbackOrgUnitCol) {
        // eslint-disable-next-line no-console
        console.error(
          `[DHIS2Map] OrgUnit column "${orgUnitColumn}" not found. Available: ${availableColumns.join(', ')}`,
        );
        return {
          dataMap: metricMapById,
          dataMapByName: metricMapByName,
          aggregatedData: orgUnitData,
        };
      }
    }

    if (!actualMetricCol) {
      // Try alternative metric column names as fallback
      let fallbackMetricCol: string | undefined;
      
      // If metric looks like an aggregation function, try extracting the inner part
      const aggMatch = metric?.match(/^(SUM|AVG|COUNT|MIN|MAX)\s*\(\s*([^)]+)\s*\)$/i);
      if (aggMatch) {
        const innerCol = aggMatch[2];
        // eslint-disable-next-line no-console
        console.log(`[DHIS2Map] Attempting to extract inner column from aggregation: "${innerCol}"`);
        fallbackMetricCol = findColumn(innerCol);
      }

      // If still not found, try first numeric column
      if (!fallbackMetricCol && filteredData.length > 0) {
        for (const col of availableColumns) {
          if (typeof firstRow[col] === 'number') {
            fallbackMetricCol = col;
            // eslint-disable-next-line no-console
            console.warn(
              `[DHIS2Map] Metric column "${metric}" not found, using first numeric column: "${fallbackMetricCol}"`,
            );
            break;
          }
        }
      }

      if (!fallbackMetricCol) {
        // eslint-disable-next-line no-console
        console.error(
          `[DHIS2Map] Metric column "${metric}" not found. Available: ${availableColumns.join(', ')}`,
        );
        return {
          dataMap: metricMapById,
          dataMapByName: metricMapByName,
          aggregatedData: orgUnitData,
        };
      }

      // Use fallback columns
      const finalOrgUnitCol = actualOrgUnitCol || 
        availableColumns.find(col => col.toLowerCase().includes('orgunit')) ||
        availableColumns[0];
      const finalMetricCol = fallbackMetricCol;

      // eslint-disable-next-line no-console
      console.log(
        `[DHIS2Map] Using fallback columns: orgUnit="${finalOrgUnitCol}", metric="${finalMetricCol}"`,
      );

      // Process with fallback columns instead of early return
      filteredData.forEach(row => {
        const orgUnitId = row[finalOrgUnitCol];
        const value = row[finalMetricCol];

        if (orgUnitId && value !== undefined && value !== null) {
          const id = String(orgUnitId).trim();
          const numValue = Number(value);

          if (!Number.isNaN(numValue) && id) {
            const existing = orgUnitData.get(id);
            if (existing) {
              existing.values.push(numValue);
              existing.rows.push(row);
            } else {
              orgUnitData.set(id, {
                values: [numValue],
                rows: [row],
              });
            }
          }
        }
      });
    } else {
      // Normal flow with found columns
      // eslint-disable-next-line no-console
      console.log(
        `[DHIS2Map] Using columns: orgUnit="${actualOrgUnitCol}", metric="${actualMetricCol}"`,
      );

      // Collect values by OrgUnit
      if (actualOrgUnitCol && actualMetricCol) {
        filteredData.forEach(row => {
          const orgUnitId = row[actualOrgUnitCol];
          const value = row[actualMetricCol];

          if (orgUnitId && value !== undefined && value !== null) {
            const id = String(orgUnitId).trim();
            const numValue = Number(value);

            if (!Number.isNaN(numValue) && id) {
              const existing = orgUnitData.get(id);
              if (existing) {
                existing.values.push(numValue);
                existing.rows.push(row);
              } else {
                orgUnitData.set(id, {
                  values: [numValue],
                  rows: [row],
                });
              }
            }
          }
        });
      }
    }

    // Apply aggregation method to compute final values
    orgUnitData.forEach((data, id) => {
      let aggregatedValue: number;
      const { values } = data;

      switch (aggregationMethod) {
        case 'sum':
          aggregatedValue = values.reduce((a, b) => a + b, 0);
          break;
        case 'average':
          aggregatedValue = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'max':
          aggregatedValue = Math.max(...values);
          break;
        case 'min':
          aggregatedValue = Math.min(...values);
          break;
        case 'count':
          aggregatedValue = values.length;
          break;
        case 'latest':
          aggregatedValue = values[values.length - 1];
          break;
        default:
          aggregatedValue = values.reduce((a, b) => a + b, 0);
      }

      // Store by the original identifier (could be ID or name)
      metricMapById.set(id, aggregatedValue);
      // Also store by lowercase name for case-insensitive matching
      metricMapByName.set(id.toLowerCase(), aggregatedValue);
    });

    // eslint-disable-next-line no-console
    console.log(
      `[DHIS2Map] Aggregated ${orgUnitData.size} unique org units using ${aggregationMethod}`,
    );

    // Log sample of aggregated data
    const sampleEntries = Array.from(metricMapById.entries()).slice(0, 5);
    // eslint-disable-next-line no-console
    console.log('[DHIS2Map] Sample aggregated values:', sampleEntries);

    return {
      dataMap: metricMapById,
      dataMapByName: metricMapByName,
      aggregatedData: orgUnitData,
    };
  }, [filteredData, orgUnitColumn, metric, aggregationMethod]);

  // Calculate value range from actual data for proper legend scaling
  const valueRange = useMemo(() => {
    const values = Array.from(dataMap.values()).filter(
      v => Number.isFinite(v) && v > 0,
    );

    // Use manual min/max if provided and legend type is manual
    if (legendType === 'manual') {
      const manualMin =
        legendMin !== undefined && !Number.isNaN(Number(legendMin))
          ? Number(legendMin)
          : 0;
      const manualMax =
        legendMax !== undefined && !Number.isNaN(Number(legendMax))
          ? Number(legendMax)
          : 100;
      // eslint-disable-next-line no-console
      console.log(
        `[DHIS2Map] Using manual legend range: ${manualMin} - ${manualMax}`,
      );
      return { min: manualMin, max: manualMax, hasData: values.length > 0 };
    }

    if (values.length === 0) {
      // eslint-disable-next-line no-console
      console.log(
        '[DHIS2Map] No valid values found, using default range 0-100',
      );
      return { min: 0, max: 100, hasData: false };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    // eslint-disable-next-line no-console
    console.log(
      `[DHIS2Map] Value range from data: min=${min.toLocaleString()}, max=${max.toLocaleString()}, count=${values.length}`,
    );

    return {
      min,
      max,
      hasData: true,
    };
  }, [dataMap, legendType, legendMin, legendMax]);

  // Determine which color scheme to use based on useLinearColorScheme setting
  const activeColorScheme = useMemo(() => {
    if (useLinearColorScheme) {
      return linearColorScheme || 'superset_seq_1';
    }
    return colorScheme || 'supersetColors';
  }, [useLinearColorScheme, linearColorScheme, colorScheme]);

  const colorScale = useMemo(
    () =>
      getColorScale(
        activeColorScheme,
        valueRange.min,
        valueRange.max,
        legendClasses,
        legendReverseColors,
        useLinearColorScheme ? 'sequential' : 'categorical',
        manualBreaks,
        manualColors,
      ),
    [
      activeColorScheme,
      valueRange,
      legendClasses,
      legendReverseColors,
      useLinearColorScheme,
      manualBreaks,
      manualColors,
    ],
  );

  const fetchBoundaries = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.log('[DHIS2Map] fetchBoundaries called with:', {
      databaseId,
      boundaryLevels,
      type: typeof boundaryLevels,
      isArray: Array.isArray(boundaryLevels),
      length: boundaryLevels?.length,
    });

    if (!databaseId) {
      setError(t('No database selected'));
      return;
    }
    if (!boundaryLevels || boundaryLevels.length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[DHIS2Map] No boundary levels provided:', boundaryLevels);
      setError(
        t(
          'Please select at least one boundary level in the chart configuration',
        ),
      );
      return;
    }

    setLoading(true);
    setError(null);

    // eslint-disable-next-line no-console
    console.log(
      `[DHIS2Map] Fetching boundaries for levels: ${boundaryLevels.join(', ')} using loadDHIS2GeoFeatures`,
    );

    try {
      // Use the new loadDHIS2GeoFeatures utility which supports:
      // 1. Persistent storage using IndexedDB (survives browser restarts)
      // 2. Memory cache for fastest access
      // 3. Background refresh when cache is stale
      // 4. Both geoFeatures and geoJSON endpoints
      //
      // IMPORTANT: We set forceRefresh to ensure we always load the exact levels
      // requested by the user, not cached data from previous level selections
      const result = await loadDHIS2GeoFeatures({
        databaseId,
        levels: boundaryLevels,
        endpoint: boundaryLoadMethod, // User can select geoFeatures or geoJSON
        cacheKeyPrefix: 'dhis2map_boundaries',
        cacheDuration: 24 * 60 * 60 * 1000, // 24 hours persistent cache
        enableBackgroundRefresh: false, // Disable background refresh since we force refresh
        forceRefresh: true, // Always fetch fresh data to ensure correct levels
      });

      // eslint-disable-next-line no-console
      console.log('[DHIS2Map] loadDHIS2GeoFeatures result:', {
        totalCount: result.totalCount,
        fromCache: result.fromCache,
        backgroundRefreshInProgress: result.backgroundRefreshInProgress,
        loadTimeMs: result.loadTimeMs,
        levelCounts: Array.from(result.featuresByLevel.entries()).map(
          ([level, features]) => `L${level}: ${features.length}`,
        ),
        errors: result.errors,
      });

      if (result.errors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[DHIS2Map] Errors during boundary fetch:', result.errors);
      }

      if (result.totalCount === 0) {
        setError(t('No boundary data found for selected levels'));
        setLoading(false);
        return;
      }

      // Convert DHIS2GeoJSONFeature to BoundaryFeature format
      const convertedFeatures: BoundaryFeature[] = result.allFeatures
        .filter(
          (f: DHIS2GeoJSONFeature) =>
            f.geometry && f.geometry.coordinates && f.properties,
        )
        .map((f: DHIS2GeoJSONFeature) => ({
          type: 'Feature' as const,
          id: f.id,
          properties: {
            id: f.properties.id || f.id,
            name: f.properties.name || f.id,
            level: f.properties.level || 1,
            parentId: f.properties.parent || '',
            parentName: f.properties.parentName || '',
            hasChildrenWithCoordinates: f.properties.hasCoordinatesDown ?? true,
            hasParentWithCoordinates: f.properties.hasCoordinatesUp ?? true,
          },
          geometry: f.geometry,
        }));

      // Filter valid features (those with proper coordinates)
      const validFeatures = filterValidFeatures(convertedFeatures);

      // eslint-disable-next-line no-console
      console.log(
        `[DHIS2Map] Converted ${result.totalCount} features to ${validFeatures.length} valid BoundaryFeatures`,
      );

      // Debug: Log level distribution of loaded boundaries
      const levelCounts: Record<number, number> = {};
      validFeatures.forEach(f => {
        const level = f.properties.level;
        levelCounts[level] = (levelCounts[level] || 0) + 1;
      });
      // eslint-disable-next-line no-console
      console.log('[DHIS2Map] Boundary level distribution:', levelCounts);
      // eslint-disable-next-line no-console
      console.log('[DHIS2Map] Sample boundary:', validFeatures[0]?.properties);
      // eslint-disable-next-line no-console
      console.log('[DHIS2Map] levelBorderColors config:', levelBorderColors);

      setLoadTime(result.loadTimeMs);
      setCacheHit(result.fromCache);
      setBoundaries(validFeatures);
    } catch (err: any) {
      const message = err?.message || '';

      // eslint-disable-next-line no-console
      console.error('[DHIS2Map] Boundary fetch error:', err);

      if (message.includes('timed out') || message.includes('timeout')) {
        setError(
          t(
            'Request timed out - the DHIS2 server may be slow. Try refreshing.',
          ),
        );
      } else if (message.includes('401') || message.includes('authentication')) {
        setError(t('Authentication failed - check DHIS2 credentials'));
      } else if (message.includes('404')) {
        setError(t('Database not found'));
      } else if (message.includes('500')) {
        setError(t('Server error while fetching boundaries'));
      } else {
        setError(
          t('Failed to load map boundaries: ') + message,
        );
      }
    } finally {
      setLoading(false);
    }
  }, [databaseId, boundaryLevels, boundaryLoadMethod]);

  // Create a stable string representation of boundary levels for change detection
  const boundaryLevelsKey = useMemo(
    () => (boundaryLevels || []).sort((a, b) => a - b).join(','),
    [boundaryLevels],
  );

  // Fetch boundaries when levels change
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(`[DHIS2Map] Boundary levels changed to: ${boundaryLevelsKey}`, {
      levels: boundaryLevels,
      databaseId,
      hasFetchBoundaries: !!fetchBoundaries,
    });
    // Only call fetchBoundaries if we have valid level and database info
    if (databaseId && boundaryLevels && boundaryLevels.length > 0) {
      // Reset loading state and fetch new boundaries
      setLoading(true);
      fetchBoundaries();
    } else {
      // Log why we're not fetching boundaries
      // eslint-disable-next-line no-console
      console.warn('[DHIS2Map] Skipping boundary fetch:', {
        reason: !databaseId ? 'No database ID' : !boundaryLevels?.length ? 'No boundary levels' : 'Unknown',
        databaseId,
        boundaryLevels,
      });
      if (!databaseId) {
        setError(t('Database connection not found. Please ensure your dataset is linked to a DHIS2 database.'));
        setLoading(false);
      }
    }
  }, [boundaryLevelsKey, databaseId, fetchBoundaries]);

  // Debug: Log matching status when boundaries and data are available
  useEffect(() => {
    if (boundaries.length > 0 && dataMap.size > 0) {
      const boundaryIds = boundaries.map(b => b.id);
      const boundaryNames = boundaries.map(b => b.properties.name);
      const dataKeys = Array.from(dataMap.keys());

      // eslint-disable-next-line no-console
      console.log('[DHIS2Map] === Data Matching Debug ===');
      // eslint-disable-next-line no-console
      console.log('[DHIS2Map] Organization Unit Column:', orgUnitColumn);
      // eslint-disable-next-line no-console
      console.log(
        '[DHIS2Map] Boundary IDs (first 5):',
        boundaryIds.slice(0, 5),
      );
      // eslint-disable-next-line no-console
      console.log(
        '[DHIS2Map] Boundary Names (first 5):',
        boundaryNames.slice(0, 5),
      );
      // eslint-disable-next-line no-console
      console.log('[DHIS2Map] Data keys (first 10):', dataKeys.slice(0, 10));

      // Check how many boundaries have matching data
      let matchedById = 0;
      let matchedByName = 0;
      let noMatch = 0;
      const unmatchedBoundaries: string[] = [];

      boundaries.forEach(boundary => {
        if (dataMap.has(boundary.id)) {
          matchedById++;
        } else if (dataMapByName.has(boundary.properties.name?.toLowerCase())) {
          matchedByName++;
        } else if (dataMap.has(boundary.properties.name)) {
          matchedByName++;
        } else {
          noMatch++;
          if (unmatchedBoundaries.length < 5) {
            unmatchedBoundaries.push(
              `${boundary.id} (${boundary.properties.name})`,
            );
          }
        }
      });

      // eslint-disable-next-line no-console
      console.log(
        `[DHIS2Map] Match results: ${matchedById} by ID, ${matchedByName} by name, ${noMatch} no match`,
      );
      if (unmatchedBoundaries.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[DHIS2Map] Sample unmatched boundaries:', unmatchedBoundaries);
      }

      // If most boundaries have no data, provide detailed diagnostic info
      if (noMatch > boundaries.length * 0.8) {
        // eslint-disable-next-line no-console
        console.warn(
          '[DHIS2Map] WARNING: More than 80% of boundaries have no matching data. Check:',
          {
            orgUnitColumnValue: orgUnitColumn,
            dataFirstRow: filteredData[0],
            dataKeys: Object.keys(filteredData[0] || {}),
            boundaryIdSample: boundaryIds[0],
            boundaryNameSample: boundaryNames[0],
          },
        );
      }
    }
  }, [boundaries, dataMap, dataMapByName, orgUnitColumn, filteredData]);

  const handleDrillDown = useCallback(
    (feature: BoundaryFeature) => {
      if (!enableDrill || !feature.properties.hasChildrenWithCoordinates) {
        return;
      }

      const newLevel = drillState.currentLevel + 1;
      const newBreadcrumbs = [
        ...drillState.breadcrumbs,
        {
          id: feature.id,
          name: feature.properties.name,
          level: drillState.currentLevel,
        },
      ];

      setDrillState({
        currentLevel: newLevel,
        parentId: feature.id,
        parentName: feature.properties.name,
        breadcrumbs: newBreadcrumbs,
      });

      if (onDrillDown) {
        onDrillDown(feature.id, feature.properties.name);
      }

      if (setDataMask) {
        setDataMask({
          extraFormData: {
            filters: [
              {
                col: orgUnitColumn,
                op: 'IN',
                val: [feature.id],
              },
            ],
          },
          filterState: {
            value: [feature.id],
            label: feature.properties.name,
          },
        });
      }
    },
    [enableDrill, drillState, orgUnitColumn, onDrillDown, setDataMask],
  );

  const handleDrillUp = useCallback(
    (toIndex?: number) => {
      if (drillState.breadcrumbs.length === 0) {
        return;
      }

      let newBreadcrumbs: typeof drillState.breadcrumbs;
      let newLevel: number;
      let newParentId: string | null;
      let newParentName: string | null;

      const defaultLevel =
        boundaryLevels && boundaryLevels.length > 0
          ? Math.min(...boundaryLevels)
          : 1;

      if (toIndex !== undefined && toIndex >= 0) {
        newBreadcrumbs = drillState.breadcrumbs.slice(0, toIndex);
        const targetCrumb = drillState.breadcrumbs[toIndex - 1];
        newLevel = targetCrumb?.level + 1 || defaultLevel;
        newParentId = targetCrumb?.id || null;
        newParentName = targetCrumb?.name || null;
      } else {
        newBreadcrumbs = drillState.breadcrumbs.slice(0, -1);
        const lastCrumb = newBreadcrumbs[newBreadcrumbs.length - 1];
        newLevel = lastCrumb?.level + 1 || defaultLevel;
        newParentId = lastCrumb?.id || null;
        newParentName = lastCrumb?.name || null;
      }

      setDrillState({
        currentLevel: newLevel,
        parentId: newParentId,
        parentName: newParentName,
        breadcrumbs: newBreadcrumbs,
      });

      if (setDataMask) {
        setDataMask({
          extraFormData: {},
          filterState: {},
        });
      }
    },
    [drillState, boundaryLevels, setDataMask],
  );

  // Helper function to get value for a feature - tries ID first, then name
  // Supports DHIS2's various org unit identifier formats
  const getFeatureValue = useCallback(
    (feature: BoundaryFeature): number | undefined => {
      // Try by feature ID first (DHIS2 UID)
      let value = dataMap.get(feature.id);
      if (value !== undefined) {
        return value;
      }

      // Try by feature name (case-insensitive)
      const featureName = feature.properties?.name;
      if (featureName) {
        value = dataMapByName.get(featureName.toLowerCase());
        if (value !== undefined) {
          return value;
        }
      }

      // Try exact match on name in dataMap
      if (featureName) {
        value = dataMap.get(featureName);
        if (value !== undefined) {
          return value;
        }
      }

      // Try sanitized name matching (for DHIS2 data with spaces/special chars)
      if (featureName) {
        // Look for partial matches in data keys that contain the feature name
        for (const [key, val] of dataMap.entries()) {
          const keyLower = String(key).toLowerCase();
          const nameLower = featureName.toLowerCase();
          
          // Check if key contains name or name contains key (for partial matches)
          if (
            keyLower === nameLower ||
            keyLower.includes(nameLower) ||
            nameLower.includes(keyLower)
          ) {
            return val;
          }
        }
      }

      return undefined;
    },
    [dataMap, dataMapByName],
  );

  const getFeatureStyle = useCallback(
    (feature: BoundaryFeature) => {
      const value = getFeatureValue(feature);
      const noDataColorRgb = `rgba(${legendNoDataColor.r},${legendNoDataColor.g},${legendNoDataColor.b},${legendNoDataColor.a})`;

      // Determine fill color based on data
      let fillColor = noDataColorRgb;
      let fillOpacityValue = opacity;

      if (value !== undefined) {
        fillColor = colorScale(value);
      } else if (showAllBoundaries) {
        // Show boundary outline even without data
        fillOpacityValue = 0.1; // Very light fill for areas without data
      }

      const isHovered = hoveredFeature === feature.id;

      // Determine border color and width based on feature level or auto-theme
      let borderColor = `rgba(${strokeColor.r},${strokeColor.g},${strokeColor.b},${strokeColor.a})`;
      let borderWidth = strokeWidth;

      // Auto-theme borders: derive border color from fill color (darker shade)
      if (autoThemeBorders && value !== undefined) {
        borderColor = darkenColor(fillColor, 0.4); // 40% darker than fill
      } else if (levelBorderColors && levelBorderColors.length > 0) {
        // Get feature level - ensure it's a number
        const featureLevel = feature.properties.level;
        const levelConfig = levelBorderColors.find(
          lc => lc.level === featureLevel,
        );

        if (levelConfig) {
          borderColor = `rgba(${levelConfig.color.r},${levelConfig.color.g},${levelConfig.color.b},${levelConfig.color.a})`;
          if (levelConfig.width !== undefined) {
            borderWidth = levelConfig.width;
          }
        }
      }

      return {
        fillColor,
        fillOpacity: isHovered
          ? Math.min(fillOpacityValue + 0.2, 1)
          : fillOpacityValue,
        color: isHovered ? '#000000' : borderColor,
        weight: isHovered ? borderWidth + 1 : borderWidth,
      };
    },
    [
      getFeatureValue,
      colorScale,
      opacity,
      strokeColor,
      strokeWidth,
      autoThemeBorders,
      hoveredFeature,
      legendNoDataColor,
      levelBorderColors,
      showAllBoundaries,
    ],
  );

  const onEachFeature = useCallback(
    (feature: BoundaryFeature, layer: L.Layer) => {
      const value = getFeatureValue(feature);
      const tooltipContent = `
        <div class="dhis2-map-tooltip">
          <strong>${feature.properties.name}</strong>
          <br/>
          ${metric}: ${value !== undefined ? formatValue(value) : 'No data'}
          ${
            tooltipColumns
              ?.map(col => {
                const row = filteredData.find(
                  r =>
                    String(r[orgUnitColumn]) === feature.id ||
                    String(r[orgUnitColumn]).toLowerCase() ===
                      feature.properties.name?.toLowerCase(),
                );
                return row ? `<br/>${col}: ${row[col]}` : '';
              })
              .join('') || ''
          }
        </div>
      `;

      layer.bindTooltip(tooltipContent, {
        sticky: true,
        className: 'dhis2-map-tooltip-container',
      });

      layer.on({
        mouseover: () => setHoveredFeature(feature.id),
        mouseout: () => setHoveredFeature(null),
        click: () => handleDrillDown(feature),
      });

      if (showLabels && feature.geometry.type !== 'Point') {
        const center = L.geoJSON(feature).getBounds().getCenter();
        let labelText = '';

        switch (labelType) {
          case 'name':
            labelText = feature.properties.name;
            break;
          case 'value':
            labelText = value !== undefined ? formatValue(value) : '';
            break;
          case 'name_value':
            labelText = `${feature.properties.name}\n${
              value !== undefined ? formatValue(value) : ''
            }`;
            break;
          case 'percent': {
            const total = Array.from(dataMap.values()).reduce(
              (a, b) => a + b,
              0,
            );
            labelText =
              value !== undefined
                ? `${((value / total) * 100).toFixed(1)}%`
                : '';
            break;
          }
          default:
            break;
        }

        if (labelText && mapInstance) {
          L.marker(center, {
            icon: L.divIcon({
              className: 'map-label',
              html: `<div style="font-size: ${labelFontSize}px; text-align: center; white-space: nowrap;">${labelText}</div>`,
            }),
          }).addTo(mapInstance);
        }
      }
    },
    [
      getFeatureValue,
      dataMap,
      metric,
      filteredData,
      orgUnitColumn,
      tooltipColumns,
      showLabels,
      labelType,
      labelFontSize,
      handleDrillDown,
      mapInstance,
    ],
  );

  return (
    <MapWrapper style={{ width, height }}>
      {/* @ts-ignore - React 19 compatibility */}
      <MapContainer
        center={[0, 32]}
        zoom={6}
        zoomControl={false}
        ref={(mapRef: any) => mapRef && setMapInstance(mapRef)}
      >
        {/* @ts-ignore - React 19 compatibility */}
        <BaseMapLayer mapType={baseMapType} />

        {/* @ts-ignore - React 19 compatibility */}
        <ZoomControl position="topright" />

        {/* Auto-focus map when boundaries load */}
        {/* @ts-ignore - React 19 compatibility */}
        <MapAutoFocus boundaries={boundaries} enabled={!loading} />

        {/* Manual focus button */}
        {boundaries.length > 0 && <FocusButton boundaries={boundaries} />}

        {boundaries.length > 0 && (
          /* @ts-ignore - React 19 compatibility */
          <GeoJSON
            key={`levels-${boundaryLevelsKey}-drill-${drillState.currentLevel}-${drillState.parentId}-colors-${JSON.stringify(levelBorderColors?.map(lc => lc.color))}`}
            data={{ type: 'FeatureCollection', features: boundaries } as any}
            style={getFeatureStyle as any}
            onEachFeature={onEachFeature as any}
          />
        )}
      </MapContainer>

      {/* Base Map Selector */}
      {/* @ts-ignore - React 19 compatibility */}
      <BaseMapSelector currentMap={baseMapType} onMapChange={setBaseMapType} />

      {enableDrill && drillState.breadcrumbs.length > 0 && (
        /* @ts-ignore - React 19 compatibility */
        <DrillControls
          breadcrumbs={drillState.breadcrumbs}
          onDrillUp={() => handleDrillUp()}
          onBreadcrumbClick={index => handleDrillUp(index)}
        />
      )}

      {showLegend && (
        /* @ts-ignore - React 19 compatibility */
        <LegendPanel
          colorScale={colorScale}
          valueRange={valueRange}
          position={legendPosition}
          classes={legendClasses}
          metricName={metric}
          noDataColor={legendNoDataColor}
          levelBorderColors={levelBorderColors}
          showBoundaryLegend={boundaryLevels && boundaryLevels.length > 1}
          manualBreaks={manualBreaks}
          manualColors={manualColors}
        />
      )}

      {loading && (
        <div className="map-loading-overlay">
          <Spin size="large" />
          <span>{t('Loading boundaries...')}</span>
        </div>
      )}

      {error && <div className="map-error-message">{error}</div>}

      {/* Show message when no data is available (possibly due to query timeout) */}
      {!loading && !error && data.length === 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(255, 255, 255, 0.95)',
            padding: '20px 30px',
            borderRadius: '8px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
            zIndex: 1000,
            textAlign: 'center',
            maxWidth: '400px',
          }}
        >
          <div
            style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px' }}
          >
            {t('No data available')}
          </div>
          <div style={{ fontSize: '13px', color: '#666' }}>
            {t('The query returned no results. This could be due to:')}
            <ul
              style={{
                textAlign: 'left',
                margin: '10px 0',
                paddingLeft: '20px',
              }}
            >
              <li>{t('Query timeout (try reducing date range)')}</li>
              <li>{t('No data for selected filters')}</li>
              <li>{t('Missing data in the source system')}</li>
            </ul>
          </div>
        </div>
      )}

      {loadTime !== null && !loading && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            left: 10,
            background: cacheHit ? '#d4edda' : '#cce5ff',
            color: cacheHit ? '#155724' : '#004085',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            zIndex: 500,
            fontWeight: 500,
          }}
          title={cacheHit ? 'Loaded from browser cache' : 'Loaded from server'}
        >
          {cacheHit ? '⚡ ' : ''}
          {loadTime}ms
        </div>
      )}

      {dhis2Data && dhis2Data.length > 0 && !loading && (
        <button
          onClick={() => setShowDataPreview(!showDataPreview)}
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            background: showDataPreview ? '#0066cc' : '#ffffff',
            color: showDataPreview ? '#ffffff' : '#333333',
            border: '2px solid #0066cc',
            padding: '8px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            zIndex: 1001,
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
          }}
          title="Toggle data preview panel"
        >
          📊 Data Preview
        </button>
      )}

      {showDataPreview && (
        /* @ts-ignore - React 19 compatibility */
        <DataPreviewPanel
          data={dhis2Data}
          loading={dhis2DataLoading}
          onClose={() => setShowDataPreview(false)}
        />
      )}
    </MapWrapper>
  );
}

export default DHIS2Map;
