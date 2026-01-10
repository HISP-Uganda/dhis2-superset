# DHIS2 Chart Data Loading - Debugging Guide

## Issue
Charts are not loading data even though Preview works. The visualization shows "Loading boundaries..." indefinitely.

## Root Causes Fixed

### 1. **DHIS2 Parameter Detection** ✓
- Added automatic detection: checks if SQL contains `/* DHIS2: ... */` comment
- Previously only checked the `isDHIS2Dataset` prop which defaults to `false`
- Now works with or without the prop being set

### 2. **Better Error Messages** ✓
- Invalid SQL format → Shows expected format
- Empty parameters → Shows which parameter is missing
- No data returned → Shows troubleshooting steps

### 3. **Enhanced Logging** ✓
- Frontend logs when DHIS2 detection happens
- Shows which parameters were parsed from SQL
- Logs API responses and HTTP status codes
- Backend logs full payload and parameter details

## Checklist to Get Charts Working

### Step 1: Verify SQL Format
Your dataset SQL **must** have DHIS2 parameters:
```sql
/* DHIS2: dx=element1;element2&pe=2024&ou=ouId&ouMode=DESCENDANTS */
SELECT * FROM table
```

**Required parameters:**
- `dx` - Data element IDs (semicolon-separated)
- `pe` - Period (year, month, or relative like LAST_YEAR)
- `ou` - Org unit IDs (semicolon-separated)
- `ouMode` - Optional: DESCENDANTS or CHILDREN

### Step 2: Check Browser Console
1. Open DevTools (F12) → Console tab
2. Look for `[DHIS2Map]` logs:
   ```
   [DHIS2Map] DHIS2 detection: {
     isDHIS2Dataset: false,
     hasDHIS2Params: true,  ← Should be TRUE
     shouldFetchDHIS2: true
   }
   ```

3. Look for parameter parsing logs:
   ```
   [DHIS2DataLoader] Parsed parameters: {
     dataElements: ["de1", "de2"],  ← Should have values
     periods: ["2024"],
     orgUnits: ["ou1"],
   }
   ```

### Step 3: Check Server Logs
Look for `[DHIS2 Data Preview]` logs:

**Success case:**
```
[DHIS2 Data Preview] Received full payload: {...}
[DHIS2 Data Preview] Total rows from analytics: 150
```

**Failure cases:**
```
[DHIS2 Data Preview] Empty input - returning empty response. data_elements_empty=True, periods_empty=False, org_units_empty=False
→ One of your parameters is missing from the SQL comment

[DHIS2 Data Preview] No rows returned from analytics
→ DHIS2 doesn't have data for these parameters. Check:
  - Period exists in DHIS2
  - Org units exist and have data
  - Data elements exist
  - Database connection works
```

### Step 4: Test the Preview Endpoint
If charts don't work but Preview does, isolate the issue:

1. **In DataPreview modal:**
   - Check that data loads
   - Note the parameters being used
   - Check the response in Network tab

2. **Compare with Chart:**
   - Are the same parameters being sent?
   - Is `datasetSql` being passed to the visualization?

### Step 5: Common Issues

| Issue | Solution |
|-------|----------|
| "Invalid dataset SQL" error | Add `/* DHIS2: dx=...&pe=...&ou=... */` to SQL |
| "No data elements found" | SQL comment missing `dx=element1;element2` |
| "No periods found" | SQL comment missing `pe=period` |
| "No org units found" | SQL comment missing `ou=orgUnitId` |
| Data in Preview but not Chart | `datasetSql` prop not passed to visualization |
| Browser shows "Loading..." forever | Check console for errors |

## Testing Locally

### Enable Full Logging
The following components now log extensively:
1. **dhis2DataLoader.ts** - Parameter parsing, API calls
2. **DHIS2Map.tsx** - DHIS2 detection, data loading lifecycle
3. **superset/databases/api.py** - Backend request/response details

### Reproduce Issue
1. Create/edit a chart with DHIS2 map visualization
2. Ensure dataset SQL has DHIS2 comment
3. Ensure database is DHIS2
4. Open DevTools Console
5. Refresh visualization
6. Look for logs starting with `[DHIS2Map]` and `[DHIS2DataLoader]`

### Network Debugging
1. Open DevTools → Network tab
2. Filter for: `/dhis2_preview/data/` or `/dhis2_preview/columns/`
3. Check:
   - **Status**: Should be 200
   - **Payload**: Review sent parameters
   - **Response**: Check returned rows/columns count

## Expected Flow

```
DHIS2Map component mounts
    ↓
Auto-detect DHIS2 SQL: /\*\s*DHIS2:\s*(.+?)\s*\*\//i
    ↓ (if matches)
Parse DHIS2 parameters: dx, pe, ou, ouMode
    ↓ (if all present)
Call /api/v1/database/{id}/dhis2_preview/data/
    ↓
Backend fetches org unit metadata
    ↓
Backend calls DHIS2 analytics API
    ↓
Return rows to frontend
    ↓
Chart renders with data
    ↓
setLoading(false) - Loading spinner disappears
```

## If Still Not Working

1. **Get full logs**
   - Copy browser console output (search for `[DHIS2`)
   - Copy server logs (search for `[DHIS2`)
   - Share both

2. **Verify DHIS2 connection**
   - Test DataPreview with same parameters
   - If Preview works, issue is in chart visualization
   - If Preview fails, issue is in database connection

3. **Check API endpoints**
   - Visit: `http://localhost:8088/api/v1/database/{db_id}/dhis2_preview/data/`
   - Should return 405 (POST required)
   - If 404, endpoint not registered

## Recent Changes

### Frontend (dhis2DataLoader.ts)
- Added validation for empty parameters
- Added HTTP status checking
- Enhanced error messages with specific guidance
- Added logging of payloads sent and received

### Frontend (DHIS2Map.tsx)
- Added automatic DHIS2 detection (regex on SQL)
- Added `min-height: 50vh` for better modal sizing
- Replaced text with Superset Loading component
- Improved error messages with troubleshooting steps
- Call `setLoading(false)` when data succeeds

### Backend (superset/databases/api.py)
- Log full incoming payload
- Log parameter types and lengths
- Log which parameter is empty (if validation fails)
- Log API call parameters before fetching data
- Log warning if analytics returns 0 rows with full response
