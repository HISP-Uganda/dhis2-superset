# DHIS2 Query Builder - User Guide

## Discovery

**GOOD NEWS**: A DHIS2 Query Builder already exists in the codebase and is working!

## Location in UI

1. Go to **Data → Datasets → + Dataset**
2. Select **Database**: Choose your DHIS2 database (e.g., "DHIS2 Test HMIS")
3. Select **Table**: Choose `analytics`
4. You should see the **DHIS2 Query Builder** interface appear

## Architecture

### Backend API
**File**: `superset/databases/api.py` (lines 2110-2350)

**Endpoint**: `GET /api/v1/database/<db_id>/dhis2_metadata/`

**Parameters**:
- `type`: `dataElements`, `indicators`, `organisationUnits`, `periods`
- `table`: Table context for filtering (e.g., `analytics`, `events`)
- `level`: Org unit level filter
- `periodType`: `YEARLY`, `QUARTERLY`, `MONTHLY`, `RELATIVE`

**Features**:
✅ Fetches ALL data elements and indicators from DHIS2
✅ Filters by table type (analytics = aggregatable numeric only)
✅ Returns up to 1000 items per request
✅ Caches results for performance

### Frontend UI
**File**: `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/index.tsx`

**Components**:
- Data Element/Indicator Selector (multi-select dropdown)
- Period Selector (tabs for Yearly/Quarterly/Monthly/Relative)
- Organization Unit Selector (levels 1-5, user org unit options)
- Auto-generated dataset name
- Live parameter preview

## How It Works

### Step 1: Select Data Elements

The dropdown shows:
```
📊 Indicators
  - 105- Total Malaria Cases
  - 205- Malaria Deaths
  ...

📈 Data Elements (Numeric, Aggregatable)
  - 105-EP01a. Suspected Malaria (fever)
  - 105-EP01b. Malaria Tested (B/s & RDT)
  - 105-EP01c. Malaria confirmed (B/s & RDT)
  - 105-EP01d. Confirmed Malaria cases treated
  - 105-EP01e Total malaria cases treated
  ...
```

**Why you might not see them:**
1. ❌ Wrong database selected (not DHIS2)
2. ❌ Wrong table selected (not `analytics`)
3. ❌ API timeout (Uganda HMIS has thousands of data elements)
4. ❌ Authentication issues
5. ❌ DHIS2 server is down

### Step 2: Select Periods

Choose from tabs:
- **Yearly**: 2015, 2016, ..., 2025
- **Quarterly**: 2023Q1, 2023Q2, 2023Q3, 2023Q4, ...
- **Monthly**: 202301, 202302, ..., 202512
- **Relative**: THIS_YEAR, LAST_YEAR, LAST_3_MONTHS, etc.

### Step 3: Select Organization Units

Options:
- **By Level**: Level 1 (Country), Level 2 (Regions), Level 3 (Districts), etc.
- **User Context**: USER_ORGUNIT, USER_ORGUNIT_CHILDREN, etc.
- **Specific Org Units**: Select from dropdown (filtered by level)

### Step 4: Generate Dataset

The query builder automatically:
1. **Generates DHIS2 API parameters**:
   ```
   dimension=dx:SnTAtTtV7eM;RDedxP1o9jo
   dimension=pe:2023;2024
   dimension=ou:LEVEL-2
   ```

2. **Creates SQL comment** (embedded in dataset SQL):
   ```sql
   -- DHIS2: dimension=dx:SnTAtTtV7eM;RDedxP1o9jo&dimension=pe:2023&dimension=ou:LEVEL-2&displayProperty=NAME
   SELECT * FROM analytics LIMIT 10000
   ```

3. **Defines columns** (WIDE format):
   ```
   Period (VARCHAR)
   OrgUnit (VARCHAR)
   105-EP01a. Suspected Malaria (fever) (FLOAT)
   105-EP01b. Malaria Tested (B/s & RDT) (FLOAT)
   105-EP01c. Malaria confirmed (B/s & RDT) (FLOAT)
   105-EP01d. Confirmed Malaria cases treated (FLOAT)
   105-EP01e Total malaria cases treated (FLOAT)
   ```

4. **Auto-names the dataset**:
   ```
   analytics_Suspected_Malaria_2023_Regions
   ```

## Debugging: Why Data Elements Don't Show

### Check Browser Console

Open browser DevTools → Console tab → Look for:

```javascript
[DHIS2 Query Builder] Loading metadata for database: 18 table: analytics
[DHIS2 Query Builder] Fetching data elements for table: analytics
[DHIS2 Query Builder] Data elements response: 200
[DHIS2 Query Builder] Data elements loaded: 234 (filtered for analytics)
```

**If you see errors:**
- `404 Not Found` → Wrong database ID or endpoint
- `401 Unauthorized` → Authentication issue
- `500 Server Error` → DHIS2 API is down or timeout

### Check Network Tab

DevTools → Network tab → Look for:

```
GET /api/v1/database/18/dhis2_metadata/?type=dataElements&table=analytics
Status: 200 OK
Response: {"result": [{...}, {...}, ...]}
```

**Check response body:**
```json
{
  "result": [
    {
      "id": "SnTAtTtV7eM",
      "displayName": "105-EP01a. Suspected Malaria (fever)",
      "aggregationType": "SUM",
      "valueType": "NUMBER",
      "category": "Aggregatable Data Elements",
      "typeInfo": "NUMBER (SUM)"
    },
    ...
  ]
}
```

**If `result` is empty `[]`:**
- The DHIS2 server has no data elements matching the filter
- Or the authentication credentials are wrong

### Check Superset Logs

```bash
docker compose logs superset --tail 100 | grep -i "dhis2\|dataElements"
```

Look for:
```
[DHIS2] Fetching dataElements from https://hmis-tests.health.go.ug/api/dataElements
[DHIS2] Found 234 dataElements
```

**If you see errors:**
```
Failed to fetch DHIS2 metadata: timeout
DHIS2 API error: 401 Unauthorized
```

## Known Issues & Solutions

### Issue 1: Data Elements Not Loading (Timeout)

**Cause**: Uganda HMIS has 5000+ data elements, taking >60 seconds to load

**Solution A**: Increase timeout in `superset/databases/api.py`:
```python
response = requests.get(
    f"{base_url}/{metadata_type}",
    params=params,
    auth=auth,
    headers=headers,
    timeout=120,  # Increase to 2 minutes
)
```

**Solution B**: Add pagination/search:
```python
params = {
    "fields": "id,displayName,aggregationType,valueType",
    "paging": "true",
    "pageSize": "100",
    "page": "1",
}
```

### Issue 2: Too Many Data Elements (Dropdown Lag)

**Cause**: Rendering 5000+ items in a Select dropdown is slow

**Solution**: Add search/filter in UI:
```typescript
<StyledSelect
  mode="multiple"
  showSearch
  filterOption={(input, option) =>
    option?.children?.toLowerCase().indexOf(input.toLowerCase()) >= 0
  }
  placeholder={t('Search data elements...')}
>
```

**Better Solution**: Add server-side search:
```typescript
const searchDataElements = async (searchTerm: string) => {
  const response = await fetch(
    `/api/v1/database/${databaseId}/dhis2_metadata/?type=dataElements&search=${searchTerm}&table=analytics`
  );
  return response.json();
};
```

### Issue 3: Data Elements Show But Charts Fail

**Cause**: Type inference issues (the "Could not convert string to numeric" error we've been debugging)

**Solution**: This is the DuckDB intermediary approach we documented in `DHIS2_DUCKDB_ACTION_PLAN.md`

## Improvements Needed

### 1. Add Search Capability

**Backend** (`superset/databases/api.py`):
```python
# Add search parameter support
search_term = request.args.get("search")
if search_term:
    params["filter"].append(f"displayName:ilike:{search_term}")
```

**Frontend** (DHIS2ParameterBuilder):
```typescript
const [searchTerm, setSearchTerm] = useState('');

// Debounced search
useEffect(() => {
  const timer = setTimeout(() => {
    if (searchTerm.length >= 3) {
      loadMetadata(searchTerm);
    }
  }, 500);
  return () => clearTimeout(timer);
}, [searchTerm]);
```

### 2. Add Grouping/Categories

Group data elements by:
- Data Set (Malaria, HIV, Maternal Health, etc.)
- Category (Cases, Deaths, Tests, etc.)
- Value Type (NUMBER, PERCENTAGE, BOOLEAN, etc.)

### 3. Add Favorites/Recent

Store user's frequently used data elements:
```typescript
const [favorites, setFavorites] = useState<string[]>([]);

// Show favorites at top
<OptGroup label="⭐ Favorites">
  {favorites.map(id => ...)}
</OptGroup>
```

### 4. Add Preview

Show sample data before creating dataset:
```typescript
<Button onClick={loadPreview}>Preview Data</Button>

<Modal>
  <Table dataSource={previewData} columns={previewColumns} />
</Modal>
```

## How DHIS2 Visualizer Works (Comparison)

DHIS2's official visualizer uses a similar approach:

### Data Selection
1. **Dimension Pickers**: Separate tabs for Data, Period, Org Units
2. **Search & Filter**: Real-time search with server-side filtering
3. **Favorites**: Star frequently used indicators
4. **Groups**: Organize by indicator groups, data element groups

### Query Building
1. User selects dimensions → Builds API request
2. Fetches analytics data → Returns JSON
3. Transforms to chart format → Renders with Highcharts/Recharts

### Key Differences from Superset

| Feature | DHIS2 Visualizer | Superset + DHIS2 Engine |
|---------|------------------|-------------------------|
| Data Format | API JSON → Chart directly | API → SQL abstraction → Chart |
| Type Handling | Native DHIS2 types | SQL type inference (problematic) |
| Caching | Server-side | Superset cache + DHIS2 cache |
| Charts | Highcharts (built-in) | Multiple viz plugins |
| Interactivity | Drill-down in same app | Dashboard filters |

## Recommendation

**Short-term**: Use the existing DHIS2 Query Builder with improvements:
1. Add search capability (critical for large instances)
2. Add pagination for data elements
3. Increase API timeouts

**Long-term**: Implement DuckDB intermediary (see `DHIS2_DUCKDB_ACTION_PLAN.md`):
1. Sync DHIS2 → DuckDB (with metadata)
2. Superset queries DuckDB (fast, reliable)
3. All Superset features work perfectly

## Testing the Query Builder

1. Go to http://localhost:8088/dataset/add
2. Select Database: "DHIS2 Test HMIS" or similar
3. Select Table: `analytics`
4. Wait for data elements to load (may take 30-60 seconds for large instances)
5. Search for "105-EP" or "Malaria" in the dropdown
6. Select a few data elements
7. Select periods (e.g., 2023, 2024)
8. Select org units (e.g., Level 2 - Regions)
9. Click "Create Dataset"

**Expected Result**: Dataset created with WIDE format (one column per data element)

**If it fails**: Check browser console and Superset logs for errors

---

## Summary

✅ **DHIS2 Query Builder exists and works**
✅ **Backend API fetches metadata correctly**
✅ **Frontend UI renders data elements**
❌ **Performance issues with large metadata (5000+ items)**
❌ **No search/filter capability (yet)**
❌ **Type inference issues cause chart errors** (needs DuckDB solution)

**Next Steps**:
1. Test the existing query builder
2. Add search capability for large instances
3. Implement DuckDB intermediary for production use
