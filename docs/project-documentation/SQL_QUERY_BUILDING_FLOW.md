# SQL Query Building Flow: Multiple Metrics with Groupby Dimensions

## Overview

This document explains how Superset builds SQL queries when users select multiple metrics and groupby (dimension) columns, with special focus on DHIS2 datasets with sanitized column names.

## Query Building Architecture

```
User Selection (Frontend)
    ↓
Column Sanitization (adhoc_metric_to_sqla)
    ↓
SQLA Expression Building (metrics_exprs, select_exprs)
    ↓
Deduplication (remove_duplicates)
    ↓
SQL Assembly (SELECT, FROM, GROUP BY)
    ↓
Query Execution
```

---

## Detailed Flow: get_sqla_query() Method

### Phase 1: Input Collection (Lines 1887-1965)

```python
def get_sqla_query(
    self,
    columns: Optional[list[Column]] = None,          # Regular columns (non-metrics)
    groupby: Optional[list[Column]] = None,          # Dimension columns for GROUP BY
    metrics: Optional[list[Metric]] = None,          # Metrics: SUM, AVG, COUNT, etc.
    granularity: Optional[str] = None,               # Time column (Period for DHIS2)
    ...
) -> SqlaQuery:
```

**Key Variables Initialized:**
- `metrics_exprs: list[ColumnElement] = []` - SQLA expressions for metrics
- `select_exprs: list[Union[Column, Label]] = []` - Final SELECT columns
- `groupby_all_columns: dict[str, ColumnElement] = {}` - GROUP BY columns

### Phase 2: Metric Processing (Lines 2004-2033)

For each metric in the `metrics` list:

#### A. Identify Metric Type
```python
if utils.is_adhoc_metric(metric):  # User-created metric
    # SUM(105-EP01b. Malaria Total)
    # AVG(105-EP01a. Suspected fever)
    # etc.
    metric_expr = self.adhoc_metric_to_sqla(
        metric=metric,
        columns_by_name=columns_by_name,
        template_processor=template_processor,
    )
elif isinstance(metric, str) and metric in metrics_by_name:  # Pre-saved metric
    metric_expr = metrics_by_name[metric].get_sqla_col(...)
```

#### B. Column Sanitization (Inside adhoc_metric_to_sqla)
**Location:** `superset/models/helpers.py:1331-1397`

For SIMPLE metrics:
```python
column_name = "105-EP01b. Malaria Total"  # From frontend

# Sanitize the column name
sanitized_column_name = self._sanitize_column_reference(column_name)
# "105-EP01b. Malaria Total" → "105_EP01b_Malaria_Total"

# Create SQLA column
sqla_column = sa.column(sanitized_column_name)

# Apply aggregate function
aggregate = "SUM"  # Normalized to uppercase
sqla_metric = self.sqla_aggregations[aggregate](sqla_column)
# Result: SUM(105_EP01b_Malaria_Total)

# Create label
label = f"{aggregate}({sanitized_column_name})"
# "SUM(105_EP01b_Malaria_Total)"
```

#### C. Add to metrics_exprs
```python
metrics_exprs.append(metric_expr)
logger.error(f"[METRICS-TRACE]   ✓ Added: {metric_expr.name}")
# Log shows: "SUM(105_EP01b_Malaria_Total)"
```

**Result After Processing All Metrics:**
```
metrics_exprs = [
    SUM(105_EP01b_Malaria_Total),      # Metric 1
    AVG(105_EP01b_Malaria_Total),      # Metric 2
    COUNT(105_EP01b_Malaria_Total),    # Metric 3
]
```

### Phase 3: Groupby Column Processing (Lines 2101-2152)

When `need_groupby = True` (which happens when metrics are present):

```python
if need_groupby:
    columns = groupby or columns  # Use groupby dimensions
    for selected in columns:  # e.g., Period, OrgUnit
        # Sanitize column reference
        selected_key = self._sanitize_column_reference(selected)
        # "Period" → "Period" (no special chars)
        
        # Get column object
        if selected_key in columns_by_name:
            table_col = columns_by_name[selected_key]
            
            # Special handling for DHIS2
            if is_dhis2_datasource and not table_col.is_dttm:
                # Period is categorical, not datetime
                outer = self.convert_tbl_column_to_sqla_col(
                    table_col,
                    template_processor=template_processor,
                )
            else:
                # Regular datetime column
                outer = table_col.get_timestamp_expression(...)
        
        # Add to both SELECT and GROUP BY tracking
        groupby_all_columns[outer.name] = outer  # For GROUP BY
        select_exprs.append(outer)                # For SELECT
```

**Result After Processing Groupby:**
```
groupby_all_columns = {
    "Period": Column("Period"),
    "OrgUnit": Column("OrgUnit"),
}

select_exprs = [
    Column("Period"),        # Groupby column 1
    Column("OrgUnit"),       # Groupby column 2
]
```

### Phase 4: Metric Addition to SELECT (Lines 2035-2045)

After metric processing, add metrics to select_exprs:

```python
if metrics_exprs:
    main_metric_expr = metrics_exprs[0]
    # Used as default for ORDER BY if not specified

# metrics_exprs already populated with all metrics
```

These are added via deduplication (see Phase 5).

### Phase 5: Deduplication (Lines 2251-2263)

**CRITICAL STEP:** Combine groupby columns + metrics, remove duplicates

```python
# Before dedup
combined = select_exprs + metrics_exprs
# [Period, OrgUnit, SUM(...), AVG(...), COUNT(...)]

# Dedup with expression as key (not just name)
select_exprs = remove_duplicates(
    combined, 
    key=lambda x: (str(x), x.name)  # Both expression AND name
)
```

**Why (str(x), x.name)?**

Example with 3 metrics on same column:
```
SUM(col)   → (str: "SUM(col)", name: "col") ✓ Unique
AVG(col)   → (str: "AVG(col)", name: "col") ✓ Unique  (different str()!)
COUNT(col) → (str: "COUNT(col)", name: "col") ✓ Unique (different str()!)
```

If used just `.name`, all 3 would have same key "col" → only 1 survives (BUG!)

**Result After Dedup:**
```
select_exprs = [
    Column("Period"),                        # [1]
    Column("OrgUnit"),                       # [2]
    SUM(105_EP01b_Malaria_Total),           # [3]
    AVG(105_EP01b_Malaria_Total),           # [4]
    COUNT(105_EP01b_Malaria_Total),         # [5]
]
```

### Phase 6: SQL Assembly (Lines 2282-2287)

```python
# Create SELECT clause
qry = sa.select(select_exprs)
# SELECT "Period", "OrgUnit", 
#        SUM("105_EP01b_Malaria_Total"), 
#        AVG("105_EP01b_Malaria_Total"),
#        COUNT("105_EP01b_Malaria_Total")

# Add FROM clause
tbl, cte = self.get_from_clause(template_processor)
# FROM dhis2_analytics

# Add GROUP BY clause
if groupby_all_columns:
    qry = qry.group_by(*groupby_all_columns.values())
# GROUP BY "Period", "OrgUnit"

# Final SQL
qry.compile()
```

---

## Complete Example: DHIS2 Multi-Metric Chart

### User Selection
- **X-Axis (Groupby):** Period
- **Dimension:** OrgUnit  
- **Metrics:** SUM, AVG, COUNT on "105-EP01b. Malaria Total"

### Generated SQL
```sql
SELECT 
    "Period",
    "OrgUnit",
    SUM("105_EP01b_Malaria_Total") AS "SUM(105_EP01b_Malaria_Total)",
    AVG("105_EP01b_Malaria_Total") AS "AVG(105_EP01b_Malaria_Total)",
    COUNT("105_EP01b_Malaria_Total") AS "COUNT(105_EP01b_Malaria_Total)"
FROM dhis2_analytics
GROUP BY "Period", "OrgUnit"
```

### Result Set
```
Period  | OrgUnit   | SUM(...) | AVG(...) | COUNT(...)
--------|-----------|----------|----------|----------
2024-Q1 | District1 |   1500   |   25.5   |    59
2024-Q1 | District2 |   2100   |   35.0   |    60
2024-Q2 | District1 |   1650   |   27.5   |    60
2024-Q2 | District2 |   2300   |   38.3   |    60
```

### Chart Rendering
- **X-Axis:** Period (2024-Q1, 2024-Q2)
- **Series 1 (SUM):** Bars/Lines with values
- **Series 2 (AVG):** Bars/Lines with values
- **Series 3 (COUNT):** Bars/Lines with values
- **Grouped By:** OrgUnit (District1, District2)

---

## Column Sanitization Points

### Point 1: Metric Column (adhoc_metric_to_sqla)
**Input:** `"105-EP01b. Malaria Total"` (unsanitized)
**Process:** Remove special chars
**Output:** `"105_EP01b_Malaria_Total"` (sanitized)
**Location:** `superset/models/helpers.py:1344`

### Point 2: Groupby Column (convert_tbl_column_to_sqla_col)
**Input:** `"Period"` (no special chars)
**Process:** Already clean in database
**Output:** `"Period"` (unchanged)
**Location:** `superset/models/helpers.py:2128-2131`

### Point 3: Postprocessing (pandas_postprocessing/utils.py)
**Input:** Query result with sanitized column names
**Process:** Match DataFrame columns with aggregate requests
**Strategy:**
1. Try direct match: `"SUM(105_EP01b_Malaria_Total)"` in df.columns?
2. Try unwrap: Extract inner `"105_EP01b_Malaria_Total"`, match that
3. Try DHIS2 sanitization on request
4. Try case-insensitive match
5. Fuzzy normalize and match
6. Reverse wrap: If request has unwrapped, try finding wrapped version

**Result:** Correct column found for aggregation

---

## Important Code Sections

| Phase | Location | Code | Purpose |
|-------|----------|------|---------|
| Input | L1887 | `def get_sqla_query(...)` | Entry point |
| Metrics | L2004-2033 | Loop through metrics | Process each metric |
| Sanitize | L1344 | `sanitized_column_name = self._sanitize_column_reference(...)` | Sanitize metric column |
| Create SQLA | L1347-1363 | Create and apply aggregate | Build SQLA expression |
| Groupby | L2101-2152 | Loop through groupby cols | Process dimensions |
| Dedup | L2251-2263 | `remove_duplicates(..., key=lambda x: (str(x), x.name))` | **CRITICAL:** Preserve all metrics |
| SQL Build | L2282-2287 | `sa.select()`, `.group_by()` | Assemble final query |

---

## Multi-Metric Chart Flow

```
User selects in Chart Designer:
  - X-Axis: Period
  - Additional Groupby: OrgUnit
  - Metrics: [SUM, AVG, COUNT] on "105-EP01b. Malaria Total"
        ↓
Frontend sends formData with:
  groupby: ["Period", "OrgUnit"]
  metrics: [
    {aggregate: "SUM", column: {..., column_name: "105-EP01b. Malaria Total"}},
    {aggregate: "AVG", column: {..., column_name: "105-EP01b. Malaria Total"}},
    {aggregate: "COUNT", column: {..., column_name: "105-EP01b. Malaria Total"}}
  ]
        ↓
Superset processes:
  1. Sanitize columns: "105-EP01b. Malaria Total" → "105_EP01b_Malaria_Total"
  2. Build metrics: [SUM(col), AVG(col), COUNT(col)]
  3. Add groupby: [Period, OrgUnit]
  4. Deduplicate: All metrics survive (different str() representations)
  5. Build SQL: SELECT Period, OrgUnit, SUM(...), AVG(...), COUNT(...)
               GROUP BY Period, OrgUnit
        ↓
Database executes query, returns DataFrame with 5 columns
        ↓
Postprocessing matches columns and applies any additional aggregations
        ↓
Chart renders with 3 series (SUM, AVG, COUNT) grouped by 2 dimensions
```

---

## Debugging Tips

### Check Metrics Are All Processed
Look in server logs for:
```
[METRICS-TRACE] Processing 3 metrics
[METRICS-TRACE] Metric 0: adhoc - SUM
[METRICS-TRACE]   ✓ Added: SUM(105_EP01b_Malaria_Total)
[METRICS-TRACE] Metric 1: adhoc - AVG
[METRICS-TRACE]   ✓ Added: AVG(105_EP01b_Malaria_Total)
[METRICS-TRACE] Metric 2: adhoc - COUNT
[METRICS-TRACE]   ✓ Added: COUNT(105_EP01b_Malaria_Total)
[METRICS-TRACE] Total metrics added: 3
```

### Check Deduplication Preserves All Metrics
```
[METRICS-TRACE] Before dedup: 2 select_exprs + 3 metrics_exprs
[METRICS-TRACE] After dedup: 5 total select_exprs
```
✓ If After = 5, all metrics survived
❌ If After = 3, metrics were incorrectly deduplicated

### Check SQL Query Structure
```
[COLUMN_TRACE] SQL Query Building:
[COLUMN_TRACE]   columns: [Period, OrgUnit]
[COLUMN_TRACE]   metrics: [SUM, AVG, COUNT]
[COLUMN_TRACE]   groupby: [Period, OrgUnit]
[COLUMN_TRACE]   labels_expected: ['Period', 'OrgUnit', 'SUM(...)', 'AVG(...)', 'COUNT(...)']
[COLUMN_TRACE]   select_exprs count: 5
```

---

## Summary

**SQL Query = SELECT clause + GROUP BY clause**

**SELECT clause** = groupby dimensions + metric aggregates
- Groupby dimensions added in Phase 3 (lines 2101-2152)
- Metric aggregates added in Phase 2 (lines 2004-2033)
- Combined and deduplicated in Phase 5 (lines 2251-2263)

**GROUP BY clause** = groupby dimensions only (NOT metrics)
- Built from `groupby_all_columns` dictionary
- Metrics are NOT in GROUP BY (they're aggregations)
- Only dimension columns that users grouped by

**Key Points:**
1. Multiple metrics on same column are deduped by `(str(expr), expr.name)` to all survive
2. Column names sanitized early (adhoc_metric_to_sqla) for DHIS2 special chars
3. Postprocessing matches sanitized names with DataFrame columns
4. Each metric applies independently to its specified column
5. Result is grouped by dimension columns, aggregated by metric functions
