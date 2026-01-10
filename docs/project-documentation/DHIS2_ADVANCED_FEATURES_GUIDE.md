# DHIS2 Map Advanced Features & Enhancements Guide

## Overview

This guide covers all advanced features and enhancements available in the DHIS2 Map visualization for Apache Superset.

---

## Table of Contents

1. [Legend & Map Keys](#legend--map-keys)
2. [Animation Over Time](#animation-over-time)
3. [Split View Comparison](#split-view-comparison)
4. [Facility Clustering](#facility-clustering)
5. [Custom Symbology](#custom-symbology)
6. [Print & Export](#print--export)
7. [Offline Support](#offline-support)
8. [3D Visualization](#3d-visualization)
9. [Heat Maps](#heat-maps)
10. [Auto Theming](#auto-theming)

---

## Legend & Map Keys

### Enhanced Legend Panel

The legend now supports multiple display modes for flexible UI customization.

#### Features

- **Detailed Mode**: Full legend with all color breaks displayed
- **Compact Mode**: Minimized legend showing only metric range
- **Hidden Mode**: Legend completely hidden for maximum map view
- **Mode Switching**: Users can toggle between modes on-the-fly
- **Custom Background**: Configurable legend background color/opacity
- **Backdrop Blur**: Modern glass-morphism effect for better readability

#### Usage

```typescript
<LegendPanel
  colorScale={colorScale}
  valueRange={valueRange}
  position="bottomright"
  classes={5}
  metricName="Cases per 1000"
  mode="detailed"
  onModeChange={handleModeChange}
  autoTheme={true}
  backgroundColor="rgba(255, 255, 255, 0.95)"
/>
```

#### Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `mode` | `'compact' \| 'detailed' \| 'hidden'` | `'detailed'` | Initial legend display mode |
| `onModeChange` | `(mode: LegendMode) => void` | - | Callback when mode changes |
| `autoTheme` | `boolean` | `false` | Auto-select theme based on data |
| `backgroundColor` | `string` | `'rgba(255, 255, 255, 0.95)'` | Legend container background |

### Map Keys Component

Separate control panel for displaying map keys and symbology.

#### Features

- **Symbol Display**: Shows map symbols, colors, and meanings
- **Collapsible Interface**: Expand/collapse to show/hide details
- **Custom Descriptions**: Add descriptive text for each key
- **Multiple Positions**: Place keys anywhere on the map

#### Usage

```typescript
const mapKeys = [
  {
    symbol: '●',
    label: 'High Cases',
    description: '≥ 100 cases per 1000',
    color: '#d94040',
  },
  {
    symbol: '●',
    label: 'Medium Cases',
    description: '50-99 cases per 1000',
    color: '#faad14',
  },
  {
    symbol: '●',
    label: 'Low Cases',
    description: '< 50 cases per 1000',
    color: '#52c41a',
  },
];

<MapKeys
  keys={mapKeys}
  position="topleft"
  title="Indicator Legend"
  collapsible={true}
/>
```

---

## Animation Over Time

### Time Period Animation

Animate map changes across multiple time periods with playback controls.

#### Features

- **Play/Pause Controls**: Start and stop animation
- **Period Slider**: Jump to any specific period
- **Previous/Next Buttons**: Step through periods manually
- **Adjustable Speed**: Control animation speed (200ms - 3000ms)
- **Auto-Play**: Start animation automatically
- **Current Period Display**: Shows currently displayed period

#### Usage

```typescript
const periods = ['2020', '2021', '2022', '2023', '2024'];

const handlePeriodChange = (period: string, index: number) => {
  console.log(`Showing data for ${period}`);
  // Fetch and display data for this period
};

<AnimationControls
  periods={periods}
  onPeriodChange={handlePeriodChange}
  autoPlay={false}
  speed={1000}
/>
```

#### How It Works

1. **Data Preparation**: Ensure your dataset has a period/time column
2. **Period Extraction**: Extract unique periods and sort chronologically
3. **Animation Loop**: Cycles through periods at configurable speed
4. **Manual Control**: Users can use slider or buttons to navigate

#### Example Dashboard Setup

**Query Configuration:**
```sql
SELECT
  district_id,
  district_name,
  year as period,
  cases as metric_value
FROM health_indicators
WHERE year BETWEEN 2020 AND 2024
ORDER BY year
```

**Animation Setup:**
```typescript
const periods = ['2020', '2021', '2022', '2023', '2024'];
const onPeriodChange = (period) => {
  // Filter data to selected period
  const periodData = data.filter(row => row.period === period);
  // Update map with filtered data
};
```

---

## Split View Comparison

### Side-by-Side Map Comparison

Compare two metrics, periods, or datasets side-by-side.

#### Features

- **Dual Map Display**: Show two maps simultaneously
- **Synchronized Navigation**: Zoom/pan both maps together
- **Synchronized Filtering**: Cross-filter applies to both maps
- **Flexible Comparison Modes**: Compare metrics, periods, or indicators
- **Divider Control**: Draggable divider to adjust split position
- **Responsive Layout**: Adapts to container size

#### Usage

```typescript
import { SplitViewManager } from './utils/enhancedFeatures';

// Calculate layout
const layout = SplitViewManager.calculateSplitLayout(width, height);

// Render two maps side-by-side
<div style={{ position: 'relative', width, height }}>
  <div style={{
    position: 'absolute',
    left: layout.leftMap.x,
    top: layout.leftMap.y,
    width: layout.leftMap.width,
    height: layout.leftMap.height,
  }}>
    <DHIS2Map {...leftMapProps} />
  </div>
  
  <div style={{
    position: 'absolute',
    left: layout.rightMap.x,
    top: layout.rightMap.y,
    width: layout.rightMap.width,
    height: layout.rightMap.height,
  }}>
    <DHIS2Map {...rightMapProps} />
  </div>
  
  {/* Divider */}
  <div style={{
    position: 'absolute',
    left: layout.divider.x,
    top: layout.divider.y,
    width: layout.divider.width,
    height: layout.divider.height,
    background: '#999',
    cursor: 'ew-resize',
  }} />
</div>
```

#### Comparison Examples

**Example 1: Period Comparison (2020 vs 2024)**
```typescript
const leftMapProps = {
  ...commonProps,
  data: data2020,
  metric: 'cases',
};

const rightMapProps = {
  ...commonProps,
  data: data2024,
  metric: 'cases',
};
```

**Example 2: Indicator Comparison (Cases vs Deaths)**
```typescript
const leftMapProps = {
  ...commonProps,
  data: dataWithCases,
  metric: 'confirmed_cases',
};

const rightMapProps = {
  ...commonProps,
  data: dataWithDeaths,
  metric: 'deaths',
};
```

---

## Facility Clustering

### Dynamic Point Clustering

Automatically cluster facility points at lower zoom levels for better performance.

#### Features

- **Zoom-Based Clustering**: Cluster points when zoomed out
- **Cluster Indicators**: Show count of points in each cluster
- **Auto Unclustering**: Expand clusters when zooming in
- **Custom Cluster Styling**: Configure cluster appearance
- **Performance Optimization**: Reduces rendering overhead

#### Usage

```typescript
import {
  ClusteringManager,
  ClusterConfig,
} from './utils/enhancedFeatures';

const clusterConfig: ClusterConfig = {
  enableClustering: true,
  clusterZoomLevel: 10,  // Cluster points below zoom level 10
  clusterRadius: 50,      // Cluster radius in pixels
};

// Group features by clusters
const clusters = ClusteringManager.groupFeaturesByCluster(
  features,
  currentZoomLevel,
  clusterConfig.clusterZoomLevel,
);

// Render clusters
clusters.forEach((clusterFeatures, clusterId) => {
  if (clusterFeatures.length === 1) {
    // Single feature - render as normal marker
  } else {
    // Multiple features - render as cluster
    const clusterCount = clusterFeatures.length;
    // Render cluster marker with count
  }
});
```

#### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableClustering` | `boolean` | `false` | Enable/disable clustering |
| `clusterZoomLevel` | `number` | `10` | Zoom level threshold for clustering |
| `clusterRadius` | `number` | `50` | Cluster radius in pixels |

#### Performance Benefits

- **Reduces DOM Elements**: 1000s of points → 10s of clusters
- **Faster Rendering**: Less geometry to render
- **Smoother Interactions**: Better zoom/pan performance
- **Improved Mobile Experience**: Especially on low-power devices

---

## Custom Symbology

### Custom Markers & Symbols

Use custom shapes, colors, and symbols to represent data.

#### Features

- **Multiple Symbol Types**: Circle, Square, Triangle, Diamond, Star
- **Custom Colors**: Any hex or RGB color
- **Border Styling**: Configurable border color and width
- **SVG Generation**: Dynamic SVG symbol creation
- **Size Control**: Adjustable symbol sizes

#### Usage

```typescript
import {
  CustomSymbologyManager,
  CustomSymbol,
} from './utils/enhancedFeatures';

const symbols: CustomSymbol[] = [
  {
    type: 'circle',
    color: '#1890ff',
    size: 24,
    borderColor: '#000',
    borderWidth: 1,
  },
  {
    type: 'star',
    color: '#faad14',
    size: 28,
    borderColor: '#666',
    borderWidth: 2,
  },
];

// Generate SVG for symbol
const svg = CustomSymbologyManager.getSymbolSVG(symbols[0]);

// Use SVG as marker icon
const icon = L.divIcon({
  html: svg,
  className: 'custom-symbol-marker',
  iconSize: [24, 24],
});

// Add marker to map
L.marker(coordinates, { icon }).addTo(map);
```

#### Symbol Types

**Circle**
```typescript
{
  type: 'circle',
  color: '#52c41a',
  size: 20,
}
```

**Square**
```typescript
{
  type: 'square',
  color: '#1890ff',
  size: 20,
}
```

**Triangle**
```typescript
{
  type: 'triangle',
  color: '#ff7a45',
  size: 24,
}
```

**Diamond**
```typescript
{
  type: 'diamond',
  color: '#722ed1',
  size: 20,
}
```

**Star**
```typescript
{
  type: 'star',
  color: '#faad14',
  size: 28,
}
```

#### Use Cases

- **Facility Types**: Different symbols for clinic, hospital, lab
- **Data Quality**: Stars for verified data, circles for provisional
- **Alert Status**: Red triangle for alert, green circle for normal
- **Priority Levels**: Different sizes and colors for priority

---

## Print & Export

### Export Maps as Images

Export the map as PNG, SVG, or printable PDF.

#### Features

- **Multiple Formats**: PNG, SVG, and PDF export
- **High Resolution**: Configurable export resolution
- **Legend Inclusion**: Include or exclude legend in export
- **Scale Bar**: Optional map scale bar in export
- **Print Support**: Direct browser print functionality
- **Batch Export**: Export multiple maps at once

#### Usage

```typescript
import { PrintExportManager } from './utils/enhancedFeatures';

// Export as PNG
await PrintExportManager.exportAsImage(
  mapElement,
  'dhis2-map-2024',
  'png',
);

// Export as SVG
await PrintExportManager.exportAsImage(
  mapElement,
  'dhis2-map-2024',
  'svg',
);

// Export as PDF
await PrintExportManager.exportAsPDF(
  mapElement,
  'dhis2-map-2024',
);
```

#### UI Component

```typescript
<PrintExportControls
  mapElement={mapRef.current}
  position="topright"
/>
```

**Controls**:
- 📷 PNG: Export as PNG image
- 📄 SVG: Export as vector SVG
- 🖨️ Print: Open browser print dialog

#### Export Options

| Option | Type | Description |
|--------|------|-------------|
| `format` | `'png' \| 'svg' \| 'pdf'` | Export format |
| `resolution` | `number` | DPI for raster formats (default: 96) |
| `includeScale` | `boolean` | Include scale bar |
| `includeLegend` | `boolean` | Include legend panel |

#### Workflow Examples

**Single Map Export**
```typescript
const handleExport = async () => {
  await PrintExportManager.exportAsImage(
    mapElement,
    `health-map-${new Date().toISOString().split('T')[0]}`,
    'png',
  );
};
```

**Batch Export Multiple Maps**
```typescript
async function exportMultipleMaps(maps: HTMLElement[]) {
  for (let i = 0; i < maps.length; i++) {
    await PrintExportManager.exportAsImage(
      maps[i],
      `map-${i+1}`,
      'png',
    );
    // Add delay to avoid overwhelming the browser
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
```

---

## Offline Support

### Offline Boundary Caching

Cache boundary data for offline viewing and faster loads.

#### Features

- **IndexedDB Storage**: Browser-based persistent storage
- **Automatic Caching**: Cache boundaries on first load
- **Smart Expiration**: Configurable cache TTL
- **Offline Detection**: Detect online/offline status
- **Manual Cache Management**: Clear cache button
- **Status Indicator**: Show online/offline/cached status

#### Usage

```typescript
import {
  OfflineCacheManager,
  OfflineCacheConfig,
} from './utils/enhancedFeatures';

const cacheConfig: OfflineCacheConfig = {
  enableOfflineCache: true,
  maxCacheSize: 50 * 1024 * 1024,  // 50 MB
  cacheDuration: 24 * 60 * 60 * 1000,  // 24 hours
};

// Cache boundaries
await OfflineCacheManager.cacheBoundaries(
  databaseId,
  boundaryLevel,
  geojsonData,
);

// Retrieve cached boundaries
const cachedData = await OfflineCacheManager.getCachedBoundaries(
  databaseId,
  boundaryLevel,
  maxAge,
);

// Clear cache when needed
await OfflineCacheManager.clearCache();
```

#### UI Status Indicator

```typescript
<OfflineCacheStatus position="bottomleft" />
```

**Status Display**:
- 🟢 Online: Connected to server
- 🟡 Cached: Using cached data
- 🔴 Error: Cache error or offline

#### Workflow

1. **First Load**: Fetch boundaries from DHIS2 API
2. **Auto-Cache**: Store in IndexedDB after fetch
3. **Offline Access**: Use cached data when offline
4. **Expiration**: Clear old cache after TTL
5. **Manual Clear**: User can clear cache via button

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableOfflineCache` | `boolean` | `false` | Enable offline caching |
| `maxCacheSize` | `number` | `50 * 1024 * 1024` | Max cache size (bytes) |
| `cacheDuration` | `number` | `24 * 60 * 60 * 1000` | Cache TTL (milliseconds) |

---

## 3D Visualization

### 3D Boundary Extrusion

Extrude boundaries to show data values as height.

#### Features

- **Height Mapping**: Map data values to extrusion height
- **Min/Max Height**: Configure extrusion range
- **Smooth Gradients**: Smooth height transitions
- **Color + 3D**: Combine color scale with extrusion
- **Performance Optimized**: Efficient 3D rendering

#### Usage

```typescript
import {
  Heat3DVisualizationManager,
  Heat3DConfig,
} from './utils/enhancedFeatures';

const 3dConfig: Heat3DConfig = {
  enable3D: true,
  extrusionMin: 10,   // Minimum height in pixels
  extrusionMax: 200,  // Maximum height in pixels
};

// Calculate extrusion for a value
const extrusionHeight = Heat3DVisualizationManager.calculateExtrusion(
  value,
  minValue,
  maxValue,
  3dConfig.extrusionMin,
  3dConfig.extrusionMax,
);

// Generate 3D geometry
const geometry3D = Heat3DVisualizationManager.generate3DGeometry(
  feature,
  extrusionHeight,
);
```

#### Visual Examples

**Extrusion Mapping Example:**
- 0 cases → 10px height (base level)
- 50 cases → 110px height (middle)
- 100 cases → 210px height (peak)

#### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enable3D` | `boolean` | `false` | Enable 3D visualization |
| `extrusionMin` | `number` | `10` | Minimum extrusion height |
| `extrusionMax` | `number` | `100` | Maximum extrusion height |

#### Use Cases

- **Epidemiology**: Show case counts as height
- **Hospital Capacity**: Show occupancy rates
- **Population Density**: Show relative populations
- **Any Numeric Metric**: Visualize any quantitative data

---

## Heat Maps

### Heat Map Visualization

Visualize point density and intensity using heat maps.

#### Features

- **Density Visualization**: Show concentration of points
- **Intensity Coloring**: Color represents data intensity
- **Radius Control**: Adjust heat map blur radius
- **Opacity Control**: Control transparency
- **Zoom-Based**: Intensity adjusts with zoom level

#### Usage

```typescript
import {
  HeatMapManager,
  HeatMapConfig,
} from './utils/enhancedFeatures';

const heatMapConfig: HeatMapConfig = {
  enableHeatMap: true,
  radius: 50,          // Pixel radius
  maxZoom: 18,         // Max zoom for heat map
  minOpacity: 0.2,     // Minimum opacity
};

// Generate heat map points
const heatmapPoints = HeatMapManager.generateHeatmapPoints(
  features,
  valueMap,
  maxValue,
);

// Format: [lat, lng, intensity]
// intensity: 0-1 (normalized)
```

#### Data Format

```typescript
// Each point: [latitude, longitude, intensity (0-1)]
const points: Array<[number, number, number]> = [
  [-1.2345, 36.7890, 0.9],  // High intensity
  [-1.2350, 36.7885, 0.5],  // Medium intensity
  [-1.2340, 36.7895, 0.2],  // Low intensity
];
```

#### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableHeatMap` | `boolean` | `false` | Enable heat map |
| `radius` | `number` | `50` | Blur radius in pixels |
| `maxZoom` | `number` | `18` | Maximum zoom level |
| `minOpacity` | `number` | `0.2` | Minimum opacity |

#### Workflow

```typescript
// 1. Extract facility locations and values
const facilities = data.filter(row => row.latitude && row.longitude);

// 2. Create value map
const valueMap = new Map();
facilities.forEach(f => {
  valueMap.set(f.facility_id, f.confirmed_cases);
});

// 3. Generate heat map points
const maxValue = Math.max(...valueMap.values());
const heatmapPoints = HeatMapManager.generateHeatmapPoints(
  features,
  valueMap,
  maxValue,
);

// 4. Render heat map layer on map
```

---

## Auto Theming

### Automatic Theme Selection

Automatically select map theme based on data characteristics.

#### Features

- **Data-Driven Theming**: Theme based on data values
- **Statistical Analysis**: Analyzes data distribution
- **Smart Colors**: Selects accent colors based on variance
- **Light/Dark Mode**: Auto-selects background based on data
- **Professional Appearance**: Maintains visual hierarchy

#### Usage

```typescript
import { AutoThemingManager } from './utils/enhancedFeatures';

// Get theme based on data
const theme = AutoThemingManager.getAutoTheme(
  dataValues,
  colorScheme,
);

// Apply theme
const legendProps = {
  ...defaultProps,
  backgroundColor: theme.backgroundColor,
};

// Use accent color for special elements
const accentColor = theme.accentColor;
```

#### Theme Properties

```typescript
{
  backgroundColor: string;   // Container background (light/dark)
  textColor: string;         // Text color for contrast
  accentColor: string;       // Accent color (#ff7875 red or #52c41a green)
}
```

#### Theming Logic

1. **Calculate Statistics**:
   - Average value
   - Data variance
   - Standard deviation

2. **Select Background**:
   - High data values → Dark background
   - Low data values → Light background

3. **Select Text Color**:
   - Contrast with background
   - Ensure readability

4. **Select Accent**:
   - High variance → Red (#ff7875) for alerts
   - Low variance → Green (#52c41a) for stable

#### Examples

**High-Variance Data** (alarm situation):
```
- Background: Dark
- Text: White
- Accent: Red
```

**Low-Variance Data** (normal situation):
```
- Background: Light
- Text: Dark
- Accent: Green
```

---

## Integration Example

### Complete Feature Example

Here's a complete example integrating multiple features:

```typescript
import DHIS2Map from './DHIS2Map';
import LegendPanel from './components/LegendPanel';
import MapKeys from './components/MapKeys';
import AnimationControls from './components/AnimationControls';
import PrintExportControls from './components/PrintExportControls';
import OfflineCacheStatus from './components/OfflineCacheStatus';
import {
  ClusteringManager,
  AutoThemingManager,
  OfflineCacheManager,
} from './utils/enhancedFeatures';

export const AdvancedDHIS2Map = ({
  data,
  boundaries,
  databaseId,
  ...props
}) => {
  const [legendMode, setLegendMode] = useState('detailed');
  const [currentPeriod, setCurrentPeriod] = useState('2024');
  const mapRef = useRef<HTMLDivElement>(null);

  // Auto theming
  const dataValues = data.map(row => row.cases);
  const theme = AutoThemingManager.getAutoTheme(dataValues, 'superset_seq_1');

  // Extract periods for animation
  const periods = [...new Set(data.map(row => row.period))].sort();

  // Offline caching
  useEffect(() => {
    OfflineCacheManager.cacheBoundaries(databaseId, props.boundaryLevel, boundaries);
  }, [boundaries, databaseId, props.boundaryLevel]);

  return (
    <div ref={mapRef} style={{ position: 'relative', width: '100%', height: '600px' }}>
      <DHIS2Map
        {...props}
        data={data}
        width={800}
        height={600}
        databaseId={databaseId}
      />

      {/* Enhanced Legend */}
      <LegendPanel
        colorScale={colorScale}
        valueRange={valueRange}
        position="bottomright"
        classes={5}
        metricName="Cases"
        mode={legendMode}
        onModeChange={setLegendMode}
        backgroundColor={theme.backgroundColor}
      />

      {/* Map Keys */}
      <MapKeys
        keys={[
          {
            symbol: '●',
            label: 'High',
            color: '#d94040',
          },
          {
            symbol: '●',
            label: 'Low',
            color: '#52c41a',
          },
        ]}
        position="topleft"
      />

      {/* Animation Controls */}
      {periods.length > 1 && (
        <AnimationControls
          periods={periods}
          onPeriodChange={(period) => setCurrentPeriod(period)}
          autoPlay={false}
          speed={1000}
        />
      )}

      {/* Print/Export */}
      <PrintExportControls
        mapElement={mapRef.current}
        position="topright"
      />

      {/* Offline Status */}
      <OfflineCacheStatus position="bottomleft" />
    </div>
  );
};
```

---

## Best Practices

### Performance

1. **Disable unused features**: Only enable features you need
2. **Optimize clustering**: Adjust cluster zoom level for your data
3. **Cache strategically**: Cache only essential boundaries
4. **Limit animation periods**: Use 5-10 periods for smooth animation

### UX

1. **Provide clear legends**: Explain all symbology
2. **Use consistent colors**: Maintain color meaning across maps
3. **Label periods**: Show clear time information in animation
4. **Test on mobile**: Ensure controls work on small screens

### Data

1. **Validate data**: Ensure coordinates are valid
2. **Handle missing data**: Gracefully show "No data" states
3. **Normalize values**: Scale values appropriately for 3D/heat maps
4. **Document assumptions**: Explain any data transformations

---

## Troubleshooting

### Animation Not Playing

**Solution**: Verify periods are unique and sortable strings

### 3D Extrusion Too Tall

**Solution**: Adjust `extrusionMax` value or normalize data values

### Clustering Not Working

**Solution**: Ensure zoom level is below `clusterZoomLevel`

### Export Failed

**Solution**: Check browser console for errors, ensure map element is visible

### Offline Cache Not Working

**Solution**: Verify IndexedDB is enabled in browser, check available storage

---

## API Reference

### Component Props

All feature components are optional and accept standard positioning props.

### Utility Classes

All manager classes expose static methods for integration into custom code.

### Storage Limits

IndexedDB typically supports 50MB-1GB depending on browser.

---

## Related Documentation

- [DHIS2 Dashboard Integration Guide](./DHIS2_DASHBOARD_INTEGRATION_GUIDE.md)
- [DHIS2 Map Implementation Status](./DHIS2_MAP_IMPLEMENTATION_STATUS.md)
- [DHIS2 Map Visualization Plan](./DHIS2_MAP_VISUALIZATION_PLAN.md)

---

## Support

For issues with advanced features:

1. Check browser console for errors
2. Verify feature prerequisites (e.g., multiple time periods for animation)
3. Review configuration options for each feature
4. Consult this guide's troubleshooting section
