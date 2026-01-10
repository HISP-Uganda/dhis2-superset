# Cascade Filters Implementation Guide

## Overview

Cascade filters enable hierarchical data filtering in Superset dashboards, where a child filter's available values are constrained by the parent filter's selection. This is particularly useful for DHIS2 organizational hierarchies (e.g., Region → District → Facility).

## Architecture

### Frontend Flow
1. **Filter Configuration**: Set parent filter and cascade level in the "Filter Dependencies" tab
2. **Filter Value Fetching**: FilterValue component extracts parent filter info (column name, selected value)
3. **API Request**: Form data includes `cascade_parent_column` and `cascade_parent_value`
4. **Options Display**: Child filter displays only values matching parent selection

### Backend Flow
1. **API Endpoint**: `/api/v1/datasource/{datasource_type}/{datasource_id}/column/{column_name}/values/`
2. **Query Parameters**:
   - `cascade_parent_column`: Parent filter's column name
   - `cascade_parent_value`: Selected value(s) from parent filter (comma-separated for multi-select)
3. **Database Query**: `apply_cascade_filter_to_query()` adds WHERE clause filtering parent column
4. **Response**: Returns only distinct values matching the parent filter

## Implementation Details

### Files Modified

#### Frontend
- **FilterValue.tsx**: Extracts cascade parent info and passes to form data
- **utils.ts** (nativeFilters): Updated `getFormData()` to include cascade parameters
- **FilterDependencies.tsx**: New unified component for both cascading and dependencies
- **FiltersConfigForm.tsx**: Renamed "Cascade Settings" to "Filter Dependencies" tab

#### Backend  
- **datasource/api.py**: Added query parameter extraction for cascade filtering
- **models/helpers.py**: `values_for_column()` applies cascade filtering to SQL query
- **utils/cascading_filters.py**: Core cascade filtering utility functions

### Type Definitions
- **Filter** type in `packages/superset-ui-core/src/query/types/Dashboard.ts`:
  - `cascadeParentId`: ID of parent filter
  - `cascadeLevel`: Level name (Region, District, Facility, etc.)

## Setup Instructions

### 1. Create a Dataset with Hierarchical Data
Prepare a dataset that has parent-child relationships:
```sql
SELECT 
  region_id,
  region_name,
  district_id,
  district_name,
  facility_id,
  facility_name
FROM org_hierarchy
```

### 2. Create Parent Filter
1. In dashboard filter settings, create a "Select" filter for the parent level
2. Configure it to use the parent column (e.g., `region_name`)
3. Save the filter

### 3. Create Child Filter
1. Create another "Select" filter for the child level
2. Configure it to use the child column (e.g., `district_name`)
3. Open the "Filter Dependencies" tab
4. In **Parent Filter** dropdown, select the parent filter created in step 2
5. Enter a **Cascade Level Name** (e.g., "District")
6. Save the filter

### 4. Apply to Dashboard
1. Add both filters to your dashboard
2. The filters will appear in the filter bar
3. When user selects a parent value, child filter options will automatically update

## Testing Checklist

- [ ] Parent filter displays all available options
- [ ] Selecting parent value triggers child filter refresh
- [ ] Child filter displays only relevant values based on parent
- [ ] Charts update based on both parent and child selections
- [ ] Multi-level cascades work (3+ levels)
- [ ] Dashboard refresh preserves cascade selections
- [ ] Browser back button works correctly
- [ ] Dashboard shares with cascade filters work

## Performance Considerations

1. **Lazy Loading**: Child filters only request data when parent has selection
2. **Filtering**: Database applies WHERE clause, not frontend filtering
3. **Caching**: Superset's default caching applies to cascade queries
4. **Row Limits**: `NATIVE_FILTER_DEFAULT_ROW_LIMIT` controls max distinct values

## Known Limitations

1. Cascade filtering requires same datasource for parent and child filters
2. Parent and child must be same filter type (both Select filters)
3. Cascade only filters based on one parent (dependencies mode for multiple parents)
4. Cascade level name is for UI display only, not used in filtering

## Troubleshooting

### Child filter shows no options
- Verify parent filter has a value selected
- Check parent and child columns exist in datasource
- Ensure parent column name is correct in cascade setup

### Cascade not filtering
- Check browser console for JS errors
- Verify `cascade_parent_column` and `cascade_parent_value` in network requests
- Check backend logs for SQL errors in `apply_cascade_filter_to_query()`

### Performance issues
- Check datasource size and index on parent/child columns
- Monitor database query execution time
- Consider increasing `NATIVE_FILTER_DEFAULT_ROW_LIMIT` if needed

## Example: DHIS2 Org Unit Hierarchy

```
Region (Uganda region)
  └─ District (Kampala, Masaka, etc.)
    └─ Facility (Health center, Hospital, etc.)
```

Setup:
1. Create "Region" filter → column: `region_name`
2. Create "District" filter → column: `district_name`, parent: Region, level: District
3. Create "Facility" filter → column: `facility_name`, parent: District, level: Facility

Result: Selecting Region → Uganda shows only districts in Uganda. Selecting District → Kampala shows only facilities in Kampala.
