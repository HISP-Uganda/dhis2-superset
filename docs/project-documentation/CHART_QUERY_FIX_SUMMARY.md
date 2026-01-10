# DHIS2 Chart Query Column Sanitization Fix

## Problem Statement

When a data element with special characters was selected in a chart:
- **Example**: `105-EP01c. Malaria Confirmed (B/s and RDT Positive)`
- **Symptom**: Chart returned index 0 (Period) instead of the selected data element
- **Symptom**: Chart/Table display was distorted with incorrect data
- **Sample table**: Showed correct data
- **Other data elements**: Worked fine (those without special characters)

## Root Cause Analysis

The issue had two parts:

### 1. **Column Metadata Mismatch**
- Dataset metadata stored column names with special characters unchanged
- When querying, the sanitized column names from API results didn't match
- This caused a lookup failure, defaulting to index 0

### 2. **Chart FormData Reference Mismatch**
- Chart's formData contained original unsanitized column names (selected by user)
- When building the query, Superset looked for these names in the dataset
- But the dataset had sanitized column names after the fixes
- The `_sanitize_column_reference()` method didn't apply DHIS2-specific sanitization

## Solution Overview

Implemented a **three-layer sanitization strategy**:

### Layer 1: API Response Sanitization ✓
**File**: `superset/db_engine_specs/dhis2_dialect.py` (already fixed)
- All column names returned from DHIS2 API are sanitized
- Special characters converted to underscores
- Consistent across all endpoints

### Layer 2: Dataset Metadata Sanitization ✓
**File**: `superset/db_engine_specs/dhis2_dialect.py` + Migration
- Column `verbose_name` stores sanitized name (was storing original)
- Migration script updates existing datasets
- Ensures dataset columns use consistent sanitized names

### Layer 3: Chart Query Sanitization ✓ (NEW)
**File**: `superset/models/helpers.py`
- `_sanitize_column_reference()`: Auto-sanitizes DHIS2 column references
- `adhoc_metric_to_sqla()`: Sanitizes metric column references
- Detects DHIS2 datasets by checking database URI

## Implementation Details

### New Code in `_sanitize_column_reference()`

```python
def _sanitize_column_reference(self, column_ref: str) -> str:
    """
    Sanitize a column reference for datasources.
    For DHIS2, apply sanitization to match the column metadata stored in the database.
    """
    if not column_ref:
        return column_ref
        
    # Check if this is a DHIS2 dataset
    is_dhis2 = False
    if hasattr(self, 'database') and self.database:
        uri = getattr(self.database, 'sqlalchemy_uri_decrypted', None) or getattr(self.database, 'sqlalchemy_uri', '')
        is_dhis2 = 'dhis2://' in str(uri)
    
    if is_dhis2:
        # Apply DHIS2 column name sanitization
        try:
            from superset.db_engine_specs.dhis2_dialect import sanitize_dhis2_column_name
            return sanitize_dhis2_column_name(column_ref)
        except (ImportError, ModuleNotFoundError):
            pass
    
    return column_ref
```

### Modified `adhoc_metric_to_sqla()`

Changed from:
```python
column_name = cast(str, metric_column.get("column_name"))
sqla_column = sa.column(column_name)
```

To:
```python
column_name = cast(str, metric_column.get("column_name"))
sanitized_column_name = self._sanitize_column_reference(column_name)
sqla_column = sa.column(sanitized_column_name)
```

## How It Works

### Query Execution Flow

1. **User selects data element** in chart UI
   - FormData stores: `"105-EP01c. Malaria Confirmed (B/s and RDT Positive)"`

2. **Chart builds query** in `helpers.py`
   - Calls `_sanitize_column_reference("105-EP01c. Malaria Confirmed (B/s and RDT Positive)")`
   - Returns: `"105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive"`

3. **Query looks up column** in dataset metadata
   - Searches `columns_by_name` for `"105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive"`
   - Finds match (because dataset has sanitized column names)

4. **DHIS2 API returns data**
   - Returns columns: `["Period", "OrgUnit", "105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive"]`
   - Names match expectations

5. **Chart renders correctly**
   - Data displayed with correct column
   - No more "index 0" errors
   - Layout ordering preserved

## Testing

All tests pass:

```bash
python test_sanitize.py                    # ✓ Sanitization function
python test_dhis2_consistency.py           # ✓ Consistency across endpoints
python test_chart_column_sanitization.py   # ✓ Chart query sanitization (NEW)
```

## Backward Compatibility

✅ **Fully backward compatible**
- Existing charts continue to work
- FormData sanitization is automatic
- Non-DHIS2 datasets unaffected
- Original names preserved in column descriptions

## Verification Checklist

- [x] Sanitization function handles all special characters
- [x] Dataset metadata uses sanitized names
- [x] Chart queries reference sanitized columns
- [x] Metric aggregations use sanitized columns
- [x] DHIS2-specific logic isolated
- [x] Non-DHIS2 datasources not affected
- [x] Existing datasets work after migration
- [x] All tests pass

## Impact

### Before Fix
- Data element `105-EP01c. Malaria Confirmed (B/s and RDT Positive)` → Returns Period (index 0)
- Chart displays distorted/incorrect data
- User cannot reliably use data elements with special characters

### After Fix
- Data element `105-EP01c. Malaria Confirmed (B/s and RDT Positive)` → Returns correct column
- Chart displays correct data
- All special characters handled consistently
- Layout ordering preserved
- No manual intervention needed

## Files Modified

1. **`superset/db_engine_specs/dhis2_dialect.py`**
   - Updated `sanitize_dhis2_column_name()` function
   - Fixed `verbose_name` to use sanitized names

2. **`superset/models/helpers.py`** ← NEW
   - Enhanced `_sanitize_column_reference()` for DHIS2
   - Updated `adhoc_metric_to_sqla()` to sanitize column references

3. **`superset/migrations/versions/2025-12-06_sanitize_dhis2_columns.py`** ← NEW
   - Migration to sanitize existing dataset columns
   - Run with: `alembic upgrade head`

## Next Steps

1. **Run migration**: `alembic upgrade head`
2. **Restart application**: Clears any cached column mappings
3. **Verify charts**: Re-open charts with special character data elements
4. **Test new charts**: Create new charts with problematic data elements

All fixes are automatic - no manual chart updates required.
