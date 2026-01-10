# DHIS2 Data Element Special Characters & Period Column Fix

## Complete Fix Overview

Three related issues have been fixed to ensure DHIS2 data elements with special characters work reliably in charts:

### Issue 1: Column Name Sanitization
**Problem**: Data element names with special characters (/, -, ., etc.) not properly sanitized
**Fixed in**: `superset/db_engine_specs/dhis2_dialect.py`

### Issue 2: Chart Query Column References  
**Problem**: Chart formData contains unsanitized column names, but dataset has sanitized names
**Fixed in**: `superset/models/helpers.py` + `superset/db_engine_specs/dhis2_dialect.py`

### Issue 3: Period Column Handling
**Problem**: When Period added to groupby, layout distorts because Period treated as datetime
**Fixed in**: `superset/models/helpers.py`

---

## Issue 1: Column Name Sanitization

### Problem
Data element names like `105-EP01c. Malaria Confirmed (B/s and RDT Positive)` contain special characters that broke column handling.

### Root Cause
- Old function removed special chars inconsistently: `()` removed, other chars partially replaced
- Special characters weren't systematically converted to underscores
- Result: Column metadata didn't match query results

### Solution
**File**: `superset/db_engine_specs/dhis2_dialect.py` (lines 35-45)

```python
def sanitize_dhis2_column_name(name: str) -> str:
    """Sanitize DHIS2 column names for Superset compatibility."""
    name = re.sub(r'[^\w]', '_', name)  # Replace all non-alphanumeric with _
    name = re.sub(r'_+', '_', name)     # Collapse multiple underscores
    name = name.strip('_')               # Remove leading/trailing underscores
    return name
```

### Example Conversions
```
105-EP01c. Malaria Confirmed (B/s and RDT Positive)
→ 105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive

Data.Element → Data_Element
Cases - Confirmed & Probable → Cases_Confirmed_Probable
```

### Also Fixed
**File**: `superset/db_engine_specs/dhis2_dialect.py` (line 1071)

Changed `verbose_name` from original unsanitized name to sanitized name:
```python
# Before
"verbose_name": item_name  # Original unsanitized name

# After
"verbose_name": column_name  # SANITIZED name for display and queries
```

---

## Issue 2: Chart Query Column References

### Problem
When user selects data element in chart:
- FormData stores: `"105-EP01c. Malaria Confirmed (B/s and RDT Positive)"` (unsanitized)
- Dataset has: `"105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive"` (sanitized)
- Query can't find column → Returns index 0 (Period) instead

### Root Cause
The `_sanitize_column_reference()` method wasn't applying DHIS2-specific sanitization to column names from chart formData.

### Solution
**File**: `superset/models/helpers.py` (lines 1610-1632)

Enhanced `_sanitize_column_reference()` to:
1. Detect DHIS2 datasets by checking database URI
2. Apply sanitization to column names from chart formData
3. Ensure queries reference correct sanitized columns

```python
def _sanitize_column_reference(self, column_ref: str) -> str:
    """Sanitize a column reference for datasources."""
    if not column_ref:
        return column_ref
        
    # Check if this is a DHIS2 dataset
    is_dhis2 = False
    if hasattr(self, 'database') and self.database:
        uri = getattr(self.database, 'sqlalchemy_uri_decrypted', None) or getattr(self.database, 'sqlalchemy_uri', '')
        is_dhis2 = 'dhis2://' in str(uri)
    
    if is_dhis2:
        try:
            from superset.db_engine_specs.dhis2_dialect import sanitize_dhis2_column_name
            return sanitize_dhis2_column_name(column_ref)
        except (ImportError, ModuleNotFoundError):
            pass
    
    return column_ref
```

### Also Updated
**File**: `superset/models/helpers.py` (lines 1334-1339)

Updated `adhoc_metric_to_sqla()` to sanitize metric column references:

```python
# Before
column_name = cast(str, metric_column.get("column_name"))
sqla_column = sa.column(column_name)

# After
column_name = cast(str, metric_column.get("column_name"))
sanitized_column_name = self._sanitize_column_reference(column_name)
sqla_column = sa.column(sanitized_column_name)
```

### Result
Chart queries now properly find and return the correct data element columns.

---

## Issue 3: Period Column Handling

### Problem
When Period column added to chart groupby:
- Layout gets distorted
- Period forced to first position
- User's selected column order not respected

### Root Cause
In query building logic, any column matching the `granularity` (time/grouping dimension) is treated as a datetime column:
1. Calls `get_timestamp_expression()` 
2. Forces it to first position
3. Applies time grain transformations

But in DHIS2, Period is a **categorical dimension** (`is_dttm=False`), not temporal.

### Solution
**File**: `superset/models/helpers.py`

#### Change 1: Period Groupby Handling (lines 2061-2080)
```python
if selected_key == granularity_key:
    if is_dhis2_datasource and not table_col.is_dttm:
        # Period is categorical, not temporal
        outer = self.convert_tbl_column_to_sqla_col(table_col, ...)
    else:
        # Regular datetime handling
        outer = table_col.get_timestamp_expression(...)
```

#### Change 2: Column Validation (lines 2133-2149)
```python
if dttm_col_key not in columns_by_name:
    raise QueryObjectValidationError(...)
if not dttm_col and not (is_dhis2_datasource and granularity in columns_by_name):
    raise QueryObjectValidationError(...)
```

#### Change 3: Timestamp Expression Skipping (line 2152)
```python
if is_timeseries and dttm_col:  # Skip if dttm_col is None
    timestamp = dttm_col.get_timestamp_expression(...)
```

#### Change 4: Time Filter Skipping (lines 2171-2196)
```python
if (dttm_col and self.always_filter_main_dttm and ...):
    # Skip if dttm_col is None

if dttm_col:
    time_filter_column = self.get_time_filter(time_col=dttm_col, ...)
    time_filters.append(time_filter_column)
```

### Result
Period is now treated as a categorical column, preserving user's selected column order.

---

## Migration Script

**File**: `superset/migrations/versions/2025-12-06_sanitize_dhis2_columns.py`

Automatically sanitizes all existing DHIS2 dataset column names:
```bash
alembic upgrade head
```

---

## Testing

Run all test suites:
```bash
python test_sanitize.py                    # ✓ Column name sanitization
python test_dhis2_consistency.py           # ✓ Consistency across endpoints
python test_chart_column_sanitization.py   # ✓ Chart query sanitization
python test_period_column_fix.py           # ✓ Period column handling
```

---

## Deployment Checklist

- [ ] Run migration: `alembic upgrade head`
- [ ] Restart Superset application
- [ ] Clear browser cache (charts cached in memory)
- [ ] Test chart with: OrgUnit, Period, Data Element columns
- [ ] Verify:
  - Column order respected
  - No layout distortion
  - Correct data displayed
  - Period renders in selected position

---

## Summary of Changes

### Files Modified
1. **`superset/db_engine_specs/dhis2_dialect.py`**
   - Improved `sanitize_dhis2_column_name()` function
   - Fixed `verbose_name` to use sanitized names

2. **`superset/models/helpers.py`**
   - Enhanced `_sanitize_column_reference()` for DHIS2
   - Updated `adhoc_metric_to_sqla()` to sanitize column references
   - Added Period categorical handling in query building
   - Updated column validation for categorical Period
   - Added conditional checks for dttm_col (None for DHIS2 Period)

3. **`superset/migrations/versions/2025-12-06_sanitize_dhis2_columns.py`**
   - Migration to sanitize existing dataset columns

### Files Created (for testing)
- `test_sanitize.py`
- `test_dhis2_consistency.py`
- `test_chart_column_sanitization.py`
- `test_period_column_fix.py`
- `DHIS2_COLUMN_SANITIZATION.md`
- `CHART_QUERY_FIX_SUMMARY.md`
- `PERIOD_COLUMN_FIX.md`

---

## Impact

### Before Fixes
❌ Data elements with special characters return wrong data (index 0)
❌ Charts distort when Period column added
❌ Column order not respected
❌ Sample table shows correct data, but chart shows incorrect data

### After Fixes
✅ Data elements with special characters work reliably
✅ Period column doesn't distort layout
✅ Column order is preserved
✅ Sample table and chart show same correct data
✅ All special characters (/, -, ., (, ), etc.) handled consistently

---

## Technical Details

### Sanitization Function
Converts all non-word characters to underscores:
- Uses regex: `[^\w]` (anything not alphanumeric or underscore)
- Collapses multiple underscores: `__` → `_`
- Strips leading/trailing underscores

### DHIS2 Detection
Checks database URI for `dhis2://` protocol:
```python
uri = getattr(self.database, 'sqlalchemy_uri_decrypted', None) or getattr(self.database, 'sqlalchemy_uri', '')
is_dhis2 = 'dhis2://' in str(uri)
```

### Categorical Dimension Detection
Checks if Period column is marked as non-temporal:
```python
if is_dhis2_datasource and not table_col.is_dttm:
    # Treat as categorical, not datetime
```

---

## Backward Compatibility

✅ **Fully backward compatible**
- Existing charts continue to work
- FormData sanitization is automatic
- Non-DHIS2 datasets unaffected
- Original names preserved in column descriptions
- No manual chart updates required

All fixes are transparent to users and require no manual intervention.
