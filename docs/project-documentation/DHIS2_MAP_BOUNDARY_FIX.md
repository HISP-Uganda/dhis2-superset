# DHIS2 Map - Enhanced Features & Boundary Fix

## New Features (v4)

### Multi-Level Boundary Support
- **Select multiple boundary levels** (e.g., Region, District, Sub-county) in a single map
- Each level can have **distinct border colors and widths** for visual differentiation
- Supports drill-down navigation between levels

### Enhanced Styling Options
- **Color Scheme**: Choose from sequential, diverging, categorical, or perceptual color palettes
- **Legend Color Set**: Select the type of color palette for the legend
- **Fill Opacity**: Control the transparency of boundary fills (0-1)
- **Default Border Color**: Set the default border color for all levels
- **Border Width**: Control the thickness of boundary borders
- **Level Border Colors**: Define custom colors and widths per boundary level
- **Show All Boundaries**: Display boundary outlines even for areas without data

### Boundary Level Legend
- When multiple levels are selected, the legend automatically shows a **Boundary Levels** section
- Each level is displayed with its border style (color and width) and name (National, Region, District, etc.)

## Control Panel Options

### Map Style Section
| Option | Description | Default |
|--------|-------------|---------|
| Color Scheme | Choropleth color scheme | superset_seq_1 |
| Legend Color Set | Sequential, Diverging, Categorical, or Perceptual | Sequential |
| Fill Opacity | Boundary fill transparency | 0.7 |
| Default Border Color | Border color for all levels | White |
| Border Width | Default border thickness | 1 |
| Level Border Colors | JSON config for per-level styling | Auto-generated |
| Show All Boundaries | Show outlines for areas without data | true |

### Level Border Colors Format
```json
[
  {"level": 2, "color": {"r": 68, "g": 68, "b": 68, "a": 1}, "width": 2.5},
  {"level": 3, "color": {"r": 119, "g": 119, "b": 119, "a": 1}, "width": 2},
  {"level": 4, "color": {"r": 153, "g": 153, "b": 153, "a": 1}, "width": 1.5}
]
```

---

## Previous Fix: Ankole & Kigezi Boundary Issue

### Problem

Ankole and Kigezi regions were not appearing on the DHIS2 map at Level 2 (regions). The map showed only 13 boundaries instead of 15.

## Root Cause

The issue was caused by a **coordinate nesting depth mismatch**:

- **Ankole and Kigezi** have coordinates starting with `[[[[` (4 levels of nesting = MultiPolygon format)
- **Other regions** have coordinates starting with `[[[` (3 levels of nesting = Polygon format)
- DHIS2 declares all of them as `ty=2` (Polygon), but Ankole and Kigezi are actually MultiPolygon

When the validation code checked if a feature declared as "Polygon" had valid Polygon coordinates, Ankole and Kigezi failed because their coordinates were actually in MultiPolygon format.

## Fixes Applied

### 1. Enhanced Frontend Geometry Type Detection (`utils.ts`)

- Improved `fixGeometryType()` function to better detect and correct geometry types based on coordinate nesting depth
- Added detailed logging for debugging geometry type corrections
- Fixed duplicate code block issue

### 2. Enhanced Frontend Validation Logging (`utils.ts`)

- Added logging to show total features being processed
- Added debug logging for each feature's declared type and nesting depth
- Better error messages when geometry validation fails

### 3. Bumped Cache Version (`cache.ts`)

- Changed cache version from `v2` to `v3` to force fresh data fetch
- This ensures old cached data (with missing Ankole/Kigezi) is invalidated

### 4. Fixed Infinite Loop Issue (`DHIS2Map.tsx`)

- Removed `setBoundaries([])` call before fetching that could trigger infinite re-renders
- The fetch function now directly updates boundaries without clearing first

### 5. Enhanced Backend Logging (`geojson_utils.py`)

- Added logging for total features being processed
- Added logging for each feature's geometry type detection
- Added summary logging for successful conversions

## How to Test

1. **Clear browser localStorage** to remove old cached boundaries:
   ```javascript
   // In browser console
   Object.keys(localStorage).filter(k => k.startsWith('dhis2_map_cache_')).forEach(k => localStorage.removeItem(k));
   ```

2. **Restart the frontend dev server**:
   ```bash
   cd superset-frontend
   npm run dev
   ```

3. **Open a DHIS2 Map visualization** with Level 2 boundaries

4. **Check the console** for logs showing:
   - `[filterValidFeatures] Processing 15 features from API`
   - Any geometry type corrections like: `Ankole: Polygon → MultiPolygon`
   - `[MapAutoFocus] Auto-fitting map to 15 boundaries`

## Expected Result

All 15 Level 2 regions should now appear on the map, including:
- Ankole ✓
- Kigezi ✓
- And all other 13 regions

## Technical Details

### Coordinate Nesting Depth

| Geometry Type | Nesting Depth | Example |
|--------------|---------------|---------|
| Point | 1 | `[lng, lat]` |
| LineString | 2 | `[[lng, lat], ...]` |
| Polygon | 3 | `[[[lng, lat], ...]]` |
| MultiPolygon | 4 | `[[[[lng, lat], ...]]]` |

### Files Modified

1. `superset-frontend/src/visualizations/DHIS2Map/utils.ts` - Geometry validation
2. `superset-frontend/src/visualizations/DHIS2Map/cache.ts` - Cache version (now v4)
3. `superset-frontend/src/visualizations/DHIS2Map/DHIS2Map.tsx` - Multi-level support, styling
4. `superset-frontend/src/visualizations/DHIS2Map/types.ts` - New props (showAllBoundaries, etc.)
5. `superset-frontend/src/visualizations/DHIS2Map/transformProps.ts` - New prop handling
6. `superset-frontend/src/visualizations/DHIS2Map/controlPanel.ts` - New control options
7. `superset-frontend/src/visualizations/DHIS2Map/components/LegendPanel.tsx` - Boundary level legend
8. `superset/dhis2/geojson_utils.py` - Backend logging

## Debugging

If regions are still missing, check the browser console for:

1. **API response**: Look for `[DHIS2Map] Level 2: Received X features, Y valid`
2. **Filtered features**: Look for `[filterValidFeatures] Filtered out X features`
3. **Specific failures**: Look for warnings about specific feature names

---

## Troubleshooting: Query Timeout Errors

### Error Message
```
Timeout error
We're having trouble loading this visualization. Queries are set to timeout after 60 seconds.
```

### Causes

1. **Large Dataset**: The DHIS2 query returns too much data
2. **Slow DHIS2 Server**: The remote DHIS2 server is under heavy load
3. **Complex Query**: Too many data elements or org units selected

### Solutions

#### 1. Reduce Query Scope
- **Limit time period**: Select a shorter date range (e.g., 1 month instead of 1 year)
- **Reduce data elements**: Select fewer metrics
- **Limit org unit levels**: Query one level at a time

#### 2. Increase Superset Timeout (Admin)
In `superset_config.py`:
```python
# Increase SQL Lab query timeout (in seconds)
SQLLAB_TIMEOUT = 300  # 5 minutes

# For async queries
SQLLAB_ASYNC_TIME_LIMIT_SEC = 300
```

#### 3. Use Caching
The DHIS2 Map automatically caches boundary data. For data queries:
- Enable query caching in Superset settings
- Use smaller, more frequent queries

#### 4. Clear Browser Cache
If boundaries were cached during a timeout:
```javascript
// In browser console
Object.keys(localStorage).filter(k => k.startsWith('dhis2_map_cache_')).forEach(k => localStorage.removeItem(k));
```

#### 5. Check DHIS2 Server Performance
- The DHIS2 `geoFeatures` API can be slow for large org unit hierarchies
- Check DHIS2 server logs for performance issues
- Consider using DHIS2's built-in caching

