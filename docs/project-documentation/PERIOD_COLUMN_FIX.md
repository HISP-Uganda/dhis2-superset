# DHIS2 Period Column Fix - Preventing Layout Distortion

## Problem Identified

When `Period` was **added** to the chart's groupby columns (along with OrgUnit and data elements):
- **Symptom**: Layout gets distorted
- **Cause**: Period was being treated as a datetime/timestamp column instead of a categorical dimension
- **Result**: Period would be forced to the first position, breaking the user's selected column order

### Example
**User selects**: OrgUnit → Period → 105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive

**Before fix**: Period → OrgUnit → 105_EP01c_... (distorted, wrong order)  
**After fix**: OrgUnit → Period → 105_EP01c_... (correct order, no distortion)

## Root Cause

In Superset's query building logic (`superset/models/helpers.py`), when a column matches the `granularity` (the time/grouping dimension), it automatically:
1. Calls `get_timestamp_expression()` to create a datetime expression
2. Forces it to the first position in the SELECT statement
3. Applies time grain transformations

For DHIS2 datasets, `Period` is a **categorical dimension** (marked `is_dttm=False`), not a temporal column. But the code was still treating it as a datetime column.

## Solution Implemented

### Code Changes in `superset/models/helpers.py`

#### 1. **Period Groupby Handling** (Lines 2063-2080)

**Before**:
```python
if selected_key == granularity_key:
    outer = table_col.get_timestamp_expression(...)  # Always datetime
```

**After**:
```python
if selected_key == granularity_key:
    if is_dhis2_datasource and not table_col.is_dttm:
        # Period is categorical, not temporal
        outer = self.convert_tbl_column_to_sqla_col(table_col, ...)
    else:
        # Regular datetime handling
        outer = table_col.get_timestamp_expression(...)
```

#### 2. **Column Validation** (Lines 2133-2149)

**Before**:
```python
if dttm_col_key not in columns_by_name or not dttm_col:
    raise QueryObjectValidationError(...)  # Would fail if dttm_col is None
```

**After**:
```python
if dttm_col_key not in columns_by_name:
    raise QueryObjectValidationError(...)
if not dttm_col and not (is_dhis2_datasource and granularity in columns_by_name):
    raise QueryObjectValidationError(...)  # Only fail if truly missing
```

#### 3. **Timestamp Expression Skipping** (Lines 2152-2168)

**Before**:
```python
if is_timeseries:
    timestamp = dttm_col.get_timestamp_expression(...)  # Would crash if None
```

**After**:
```python
if is_timeseries and dttm_col:  # Skip if dttm_col is None
    timestamp = dttm_col.get_timestamp_expression(...)
```

#### 4. **Time Filter Skipping** (Lines 2171-2196)

**Before**:
```python
if (self.always_filter_main_dttm and ...):
    # Would crash trying to access dttm_col.column_name when None

time_filter_column = self.get_time_filter(time_col=dttm_col, ...)  # Would fail
```

**After**:
```python
if (dttm_col and self.always_filter_main_dttm and ...):
    # Skip if dttm_col is None

if dttm_col:
    time_filter_column = self.get_time_filter(time_col=dttm_col, ...)
    time_filters.append(time_filter_column)
```

## How It Works Now

### Query Building Flow for Period Groupby

1. **User selects**: OrgUnit, Period, Data Element
2. **Query builder processes Period**:
   - Detects `is_dhis2_datasource = True`
   - Finds Period in columns: `Period.is_dttm = False`
   - Takes DHIS2 path: `convert_tbl_column_to_sqla_col()` instead of `get_timestamp_expression()`
3. **Result**: Period treated as regular categorical column
4. **Column order**: Preserved as user selected
5. **Layout**: No distortion

### Key Differences

| Aspect | Before | After |
|--------|--------|-------|
| Period handling | Timestamp expression | Categorical column |
| Column position | Forced to first | Respects user order |
| dttm_col value | Expected always | Can be None for DHIS2 |
| Validation | Strict datetime check | Categorical-aware check |
| Time filters | Always applied | Skipped if no datetime |

## Testing

Run the test suite:
```bash
python test_period_column_fix.py
```

Expected output:
✓ Period marked as categorical (is_dttm=False)
✓ Timestamp expression skipped for categorical Period
✓ Column order preserved when Period included

## Migration & Deployment

**No migration needed** - this is a query-time fix

### Prerequisites
1. Ensure Period column is marked `is_dttm=False` in dataset metadata
2. Can be set during dataset creation or via migration from `2025-12-06_sanitize_dhis2_columns.py`

### Testing Checklist
- [ ] Create new chart with groupby: OrgUnit, Period, Data Element
- [ ] Verify Period appears in correct position (not forced to first)
- [ ] Verify data is correct for Period dimension
- [ ] Verify layout renders correctly without distortion
- [ ] Test with different groupby column orders

## Impact

### Users
✅ Can now reliably include Period in charts without layout distortion
✅ Column order is respected
✅ Data accuracy maintained
✅ No manual fixes needed

### Developers
✅ DHIS2-specific logic properly isolated
✅ Categorical dimensions handled correctly
✅ Code more maintainable

## Files Modified

- **`superset/models/helpers.py`**
  - Lines 2063-2080: Period handling in groupby
  - Lines 2133-2149: Column validation
  - Lines 2152-2168: Timestamp expression skipping
  - Lines 2171-2196: Time filter handling

## Related Fixes

This fix complements:
1. **Column Sanitization Fix** - Ensures column names are valid identifiers
2. **Chart Query Sanitization** - Ensures formData column names match dataset columns
3. **Period Marking as Categorical** - Set during dataset creation/import

Together, these fixes ensure DHIS2 data elements with special characters work reliably in charts.
