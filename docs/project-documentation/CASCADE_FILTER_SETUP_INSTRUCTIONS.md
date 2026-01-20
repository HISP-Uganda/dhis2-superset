# How to Set Up Cascade Filters in Superset Dashboard

## Problem
Your filters are showing all 4439 options and loading slowly because they're not configured as cascade filters.

---

## Solution: Configure Cascade Filters Properly

### Step 1: Edit Dashboard in Superset UI

1. Go to your dashboard
2. Click **Edit Dashboard** (top right)
3. Click on the **Filter** icon in the left sidebar

### Step 2: Configure Region Filter (Parent)

1. Select the **Region** filter
2. In the filter settings:
   - **Filter name:** Region
   - **Dataset:** Your DHIS2 dataset
   - **Column:** Region
   - **Filter Type:** Select filter
   - **Default value:** (leave empty or set default)

3. **Important:** Note the filter ID (e.g., `NATIVE_FILTER-xxx`)

### Step 3: Configure District Filter (Child of Region)

1. Select the **District** filter
2. In the filter settings:
   - **Filter name:** District
   - **Dataset:** Your DHIS2 dataset
   - **Column:** District
   - **Filter Type:** Select filter

3. **Enable Parent Filter:**
   - Scroll to **"Parent filter"** section
   - Click **"+ Add parent filter"**
   - Select: **Region** (the parent filter)
   - **Parent Column:** Region

4. This tells Superset: "District options should be filtered based on Region selection"

### Step 4: Configure SubCounty Filter (Child of District)

1. Select the **SubCounty** filter
2. In the filter settings:
   - **Filter name:** SubCounty
   - **Dataset:** Your DHIS2 dataset
   - **Column:** Sub_County_Town_Council_Div (or your SubCounty column)
   - **Filter Type:** Select filter

3. **Enable Parent Filter:**
   - Scroll to **"Parent filter"** section
   - Click **"+ Add parent filter"**
   - Select: **District** (the parent filter)
   - **Parent Column:** District

### Step 5: Save Dashboard

1. Click **Save** in the filter panel
2. Click **Save** on the dashboard
3. Test the cascade:
   - Select a Region → District should only show districts in that region
   - Select a District → SubCounty should only show subcounties in that district

---

## How It Works (Behind the Scenes)

When you configure cascade filters in Superset:

1. **User selects "Bunyoro" in Region filter**

2. **Superset sends API request for District options:**
   ```
   GET /api/v1/datasource/1/column/District/values/
   ?cascade_parent_column=Region
   &cascade_parent_value=Bunyoro
   ```

3. **Our backend code (datasource/api.py) receives this:**
   ```python
   [Cascade API] 🔍 REQUEST: column=District,
                              parent_column=Region,
                              parent_values=Bunyoro
   ```

4. **Stores cascade params in Flask g:**
   ```python
   g.dhis2_cascade_parent_column = 'Region'
   g.dhis2_cascade_parent_value = 'Bunyoro'
   ```

5. **DHIS2 dialect (dhis2_dialect.py) detects cascade:**
   ```python
   [DHIS2 Cascade] Detected cascade request: parent_column=Region, parent_value=Bunyoro
   ```

6. **Fetches ONLY child districts:**
   ```python
   child_org_units = fetch_child_org_units(['Bunyoro'], child_level=3)
   # Returns: ["Buliisa", "Hoima", "Kibaale", "Masindi", ...]
   # (only 10 districts instead of 4439 options!)
   ```

7. **Returns filtered results:**
   ```python
   [DHIS2 Cascade] ✅ Returning 10 cascade options
   ```

---

## Why Your Current Setup Shows 4439 Options

**Without cascade configuration:**
```
District Filter:
├─ No parent filter configured
├─ Fetches ALL org units from DHIS2
└─ Shows all 4439 options (slow!)
```

**With cascade configuration:**
```
District Filter:
├─ Parent: Region = "Bunyoro"
├─ Fetches ONLY children of "Bunyoro"
└─ Shows 10 districts (fast!)
```

---

## Alternative: Use the Cascade Filter Setup Script

We have a helper script that can configure cascade filters programmatically:

```bash
cd /Users/edwinarinda/Projects/Redux/superset
python scripts/setup_cascade_filters.py --dashboard-id YOUR_DASHBOARD_ID
```

This script will:
1. Find all org unit filters in your dashboard
2. Auto-configure cascade relationships
3. Set up the hierarchy: Region → District → SubCounty

---

## Verification

After configuring cascade filters, check the backend logs:

```bash
tail -f logs/superset_backend.log | grep "Cascade API"
```

**When you select a Region, you should see:**
```
[Cascade API] 🔍 REQUEST: column=District, parent_column=Region, parent_values=Bunyoro
[Cascade API] ✅ CASCADE ENABLED: parent=Region, values=Bunyoro
[DHIS2 Cascade] 🔗 Cascade filter detected: Region = Bunyoro
[DHIS2 Cascade] ✅ Returning 10 cascade options
```

---

## Troubleshooting

### Still showing 4439 options?

**Check 1: Verify parent filter configuration**
- Open filter settings
- Ensure "Parent filter" is set correctly
- Parent column must match exactly (case-sensitive)

**Check 2: Check column names**
- Column names must match between filters
- Region column in parent = Region column in cascade config

**Check 3: Check backend logs**
```bash
tail -f logs/superset_backend.log | grep "Cascade"
```

If you see:
```
[Cascade API] ❌ NO CASCADE: parent_column=None, parent_values=None
```

Then the cascade is not configured in the dashboard.

---

## Need Help?

1. Share a screenshot of your filter configuration
2. Check the browser Network tab for API requests to `/column/District/values/`
3. Check if `cascade_parent_column` parameter is in the request
4. Share the backend logs when opening District dropdown

---

**Summary:** The backend cascade code is working perfectly. You just need to configure the cascade relationships in the Superset dashboard UI so that Superset passes the parent filter values to the backend.
