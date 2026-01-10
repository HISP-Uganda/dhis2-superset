# DHIS2 Column Sanitization Migration Guide

## Overview

This guide explains how to migrate existing DHIS2 datasets and charts to the new improved column sanitization approach. The migration ensures all column names are consistent across Charts, Maps, and Tables.

## What Changed

### Before (Old Approach)
```typescript
// Old sanitization used a different regex pattern
'105-EP01b. Malaria Total' → Various possible results depending on implementation
```

### After (New Approach)
```typescript
// New sanitization is consistent with backend
'105-EP01b. Malaria Total' → '105_EP01b_Malaria_Total'
```

**Key improvement**: Frontend and backend now use identical sanitization logic.

---

## Migration Strategy

### Phase 1: Database Migration (Automatic)

When you upgrade, two migrations run automatically:

#### 1. `sanitize_dhis2_columns` (Already Applied)
Updates all column names in DHIS2 datasets to use the new sanitization:
- Original names preserved in `verbose_name` field for UI display
- Actual column references updated in `column_name` field
- No data loss - just column name normalization

#### 2. `update_dhis2_chart_columns` (New)
Updates existing chart/map configurations:
- Updates `metric` column references in chart form_data
- Updates `org_unit_column` references for maps
- Updates `tooltip_columns` for all visualization types
- Preserves chart functionality while using new column names

### Phase 2: Backward Compatibility (Runtime)

Even before migration, existing charts work through the compatibility layer:
- Frontend resolves old column names to new names at runtime
- Works with both old and new column name formats
- No manual intervention needed
- Charts continue working during gradual migration

---

## How to Update Existing Datasets

### Option 1: Automatic Migration (Recommended)

Just run database migrations - everything updates automatically:

```bash
# In your Superset environment
superset db upgrade

# This runs both migration files automatically
```

**What happens:**
- ✅ All DHIS2 dataset columns are sanitized
- ✅ All chart form_data is updated
- ✅ No data is lost or modified
- ✅ Charts continue to work

### Option 2: Manual Update (If Needed)

If you need to manually update a specific chart:

1. Open the chart in edit mode
2. Reselect the metric column
3. Reselect the org unit column (for maps)
4. Reselect tooltip columns
5. Save the chart

The frontend automatically sanitizes the column names when saving.

---

## Implementation Details

### Frontend Sanitization

Located in: `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/sanitize.ts`

#### Main Functions

```typescript
// Sanitize a single column name
sanitizeDHIS2ColumnName("105-EP01b. Malaria Total")
// Returns: "105_EP01b_Malaria_Total"

// Find original column name from sanitized reference
findOriginalColumnName("105_EP01b_Malaria_Total", availableColumns)
// Returns: "105_EP01b_Malaria_Total" or original if different

// Match metric expressions with aggregation functions
findMetricColumn("SUM(105-EP01b. Malaria Total)", availableColumns)
// Returns: "105_EP01b_Malaria_Total"
```

#### Compatibility Layer

Located in: `superset-frontend/src/visualizations/DHIS2Map/columnCompatibility.ts`

```typescript
// Resolve column name (handles both old and new formats)
resolveColumnName("old-column-ref", availableColumns)
// Returns: matching column from actual data

// Resolve array of column names
resolveColumnNames(["col1", "col-2"], availableColumns)
// Returns: array of resolved names
```

### Backend Sanitization

Located in: `superset/db_engine_specs/dhis2_dialect.py`

```python
def sanitize_dhis2_column_name(name: str) -> str:
    """Matches frontend logic exactly"""
    name = re.sub(r'[^\w]', '_', name)      # Replace non-word chars
    name = re.sub(r'_+', '_', name)         # Collapse underscores
    name = name.strip('_')                  # Strip edges
    return name
```

---

## Column Resolution Strategy

The system uses a multi-strategy approach to resolve column names:

### Strategy 1: Exact Match
```
Chart has: "105_EP01b_Malaria_Total"
Data has: "105_EP01b_Malaria_Total"
✅ Perfect match - use as is
```

### Strategy 2: Sanitized Match
```
Chart has: "105-EP01b. Malaria Total" (old reference)
Data has: "105_EP01b_Malaria_Total" (new name)
✅ Sanitize old reference → matches new name
```

### Strategy 3: Reverse Lookup
```
Chart has: "Malaria Total"
Data has: "105_EP01b_Malaria_Total"
✅ Find column that sanitizes to "Malaria_Total"
```

### Strategy 4: Aggregation Extraction
```
Chart has: "SUM(105-EP01b. Malaria Total)"
Data has: "105_EP01b_Malaria_Total"
✅ Extract inner column, sanitize, then match
```

### Strategy 5: Partial Match
```
Chart has: "Malaria"
Data has: ["Region", "105_EP01b_Malaria_Total", ...]
✅ Find column containing sanitized metric name
```

---

## Testing the Migration

### Check Migration Status

```bash
# Connect to Superset database
mysql superset  # or psql superset

# Check that datasets have sanitized columns
SELECT table_name, column_name, verbose_name 
FROM table_columns 
WHERE table_id IN (
  SELECT id FROM tables 
  WHERE database_id IN (
    SELECT id FROM dbs WHERE database_name LIKE '%DHIS2%'
  )
);

# Check that chart params are updated
SELECT id, params 
FROM slices 
WHERE viz_type IN ('dhis2_map', 'dhis2_table')
LIMIT 5;
```

### Verify Charts Still Work

1. Open each DHIS2 chart in Superset
2. Verify data loads correctly
3. Check that visualizations render
4. Verify filters and interactions work
5. Verify tooltips and labels display correctly

---

## Troubleshooting

### Chart Shows No Data

**Cause**: Column reference doesn't match actual data column

**Solution**:
1. Check browser console for column resolution warnings
2. Open chart in edit mode
3. Reselect metric column from dropdown
4. Save chart

### Column Names Look Strange

**Cause**: Sanitization hasn't been applied yet or display name mismatch

**Solution**:
1. Run migration: `superset db upgrade`
2. Clear browser cache
3. Refresh page

### Migration Didn't Run

**Cause**: Migration might have skipped if tables don't exist

**Solution**:
1. Check database migration status: `superset db current`
2. Manually run: `superset db upgrade --head`
3. Check logs for errors

### Old Charts Break After Migration

**Cause**: Backward compatibility layer should handle this

**Solution**:
1. Check browser console for column resolution issues
2. Open chart and manually update column references
3. Test with both old and new column name formats

---

## Best Practices

### After Migration

✅ **Do:**
- Use the new sanitized column names in new charts
- Leverage the improved `findMetricColumn` function for matching
- Reference this guide when creating new DHIS2 datasets

❌ **Don't:**
- Manually change column names in database
- Mix old and new naming conventions
- Downgrade migrations without backing up data

### For Dataset Creators

When creating new DHIS2 datasets:
1. Use the built-in DHIS2 Dataset Wizard
2. Let the wizard handle column sanitization
3. Verify column names are sanitized in preview
4. Test chart creation with new dataset

---

## Rollback (If Needed)

**WARNING**: Rollback is not recommended as it may break existing charts.

If you must rollback:

```bash
# Get current migration version
superset db current

# Downgrade to previous version (use with caution)
superset db downgrade sanitize_dhis2_columns
```

**Note**: This will revert column names but won't fix chart references.

---

## Performance Impact

- ✅ Negligible: Sanitization is regex-based (< 1ms per column)
- ✅ Caching: Column mappings are cached in frontend
- ✅ No data movement: Only metadata updates

---

## Support

If you encounter issues with the migration:

1. Check the logs: `superset logs | grep -i dhis2`
2. Review console errors: Browser DevTools → Console
3. Check database: Verify columns were sanitized
4. Test manually: Try recreating a chart from scratch

---

## Version Information

- **Implementation**: December 2025
- **Frontend**: React/TypeScript with comprehensive tests
- **Backend**: Python with Alembic migrations
- **Compatibility**: Full backward compatibility maintained

---

## References

- Frontend sanitization: `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/sanitize.ts`
- Backend dialect: `superset/db_engine_specs/dhis2_dialect.py`
- Chart migration: `superset/migrations/versions/2025-12-17_update_dhis2_chart_columns.py`
- Compatibility layer: `superset-frontend/src/visualizations/DHIS2Map/columnCompatibility.ts`
- Tests: `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/sanitize.test.ts`
