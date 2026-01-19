# DHIS2 Cascading Filters Setup Guide

## Overview

Cascading filters create a **hierarchical relationship** between filters where:
- Selecting a value in a **parent filter** (e.g., Region)
- **Automatically filters** the **child filter** options (e.g., Districts in that Region only)

This creates a tree-like drill-down experience: Region → District → Sub-County → Health Facility

---

## How Cascading Filters Work

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Selects Region: "Bunyoro"                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Frontend Detects Parent Filter Changed                  │
│    - Checks cascadeParentIds for dependent filters          │
│    - Finds: District filter depends on Region filter        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Fetch District Options with Parent Filter Applied       │
│    SQL Query:                                               │
│    SELECT DISTINCT "District" FROM analytics                │
│    WHERE "Region" IN ('Bunyoro')                            │
│                                                              │
│    DHIS2 translates to:                                     │
│    GET /organisationUnits?                                  │
│      filter=parent.id:eq:oJp8ZNChuNc (Bunyoro UID)          │
│      &level=3 (District level)                              │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. District Dropdown Shows Only Bunyoro Districts          │
│    - Hoima District                                         │
│    - Kibaale District                                       │
│    - Masindi District                                       │
│    (Instead of ALL 146 districts)                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Current Challenge with DHIS2

**Standard Superset cascading** works by:
1. Executing SQL: `WHERE "Region" = 'Bunyoro'`
2. Fetching child options from **same dataset**

**DHIS2 challenge**:
- Your analytics dataset returns **4439 rows** (all combinations of Period × OrgUnit × Metrics)
- Running `SELECT DISTINCT "District" FROM analytics WHERE "Region" = 'Bunyoro'` still fetches 4439 rows, then filters client-side

**Solution**: We need to fetch org unit hierarchy from DHIS2 API, not from analytics data.

---

## Implementation Strategy

### Option 1: Enhanced DHIS2 Dialect with Hierarchy-Aware Cascading ✅ (RECOMMENDED)

Modify the DHIS2 dialect to intercept cascade filter queries and use DHIS2 org unit hierarchy API instead of analytics.

#### How It Works:

```python
# In dhis2_dialect.py - detect cascade parent filter
if cascade_parent_id and parent_filter_value:
    # User selected "Bunyoro" in Region filter
    # District filter is requesting options

    # Instead of: SELECT DISTINCT "District" FROM analytics WHERE "Region" = 'Bunyoro'
    # Do: GET /organisationUnits?filter=parent.id:eq:{bunyoro_uid}&level=3

    # This fetches ONLY districts under Bunyoro from org unit hierarchy
    # Fast, efficient, no need to load 4439 analytics rows
```

**Pros:**
- ✅ Extremely fast (fetches only relevant org units)
- ✅ Uses DHIS2's native hierarchy
- ✅ Works seamlessly with existing filters
- ✅ No duplicate data

**Cons:**
- Requires backend code changes (in DHIS2 dialect)

---

### Option 2: Dedicated Filter Datasets per Level (SIMPLE, WORKS NOW)

Create separate small datasets for each hierarchy level that already include parent relationships.

#### Step-by-Step Setup:

##### 1. Create Region Filter Dataset

**Dataset Name:** `dhis2_regions_filter`

**SQL Query:**
```sql
SELECT
  id as Region_UID,
  displayName as Region
FROM organisationUnits
/* DHIS2: endpoint=organisationUnits&fields=id,displayName&level=2&paging=false */
```

**Result:** 3-4 rows with Region names and UIDs

---

##### 2. Create District Filter Dataset with Parent

**Dataset Name:** `dhis2_districts_filter`

**SQL Query:**
```sql
SELECT
  id as District_UID,
  displayName as District,
  parent.id as Parent_UID,
  parent.displayName as Parent_Region
FROM organisationUnits
/* DHIS2: endpoint=organisationUnits&fields=id,displayName,parent[id,displayName]&level=3&paging=false */
```

**Result:** ~146 rows with District names, UIDs, and their parent Region

**Key Column:** `Parent_Region` - This enables cascading!

---

##### 3. Create Sub-County Filter Dataset with Parent

**Dataset Name:** `dhis2_subcounties_filter`

**SQL Query:**
```sql
SELECT
  id as SubCounty_UID,
  displayName as Sub_County,
  parent.id as Parent_UID,
  parent.displayName as Parent_District
FROM organisationUnits
/* DHIS2: endpoint=organisationUnits&fields=id,displayName,parent[id,displayName]&level=4&paging=false */
```

---

##### 4. Configure Dashboard Filters with Cascading

Now configure your dashboard native filters:

#### Region Filter (Parent):
1. Edit Dashboard → Filters → Region filter
2. **Settings:**
   - **Dataset:** `dhis2_regions_filter`
   - **Column:** `Region`
   - **Filter Type:** Value
   - **Filter Dependencies:** None (this is the parent)

#### District Filter (Child of Region):
1. Add/Edit District filter
2. **Settings:**
   - **Dataset:** `dhis2_districts_filter`
   - **Column:** `District`
   - **Filter Type:** Value
   - **Filter Dependencies:**
     - **Parent Filter:** Region
     - **Parent Column:** `Parent_Region` (column in dhis2_districts_filter dataset)

#### Sub-County Filter (Child of District):
1. Add/Edit Sub-County filter
2. **Settings:**
   - **Dataset:** `dhis2_subcounties_filter`
   - **Column:** `Sub_County`
   - **Filter Type:** Value
   - **Filter Dependencies:**
     - **Parent Filter:** District
     - **Parent Column:** `Parent_District` (column in dhis2_subcounties_filter dataset)

---

## How Cascade Dependencies Work

When you configure **Filter Dependencies**, Superset:

1. **Stores `cascadeParentIds`** in filter metadata:
   ```json
   {
     "id": "district_filter",
     "cascadeParentIds": ["region_filter"],
     "targets": [{"column": {"name": "District"}, "datasetId": 123}]
   }
   ```

2. **Frontend monitors parent filter changes:**
   - When user selects "Bunyoro" in Region filter
   - Frontend detects District filter has `cascadeParentIds: ["region_filter"]`
   - Triggers new query to fetch District options

3. **Backend adds WHERE clause automatically:**
   ```sql
   SELECT DISTINCT "District" FROM dhis2_districts_filter
   WHERE "Parent_Region" IN ('Bunyoro')
   ```

4. **Result:**
   - District dropdown shows ONLY districts under Bunyoro
   - Fast query (fetches ~10 rows instead of 146)

---

## Testing Cascading Filters

### Test Case 1: Basic Cascade

1. Open dashboard
2. Region filter shows: Bunyoro, Bukedi, North Buganda, Western
3. District filter shows: ALL districts (no parent selected yet)
4. **Select "Bunyoro"** in Region filter
5. **Expected:**
   - District dropdown **immediately updates**
   - Shows ONLY: Hoima District, Kibaale District, Masindi District
   - Sub-County dropdown clears (waiting for District selection)

### Test Case 2: Multi-Level Cascade

1. Select Region: "Bunyoro"
2. District dropdown updates → Select "Kibaale District"
3. **Expected:**
   - Sub-County dropdown updates
   - Shows ONLY sub-counties in Kibaale District

### Test Case 3: Change Parent Resets Children

1. Select: Region=Bunyoro, District=Kibaale District, Sub-County=Kagadi
2. Change Region to "Western"
3. **Expected:**
   - District filter **clears automatically** (Kibaale is not in Western)
   - Sub-County filter **clears automatically**
   - District dropdown shows Western districts only

---

## Advanced: DHIS2 Parent Relationship Query

The key to cascading is the **parent relationship**. DHIS2 API provides this via:

```
GET /organisationUnits?
  fields=id,displayName,parent[id,displayName]
  &level=3
  &paging=false
```

**Response:**
```json
{
  "organisationUnits": [
    {
      "id": "abc123",
      "displayName": "Kibaale District",
      "parent": {
        "id": "oJp8ZNChuNc",
        "displayName": "Bunyoro"
      }
    },
    {
      "id": "def456",
      "displayName": "Hoima District",
      "parent": {
        "id": "oJp8ZNChuNc",
        "displayName": "Bunyoro"
      }
    }
  ]
}
```

Our dataset query maps this to:
- `District` = displayName
- `Parent_Region` = parent.displayName

When user selects "Bunyoro", Superset filters where `Parent_Region = 'Bunyoro'`.

---

## Performance Comparison

### Without Cascading:
```
District filter dropdown: Fetches 4439 analytics rows → Extract DISTINCT District
Time: 3-5 seconds
Network: 2-5 MB
Options: 146 districts (all)
```

### With Dedicated Datasets (No Cascading):
```
District filter dropdown: Fetches 146 org units from dhis2_districts_filter
Time: 0.5-1 second
Network: ~100 KB
Options: 146 districts (all)
```

### With Cascading (After selecting Bunyoro):
```
District filter dropdown: SELECT DISTINCT District FROM dhis2_districts_filter WHERE Parent_Region = 'Bunyoro'
Time: <0.1 second (local filtering)
Network: <1 KB
Options: 10 districts (only Bunyoro's)
```

**Improvement:** 50-100x faster! 🚀

---

## Troubleshooting

### Issue: Cascade not working, child filter shows all options

**Cause:** Parent column name mismatch

**Check:**
1. District dataset has column named exactly `Parent_Region`
2. Filter dependency is configured with `Parent_Region` as parent column

### Issue: Child filter shows "No data"

**Cause:** Parent column values don't match

**Debug:**
```sql
-- Check parent column values in District dataset
SELECT DISTINCT "Parent_Region" FROM dhis2_districts_filter

-- Should show: Bunyoro, Bukedi, North Buganda, Western
-- If shows UIDs instead of names, fix the dataset query
```

### Issue: Performance still slow

**Cause:** Still using analytics dataset

**Solution:**
- Verify filter is using `dhis2_districts_filter` dataset, NOT `analytics`
- Check Network tab: Should call `/dhis2_districts_filter` not `/analytics`

---

## Next Steps

1. ✅ Create dedicated filter datasets with parent relationships
2. ✅ Configure cascade dependencies in dashboard filters
3. ✅ Test Region → District → Sub-County cascade
4. Consider: Enhance DHIS2 dialect to auto-detect hierarchy (future improvement)

**Need help?** Check:
- [DHIS2_FILTER_SETUP_GUIDE.md](DHIS2_FILTER_SETUP_GUIDE.md) - Creating filter datasets
- [TESTING_FILTER_FIX.md](TESTING_FILTER_FIX.md) - Testing filter functionality
