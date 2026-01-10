# DHIS2 Multiple Metrics Error Fix

## Problem
When users attempted to select **more than 1 metric** in DHIS2 charts, the query would fail with:
```
Data error
Error: Column referenced by aggregate is undefined: 105_EP01b_Malaria_Total
```

This error prevented users from creating multi-metric visualizations.

## Root Causes

### Issue 1: Metrics Loss During Query Building (Line 2131)
In `superset/models/helpers.py`, when columns were selected but `need_groupby` was False, the `metrics_exprs` list was unconditionally cleared:

```python
elif columns:
    for selected in columns:
        # ... process columns ...
    metrics_exprs = []  # BUG: Clears metrics even when they exist!
```

**Result**: When users selected both columns AND metrics without an explicit groupby, the metrics were discarded before being added to the SELECT clause.

### Issue 2: Metric Label Mismatch for DHIS2
In `adhoc_metric_to_sqla()` method, metric labels were generated using **unsanitized** column names from chart formData:

```python
# Label uses original name: "SUM(105-EP01c. Malaria Confirmed)"
label = utils.get_metric_name(metric)  # Uses original unsanitized name

# But SQL uses sanitized name: "SUM(105_EP01c_Malaria_Confirmed)"
sanitized_column_name = self._sanitize_column_reference(column_name)
sqla_metric = self.sqla_aggregations[metric["aggregate"]](sa.column(sanitized_column_name))
```

**Result**: The metric label in the result DataFrame didn't match the actual column names in the SQL query. During postprocessing, queries for the original column name would fail because only the sanitized version existed.

## Solutions Implemented

### Fix 1: Preserve Metrics When Processing Columns (Line 2131)
Changed from:
```python
elif columns:
    for selected in columns:
        # ... process columns ...
    metrics_exprs = []  # Unconditionally clears
```

To:
```python
elif columns:
    for selected in columns:
        # ... process columns ...
    if not metrics:
        metrics_exprs = []  # Only clear if no metrics exist
```

**Effect**: Metrics are now preserved and added to the SELECT clause even when there are columns but no explicit groupby.

### Fix 2: Sanitize Metric Labels for DHIS2 (Lines 1342-1345)
Added logic to regenerate metric labels with sanitized column names:

```python
# For DHIS2 datasets, update label to use sanitized column name to match actual SQL columns
if sanitized_column_name != column_name and metric.get("label") is None:
    aggregate = metric.get("aggregate")
    if aggregate:
        label = f"{aggregate}({sanitized_column_name})"
```

**Effect**: Metric labels now match the actual sanitized column names in the SQL query result, ensuring postprocessing can find the columns correctly.

## Examples

### Example 1: Multiple Metrics on Same Column
**User selects:**
- Metric 1: SUM(105-EP01b. Malaria Total)
- Metric 2: COUNT(105-EP01b. Malaria Total)

**Before Fix:**
- SQL query built: ✅
- Metrics in query: ❌ (cleared on line 2131)
- Result: Error "Column referenced by aggregate is undefined"

**After Fix:**
- SQL query built: ✅
- Metrics in query: ✅ (preserved)
- Metric labels: ✅ (sanitized to SUM(105_EP01b_Malaria_Total), COUNT(105_EP01b_Malaria_Total))
- Result: Success! Both metrics displayed

### Example 2: Multiple Metrics on Different Columns
**User selects:**
- Metric 1: SUM(105-EP01b. Malaria Total)
- Metric 2: AVG(Cases - Confirmed & Probable)

**Result DataFrame columns (Before Fix):**
- ❌ No metric columns (cleared before being added)

**Result DataFrame columns (After Fix):**
- ✅ SUM(105_EP01b_Malaria_Total)
- ✅ AVG(Cases_Confirmed_Probable)

## Files Modified
1. **superset/models/helpers.py**
   - Line 2131: Fixed metrics_exprs clearing logic
   - Lines 1342-1345: Added metric label sanitization for DHIS2

## Testing
Created `test_multiple_metrics.py` to verify:
- ✅ Metric labels are sanitized correctly for DHIS2
- ✅ Multiple metrics result in proper result set columns
- ✅ All tests passing

## Impact
- Users can now select **unlimited metrics** in DHIS2 charts
- Metrics with special characters in column names work correctly
- Multi-metric visualizations (comparing different aggregations or columns) now work reliably
