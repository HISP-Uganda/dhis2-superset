# Period Column Fix - Chart X-Axis Issue

## ✅ Problem Identified

**Charts were forcing Period as the X-axis even when other columns were selected.**

The issue was that Period was marked as `groupby=True`, making it appear as a selectable dimension in the chart builder. Since it was the first column in the data, Superset would default to using it as the X-axis.

## ✅ Solution Applied

### 1. Backend Metadata Discovery
**File**: `superset/db_engine_specs/dhis2_dialect.py` (line 944)

Changed Period from:
```python
"groupby": True,
```

To:
```python
"groupby": False,
```

This prevents Period from appearing as a selectable dimension in charts. It remains **filterable** (can filter by period), but cannot be used as a grouping dimension.

### 2. Database Migration Updated
**File**: `superset/migrations/versions/2025-12-03_16-30_dhis2_categorical_fix.py`

Added a new step to mark Period columns as non-groupable:
```python
UPDATE table_columns 
SET groupby = 0 
WHERE table_id = :dataset_id 
AND LOWER(column_name) IN ('period', 'pe')
```

### 3. Immediate Database Fix Applied
Manually updated existing Period column:
```sql
UPDATE table_columns SET groupby = 0 WHERE table_id = 1 AND column_name = 'Period';
```

## ✅ Verification

Current Period column status:
```
id | column_name | is_dttm | groupby
1  | Period      | 0       | 0       ← Non-temporal, Non-groupable ✅
```

## 🎯 Expected Results After Fix

✅ **Period will NOT appear** as a selectable dimension in Chart Options  
✅ **OrgUnit will be the first available** dimension for charting  
✅ **Data elements will be available** as dimensions and metrics  
✅ **Charts won't default to Period as X-axis**  
✅ **Period can still be used for filtering** the data  

## 🚀 How to Apply

1. **Restart Superset** (this loads the new metadata discovery settings)
   ```bash
   ./superset-manager.sh
   ```

2. **Refresh Table Metadata** (optional but recommended)
   - Admin → Databases → Select DHIS2 → Refresh Metadata
   - This re-reads columns and applies groupby=0 to Period

3. **Create a new chart**
   - Period should NOT appear in the dimension/groupby options
   - OrgUnit and data elements should be available

## 📋 Files Modified

| File | Change | Lines |
|------|--------|-------|
| `superset/db_engine_specs/dhis2_dialect.py` | Set Period `groupby: False` | 944 |
| `superset/migrations/versions/2025-12-03_16-30_dhis2_categorical_fix.py` | Mark Period as non-groupable | 131-156 |
| Database | Set Period `groupby = 0` | (manual SQL) |

## ✨ Column Behavior After Fix

| Column | is_dttm | groupby | Can Group? | Can Filter? | Can Use as Metric? |
|--------|---------|---------|-----------|------------|-------------------|
| Period | 0       | 0       | ❌ No     | ✅ Yes    | ✅ Yes (COUNT)   |
| OrgUnit | 0      | 1       | ✅ Yes    | ✅ Yes    | ✅ Yes (COUNT)   |
| Data Elements | 0 | 1       | ✅ Yes    | ✅ Yes    | ✅ Yes (SUM, AVG) |

## 🐛 Troubleshooting

**Period still appears in dimensions?**
- Refresh metadata: Admin → Databases → DHIS2 → Refresh Metadata
- Or restart: `pkill -f superset && ./superset-manager.sh`

**Can't filter by Period?**
- Filter should still work via Filters panel (not grouping)
- Try adding a filter: Filters → Add Filter → Period

**Need old behavior back?**
- Run migration downgrade
- Or manually: `UPDATE table_columns SET groupby=1 WHERE column_name='Period'`

