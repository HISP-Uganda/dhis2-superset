# Comprehensive Guide: Column Handling Across All Chart Types in DHIS2/Superset

## Executive Summary

This guide documents the complete column handling pipeline for DHIS2 datasets with special characters in column names across all Superset chart types.

**Key Finding**: Column names are preserved through sanitization and SQL query building, but may be distorted or reverted to indices during chart-specific client processing, especially in:
- Pivot tables (MultiIndex flattening)
- Complex groupby scenarios
- Incomplete verbose_map coverage

---

## Complete Column Flow Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: DATA SOURCE                                                                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│  Original DHIS2 Column Names (Unsanitized):                                             │
│  ✗ "105-EP01b. Malaria Total"                                                          │
│  ✗ "105-EP01a. Suspected fever"                                                        │
│  ✗ "105-EP01d. Malaria cases treated"                                                  │
│  ✓ "Period"                                                                             │
│  ✓ "OrgUnit"                                                                            │
│                                                                                           │
│  Database stores with sanitized names (migration or on-the-fly)                        │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: QUERY BUILDING (superset/models/helpers.py)                                   │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│  Location: get_sqla_query() → adhoc_metric_to_sqla()                                   │
│  Line: 1344 - _sanitize_column_reference()                                             │
│                                                                                           │
│  Process:                                                                                │
│  1. Frontend sends: column_name = "105-EP01b. Malaria Total"                           │
│  2. Sanitize: "105-EP01b. Malaria Total" → "105_EP01b_Malaria_Total"                  │
│  3. Build SQL with sanitized names                                                      │
│                                                                                           │
│  SQL Generated:                                                                         │
│  SELECT Period, OrgUnit,                                                               │
│         SUM(105_EP01b_Malaria_Total) AS "SUM(105_EP01b_Malaria_Total)",              │
│         AVG(105_EP01b_Malaria_Total) AS "AVG(105_EP01b_Malaria_Total)"               │
│  FROM dhis2_analytics                                                                  │
│  GROUP BY Period, OrgUnit                                                              │
│                                                                                           │
│  ✓ Column names preserved with underscores                                             │
│  ✓ All metrics generated with proper labels                                            │
│  ✓ Deduplication preserves all metrics: (str(x), x.name)                              │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 3: DATABASE EXECUTION & DATAFRAME CREATION                                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│  Database executes query and returns DataFrame:                                        │
│  ┌────────────┬──────────┬──────────────────────┬──────────────────────┐               │
│  │ Period     │ OrgUnit  │ SUM(105_EP01...)     │ AVG(105_EP01...)     │               │
│  ├────────────┼──────────┼──────────────────────┼──────────────────────┤               │
│  │ 2024-Q1    │ District1│        1500          │       25.5           │               │
│  │ 2024-Q1    │ District2│        2100          │       35.0           │               │
│  └────────────┴──────────┴──────────────────────┴──────────────────────┘               │
│                                                                                           │
│  ✓ DataFrame columns are already sanitized                                             │
│  ✓ All metrics calculated at database level                                            │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 4: POSTPROCESSING (superset/utils/pandas_postprocessing/)                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│  Column Matching & Resolution (6-step strategy):                                       │
│  1. Direct match: "SUM(105_EP01b_Malaria_Total)" in df.columns?                       │
│  2. Unwrap aggregate: Extract inner, match "105_EP01b_Malaria_Total"                  │
│  3. Reverse wrap: Find wrapped version of requested column                             │
│  4. DHIS2 sanitization: Apply sanitization pattern                                     │
│  5. Case-insensitive: Try lowercase variants                                           │
│  6. Fuzzy normalize: Normalize and match                                               │
│                                                                                           │
│  ✓ Columns are correctly matched despite aggregate wrappers                            │
│  ✓ Metrics applied independently to specified columns                                  │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 5: CLIENT PROCESSING (superset/charts/client_processing.py) ⚠️ CRITICAL          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│  Chart-Type-Specific Processing:                                                       │
│                                                                                           │
│  A. TABLE CHART (Line 282-303)                                                         │
│  ├─ Process: Apply column_config formatting                                            │
│  ├─ Issue: No MultiIndex, columns preserved ✓                                          │
│  └─ Risk: Silent failure if column not in df                                           │
│                                                                                           │
│  B. PIVOT TABLE V2 (Line 258-279)                                                      │
│  ├─ Process:                                                                            │
│  │  1. Rename columns via verbose_map (Line 356)                                       │
│  │  2. Call pivot_df() function                                                        │
│  │  3. Pivot creates MultiIndex columns                                                │
│  │  4. CRITICAL: Lines 150-154 - Convert to MultiIndex tuples                         │
│  │  5. Processing with MultiIndex...                                                   │
│  │  6. CRITICAL: Lines 371-378 - Flatten back to strings                              │
│  │                                                                                       │
│  ├─ Issue: MultiIndex flattening joins with space only                                │
│  │  "105_EP01b_Malaria_Total District1" (ambiguous!)                                  │
│  │                                                                                       │
│  ├─ Risk: Column identity lost in complex scenarios                                    │
│  └─ Solution: Use ' - ' separator instead of space                                     │
│                                                                                           │
│  C. OTHER CHARTS (BAR, LINE, SCATTER, PIE) (Not in post_processors)                   │
│  ├─ Process: No special processing, columns passed directly                            │
│  ├─ Issue: None ✓                                                                      │
│  └─ Status: Working correctly                                                          │
│                                                                                           │
│  VERBOSE MAP ISSUE (Line 356):                                                         │
│  ┌─────────────────────────────────────────────────────────┐                           │
│  │ if datasource:                                          │                           │
│  │     df.rename(columns=datasource.data["verbose_map"],   │                           │
│  │               inplace=True)                              │                           │
│  ├─────────────────────────────────────────────────────────┤                           │
│  │ Problem: What if verbose_map doesn't have all columns?  │                           │
│  │                                                          │                           │
│  │ Result:                                                 │                           │
│  │ "Period" → "Quarter" (mapped)                           │                           │
│  │ "105_EP01b_Malaria_Total" → "Malaria Cases" (mapped)   │                           │
│  │ "OrgUnit" → "OrgUnit" (NOT mapped, stays as-is)        │                           │
│  │                                                          │                           │
│  │ Inconsistency: Mixed human labels and sanitized names   │                           │
│  └─────────────────────────────────────────────────────────┘                           │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 6: DATA SERIALIZATION (Line 389, 392)                                             │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│  if query["result_format"] == ChartDataResultFormat.JSON:                              │
│      query["data"] = processed_df.to_dict()                                            │
│  elif query["result_format"] == ChartDataResultFormat.CSV:                             │
│      processed_df.to_csv(buf, index=show_default_index)                               │
│                                                                                           │
│  At this point:                                                                        │
│  ✓ Column names are finalized                                                          │
│  ✓ Data is serialized to JSON/CSV with column names                                    │
│  ⚠️ If column names were lost earlier, they're still lost                             │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 7: CHART RENDERING (Frontend JavaScript)                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│  Chart visualization receives column names from JSON/CSV                               │
│                                                                                           │
│  If columns are ["Period", "OrgUnit", ...]: ✓ Good rendering                          │
│  If columns are ["0", "1", "2", ...]: ✗ Numeric indices shown                         │
│  If columns are ["Period", "Malaria Cases", "OrgUnit"]: ✓ Mix of labels              │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Critical Problem Areas Identified

### Problem 1: Pivot Table MultiIndex Flattening

**Location**: Lines 150-154 and 371-378

**Current Code**:
```python
# Lines 150-154
if not isinstance(df.columns, pd.MultiIndex):
    df.columns = pd.MultiIndex.from_tuples([(str(i),) for i in df.columns])
if not isinstance(df.columns, pd.MultiIndex):
    df.columns = pd.MultiIndex.from_tuples([(str(i),) for i in df.columns])

# Lines 371-378
processed_df.columns = [
    (
        " ".join(str(name) for name in column).strip()  # ← JUST SPACE, AMBIGUOUS!
        if isinstance(column, tuple)
        else column
    )
    for column in processed_df.columns
]
```

**Issue**: When flattening `('105_EP01b_Malaria_Total', 'District1')` with just space:
- Result: `'105_EP01b_Malaria_Total District1'`
- Problem: Can't distinguish between:
  - Column name part: `105_EP01b_Malaria_Total`
  - Dimension part: `District1`

**Example of Ambiguity**:
```
If metrics include a metric named "Malaria" and dimensions include "District1 Malaria":
  ('Malaria', 'District1 Malaria') → 'Malaria District1 Malaria'
  ↓
  Can't tell where metric ends and dimension begins!
```

### Problem 2: Column Index Access Pattern

**Location**: Line 133

```python
indexes = [i for col, i in grouped_columns]
df = df[df.columns[indexes]]  # ← Indirect column access
```

**Issue**: While this works for simple cases, it can fail when:
1. DataFrame has MultiIndex columns
2. Column order matters but names are duplicated
3. Complex reordering is involved

**Safe Pattern**:
```python
selected_columns = [df.columns[i] for i in indexes]
df = df[selected_columns]  # ← Direct name-based selection
```

### Problem 3: Incomplete Verbose Map Coverage

**Location**: Line 356

```python
if datasource:
    df.rename(columns=datasource.data["verbose_map"], inplace=True)
```

**Issue**: What happens to unmapped columns?
- They keep their sanitized names: `'105_EP01b_Malaria_Total'`
- Mapped columns get labels: `'Malaria Cases (Total)'`
- Result: Inconsistent column names (mix of sanitized and labels)

**Example**:
```
Original: ['Period', 'OrgUnit', '105_EP01b_Malaria_Total', '105_EP01a_Suspected_fever']
Verbose map: {
    'Period': 'Quarter',
    '105_EP01b_Malaria_Total': 'Malaria Cases',
    # OrgUnit not in map!
    # 105_EP01a_Suspected_fever not in map!
}
Result: ['Quarter', 'OrgUnit', 'Malaria Cases', '105_EP01a_Suspected_fever']
         ↑ Inconsistent! Some human labels, some sanitized names
```

### Problem 4: Silent Failure in Column Formatting

**Location**: Lines 296-301

```python
for column, config in column_config.items():
    if "d3NumberFormat" in config:
        format_ = "{:" + config['d3NumberFormat'] + "}"
        try:
            df[column] = df[column].apply(format_.format)
        except Exception:  # ← SILENT FAILURE!
            pass
```

**Issue**: If column doesn't exist in df, exception is silently caught and ignored.

**Example**:
```python
# column_config specifies formatting for '105_EP01b_Malaria_Total'
# But df has column: 'Malaria Cases (Total)' (from verbose_map)
# → Exception is silently ignored
# → Column is never formatted
# → User doesn't know why formatting didn't apply
```

---

## Solutions by Priority

### Priority 1: Fix MultiIndex Flattening (HIGH)

**Change**:
```python
# From:
" ".join(str(name) for name in column).strip()

# To:
' - '.join(str(c) for c in column if c)  # Filter out None/empty
```

**Why**:
- Clear visual separation between metric and dimension
- Example: `'105_EP01b_Malaria_Total - District1'`
- Unambiguous: Can split on ` - ` to recover original parts

### Priority 2: Safe Column Index Access (MEDIUM)

**Change**:
```python
# From:
df = df[df.columns[indexes]]

# To:
selected_columns = [df.columns[i] for i in indexes]
df = df[selected_columns]
```

**Why**:
- Explicit name-based selection
- Works correctly with MultiIndex
- More maintainable and clear

### Priority 3: Comprehensive Verbose Map Coverage (HIGH)

**Change**:
```python
# From:
if datasource:
    df.rename(columns=datasource.data["verbose_map"], inplace=True)

# To:
if datasource:
    verbose_map = datasource.data.get("verbose_map", {})
    # Ensure all columns have mappings
    for col in df.columns:
        if col not in verbose_map:
            verbose_map[col] = col  # Keep original if not mapped
    df.rename(columns=verbose_map, inplace=True)
```

**Why**:
- All columns get consistent treatment
- Either all human labels OR all original names
- No mixed naming schemes

### Priority 4: Explicit Error Handling (MEDIUM)

**Change**:
```python
# From:
try:
    df[column] = df[column].apply(format_.format)
except Exception:
    pass  # Silent

# To:
try:
    if column in df.columns:
        df[column] = df[column].apply(format_.format)
    else:
        logger.warning(f"Column config references missing column: {column}")
except Exception as e:
    logger.warning(f"Could not format column {column}: {e}")
```

**Why**:
- Explicit check before formatting
- Logging helps debug column mapping issues
- No silent failures

---

## Testing Coverage

### Test Results: 66.7% Pass Rate (4/6 tests)

| Test | Status | Issue |
|------|--------|-------|
| Table Chart Preservation | ✓ PASS | Columns preserved correctly |
| Pivot Table Preservation | ✗ FAIL | MultiIndex flattening ambiguous |
| Column Selection Order | ✓ PASS | Order maintained |
| MultiIndex Flattening | ✓ PASS | Currently works but ambiguous |
| Column Index Access | ✓ PASS | All methods work but unsafe pattern exists |
| Verbose Map Application | ✗ FAIL | Incomplete coverage causes inconsistency |

### Recommended Test Suite

```python
# Test 1: All columns preserved (no indices)
assert not any(isinstance(col, int) for col in df.columns)

# Test 2: Pivot columns have clear metric-dimension separator
assert all(' - ' in str(col) or col in groupby_dims 
           for col in df.columns)

# Test 3: No silent formatting failures
assert all(col in df.columns for col in form_data.get("column_config", {}))

# Test 4: Verbose map covers all columns
assert all(col in verbose_map or col in df.columns 
           for col in expected_columns)

# Test 5: All chart types work (not just pivot tables)
for chart_type in ['table', 'bar', 'line', 'pivot_table_v2']:
    result = process_chart(df, chart_type)
    assert not any(isinstance(col, int) for col in result.columns)
```

---

## Impact Assessment

### Affected Code Sections

| File | Lines | Function | Impact | Fix Effort |
|------|-------|----------|--------|-----------|
| `client_processing.py` | 150-154 | `pivot_df()` | MultiIndex handling | Low |
| `client_processing.py` | 133 | `pivot_df()` | Column selection | Low |
| `client_processing.py` | 356 | `apply_client_processing()` | Verbose map | Low |
| `client_processing.py` | 296-301 | `table()` | Error handling | Low |
| `client_processing.py` | 371-378 | `apply_client_processing()` | Flattening | Low |

### Files Not Affected

- `helpers.py` - Query building is solid ✓
- `dhis2_dialect.py` - Sanitization works correctly ✓
- `pandas_postprocessing/utils.py` - Column matching is robust ✓
- Frontend/JavaScript - No changes needed ✓

---

## Deployment Plan

### Phase 1: Testing (Current)
- [x] Identify all column preservation issues
- [x] Create comprehensive test suite
- [x] Document all problems and solutions
- [ ] Add tests to actual test suite
- [ ] Run tests against all chart types

### Phase 2: Implementation
- [ ] Update MultiIndex flattening separator
- [ ] Fix column index access pattern
- [ ] Add comprehensive verbose_map coverage
- [ ] Add explicit error handling
- [ ] Add logging for debugging

### Phase 3: Validation
- [ ] Run test suite
- [ ] Test with DHIS2 data (special characters)
- [ ] Verify all chart types render correctly
- [ ] Check performance impact

### Phase 4: Release
- [ ] Update documentation
- [ ] Create migration guide
- [ ] Deploy to staging
- [ ] Deploy to production

---

## Success Metrics

✓ **All columns display names, never numeric indices**
✓ **Pivot tables show clear "Metric - Dimension" naming**
✓ **All chart types handle columns consistently**
✓ **No silent failures in column formatting**
✓ **Verbose map coverage is complete**
✓ **Column order preserved through entire pipeline**
✓ **DHIS2 special characters handled correctly**
✓ **Multi-metric charts display all metrics**
✓ **Grouped charts show proper dimension grouping**
✓ **Test coverage includes all chart types**

---

## Quick Reference: Column Flow Summary

```
STAGE 1: Unsanitized   "105-EP01b. Malaria Total"
                ↓
STAGE 2: Sanitized     "105_EP01b_Malaria_Total" (in SQL)
                ↓
STAGE 3: DataFrame     Column in result set
                ↓
STAGE 4: Postprocess   Match & resolve aggregates
                ↓
STAGE 5: Client Process [RISK: MultiIndex flattening]
                ↓
STAGE 6: Serialization to_dict() / to_csv()
                ↓
STAGE 7: Chart Render  Column name displayed (or index if lost)
```

---

## Related Documentation

- **SQL_QUERY_BUILDING_FLOW.md** - Query building process
- **QUERY_BUILDING_VISUAL_FLOW.txt** - Visual step-by-step flow
- **COLUMN_PRESERVATION_ACROSS_CHART_TYPES.md** - Solutions and strategies
- **DEBUG_MULTI_METRIC_FAILURES.md** - Debugging multi-metric issues
- **test_column_preservation_all_charts.py** - Comprehensive test suite
