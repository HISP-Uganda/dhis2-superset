# DHIS2 Column Sanitization - Automatic Fix for Postprocessing Errors

## Problem
When selecting multiple metrics in DHIS2 charts, users got error:
```
Data error
Error: Column referenced by aggregate is undefined: 105_EP01a_Suspected_fever
```

This happened even though:
- All columns were sanitized in the database
- Column metadata had sanitized names
- Query returned correct data

## Root Cause
The postprocessing stage received aggregates with column names that either:
1. Were still unsanitized (from formData)
2. Were missing from the DataFrame (wrapped in aggregate functions like `SUM(column)`)

Example flow:
- FormData requests: `"aggregates": {"name": "SUM(105-EP01a. Suspected fever)"}`
- Database stores column as: `105_EP01a_Suspected_fever`
- Query returns DataFrame with: `SUM(105_EP01a_Suspected_fever)` (aggregated)
- Postprocessing looks for: `105-EP01a. Suspected fever` (unsanitized)
- **Mismatch** → Error

## Solutions Implemented

### 1. Automatic Column Sanitization in Postprocessing
**File**: `superset/utils/pandas_postprocessing/utils.py` (lines 151-168)

**What it does**:
- Detects if aggregate column names have special characters (- . ( ) @ # $ % etc.)
- Automatically sanitizes them using DHIS2 sanitization rules
- Only sanitizes when needed (preserves non-DHIS2 columns)

```python
# Auto-sanitize unsanitized columns like "105-EP01a. Suspected fever"
if column and any(c in column for c in '- .()/@#$%^&*'):
    sanitized_column = sanitize_dhis2_column_name(column)
    sanitized_agg_obj["column"] = sanitized_column
```

**Example**:
- Input: `"105-EP01a. Suspected fever"`
- Output: `"105_EP01a_Suspected_fever"`

### 2. Enhanced Column Matching with Wrapped Aggregates
**File**: `superset/utils/pandas_postprocessing/utils.py` (lines 175-259)

**Matching methods** (in order):
1. **Direct match**: Column exists as-is in DataFrame
2. **Unwrap aggregate**: `SUM(105_EP01a_Suspected_fever)` → extract `105_EP01a_Suspected_fever`
3. **Reverse wrap**: If DataFrame has `SUM(col)` and query wants `col`, match it
4. **DHIS2 sanitization**: Sanitize both names and compare
5. **Case-insensitive**: Try case variations
6. **Fuzzy normalized**: Normalize both names and compare with all wrapper variations

**Example workflow**:
```
Query wants: "105_EP01a_Suspected_fever" (unsanitized from formData)
  ↓
Auto-sanitize: "105_EP01a_Suspected_fever"
  ↓
DataFrame has: "SUM(105_EP01a_Suspected_fever)"
  ↓
Detect wrapper & match inner: "105_EP01a_Suspected_fever" == "105_EP01a_Suspected_fever"
  ↓
✅ Match found!
```

### 3. Column Sanitization During Query Building
**File**: `superset/models/helpers.py` (lines 2115-2118)

**What it does**:
- When processing columns from formData (non-grouped case)
- Sanitizes column references BEFORE quoting them for SQL
- Ensures lookup in `quoted_columns_by_name` succeeds

```python
# Sanitize column references for DHIS2 datasets before quoting
sanitized_selected = self._sanitize_column_reference(selected)
_sql = quote(sanitized_selected)
```

### 4. Enhanced Error Messages
**File**: `superset/utils/pandas_postprocessing/utils.py` (lines 264-275)

**Improved error includes**:
- Column that was requested
- All available columns in DataFrame
- DataFrame shape and data types
- DataFrame head (first few rows)

**Example error**:
```
Column referenced by aggregate is undefined: 105_EP01a_Suspected_fever
Available columns: SUM(105_EP01a_Suspected_fever), AVG(105_EP01a_Suspected_fever), Period, OrgUnit
```

## Testing Multi-Metric Charts

### Scenario 1: Multiple Metrics on Same Column
```
Metric 1: SUM(105_EP01b_Malaria_Total)
Metric 2: AVG(105_EP01b_Malaria_Total)
Metric 3: COUNT(105_EP01b_Malaria_Total)

Result: ✅ Each metric appears as separate bar/line/area
```

### Scenario 2: Metrics on Different Columns
```
Metric 1: SUM(105_EP01b_Malaria_Total)
Metric 2: COUNT(105_EP01c_Malaria_Confirmed)
Metric 3: AVG(105_EP01d_Malaria_Cases_Treated)

Result: ✅ All 3 metrics rendered as separate series
```

### Scenario 3: Grouped Multi-Metrics
```
Group by: OrgUnit, Period
Metrics: SUM, AVG, COUNT

Result: ✅ Multiple bars per group (2 OrgUnits × 2 Periods × 3 Metrics = 12 bars)
```

## How to Verify the Fix Works

1. **Create a chart** with DHIS2 data elements
2. **Select multiple metrics** (2-3 different aggregations)
3. **Optional**: Add groupby dimension (OrgUnit, Period, etc.)
4. **Expected result**: Chart displays with all metrics visible

### Debug Logs
If errors still occur, check logs for:
- `[POSTPROCESSING-DEBUG] DataFrame columns:` - shows what the query returned
- `[POSTPROCESSING] Auto-sanitizing unsanitized aggregate column:` - shows sanitization happening
- `[POSTPROCESSING] Found matching column:` - shows which matching method succeeded
- `[POSTPROCESSING] CRITICAL:` - detailed error info if all matching fails

## Files Modified
- `superset/utils/pandas_postprocessing/utils.py` - Postprocessing column matching & sanitization
- `superset/models/helpers.py` - Query building column sanitization

## Backward Compatibility
✅ All changes are backward compatible:
- Only sanitizes if special characters detected
- Tries multiple matching methods before failing
- Non-DHIS2 datasets unaffected
- All error paths still raise proper exceptions
