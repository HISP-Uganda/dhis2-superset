# Debugging Multi-Metric Chart Failures

## Problem: Charts Fail at Second Metric

When selecting multiple metrics, the chart fails processing at the second (or subsequent) metrics. Only the first metric is processed successfully.

## Root Causes Fixed

### 1. **Case Sensitivity in Aggregate Functions** 
**Issue**: Frontend might send lowercase `sum(col)` instead of `SUM(col)`

**Location**: `superset/utils/pandas_postprocessing/utils.py` (lines 162-165, 207)

**Fix**: All regex patterns now use `re.IGNORECASE` flag
```python
# Before: Only matched SUM, AVG, COUNT (uppercase)
agg_wrapper_match = re.match(r'^(SUM|AVG|COUNT|...)\((.+)\)$', column)

# After: Matches any case (SUM, sum, Sum, etc.)
agg_wrapper_match = re.match(r'^(SUM|AVG|COUNT|...)\((.+)\)$', column, re.IGNORECASE)

# And normalize the captured function name to uppercase
agg_func = agg_wrapper_match.group(1).upper()  # sum → SUM
```

### 2. **Missing Exception Handling in Metric Processing**
**Issue**: Exceptions during second metric processing weren't being caught or logged properly

**Location**: `superset/models/helpers.py` (lines 1331-1397)

**Fix**: Added comprehensive try-catch with detailed logging
```python
try:
    # Process metric
    ...
except Exception as e:
    logger.error(f"[ADHOC-METRIC] EXCEPTION processing metric: {str(e)}", exc_info=True)
    raise
```

### 3. **Aggregate Function Lookup Validation**
**Issue**: If aggregate name (SUM/AVG/COUNT) doesn't exist in `sqla_aggregations`, it would fail with KeyError

**Location**: `superset/models/helpers.py` (lines 1353-1361)

**Fix**: Added validation before lookup
```python
aggregate = metric.get("aggregate", "").upper()
if aggregate not in self.sqla_aggregations:
    logger.error(f"[ADHOC-METRIC] ERROR: Unknown aggregate '{aggregate}'")
    logger.error(f"[ADHOC-METRIC] Available: {list(self.sqla_aggregations.keys())}")
    raise QueryObjectValidationError(...)
```

## How to Debug When It Fails

### Check Server Logs for These Sections:

#### 1. **Metrics Processing** (`[METRICS-TRACE]`)
```
[METRICS-TRACE] Processing 3 metrics
[METRICS-TRACE] Metric 0: adhoc - SUM
[METRICS-TRACE]   ✓ Added: SUM(105_EP01b_Malaria_Total)
[METRICS-TRACE] Metric 1: adhoc - AVG
[METRICS-TRACE]   ✓ Added: AVG(...)
```

**What to look for**:
- ✓ All metrics should be processed and added
- ❌ If missing or exception appears, metrics aren't being processed

#### 2. **Individual Metric Details** (`[ADHOC-METRIC]`)
```
[ADHOC-METRIC] Processing metric: label=SUM(105_EP01b_Malaria_Total), type=SIMPLE
[ADHOC-METRIC]   column_name=105_EP01b_Malaria_Total
[ADHOC-METRIC]   sanitized=105_EP01b_Malaria_Total
[ADHOC-METRIC]   sqla_column created: 105_EP01b_Malaria_Total
[ADHOC-METRIC]   aggregate=SUM
[ADHOC-METRIC]   sqla_metric created: SUM(105_EP01b_Malaria_Total)
[ADHOC-METRIC]   ✓ SUCCESS: SUM(105_EP01b_Malaria_Total)
```

**What to look for**:
- ✓ Each metric should show SUCCESS
- ❌ If ERROR or EXCEPTION appears, check the specific line:
  - Unknown aggregate? Check available aggregations
  - Sanitization issue? Check column_name field
  - Exception? Look at exc_info details

#### 3. **Deduplication** (`[METRICS-TRACE] Before/After dedup`)
```
[METRICS-TRACE] Before dedup: 2 select_exprs + 3 metrics_exprs
[METRICS-TRACE] After dedup: 5 total select_exprs
```

**What to look for**:
- ✓ After dedup count should be higher than before (metrics survived)
- ❌ If After dedup = 1 metric, they were deduplicated (old bug)

#### 4. **Postprocessing Column Matching** (`[POSTPROCESSING]`)
```
[POSTPROCESSING] Auto-sanitizing wrapped aggregate: 'SUM(105-EP01a. Suspected fever)' -> 'SUM(105_EP01a_Suspected_fever)'
[POSTPROCESSING-DEBUG] DataFrame columns: ['Period', 'OrgUnit', 'SUM(105_EP01b_Malaria_Total)', 'AVG(...)', 'COUNT(...)']
[POSTPROCESSING] Found matching column with fuzzy matching: 'SUM(105_EP01a_Suspected_fever)'
```

**What to look for**:
- ✓ Auto-sanitization happening for unsanitized columns
- ✓ Column matching succeeded
- ❌ If CRITICAL error, look at Available columns

## Expected Log Pattern (Success)

```
[METRICS-TRACE] Processing 3 metrics
[METRICS-TRACE] Metric 0: adhoc - SUM
[ADHOC-METRIC] Processing metric: label=SUM(...), type=SIMPLE
[ADHOC-METRIC]   column_name=...
[ADHOC-METRIC]   ✓ SUCCESS: ...
[METRICS-TRACE]   ✓ Added: SUM(...)

[METRICS-TRACE] Metric 1: adhoc - AVG
[ADHOC-METRIC] Processing metric: label=AVG(...), type=SIMPLE
[ADHOC-METRIC]   column_name=...
[ADHOC-METRIC]   ✓ SUCCESS: ...
[METRICS-TRACE]   ✓ Added: AVG(...)

[METRICS-TRACE] Metric 2: adhoc - COUNT
[ADHOC-METRIC] Processing metric: label=COUNT(...), type=SIMPLE
[ADHOC-METRIC]   column_name=...
[ADHOC-METRIC]   ✓ SUCCESS: ...
[METRICS-TRACE]   ✓ Added: COUNT(...)

[METRICS-TRACE] Total metrics added: 3
[METRICS-TRACE] Before dedup: 2 select_exprs + 3 metrics_exprs
[METRICS-TRACE] After dedup: 5 total select_exprs
```

## Typical Failure Points & Solutions

### Failure 1: Second Metric Raises Exception
```
[METRICS-TRACE] Metric 0: adhoc - SUM
[METRICS-TRACE]   ✓ Added: SUM(...)
[METRICS-TRACE] Metric 1: adhoc - AVG
[METRICS-TRACE] Metric 1 EXCEPTION: ...
```

**Solutions**:
1. Check if aggregate name is in wrong case (lowercase)
2. Check if column_name is missing/empty
3. Check if sanitization is failing
4. Check exc_info for full traceback

### Failure 2: Postprocessing Column Not Found
```
[POSTPROCESSING-DEBUG] DataFrame columns: ['Period', 'SUM(105_EP01b...)']
[POSTPROCESSING-DEBUG] Aggregates: {'AVG(...': {'column': '105_EP01c...', 'operator': 'avg'}}
[POSTPROCESSING] CRITICAL: Could not find column '105_EP01c...'
```

**Solutions**:
1. Check if column name has special characters needing sanitization
2. Check if DataFrame has aggregated columns (SUM(...)) but query wants raw columns
3. Check if case mismatch (105_EP01c vs 105_ep01c)
4. Run fuzzy matching manually

### Failure 3: Metrics Deduplicated to 1
```
[METRICS-TRACE] After dedup: 1 total select_exprs
```

**Solutions**:
1. Dedup key is still using `.name` instead of `(str(x), x.name)`
2. Check lines 2219-2228 in helpers.py
3. Verify remove_duplicates function signature

## Testing the Fix

Run these tests to verify:

```bash
# Test deduplication logic
python test_metrics_dedup.py

# Test metric independence
python test_metrics_independent.py

# Test multi-metric rendering
python test_multi_metric_rendering.py
```

All should pass ✅.

## Code Changes Summary

| File | Changes | Purpose |
|------|---------|---------|
| `superset/models/helpers.py` | Lines 1331-1397 | Add exception handling & logging in `adhoc_metric_to_sqla()` |
| `superset/models/helpers.py` | Lines 1970-1998 | Add metrics tracing in loop |
| `superset/models/helpers.py` | Lines 2219-2228 | Fix dedup key to preserve metrics |
| `superset/utils/pandas_postprocessing/utils.py` | Lines 152-187 | Auto-sanitize aggregates with wrappers |
| `superset/utils/pandas_postprocessing/utils.py` | Lines 162-166 | Normalize case + preserve wrapper |
| `superset/utils/pandas_postprocessing/utils.py` | Lines 207, 222, 274 | Case-insensitive regex matching |

## Contact & Questions

If charts still fail:
1. Check server logs for `[METRICS-TRACE]`, `[ADHOC-METRIC]`, `[POSTPROCESSING]`
2. Copy the relevant log section
3. Identify which step failed
4. Apply appropriate fix from "Typical Failure Points" section
