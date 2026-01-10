# DHIS2 SQL Preview Not Returning Data - Troubleshooting Guide

## Your SQL
```sql
SELECT * FROM analytics
/* DHIS2: table=analytics&dx=JhvC7ZR9hUe;D9A0afrTYPw;wUDxFVBapIc;QHnwKs2OUZv;BWZFz9RJRPI;AuAOIfCuBUp;pRZrTLDN7Ge;gHjJrtw9vQX&pe=LAST_5_YEARS&ou=F1o6qBSx783;SUvODYOcaVf&ouMode=DESCENDANTS */
```

## What the Parameters Mean
- **dx**: 8 data elements (JhvC7ZR9hUe, D9A0afrTYPw, etc.)
- **pe**: LAST_5_YEARS (will expand to last 5 years: 2025, 2024, 2023, 2022, 2021)
- **ou**: 2 org units (F1o6qBSx783, SUvODYOcaVf) 
- **ouMode**: DESCENDANTS (includes children of these org units)
- **table**: analytics (which table to use - optional)

## Step 1: Check Backend Logs

When you run DataPreview, look for logs with `[DHIS2 Data Preview]`:

### Expected Success Flow
```
[DHIS2 Data Preview] Received full payload: {...dx=..., pe=..., ou=...}
[DHIS2 Data Preview] Expanded periods: ['2025', '2024', '2023', '2022', '2021']
[DHIS2 Data Preview] Fetching analytics data with custom ou dimension...
[Analytics API] Fetching from https://your-dhis2-server/api/analytics...
[Analytics API] Found 150 raw rows from analytics
[DHIS2 Data Preview] Total rows from analytics: 75
```

### Possible Failure Scenarios

#### 1. **Connection Error**
```
[DHIS2 Data Preview] Connection type: <class '...'>
[DHIS2 Data Preview] Connection does not have fetch_analytics_data method
```
**Fix**: DHIS2 database connection might not be properly initialized. Check:
- Database backend is set to "dhis2"
- DHIS2 server URL is correct
- Authentication (username/password or PAT token) is valid

#### 2. **Empty Input Parameters**
```
[DHIS2 Data Preview] Empty input - returning empty response. 
data_elements_empty=True, periods_empty=False, ou_units_empty=False
```
**Fix**: One parameter is empty. The SQL comment must have:
- `dx=element1;element2` (not empty)
- `pe=period` (not empty)
- `ou=orgUnitId` (not empty)

#### 3. **Period Expansion Issue**
```
[DHIS2 Data Preview] Expanded periods: []
```
**Fix**: LAST_5_YEARS should expand to actual year codes. If empty:
- Check server datetime is correct (backend uses `datetime.now().year`)
- Try using concrete years: `pe=2025;2024;2023;2022;2021`

#### 4. **DHIS2 API Returned No Data**
```
[Analytics API] Fetching from https://server/api/analytics?dimension=dx:...&dimension=pe:...&dimension=ou:...
[Analytics API] Found 0 raw rows from analytics
[DHIS2 Data Preview] No rows returned from analytics
```
**Fix**: DHIS2 doesn't have data for these parameters. Check:
1. **Data elements exist**: Test in DHIS2 UI (Data Elements app)
2. **Periods have data**: 
   - Open DHIS2 → Analytics app
   - Select same data elements, periods, org units
   - If Analytics app shows data, problem is in our code
   - If Analytics app shows no data, problem is in DHIS2

3. **Org units have data**: 
   - Go to DHIS2 → Data Entry
   - Check org units F1o6qBSx783, SUvODYOcaVf have entries for these periods

4. **Data is published**: In DHIS2, data needs to be marked as "ready for analytics"

## Step 2: Test with Simpler Parameters

Try simpler parameters to isolate the issue:

### Test 1: Use a Known Working Data Element
```sql
SELECT * FROM analytics
/* DHIS2: dx=BpT3Ys6Ed8d&pe=2024&ou=ImspTQPwCqd&ouMode=SELECTED */
```
- Use LAST_MONTH instead of LAST_5_YEARS
- Use SELECTED mode instead of DESCENDANTS
- This reduces scope to test basic connectivity

### Test 2: If Still No Data
```sql
SELECT * FROM analytics
/* DHIS2: dx=e8b2iCjRLBF&pe=2024&ou=O6uvpzGd5pu */
```
(These are DHIS2 default data in demo server)

## Step 3: Check DHIS2 Analytics Endpoint Directly

Test if DHIS2 API itself returns data:

```bash
curl -u admin:password "https://your-server.dhis2.org/api/analytics?dimension=dx:JhvC7ZR9hUe&dimension=pe:2024&dimension=ou:F1o6qBSx783&paging=false"
```

If this returns data but Superset doesn't, issue is in parameter passing.

## Step 4: Enable Debug Logs

Add to `superset_config.py`:
```python
LOGGING_CONFIG = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'default': {
            'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'default',
        },
    },
    'loggers': {
        'superset.databases.api': {
            'level': 'DEBUG',
            'handlers': ['console'],
        },
        'superset.db_engine_specs.dhis2_dialect': {
            'level': 'DEBUG',
            'handlers': ['console'],
        },
    }
}
```

## Step 5: Check Data Element IDs

Make sure the data elements in your SQL actually exist in DHIS2:

```bash
curl -u admin:password "https://your-server/api/dataElements?filter=id:in:[JhvC7ZR9hUe,D9A0afrTYPw,...]&fields=id,name&paging=false"
```

If a data element ID returns 404, it doesn't exist.

## Step 6: Verify Org Unit IDs

Check that org units exist and are active:

```bash
curl -u admin:password "https://your-server/api/organisationUnits?filter=id:in:[F1o6qBSx783,SUvODYOcaVf]&fields=id,name,level&paging=false"
```

## Common Issues

| Issue | Solution |
|-------|----------|
| DHIS2 server not reachable | Check network connectivity, firewall, SSL certs |
| Auth fails | Verify username/password or PAT token in database settings |
| Data elements don't exist | Use DHIS2 UI to find correct IDs |
| Periods have no data | Enter data in DHIS2 or wait for period to close |
| Org units inactive | Activate in DHIS2 (Org Unit → Edit → Active: Yes) |
| Analytics not updated | Force analytics table generation in DHIS2 |

## Parameter Format Validation

Your SQL must follow this exact format:

```
/* DHIS2: key1=val1;val2&key2=val3&key3=val4;val5&... */
```

**Valid parameter keys:**
- `dx` - Data element IDs (semicolon-separated)
- `pe` - Period codes or relative keywords (semicolon-separated)
- `ou` - Org unit IDs (semicolon-separated)
- `ouMode` - SELECTED, CHILDREN, DESCENDANTS, or ALL
- `table` - Optional, defaults to "analytics"

**Relative period keywords supported:**
- Yearly: `LAST_YEAR`, `LAST_3_YEARS`, `LAST_5_YEARS`
- Monthly: `LAST_MONTH`, `LAST_3_MONTHS`, `LAST_6_MONTHS`, `THIS_MONTH`, `THIS_YEAR`
- Concrete: `2024`, `202401`, `2024Q1` (DHIS2 period codes)

## If Nothing Works

1. **Check if it's a Chart issue or DataPreview issue**:
   - If DataPreview doesn't work → Problem is database/SQL
   - If DataPreview works but Charts don't → Problem is visualization configuration

2. **Isolate the endpoint**:
   ```bash
   # Test the endpoint directly
   curl -X POST http://localhost:8088/api/v1/database/{DATABASE_ID}/dhis2_preview/data/ \
     -H "Content-Type: application/json" \
     -d '{
       "data_elements": ["JhvC7ZR9hUe"],
       "periods": ["2024"],
       "org_units": [{"id": "F1o6qBSx783"}],
       "limit": 100
     }'
   ```

3. **Collect debug info**:
   - Full server logs with `[DHIS2` in them
   - Browser console logs with `[DHIS2` in them
   - Response from the endpoint test above
   - Response from direct DHIS2 API call

Then share these with development team for diagnosis.
