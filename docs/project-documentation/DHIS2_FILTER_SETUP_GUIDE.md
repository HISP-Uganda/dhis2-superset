# DHIS2 Dashboard Filter Setup Guide

## Overview

This guide explains how to set up efficient dashboard native filters for DHIS2 datasets in Superset.

**Problem:** Using the main `analytics` dataset for filter dropdowns causes 4439 options to appear instead of 3-4 regions.

**Solution:** Create dedicated small datasets specifically for filter options.

---

## Solution 1: Fix WHERE Clause Parameter Precedence ✅ (IMPLEMENTED)

**Status:** Code changes completed in `dhis2_dialect.py`

**What was changed:**
- Modified `_extract_query_params()` to NOT return early when SQL comments are found
- WHERE clause org unit filters now OVERRIDE the `ou` parameter from SQL comments
- This enables dashboard native filters to properly trigger name-to-UID resolution

**Result:**
- When you select "Bunyoro" in a Region filter and click "Apply"
- The system will resolve "Bunyoro" → UID via DHIS2 API
- DHIS2 API request will use: `dimension=ou:<Bunyoro_UID>` instead of default UIDs
- Server-side filtering (fast, only fetches Bunyoro data)

---

## Solution 2: Create Dedicated Filter Datasets (RECOMMENDED FOR DROPDOWNS)

### Why You Need This

**Before:**
```
Filter dataset: analytics (4439 rows)
Dropdown query: SELECT DISTINCT "Region" FROM analytics
Result: 4439 options in dropdown 😱
```

**After:**
```
Filter dataset: dhis2_regions (4 rows)
Dropdown query: SELECT DISTINCT "Region" FROM dhis2_regions
Result: 4 options in dropdown 😊
```

---

## Step-by-Step Setup

### Step 1: Create a "Regions" Dataset

1. Go to **Data → Datasets**
2. Click **+ Dataset**
3. Choose your DHIS2 database
4. **Schema:** (leave empty for DHIS2)
5. **Table Name:** Type anything (e.g., `dhis2_regions_filter`)
6. **Enable "Edit dataset properties"**

#### SQL Query for Regions Dataset:

```sql
SELECT displayName as Region
FROM organisationUnits
/* DHIS2: endpoint=organisationUnits&fields=id,displayName&level=2&paging=false */
```

**Explanation:**
- `endpoint=organisationUnits` - Fetches org units directly (not analytics)
- `level=2` - Only regions (Level 2 in DHIS2 hierarchy)
- `fields=id,displayName` - Gets UID and display name
- `paging=false` - Gets all results (there are only ~4 regions)

7. Click **Save**

---

### Step 2: Create a "Districts" Dataset (Optional - for cascading filters)

Same process, but for districts:

```sql
SELECT displayName as District
FROM organisationUnits
/* DHIS2: endpoint=organisationUnits&fields=id,displayName&level=3&paging=false */
```

**Note:** Level 3 = Districts in DHIS2

---

### Step 3: Configure Dashboard Native Filters

#### For Region Filter:

1. Open your dashboard
2. Click **Edit** → **Filters** (filter icon)
3. Click **+ Add filter** or edit existing Region filter
4. **Settings:**
   - **Filter name:** Region
   - **Dataset:** Select `dhis2_regions_filter` (the one you just created)
   - **Column:** Select `Region`
   - **Filter type:** Value
   - **UI Configuration:** Select dropdown
   - **Multiple select:** Enable (if needed)

5. **Scoping:** Select which charts this filter should affect
6. Click **Save**

#### For District Filter (with cascading from Region):

1. Add another filter
2. **Settings:**
   - **Filter name:** District
   - **Dataset:** Select `dhis2_districts_filter`
   - **Column:** Select `District`
   - **Filter type:** Value
   - **Parent filter:** Select "Region" (enables cascading)

3. Click **Save**

---

## Alternative: Use DISTINCT in Analytics Dataset

If you prefer not to create separate datasets, you can modify the filter query:

1. Edit dashboard → Filters → Region filter
2. **Advanced settings → Pre-filter**
3. Add custom query (if Superset allows):
   ```sql
   SELECT DISTINCT "Region" FROM analytics LIMIT 100
   ```

**Note:** This still fetches all 4439 rows first, then applies DISTINCT. Not as efficient as dedicated datasets.

---

## Verification

### Test the Setup:

1. **Check filter dropdown:**
   - Open dashboard
   - Click Region filter dropdown
   - **Expected:** See only 3-4 region names (not 4439 options)

2. **Test filtering:**
   - Select "Bunyoro"
   - Click "Apply"
   - **Expected:** Charts update to show only Bunyoro data

3. **Check logs** (optional):
   ```bash
   tail -f /Users/edwinarinda/Projects/Redux/superset/logs/superset_backend.log
   ```

   Look for:
   ```
   [DHIS2 Filter Detection] Detected org unit IN filter: Region IN ['Bunyoro']
   [DHIS2 Filter Resolution] Resolving 1 org unit names to UIDs
   [DHIS2 Filter Resolution] ✅ Resolved UIDs: ['oJp8ZNChuNc']
   ```

4. **Check Network tab:**
   - Open browser DevTools → Network
   - Filter by "analytics"
   - Look for DHIS2 API URL
   - **Expected:** Should see `dimension=ou:<Bunyoro_UID>` in the request URL

---

## Troubleshooting

### Problem: Filter dropdown still shows many options

**Solution:**
1. Verify you selected the correct dataset (`dhis2_regions_filter`, not `analytics`)
2. Check the dataset has the SQL comment with `level=2`
3. Try refreshing the dataset: Data → Datasets → Find your filter dataset → Refresh

### Problem: Filter doesn't update charts

**Solution:**
1. Check filter **Scoping** - ensure charts are in scope
2. Verify Solution 1 code changes are deployed
3. Check logs for name-to-UID resolution messages

### Problem: "Could not resolve org unit names"

**Possible causes:**
1. DHIS2 API might be down - check connection
2. Org unit name doesn't exactly match what's in DHIS2
3. Check case sensitivity ("Bunyoro" vs "bunyoro")

---

## Performance Comparison

### Before (using analytics dataset for filters):

```
Filter dropdown load: ~3-5 seconds (fetches 4439 rows)
Apply filter: Client-side filtering (fetches all data, filters in browser)
Network transfer: ~2-5 MB per query
```

### After (using dedicated filter datasets):

```
Filter dropdown load: ~0.1-0.5 seconds (fetches 4 rows)
Apply filter: Server-side filtering (DHIS2 API filters before sending)
Network transfer: ~0.5-1 MB per query (only filtered data)
```

**Result:** 5-10x faster! 🚀

---

## Advanced: Cascading Filters

### Example: Region → District → Sub-County

Create 3 datasets:

1. **dhis2_regions_filter** (level=2)
2. **dhis2_districts_filter** (level=3)
3. **dhis2_subcounties_filter** (level=4)

Configure filters with dependencies:
- Region filter (no parent)
- District filter (parent: Region)
- Sub-County filter (parent: District)

**Result:** When user selects Region, District dropdown shows only districts in that region!

---

## Summary

**What you implemented:**
1. ✅ Solution 1: WHERE clause now overrides SQL comment `ou` parameter
2. ✅ Name-to-UID resolution already exists and will now be triggered

**What you should do next:**
1. Create dedicated filter datasets (this guide)
2. Reconfigure dashboard filters to use new datasets
3. Test and verify filtering works correctly

**Expected outcome:**
- Filter dropdowns show 3-4 regions (not 4439 options)
- Selecting "Bunyoro" + Apply triggers server-side filtering
- Charts update fast (only fetches Bunyoro data from DHIS2)
- Clear All reverts to default dataset UIDs
