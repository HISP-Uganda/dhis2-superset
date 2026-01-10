# DHIS2 Map Visualization Implementation Plan

## Executive Summary

This plan outlines the complete implementation of DHIS2 map visualization capabilities in Superset, including:
- GeoJSON and shapefile boundary integration
- Choropleth maps for DHIS2 data
- Drill-down/drill-up navigation through org unit hierarchy
- Dynamic labels and tooltips
- Filter integration with dashboards
- Thematic mapping with data-driven styling

---

## 1. Architecture Overview

### 1.1 Component Structure

```
superset/
├── superset-frontend/
│   ├── src/
│   │   ├── visualizations/
│   │   │   └── DHIS2Map/
│   │   │       ├── index.ts                    # Plugin registration
│   │   │       ├── DHIS2MapChartPlugin.tsx     # Main plugin
│   │   │       ├── DHIS2Map.tsx                # Map component
│   │   │       ├── controlPanel.ts             # Chart controls
│   │   │       ├── transformProps.ts           # Data transformation
│   │   │       ├── buildQuery.ts               # Query builder
│   │   │       ├── types.ts                    # TypeScript types
│   │   │       └── components/
│   │   │           ├── MapContainer.tsx        # Leaflet/MapLibre container
│   │   │           ├── GeoJSONLayer.tsx        # GeoJSON rendering
│   │   │           ├── LegendPanel.tsx         # Map legend
│   │   │           ├── DrillControls.tsx       # Drill up/down controls
│   │   │           ├── TooltipContent.tsx      # Hover tooltips
│   │   │           └── MapFilters.tsx          # Map-specific filters
│   │   │
│   │   └── features/
│   │       └── dhis2/
│   │           └── boundaries/
│   │               ├── BoundaryService.ts      # Boundary fetching
│   │               ├── BoundaryCache.ts        # Caching layer
│   │               └── types.ts                # Boundary types
│   │
├── superset/
│   ├── dhis2/
│   │   ├── boundaries.py                       # Backend boundary API
│   │   └── geojson_utils.py                    # GeoJSON utilities
│   │
│   └── db_engine_specs/
│       └── dhis2_dialect.py                    # Add boundary methods
```

### 1.2 Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   DHIS2 Server  │────▶│  Superset API   │────▶│  Map Component  │
│                 │     │                 │     │                 │
│  - Analytics    │     │  - Fetch data   │     │  - Render map   │
│  - GeoFeatures  │     │  - Join geo     │     │  - Apply styles │
│  - OrgUnits     │     │  - Cache        │     │  - Handle events│
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 2. DHIS2 Map API Integration

### 2.1 DHIS2 GeoFeatures API

DHIS2 provides geographic data through several endpoints:

| Endpoint | Description | Use Case |
|----------|-------------|----------|
| `/api/geoFeatures` | GeoJSON for org units | Primary boundary source |
| `/api/organisationUnits` | Org unit metadata with coordinates | Point locations, hierarchy |
| `/api/maps` | Saved map configurations | Import existing DHIS2 maps |
| `/api/externalMapLayers` | External WMS/tile layers | Base maps |

### 2.2 GeoFeatures API Parameters

```
GET /api/geoFeatures?ou=ou:LEVEL-2&displayProperty=NAME

Parameters:
- ou: Organisation unit selection (LEVEL-n, UID, USER_ORGUNIT)
- displayProperty: NAME or SHORTNAME
- includeGroupSets: Include org unit group information
- coordinateField: Which coordinate field to use
```

### 2.3 Response Structure

```json
{
  "geoFeatures": [
    {
      "id": "O6uvpzGd5pu",           // Org unit UID
      "na": "Bo",                     // Name
      "hcd": false,                   // Has coordinates down (children)
      "hcu": true,                    // Has coordinates up (parent)
      "le": 2,                        // Level
      "pg": "at6UHUQatSo",           // Parent geography UID
      "pi": "ImspTQPwCqd",           // Parent UID
      "pn": "Sierra Leone",          // Parent name
      "ty": 2,                        // Type (1=point, 2=polygon, 3=multipolygon)
      "co": "[[[...coordinates...]]]" // GeoJSON coordinates (stringified)
    }
  ]
}
```

---

## 3. Implementation Phases

### Phase 1: Backend - Boundary Service (Week 1-2)

#### 3.1.1 Create Boundary API Endpoint

```python
# superset/dhis2/boundaries.py

from flask import Blueprint, request, jsonify
from superset import db
from superset.models.core import Database
import requests
import json

dhis2_boundaries_bp = Blueprint('dhis2_boundaries', __name__)

@dhis2_boundaries_bp.route('/api/v1/dhis2/<int:database_id>/boundaries/', methods=['GET'])
def get_boundaries(database_id: int):
    """
    Fetch GeoJSON boundaries from DHIS2
    
    Query Parameters:
    - level: Org unit level (1-6)
    - parent: Parent org unit UID
    - include_children: Include child boundaries
    - format: geojson (default) or topojson
    """
    database = db.session.query(Database).get(database_id)
    if not database:
        return jsonify({"error": "Database not found"}), 404
    
    # Parse DHIS2 connection
    connection_info = parse_dhis2_connection(database.sqlalchemy_uri_decrypted)
    
    # Build geoFeatures request
    level = request.args.get('level', type=int)
    parent = request.args.get('parent')
    
    ou_param = build_ou_parameter(level, parent)
    
    # Fetch from DHIS2
    geo_features = fetch_geo_features(connection_info, ou_param)
    
    # Convert to GeoJSON FeatureCollection
    geojson = convert_to_geojson(geo_features)
    
    return jsonify(geojson)


def convert_to_geojson(geo_features: list) -> dict:
    """Convert DHIS2 geoFeatures to standard GeoJSON FeatureCollection"""
    features = []
    
    for gf in geo_features:
        # Parse coordinates from string
        coordinates = json.loads(gf.get('co', '[]'))
        
        # Determine geometry type
        geo_type = {
            1: 'Point',
            2: 'Polygon', 
            3: 'MultiPolygon'
        }.get(gf.get('ty', 2), 'Polygon')
        
        feature = {
            "type": "Feature",
            "id": gf.get('id'),
            "properties": {
                "id": gf.get('id'),
                "name": gf.get('na'),
                "level": gf.get('le'),
                "parentId": gf.get('pi'),
                "parentName": gf.get('pn'),
                "hasChildrenWithCoordinates": gf.get('hcd', False),
                "hasParentWithCoordinates": gf.get('hcu', False),
            },
            "geometry": {
                "type": geo_type,
                "coordinates": coordinates
            }
        }
        features.append(feature)
    
    return {
        "type": "FeatureCollection",
        "features": features
    }
```

#### 3.1.2 Add Boundary Caching

```python
# superset/dhis2/boundary_cache.py

from flask_caching import Cache
from superset import cache_manager
import hashlib

BOUNDARY_CACHE_TIMEOUT = 3600 * 24  # 24 hours

def get_cached_boundaries(database_id: int, level: int, parent: str = None) -> dict:
    """Get boundaries from cache or fetch from DHIS2"""
    cache_key = f"dhis2_boundaries_{database_id}_{level}_{parent or 'root'}"
    
    cached = cache_manager.cache.get(cache_key)
    if cached:
        return cached
    
    # Fetch and cache
    boundaries = fetch_boundaries_from_dhis2(database_id, level, parent)
    cache_manager.cache.set(cache_key, boundaries, timeout=BOUNDARY_CACHE_TIMEOUT)
    
    return boundaries


def invalidate_boundary_cache(database_id: int):
    """Invalidate all boundary cache for a database"""
    # Implementation depends on cache backend
    pass
```

#### 3.1.3 Add to DHIS2 Dialect

```python
# Add to superset/db_engine_specs/dhis2_dialect.py

class DHIS2Connection:
    # ... existing code ...
    
    def fetch_geo_features(self, ou_params: str) -> list:
        """Fetch geographic features from DHIS2"""
        url = f"{self.base_url}/geoFeatures"
        params = {
            "ou": ou_params,
            "displayProperty": "NAME",
        }
        
        response = self._make_request(url, params)
        return response.get("geoFeatures", [])
    
    def fetch_org_unit_levels(self) -> list:
        """Fetch org unit level definitions"""
        url = f"{self.base_url}/organisationUnitLevels"
        params = {
            "fields": "id,level,displayName,name",
            "paging": "false"
        }
        
        response = self._make_request(url, params)
        return response.get("organisationUnitLevels", [])
    
    def fetch_org_unit_with_geometry(self, uid: str) -> dict:
        """Fetch single org unit with geometry"""
        url = f"{self.base_url}/organisationUnits/{uid}"
        params = {
            "fields": "id,name,displayName,level,parent[id,name],geometry,coordinates"
        }
        
        response = self._make_request(url, params)
        return response
```

---

### Phase 2: Frontend - Map Visualization Plugin (Week 3-5)

#### 3.2.1 Create Map Chart Plugin

```typescript
// superset-frontend/src/visualizations/DHIS2Map/index.ts

import { ChartPlugin } from '@superset-ui/core';
import buildQuery from './buildQuery';
import controlPanel from './controlPanel';
import transformProps from './transformProps';
import thumbnail from './thumbnail.png';
import DHIS2Map from './DHIS2Map';

export default class DHIS2MapChartPlugin extends ChartPlugin {
  constructor() {
    super({
      buildQuery,
      controlPanel,
      loadChart: () => import('./DHIS2Map'),
      metadata: {
        name: 'DHIS2 Map',
        description: 'Choropleth map for DHIS2 data with org unit boundaries',
        thumbnail,
        category: 'Map',
        tags: ['dhis2', 'map', 'geo', 'choropleth', 'boundaries'],
        behaviors: [
          'INTERACTIVE_CHART',
          'DRILL_TO_DETAIL',
        ],
      },
      transformProps,
    });
  }
}
```

#### 3.2.2 Control Panel Configuration

```typescript
// superset-frontend/src/visualizations/DHIS2Map/controlPanel.ts

import { t } from '@superset-ui/core';
import {
  ControlPanelConfig,
  sections,
  sharedControls,
} from '@superset-ui/chart-controls';

const config: ControlPanelConfig = {
  controlPanelSections: [
    sections.legacyRegularTime,
    {
      label: t('Map Configuration'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'org_unit_column',
            config: {
              type: 'SelectControl',
              label: t('Organisation Unit Column'),
              description: t('Column containing org unit identifiers'),
              mapStateToProps: state => ({
                choices: state.datasource?.columns?.map(col => [col.column_name, col.column_name]) || [],
              }),
            },
          },
        ],
        [
          {
            name: 'metric',
            config: {
              ...sharedControls.metric,
              label: t('Metric to Display'),
              description: t('The metric to visualize on the map'),
            },
          },
        ],
        [
          {
            name: 'boundary_level',
            config: {
              type: 'SelectControl',
              label: t('Boundary Level'),
              description: t('Organisation unit level for boundaries'),
              default: 2,
              choices: [
                [1, t('Level 1 (National)')],
                [2, t('Level 2 (Region)')],
                [3, t('Level 3 (District)')],
                [4, t('Level 4 (Sub-county)')],
                [5, t('Level 5 (Facility)')],
              ],
            },
          },
        ],
        [
          {
            name: 'enable_drill',
            config: {
              type: 'CheckboxControl',
              label: t('Enable Drill Down/Up'),
              description: t('Allow clicking on regions to drill down to child org units'),
              default: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Map Style'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'color_scheme',
            config: {
              type: 'ColorSchemeControl',
              label: t('Color Scheme'),
              description: t('Color scheme for choropleth'),
              default: 'superset_seq_1',
            },
          },
        ],
        [
          {
            name: 'opacity',
            config: {
              type: 'SliderControl',
              label: t('Fill Opacity'),
              default: 0.7,
              min: 0,
              max: 1,
              step: 0.1,
            },
          },
        ],
        [
          {
            name: 'stroke_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Border Color'),
              default: { r: 255, g: 255, b: 255, a: 1 },
            },
          },
        ],
        [
          {
            name: 'stroke_width',
            config: {
              type: 'SliderControl',
              label: t('Border Width'),
              default: 1,
              min: 0,
              max: 5,
              step: 0.5,
            },
          },
        ],
      ],
    },
    {
      label: t('Labels'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'show_labels',
            config: {
              type: 'CheckboxControl',
              label: t('Show Labels'),
              description: t('Display org unit names on the map'),
              default: true,
            },
          },
        ],
        [
          {
            name: 'label_type',
            config: {
              type: 'SelectControl',
              label: t('Label Content'),
              default: 'name',
              choices: [
                ['name', t('Name Only')],
                ['value', t('Value Only')],
                ['name_value', t('Name and Value')],
                ['percent', t('Percentage')],
              ],
            },
          },
        ],
        [
          {
            name: 'label_font_size',
            config: {
              type: 'SliderControl',
              label: t('Label Font Size'),
              default: 12,
              min: 8,
              max: 24,
              step: 1,
            },
          },
        ],
      ],
    },
    {
      label: t('Legend'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'show_legend',
            config: {
              type: 'CheckboxControl',
              label: t('Show Legend'),
              default: true,
            },
          },
        ],
        [
          {
            name: 'legend_position',
            config: {
              type: 'SelectControl',
              label: t('Legend Position'),
              default: 'bottomright',
              choices: [
                ['topleft', t('Top Left')],
                ['topright', t('Top Right')],
                ['bottomleft', t('Bottom Left')],
                ['bottomright', t('Bottom Right')],
              ],
            },
          },
        ],
        [
          {
            name: 'legend_classes',
            config: {
              type: 'SliderControl',
              label: t('Number of Classes'),
              description: t('Number of color classes in legend'),
              default: 5,
              min: 3,
              max: 9,
              step: 1,
            },
          },
        ],
      ],
    },
    {
      label: t('Tooltip'),
      expanded: false,
      controlSetRows: [
        [
          {
            name: 'tooltip_columns',
            config: {
              type: 'SelectControl',
              label: t('Tooltip Columns'),
              description: t('Additional columns to show in tooltip'),
              multi: true,
              mapStateToProps: state => ({
                choices: state.datasource?.columns?.map(col => [col.column_name, col.column_name]) || [],
              }),
            },
          },
        ],
      ],
    },
  ],
};

export default config;
```

#### 3.2.3 Main Map Component

```typescript
// superset-frontend/src/visualizations/DHIS2Map/DHIS2Map.tsx

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { styled, SupersetClient, t } from '@superset-ui/core';
import { MapContainer, TileLayer, GeoJSON, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DHIS2MapProps, BoundaryFeature, DrillState } from './types';
import LegendPanel from './components/LegendPanel';
import DrillControls from './components/DrillControls';
import TooltipContent from './components/TooltipContent';
import { getColorScale, formatValue, calculateBounds } from './utils';

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
      1px 1px 1px white,
      -1px -1px 1px white,
      1px -1px 1px white,
      -1px 1px 1px white;
  }
`;

const DHIS2Map: React.FC<DHIS2MapProps> = ({
  data,
  width,
  height,
  databaseId,
  orgUnitColumn,
  metric,
  boundaryLevel,
  enableDrill,
  colorScheme,
  opacity,
  strokeColor,
  strokeWidth,
  showLabels,
  labelType,
  labelFontSize,
  showLegend,
  legendPosition,
  legendClasses,
  tooltipColumns,
  onDrillDown,
  setDataMask,
}) => {
  // State
  const [boundaries, setBoundaries] = useState<BoundaryFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillState, setDrillState] = useState<DrillState>({
    currentLevel: boundaryLevel,
    parentId: null,
    parentName: null,
    breadcrumbs: [],
  });
  const [hoveredFeature, setHoveredFeature] = useState<string | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

  // Create data lookup map: orgUnitId -> value
  const dataMap = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach(row => {
      const orgUnitId = row[orgUnitColumn];
      const value = row[metric];
      if (orgUnitId && value !== undefined) {
        map.set(orgUnitId, Number(value));
      }
    });
    return map;
  }, [data, orgUnitColumn, metric]);

  // Calculate value range for color scale
  const valueRange = useMemo(() => {
    const values = Array.from(dataMap.values()).filter(v => !isNaN(v));
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [dataMap]);

  // Color scale
  const colorScale = useMemo(
    () => getColorScale(colorScheme, valueRange.min, valueRange.max, legendClasses),
    [colorScheme, valueRange, legendClasses]
  );

  // Fetch boundaries from DHIS2
  const fetchBoundaries = useCallback(async (level: number, parent?: string) => {
    setLoading(true);
    setError(null);
    
    try {
      let url = `/api/v1/dhis2/${databaseId}/boundaries/?level=${level}`;
      if (parent) {
        url += `&parent=${parent}`;
      }
      
      const response = await SupersetClient.get({ endpoint: url });
      const geojson = response.json;
      
      if (geojson?.features) {
        setBoundaries(geojson.features);
        
        // Fit map to bounds
        if (mapInstance && geojson.features.length > 0) {
          const bounds = calculateBounds(geojson.features);
          mapInstance.fitBounds(bounds, { padding: [20, 20] });
        }
      }
    } catch (err) {
      setError(t('Failed to load map boundaries'));
      console.error('Boundary fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [databaseId, mapInstance]);

  // Initial load
  useEffect(() => {
    fetchBoundaries(drillState.currentLevel, drillState.parentId);
  }, [drillState.currentLevel, drillState.parentId, fetchBoundaries]);

  // Handle drill down
  const handleDrillDown = useCallback((feature: BoundaryFeature) => {
    if (!enableDrill || !feature.properties.hasChildrenWithCoordinates) {
      return;
    }
    
    const newLevel = drillState.currentLevel + 1;
    const newBreadcrumbs = [
      ...drillState.breadcrumbs,
      { id: feature.id, name: feature.properties.name, level: drillState.currentLevel },
    ];
    
    setDrillState({
      currentLevel: newLevel,
      parentId: feature.id,
      parentName: feature.properties.name,
      breadcrumbs: newBreadcrumbs,
    });
    
    // Emit drill event for cross-filtering
    if (onDrillDown) {
      onDrillDown(feature.id, feature.properties.name);
    }
    
    // Update data mask for filtering
    if (setDataMask) {
      setDataMask({
        extraFormData: {
          filters: [{
            col: orgUnitColumn,
            op: 'IN',
            val: [feature.id],
          }],
        },
        filterState: {
          value: [feature.id],
          label: feature.properties.name,
        },
      });
    }
  }, [enableDrill, drillState, orgUnitColumn, onDrillDown, setDataMask]);

  // Handle drill up
  const handleDrillUp = useCallback((toIndex?: number) => {
    if (drillState.breadcrumbs.length === 0) {
      return;
    }
    
    let newBreadcrumbs: typeof drillState.breadcrumbs;
    let newLevel: number;
    let newParentId: string | null;
    let newParentName: string | null;
    
    if (toIndex !== undefined && toIndex >= 0) {
      // Drill to specific breadcrumb
      newBreadcrumbs = drillState.breadcrumbs.slice(0, toIndex);
      const targetCrumb = drillState.breadcrumbs[toIndex - 1];
      newLevel = targetCrumb?.level + 1 || boundaryLevel;
      newParentId = targetCrumb?.id || null;
      newParentName = targetCrumb?.name || null;
    } else {
      // Drill up one level
      newBreadcrumbs = drillState.breadcrumbs.slice(0, -1);
      const lastCrumb = newBreadcrumbs[newBreadcrumbs.length - 1];
      newLevel = lastCrumb?.level + 1 || boundaryLevel;
      newParentId = lastCrumb?.id || null;
      newParentName = lastCrumb?.name || null;
    }
    
    setDrillState({
      currentLevel: newLevel,
      parentId: newParentId,
      parentName: newParentName,
      breadcrumbs: newBreadcrumbs,
    });
    
    // Clear data mask
    if (setDataMask) {
      setDataMask({
        extraFormData: {},
        filterState: {},
      });
    }
  }, [drillState, boundaryLevel, setDataMask]);

  // Style function for GeoJSON features
  const getFeatureStyle = useCallback((feature: BoundaryFeature) => {
    const value = dataMap.get(feature.id);
    const fillColor = value !== undefined ? colorScale(value) : '#cccccc';
    const isHovered = hoveredFeature === feature.id;
    
    return {
      fillColor,
      fillOpacity: isHovered ? Math.min(opacity + 0.2, 1) : opacity,
      color: isHovered ? '#000000' : `rgba(${strokeColor.r},${strokeColor.g},${strokeColor.b},${strokeColor.a})`,
      weight: isHovered ? strokeWidth + 1 : strokeWidth,
    };
  }, [dataMap, colorScale, opacity, strokeColor, strokeWidth, hoveredFeature]);

  // Event handlers for each feature
  const onEachFeature = useCallback((feature: BoundaryFeature, layer: L.Layer) => {
    // Tooltip
    const value = dataMap.get(feature.id);
    const tooltipContent = `
      <div class="dhis2-map-tooltip">
        <strong>${feature.properties.name}</strong>
        <br/>
        ${metric}: ${value !== undefined ? formatValue(value) : 'No data'}
        ${tooltipColumns?.map(col => {
          const row = data.find(r => r[orgUnitColumn] === feature.id);
          return row ? `<br/>${col}: ${row[col]}` : '';
        }).join('') || ''}
      </div>
    `;
    
    layer.bindTooltip(tooltipContent, {
      sticky: true,
      className: 'dhis2-map-tooltip-container',
    });
    
    // Events
    layer.on({
      mouseover: () => setHoveredFeature(feature.id),
      mouseout: () => setHoveredFeature(null),
      click: () => handleDrillDown(feature),
    });
    
    // Labels
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
          labelText = `${feature.properties.name}\n${value !== undefined ? formatValue(value) : ''}`;
          break;
        case 'percent':
          const total = Array.from(dataMap.values()).reduce((a, b) => a + b, 0);
          labelText = value !== undefined ? `${((value / total) * 100).toFixed(1)}%` : '';
          break;
      }
      
      if (labelText) {
        L.marker(center, {
          icon: L.divIcon({
            className: 'map-label',
            html: `<div style="font-size: ${labelFontSize}px; text-align: center; white-space: nowrap;">${labelText}</div>`,
          }),
        }).addTo(mapInstance!);
      }
    }
  }, [
    dataMap, metric, data, orgUnitColumn, tooltipColumns,
    showLabels, labelType, labelFontSize, handleDrillDown, mapInstance
  ]);

  // Render
  return (
    <MapWrapper style={{ width, height }}>
      <MapContainer
        center={[0, 32]}  // Default center (adjust based on your DHIS2 instance)
        zoom={6}
        zoomControl={false}
        whenCreated={setMapInstance}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />
        
        <ZoomControl position="topright" />
        
        {boundaries.length > 0 && (
          <GeoJSON
            key={`${drillState.currentLevel}-${drillState.parentId}`}
            data={{ type: 'FeatureCollection', features: boundaries }}
            style={getFeatureStyle}
            onEachFeature={onEachFeature}
          />
        )}
      </MapContainer>
      
      {/* Drill Controls */}
      {enableDrill && drillState.breadcrumbs.length > 0 && (
        <DrillControls
          breadcrumbs={drillState.breadcrumbs}
          onDrillUp={handleDrillUp}
          onBreadcrumbClick={(index) => handleDrillUp(index)}
        />
      )}
      
      {/* Legend */}
      {showLegend && (
        <LegendPanel
          colorScale={colorScale}
          valueRange={valueRange}
          position={legendPosition}
          classes={legendClasses}
          metricName={metric}
        />
      )}
      
      {/* Loading overlay */}
      {loading && (
        <div className="map-loading-overlay">
          <span>{t('Loading boundaries...')}</span>
        </div>
      )}
      
      {/* Error message */}
      {error && (
        <div className="map-error-message">
          {error}
        </div>
      )}
    </MapWrapper>
  );
};

export default DHIS2Map;
```

#### 3.2.4 Legend Component

```typescript
// superset-frontend/src/visualizations/DHIS2Map/components/LegendPanel.tsx

import React from 'react';
import { styled, t } from '@superset-ui/core';
import { formatValue } from '../utils';

interface LegendPanelProps {
  colorScale: (value: number) => string;
  valueRange: { min: number; max: number };
  position: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
  classes: number;
  metricName: string;
}

const LegendContainer = styled.div<{ position: string }>`
  position: absolute;
  ${({ position }) => {
    const [vertical, horizontal] = [
      position.includes('top') ? 'top: 10px' : 'bottom: 30px',
      position.includes('left') ? 'left: 10px' : 'right: 10px',
    ];
    return `${vertical}; ${horizontal};`;
  }}
  background: white;
  padding: 10px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  min-width: 120px;
`;

const LegendTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 12px;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  margin: 4px 0;
  font-size: 11px;
`;

const ColorBox = styled.div<{ color: string }>`
  width: 20px;
  height: 14px;
  background: ${({ color }) => color};
  margin-right: 8px;
  border: 1px solid rgba(0, 0, 0, 0.2);
`;

const LegendPanel: React.FC<LegendPanelProps> = ({
  colorScale,
  valueRange,
  position,
  classes,
  metricName,
}) => {
  const step = (valueRange.max - valueRange.min) / classes;
  const breaks = Array.from({ length: classes }, (_, i) => valueRange.min + step * i);
  
  return (
    <LegendContainer position={position}>
      <LegendTitle>{metricName}</LegendTitle>
      {breaks.map((breakValue, index) => {
        const nextValue = index < breaks.length - 1 ? breaks[index + 1] : valueRange.max;
        return (
          <LegendItem key={index}>
            <ColorBox color={colorScale(breakValue + step / 2)} />
            <span>
              {formatValue(breakValue)} - {formatValue(nextValue)}
            </span>
          </LegendItem>
        );
      })}
      <LegendItem>
        <ColorBox color="#cccccc" />
        <span>{t('No data')}</span>
      </LegendItem>
    </LegendContainer>
  );
};

export default LegendPanel;
```

#### 3.2.5 Drill Controls Component

```typescript
// superset-frontend/src/visualizations/DHIS2Map/components/DrillControls.tsx

import React from 'react';
import { styled, t } from '@superset-ui/core';
import { Button } from 'antd';
import { ArrowLeftOutlined, HomeOutlined } from '@ant-design/icons';

interface Breadcrumb {
  id: string;
  name: string;
  level: number;
}

interface DrillControlsProps {
  breadcrumbs: Breadcrumb[];
  onDrillUp: () => void;
  onBreadcrumbClick: (index: number) => void;
}

const ControlsContainer = styled.div`
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const BreadcrumbContainer = styled.div`
  background: white;
  padding: 8px 12px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const BreadcrumbItem = styled.span<{ clickable?: boolean }>`
  color: ${({ clickable }) => (clickable ? '#1890ff' : '#333')};
  cursor: ${({ clickable }) => (clickable ? 'pointer' : 'default')};
  font-size: 12px;
  
  &:hover {
    ${({ clickable }) => clickable && 'text-decoration: underline;'}
  }
`;

const Separator = styled.span`
  color: #999;
  margin: 0 4px;
`;

const DrillControls: React.FC<DrillControlsProps> = ({
  breadcrumbs,
  onDrillUp,
  onBreadcrumbClick,
}) => {
  return (
    <ControlsContainer>
      <BreadcrumbContainer>
        <Button
          size="small"
          icon={<HomeOutlined />}
          onClick={() => onBreadcrumbClick(0)}
          title={t('Return to top level')}
        />
        <Button
          size="small"
          icon={<ArrowLeftOutlined />}
          onClick={onDrillUp}
          title={t('Go up one level')}
        />
        <Separator>|</Separator>
        <BreadcrumbItem clickable onClick={() => onBreadcrumbClick(0)}>
          {t('All')}
        </BreadcrumbItem>
        {breadcrumbs.map((crumb, index) => (
          <React.Fragment key={crumb.id}>
            <Separator>›</Separator>
            <BreadcrumbItem
              clickable={index < breadcrumbs.length - 1}
              onClick={() => index < breadcrumbs.length - 1 && onBreadcrumbClick(index + 1)}
            >
              {crumb.name}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbContainer>
    </ControlsContainer>
  );
};

export default DrillControls;
```

---

### Phase 3: Data Integration (Week 6)

#### 3.3.1 Query Builder

```typescript
// superset-frontend/src/visualizations/DHIS2Map/buildQuery.ts

import { buildQueryContext, QueryFormData } from '@superset-ui/core';

export default function buildQuery(formData: QueryFormData) {
  const {
    org_unit_column,
    metric,
    tooltip_columns = [],
    ...otherFormData
  } = formData;

  return buildQueryContext(formData, baseQueryObject => {
    // Include org unit column and metric
    const columns = [org_unit_column];
    const metrics = [metric];
    
    // Add tooltip columns if specified
    if (tooltip_columns.length > 0) {
      columns.push(...tooltip_columns);
    }
    
    return [
      {
        ...baseQueryObject,
        columns,
        metrics,
        // Group by org unit to aggregate data
        groupby: [org_unit_column],
      },
    ];
  });
}
```

#### 3.3.2 Transform Props

```typescript
// superset-frontend/src/visualizations/DHIS2Map/transformProps.ts

import { ChartProps, QueryFormData } from '@superset-ui/core';
import { DHIS2MapProps } from './types';

export default function transformProps(chartProps: ChartProps): DHIS2MapProps {
  const { 
    width, 
    height, 
    formData, 
    queriesData,
    datasource,
    hooks,
  } = chartProps;
  
  const {
    org_unit_column,
    metric,
    boundary_level,
    enable_drill,
    color_scheme,
    opacity,
    stroke_color,
    stroke_width,
    show_labels,
    label_type,
    label_font_size,
    show_legend,
    legend_position,
    legend_classes,
    tooltip_columns,
  } = formData as QueryFormData;

  const data = queriesData[0]?.data || [];
  
  // Extract database ID from datasource
  const databaseId = datasource?.database?.id;

  return {
    width,
    height,
    data,
    databaseId,
    orgUnitColumn: org_unit_column,
    metric: typeof metric === 'string' ? metric : metric?.label || 'value',
    boundaryLevel: boundary_level || 2,
    enableDrill: enable_drill !== false,
    colorScheme: color_scheme || 'superset_seq_1',
    opacity: opacity ?? 0.7,
    strokeColor: stroke_color || { r: 255, g: 255, b: 255, a: 1 },
    strokeWidth: stroke_width ?? 1,
    showLabels: show_labels !== false,
    labelType: label_type || 'name',
    labelFontSize: label_font_size || 12,
    showLegend: show_legend !== false,
    legendPosition: legend_position || 'bottomright',
    legendClasses: legend_classes || 5,
    tooltipColumns: tooltip_columns || [],
    setDataMask: hooks?.setDataMask,
  };
}
```

---

### Phase 4: Advanced Features (Week 7-8)

#### 3.4.1 Thematic Layer Support

```typescript
// superset-frontend/src/visualizations/DHIS2Map/components/ThematicLayers.tsx

import React from 'react';
import { GeoJSON } from 'react-leaflet';
import { ThematicLayerConfig } from '../types';

interface ThematicLayersProps {
  layers: ThematicLayerConfig[];
  dataMap: Map<string, Record<string, number>>;
}

const ThematicLayers: React.FC<ThematicLayersProps> = ({ layers, dataMap }) => {
  return (
    <>
      {layers.map((layer, index) => (
        <GeoJSON
          key={`thematic-${index}`}
          data={layer.boundaries}
          style={(feature) => {
            const values = dataMap.get(feature?.id);
            const value = values?.[layer.metric];
            return {
              fillColor: layer.colorScale(value),
              fillOpacity: layer.opacity,
              color: layer.strokeColor,
              weight: layer.strokeWidth,
            };
          }}
        />
      ))}
    </>
  );
};

export default ThematicLayers;
```

#### 3.4.2 External Base Map Layers

```typescript
// superset-frontend/src/visualizations/DHIS2Map/components/BaseMaps.tsx

import React from 'react';
import { TileLayer, WMSTileLayer } from 'react-leaflet';

export const BASE_MAPS = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  terrain: {
    name: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap',
  },
  dark: {
    name: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CartoDB',
  },
  light: {
    name: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CartoDB',
  },
};

interface BaseMapLayerProps {
  mapType: keyof typeof BASE_MAPS;
}

export const BaseMapLayer: React.FC<BaseMapLayerProps> = ({ mapType }) => {
  const config = BASE_MAPS[mapType];
  return <TileLayer url={config.url} attribution={config.attribution} />;
};
```

#### 3.4.3 Point/Facility Layer

```typescript
// superset-frontend/src/visualizations/DHIS2Map/components/FacilityLayer.tsx

import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { FacilityData } from '../types';

interface FacilityLayerProps {
  facilities: FacilityData[];
  dataMap: Map<string, number>;
  metric: string;
  colorScale: (value: number) => string;
  radiusScale: (value: number) => number;
  onFacilityClick?: (facility: FacilityData) => void;
}

const FacilityLayer: React.FC<FacilityLayerProps> = ({
  facilities,
  dataMap,
  metric,
  colorScale,
  radiusScale,
  onFacilityClick,
}) => {
  return (
    <>
      {facilities.map(facility => {
        const value = dataMap.get(facility.id);
        if (!facility.coordinates) return null;
        
        return (
          <CircleMarker
            key={facility.id}
            center={[facility.coordinates.lat, facility.coordinates.lng]}
            radius={value ? radiusScale(value) : 5}
            pathOptions={{
              fillColor: value ? colorScale(value) : '#999',
              fillOpacity: 0.7,
              color: '#fff',
              weight: 1,
            }}
            eventHandlers={{
              click: () => onFacilityClick?.(facility),
            }}
          >
            <Popup>
              <strong>{facility.name}</strong>
              <br />
              {metric}: {value ?? 'No data'}
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
};

export default FacilityLayer;
```

---

## 4. Type Definitions

```typescript
// superset-frontend/src/visualizations/DHIS2Map/types.ts

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

export interface DHIS2MapProps {
  width: number;
  height: number;
  data: Record<string, any>[];
  databaseId: number;
  orgUnitColumn: string;
  metric: string;
  boundaryLevel: number;
  enableDrill: boolean;
  colorScheme: string;
  opacity: number;
  strokeColor: { r: number; g: number; b: number; a: number };
  strokeWidth: number;
  showLabels: boolean;
  labelType: 'name' | 'value' | 'name_value' | 'percent';
  labelFontSize: number;
  showLegend: boolean;
  legendPosition: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
  legendClasses: number;
  tooltipColumns: string[];
  onDrillDown?: (orgUnitId: string, orgUnitName: string) => void;
  setDataMask?: (dataMask: any) => void;
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
```

---

## 5. Utility Functions

```typescript
// superset-frontend/src/visualizations/DHIS2Map/utils.ts

import * as d3 from 'd3';
import { getSequentialSchemeRegistry } from '@superset-ui/core';
import L from 'leaflet';
import { BoundaryFeature } from './types';

export function getColorScale(
  schemeName: string,
  min: number,
  max: number,
  classes: number
): (value: number) => string {
  const schemeRegistry = getSequentialSchemeRegistry();
  const scheme = schemeRegistry.get(schemeName);
  const colors = scheme?.colors || d3.schemeBlues[classes];
  
  return d3.scaleQuantize<string>()
    .domain([min, max])
    .range(colors.slice(0, classes));
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

export function calculateBounds(features: BoundaryFeature[]): L.LatLngBounds {
  const geojsonLayer = L.geoJSON({
    type: 'FeatureCollection',
    features: features as any,
  });
  return geojsonLayer.getBounds();
}

export function getRadiusScale(
  min: number,
  max: number,
  minRadius: number = 5,
  maxRadius: number = 30
): (value: number) => number {
  return d3.scaleSqrt()
    .domain([min, max])
    .range([minRadius, maxRadius]);
}

export function parseCoordinates(coordString: string): number[][][] | null {
  try {
    return JSON.parse(coordString);
  } catch {
    return null;
  }
}

export function getFeatureCenter(feature: BoundaryFeature): [number, number] {
  const geojsonLayer = L.geoJSON(feature as any);
  const center = geojsonLayer.getBounds().getCenter();
  return [center.lat, center.lng];
}
```

---

## 6. Dashboard Integration

### 6.1 Cross-Filtering with Maps

```typescript
// Map chart emits filter when region is clicked
const handleDrillDown = (feature: BoundaryFeature) => {
  // Update data mask for cross-filtering
  setDataMask({
    extraFormData: {
      filters: [{
        col: orgUnitColumn,  // e.g., 'District'
        op: 'IN',
        val: [feature.properties.name],
      }],
    },
    filterState: {
      value: [feature.properties.name],
      label: feature.properties.name,
    },
  });
};

// Other charts in dashboard automatically filter
// based on the selected region
```

### 6.2 Native Filter Integration

Maps should respond to dashboard native filters for:
- Period selection
- Organisation unit hierarchy filters
- Data element filters

---

## 7. Testing Plan

### 7.1 Unit Tests

```typescript
// superset-frontend/src/visualizations/DHIS2Map/DHIS2Map.test.tsx

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DHIS2Map from './DHIS2Map';
import { mockBoundaries, mockData } from './testUtils';

test('renders map with boundaries', async () => {
  render(
    <DHIS2Map
      data={mockData}
      boundaries={mockBoundaries}
      // ... other props
    />
  );
  
  await waitFor(() => {
    expect(screen.getByRole('presentation')).toBeInTheDocument();
  });
});

test('handles drill down on region click', async () => {
  const onDrillDown = jest.fn();
  
  render(
    <DHIS2Map
      data={mockData}
      boundaries={mockBoundaries}
      enableDrill
      onDrillDown={onDrillDown}
    />
  );
  
  // Click on a region
  fireEvent.click(screen.getByTestId('region-acholi'));
  
  expect(onDrillDown).toHaveBeenCalledWith('SUvODYOcaVf', 'Acholi');
});

test('displays correct color for data values', () => {
  // Test color scale application
});

test('shows legend with correct breaks', () => {
  // Test legend rendering
});
```

### 7.2 Integration Tests

```python
# tests/integration_tests/dhis2/test_boundaries.py

import pytest
from superset import app

def test_fetch_boundaries(client, dhis2_database):
    """Test boundary fetching from DHIS2"""
    response = client.get(
        f'/api/v1/dhis2/{dhis2_database.id}/boundaries/?level=2'
    )
    assert response.status_code == 200
    data = response.json
    assert 'features' in data
    assert len(data['features']) > 0

def test_boundary_caching(client, dhis2_database):
    """Test that boundaries are cached"""
    # First request
    response1 = client.get(f'/api/v1/dhis2/{dhis2_database.id}/boundaries/?level=2')
    
    # Second request should be cached
    response2 = client.get(f'/api/v1/dhis2/{dhis2_database.id}/boundaries/?level=2')
    
    assert response1.json == response2.json
```

---

## 8. Implementation Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **Phase 1**: Backend API | Week 1-2 | Boundary endpoints, caching, DHIS2 integration |
| **Phase 2**: Map Plugin | Week 3-5 | Basic map visualization, control panel, styling |
| **Phase 3**: Data Integration | Week 6 | Query builder, data transformation, tooltips |
| **Phase 4**: Advanced Features | Week 7-8 | Drill down/up, cross-filtering, multiple layers |
| **Phase 5**: Testing & Polish | Week 9 | Tests, documentation, performance optimization |

---

## 9. Dependencies

### Frontend
```json
{
  "dependencies": {
    "leaflet": "^1.9.4",
    "react-leaflet": "^4.2.1",
    "@types/leaflet": "^1.9.8",
    "d3-scale": "^4.0.2",
    "d3-scale-chromatic": "^3.0.0"
  }
}
```

### Backend
```python
# requirements/base.txt
geojson>=3.0.0
shapely>=2.0.0  # For geometry operations if needed
```

---

## 10. Configuration Options Summary

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `org_unit_column` | string | - | Column containing org unit IDs |
| `metric` | metric | - | Metric to visualize |
| `boundary_level` | number | 2 | Starting org unit level |
| `enable_drill` | boolean | true | Enable drill down/up |
| `color_scheme` | string | superset_seq_1 | Color scheme name |
| `opacity` | number | 0.7 | Fill opacity (0-1) |
| `stroke_color` | color | white | Border color |
| `stroke_width` | number | 1 | Border width |
| `show_labels` | boolean | true | Show region labels |
| `label_type` | enum | name | Label content type |
| `label_font_size` | number | 12 | Label font size |
| `show_legend` | boolean | true | Show legend |
| `legend_position` | enum | bottomright | Legend position |
| `legend_classes` | number | 5 | Number of legend classes |
| `base_map` | enum | osm | Base map type |

---

## 11. Future Enhancements

1. **Split View Maps**: Compare two time periods or indicators side by side
2. **Animation**: Animate changes over time periods
3. **Clustering**: Cluster facility points at lower zoom levels
4. **Custom Symbology**: Support for custom markers and symbols
5. **Print/Export**: Export maps as images or PDFs
6. **Offline Support**: Cache boundaries for offline viewing
7. **3D Visualization**: Extrude boundaries based on data values
8. **Heat Maps**: Heat map visualization for point data

