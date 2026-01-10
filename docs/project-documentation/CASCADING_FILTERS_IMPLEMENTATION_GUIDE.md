# Cascading Filters Implementation Guide

## Overview

This guide explains how to implement cascading filters in Apache Superset for hierarchical datasets such as Administrative Units (Region → District → Subcounty → Health Facility) and Period Types (PeriodType → Period).

**Status**: ✅ Production Ready  
**Created**: December 6, 2025  
**For**: DHIS2 Integration on Superset

---

## Table of Contents

1. [What are Cascading Filters?](#what-are-cascading-filters)
2. [Architecture](#architecture)
3. [Implementation Components](#implementation-components)
4. [Setup Instructions](#setup-instructions)
5. [Usage Examples](#usage-examples)
6. [Performance Optimization](#performance-optimization)
7. [Troubleshooting](#troubleshooting)
8. [API Reference](#api-reference)

---

## What are Cascading Filters?

Cascading filters are dependent filters where selecting a value in one filter automatically updates the available options in child filters.

### Example: Administrative Hierarchy

```
Select Region → "Eastern"
    ↓
District filter shows only: ["Jinja", "Mbale", "Soroti"]
    ↓
Select District → "Jinja"
    ↓
Subcounty filter shows only: ["Jinja", "Bugembe"]
    ↓
Select Subcounty → "Jinja"
    ↓
Health Facility filter shows only: ["Jinja HC", "Jinja Hospital"]
```

### Benefits

- **Better UX**: Users only see valid options
- **Data Consistency**: Prevents invalid filter combinations
- **Performance**: Reduces data fetching for narrowed results
- **Intuitive Navigation**: Follows logical hierarchies

---

## Architecture

### 3-Layer Design

```
┌─────────────────────────────────────────────────────────┐
│              Frontend (React/TypeScript)                │
│  - cascadingFilters.ts utilities                        │
│  - Filter UI components with cascade logic              │
│  - Real-time filter state management                    │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│              Backend (Python/Flask)                     │
│  - cascading_filters.py utilities                       │
│  - API endpoints for filter options                     │
│  - SQL generation for cascaded queries                  │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│              Database (SQL)                             │
│  - Hierarchical data tables                             │
│  - Indexed columns for performance                      │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Components

### 1. Frontend TypeScript Utilities

**File**: `superset-frontend/src/filters/utils/cascadingFilters.ts`

Key functions:

```typescript
// Get available options for a level based on parent selection
getCascadeOptions(cascadeMap, column, parentColumn, parentValue)

// Build efficient cascade mapping from data
buildCascadeMapping(data, hierarchy)

// Generate SQL WHERE clause
generateCascadeFilterSQL(filterState, filterHierarchy)

// Reset child filters when parent changes
resetChildFilters(filterState, changedFilter, hierarchy)

// Validate cascade state consistency
validateCascadeState(filterState, cascadeMap, hierarchy)
```

### 2. Backend Python Utilities

**File**: `superset/utils/cascading_filters.py`

Key classes:

```python
# Define a single level in hierarchy
CascadeLevel(column, label, parent_column=None)

# Manage complete hierarchy
CascadeHierarchy(levels)

# Predefined admin hierarchy
AdminHierarchyCascade()  # Region → District → Subcounty → Facility

# Predefined period hierarchy
PeriodHierarchyCascade()  # PeriodType → Period

# Generate SQL filtering
generate_cascade_filter_sql(filter_state, filter_hierarchy)
```

---

## Setup Instructions

### Step 1: Define Your Hierarchy

#### For Administrative Units

```python
from superset.utils.cascading_filters import (
    CascadeLevel,
    CascadeHierarchy,
    AdminHierarchyCascade
)

# Option A: Use predefined hierarchy
admin_cascade = AdminHierarchyCascade()

# Option B: Custom hierarchy
admin_cascade = CascadeHierarchy([
    CascadeLevel("region", "Region"),
    CascadeLevel("district", "District", parent_column="region"),
    CascadeLevel("subcounty", "Subcounty", parent_column="district"),
    CascadeLevel("health_facility", "Health Facility", parent_column="subcounty"),
])
```

#### For Period Types

```python
from superset.utils.cascading_filters import PeriodHierarchyCascade

period_cascade = PeriodHierarchyCascade()
```

### Step 2: Build Cascade Mapping

```python
# Load your data
data = [
    {"region": "Eastern", "district": "Jinja", "subcounty": "Jinja", "health_facility": "Jinja HC"},
    {"region": "Eastern", "district": "Jinja", "subcounty": "Bugembe", "health_facility": "Bugembe HC"},
    {"region": "Eastern", "district": "Mbale", "subcounty": "Mbale", "health_facility": "Mbale HC"},
    # ... more data
]

# Build cascade map
cascade_map = admin_cascade.build_cascade_map(data)
```

### Step 3: Configure Dashboard Filters

In Superset Dashboard:

1. **Add Filter Widgets**
   - Go to Dashboard Edit Mode
   - Add native filter for each hierarchy level
   - Set filter type to "Select" or "Multi-select"

2. **Configure Filter Dependencies**
   - Region filter: No dependencies (root level)
   - District filter: Depends on Region
   - Subcounty filter: Depends on District
   - Health Facility filter: Depends on Subcounty

3. **Connect to Charts**
   - Link each filter to your charts/datasets
   - Ensure column names match hierarchy definitions

### Step 4: Implement Frontend Cascade Logic

In your filter component:

```typescript
import {
  buildCascadeMapping,
  getCascadeOptions,
  resetChildFilters,
  validateCascadeState,
} from 'src/filters/utils/cascadingFilters';

// Build cascade map from API data
const cascadeMap = buildCascadeMapping(data, hierarchy);

// When parent filter changes
const handleParentFilterChange = (filterName: string, value: string) => {
  // Reset child filters
  const newState = resetChildFilters(filterState, filterName, hierarchy);
  
  // Get child options
  const childOptions = getCascadeOptions(
    cascadeMap,
    childColumnName,
    parentColumnName,
    value
  );
  
  // Update UI
  setFilterState(newState);
  updateChildFilterOptions(childOptions);
};

// Validate before applying
const isValid = validateCascadeState(filterState, cascadeMap, hierarchy);
```

---

## Usage Examples

### Example 1: Basic Administrative Hierarchy

```python
# Backend: Get district options for selected region
from superset.utils.cascading_filters import AdminHierarchyCascade

cascade = AdminHierarchyCascade()
cascade.build_cascade_map(health_data)

# Get districts for "Eastern" region
districts = cascade.get_options(
    column="district",
    parent_column="region",
    parent_value="Eastern"
)
# Returns: ["Jinja", "Mbale", "Soroti"]
```

### Example 2: Dynamic SQL Generation

```python
# Generate WHERE clause based on filter selections
from superset.utils.cascading_filters import generate_cascade_filter_sql

filter_state = {
    "region": "Eastern",
    "district": "Jinja",
    "subcounty": None,
    "health_facility": None,
}

filter_hierarchy = {
    "region": "region",
    "district": "district",
    "subcounty": "subcounty",
    "health_facility": "health_facility",
}

sql_where = generate_cascade_filter_sql(filter_state, filter_hierarchy)
# Returns: "WHERE region = 'Eastern' AND district = 'Jinja'"

# Use in query
query = f"SELECT * FROM health_data {sql_where}"
```

### Example 3: Frontend Filter Component

```typescript
import React, { useState, useMemo } from 'react';
import {
  buildCascadeMapping,
  getCascadeOptions,
  resetChildFilters,
} from 'src/filters/utils/cascadingFilters';

export const AdminCascadeFilter = ({ data, hierarchy }) => {
  const [filterState, setFilterState] = useState({
    region: null,
    district: null,
    subcounty: null,
    health_facility: null,
  });

  const cascadeMap = useMemo(
    () => buildCascadeMapping(data, hierarchy),
    [data, hierarchy]
  );

  const handleFilterChange = (level: string, value: string | null) => {
    // Reset child filters
    let newState = { ...filterState, [level]: value };
    
    const levelIndex = hierarchy.levels.findIndex(l => l.column === level);
    for (let i = levelIndex + 1; i < hierarchy.levels.length; i++) {
      newState[hierarchy.levels[i].column] = null;
    }

    setFilterState(newState);
  };

  const getOptions = (column: string) => {
    const level = hierarchy.levels.find(l => l.column === column);
    if (!level || !level.parentColumn) {
      // Root level
      return getCascadeOptions(cascadeMap, column, undefined, undefined);
    }
    
    return getCascadeOptions(
      cascadeMap,
      column,
      level.parentColumn,
      filterState[level.parentColumn]
    );
  };

  return (
    <div>
      {hierarchy.levels.map(level => (
        <select
          key={level.column}
          value={filterState[level.column] || ''}
          onChange={e => handleFilterChange(level.column, e.target.value || null)}
          disabled={level.parentColumn && !filterState[level.parentColumn]}
        >
          <option value="">-- Select {level.label} --</option>
          {getOptions(level.column).map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
};
```

---

## Performance Optimization

### 1. Build Cascade Map Once

```typescript
// DON'T: Rebuild on every render
const cascadeMap = buildCascadeMapping(data, hierarchy); // ❌

// DO: Use useMemo
const cascadeMap = useMemo(
  () => buildCascadeMapping(data, hierarchy),
  [data, hierarchy]
); // ✅
```

### 2. Memoize Cascade Options

```typescript
// Cache filter options to avoid recalculation
const memoizedOptions = useMemo(
  () => getCascadeOptions(cascadeMap, column, parentColumn, parentValue),
  [cascadeMap, column, parentColumn, parentValue]
);
```

### 3. Index Database Columns

```sql
-- Create indexes for faster filtering
CREATE INDEX idx_region ON health_data(region);
CREATE INDEX idx_district ON health_data(district);
CREATE INDEX idx_subcounty ON health_data(subcounty);
CREATE INDEX idx_health_facility ON health_data(health_facility);

-- Composite index for fastest hierarchical queries
CREATE INDEX idx_admin_hierarchy ON health_data(region, district, subcounty, health_facility);
```

### 4. Lazy Load Data

```typescript
// Load only top-level options initially
const initialOptions = getCascadeOptions(cascadeMap, 'region', undefined, undefined);

// Load child options on demand when parent is selected
const loadChildOptions = async (parentValue: string) => {
  const options = getCascadeOptions(cascadeMap, 'district', 'region', parentValue);
  return options;
};
```

### 5. Debounce Cascade Updates

```typescript
import { debounce } from 'lodash';

const debouncedHandleChange = debounce((level: string, value: string) => {
  handleFilterChange(level, value);
}, 300);
```

---

## Troubleshooting

### Issue: Child Filter Shows No Options After Parent Selection

**Cause**: Parent value doesn't exist in cascade mapping

**Solution**:
```python
# Verify data consistency
hierarchy = AdminHierarchyCascade()
cascade_map = hierarchy.build_cascade_map(data)

# Check if parent value exists
if 'Eastern' in cascade_map['region']:
    print("Region exists in data")
else:
    print("Region 'Eastern' not found - check data")
```

### Issue: Performance Degradation with Large Datasets

**Cause**: Building cascade map repeatedly or inefficient queries

**Solution**:
```python
# Cache cascade map in session/Redis
import hashlib
cache_key = f"cascade_{hashlib.md5(str(data).encode()).hexdigest()}"
cached_map = cache.get(cache_key)

if cached_map:
    cascade_map = cached_map
else:
    cascade_map = hierarchy.build_cascade_map(data)
    cache.set(cache_key, cascade_map, timeout=3600)
```

### Issue: Cascade Reset Too Aggressive

**Cause**: User loses selections when adjusting parent filter

**Solution**: Implement "smart reset" that preserves valid selections
```python
def smart_reset_child_filters(filter_state, cascade_map, hierarchy, changed_column):
    """Only reset children that would be invalid"""
    reset_state = dict(filter_state)
    
    changed_idx = next(
        (idx for idx, level in enumerate(hierarchy.levels) if level.column == changed_column),
        -1
    )
    
    for level_idx in range(changed_idx + 1, len(hierarchy.levels)):
        level = hierarchy.levels[level_idx]
        parent_level = hierarchy.levels[level_idx - 1]
        child_value = reset_state[level.column]
        
        if child_value is None:
            continue
            
        # Check if child value is still valid
        valid_options = cascade_map.get_options(
            level.column,
            parent_level.column,
            reset_state[parent_level.column]
        )
        
        if child_value not in valid_options:
            reset_state[level.column] = None
    
    return reset_state
```

---

## API Reference

### Frontend Functions

#### `buildCascadeMapping(data, hierarchy)`
Builds efficient mapping structure for cascade filtering.

**Parameters**:
- `data: DataRecord[]` - Array of data records
- `hierarchy: CascadeHierarchy` - Hierarchy definition

**Returns**: `Map<string, Map<string|number, Set<string|number>>>`

**Example**:
```typescript
const cascadeMap = buildCascadeMapping(healthData, adminHierarchy);
```

---

#### `getCascadeOptions(cascadeMap, column, parentColumn, parentValue)`
Gets available options for a filter level.

**Parameters**:
- `cascadeMap: Map` - Built cascade mapping
- `column: string` - Target column name
- `parentColumn?: string` - Parent column name
- `parentValue?: string|number|Array` - Parent selected value(s)

**Returns**: `Array<string|number>` - Available options

**Example**:
```typescript
const districts = getCascadeOptions(
  cascadeMap,
  'district',
  'region',
  'Eastern'
);
```

---

#### `resetChildFilters(filterState, changedFilter, hierarchy)`
Resets child filter values when parent changes.

**Parameters**:
- `filterState: FilterCascadeState` - Current filter selections
- `changedFilter: string` - Changed filter column name
- `hierarchy: CascadeHierarchy` - Hierarchy definition

**Returns**: `FilterCascadeState` - Updated state

**Example**:
```typescript
const newState = resetChildFilters(filterState, 'region', hierarchy);
```

---

### Backend Classes

#### `CascadeHierarchy`

```python
class CascadeHierarchy:
    def __init__(self, levels: List[CascadeLevel])
    def build_cascade_map(self, data: List[Dict]) -> Dict
    def get_options(self, column: str, parent_column: str, parent_value: Any) -> List
    def validate_selection(self, filter_state: Dict) -> Tuple[bool, List[str]]
```

---

#### `AdminHierarchyCascade`

Predefined hierarchy for administrative units.

```python
cascade = AdminHierarchyCascade()
cascade.build_cascade_map(data)
districts = cascade.get_options('district', 'region', 'Eastern')
```

---

#### `PeriodHierarchyCascade`

Predefined hierarchy for periods.

```python
cascade = PeriodHierarchyCascade()
periods = cascade.get_options('period', 'period_type', 'Monthly')
```

---

## Testing Cascade Filters

### Unit Tests

```python
def test_cascade_filtering():
    data = [
        {"region": "Eastern", "district": "Jinja"},
        {"region": "Eastern", "district": "Mbale"},
        {"region": "Western", "district": "Kabale"},
    ]
    
    cascade = AdminHierarchyCascade()
    cascade.build_cascade_map(data)
    
    # Test getting filtered options
    districts = cascade.get_options('district', 'region', 'Eastern')
    assert set(districts) == {'Jinja', 'Mbale'}
    
    # Test validation
    valid, errors = cascade.validate_selection({
        'region': 'Eastern',
        'district': 'Jinja',  # Valid
    })
    assert valid and len(errors) == 0
```

### Integration Tests

```python
def test_cascade_sql_generation():
    from superset.utils.cascading_filters import generate_cascade_filter_sql
    
    filter_state = {
        'region': 'Eastern',
        'district': 'Jinja',
    }
    
    hierarchy = {
        'region': 'region',
        'district': 'district',
    }
    
    sql = generate_cascade_filter_sql(filter_state, hierarchy)
    assert "WHERE region = 'Eastern'" in sql
    assert "AND district = 'Jinja'" in sql
```

---

## Best Practices

1. **Always Validate**: Check cascade state consistency before applying filters
2. **Provide Feedback**: Show users why options are unavailable
3. **Cache Wisely**: Cache cascade mappings but invalidate when data changes
4. **Index Thoroughly**: Index all hierarchy columns and their combinations
5. **Reset Strategically**: Reset child filters only when necessary
6. **Document Hierarchies**: Clearly define parent-child relationships
7. **Test Edge Cases**: Test with missing values, null data, single options
8. **Monitor Performance**: Track cascade map build time with large datasets

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] Cascade hierarchies defined and documented
- [ ] Database indices created for all hierarchy columns
- [ ] Cache invalidation strategy implemented
- [ ] Error handling for invalid selections
- [ ] Performance testing completed (< 100ms filter updates)
- [ ] Unit and integration tests passing
- [ ] User documentation prepared
- [ ] Backup of original cascade implementation

### Deployment Steps

1. Deploy backend utilities (`superset/utils/cascading_filters.py`)
2. Deploy frontend utilities (`superset-frontend/src/filters/utils/cascadingFilters.ts`)
3. Create database indices
4. Update dashboard configurations with cascade definitions
5. Run integration tests
6. Monitor performance metrics

---

## Support & Maintenance

For issues or questions:

1. Check [Troubleshooting](#troubleshooting) section
2. Review API documentation
3. Check test examples
4. File issue with error messages and data sample

---

**Version**: 1.0  
**Last Updated**: December 6, 2025  
**Compatibility**: Apache Superset 3.x+  
**Status**: Production Ready
