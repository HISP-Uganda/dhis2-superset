# Pivot Table Undefined Values - Debugging Guide

**Issue**: When generating a pivot table with multiple metrics, some metrics show "undefined" values while others display correctly.

**Example**:
```
MetricSUM(105-EP01b_Malaria_Total)SUM(105-EP01a_Suspected_fever)
Period20202021202220232020202120222023
OrgUnitMOH - Uganda14.5M12.3M16.8M1.32Mundefinedundefinedundefinedundefined
```

First 4 values (for first metric) are present, but second metric has undefined values.

---

## Root Cause Analysis

The issue occurs when the **metric column names don't match** what the pivot table frontend is looking for.

### Data Flow

```
1. Backend generates SQL with metrics: SUM(column1), SUM(column2)
   ↓
2. labels_expected set to: ["SUM(column1)", "SUM(column2)"]
   ↓
3. DataFrame returned with columns: ["Period", "OrgUnit", "SUM(column1)", "SUM(column2)"]
   ↓ BUT WHAT IF...
   
   DataFrame actually has: ["Period", "OrgUnit", "column1", "column2"]
   OR
   ["Period", "OrgUnit", "105-EP01b_Malaria_Total_sum", "105-EP01a_Suspected_fever_sum"]
   
   ↓
4. assign_column_label tries to match:
   - Looks for: ["SUM(column1)", "SUM(column2)"]
   - Finds: ["Period", "OrgUnit", "column1", "column2"]
   - Falls back to positional: takes first 2 columns → ["Period", "OrgUnit"]
   - Relabels to: ["SUM(column1)", "SUM(column2)"] → WRONG DATA!
   
   ↓
5. Frontend receives:
   - Metric "SUM(column1)" → contains Period data (undefined)
   - Metric "SUM(column2)" → contains OrgUnit data (undefined)
```

---

## Comprehensive Logging Added

Added detailed logging at every stage to trace the issue:

### Backend - SQL Query Building

```
[COLUMN_TRACE] SQL Query Building:
  columns: ['Period', 'OrgUnit']
  metrics: [{'label': 'SUM(105-EP01b_Malaria_Total)', ...}, {'label': 'SUM(105-EP01a_Suspected_fever)', ...}]
  groupby: ['Period', 'OrgUnit']
  labels_expected: ['Period', 'OrgUnit', 'SUM(105-EP01b_Malaria_Total)', 'SUM(105-EP01a_Suspected_fever)']
  select_exprs count: 4
    [0] key=Period, name=Period
    [1] key=OrgUnit, name=OrgUnit
    [2] key=SUM(105-EP01b_Malaria_Total), name=...
    [3] key=SUM(105-EP01a_Suspected_fever), name=...
```

**What to check**: Do all metric keys match the expected labels?

### Backend - SQL Execution

```
[COLUMN_TRACE] Query execution in connectors/sqla/models.py:
  SQL (first 500 chars): SELECT Period, OrgUnit, SUM(...) AS SUM(...), SUM(...) AS SUM(...)
  labels_expected: ['Period', 'OrgUnit', 'SUM(105-EP01b_Malaria_Total)', 'SUM(105-EP01a_Suspected_fever)']
```

**What to check**: Does the SQL have the correct metric aliases?

### Backend - DataFrame Processing

```
[COLUMN_TRACE] Column truncation needed: df has 6 columns, expected 4
  DataFrame actual columns: ['Period', 'OrgUnit', '105-EP01b_Malaria_Total_sum', '105-EP01a_Suspected_fever_sum', 'extra_col1', 'extra_col2']
  Expected columns: ['Period', 'OrgUnit', 'SUM(105-EP01b_Malaria_Total)', 'SUM(105-EP01a_Suspected_fever)']

[COLUMN_TRACE] ⚠️  Expected columns not found in DataFrame. Using POSITION-BASED (INDEX) fallback
  Missing columns: {'SUM(105-EP01b_Malaria_Total)', 'SUM(105-EP01a_Suspected_fever)'}

[COLUMN_TRACE] Assigning column labels: ['Period', 'OrgUnit', 'SUM(105-EP01b_Malaria_Total)', 'SUM(105-EP01a_Suspected_fever)']
```

**THIS IS THE PROBLEM**: Expected columns not found! Using fallback to INDEX-based selection.

### Backend - Final DataFrame

```
[COLUMN_TRACE] DataFrame returned columns: ['Period', 'OrgUnit', 'SUM(105-EP01b_Malaria_Total)', 'SUM(105-EP01a_Suspected_fever)']
  DataFrame shape: (4, 4)
  DataFrame first row: {'Period': '2020', 'OrgUnit': 'MOH - Uganda', 'SUM(105-EP01b_Malaria_Total)': 14.5M, 'SUM(105-EP01a_Suspected_fever)': 12.3M}
```

**What to check**: Do the column names match what was expected?

### Payload Data

```
[COLUMN_TRACE] Payload data generated:
  data rows: 4
  first row keys: ['Period', 'OrgUnit', 'SUM(105-EP01b_Malaria_Total)', 'SUM(105-EP01a_Suspected_fever)']
  first row: {'Period': '2020', 'OrgUnit': 'MOH - Uganda', 'SUM(105-EP01b_Malaria_Total)': 14500000, 'SUM(105-EP01a_Suspected_fever)': 12300000}
```

**What to check**: Do the first row values match the correct metrics?

### Frontend - Pivot Table Data Processing

```
[PIVOT_TABLE] Processing metric: SUM(105-EP01b_Malaria_Total)
  record keys: ['Period', 'OrgUnit', 'SUM(105-EP01b_Malaria_Total)', 'SUM(105-EP01a_Suspected_fever)']
  record[metric]: 14500000

[PIVOT_TABLE] Processing metric: SUM(105-EP01a_Suspected_fever)
  record keys: ['Period', 'OrgUnit', 'SUM(105-EP01b_Malaria_Total)', 'SUM(105-EP01a_Suspected_fever)']
  record[metric]: 12300000

[PIVOT_TABLE] Unpivoted data generated: 8 rows
[PIVOT_TABLE] First unpivoted row: {Period: '2020', OrgUnit: 'MOH - Uganda', Metric: 'SUM(105-EP01b_Malaria_Total)', value: 14500000}
```

**What to check**: Is record[metric] finding the correct values?

---

## How to Debug

### 1. Check backend logs for column mismatch

```bash
grep "Missing columns\|Expected columns not found" /var/log/superset/superset.log
```

If you see this warning, the metric column names from the database don't match the expected labels.

### 2. Find what column names are actually returned

```bash
grep "DataFrame actual columns" /var/log/superset/superset.log | tail -1
```

Compare with:
```bash
grep "Expected columns:" /var/log/superset/superset.log | tail -1
```

### 3. Check SQL query

```bash
grep "SQL (first 500" /var/log/superset/superset.log | tail -1
```

Verify that metric aliases are set correctly.

### 4. Check frontend console

```
[PIVOT_TABLE] record keys: [...]
[PIVOT_TABLE] record[metric]: [value]
```

If `record[metric]` is `undefined`, it means the metric name doesn't exist in the data object.

---

## Common Causes

### Cause 1: Metric Alias Mismatch
**Symptom**: `labels_expected` has "SUM(metric_name)" but DataFrame has "metric_name_sum"

**Solution**: Fix the SQL generation to use the correct alias format for your database

### Cause 2: Column Name Sanitization
**Symptom**: DataFrame has sanitized names (underscores) but labels_expected has original names (dashes)

**Solution**: Ensure column name sanitization is applied consistently

### Cause 3: Position-Based Fallback
**Symptom**: "Using POSITION-BASED (INDEX) fallback" warning

**Solution**: Fix the underlying column name mismatch so name-based selection works

### Cause 4: DHIS2 Specific
**Symptom**: Multiple data elements, only first has values

**Likely cause**: DHIS2 API returning different column names than expected

**Solution**: Check DHIS2 response structure and ensure column mapping is correct

---

## Files Modified for Debugging

| File | Changes | Log Pattern |
|------|---------|------------|
| `superset/models/helpers.py` | SQL building logging | `[COLUMN_TRACE] SQL Query Building` |
| `superset/connectors/sqla/models.py` | Query execution logging | `[COLUMN_TRACE] Query execution` |
| `superset/viz.py` | DataFrame and payload logging | `[COLUMN_TRACE] DataFrame returned` |
| `superset-frontend/plugins/plugin-chart-pivot-table/src/PivotTableChart.tsx` | Frontend metric processing | `[PIVOT_TABLE]` |

---

## Next Steps

1. Restart backend to load new logging
2. Create a pivot table with multiple metrics that shows undefined values
3. Collect logs with:
   ```bash
   grep "\[COLUMN_TRACE\]\|\[PIVOT_TABLE\]\|\[DHIS2\]" /var/log/superset/superset.log > debug.log
   ```
4. Share the logs showing:
   - SQL Query Building stage
   - DataFrame actual columns vs expected columns
   - DHIS2 specific logs if using DHIS2 source

This will pinpoint exactly where and why the undefined values are appearing.
