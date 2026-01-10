# Multi-Metric Chart Fix - Complete Solution

## Problem
When selecting **multiple metrics** in DHIS2 charts, only the first metric appeared. Other metrics were silently discarded.

**Example**:
- Selected metrics: SUM(Total), AVG(Total), COUNT(Total)
- DataFrame returned: Only `SUM(105_EP01b_Malaria_Total)` 
- Error: `Column referenced by aggregate is undefined: 105_EP01a_Suspected_fever`

## Root Causes

### 1. **Metrics Deduplicated in SELECT Clause** (CRITICAL)
**Location**: `superset/models/helpers.py:2219-2221`

**Problem**: 
```python
select_exprs = remove_duplicates(
    select_exprs + metrics_exprs, key=lambda x: x.name
)
```

When you have multiple metrics on the same column:
- `SUM(col)` has `.name = "col"`
- `AVG(col)` has `.name = "col"`
- `COUNT(col)` has `.name = "col"`

Using `.name` as dedup key removes all but first → **only 1 metric survives!**

**Solution**: Use full expression string as key
```python
select_exprs = remove_duplicates(
    combined, key=lambda x: (str(x), x.name)  # Unique by both expression AND name
)
```

### 2. **Unsanitized Column References in Aggregates**
**Location**: `superset/utils/pandas_postprocessing/utils.py:152-187`

**Problem**: 
- FormData contains: `"column": "105-EP01a. Suspected fever"` (unsanitized)
- DataFrame has: `SUM(105_EP01a_Suspected_fever)` (sanitized)
- Mismatch → fails to match

**Solution**: Auto-sanitize aggregate columns
```python
# Extract column from wrapper: SUM(105-EP01a. Suspected fever) → 105-EP01a. Suspected fever
agg_wrapper_match = re.match(r'^(SUM|AVG|COUNT|...)\((.+)\)$', column, re.IGNORECASE)
if agg_wrapper_match:
    agg_func = agg_wrapper_match.group(1)
    inner_column = agg_wrapper_match.group(2)
    
    # Sanitize inner column
    if inner_column and any(c in inner_column for c in '- .()/@#$%^&*'):
        sanitized_inner = sanitize_dhis2_column_name(inner_column)
        sanitized_column = f"{agg_func}({sanitized_inner})"
```

### 3. **Column Sanitization During Query Building**
**Location**: `superset/models/helpers.py:2115-2118`

**Solution**: Sanitize column references BEFORE quoting
```python
sanitized_selected = self._sanitize_column_reference(selected)
_sql = quote(sanitized_selected)
```

### 4. **Incomplete Column Matching in Postprocessing**
**Location**: `superset/utils/pandas_postprocessing/utils.py:175-259`

**Solution**: Multiple matching strategies:
1. Direct column match
2. Unwrap aggregates: `SUM(col)` → `col`
3. **Reverse wrap**: Request wants `col`, DataFrame has `SUM(col)`
4. DHIS2 sanitization
5. Case-insensitive
6. Fuzzy normalized (with wrapper detection)

## Files Modified

### 1. `superset/models/helpers.py`

**Change 1** (Lines 1970-1998): Add metrics tracing
- Logs each metric being processed
- Logs exceptions with full stacktrace
- Validates all metrics are added to `metrics_exprs`

**Change 2** (Lines 2115-2118): Sanitize columns during query building
```python
# For non-grouped columns, sanitize before quoting
sanitized_selected = self._sanitize_column_reference(selected)
_sql = quote(sanitized_selected)
```

**Change 3** (Lines 2216-2228): Fix metrics deduplication
```python
# Use full expression + name as dedup key, not just name
# This allows multiple aggregations on same column: SUM, AVG, COUNT
select_exprs = remove_duplicates(
    combined, key=lambda x: (str(x), x.name)
)
```

### 2. `superset/utils/pandas_postprocessing/utils.py`

**Change 1** (Lines 148-187): Auto-sanitize aggregate columns
- Detects if column is wrapped in aggregate function
- Extracts inner column
- Sanitizes inner column if it has special characters
- Reconstructs wrapper with sanitized inner column

**Change 2** (Lines 167-187): Add reverse wrapper matching
```python
# If DataFrame has SUM(col) and we want col, match it
for df_col in df.columns:
    wrapper_match = re.match(r'^(SUM|AVG|...)\((.+)\)$', df_col)
    if wrapper_match:
        inner_from_df = wrapper_match.group(2)
        if inner_from_df == column:
            found_column = df_col  # Match!
```

## Test Scenarios

### ✅ Scenario 1: Multiple Metrics Same Column
```
Selected:
  - SUM(105_EP01b_Malaria_Total)
  - AVG(105_EP01b_Malaria_Total)
  - COUNT(105_EP01b_Malaria_Total)

Expected DataFrame columns:
  ✓ SUM(105_EP01b_Malaria_Total)
  ✓ AVG(105_EP01b_Malaria_Total)
  ✓ COUNT(105_EP01b_Malaria_Total)
  ✓ Period
  ✓ OrgUnit

Chart renders: 3 bars per period (one per metric)
```

### ✅ Scenario 2: Multiple Metrics Different Columns
```
Selected:
  - SUM(105_EP01b_Malaria_Total)
  - COUNT(105_EP01c_Malaria_Confirmed)
  - AVG(105_EP01d_Malaria_Cases_Treated)

Expected DataFrame:
  ✓ SUM(105_EP01b_Malaria_Total)
  ✓ COUNT(105_EP01c_Malaria_Confirmed)
  ✓ AVG(105_EP01d_Malaria_Cases_Treated)
  ✓ Period

Chart renders: 3 separate series/metrics
```

### ✅ Scenario 3: Grouped Multi-Metrics
```
Selected:
  - Metrics: SUM, AVG, COUNT (3 metrics)
  - Group by: OrgUnit, Period
  
Expected bars: 2 OrgUnits × 2 Periods × 3 Metrics = 12 bars total

Chart renders: Multiple bars per group
```

### ✅ Scenario 4: Unsanitized Column Names
```
FormData contains:
  - "105-EP01a. Suspected fever"
  - "105-EP01c. Malaria Confirmed (B/s and RDT Positive)"

Auto-sanitized to:
  - "105_EP01a_Suspected_fever"
  - "105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive"

Matched against DataFrame correctly despite special characters
```

## Debug Logging

Check server logs for these messages:

```
[METRICS-TRACE] Processing 3 metrics
[METRICS-TRACE] Metric 0: adhoc - SUM
[METRICS-TRACE]   ✓ Added: SUM(105_EP01b_Malaria_Total)
[METRICS-TRACE] Metric 1: adhoc - AVG
[METRICS-TRACE]   ✓ Added: AVG(105_EP01b_Malaria_Total)
[METRICS-TRACE] Metric 2: adhoc - COUNT
[METRICS-TRACE]   ✓ Added: COUNT(105_EP01b_Malaria_Total)
[METRICS-TRACE] Total metrics added: 3

[METRICS-TRACE] Before dedup: 2 select_exprs + 3 metrics_exprs
[METRICS-TRACE] After dedup: 5 total select_exprs  ✓ All 3 metrics survived!

[POSTPROCESSING] Auto-sanitizing wrapped aggregate: 'SUM(105-EP01a. Suspected fever)' -> 'SUM(105_EP01a_Suspected_fever)'
[POSTPROCESSING-DEBUG] Found matching column with fuzzy matching: 'SUM(105_EP01a_Suspected_fever)'
```

## Verification Steps

1. **Create DHIS2 chart** with data element (e.g., "Malaria Total")
2. **Add multiple metrics**:
   - Click "Metrics" 
   - Add: SUM(Malaria Total)
   - Add: AVG(Malaria Total)
   - Add: COUNT(Malaria Total)
3. **Optional: Add groupby** (Period, OrgUnit)
4. **View chart** → should see all 3 metrics as separate bars/lines/areas

## Expected Results

✅ Multiple metrics all visible on chart
✅ Each metric renders as separate bar/line/area  
✅ Proper colors/styles for each metric
✅ Legend shows all metric names
✅ Tooltips show individual metric values
✅ Works with special character column names
✅ Works with grouped data

## Backward Compatibility

✅ **All changes are backward compatible**:
- Only sanitizes if special characters detected
- Multiple matching methods before failing
- Non-DHIS2 datasets unaffected
- Dedup key is more specific, not less
- All error paths preserved

## Performance Impact

Minimal:
- Sanitization only on columns with special chars
- Regex matching only when column not found directly
- String comparison instead of name-only dedup (negligible)

## Future Improvements

Consider:
1. Cache sanitized names to avoid re-sanitizing
2. Early dedup in metric collection phase
3. Explicit metric ordering to preserve user selection order
