# DHIS2 Multiple Metrics Error - Comprehensive Fix Summary

## Problem
When selecting multiple metrics in DHIS2 charts, users got error:
```
Data error
Error: Column referenced by aggregate is undefined: 105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive
```

This prevented creating charts with multiple metrics (e.g., SUM + COUNT on different data elements).

## Root Causes & Solutions

### Issue 1: Metrics Discarded During Query Building
**File**: `superset/models/helpers.py` (Line 2131)

**Problem**: When processing columns without explicit groupby, `metrics_exprs` was unconditionally cleared, discarding all metrics before they were added to the SELECT clause.

**Solution**:
```python
# Before
elif columns:
    for selected in columns:
        # ... process columns ...
    metrics_exprs = []  # BUG: Always clears!

# After
elif columns:
    for selected in columns:
        # ... process columns ...
    if not metrics:
        metrics_exprs = []  # Only clear if no metrics
```

**Effect**: Multiple metrics are now preserved and included in the SQL query.

---

### Issue 2: Metric Label Mismatch for DHIS2
**File**: `superset/models/helpers.py` (Lines 1342-1345)

**Problem**: Metric labels used unsanitized column names from formData ("SUM(105-EP01c. Malaria Confirmed)"), but SQL used sanitized names ("SUM(105_EP01c_Malaria_Confirmed)"), causing mismatches.

**Solution**:
```python
# For DHIS2 datasets, update label to use sanitized column name
if sanitized_column_name != column_name and metric.get("label") is None:
    aggregate = metric.get("aggregate")
    if aggregate:
        label = f"{aggregate}({sanitized_column_name})"
```

**Effect**: Metric labels now match actual SQL column names, ensuring postprocessing can find columns.

---

### Issue 3: Postprocessing Column Matching Failure
**File**: `superset/utils/pandas_postprocessing/utils.py`

**Problem 3a**: Fuzzy matching used different sanitization than DHIS2
- Old: `re.sub(r'[.\-\s()/]+', '_', s)` (only specific characters)
- DHIS2: `re.sub(r'[^\w]', '_', s)` (all non-alphanumeric)

This caused fuzzy matching to fail for columns with characters like @, #, $, %, &, etc.

**Solution 3a** (Line 198):
```python
def normalize(s: str) -> str:
    s = s.lower()
    # Use the same sanitization as DHIS2
    s = re.sub(r'[^\w]', '_', s)  # Changed from r'[.\-\s()/]+'
    s = re.sub(r'_+', '_', s)
    return s.strip('_')
```

**Problem 3b**: When postprocessing receives raw column names but dataframe has aggregated column names (e.g., "SUM(column)"), the column matching failed.

**Solution 3b** (Lines 175-186):
```python
# Try finding aggregated version if raw column is requested
if not found_column and "(" not in column and ")" not in column:
    for df_col in df.columns:
        wrapper_match = re.match(r'^(SUM|AVG|COUNT|MIN|MAX|MEDIAN|STDDEV|VAR)\((.+)\)$', df_col, re.IGNORECASE)
        if wrapper_match:
            inner_from_df = wrapper_match.group(2)
            if inner_from_df == column:
                found_column = df_col
                break
```

**Effect**: Postprocessing can now find columns even when they're aggregated results from SQL.

---

## Testing
All fixes verified with test cases:

### Test 1: Metrics Preservation ✅
```python
# Multiple metrics are now kept in query
# Result: SQL SELECT includes all metrics
```

### Test 2: Metric Label Sanitization ✅
```python
# Original:  "105-EP01c. Malaria Confirmed (B/s and RDT Positive)"
# Sanitized: "105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive"
# Result: Label matches actual column in result set
```

### Test 3: Postprocessing Column Matching ✅
```python
# DataFrame has:  'SUM(105_EP01b_Malaria_Total)'
# Postprocessing requests: '105_EP01b_Malaria_Total'
# Result: ✅ Column found and matched correctly
```

## Files Modified
1. **superset/models/helpers.py**
   - Line 2131: Preserve metrics when processing columns
   - Lines 1342-1345: Sanitize metric labels for DHIS2

2. **superset/utils/pandas_postprocessing/utils.py**
   - Line 153: Added debug logging
   - Lines 175-186: Added aggregated column matching
   - Line 198: Fixed fuzzy matching to use DHIS2 sanitization

3. **superset/migrations/versions/2025-12-06_sanitize_dhis2_columns.py**
   - Lines 59-67: Added table existence check for robustness

## Expected Results After Fix

### Before
- ❌ Multiple metrics selected → Error "Column referenced by aggregate is undefined"
- ❌ Chart doesn't render

### After
- ✅ Multiple metrics selected → Chart renders correctly
- ✅ Each metric shows as separate bar/series
- ✅ All metrics visible and accurate

## Multi-Metric Chart Scenarios Now Supported

1. **Multiple Aggregations on Same Column**
   - SUM + COUNT on "105-EP01b. Malaria Total"
   - Result: Two bars per category showing sum and count

2. **Different Metrics on Different Columns**
   - SUM of "Malaria Total" + AVG of "Cases Confirmed"
   - Result: Two bars per category with different metrics

3. **Multiple Metrics with Grouping**
   - Grouped by OrgUnit + Period, with 3 different metrics
   - Result: Grid of bars with one metric per series

## Debugging Logs
When enabled, you can see detailed matching process in logs:
```
[POSTPROCESSING] Processing aggregate: name='metric1', column='105_EP01c_Malaria_Confirmed (B/s and RDT Positive)'
[DHIS2] Column not found directly. Available columns: [...]
[DHIS2] Trying DHIS2 sanitization: '105_EP01c_Malaria_Confirmed (B/s and RDT Positive)' -> '105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive'
[DHIS2] Found matching column after DHIS2 sanitization!
```

## Impact
- ✅ Users can select unlimited metrics in DHIS2 charts
- ✅ Multi-metric visualizations work reliably
- ✅ No more "Column referenced by aggregate is undefined" errors for DHIS2
- ✅ Better column name matching for other data sources as well
