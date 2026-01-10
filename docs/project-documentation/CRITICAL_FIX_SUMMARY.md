# DHIS2 Column Sanitization - Critical Bug Fix

## 🐛 Root Cause

The `sanitize_dhis2_column_name()` function was **missing dash-to-underscore replacement**.

### Data Flow Problem
```
DHIS2 API: "105-EP01a._Suspected_fever"
    ↓ (sanitization - but MISSING dash handling)
DataFrame: "105_EP01a_Suspected_fever"
    ↓ 
Stored Metric: "105-EP01a._Suspected_fever" (OLD UNSANITIZED NAME)
    ↓
Pandas Aggregation: Looking for "105-EP01a._Suspected_fever"
    ↓
ERROR: Column not found!
```

## ✅ Fixes Applied

### 1. Fixed Sanitization Function
**File**: `superset/db_engine_specs/dhis2_dialect.py` (line 44)

Added missing dash replacement:
```python
name = name.replace('-', '_')  # ← THIS WAS MISSING
```

### 2. Added Postprocessing Safety Layer
**File**: `superset/utils/pandas_postprocessing/utils.py` (lines 152-171)

When aggregates can't find columns in DataFrame, attempt DHIS2 sanitization to match:
- Stored metric columns (unsanitized)
- DataFrame columns (sanitized)

## 🔄 Complete Sanitization Pipeline (Now Fixed)

1. **Metadata Discovery** → Sanitizes column names ✅
2. **Data Normalization** → Uses sanitized names ✅
3. **SQL Generation** → Uses sanitized names ✅
4. **Pandas Postprocessing** → NEW: Sanitizes aggregate references ✅
5. **Frontend Display** → Uses sanitized names ✅

## 🚀 What to Do

```bash
# Step 1: Stop current server (kill Superset processes on port 8088)

# Step 2: Clear Python cache
cd /Users/edwinarinda/Projects/Redux/superset
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
find . -name "*.pyc" -delete 2>/dev/null

# Step 3: Restart backend
python -m superset.cli.cli run -p 8088 --with-threads

# Step 4: In Superset UI, refresh table metadata
# (Admin → Databases → Select DHIS2 → Refresh Metadata)

# Step 5: Create a new chart or test existing ones
```

## ✅ Expected Results

**Before Fix:**
```
❌ Column referenced by aggregate is undefined: SUM(105-EP01a_Suspected_fever)
❌ N/A values in charts
❌ Samples tab empty
```

**After Fix:**
```
✅ Charts display actual data
✅ Aggregations work correctly
✅ No "undefined" errors
✅ All metric types work
```

## 📋 Files Modified

| File | Change | Line |
|------|--------|------|
| `superset/db_engine_specs/dhis2_dialect.py` | Added dash replacement | 44 |
| `superset/utils/pandas_postprocessing/utils.py` | Added DHIS2 sanitization safety layer | 152-171 |

## ✨ Why This Fixes Everything

The sanitization function now converts **all** special characters consistently:
- Dots → `_`
- Spaces → `_`
- Parentheses → removed
- **Dashes → `_`** ✅ NEW
- Multiple underscores → collapsed to single `_`
- Leading/trailing underscores → stripped

This ensures:
- Metadata column names match DataFrame column names
- Aggregate functions find the right columns
- Old metrics still work (safety layer)
- New metrics use sanitized names from the start
