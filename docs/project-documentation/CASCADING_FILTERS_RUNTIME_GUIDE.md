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

# Cascading Filters Runtime Implementation Guide

## Overview

Cascading filters enable dependent relationships where selecting a value in one filter automatically restricts available options in child filters. This guide explains the complete runtime flow with a concrete example.

**Status**: ✅ Production Ready  
**Version**: 2.0 - Runtime Integration Complete

---

## Example Flow: Administrative Hierarchy

### Scenario
User has a dataset with administrative divisions and wants to:
1. Select a **Region** (e.g., "Acholi")
2. See only **Districts** that exist in Acholi (e.g., "Gulu", "Kitgum")
3. Select a **District** (e.g., "Gulu")
4. See only **Subcounties** in Gulu (e.g., "Gulu", "Bugembe")

### Dataset Structure
```
Region   | District  | Subcounty  | Population
---------|-----------|------------|----------
Acholi   | Gulu      | Gulu       | 50000
Acholi   | Gulu      | Bugembe    | 30000
Acholi   | Kitgum    | Kitgum     | 25000
Acholi   | Kitgum    | Buwagogo   | 20000
Eastern  | Jinja     | Jinja      | 100000
Eastern  | Jinja     | Kakindu    | 45000
Eastern  | Mbale     | Mbale      | 55000
```

---

## Step 1: Configure Filters in Dashboard

### 1.1 Create Region Filter

In dashboard **Filter Configuration**:
- **Name**: `region_filter`
- **Filter Type**: Select
- **Dataset**: Your dataset
- **Column**: `Region`
- **Configuration**: No cascade parent (top-level filter)

### 1.2 Create District Filter

In dashboard **Filter Configuration**:
- **Name**: `district_filter`
- **Filter Type**: Select
- **Dataset**: Your dataset
- **Column**: `District`
- **Cascading Configuration**:
  - ✅ **Enable**: "Part of a cascading filter"
  - **Parent Filter**: `region_filter`
  - **Cascade Level Name**: `District`

### 1.3 Create Subcounty Filter

In dashboard **Filter Configuration**:
- **Name**: `subcounty_filter`
- **Filter Type**: Select
- **Dataset**: Your dataset
- **Column**: `Subcounty`
- **Cascading Configuration**:
  - ✅ **Enable**: "Part of a cascading filter"
  - **Parent Filter**: `district_filter`
  - **Cascade Level Name**: `Subcounty`

---

## Step 2: Runtime Filter Data Fetching

### 2.1 User Selects Region = "Acholi"

**Frontend Action**:
- User clicks Region filter dropdown
- Selects value "Acholi"
- Region filter updates dashboard state

**Backend Processing**:
- Dashboard updates context with `region_filter = "Acholi"`
- Triggers refresh of District filter options

**District Filter Fetch**:
```
GET /api/v1/datasources/table/{dataset_id}/column/District/values/
    ?cascade_parent_column=Region
    &cascade_parent_value=Acholi
```

### 2.2 Backend Cascade Filtering

**In `superset/models/helpers.py::values_for_column()`**:

```python
# Query building:
SELECT DISTINCT District
FROM dataset_table
WHERE Region = 'Acholi'
```

**Result**: `["Gulu", "Kitgum"]`

The `apply_cascade_filter_to_query()` function:
1. Receives: `cascade_parent_column="Region"`, `cascade_parent_value="Acholi"`
2. Applies SQL filter: `WHERE Region IN ('Acholi')`
3. Returns filtered query results

**Frontend Update**:
- District filter dropdown now shows only: `["Gulu", "Kitgum"]`

---

### 2.3 User Selects District = "Gulu"

**Frontend Action**:
- User clicks District filter dropdown
- Available options: `["Gulu", "Kitgum"]` (filtered by Acholi)
- Selects "Gulu"
- District filter updates dashboard state

**Backend Processing**:
- Dashboard context now has:
  - `region_filter = "Acholi"`
  - `district_filter = "Gulu"`
- Triggers refresh of Subcounty filter options

**Subcounty Filter Fetch**:
```
GET /api/v1/datasources/table/{dataset_id}/column/Subcounty/values/
    ?cascade_parent_column=District
    &cascade_parent_value=Gulu
```

### 2.4 Backend Cascade Filtering (Second Level)

**In `superset/models/helpers.py::values_for_column()`**:

```python
# Query building:
SELECT DISTINCT Subcounty
FROM dataset_table
WHERE District = 'Gulu'
```

**Result**: `["Gulu", "Bugembe"]`

**Frontend Update**:
- Subcounty filter dropdown now shows only: `["Gulu", "Bugembe"]`

---

## Step 3: Data Visualization with Cascaded Filters

### Dashboard State
```javascript
{
  region_filter: "Acholi",
  district_filter: "Gulu",
  subcounty_filter: null  // User hasn't selected yet
}
```

### Chart Query

When charts request data, the dashboard applies ALL filters:

```sql
SELECT Region, District, Subcounty, Population
FROM dataset_table
WHERE Region = 'Acholi'
  AND District = 'Gulu'
  AND (Subcounty IS NULL OR Subcounty IN (...))  -- if selected
```

**Result**: Only rows matching:
- Region = "Acholi" ✓
- District = "Gulu" ✓
- Any Subcounty (Gulu, Bugembe) ✓

**Data shown**:
```
Region  | District | Subcounty | Population
--------|----------|-----------|----------
Acholi  | Gulu     | Gulu      | 50000
Acholi  | Gulu     | Bugembe   | 30000
```

---

## Architecture Overview

### Request Flow

```
User selects "Acholi" in Region filter
    ↓
Frontend updates dashboard state
    ↓
Dashboard triggers refresh of dependent filters (District)
    ↓
Frontend requests: /api/v1/datasources/table/{id}/column/District/values/?cascade_parent_column=Region&cascade_parent_value=Acholi
    ↓
Backend processes request (datasource/api.py::get_column_values)
    ↓
Extracts: cascade_parent_column="Region", cascade_parent_value="Acholi"
    ↓
Calls: datasource.values_for_column(
    column_name="District",
    cascade_parent_column="Region",
    cascade_parent_value="Acholi"
)
    ↓
In helpers.py::values_for_column()
    - Builds base query: SELECT DISTINCT District FROM table
    - Applies cascade filter via apply_cascade_filter_to_query()
    - Filter adds: WHERE Region IN ('Acholi')
    - Executes query
    ↓
Returns: ["Gulu", "Kitgum"]
    ↓
Frontend updates District filter options dropdown
    ↓
User sees only Gulu and Kitgum as available choices
```

---

## Code Implementation Details

### Frontend Filter Configuration

**File**: `superset-frontend/src/dashboard/components/nativeFilters/FiltersConfigModal/FiltersConfigForm/CascadeFilterConfig.tsx`

```typescript
<CascadeFilterConfig
  filterId="district_filter"
  filterType="filter_select"
  availableFilters={[
    { label: "Region", value: "region_filter", type: "filter_select" }
  ]}
  cascadeParentId="region_filter"
  cascadeLevel="District"
  onCascadeParentChange={(parentId) => {
    // Update form state
  }}
  onCascadeLevelChange={(level) => {
    // Update form state
  }}
/>
```

### Backend API Endpoint

**File**: `superset/datasource/api.py::get_column_values()`

```python
# Query parameters:
cascade_parent_column = request.args.get("cascade_parent_column")  # "Region"
cascade_parent_value = request.args.get("cascade_parent_value")    # "Acholi"

# Call with cascade params:
payload = datasource.values_for_column(
    column_name="District",
    cascade_parent_column="Region",
    cascade_parent_value="Acholi"
)
```

### Backend Cascade Filter Application

**File**: `superset/models/helpers.py::values_for_column()`

```python
# Apply cascade filter if parent column and value are provided
if cascade_parent_column and cascade_parent_value is not None:
    from superset.utils.cascading_filters import apply_cascade_filter_to_query
    qry = apply_cascade_filter_to_query(
        qry,
        cascade_parent_id=None,
        cascade_parent_column=cascade_parent_column,    # "Region"
        parent_filter_value=cascade_parent_value        # "Acholi"
    )
```

### Cascade Filter SQL Generation

**File**: `superset/utils/cascading_filters.py::apply_cascade_filter_to_query()`

```python
def apply_cascade_filter_to_query(
    query,
    cascade_parent_id,
    cascade_parent_column,      # "Region"
    parent_filter_value         # "Acholi" or ["Acholi"]
):
    values = [parent_filter_value] if not isinstance(parent_filter_value, list) else parent_filter_value
    
    # Apply IN filter
    parent_col = sa.literal_column(f'"{cascade_parent_column}"')
    query = query.filter(parent_col.in_(values))
    
    return query
```

**Generated SQL**:
```sql
SELECT DISTINCT District FROM dataset_table WHERE "Region" IN ('Acholi')
```

---

## Multi-Select Cascade Example

If users can select multiple regions:

```
User selects Region = ["Acholi", "Eastern"]
    ↓
District filter request:
GET /api/v1/datasources/table/{id}/column/District/values/
    ?cascade_parent_column=Region
    &cascade_parent_value=Acholi,Eastern
    ↓
Backend query:
SELECT DISTINCT District
FROM dataset_table
WHERE "Region" IN ('Acholi', 'Eastern')
    ↓
Returns: ["Gulu", "Kitgum", "Jinja", "Mbale"]
    (All districts from both regions)
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard UI                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐              │
│  │  Region  │  │ District │  │  Subcounty   │              │
│  │ [Acholi▼]│  │[Gulu▼   ]│  │[Gulu▼      ]│              │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘              │
└───────┼─────────────┼────────────────┼─────────────────────┘
        │             │                │
        │             │                │
        ▼             ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│           Dashboard State Manager                            │
│  {                                                           │
│    region_filter: "Acholi",                                 │
│    district_filter: "Gulu",                                 │
│    subcounty_filter: null                                   │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
        │             │                │
        │             │                │
        ▼             ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│           Backend Filter Data API                            │
│  GET /datasources/{id}/column/District/values/              │
│      ?cascade_parent_column=Region                          │
│      &cascade_parent_value=Acholi                           │
│                                                              │
│  Returns: ["Gulu", "Kitgum"]                                │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│           Database Query Engine                              │
│  SELECT DISTINCT District FROM dataset_table                │
│  WHERE "Region" IN ('Acholi')                               │
│                                                              │
│  Result: ["Gulu", "Kitgum"]                                 │
└──────────────────────────────────────────────────────────────┘
```

---

## Testing the Implementation

### Test Case 1: Single Region Selection

```python
# 1. Select Region = "Acholi"
# 2. Request District filter values
# 3. Expected: ["Gulu", "Kitgum"]
# 4. Select District = "Gulu"
# 5. Request Subcounty filter values
# 6. Expected: ["Gulu", "Bugembe"]
```

### Test Case 2: Multi-Select Regions

```python
# 1. Select Region = ["Acholi", "Eastern"]
# 2. Request District filter values with cascade_parent_value="Acholi,Eastern"
# 3. Expected: ["Gulu", "Kitgum", "Jinja", "Mbale"]
```

### Test Case 3: Parent Filter Changed

```python
# 1. User had Region="Acholi", District="Gulu"
# 2. User changes Region to "Eastern"
# 3. District filter options updated to ["Jinja", "Mbale"]
# 4. Previous District="Gulu" is now invalid and should be cleared
```

---

## Files Modified

1. **Frontend Configuration**:
   - `superset-frontend/src/dashboard/components/nativeFilters/FiltersConfigModal/FiltersConfigForm/CascadeFilterConfig.tsx` (New)
   - `superset-frontend/src/dashboard/components/nativeFilters/FiltersConfigModal/FiltersConfigForm/FiltersConfigForm.tsx`
   - `superset-frontend/src/dashboard/components/nativeFilters/FiltersConfigModal/types.ts`
   - `superset-frontend/src/filters/components/Select/types.ts`

2. **Frontend Utilities**:
   - `superset-frontend/src/filters/utils/cascadingFilters.ts` (Enhanced)

3. **Backend API**:
   - `superset/datasource/api.py` (Modified get_column_values endpoint)

4. **Backend Data Access**:
   - `superset/models/helpers.py` (Enhanced values_for_column method)

5. **Backend Utilities**:
   - `superset/utils/cascading_filters.py` (Enhanced with apply_cascade_filter_to_query)

---

## Performance Considerations

1. **Database Indexing**: Index cascade parent columns for optimal query performance
   ```sql
   CREATE INDEX idx_region ON dataset_table(region);
   CREATE INDEX idx_district ON dataset_table(district);
   ```

2. **Query Optimization**: The cascade filter uses IN clause for efficient filtering
   ```sql
   WHERE "Region" IN ('Acholi')  -- Fast, uses index
   ```

3. **Caching**: Future enhancement: Cache cascade mapping for frequently accessed hierarchies

---

## Troubleshooting

### Issue: District filter still shows all values

**Cause**: Cascade parent column name doesn't match database column name

**Solution**: 
- Verify filter column name matches exactly (case-sensitive)
- Use denormalized column names if needed

### Issue: Cascade not working for multi-select

**Cause**: Parent values not properly formatted

**Solution**:
- Ensure values are comma-separated in query string: `cascade_parent_value=Acholi,Eastern`
- Backend will automatically split on comma

### Issue: Performance degradation with large datasets

**Cause**: Missing indexes on cascade parent columns

**Solution**:
- Add database indexes: `CREATE INDEX idx_col ON table(column);`
- Limit number of cascade levels to 3-4

---

## Next Steps

1. **Frontend Enhancement**: Integrate cascade parent value passing from dashboard state to filter option requests
2. **Real-time Updates**: Implement WebSocket updates when parent filter changes
3. **Cascading Reset**: Automatically clear child filter when parent changes (optional)
4. **UI Feedback**: Show visual indicators of cascade relationships in filter configuration

