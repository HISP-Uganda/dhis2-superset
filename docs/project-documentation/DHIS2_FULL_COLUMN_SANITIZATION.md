# DHIS2 Complete Column Sanitization Implementation

## Overview

All DHIS2 dataset columns (including Period, OrgUnit, and data elements) now pass through the `sanitize_dhis2_column_name()` function to ensure consistency across all operations.

## Problem

Previously, some columns like "Period" and "OrgUnit" were NOT being sanitized, causing inconsistencies:
- Column metadata might have unsanitized names
- Query results might have sanitized names
- This caused column mismatches in charts and data processing

## Solution

Ensured ALL columns - including base dimensions - are sanitized through `sanitize_dhis2_column_name()`.

## Changes Made

### File: `superset/db_engine_specs/dhis2_dialect.py`

#### 1. **Long Format Response (Line 395)**
```python
# BEFORE: Unsanitized
col_names = ["Period", "OrgUnit", "DataElement", "Value"]

# AFTER: ALL columns SANITIZED
col_names = [sanitize_dhis2_column_name(col) for col in ["Period", "OrgUnit", "DataElement", "Value"]]
```

#### 2. **Simplified Analytics Format (Lines 482-491)**
```python
# ALL columns MUST be SANITIZED
col_names = []
for h in headers:
    name = h.get("name", h.get("column", "value"))
    if name == "dx":
        col_names.append(sanitize_dhis2_column_name("Data"))
    elif name == "value":
        col_names.append(sanitize_dhis2_column_name("Value"))
    else:
        col_names.append(sanitize_dhis2_column_name(name))
```

#### 3. **Wide/Pivoted Analytics Format (Line 550)**
```python
# BEFORE: Only data elements sanitized
col_names = ["Period", "OrgUnit"] + [sanitize_dhis2_column_name(get_name(de)) for de in data_element_list]

# AFTER: ALL columns SANITIZED
col_names = [sanitize_dhis2_column_name("Period"), sanitize_dhis2_column_name("OrgUnit")] + [sanitize_dhis2_column_name(get_name(de)) for de in data_element_list]
```

#### 4. **DataValueSets Response (Lines 602-606)**
```python
# BEFORE: Unsanitized
return ["dataElement", "period", "orgUnit", "value"], []
col_names = list(data_values[0].keys())

# AFTER: ALL columns SANITIZED
return [sanitize_dhis2_column_name(col) for col in ["dataElement", "period", "orgUnit", "value"]], []
col_names = [sanitize_dhis2_column_name(col) for col in data_values[0].keys()]
```

#### 5. **Events Response (Lines 627, 639)**
```python
# BEFORE: Unsanitized
return ["event", "program", "orgUnit", "eventDate"], []
col_names = base_cols + sorted(data_element_ids)

# AFTER: ALL columns SANITIZED
return [sanitize_dhis2_column_name(col) for col in ["event", "program", "orgUnit", "eventDate"]], []
col_names = [sanitize_dhis2_column_name(col) for col in base_cols] + [sanitize_dhis2_column_name(de_id) for de_id in sorted(data_element_ids)]
```

#### 6. **Tracked Entity Instances Response (Lines 678, 690)**
```python
# BEFORE: Unsanitized
return ["trackedEntityInstance", "orgUnit", "trackedEntityType"], []
col_names = base_cols + sorted(attribute_ids)

# AFTER: ALL columns SANITIZED
return [sanitize_dhis2_column_name(col) for col in ["trackedEntityInstance", "orgUnit", "trackedEntityType"]], []
col_names = [sanitize_dhis2_column_name(col) for col in base_cols] + [sanitize_dhis2_column_name(attr_id) for attr_id in sorted(attribute_ids)]
```

#### 7. **Metadata List Response (Lines 727, 731, 733)**
```python
# BEFORE: Unsanitized
return ["id", "name", "displayName"], []
col_names = list(items[0].keys())

# AFTER: ALL columns SANITIZED
return [sanitize_dhis2_column_name(col) for col in ["id", "name", "displayName"]], []
col_names = [sanitize_dhis2_column_name(col) for col in items[0].keys()]
```

#### 8. **Generic Response (Lines 760, 763, 769)**
```python
# BEFORE: Unsanitized
col_names = list(items[0].keys())
col_names = ["value"]
return ["data"], [(json.dumps(data),)]

# AFTER: ALL columns SANITIZED
col_names = [sanitize_dhis2_column_name(col) for col in items[0].keys()]
col_names = [sanitize_dhis2_column_name("value")]
return [sanitize_dhis2_column_name("data")], [(json.dumps(data),)]
```

#### 9. **Default Column Definitions (Lines 904-908)**
```python
# BEFORE: Unsanitized
default_columns = {
    "analytics": ["Period", "OrgUnit"],
    "dataValueSets": ["dataElement", "period", "orgUnit", "value", "storedBy", "created"],
    ...
}

# AFTER: ALL columns SANITIZED
default_columns = {
    "analytics": [sanitize_dhis2_column_name(col) for col in ["Period", "OrgUnit"]],
    "dataValueSets": [sanitize_dhis2_column_name(col) for col in ["dataElement", "period", "orgUnit", "value", "storedBy", "created"]],
    ...
}
```

#### 10. **Column Metadata in get_columns() (Lines 969, 978)**
```python
# BEFORE: Unsanitized
"name": "Period",
"name": "OrgUnit",

# AFTER: ALL columns SANITIZED
"name": sanitize_dhis2_column_name("Period"),
"name": sanitize_dhis2_column_name("OrgUnit"),
```

#### 11. **Column Type Detection (Lines 924-936)**
```python
# BEFORE: Unsanitized comparisons
if col in ["Period", "OrgUnit", "DataElement", ...]:

# AFTER: Sanitized comparisons
dimension_cols = [sanitize_dhis2_column_name(c) for c in ["Period", "OrgUnit", "DataElement", ...]]
if col in dimension_cols:

elif col in [sanitize_dhis2_column_name(c) for c in ["Value", "value"]]:
```

#### 12. **Dimension Pattern Matching (Lines 1329-1349)**
```python
# BEFORE: Ad-hoc normalization
col_lower = col.lower().replace('_', '').replace(' ', '')
pattern_normalized = pattern.replace('_', '').replace(' ', '')

# AFTER: Uses sanitize function
col_sanitized = sanitize_dhis2_column_name(col.lower())
pattern_sanitized = sanitize_dhis2_column_name(pattern.lower())
```

## Sanitization Function

The single source of truth for all column name normalization:

```python
def sanitize_dhis2_column_name(name: str) -> str:
    """
    Sanitize DHIS2 column names for Superset compatibility.
    Must match the sanitization in _normalize_analytics_pivoted to ensure
    column names in metadata match column names in returned DataFrames.
    """
    name = name.replace('.', '_')           # dots → underscores
    name = re.sub(r'\s+', '_', name)        # whitespace → underscores
    name = name.replace('(', '').replace(')', '')  # remove parentheses
    name = name.replace('-', '_')           # dashes → underscores
    name = re.sub(r'_+', '_', name)         # collapse multiple underscores
    name = name.strip('_')                  # strip leading/trailing underscores
    return name
```

## Data Flow

All DHIS2 columns now follow this consistent flow:

```
Original DHIS2 Names
    ↓
sanitize_dhis2_column_name()
    ↓
Dataset Metadata (stored in DB)
    ↓
Query Results (from DHIS2 API)
    ↓
Chart Data Processing
    ↓
Consistent Column Names ✓
```

## Example Transformations

| Original | Sanitized | Used For |
|----------|-----------|----------|
| Period | Period | Base dimension column name |
| OrgUnit | OrgUnit | Base dimension column name |
| 105-EP01a. Suspected fever | 105_EP01a_Suspected_fever | Data element column name |
| dataElement | dataElement | Column from dataValueSets endpoint |
| trackedEntityInstance | trackedEntityInstance | Column from trackedEntityInstances endpoint |
| data-element | data_element | Dimension pattern matching |

## Endpoints Covered

✅ **Analytics** - Wide/Pivoted and Long formats
✅ **DataValueSets** - Raw data entry values
✅ **Events** - Tracker program events
✅ **TrackedEntityInstances** - Tracked entities
✅ **Metadata Endpoints** - dataElements, dataSets, indicators, etc.
✅ **Generic/Fallback** - Unknown endpoints
✅ **Dimension Patterns** - Pattern matching for dimension extraction

## Testing

All sanitization is verified by comprehensive tests:

```bash
python test_sanitize.py              # Basic sanitization
python test_dhis2_consistency.py      # Full consistency test
```

**Results**: ✅ All tests pass

## Backward Compatibility

✅ **Backward compatible** - This change only ensures consistency, it doesn't change the sanitization behavior.

Existing datasets with properly sanitized column names will continue to work correctly.

## Benefits

1. **Consistency** - All columns sanitized uniformly
2. **Correctness** - Column names match across metadata, results, and processing
3. **Maintainability** - Single function handles all sanitization
4. **Debugging** - Easier to trace column name issues
5. **Future-proofing** - Any sanitization logic changes apply globally

## Affected Endpoints

### Data Query Endpoints
- `analytics` - Aggregated analytical data
- `dataValueSets` - Raw data entry values
- `events` - Tracker program events
- `trackedEntityInstances` - Tracked entities
- `enrollments` - Program enrollments

### Metadata Endpoints
- `dataElements`
- `dataSets`
- `indicators`
- `programIndicators`
- `organisationUnits`
- `programs`

### Operations
- Query execution (executeQuery)
- Column metadata discovery (get_columns)
- Dimension extraction (_extract_dimension_specs_from_columns)
- Pattern matching for dimensions

## Service Status

✅ Service restarted successfully
- Backend running on `http://localhost:8088`
- All DHIS2 endpoints now use consistent column sanitization
- Ready for testing with DHIS2 datasets

## Next Steps

1. Refresh existing DHIS2 datasets to pick up sanitized column names
2. Test chart creation with DHIS2 data
3. Verify dimension filters work correctly
4. Monitor logs for any column name mismatches

---

**Implementation Date**: Dec 5, 2025
**Status**: ✅ Complete and Tested
