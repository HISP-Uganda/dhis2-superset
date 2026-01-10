# Column Preservation Across All Chart Types

## Problem Statement

When rendering charts with DHIS2 datasets that have special characters in column names:
1. **Sanitization**: Column names are sanitized (e.g., `105-EP01b. Malaria Total` → `105_EP01b_Malaria_Total`)
2. **Query Building**: Sanitized names are used in SQL query building
3. **Data Rendering**: Some chart types lose column names and revert to numeric indices `[0]`, `[1]`, `[2]`

**Issue**: Especially in pivot tables and table charts, column names may not be displayed, showing indices instead.

---

## Root Causes

### 1. **MultiIndex Column Flattening (Pivot Tables)**

**Problem Location**: `superset/charts/client_processing.py`, lines 150-154 and 371-378

```python
# Lines 150-154: Convert to MultiIndex
if not isinstance(df.columns, pd.MultiIndex):
    df.columns = pd.MultiIndex.from_tuples([(str(i),) for i in df.columns])

# Lines 371-378: Flatten back to strings
processed_df.columns = [
    (
        " ".join(str(name) for name in column).strip()
        if isinstance(column, tuple)
        else column
    )
    for column in processed_df.columns
]
```

**Result**: When pivot creates MultiIndex columns like `('105_EP01b_Malaria_Total', 'District1')`, flattening converts them to `'105_EP01b_Malaria_Total District1'` (space-joined).

**Issue**: For pivot tables with multiple values and groupby columns, this can create ambiguous column names or lose metric identity.

### 2. **Column Index Access Pattern**

**Problem Location**: `superset/charts/client_processing.py`, line 133

```python
# Problem: Using integer index access
indexes = [i for col, i in grouped_columns]
df = df[df.columns[indexes]]  # ← Can lose column identity in complex scenarios
```

This pattern can lose column names when dealing with complex MultiIndex structures.

### 3. **Verbose Map Incomplete Coverage**

**Problem Location**: `superset/charts/client_processing.py`, line 356

```python
if datasource:
    df.rename(columns=datasource.data["verbose_map"], inplace=True)
```

**Issue**: If `verbose_map` doesn't contain all columns, those columns keep their sanitized names while others get human-readable labels, creating inconsistency.

### 4. **Column Config Formatting**

**Problem Location**: `superset/charts/client_processing.py`, lines 293-301

```python
for column, config in column_config.items():
    if "d3NumberFormat" in config:
        format_ = "{:" + config['d3NumberFormat'] + "}"
        try:
            df[column] = df[column].apply(format_.format)
        except Exception:
            pass  # Silent failure if column not found
```

**Issue**: If column not found, it silently fails, potentially causing column lookup issues later.

---

## Chart Type Impact Analysis

| Chart Type | Affected | Issue | Severity |
|------------|----------|-------|----------|
| **Table** | ❌ No | Columns preserved as-is | ✓ Low |
| **Bar Chart** | ❌ No | X/Y axes named correctly | ✓ Low |
| **Line Chart** | ❌ No | Series named correctly | ✓ Low |
| **Pivot Table v2** | ⚠️ Yes | MultiIndex flattening ambiguity | 🔴 High |
| **Pivot Table v1** | ⚠️ Yes | Similar MultiIndex issues | 🔴 High |
| **T-Test Table** | ⚠️ Yes | Column flattening | 🟡 Medium |
| **Pie Chart** | ❌ No | Label preservation OK | ✓ Low |
| **Scatter Plot** | ❌ No | Axis labels preserved | ✓ Low |

---

## Solution: Column Preservation Strategy

### Strategy 1: Enhanced MultiIndex Column Flattening

**File**: `superset/charts/client_processing.py`

**Current (Problem)**:
```python
# Simply joins with space - ambiguous!
" ".join(str(name) for name in column).strip()
```

**Proposed (Solution)**:
```python
def flatten_multiindex_column(column: Union[str, tuple]) -> str:
    """Flatten MultiIndex column while preserving readability and uniqueness."""
    if not isinstance(column, tuple):
        return str(column)
    
    # Use ' - ' separator to distinguish levels
    # E.g., ('105_EP01b_Malaria_Total', 'District1') → '105_EP01b_Malaria_Total - District1'
    parts = [str(c) for c in column if c]  # Filter out None/empty strings
    if len(parts) == 1:
        return parts[0]
    
    # For metric + dimension: "Metric Name - Dimension Value"
    return ' - '.join(parts)

# In pivot_df function, use it to track original metric + dimension combinations
flattened_columns = [
    flatten_multiindex_column(col)
    for col in df.columns
]
```

**Why Better**:
- Uses `' - '` (space-dash-space) as separator instead of just space
- Clearer visual distinction between levels
- Metric name and dimension are clearly separated
- Example: `'105_EP01b_Malaria_Total - District1'` vs `'105_EP01b_Malaria_Total District1'`

### Strategy 2: Column Name Preservation Mapping

**Create a mapping** to preserve metadata during transformations:

```python
# Track original column metadata through transformations
column_metadata = {
    '105_EP01b_Malaria_Total - District1': {
        'metric': '105_EP01b_Malaria_Total',
        'dimension': 'District1',
        'metric_label': 'Malaria Cases (Total)',
        'sanitized_from': '105-EP01b. Malaria Total',
    }
}

# Use this for:
# 1. Proper column display in UI
# 2. Matching columns when postprocessing
# 3. Handling user sorting/filtering
```

### Strategy 3: Safe Column Index Access

**Replace pattern**: `df[df.columns[indexes]]`
**With pattern**: `df[[df.columns[i] for i in indexes]]`

**File**: `superset/charts/client_processing.py`, line 133

```python
# Before (PROBLEM)
indexes = [i for col, i in grouped_columns]
df = df[df.columns[indexes]]

# After (SOLUTION)
indexes = [i for col, i in grouped_columns]
selected_columns = [df.columns[i] for i in indexes]
df = df[selected_columns]
```

**Why Better**:
- Explicitly extracts column names before selection
- Works correctly with complex MultiIndex
- Maintains column name identity

### Strategy 4: Comprehensive Verbose Map Coverage

**Problem**: Some columns not in verbose_map

**Solution**: Ensure all columns are mapped before renaming

```python
# After query execution, before processing
if datasource:
    verbose_map = datasource.data.get("verbose_map", {})
    
    # Create mapping for any unmapped columns
    unmapped = set(df.columns) - set(verbose_map.keys())
    for col in unmapped:
        # Keep original column name if not in verbose_map
        # (these are already sanitized names)
        verbose_map[col] = col
    
    df.rename(columns=verbose_map, inplace=True)
```

### Strategy 5: Chart-Type-Specific Handling

Create specialized handling for each chart type:

```python
def table(df: pd.DataFrame, form_data: dict, datasource=None) -> pd.DataFrame:
    """Table chart - preserve all columns as-is."""
    # No MultiIndex conversion needed
    # Apply formatting only if columns exist
    column_config = form_data.get("column_config", {})
    for column, config in column_config.items():
        if column in df.columns and "d3NumberFormat" in config:
            # Only apply if column exists
            format_ = "{:" + config['d3NumberFormat'] + "}"
            try:
                df[column] = df[column].apply(format_.format)
            except Exception as e:
                logger.warning(f"Could not format column {column}: {e}")
    return df


def pivot_table_v2(df: pd.DataFrame, form_data: dict, datasource=None) -> pd.DataFrame:
    """Pivot table - handle MultiIndex specially."""
    # ... existing pivot logic ...
    
    # After pivot, preserve metric identity
    if isinstance(df.columns, pd.MultiIndex):
        # Store metadata about metrics and dimensions
        metrics = get_metric_names(form_data["metrics"], 
                                   datasource.data.get("verbose_map") if datasource else None)
        
        # Flatten with semantic separator
        df.columns = [
            ' - '.join(str(c) for c in col if c)
            for col in df.columns
        ]
```

---

## Implementation Checklist

### Phase 1: Analysis & Testing (Current)
- [x] Identify column preservation issues
- [x] Test column handling across chart types
- [x] Identify root causes
- [ ] Document expected behavior for each chart type

### Phase 2: Core Fixes
- [ ] Implement `flatten_multiindex_column()` function
- [ ] Update `pivot_df()` to use better flattening
- [ ] Replace `df[df.columns[indexes]]` pattern
- [ ] Add comprehensive verbose_map coverage
- [ ] Add logging for column transformations

### Phase 3: Chart-Type-Specific Fixes
- [ ] Update `table()` function with error handling
- [ ] Update `pivot_table_v2()` with metadata preservation
- [ ] Test all affected chart types
- [ ] Add column preservation tests to test suite

### Phase 4: Validation & Documentation
- [ ] Create comprehensive test suite
- [ ] Document column flow for each chart type
- [ ] Update API documentation
- [ ] Create migration guide for custom charts

---

## Testing Strategy

### Test 1: Column Name Preservation
```python
def test_sanitized_columns_preserved_in_table():
    """Ensure sanitized column names appear in table output."""
    df = create_dhis2_dataframe()
    result = table(df, form_data={}, datasource=None)
    
    assert '105_EP01b_Malaria_Total' in result.columns
    assert all(not isinstance(col, int) for col in result.columns)
```

### Test 2: Pivot Table Column Clarity
```python
def test_pivot_table_metric_dimension_clarity():
    """Ensure pivoted columns clearly show metric and dimension."""
    df = create_dhis2_dataframe()
    form_data = {
        'groupbyRows': ['Period'],
        'groupbyColumns': ['OrgUnit'],
        'metrics': ['105_EP01b_Malaria_Total'],
    }
    result = pivot_table_v2(df, form_data)
    
    # Should show "Metric - Dimension" pattern
    assert any('-' in str(col) for col in result.columns)
    # Should NOT show numeric indices
    assert all(not str(col).isdigit() for col in result.columns)
```

### Test 3: All Chart Types
```python
def test_all_chart_types_preserve_columns():
    """Test column preservation across all chart types."""
    chart_types = [
        'table', 'bar', 'line', 'pie', 'scatter',
        'pivot_table_v2', 'pivot_table_v1',
    ]
    
    for chart_type in chart_types:
        result = apply_client_processing(
            query_result,
            form_data={'viz_type': chart_type},
            datasource=dhis2_datasource
        )
        
        # Verify columns are not numeric indices
        assert not any(isinstance(col, int) for col in result['colnames'])
```

---

## Deployment Checklist

1. **Database Migration**: None required (pure Python changes)

2. **Configuration Changes**: None required

3. **Feature Flags**: Consider adding:
   ```python
   IMPROVED_COLUMN_PRESERVATION = True  # New feature
   ```

4. **Backward Compatibility**: 
   - Changes are transparent to existing code
   - No API changes needed
   - Column output format may change slightly (space-dash-space separator)

5. **Rollback Plan**:
   - Revert `client_processing.py` changes
   - All functionality returns to original behavior

---

## Success Criteria

| Criterion | Before | After | Status |
|-----------|--------|-------|--------|
| Sanitized columns preserved in table charts | ❌ Sometimes | ✓ Always | Pending |
| Pivot tables show readable column names | ⚠️ Ambiguous | ✓ Clear | Pending |
| No numeric indices in column names | ⚠️ May occur | ✓ Never | Pending |
| Metric + dimension clarity in pivots | ⚠️ Unclear | ✓ "Metric - Dimension" | Pending |
| All chart types handle consistently | ❌ No | ✓ Yes | Pending |
| Tests cover all column transformations | ❌ Partial | ✓ Comprehensive | Pending |

---

## Example: DHIS2 Multi-Metric Chart with Column Preservation

### Before Fix:
```
Table shows:
  [0]  [1]      [2]        [3]       
2024-Q1  District1  1500     500
2024-Q1  District2  2100     700
```

### After Fix:
```
Table shows:
  Period  OrgUnit  105_EP01b_Malaria_Total  105_EP01a_Suspected_fever
2024-Q1  District1        1500                     500
2024-Q1  District2        2100                     700

Pivot shows:
  Period  105_EP01b_Malaria_Total - District1  105_EP01b_Malaria_Total - District2
2024-Q1                  1500                              2100
2024-Q1                   500                               700
```

---

## References

- **File**: `superset/charts/client_processing.py`
- **Functions Affected**: `pivot_df()`, `pivot_table_v2()`, `table()`, `apply_client_processing()`
- **Related**: DHIS2 column sanitization in `superset/models/helpers.py:1344`
- **Postprocessing**: `superset/utils/pandas_postprocessing/utils.py`
