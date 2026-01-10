# Column Trace Logging Guide - DHIS2 Column Selection Fix

## Overview

This document explains how to use the comprehensive column tracing logs to debug data alignment issues where columns are referenced incorrectly.

**Problem**: When selecting columns (e.g., Variable1, Period, OrgUnit) for a chart, the displayed data may not match the selected columns. Values might shift positions or come from the wrong columns.

**Solution**: Use the detailed logging system to trace how columns and data flow through the pipeline.

---

## Log Trace Points

### 1. Form Data → Query Object (Frontend + Backend)

**What to look for**: How user selections flow from the chart builder to the backend

**Log markers to search for**:
```
[COLUMN_TRACE] FormData Columns - datasource_id=X, datasource_type=Y
  columns: [...]
  groupby: [...]
  x_axis: ...
  metrics: [...]

[COLUMN_TRACE] QueryObject Created - datasource=table_name
  columns: [...]
  metrics: [...]
  is_timeseries: ...
```

**What this tells you**:
- ✓ User selected columns are captured correctly
- ✓ X-axis selection is transmitted to backend
- ✓ Metrics are properly identified

**Example**:
```
[COLUMN_TRACE] FormData Columns - datasource_id=1, datasource_type=table
  columns: ['OrgUnit', 'Period']
  groupby: []
  x_axis: OrgUnit
  metrics: [{'label': 'Total', 'expressionType': 'SIMPLE', 'column': {'columnName': 'Value'}, 'aggregate': 'SUM'}]

[COLUMN_TRACE] QueryObject Created - datasource=analytics
  columns: ['OrgUnit', 'Period']
  metrics: [{'label': 'Total', ...}]
  is_timeseries: False
```

---

### 2. SQL Query Generation

**What to look for**: What columns are requested in the SQL and in what order

**Log markers**:
```
[COLUMN_TRACE] SQL Generated - datasource=table_name
  expected_columns: [col1, col2, col3]
  sql_first_500_chars: SELECT col1, col2, col3 FROM ...
```

**What this tells you**:
- ✓ SQL column order matches user selection
- ✓ All requested columns are in SELECT clause

**Example**:
```
[COLUMN_TRACE] SQL Generated - datasource=analytics
  expected_columns: ['OrgUnit', 'Period', 'Value']
  sql_first_500_chars: SELECT "OrgUnit", "Period", SUM("Value") AS "Value" FROM analytics GROUP BY "OrgUnit", "Period"
```

---

### 3. DHIS2 API Response Processing

**What to look for**: How the DHIS2 API response is being normalized into columns and rows

**Log markers for PIVOT/WIDE format**:
```
[DHIS2] PIVOT CONSTRUCTION:
  data_elements (UIDs): [uid1, uid2, ...]
  data_element_list (sorted UIDs): [uid1, uid2, ...]
  col_names: ['Period', 'OrgUnit', 'DataElement1', 'DataElement2', ...]

[DHIS2] FIRST ROW CONSTRUCTION:
  Period (index 0): 2023Q1
  OrgUnit (index 1): Kampala
  DataElement1 (index 2): 1250
  DataElement2 (index 3): 450
```

**What this tells you**:
- ✓ Columns are built in the correct order
- ✓ Row values are aligned with column positions
- ⚠️ If row values are shifted, this is where to spot it

**When data elements are added** (the issue scenario):
- Check that `data_element_list` is sorted correctly
- Verify that row values are being fetched in the same order
- Look for any sorting that might change between column construction and row building

---

### 4. Cursor Description and Row Processing

**What to look for**: How the DHIS2 cursor is handling column names and rows

**Log markers**:
```
[DHIS2] fetchall() - Row count: X
[DHIS2] fetchall() column_names: [col1, col2, col3, ...]
[DHIS2] fetchall() column_names length: 3
[DHIS2] First row values count: 3
[DHIS2] First row values: (val1, val2, val3)

[DHIS2] Row 0 col 0 (Period): 2023Q1 -> '2023Q1' (STRING)
[DHIS2] Row 0 col 1 (OrgUnit): Kampala -> 'Kampala' (STRING)
[DHIS2] Row 0 col 2 (Value): 1250 -> 1250.0 (FLOAT)

[DHIS2] fetchall() returning X rows with Y columns each
```

**CRITICAL**: Check that column count matches row count!
```
column_names length: 3  ← Should match
First row values count: 3 ← Should match
```

**What this tells you**:
- ✓ Each row has the correct number of values
- ✓ Column names and row values are aligned during zip()
- ⚠️ If counts don't match, data will be misaligned!

---

### 5. DataFrame Column Assignment

**What to look for**: How pandas DataFrame columns are being assigned after the query

**Log markers**:
```
[COLUMN_TRACE] BEFORE assign_column_label:
  shape: (10, 3)
  columns: ['Period', 'OrgUnit', 'Value']
  expected: ['OrgUnit', 'Period', 'Value']

[COLUMN_TRACE] Column truncation needed: df has 4 columns, expected 3
  DataFrame actual columns: ['Period', 'OrgUnit', 'Variable1', 'Variable2']
  Expected columns: ['Variable1', 'Period', 'OrgUnit']

[COLUMN_TRACE] ✓ Selecting columns BY NAME (found all expected columns in DataFrame)
  columns: ['Variable1', 'Period', 'OrgUnit']

[COLUMN_TRACE] AFTER assign_column_label:
  shape: (10, 3)
  columns: ['Variable1', 'Period', 'OrgUnit']
  expected: ['Variable1', 'Period', 'OrgUnit']
  match: True
```

**What this tells you**:
- ✓ Columns are selected by NAME (not by index)
- ✓ Column order is respected
- ✓ DataFrame ends with correct column names
- ⚠️ If fallback to INDEX happens, data may be misaligned!

**Fallback scenario** (problematic):
```
[COLUMN_TRACE] ⚠️  Expected columns not found in DataFrame. Using POSITION-BASED (INDEX) fallback
  Missing columns: {'Variable1'}
```
This indicates a problem: the expected column doesn't exist in the DataFrame!

---

### 6. Final DataFrame State

**What to look for**: The final state of the DataFrame before it's sent to the frontend

**Log markers**:
```
[COLUMN_TRACE] AFTER datasource.query() in viz.get_df:
  shape: (10, 3)
  columns: ['Variable1', 'Period', 'OrgUnit']
  expected: ['Variable1', 'Period', 'OrgUnit']
  match: True
  first_row: {'Variable1': 100, 'Period': '2023Q1', 'OrgUnit': 'Kampala'}

[COLUMN_TRACE] Query object columns: ['Variable1', 'Period', 'OrgUnit']
[COLUMN_TRACE] Query object metrics: [...]
```

**What this tells you**:
- ✓ DataFrame columns match query object columns
- ✓ Data values are in the correct positions
- ⚠️ If first_row values don't match column names, debug the DHIS2 normalization

---

## Troubleshooting Scenarios

### Scenario 1: Data appears in wrong column position

**Symptoms**:
- Column names are correct: [Variable1, Period, OrgUnit]
- But Period data appears where Variable1 should be

**Debug steps**:

1. **Check DHIS2 pivot construction**:
   ```
   [DHIS2] PIVOT CONSTRUCTION:
     col_names: ['Period', 'OrgUnit', 'Variable1']  ← Check if this matches expected order
   ```
   
2. **Verify row value order**:
   ```
   [DHIS2] FIRST ROW CONSTRUCTION:
     Period (index 0): 2023Q1
     OrgUnit (index 1): Kampala
     Variable1 (index 2): 100
   ```
   
3. **Check fetchall() column-to-value mapping**:
   ```
   [DHIS2] fetchall() column_names: ['Period', 'OrgUnit', 'Variable1']
   [DHIS2] Row 0 col 0 (Period): 2023Q1 -> '2023Q1' (STRING)
   [DHIS2] Row 0 col 1 (OrgUnit): Kampala -> 'Kampala' (STRING)
   [DHIS2] Row 0 col 2 (Variable1): 100 -> 100.0 (FLOAT)
   ```
   
   ⚠️ **Issue**: If columns are [Period, OrgUnit, Variable1] but user expects [Variable1, Period, OrgUnit], the data will appear shifted!

4. **Check column selection in assign_column_label**:
   ```
   [COLUMN_TRACE] Column truncation needed: df has 3 columns, expected 3
     DataFrame actual columns: ['Period', 'OrgUnit', 'Variable1']
     Expected columns: ['Variable1', 'Period', 'OrgUnit']
   
   [COLUMN_TRACE] ✓ Selecting columns BY NAME
     columns: ['Variable1', 'Period', 'OrgUnit']
   
   [COLUMN_TRACE] AFTER assign_column_label:
     columns: ['Variable1', 'Period', 'OrgUnit']  ← Should now match expected order
   ```

**Fix**: Ensure the column selection by name is working (should automatically reorder columns).

---

### Scenario 2: Column count mismatch

**Symptoms**:
- Error or data misalignment when multiple data elements are selected
- Works fine with 1-2 data elements, breaks with 3+

**Debug**:

1. **Check column count matches**:
   ```
   [DHIS2] fetchall() column_names length: 4
   [DHIS2] First row values count: 3  ← MISMATCH!
   ```
   
   This is a critical bug! The zip() in fetchall() will only use 3 values for 4 columns!

2. **Check DHIS2 response structure**:
   ```
   [DHIS2] Raw API response keys: ['headers', 'rows', 'metaData']
   [DHIS2] Raw DHIS2 rows count: 10
   [DHIS2] First raw row: (val1, val2, val3)  ← Count rows
   ```

3. **Check normalization**:
   ```
   [DHIS2] Normalized columns: ['Period', 'OrgUnit', 'DE1', 'DE2', 'DE3']  ← 5 columns
   [DHIS2] First row: (2023Q1, Kampala, 100, 200, 300)  ← 5 values
   ```

**Fix**: Ensure the normalizer returns the same number of values as columns for each row.

---

### Scenario 3: Fallback to index-based selection

**Symptoms**:
- Warning message about missing columns
- Data appears misaligned in unpredictable ways

**Debug**:

```
[COLUMN_TRACE] ⚠️  Expected columns not found in DataFrame. Using POSITION-BASED (INDEX) fallback for 3 columns
  Missing columns: {'Variable1', 'Period'}
```

**This is bad!** It means the expected column names don't exist in the DataFrame at all.

**Likely causes**:
1. Column name sanitization mismatch (dashboard names don't match DataFrame column names)
2. DHIS2 API returning different column names than expected
3. SQL query generating different column aliases than expected

**Fix**:
1. Check column name sanitization: do dashboard column names match what the query returns?
2. Add more logging to see where the name mismatch happens
3. Ensure DHIS2 metadata column names match what the API returns

---

## How to Read Logs in Production

1. **Backend logs location**: Check your Superset logs (typically `/var/log/superset/` or Docker container logs)

2. **Search for patterns**:
   ```bash
   # Find all column trace messages
   grep "\[COLUMN_TRACE\]" /var/log/superset/superset.log
   
   # Find DHIS2 processing
   grep "\[DHIS2\]" /var/log/superset/superset.log
   
   # Find warnings/errors
   grep "WARNING\|ERROR" /var/log/superset/superset.log | grep COLUMN
   ```

3. **Correlate with frontend**: Check browser console for corresponding frontend logs with similar timestamp

4. **Enable debug logging**: In `superset_config.py`:
   ```python
   LOGGING_CONFIG = {
       'version': 1,
       'disable_existing_loggers': False,
       'formatters': {
           'verbose': {
               'format': '%(asctime)s %(name)s %(levelname)s %(message)s'
           },
       },
       'handlers': {
           'console': {
               'class': 'logging.StreamHandler',
               'formatter': 'verbose',
               'level': 'DEBUG',
           },
       },
       'root': {
           'handlers': ['console'],
           'level': 'DEBUG',
       },
   }
   ```

---

## Key Files with Logging

| File | What it logs | Key function |
|------|-------------|---|
| `superset/utils/column_trace_logger.py` | Column tracing utilities | `ColumnTraceLogger` class |
| `superset/connectors/sqla/models.py` | DataFrame column assignment | `assign_column_label()` |
| `superset/models/helpers.py` | DataFrame column assignment (helpers) | `assign_column_label()` |
| `superset/db_engine_specs/dhis2_dialect.py` | DHIS2 API response parsing | `normalize_analytics()`, `fetchall()` |
| `superset/viz.py` | Query execution and DataFrame state | `get_df()` |

---

## Summary

Use this logging guide to trace the complete flow of data:

1. **FormData** → Check user selections are captured
2. **QueryObject** → Check columns are passed to backend
3. **SQL** → Check query is correctly formed
4. **DHIS2 API** → Check response is normalized correctly
5. **DataFrame** → Check columns and values are aligned
6. **Display** → Check final data is correct

If data is misaligned, one of these steps has a bug. The detailed logs help identify exactly where.

