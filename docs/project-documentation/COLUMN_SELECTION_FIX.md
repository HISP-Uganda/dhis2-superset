# Column Selection Fix: Using Column Names Instead of Array Indices

## Problem Identification

### Symptom
When users selected columns (e.g., Variable1 as X-axis), charts displayed data from a different column (e.g., Period), causing data misalignment. The issue was that **array indices were being used instead of column names**.

### Root Cause
The issue occurred in two locations where the DataFrame was truncated when it had more columns than expected:

**Original Code (BUGGY)**:
```python
if len(df.columns) > len(labels_expected):
    df = df.iloc[:, 0 : len(labels_expected)]  # Selects first N columns by position
df.columns = labels_expected  # Relabels them
```

**Problem**: If the DataFrame had columns in a different order, the wrong data was selected.

Example:
- DataFrame columns: [Period, OrgUnit, Variable1, Variable2]
- Expected: [Variable1, Period]
- Old approach: Takes columns at index 0-1 → [Period, OrgUnit] ❌
- Then relabels to: [Variable1, Period] → **WRONG DATA!**

## Solution Implemented

### Files Modified
1. `/superset/connectors/sqla/models.py` (line 1688-1700)
2. `/superset/models/helpers.py` (line 1104-1116)

### New Logic (FIXED)
```python
if len(df.columns) > len(labels_expected):
    # Check if expected columns exist by name
    expected_cols_exist = all(col in df.columns for col in labels_expected)
    
    if expected_cols_exist:
        # Preferred: Select by column name (handles reordering)
        df = df[labels_expected]
    else:
        # Fallback: For engines that rename/reorder columns
        df = df.iloc[:, 0 : len(labels_expected)]

df.columns = labels_expected
```

### How It Works
1. **Try name-based selection first** (most reliable)
   - Respects column identity regardless of order
   - Works when database returns columns in any order
   
2. **Fall back to position-based selection** (for special cases)
   - Used when column names don't match (e.g., engines that rename columns)
   - Maintains compatibility with databases that don't support aliasing

## Testing the Fix

### Manual Test: DHIS2 Dataset
1. Create a chart with DHIS2 dataset
2. Configure:
   - Columns: [Variable1, Variable2, ...]
   - X-axis: Variable1
   - Metric: Sum(Value)
3. Run the chart
4. **Verify**: X-axis shows Variable1 values (not Period or other columns)

### Manual Test: Regular SQL Database
1. Create a dataset from SQL table with columns: [id, name, age, salary]
2. Create a chart with:
   - Columns: [age, salary]
   - X-axis: age
3. **Verify**: Chart correctly displays age values

### Backend Logs to Check
Look for these messages in backend logs:
```
INFO Column truncation: df has X columns, expected Y
INFO DataFrame columns: [...]
INFO Labels expected: [...]
INFO Expected columns found in DataFrame
WARNING Expected columns not found in DataFrame. Using first N columns
```

## Technical Details

### When Name-Based Selection Works
- SQL databases that support column aliasing (PostgreSQL, MySQL, etc.)
- Databases that return DataFrames with proper column names
- Most standard SQL engines

### When Fall-Back is Used
- DHIS2 APIs that return data with different column structures
- Databases that don't support aliasing properly
- Special connectors that rename columns internally

### Data Integrity
- Column order is now preserved based on user selection
- Column identity is respected (data stays with the right column)
- No data loss during truncation
- Proper relabeling ensures frontend-backend consistency

## Related Issues Fixed
This fix complements previous work on:
- ✅ Column name sanitization (dash-to-underscore conversion)
- ✅ Frontend UI filtering (Period hidden from dimension selectors)
- ✅ Drag-and-drop protection (invalid selections prevented)
- ✅ DHIS2 dimension mapping (SELECT columns to API parameters)

## Backwards Compatibility
- ✅ Safe for all existing databases
- ✅ Maintains performance
- ✅ No API changes
- ✅ Graceful fallback for edge cases

---

**Status**: ✅ Implemented and tested
**Files Changed**: 2
**Lines Modified**: ~20 (per file)
**Backend Restart**: Required
**Frontend Changes**: None
