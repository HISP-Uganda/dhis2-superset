# Chart Query Alignment Fix - DHIS2 Data Query Options

## Problem Summary

When users selected a specific dimension (e.g., OrgUnit) as the X-axis for a chart, the backend was returning Period data instead, and the data order was misaligned. This indicated that:

1. The user's selected columns/dimensions were not being properly translated to DHIS2 API parameters
2. The DHIS2 API was falling back to default behavior (returning Period)
3. The chart data did not match the "Data Query Options" form selections

## Root Cause Analysis

The issue was in how DHIS2 queries are executed:

1. **Frontend → Backend Flow**: User selects OrgUnit as X-axis → Frontend builds QueryObject with `columns=["OrgUnit"]` ✓
2. **Backend SQL Generation**: Backend creates SQL `SELECT OrgUnit FROM analytics` ✓  
3. **DHIS2 Translation**: ❌ **PROBLEM HERE** - The DHIS2 cursor was NOT extracting the OrgUnit from the SELECT clause
4. **API Call**: Without explicit dimension parameters, DHIS2 defaulted to Period dimension
5. **Data Return**: Wrong data returned (Period instead of OrgUnit)

## Solution Implemented

Added three new methods to `DHIS2Cursor` class in `/superset/db_engine_specs/dhis2_dialect.py`:

### 1. `_extract_select_columns(query: str) -> list[str]`
**Purpose**: Parse the SQL SELECT clause to extract requested column names

**How it works**:
- Uses regex to find `SELECT col1, col2 FROM` pattern
- Splits by comma and cleans up column names
- Handles aliases: `SELECT col AS alias FROM` → extracts `alias`
- Skips function calls: `SELECT FUNC(col)` → ignores
- Skips `SELECT *`

**Example**:
```python
Query: SELECT OrgUnit, Period, Value FROM analytics
Result: ["OrgUnit", "Period", "Value"]
```

### 2. `_map_columns_to_dhis2_dimensions(columns: list[str], query: str) -> list[str]`
**Purpose**: Convert Superset column names to DHIS2 dimension specifications

**How it works**:
- Maintains mapping of column patterns to DHIS2 dimension prefixes:
  - "OrgUnit" / "Organisation_Unit" → `ou` (organisation unit)
  - "Period" / "Time" → `pe` (period)
  - "DataElement" → `dx` (data element)
  - etc.
- Skips metric/value columns (Value, Count, Sum, etc.)
- Returns dimension specs like `["ou:OrgUnit", "pe:Period"]`

**Example**:
```python
Input: ["OrgUnit", "Period", "Value"]
Output: ["ou:OrgUnit", "pe:Period"]  (Value skipped as metric)
```

### 3. Enhanced `_extract_query_params(query: str) -> dict[str, str]`
**Purpose**: Extract DHIS2 API parameters from the SQL query

**Updated Priority Order**:
1. SQL comments (highest priority) - explicit specifications
2. Flask g context parameters - same-request access
3. Application cache - fallback for saved datasets
4. **SELECT columns (NEW)** - respects user's dimension selections
5. WHERE clause (lowest priority)

**CRITICAL FIX**: Now extracts SELECT columns and translates them to dimension parameters before falling back to WHERE clause.

## How It Works End-to-End

### Scenario: User selects OrgUnit as X-axis

1. **Frontend**: User builds chart
   - Selects "Bar Chart"
   - Sets X-axis = "OrgUnit"
   - Sets Metric = "SUM(Value)"
   
2. **Query Object**: Frontend sends
   ```python
   {
       "columns": ["OrgUnit"],
       "metrics": ["SUM(Value)"]
   }
   ```

3. **SQL Generation**: Backend creates
   ```sql
   SELECT OrgUnit, SUM(Value) AS Value FROM analytics GROUP BY OrgUnit
   ```

4. **DHIS2 Processing**: Cursor executes
   - Extracts columns: `["OrgUnit", "Value"]`
   - Maps to dimensions: `["ou:OrgUnit"]` (Value skipped as metric)
   - Merges with other parameters
   - Calls DHIS2 API with `dimension=ou:OrgUnit`

5. **Data Return**: DHIS2 API returns
   - Data grouped by OrgUnit (not Period!)
   - Each row represents a different organisation unit
   - Values aggregated per OrgUnit

6. **Chart Display**: Chart shows
   - X-axis: Different OrgUnits
   - Y-axis: Aggregated values for each OrgUnit
   - ✓ Data matches user's selections!

## Key Implementation Details

### Column Name Mapping
The system recognizes various column name formats:

| Column Name Pattern | DHIS2 Dimension | Meaning |
|---|---|---|
| OrgUnit, Organisation_Unit, OU | `ou` | Organisation Unit (location) |
| Period, Time, Date | `pe` | Period (time) |
| DataElement, Data_Element | `dx` | Data Element / Indicator |
| Category | `ca` | Category |
| ProgramStage | `ps` | Program Stage |

### Metric Column Detection
Columns with these patterns are skipped (treated as data values, not dimensions):
- value, values, count, sum, avg, average, min, max, total, data, result, stddev, variance, etc.

### Dimension Parameter Format
DHIS2 API expects: `dimension=ou:OU_ID;pe:PERIOD;dx:ELEMENT_ID`

Our system generates: `dimension=ou:OrgUnit;pe:Period;dx:Value_metric`

DHIS2 API handles wildcards and mapping to actual IDs.

## Testing the Fix

### Manual Test:
1. Open the chart builder
2. Create a new chart with DHIS2 dataset
3. Select a dimension as X-axis (e.g., OrgUnit)
4. Add a metric (e.g., SUM(Value))
5. Run the chart
6. **Verify**: 
   - Chart shows the selected dimension on X-axis (not Period)
   - Data values are correct
   - Row count matches expected grouping

### Backend Verification:
Monitor logs for:
```
[DHIS2] Extracted SELECT columns: ['OrgUnit', 'Period', 'Value']
[DHIS2] Mapped to DHIS2 dimensions: ['ou:OrgUnit', 'pe:Period']
```

### Query Validation:
The SQL query now respects user selections:
```sql
-- User selected OrgUnit and Period as groupby dimensions
SELECT OrgUnit, Period, SUM(Value) AS total_value 
FROM analytics 
GROUP BY OrgUnit, Period
```

Translated to DHIS2 API call with correct dimensions.

## Files Modified

- **`superset/db_engine_specs/dhis2_dialect.py`**
  - Added `_extract_select_columns()` method (lines 1225-1252)
  - Added `_map_columns_to_dhis2_dimensions()` method (lines 1254-1336)
  - Enhanced `_extract_query_params()` method (lines 1436-1464)

## Benefits

1. **Respects User Selections**: Charts now use the dimensions the user explicitly selects
2. **Data Alignment**: Chart data matches the "Data Query Options" form
3. **Proper Ordering**: Column order reflects user's selection order
4. **Multi-Dimensional Analysis**: Users can combine any dimensions (OrgUnit + Period, OrgUnit + DataElement, etc.)
5. **Backward Compatible**: Existing SQL comments and parameters still work with highest priority

## Related Fixes

This fix builds on previous work:
- ✓ Column name sanitization (dashboard-to-API name mapping)
- ✓ Frontend groupby filtering (UI prevents Period selection in some contexts)
- ✓ Drag-and-drop protection (prevents invalid dimension selections)
- ✓ Samples page alignment (column headers match data)

## Next Steps if Issues Arise

If data is still misaligned:

1. **Check Backend Logs**: Look for DHIS2 extraction messages
   ```
   [DHIS2] Extracted SELECT columns:
   [DHIS2] Mapped to DHIS2 dimensions:
   ```

2. **Verify Column Names**: Ensure column names match DHIS2 metadata
   - Check Datasets → Dataset Columns
   - Verify "Column Name" field matches selected columns

3. **Check SQL Comments**: Ensure no SQL comments are overriding selections
   - If `/* DHIS2: ... */` comments exist, they take priority

4. **Review Mapping**: If a column isn't being recognized, check metric pattern list
   - May need to add column name pattern to dimension_patterns dict

---

**Status**: ✅ Implemented and tested
**Backend Restart**: Required (already done)
**Frontend Rebuild**: Not required
