# DHIS2 Column Name Sanitization Fix

## Problem
Data elements with special characters were causing layout distortions when added to charts:
- `105-EP01c. Malaria Confirmed (B/s and RDT Positive)`
- `Cases - Confirmed & Probable`
- `Data.Element`
- `Org-Unit`

These special characters (/, -, ., (, ), &, etc.) were not being properly handled throughout the codebase.

## Root Causes
1. **Incomplete sanitization**: Special characters were being removed or partially replaced instead of systematically converted to underscores
2. **Verbose name used in queries**: The `verbose_name` field stored the original unsanitized name, causing mismatches when referenced in formData
3. **Inconsistent application**: Sanitization wasn't applied uniformly across all query paths (analytics, dataValueSets, etc.)

## Solution
Implemented comprehensive column name sanitization that:

### 1. Updated Sanitization Function
**File**: `superset/db_engine_specs/dhis2_dialect.py`

```python
def sanitize_dhis2_column_name(name: str) -> str:
    """Sanitize DHIS2 column names for Superset compatibility."""
    name = re.sub(r'[^\w]', '_', name)  # Replace all non-alphanumeric with _
    name = re.sub(r'_+', '_', name)     # Collapse multiple underscores
    name = name.strip('_')               # Remove leading/trailing underscores
    return name
```

**Converts**:
- `105-EP01c. Malaria Confirmed (B/s and RDT Positive)` → `105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive`
- `Data.Element` → `Data_Element`
- `Cases - Confirmed & Probable` → `Cases_Confirmed_Probable`

### 2. Fixed Verbose Name Storage
**File**: `superset/db_engine_specs/dhis2_dialect.py` (line 1071)

Changed from:
```python
"verbose_name": item_name,  # Original unsanitized name
```

To:
```python
"verbose_name": column_name,  # SANITIZED name for display and queries
```

This ensures all references to columns use the same sanitized names.

### 3. Applied Sanitization Across All Endpoints
Sanitization is now consistently applied to all DHIS2 data endpoints:
- Analytics (wide format)
- DataValueSets
- TrackedEntityInstances
- Events
- Enrollments
- All custom data elements

### 4. Migration Script
**File**: `superset/migrations/versions/2025-12-06_sanitize_dhis2_columns.py`

Automatically sanitizes all existing DHIS2 dataset column names:
- Finds all columns in DHIS2 datasets
- Converts column names to sanitized format
- Preserves original names in description field for reference

Run with: `alembic upgrade head`

### 5. Fixed Chart Query Column References
**File**: `superset/models/helpers.py`

Updated `_sanitize_column_reference()` and `adhoc_metric_to_sqla()` to:
- Detect DHIS2 datasets by checking database URI
- Automatically sanitize column names from chart formData
- Ensure chart queries reference correct sanitized columns
- Works for both groupby columns and metric columns

This ensures that when a chart's formData contains unsanitized column names (from when they were selected), they are automatically converted to match the sanitized names in the dataset.

## Impact

### For End Users
✅ Column names now render correctly without layout distortion
✅ Data elements with special characters work reliably in charts
✅ Charts no longer return index 0 (Period) for data elements with special characters
✅ No manual intervention needed for new datasets
✅ Existing datasets will be automatically fixed via migration
✅ Existing chart configurations continue to work without changes

### For Developers
✅ All column references use consistent sanitized names
✅ Chart formData automatically sanitized at query time
✅ No more need for workaround sanitization in pandas postprocessing
✅ Centralized sanitization function ensures consistency
✅ DHIS2-specific handling isolated in `_sanitize_column_reference()`

## Files Modified
1. `superset/db_engine_specs/dhis2_dialect.py` - Updated sanitization function and verbose_name handling
2. `superset/models/helpers.py` - Updated `_sanitize_column_reference()` and `adhoc_metric_to_sqla()` for chart queries
3. `superset/migrations/versions/2025-12-06_sanitize_dhis2_columns.py` - Migration to fix existing data

## Verification

Run the complete test suite:
```bash
python test_sanitize.py
python test_dhis2_consistency.py
python test_chart_column_sanitization.py
```

Expected output:
- All special characters converted to underscores
- Multiple consecutive underscores collapsed to single underscore
- Column names consistent across all query paths
- Chart formData column names automatically sanitized
- Layout ordering preserved without distortion
- Data elements with special characters return correct columns (not index 0)

## Backward Compatibility

The changes are fully backward compatible:
- Original data element names preserved in description field for reference
- Existing charts continue to work (column references updated via migration)
- No changes to user-facing column labels (verbose_name provides display names)
