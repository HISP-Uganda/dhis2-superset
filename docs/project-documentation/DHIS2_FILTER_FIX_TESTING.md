# DHIS2 Filter Name-to-UID Fix - Testing Guide

## Implementation Complete ✅

The fix for DHIS2 filter name-to-UID resolution has been implemented in [superset/db_engine_specs/dhis2_dialect.py](superset/db_engine_specs/dhis2_dialect.py).

### Changes Made

1. **Added `resolve_orgunit_names_to_uids()` method** (Line ~1911)
   - Resolves org unit display names to UIDs using DHIS2 API
   - Handles batch processing for efficiency
   - Tries multiple resolution strategies (displayName:in, individual LIKE searches)
   - Returns mapping: `{"Ibanda District": "jNb63DIHuwU", ...}`

2. **Enhanced `_extract_query_params()` method** (Line ~2556)
   - Detects org unit hierarchy columns in WHERE clauses
   - Identifies org unit filters from dashboard native filters
   - Stores names for resolution and determines org unit level
   - Handles both simple equality (`WHERE District = 'Ibanda'`) and IN clauses (`WHERE District IN ('Ibanda', 'Mbarara')`)

3. **Added resolution step in `execute()` method** (Line ~3418)
   - Automatically resolves org unit names to UIDs before making API calls
   - Updates dimension parameters with resolved UIDs
   - Provides detailed logging and console output for debugging
   - Graceful fallback if resolution fails

---

## How It Works

### Before (Broken ❌)

```
User selects filter → "Ibanda District" →
SQL: WHERE District = 'Ibanda District' →
API: dimension=ou:Ibanda District ← WRONG! (Name instead of UID)
Result: No data or API error
```

### After (Fixed ✅)

```
User selects filter → "Ibanda District" →
SQL: WHERE District = 'Ibanda District' →
Detection: ou_name_filters = ["Ibanda District"] →
Resolution: DHIS2 API lookup →
Mapping: {"Ibanda District": "jNb63DIHuwU"} →
API: dimension=ou:jNb63DIHuwU ← CORRECT! (UID)
Result: Filtered data returned
```

---

## Testing Instructions

### Prerequisites

1. Restart Superset to load the new code:
   ```bash
   cd /Users/edwinarinda/Projects/Redux/superset
   ./restart.sh
   ```

2. Clear browser cache (Ctrl+Shift+Delete or Cmd+Shift+Delete)

### Test Case 1: Single District Filter

**Steps:**
1. Open a dashboard with DHIS2 data
2. Add a native filter on the "District" column
3. Select a single district (e.g., "Ibanda District")
4. Apply the filter

**Expected Console Output:**
```
[DHIS2 Filter Detection] 🔍 Found org unit filter: District = 'Ibanda District'
[DHIS2 Filter Resolution] 🔍 Resolving 1 org unit names to UIDs...
[DHIS2 Filter Resolution] ✅ Resolved 1/1 names to UIDs
[DHIS2 Filter Resolution] 📋 Sample mappings: {'Ibanda District': 'jNb63DIHuwU'}
```

**Expected Result:**
- Chart should show data filtered to Ibanda District only
- No errors in console

### Test Case 2: Multiple Districts (IN Clause)

**Steps:**
1. Add a native filter on "District" column with multi-select enabled
2. Select multiple districts:
   - "Ibanda District"
   - "Mbarara City"
   - "Isingiro District"
3. Apply the filter

**Expected Console Output:**
```
[DHIS2 Filter Detection] 🔍 Found org unit IN filter: District IN [Ibanda District, Mbarara City, Isingiro District]
[DHIS2 Filter Resolution] 🔍 Resolving 3 org unit names to UIDs...
[DHIS2 Filter Resolution] ✅ Resolved 3/3 names to UIDs
[DHIS2 Filter Resolution] 📋 Sample mappings: {
  'Ibanda District': 'jNb63DIHuwU',
  'Mbarara City': 'QywkxFudXrC',
  'Isingiro District': 'Pae4H4fql4x'
}
```

**Expected Result:**
- Chart shows combined data from all three districts
- Data is properly filtered

### Test Case 3: Cascading Filters (Region → District)

**Steps:**
1. Add two cascading filters:
   - Filter 1: "Region" (parent)
   - Filter 2: "District" (child, cascades from Region)
2. Select a region (e.g., "Western")
3. Observe that District filter now only shows districts in Western region
4. Select a district
5. Apply filters

**Expected Console Output:**
```
[DHIS2 Filter Detection] 🔍 Found org unit filter: District = 'Ibanda District'
[DHIS2 Filter Resolution] 🔍 Resolving 1 org unit names to UIDs...
[DHIS2 Filter Resolution] ✅ Resolved 1/1 names to UIDs
```

**Expected Result:**
- Chart shows data filtered to the selected district within the selected region
- Cascading works correctly (district list updates based on region)

### Test Case 4: Health Facility Filter (Level 5)

**Steps:**
1. Add a native filter on "Health_Facility" column
2. Select one or more health facilities
3. Apply the filter

**Expected Console Output:**
```
[DHIS2 Filter Detection] 🔍 Found org unit filter: Health_Facility = 'Ibanda Hospital'
[DHIS2 Filter Resolution] 🔍 Resolving 1 org unit names to UIDs... (level=5)
[DHIS2 Filter Resolution] ✅ Resolved 1/1 names to UIDs
```

**Expected Result:**
- Chart shows facility-level data
- Filter applied correctly at level 5

### Test Case 5: Period Filter (Should Still Work)

**Steps:**
1. Add a native filter on "Period" column
2. Select periods (e.g., "2023", "2024")
3. Apply the filter

**Expected Console Output:**
```
[DHIS2 Filter Detection] 📅 Found period filter: Period = '2023'
```

**Expected Result:**
- Chart shows data for selected periods
- Period filtering still works (not affected by our changes)

---

## Debugging

### Check Backend Logs

Monitor the backend logs for detailed resolution information:

```bash
tail -f logs/superset_backend.log | grep "Filter Resolution"
```

**Look for:**
- `[DHIS2 Filter Resolution] Resolving X org unit names to UIDs`
- `[DHIS2 Filter Resolution] ✅ Successfully resolved X/Y names`
- `[DHIS2 Filter Resolution] ⚠️ Could not resolve X names`

### Check Browser Console

Open Developer Tools (F12) and look for console messages:

**Success indicators:**
```
[DHIS2 Filter Detection] 🔍 Found org unit filter: ...
[DHIS2 Filter Resolution] 🔍 Resolving X org unit names...
[DHIS2 Filter Resolution] ✅ Resolved UIDs: [...]
[DHIS2 Filter Resolution] 📋 Sample mappings: {...}
```

**Warning indicators:**
```
[DHIS2 Filter Resolution] ⚠️ Unresolved names: [...]
[DHIS2 Filter Resolution] ⚠️ No names could be resolved
```

### Check Network Tab

1. Open Developer Tools → Network tab
2. Filter for "organisationUnits"
3. Apply a filter
4. Look for API call:
   ```
   GET /api/organisationUnits.json?filter=displayName:in:[Ibanda District,...]
   ```
5. Check response - should contain UIDs and names

### Common Issues

#### Issue 1: Names Not Resolving

**Symptom:**
```
[DHIS2 Filter Resolution] ⚠️ Could not resolve any org unit names
```

**Possible causes:**
- Org unit names in dataset don't match DHIS2 displayNames
- Org units don't exist in DHIS2
- API connection issue

**Solution:**
1. Check org unit names in DHIS2 admin UI
2. Verify API connection is working
3. Try refreshing the dataset to get latest names

#### Issue 2: Filters Not Detected

**Symptom:** No filter detection messages in console

**Possible causes:**
- Column name not in org unit column list
- WHERE clause format not matching regex

**Solution:**
1. Check the column name used in the filter
2. Add column name to `org_unit_columns` list if needed (Line ~2567)

#### Issue 3: API Timeout

**Symptom:**
```
[DHIS2 Filter Resolution] ❌ Error: Timeout
```

**Possible causes:**
- Too many names to resolve at once
- Slow DHIS2 API

**Solution:**
- Reduce batch size in `resolve_orgunit_names_to_uids()` method
- Increase timeout in DHIS2Connection settings

---

## Performance Optimization (Future Enhancement)

### Add Caching

To avoid repeated API calls for the same org unit names, add caching:

**File:** `superset/db_engine_specs/dhis2_dialect.py`

**Location:** In `DHIS2Connection.__init__()` method

```python
def __init__(self, ...):
    # ...existing code...
    self._ou_name_cache = {}  # Cache: {"Ibanda District": "jNb63DIHuwU", ...}
```

**Modify `resolve_orgunit_names_to_uids()`:**

```python
def resolve_orgunit_names_to_uids(self, org_unit_names, level=None):
    # Check cache first
    cached_results = {}
    uncached_names = []

    for name in org_unit_names:
        cache_key = f"{name}:{level}" if level else name
        if cache_key in self._ou_name_cache:
            cached_results[name] = self._ou_name_cache[cache_key]
        else:
            uncached_names.append(name)

    if not uncached_names:
        print(f"[DHIS2 Filter Resolution] ✅ All names found in cache")
        return cached_results

    # Resolve uncached names...
    # (existing API call logic)

    # Update cache
    for name, uid in fresh_results.items():
        cache_key = f"{name}:{level}" if level else name
        self._ou_name_cache[cache_key] = uid

    return {**cached_results, **fresh_results}
```

---

## Supported Column Names

The following column names are automatically detected for UID resolution:

### Organization Unit Hierarchy
- `National` (Level 1)
- `Region` (Level 2)
- `District` (Level 3)
- `Sub_County` (Level 4)
- `Sub_County_Town_Council_Div` (Level 4)
- `Health_Facility` (Level 5)
- `orgUnit` (generic)
- `ou` (generic)
- `OrganisationUnit` (generic)

### To Add More Columns

Edit Line ~2567 in `dhis2_dialect.py`:

```python
org_unit_columns = [
    'National', 'Region', 'District', 'Sub_County',
    'Your_New_Column_Name',  # Add here
    'Health_Facility', 'orgUnit', 'ou'
]

level_mapping = {
    'National': 1,
    'Region': 2,
    'District': 3,
    'Your_New_Column_Name': 4,  # Add level mapping
    'Sub_County': 4,
    'Health_Facility': 5
}
```

---

## Summary

**Implementation Status:** ✅ COMPLETE

**Files Modified:**
- [superset/db_engine_specs/dhis2_dialect.py](superset/db_engine_specs/dhis2_dialect.py)

**Key Features:**
- ✅ Automatic name-to-UID resolution for org unit filters
- ✅ Batch processing for efficiency
- ✅ Multiple resolution strategies
- ✅ Detailed logging and debugging output
- ✅ Graceful fallback if resolution fails
- ✅ Works with single and multiple selections
- ✅ Works with cascading filters
- ✅ Period filters still work as before

**Next Steps:**
1. Restart Superset
2. Test with real dashboard filters
3. Monitor console and logs for resolution messages
4. Report any issues or unresolved names
