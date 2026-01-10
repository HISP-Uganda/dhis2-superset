# DHIS2 Column Name Consistency Fix

## Problem Summary

DHIS2 data element names like `"105-EP01a. Suspected fever"` were being handled inconsistently across the data pipeline, causing chart misalignment:

1. **Dataset metadata** stored unsanitized names: `"105-EP01a. Suspected fever"`
2. **Chart formData** used sanitized names: `"105_EP01a_Suspected_fever"`  
3. **Query results** returned inconsistent names

This caused:
- Column mismatches when charts tried to find data
- Data being displayed in wrong columns
- "Column referenced by aggregate is undefined" errors

## Root Cause

The `sanitize_dhis2_column_name()` function existed but was not being used consistently:

```python
def sanitize_dhis2_column_name(name: str) -> str:
    """Sanitize DHIS2 column names for Superset compatibility."""
    name = name.replace('.', '_')
    name = re.sub(r'\s+', '_', name)
    name = name.replace('(', '').replace(')', '')
    name = name.replace('-', '_')
    name = re.sub(r'_+', '_', name)
    name = name.strip('_')
    return name
```

## Solution

### 1. Consistent Sanitization in Query Results (`dhis2_dialect.py`)

Updated the `get_name()` function in `normalize_analytics()` to always apply sanitization:

```python
def get_name(uid: str, sanitize: bool = True) -> str:
    """Get human-readable name for UID with optional sanitization."""
    item = items.get(uid, {})
    name = item.get("name", uid)
    if sanitize:
        return sanitize_dhis2_column_name(name)
    return name
```

### 2. Consistent Sanitization in Dataset Metadata (`get_columns()`)

Updated column metadata to use sanitized names:

```python
# IMPORTANT: Sanitize column names to match analytics endpoint!
column_name = sanitize_dhis2_column_name(item_name)

columns.append({
    "name": column_name,  # Sanitized for consistency
    "verbose_name": item_name,  # Original for display
    ...
})
```

### 3. Fuzzy Matching as Fallback (`models/helpers.py`)

Added fuzzy column name matching in `assign_column_label()` to handle edge cases:

```python
def normalize_column_name(name: str) -> str:
    """Normalize for fuzzy matching."""
    normalized = re.sub(r'[.\-\s()]+', '_', name)
    normalized = re.sub(r'_+', '_', normalized)
    return normalized.strip('_').lower()

def find_column_match(expected: str, df_columns: list) -> str | None:
    """Find column by exact or fuzzy match."""
    if expected in df_columns:
        return expected
    expected_normalized = normalize_column_name(expected)
    for col in df_columns:
        if normalize_column_name(col) == expected_normalized:
            return col
    return None
```

## Data Flow After Fix

```
DHIS2 API Response:
  "105-EP01a. Suspected fever" (raw name)
           ↓
Sanitization Applied:
  "105_EP01a_Suspected_fever" (sanitized)
           ↓
Dataset Metadata:
  column.name = "105_EP01a_Suspected_fever"
  column.verbose_name = "105-EP01a. Suspected fever"
           ↓
Chart FormData:
  x_axis: "OrgUnit"
  metrics: ["SUM(105_EP01a_Suspected_fever)"]
           ↓
Query Results:
  Column names: ["Period", "OrgUnit", "105_EP01a_Suspected_fever", ...]
           ↓
Chart Rendering:
  Data correctly mapped to columns ✓
```

## Files Modified

1. **`/superset/db_engine_specs/dhis2_dialect.py`**
   - Updated `get_name()` to apply sanitization
   - Updated `get_columns()` to use sanitized names in metadata
   - Added `verbose_name` to preserve original display name

2. **`/superset/models/helpers.py`**
   - Added fuzzy column name matching in `assign_column_label()`
   - Matches columns by normalized name when exact match fails

3. **`/superset/connectors/sqla/models.py`**
   - Same fuzzy matching fix applied

4. **`/superset-frontend/src/explore/components/DataTablesPane/components/SamplesPane.tsx`**
   - Added fuzzy matching for frontend data display

## Verification

After these changes, column names should be consistent:

| Stage | Column Name Example |
|-------|-------------------|
| DHIS2 Metadata | `"105-EP01a. Suspected fever"` |
| Dataset Column | `"105_EP01a_Suspected_fever"` |
| Chart Selection | `"105_EP01a_Suspected_fever"` |
| Query Result | `"105_EP01a_Suspected_fever"` |
| Display Name | `"105-EP01a. Suspected fever"` |

## Testing

1. **Restart backend**: `./superset-manager.sh restart`
2. **Refresh dataset**: Delete and re-sync the DHIS2 dataset
3. **Create chart**: Select OrgUnit as X-axis, verify it displays correctly
4. **Check Samples tab**: Verify data values are not undefined

## Known Limitations

- Existing datasets may need to be re-synced to pick up sanitized column names
- Column `verbose_name` is used for display, but `name` is used for data operations

