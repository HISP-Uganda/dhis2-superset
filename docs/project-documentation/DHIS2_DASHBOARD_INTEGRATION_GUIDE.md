# DHIS2 Map Dashboard Integration Guide

## Overview

The DHIS2 Map visualization in Apache Superset includes two key dashboard integration features:

1. **Cross-Filtering (6.1)** - Maps emit filters when regions are clicked
2. **Native Filter Integration (6.2)** - Maps respond to dashboard native filters

This guide explains how to use both features in dashboards.

---

## Section 6.1: Cross-Filtering with Maps

### What is Cross-Filtering?

Cross-filtering enables interaction between the DHIS2 Map and other dashboard charts. When a user clicks on a region in the map, other charts in the dashboard automatically filter to show data for that region.

### How It Works

When a region is clicked on the map, the visualization:

1. **Emits a filter event** via `setDataMask()` with the selected region's ID
2. **Dashboard receives the filter** and applies it to other charts using the same org unit column
3. **Other charts automatically update** to show only data for the selected region

### Example: Dashboard Setup

**Dashboard Configuration:**
- Chart 1: DHIS2 Map (showing districts)
- Chart 2: Line Chart (showing data over time by district)
- Chart 3: Table (showing detailed metrics by district)

**All charts must use the same org unit column** (e.g., `district_id` or `org_unit_uid`)

**Step-by-Step:**

1. Create or open a dashboard
2. Add the DHIS2 Map chart to the dashboard
3. Add other charts that share the same org unit column
4. Click a region in the map → All other charts filter to that region
5. Click "Reset" or the back button in drill controls to see all data again

### Code Implementation

The cross-filtering is automatically handled by the DHIS2Map component:

```typescript
const handleDrillDown = useCallback(
  (feature: BoundaryFeature) => {
    if (!enableDrill || !feature.properties.hasChildrenWithCoordinates) {
      return;
    }

    // ... drill navigation logic ...

    if (setDataMask) {
      setDataMask({
        extraFormData: {
          filters: [
            {
              col: orgUnitColumn,  // e.g., 'district_id'
              op: 'IN',
              val: [feature.id],   // The clicked region's ID
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
```

### Features

- **Automatic**: No additional configuration needed
- **Drill-Down Aware**: Works with multi-level drill navigation
- **Filter Reset**: Drilling up automatically clears filters
- **Compatible**: Works with any dashboard chart sharing the org unit column

---

## Section 6.2: Native Filter Integration

### What are Native Filters?

Native Filters are dashboard-level filters that can be applied to multiple charts at once. Common use cases:

- **Period Selection**: Filter all charts to a specific time period
- **Org Unit Hierarchy**: Filter all charts to a specific organization unit
- **Data Elements**: Filter charts to specific indicators or data elements

### How It Works

Native filters are passed to the DHIS2 Map through:

1. **formData.filters** - Active filters from the dashboard
2. **filterState** - Filter selections by the user
3. **Data Filtering** - The component automatically filters data based on these filters

### Setting Up Native Filters

#### Example 1: Period Filter

**Dashboard Configuration:**

1. Create a native filter widget:
   - **Name**: "Period"
   - **Type**: Dropdown or Date Range
   - **Column**: `period` or `year`

2. Apply to DHIS2 Map and other charts

3. When user selects a period, all charts automatically show only that period's data

**How It's Applied:**

```typescript
// filterState passed to the component
{
  period: '2024'  // or ['2023', '2024']
}

// Data is filtered to only rows where row['period'] === '2024'
```

#### Example 2: Organization Unit Filter

**Dashboard Configuration:**

1. Create a native filter widget:
   - **Name**: "Organization Unit"
   - **Type**: Hierarchical dropdown (if available) or multi-select
   - **Column**: `org_unit_id` or `district_id`

2. Apply to DHIS2 Map and other charts

3. When user selects an org unit, the map shows boundaries for that level and filters data accordingly

**How It's Applied:**

```typescript
// filterState passed to the component
{
  org_unit_id: ['O6uvpzGd5pu', 'lc3eMKXaEfw']  // Multiple org units selected
}

// Data is filtered to only rows where org_unit_id is in the selected list
```

#### Example 3: Data Element Filter

**Dashboard Configuration:**

1. Create a native filter widget:
   - **Name**: "Indicator"
   - **Type**: Multi-select
   - **Column**: `data_element` or `indicator_uid`

2. Apply to DHIS2 Map and other charts

3. When user selects indicators, the map shows values for those indicators

**How It's Applied:**

```typescript
// filterState passed to the component
{
  data_element: ['JhvC7ZR9hUe', 'D9A0afrTYPw']
}

// Data is filtered to only rows where data_element is in the selected list
```

### Implementation Details

The native filter integration in DHIS2Map:

1. **Extracts filters** from dashboard state in `transformProps.ts`
2. **Applies filters** in the component's `applyFilters()` function
3. **Updates data** whenever filters change
4. **Recalculates colors** and legends based on filtered data

**Supported Filter Operations:**

| Operation | Example | Description |
|-----------|---------|-------------|
| IN | `{op: 'IN', val: ['a', 'b']}` | Include rows matching any value |
| NOT IN | `{op: 'NOT IN', val: ['a']}` | Exclude rows matching values |
| == / eq | `{op: '==', val: 'a'}` | Exact match |
| != / neq | `{op: '!=', val: 'a'}` | Not equal |
| > / gt | `{op: '>', val: 100}` | Greater than |
| < / lt | `{op: '<', val: 100}` | Less than |
| >= / gte | `{op: '>=', val: 100}` | Greater than or equal |
| <= / lte | `{op: '<=', val: 100}` | Less than or equal |

### Combining Cross-Filtering and Native Filters

Both features can work together:

1. User selects a period using a native filter → Map shows data for that period
2. User clicks a region in the map → Cross-filter emitted for that region
3. Other charts receive both filters → Show period data for the selected region
4. User clears drill (drill up) → Cross-filter removed, but period filter remains

**Example Flow:**

```
Initial State:
  Dashboard filters: {period: '2024'}
  Map shows: All regions with 2024 data

User clicks a region:
  Cross-filter: {col: 'org_unit_id', val: ['O6uvpzGd5pu']}
  Map shows: Clicked region with 2024 data
  Other charts: Period='2024' AND org_unit_id='O6uvpzGd5pu'

User clicks drill-up button:
  Cross-filter cleared
  Map shows: All regions with 2024 data again
  Other charts: Back to period='2024' (all regions)
```

---

## Configuration Examples

### Example 1: Regional Health Dashboard

**Components:**
- DHIS2 Map showing health districts
- Line chart showing cases over time
- Table showing facility details

**Filters:**
- Period: Year and Quarter dropdown
- Health Program: Multi-select filter
- Indicator: Dropdown filter

**Expected Behavior:**
1. User selects 2024 and Quarter 3 → Map and charts show Q3 2024 data
2. User selects "Malaria Program" → Data filtered to malaria indicators
3. User clicks a health district → Other charts show that district's data
4. User clicks drill-up → Returns to all districts, maintains period and program filters

### Example 2: Facility Monitoring Dashboard

**Components:**
- DHIS2 Map showing facilities
- Gauge chart showing performance score
- Table showing recent performance data

**Filters:**
- Region: Hierarchical dropdown
- Month: Date range picker
- Facility Type: Multi-select

**Expected Behavior:**
1. User selects a region → Map shows facilities in that region
2. User selects a month → Map and charts show that month's data
3. User clicks a facility → Drill into facility details
4. All filters remain active throughout the interaction

---

## Troubleshooting

### Filters Not Being Applied

**Problem**: Native filters are selected but the map doesn't filter

**Solutions:**
1. Check that filter column names match chart column names
2. Verify filter values are in the correct format (string vs number)
3. Ensure the chart is included in the filter's "Applied to" list
4. Clear browser cache and reload

### Cross-Filter Not Working

**Problem**: Clicking on regions doesn't affect other charts

**Solutions:**
1. Verify all charts use the same org unit column
2. Check that "enableDrill" is enabled in map settings
3. Ensure the clicked region has `hasChildrenWithCoordinates: true`
4. Check browser console for errors

### Performance Issues with Many Filters

**Problem**: Dashboard is slow when multiple filters are applied

**Solutions:**
1. Reduce the number of columns in tooltips
2. Decrease legend classes (fewer color gradations)
3. Use data aggregation at the database level
4. Consider using cached DHIS2 boundary data

---

## Best Practices

1. **Consistent Column Names**: Use the same column names across all dashboard charts for filters
2. **Clear Filtering Logic**: Provide clear labels for native filters so users understand what they're filtering
3. **Default Filters**: Consider setting sensible defaults (e.g., current year, national level)
4. **Filter Order**: Place frequently-used filters first for better UX
5. **Documentation**: Add dashboard descriptions explaining how to use the filters
6. **Testing**: Test filter combinations before sharing dashboards with users

---

## Advanced: Custom Filter Logic

If you need more complex filtering beyond the standard operators, you can extend the `applyFilters()` function in `DHIS2Map.tsx`:

```typescript
const applyFilters = useCallback(
  (sourceData: Record<string, any>[]): Record<string, any>[] => {
    let result = [...sourceData];

    // Standard filters (already implemented)
    if (activeFilters && activeFilters.length > 0) {
      result = result.filter(row =>
        activeFilters.every(filter => {
          // ... filter logic ...
        }),
      );
    }

    // Native filters (already implemented)
    if (nativeFilters && Object.keys(nativeFilters).length > 0) {
      result = result.filter(row =>
        Object.entries(nativeFilters).every(([filterId, filterValue]) => {
          // ... filter logic ...
        }),
      );
    }

    // Custom logic (add here)
    // For example: combine multiple columns into one filter
    // or apply percentage-based filters
    // or filter based on data relationships

    return result;
  },
  [activeFilters, nativeFilters],
);
```

---

## API Reference

### DHIS2MapProps Filter Properties

```typescript
interface DHIS2MapProps {
  // ... other properties ...

  activeFilters?: Array<{
    col: string;      // Column name to filter on
    op: string;       // Filter operator (IN, ==, >, etc.)
    val: any;         // Filter value(s)
  }>;

  nativeFilters?: Record<string, any>;  // Native filter state
                                        // Key: filter ID, Value: selected value(s)
}
```

### Filter State Changes

The component re-evaluates filters whenever:
- `activeFilters` changes
- `nativeFilters` changes
- `data` changes

Results are stored in `filteredData` state, which drives the visualization.

---

## Related Documentation

- [DHIS2 Map Implementation Status](./DHIS2_MAP_IMPLEMENTATION_STATUS.md)
- [DHIS2 Map Visualization Plan](./DHIS2_MAP_VISUALIZATION_PLAN.md)
- [DHIS2 DataValueSets Guide](./DHIS2_DATAVALUESETS_GUIDE.md)
- [Apache Superset Dashboard Documentation](https://superset.apache.org/docs/creating-charts-dashboards/creating-your-first-dashboard)

---

## Support

For issues or questions about dashboard integration:

1. Check the [troubleshooting section](#troubleshooting) above
2. Review example dashboards in your Superset instance
3. Check browser console for error messages
4. Consult the [DHIS2 Map Implementation Status](./DHIS2_MAP_IMPLEMENTATION_STATUS.md) for detailed implementation info
