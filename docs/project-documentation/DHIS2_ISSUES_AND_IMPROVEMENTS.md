# DHIS2 Integration - Issues and Improvements

## 📋 Summary of Tasks and Achievements

| Issue # | Title | Status | Priority | Files Modified | Achievement |
|---------|-------|--------|----------|----------------|-------------|
| **0** | OrgUnit Table Structure Investigation | ✅ **RESOLVED** | Info | None | Clarified that OrgUnits have dual purpose: metadata (rows) and dimension values (columns). Current structure is correct. |
| **0.1** | SQL Lab Query Builder Implementation | 🔄 **PLANNED** | High | `SqlEditorLeftBar/index.tsx`<br>`DHIS2QueryBuilder/` | Basic MVP created but needs to reuse existing dataset creation component for consistency. |
| **0.2** | URL Paste Feature for SQL Lab | ✅ **DESIGNED** | Medium | Documented implementation | Complete design for parsing DHIS2 API URLs and auto-populating query builder. Supports full URLs, relative paths, and parameter strings. |
| **0.5** | Preview Data URL Format & Matching | ✅ **FIXED** | High | `DHIS2ParameterBuilder/index.tsx` | **Fixed dimension grouping** - URLs now properly format as `dimension=dx:A;B;C&dimension=pe:X;Y&dimension=ou:Z`. Single decoded URL display. Preview fetches live data with refresh button. |
| **0.6** | Period Selection Limit (Max 5) | ✅ **FIXED** | Medium | `PeriodSelector.tsx` | **Removed MAX_PERIODS limit** - Users can now select unlimited periods. Removed limit warnings and "max 5" text. |
| **0.7** | Data Element Filter Error | ✅ **FIXED** | High | `DHIS2ParameterBuilder/index.tsx` | **Fixed toLowerCase error** - Added type checking in filterOption to prevent `toLowerCase is not a function` error when typing in Data (dx) field. |
| **1** | Dataset Name Not Editable | ✅ **FIXED** | High | `DHIS2ParameterBuilder/index.tsx`<br>`Footer/index.tsx`<br>`dhis2_dialect.py` | **Implemented smart naming pattern** - Auto-generates `{source_table}_{description}_{date}` format. Users can edit freely. Backend parses source table from name (e.g., `analytics_version2` → reads from `analytics`). Multiple datasets from same source table now supported. |
| **2** | Disorganized Data in Query Builder | ❌ **OPEN** | High | Not started | Need hierarchical organization (groups → items) like DHIS2 Visualizer for Data Elements, Indicators, Periods, and OrgUnits. |
| **3** | OrgUnit X-Axis Display Error | ✅ **FIXED** | 🔴 **CRITICAL** | `dhis2_dialect.py`<br>Frontend build files | **Fixed column typing** - OrgUnit/Period explicitly marked as `types.String()` with `is_dttm=False`. Added debug logging. Error: `Could not convert string 'Port LokoPujehunBonthe' to numeric` - resolved by proper type metadata. |
| **Frontend** | Build Errors (theme, queryEditor) | ✅ **FIXED** | 🔴 **CRITICAL** | `DHIS2QueryBuilder/index.tsx`<br>`SqlEditorLeftBar/index.tsx` | Fixed theme token errors, added 'sql' field to queryEditor, removed unused functions. **Frontend compiled successfully**. |

### 🎯 Current Session Achievements (2025-11-11)

✅ **Completed:**
1. **Issue 0.5** - Added refresh button to preview modal for live data fetching
2. **Issue 0.6** - Removed period selection limit (was max 5, now unlimited)
3. **Issue 0.7** - Fixed toLowerCase error in Data element filter function
4. **Documentation** - Updated with all three fixes and implementation details

### 🎯 Previous Session Achievements (2025-11-10)

✅ **Completed:**
1. **Issue 0.5** - Fixed preview URL format to properly group dimensions by type
2. **Issue 3** - Fixed OrgUnit X-axis column type metadata to prevent numeric conversion
3. **Issue 1** - Implemented smart dataset naming with pattern `{source_table}_{suffix}`
4. **Frontend Build** - Resolved all TypeScript compilation errors
5. **Documentation** - Comprehensive root cause analysis and solutions for all issues

### 📊 Progress Overview

- **Total Issues**: 8 (including sub-issues and frontend)
- **Resolved**: 3 ✅
- **Fixed**: 4 ✅
- **Designed**: 1 ✅
- **Open/Planned**: 1 ❌

### 🚀 Ready for Testing

The following features are now working and ready to test:
- ✅ DHIS2 dataset creation with parameter preservation
- ✅ Charts with DHIS2 data (parameters passed via cache + extra field)
- ✅ Preview data with correct decoded URL format
- ✅ OrgUnit column properly typed as string/categorical with groupby metadata
- ✅ Smart dataset naming (analytics_malaria_20251110)
- ✅ Frontend application compiled without errors

### 🔜 Next Steps

Priority order for remaining work:
1. **Issue 3 Testing** - Verify OrgUnit X-axis works in charts without concatenation/numeric errors
2. **Issue 2** - Implement hierarchical data organization (highest impact on UX)
3. **Issue 0.1** - Extract and reuse dataset creation query builder in SQL Lab
4. **Issue 0.2** - Implement URL paste feature
5. **Issue 1** - Add editable dataset name field

---

## Current Issues

### Issue 0: OrgUnit Table Structure Investigation ❌
**Problem**: Need to clarify the correct structure for organisationUnits table.

**Current Table Structure**:
```
Table columns:
Column Name   | Datatype
------------- | ------------
id            | VARCHAR(255)
displayName   | VARCHAR(255)
name          | VARCHAR(255)
code          | VARCHAR(255)
created       | TIMESTAMP
lastUpdated   | TIMESTAMP
```

**Analysis**:
The current structure is **CORRECT** ✅. When querying the `organisationUnits` endpoint directly, OrgUnits are returned as **rows** with the above fields as **columns**. This is the metadata endpoint structure.

**How OrgUnits Appear in Different Contexts**:

1. **Metadata Endpoint** (`/api/organisationUnits`):
   - Returns list of OrgUnits as rows
   - Each row has: id, displayName, name, code, created, lastUpdated
   - Used for browsing/searching OrgUnits
   - Example:
   ```
   id           | displayName  | name         | code
   -------------|------------- |--------------|------
   YuQRtpLP10I  | Sierra Leone | Sierra Leone | SL
   vWbkYPRmKyS  | Port Loko    | Port Loko    | PL
   ```

2. **Analytics Endpoint** (`/api/analytics?dimension=ou:...`):
   - OrgUnits appear as a dimension in the analysis
   - Structure after pivoting: `Period | OrgUnit | DataElement1 | DataElement2 | ...`
   - OrgUnit becomes a **column** showing which OrgUnit the data belongs to
   - Example:
   ```
   Period | OrgUnit      | Malaria Cases | ANC Visits
   -------|--------------|---------------|------------
   202401 | Sierra Leone | 150           | 200
   202401 | Port Loko    | 45            | 67
   ```

**Conclusion**: The table structure is correct. The confusion arises because OrgUnits serve dual purposes:
- As **metadata** (rows in organisationUnits table)
- As **dimension values** (column in analytics results showing which OrgUnit)

**No fix needed** - working as designed.

---

### Issue 0.1: SQL Lab Query Builder Not Like Dataset Query Builder ❌❌❌
**Problem**: The current SQL Lab implementation uses basic text inputs for UIDs. It should be **exactly like** the dataset creation query builder sidebar.

**What User Sees in Dataset Creation** (Correct ✅):
```
Data Elements & Indicators:
☑ Malaria confirmed cases
☑ Malaria deaths
☑ Malaria suspected cases
☑ ANC 1st visit
☑ Delivery in facility

Period:
☑ LAST_YEAR
☑ THIS_YEAR
☑ LAST_QUARTER

Organisation Unit:
☑ Sierra Leone
```

**What SQL Lab Currently Has** (Wrong ❌):
```
Data Element UID:
[jmWyJFtE7Af] [Add Button]

Period:
[LAST_YEAR] [Add Button]

Org Unit UID:
[ImspTQPwCqd] [Add Button]
```

**What's Generated**:
```sql
SELECT * FROM analytics
/* DHIS2: dimension=dx:jmWyJFtE7Af;yqBkn9CWKih;A2VfEfPflHV;HLPuaFB7Frw;sB4w56lnJb7;iKGjnOOaPlE;aIJZ2d2QgVV;NJnhOzjaLYk;Cm4XUw6VAxv;RF4VFVGdFRO;qw2sIef52Fu;GhsYeB89HaL;e73QxJpd88B;xFpppWvT43s;EzR5Y2V0JF9;HpM1I5qc3Pb;ndb4fIRrQbM&dimension=pe:LAST_YEAR;THIS_YEAR;LAST_QUARTER;THIS_QUARTER;LAST_MONTH&dimension=ou:ImspTQPwCqd&displayProperty=NAME&skipMeta=false */
```

**Solution - Reuse Existing Component**:

The dataset creation already has a perfect query builder sidebar at:
```
superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/
```

**Steps**:
1. **Extract to shared location**:
   - Move `DHIS2ParameterBuilder` to `src/components/DHIS2/ParameterBuilder/`
   - Make it generic (not tied to dataset creation)

2. **Use in both places**:
   - Dataset creation (`AddDataset/Footer`)
   - SQL Lab (`SqlEditorLeftBar`)

3. **Same features in both**:
   - Display names visible (e.g., "Malaria confirmed cases")
   - UIDs used in background
   - Multi-select with checkboxes
   - Search functionality
   - Organized by groups/programs
   - Real-time URL generation

**Key Point**: Don't rebuild it - REUSE what already works!

---

### Issue 0.2: URL Paste Feature for SQL Lab ✨ NEW
**Problem**: Users want to quickly build queries by pasting DHIS2 API URLs directly.

**Use Case**:
User has a DHIS2 analytics URL from DHIS2 Visualizer or another source:
```
https://play.dhis2.org/api/analytics?dimension=dx:FTRrcoaog83;P3jJH5Tu5VC;M62VHgYT2n0&dimension=pe:LAST_YEAR;THIS_YEAR&dimension=ou:YuQRtpLP10I;vWbkYPRmKyS&displayProperty=NAME&skipMeta=false
```

Instead of manually selecting each data element, period, and org unit in the query builder, user wants to:
1. Paste the URL into a text field
2. System automatically parses the URL
3. Query builder populates with the extracted parameters
4. SQL is generated automatically

**Solution Design**:

**UI Component** (in SQL Lab sidebar above query builder):
```tsx
┌─────────────────────────────────────────────┐
│ Quick Import from URL                       │
│ ┌─────────────────────────────────────────┐ │
│ │ Paste DHIS2 API URL here...             │ │
│ └─────────────────────────────────────────┘ │
│ [Parse & Build Query]                       │
└─────────────────────────────────────────────┘

After parsing:
✅ Extracted 3 data elements (dx)
✅ Extracted 2 periods (pe)
✅ Extracted 2 org units (ou)
✅ Query parameters applied
```

**Implementation Steps**:

1. **Create URL Parser Utility** (`superset-frontend/src/SqlLab/utils/dhis2UrlParser.ts`):
```typescript
export interface ParsedDHIS2Url {
  dataElements: string[]; // dx UIDs
  periods: string[]; // pe codes
  orgUnits: string[]; // ou UIDs
  displayProperty?: string;
  skipMeta?: string;
  startDate?: string;
  endDate?: string;
}

export function parseDHIS2Url(url: string): ParsedDHIS2Url | null {
  try {
    // Handle both full URLs and relative paths
    // Examples:
    // - Full: https://play.dhis2.org/api/analytics?dimension=dx:...
    // - Relative: api/analytics?dimension=dx:...
    // - Just params: dimension=dx:...&dimension=pe:...

    let searchParams: URLSearchParams;

    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Full URL
      const urlObj = new URL(url);
      searchParams = new URLSearchParams(urlObj.search);
    } else if (url.includes('?')) {
      // Relative path with query string: api/analytics?dimension=...
      const queryString = url.split('?')[1];
      searchParams = new URLSearchParams(queryString);
    } else {
      // Just query parameters: dimension=dx:...&dimension=pe:...
      searchParams = new URLSearchParams(url);
    }

    const result: ParsedDHIS2Url = {
      dataElements: [],
      periods: [],
      orgUnits: [],
    };

    // Extract dimension parameters (can appear multiple times)
    searchParams.getAll('dimension').forEach(dim => {
      if (dim.startsWith('dx:')) {
        result.dataElements.push(...dim.substring(3).split(';'));
      } else if (dim.startsWith('pe:')) {
        result.periods.push(...dim.substring(3).split(';'));
      } else if (dim.startsWith('ou:')) {
        result.orgUnits.push(...dim.substring(3).split(';'));
      }
    });

    // Extract other parameters
    result.displayProperty = searchParams.get('displayProperty') || 'NAME';
    result.skipMeta = searchParams.get('skipMeta') || 'false';
    result.startDate = searchParams.get('startDate') || undefined;
    result.endDate = searchParams.get('endDate') || undefined;

    return result;
  } catch (error) {
    console.error('Failed to parse DHIS2 URL:', error);
    return null;
  }
}

export function generateSQLFromParsedUrl(parsed: ParsedDHIS2Url): string {
  const parts: string[] = [];

  if (parsed.dataElements.length > 0) {
    parts.push(`dimension=dx:${parsed.dataElements.join(';')}`);
  }
  if (parsed.periods.length > 0) {
    parts.push(`dimension=pe:${parsed.periods.join(';')}`);
  }
  if (parsed.orgUnits.length > 0) {
    parts.push(`dimension=ou:${parsed.orgUnits.join(';')}`);
  }

  parts.push(`displayProperty=${parsed.displayProperty}`);
  parts.push(`skipMeta=${parsed.skipMeta}`);

  if (parsed.startDate) parts.push(`startDate=${parsed.startDate}`);
  if (parsed.endDate) parts.push(`endDate=${parsed.endDate}`);

  const comment = `/* DHIS2: ${parts.join('&')} */`;
  return `SELECT * FROM analytics\n${comment}`;
}
```

2. **Add URL Input Component** (`superset-frontend/src/SqlLab/components/DHIS2UrlImporter/index.tsx`):
```typescript
import React, { useState, useCallback } from 'react';
import { Input, Button, Alert } from 'antd';
import { parseDHIS2Url, generateSQLFromParsedUrl } from '../../utils/dhis2UrlParser';

interface DHIS2UrlImporterProps {
  onSQLGenerated: (sql: string) => void;
}

export default function DHIS2UrlImporter({ onSQLGenerated }: DHIS2UrlImporterProps) {
  const [url, setUrl] = useState('');
  const [parseStatus, setParseStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleParse = useCallback(() => {
    const parsed = parseDHIS2Url(url);

    if (!parsed) {
      setParseStatus({
        success: false,
        message: 'Invalid URL format. Please paste a valid DHIS2 API URL.',
      });
      return;
    }

    const sql = generateSQLFromParsedUrl(parsed);
    onSQLGenerated(sql);

    setParseStatus({
      success: true,
      message: `✅ Extracted ${parsed.dataElements.length} data elements, ${parsed.periods.length} periods, ${parsed.orgUnits.length} org units`,
    });
  }, [url, onSQLGenerated]);

  return (
    <div style={{ marginBottom: 16 }}>
      <h4>Quick Import from URL</h4>
      <Input.TextArea
        placeholder="Paste DHIS2 API URL here (e.g., https://play.dhis2.org/api/analytics?dimension=dx:...)"
        value={url}
        onChange={e => setUrl(e.target.value)}
        rows={3}
        style={{ marginBottom: 8 }}
      />
      <Button type="primary" onClick={handleParse} disabled={!url}>
        Parse & Build Query
      </Button>

      {parseStatus && (
        <Alert
          type={parseStatus.success ? 'success' : 'error'}
          message={parseStatus.message}
          style={{ marginTop: 8 }}
          closable
          onClose={() => setParseStatus(null)}
        />
      )}
    </div>
  );
}
```

3. **Integrate into SqlEditorLeftBar** ([SqlEditorLeftBar/index.tsx](superset-frontend/src/SqlLab/components/SqlEditorLeftBar/index.tsx:283)):
```typescript
import DHIS2UrlImporter from '../DHIS2UrlImporter';

// In render, add before DHIS2QueryBuilder:
{isDHIS2Database && (
  <>
    <DHIS2UrlImporter onSQLGenerated={handleInsertDHIS2SQL} />
    <div className="divider" />
    <DHIS2QueryBuilder onInsertSQL={handleInsertDHIS2SQL} />
    <div className="divider" />
  </>
)}
```

**Benefits**:
- Fast query creation from existing DHIS2 URLs
- Reduces manual data element selection
- Supports migration from DHIS2 Visualizer to Superset
- Works with URLs from any DHIS2 instance
- Auto-validates URL format

**Testing Examples**:

Full URL:
```
https://play.dhis2.org/api/analytics?dimension=dx:FTRrcoaog83;P3jJH5Tu5VC&dimension=pe:LAST_YEAR&dimension=ou:ImspTQPwCqd
```

Relative path:
```
api/analytics?dimension=dx:FTRrcoaog83;P3jJH5Tu5VC&dimension=pe:LAST_YEAR&dimension=ou:ImspTQPwCqd
```

Just parameters:
```
dimension=dx:FTRrcoaog83;P3jJH5Tu5VC&dimension=pe:LAST_YEAR&dimension=ou:ImspTQPwCqd
```

All generate:
```sql
SELECT * FROM analytics
/* DHIS2: dimension=dx:FTRrcoaog83;P3jJH5Tu5VC&dimension=pe:LAST_YEAR&dimension=ou:ImspTQPwCqd&displayProperty=NAME&skipMeta=false */
```

---

### Issue 0.5: Preview Data Doesn't Match Generated URL ❌
**Problem**: The preview shows different data than what the generated URL would return.

**Example**:
```
🔗 Generated API URL:
api/analytics?dimension=dx%3AFTRrcoaog83%3BP3jJH5Tu5VC%3BM62VHgYT2n0%3BFQ2o8UBlcrS...

📊 Data Sample:
Period  OrgUnit      Acute Flaccid Paralysis AFP new  Measles referrals
2024    Port Loko    2                                19
2024    Pujehun      1                                14
2024    Bonthe                                        14
```

**Issues**:
1. **Data mismatch**: Preview shows "Acute Flaccid Paralysis AFP new" and "Measles referrals" but the URL has 8 data elements (dx has 8 UIDs)
2. **URL encoding**: URL is encoded (`%3A` = `:`, `%3B` = `;`) making it hard to read and copy
3. **Cache/Hardcoded**: Unclear if preview is live data or cached/hardcoded

**Questions**:
- Is the preview data cached from a previous query?
- Is it hardcoded sample data?
- Why doesn't it match the current URL parameters?

**Solution Needed**:
1. **Execute actual query for preview**:
   - Use the exact URL parameters shown
   - Fetch live data from DHIS2 API
   - Show loading state while fetching
   - Display actual results (not cached)

2. **Show both encoded and decoded URLs**:
```
🔗 Generated API URL (for copying):
api/analytics?dimension=dx:FTRrcoaog83;P3jJH5Tu5VC;M62VHgYT2n0;FQ2o8UBlcrS;nymNRxmnj4z;V9bT6YUTrMZ;R1WAv9bVXff;avs8Dhz3OoG&dimension=pe:LAST_YEAR;THIS_YEAR;THIS_QUARTER;LAST_6_MONTHS;LAST_12_MONTHS&dimension=ou:YuQRtpLP10I;vWbkYPRmKyS;RzKeCma9qb1;Vth0fbpFcsO;at6UHUQatSo;bL4ooGhyHRQ;eIQbndfxQMb;TEQlaapDQoK&displayProperty=NAME&skipMeta=false

🔗 Encoded URL (for API calls):
api/analytics?dimension=dx%3AFTRrcoaog83%3BP3jJH5Tu5VC...
```

3. **Validate data matches URL**:
   - Count data elements in URL: 8 UIDs
   - Count columns in preview: Should be 8 data element columns + Period + OrgUnit = 10 total
   - If mismatch, show warning: "⚠️ Preview may not reflect current selection. Click Refresh."

4. **Add refresh button**:
```
📊 Data Preview (3 rows)  [🔄 Refresh]
```

**Technical Changes**:

**File**: `superset-frontend/src/features/datasets/AddDataset/DatasetPanel/DatasetPanel.tsx`

```typescript
// Current (wrong):
const previewData = useMemo(() => {
  return cachedData || hardcodedSample; // ❌ Using stale data
}, []);

// Should be (correct):
const previewData = useQuery({
  queryKey: ['dhis2-preview', dhis2Parameters],
  queryFn: async () => {
    const url = generateDHIS2URL(dhis2Parameters);
    const response = await fetchDHIS2Data(databaseId, url);
    return response.data;
  },
  enabled: !!dhis2Parameters,
});

// Show both URL formats
const decodedURL = decodeURIComponent(encodedURL);
const encodedURL = generateEncodedDHIS2URL(dhis2Parameters);
```

### Issue 1: Dataset Name Not Editable ❌
**Problem**: Dataset name is auto-loaded from selected table schema (e.g., "analytics"). Users cannot create multiple datasets from the same table or customize names.

**Current Workaround**:
1. Preview dataset successfully
2. Copy the API URL from preview
3. Paste into SQL Lab as manual query
4. Create dataset from SQL Lab
5. Manually rename dataset

**Example**:
```sql
SELECT *
FROM analytics /* DHIS2:
dimension=dx:jmWyJFtE7Af;yqBkn9CWKih&dimension=pe:LAST_YEAR;THIS_YEAR&dimension=ou:ImspTQPwCqd&displayProperty=NAME&skipMeta=false */
```

**Solution Needed**:
- Add editable dataset name field in Query Builder
- Allow multiple datasets from same table with different names
- Pre-populate with suggested name but allow editing

### Issue 2: Disorganized Data in Query Builder ❌
**Problem**: Query builder picks too much unorganized data. No grouping or filtering by programs/indicator groups.

**Current Approach (Wrong)**:
```
Fetches ALL data elements at once:
GET /api/dataElements?fields=id,displayName&paging=false

Result: 5000+ items in a flat list
User experience: Overwhelming, hard to find specific items
Loading time: Slow (several seconds)
```

**DHIS2 Data Visualizer Approach (Correct)**:

DHIS2's own Data Visualizer uses **two-level hierarchical organization**:

```
Level 1: Load Groups (fast - only ~20-50 items)
┌─────────────────────────────────┐
│ Data Element Groups:            │
│ ▶ ANC                          │  ← Click to expand
│ ▶ Child Health                 │
│ ▶ Delivery                     │
│ ▶ Immunization                 │
│ ▼ Malaria                      │  ← Expanded
│   ☐ Malaria confirmed cases    │  ← Items shown
│   ☐ Malaria suspected cases    │
│   ☐ Malaria deaths              │
│   ☐ Malaria severe cases        │
└─────────────────────────────────┘
```

**How DHIS2 Visualizer Works**:

1. **First Load - Groups Only** (20-50 items):
   ```
   GET /api/dataElementGroups?fields=id,displayName&paging=false
   ```

2. **User Clicks Group** → **Load Items** (~10-100 items):
   ```
   GET /api/dataElementGroups/{groupId}?fields=dataElements[id,displayName]
   ```

3. **User Selects Items**:
   ```
   ☑ Malaria confirmed cases (FTRrcoaog83)
   ☑ Malaria deaths (yqBkn9CWKih)
   ```

4. **Generate Dimension String**:
   ```
   dimension=dx:FTRrcoaog83;yqBkn9CWKih
   ```

**Key Benefits**:
- **Fast loading**: Only load what's needed
- **Easy navigation**: Clear hierarchy (Group > Items)
- **Scoped search**: Search within selected group
- **Maintains context**: Breadcrumb shows location
- **Lazy loading**: Items loaded on-demand

**API Endpoints Needed**:

```
# Level 1: Load Groups
GET /api/dataElementGroups?fields=id,displayName&paging=false
GET /api/indicatorGroups?fields=id,displayName&paging=false
GET /api/programs?fields=id,displayName&paging=false

# Level 2: Load Items in Group
GET /api/dataElementGroups/{groupId}?fields=dataElements[id,displayName]
GET /api/indicatorGroups/{groupId}?fields=indicators[id,displayName]
GET /api/programs/{programId}?fields=programIndicators[id,displayName]
```

**Comparison Table**:

| Aspect | Current (Wrong) | DHIS2 Visualizer (Correct) |
|--------|----------------|---------------------------|
| **Initial Load** | 5000+ data elements | 20-50 groups |
| **Loading Time** | 5-10 seconds | < 1 second |
| **User Experience** | Overwhelming flat list | Clear hierarchy |
| **Finding Items** | Scroll through thousands | Click group, see ~20 items |
| **Search** | Global (slow) | Within group (fast) |
| **Organization** | None | By domain/program |
| **Memory Usage** | High (all items loaded) | Low (lazy loading) |

**Solution Architecture**:

```
Component Structure:
├── DHIS2DataSelector
│   ├── Tab: Data Elements
│   │   ├── Load groups: /api/dataElementGroups
│   │   └── On click: Load items in group
│   ├── Tab: Indicators
│   │   ├── Load groups: /api/indicatorGroups
│   │   └── On click: Load items in group
│   └── Tab: Program Indicators
│       ├── Load programs: /api/programs
│       └── On click: Load program indicators
```

**UI Flow Example**:

```
Step 1: User sees groups
┌──────────────────────────────┐
│ Data Element Groups:         │
│ ▶ ANC (23 items)            │
│ ▶ Child Health (45 items)   │
│ ▶ Malaria (12 items)        │
└──────────────────────────────┘

Step 2: User clicks "Malaria"
┌──────────────────────────────┐
│ ← Back to Groups             │
│ Malaria (12 items)           │
│ 🔍 Search in Malaria...      │
│ ☐ Confirmed cases           │
│ ☐ Deaths                    │
│ ☐ Inpatient cases           │
│ ☐ Outpatient cases          │
└──────────────────────────────┘

Step 3: User selects items
☑ Confirmed cases
☑ Deaths

Step 4: Auto-generate dimension
dimension=dx:FTRrcoaog83;yqBkn9CWKih
```

**Implementation Strategy**:
- Don't fetch all data elements upfront
- Load groups first (fast)
- Load items only when group is selected (lazy)
- Cache loaded items per group
- Use same pattern for all three types (data elements, indicators, program indicators)

**Apply Same Pattern to Periods and OrgUnits**:

**Periods Hierarchy**:
```
Level 1: Period Types
├── Relative Periods
│   ├── Years (LAST_YEAR, THIS_YEAR)
│   ├── Quarters (LAST_QUARTER, THIS_QUARTER)
│   ├── Months (LAST_12_MONTHS, LAST_6_MONTHS)
│   └── Weeks (LAST_WEEK, THIS_WEEK)
└── Fixed Periods
    ├── Years → 2024, 2023, 2022...
    ├── Quarters → 2024Q1, 2024Q2, 2024Q3...
    └── Months → Jan 2024, Feb 2024...
```

**UI for Periods**:
```
Step 1: Choose period type
┌────────────────────────────┐
│ Period Type:               │
│ ○ Relative Periods         │
│ ● Fixed Periods            │
└────────────────────────────┘

Step 2: Select specific periods
┌────────────────────────────┐
│ Fixed Periods              │
│ ▶ Years (show last 10)     │
│ ▼ Quarters                 │
│   ☑ 2024 Q1               │
│   ☑ 2024 Q2               │
│   ☐ 2024 Q3               │
│   ☐ 2024 Q4               │
│ ▶ Months                   │
└────────────────────────────┘
```

**OrgUnits Hierarchy**:
```
Level 1: Selection Method
├── Quick Select
│   ├── USER_ORGUNIT (My org unit)
│   ├── USER_ORGUNIT_CHILDREN (+ children)
│   └── USER_ORGUNIT_GRANDCHILDREN (+ grandchildren)
├── Organisation Unit Levels
│   ├── National (level 1)
│   ├── District (level 2)
│   └── Facility (level 3)
└── Organisation Unit Groups
    ├── Hospitals
    ├── Health Centers
    └── Community Health Posts

Level 2: Select Specific Units (if not using quick select)
├── National: Sierra Leone
├── Districts: Bo, Bombali, Bonthe...
└── Facilities: Port Loko CHC, Pujehun Hospital...
```

**UI for OrgUnits**:
```
Step 1: Choose selection method
┌────────────────────────────┐
│ Organisation Units:        │
│ [User Org Unit]            │
│ [+ Children] [+ Grand]     │
│                            │
│ OR Browse by:              │
│ ○ Levels                   │
│ ● Groups                   │
└────────────────────────────┘

Step 2: Select from group/level
┌────────────────────────────┐
│ Org Unit Groups            │
│ ▶ Hospitals                │
│ ▼ Health Centers           │
│   ☑ Port Loko CHC         │
│   ☐ Pujehun CHC           │
│   ☑ Bonthe CHC            │
│ ▶ Community Posts          │
└────────────────────────────┘
```

**API Endpoints for OrgUnits**:
```
# Quick info
GET /api/me?fields=organisationUnits[id,displayName]

# Organisation unit levels
GET /api/organisationUnitLevels?fields=id,displayName,level

# Organisation units by level
GET /api/organisationUnits?fields=id,displayName,level&filter=level:eq:2

# Organisation unit groups
GET /api/organisationUnitGroups?fields=id,displayName&paging=false

# OrgUnits in group
GET /api/organisationUnitGroups/{groupId}?fields=organisationUnits[id,displayName]
```

### Issue 3: OrgUnit X-Axis Display ❌ CRITICAL
**Problem**: Charts fail with error when using OrgUnits on X-axis.

**Actual Error**:
```
DB engine Error
Could not convert string 'Port LokoPujehunBonthe' to numeric
This may be triggered by: Issue 1011 - Superset encountered an unexpected error.
```

**Root Cause - TWO ISSUES**:

1. **OrgUnit names concatenated without separators**: 'Port Loko' + 'Pujehun' + 'Bonthe' → 'Port LokoPujehunBonthe'
   - This happens during pivoting when multiple org units have same period
   - Should be separate rows, not concatenated string

2. **Column detected as numeric instead of string**: Superset tries to convert to numeric
   - Likely due to column metadata not properly set as categorical/string
   - Backend might be sending wrong column type

**Technical Analysis**:

The DHIS2 analytics response is pivoted from long format to wide format in [dhis2_dialect.py:331-462](superset/db_engine_specs/dhis2_dialect.py#L331-L462):

**DHIS2 API Response (Long Format)**:
```
dx          | pe   | ou          | value
------------|------|-------------|------
Malaria_DX1 | 2024 | Sierra_OU1  | 150
Malaria_DX1 | 2024 | PortLoko_OU2| 45
Malaria_DX2 | 2024 | Sierra_OU1  | 200
Malaria_DX2 | 2024 | PortLoko_OU2| 67
```

**After Pivoting (Wide Format for Superset)**:
```
Period | OrgUnit      | Malaria_DX1 | Malaria_DX2
-------|--------------|-------------|-------------
2024   | Sierra Leone | 150         | 200
2024   | Port Loko    | 45          | 67
```

In this structure, `OrgUnit` SHOULD work on the X-axis because:
1. It's a proper column (not nested)
2. It contains display names (from `get_name()` function on line 360)
3. It's categorical text data

**Possible Issues**:

1. **UIDs Instead of Names**: The `get_name()` function might not find the name in metadata
   - Check: `items = metadata.get("items", {})` on line 355
   - If metadata is incomplete, UIDs are returned as fallback

2. **Column Type Detection**: Superset might detect OrgUnit as numeric instead of string
   - Check: Column type in `get_columns()` (line 736-820)
   - Currently all columns default to `types.String()` which is correct

3. **Empty/Null OrgUnits**: If `ou` dimension is missing from some rows
   - Check: `ou_idx = col_map.get("ou")` on line 369
   - If `ou_idx` is None, code doesn't handle it gracefully

**Debugging Steps**:

1. **Check metadata in response**:
   - Log `metadata.get("items", {})` to see if OrgUnit names are present
   - Add logging in `get_name()` function on line 357

2. **Verify column types**:
   - Check that `OrgUnit` column is being set as `types.String()` not `types.Numeric()`
   - Check Superset's column type detection in frontend

3. **Test data structure**:
   - Print pivoted rows to verify OrgUnit column has proper display names
   - Verify no UIDs are leaking through

**Solution - Fix Pivoting Logic**:

The issue is in how the pivot data structure is built (line 413-436 in dhis2_dialect.py). The current code:

```python
# Build pivot structure: {(period, orgUnit): {dataElement: value}}
pivot_data = {}
for row in rows_data:
    dx = row[dx_idx]
    pe = row[pe_idx]
    ou = row[ou_idx]
    val = row[value_idx]

    key = (pe, ou)  # ← This creates composite key
    if key not in pivot_data:
        pivot_data[key] = {}
    pivot_data[key][dx] = val
```

**The Problem**: Using `(period, orgUnit)` as the key is correct! This SHOULD create separate rows. The concatenation must be happening elsewhere.

**Check These Locations**:

1. **In `get_name()` function (line 357-360)**:
   ```python
   def get_name(uid: str) -> str:
       item = items.get(uid, {})
       return item.get("name", uid)
   ```
   - Is this being called correctly for each OU separately?
   - Or is it receiving concatenated UIDs like 'OU1OU2OU3'?

2. **In dimension splitting (line 1146)**:
   ```python
   dimension_parts = re.split(r';(?=(?:dx|pe|ou):)', value)
   ```
   - Is the OU dimension being split correctly?
   - Check if 'ou:OU1;OU2;OU3' is being treated as one value or three

3. **In row building (line 456-460)**:
   ```python
   for (pe, ou) in sorted(pivot_data.keys()):
       row = [get_name(pe), get_name(ou)]  # ← Is get_name() correct here?
   ```

**Immediate Fix - Add Column Type Metadata**:

In `get_columns()` method (line 736), explicitly mark OrgUnit as STRING:

```python
def get_columns(self, connection, table_name, schema=None, **kw):
    # After getting columns from anywhere...

    # Explicitly mark Period and OrgUnit as STRING to prevent numeric conversion
    for col in columns:
        if col["name"] in ["Period", "OrgUnit", "period", "orgUnit"]:
            col["type"] = types.String()
            col["is_dttm"] = False  # Not a datetime

    return columns
```

**Long-term Fix - Debug Concatenation**:

Add logging to identify where concatenation happens:

```python
# In normalize_analytics, before pivoting
logger.info(f"Raw ou values from API: {[row[ou_idx] for row in rows_data[:5]]}")

# After get_name
logger.info(f"Resolved ou names: {[get_name(row[ou_idx]) for row in rows_data[:5]]}")

# In pivoted rows
logger.info(f"First pivoted row OrgUnit: {pivoted_rows[0][1] if pivoted_rows else 'none'}")
```

**Related to**: Dynamic column metadata issue (DHIS2_CHART_IMPLEMENTATION_COMPLETE.md)

## Proposed Solutions

### Solution 1: Editable Dataset Names in Query Builder

**File to Modify**: `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/index.tsx`

**Changes**:
1. Add dataset name input field at the top
2. Pre-populate with format: `{program/group name} - {period} - {org unit}`
3. Allow editing at any time before creation
4. Store in dataset metadata

**UI Mockup**:
```
┌─────────────────────────────────────────┐
│ Dataset Name:                           │
│ [Malaria Indicators - Last Year - SL] │  ← Editable
├─────────────────────────────────────────┤
│ Program / Indicator Group:              │
│ [Select...]                     ▼       │
├─────────────────────────────────────────┤
│ Data Elements / Indicators:             │
│ ☑ Malaria confirmed cases               │
│ ☑ Malaria deaths                        │
└─────────────────────────────────────────┘
```

### Solution 2: Hierarchical Data Selection

**New Component**: `GroupedDataSelector.tsx`

**Features**:
- Tab system: "Data Elements" | "Indicators" | "Program Indicators"
- Each tab shows groups first, then items within selected group
- Breadcrumb navigation: All Groups > Malaria > Confirmed Cases
- Search works within selected group or globally

**Data Flow**:
```
1. Load groups: GET /api/dataElementGroups
2. User selects group
3. Load items: GET /api/dataElementGroups/{groupId}/dataElements
4. User selects items
5. Items added to query
```

**UI Structure**:
```
┌─────────────────────────────────────────┐
│ [Data Elements] [Indicators] [Program]  │  ← Tabs
├─────────────────────────────────────────┤
│ 🔍 Search...                            │
├─────────────────────────────────────────┤
│ Groups:                                 │
│ > Malaria                               │  ← Click to expand
│ > Maternal Health                       │
│ > Child Health                          │
├─────────────────────────────────────────┤
│ Selected: Malaria >                     │  ← Breadcrumb
│ ☑ Malaria confirmed cases               │
│ ☐ Malaria suspected cases               │
│ ☑ Malaria deaths                        │
└─────────────────────────────────────────┘
```

### Solution 3: Fix OrgUnit Column Display

**Backend Changes** (`dhis2_dialect.py`):

1. **Ensure display names in response**:
```python
def normalize_analytics(data: dict) -> tuple[list[str], list[tuple]]:
    # ... existing code ...

    # Always use display names for org units (not UIDs)
    for (pe, ou) in sorted(pivot_data.keys()):
        row = [
            get_name(pe),      # Period display name
            get_name(ou),      # ← OrgUnit display name (NOT UID)
        ]
        # ... rest of row ...
```

2. **Add explicit type hints for OrgUnit column**:
```python
# In column description
{
    'name': 'OrgUnit',
    'type': 'VARCHAR',  # ← Explicitly text type
    'is_dttm': False,
    'nullable': True,
}
```

**Frontend Changes** (`datasets/AddDataset/Footer/index.tsx`):

3. **Add column metadata hints**:
```typescript
// When creating dataset, add metadata about column types
const columnMetadata = {
  Period: { type: 'VARCHAR', groupable: true },
  OrgUnit: { type: 'VARCHAR', groupable: true },  // ← Categorical
  // ... data elements are numeric
};
```

## Implementation Plan

### Phase 1: Quick Fixes (Priority 1) 🔥
- [ ] Add editable dataset name field to Query Builder
- [ ] Fix OrgUnit display names in response
- [ ] Add explicit VARCHAR type for OrgUnit column

**Time**: 2-3 hours
**Impact**: Immediate usability improvements

### Phase 2: Grouped Data Selection (Priority 2) 🔧
- [ ] Create API endpoints for groups
  - `/api/v1/database/<id>/dhis2/dataElementGroups`
  - `/api/v1/database/<id>/dhis2/indicatorGroups`
  - `/api/v1/database/<id>/dhis2/programs`
- [ ] Create `GroupedDataSelector` component
- [ ] Integrate into Query Builder
- [ ] Add breadcrumb navigation
- [ ] Add group-level search

**Time**: 1-2 days
**Impact**: Much better UX for finding data elements

### Phase 3: SQL Lab Query Builder Enhancement (Priority 3) ⭐
- [ ] Add same grouped selection to SQL Lab builder
- [ ] Add dataset name field to SQL Lab
- [ ] Sync UX between Query Builder and SQL Lab

**Time**: 1 day
**Impact**: Consistent experience across all entry points

### Phase 4: Dynamic Column Discovery (Priority 4) 🚀
- [ ] Make DHIS2 datasets ignore cached metadata
- [ ] Fetch columns dynamically from API response
- [ ] No more "Sync columns from source" needed

**Time**: 2-3 days
**Impact**: Eliminates major source of errors

## API Endpoint Design

### Backend API: DHIS2 Metadata

**New File**: `superset/databases/dhis2_api.py`

```python
from flask import Blueprint, request
from superset.databases.dhis2.client import DHIS2Client

dhis2_api = Blueprint('dhis2_api', __name__)

@dhis2_api.route('/api/v1/database/<int:database_id>/dhis2/dataElementGroups')
def get_data_element_groups(database_id):
    """Get list of data element groups"""
    db = get_database(database_id)
    client = DHIS2Client(db)
    groups = client.get('/api/dataElementGroups?fields=id,displayName&paging=false')
    return jsonify(groups)

@dhis2_api.route('/api/v1/database/<int:database_id>/dhis2/dataElementGroups/<group_id>')
def get_data_elements_in_group(database_id, group_id):
    """Get data elements in a group"""
    db = get_database(database_id)
    client = DHIS2Client(db)
    elements = client.get(f'/api/dataElementGroups/{group_id}?fields=dataElements[id,displayName]')
    return jsonify(elements)

# Similar endpoints for indicators, programs...
```

### Frontend API Client

**New File**: `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/api.ts`

```typescript
import { SupersetClient } from '@superset-ui/core';

export interface DHIS2Group {
  id: string;
  displayName: string;
}

export interface DHIS2DataElement {
  id: string;
  displayName: string;
}

export async function fetchDataElementGroups(databaseId: number): Promise<DHIS2Group[]> {
  const response = await SupersetClient.get({
    endpoint: `/api/v1/database/${databaseId}/dhis2/dataElementGroups`,
  });
  return response.json.dataElementGroups;
}

export async function fetchDataElementsInGroup(
  databaseId: number,
  groupId: string,
): Promise<DHIS2DataElement[]> {
  const response = await SupersetClient.get({
    endpoint: `/api/v1/database/${databaseId}/dhis2/dataElementGroups/${groupId}`,
  });
  return response.json.dataElements;
}
```

## Testing Checklist

### Dataset Name
- [ ] Can edit dataset name before creation
- [ ] Name persists after creation
- [ ] Can create multiple datasets with different names from same table
- [ ] Name shows in dataset list

### Grouped Selection
- [ ] Can browse data element groups
- [ ] Can select group and see its data elements
- [ ] Can search within group
- [ ] Breadcrumb shows current location
- [ ] Selected items show count
- [ ] Can navigate back to all groups

### OrgUnit Display
- [ ] OrgUnit shows display names (not UIDs)
- [ ] Multiple org units show separately (not concatenated)
- [ ] OrgUnit usable on x-axis in charts
- [ ] OrgUnit treated as categorical (text)

### SQL Lab Integration
- [ ] Query builder available in SQL Lab
- [ ] Same UX as dataset creation
- [ ] Insert SQL works correctly
- [ ] Can edit generated SQL manually

## Success Metrics

1. **Usability**: Users can create properly named datasets without workarounds
2. **Discoverability**: Users can find data elements by group/program
3. **Charts**: OrgUnit works correctly on x-axis
4. **Error Reduction**: 90%+ fewer metadata sync issues

## Complete Dataset Creation Flow (After All Fixes)

This section describes the ideal end-to-end flow for creating a DHIS2 dataset after implementing all the fixes documented above.

### Entry Point 1: Dataset Creation (Datasets → + Dataset)

**Step 1: Database Selection**
```
┌─────────────────────────────────────────────────┐
│ Create Dataset                                  │
├─────────────────────────────────────────────────┤
│ Database: [DHIS2 - Uganda HMIS] ▼              │
│ Schema:   [dhis2]                ▼              │
└─────────────────────────────────────────────────┘
```

**Step 2: DHIS2 Query Builder Opens (Left Sidebar)**

The same organized query builder from Issue #0 and #2:

```
┌─────────────────────────────────────────┐
│ DHIS2 Query Builder                     │
├─────────────────────────────────────────┤
│ Dataset Name: [                       ] │  ← Issue #1: Editable name
│ Suggested: Malaria - Last Year          │
├─────────────────────────────────────────┤
│ 📊 Data (3 tabs)                        │
│                                         │
│ [Data Elements] [Indicators] [Programs]│
│                                         │
│ Data Element Groups:                    │  ← Issue #2: Hierarchical
│ ▶ ANC (23)                             │
│ ▼ Malaria (12)                         │
│   ☑ Confirmed cases                    │
│   ☑ Deaths                             │
│   ☑ Severe cases                       │
│   ☐ Suspected cases                    │
│ ▶ Child Health (45)                    │
│                                         │
│ Selected: 3 data elements               │
├─────────────────────────────────────────┤
│ 📅 Period                               │
│                                         │
│ Period Type:                            │
│ ● Relative  ○ Fixed                    │
│                                         │
│ ▶ Years                                │
│ ▼ Quarters                             │
│   ☑ LAST_QUARTER                       │
│   ☑ THIS_QUARTER                       │
│ ▶ Months                               │
│                                         │
│ Selected: 2 periods                     │
├─────────────────────────────────────────┤
│ 🏥 Organisation Units                   │
│                                         │
│ Quick Select:                           │
│ [User Org Unit] [+ Children]           │
│                                         │
│ OR Browse:                              │
│ ● Groups  ○ Levels  ○ Tree            │
│                                         │
│ ▼ Health Centers (34)                  │
│   ☑ Port Loko CHC                      │
│   ☑ Pujehun CHC                        │
│   ☑ Bonthe CHC                         │
│ ▶ Hospitals (12)                       │
│                                         │
│ Selected: 3 org units                   │
└─────────────────────────────────────────┘
```

**Step 3: Live Preview (Right Panel)**

```
┌─────────────────────────────────────────────────┐
│ 🔗 Generated API URL                            │
│ ┌─────────────────────────────────────────────┐ │
│ │ Readable Format: [📋 Copy]                   │ │
│ │ api/analytics?                                │ │
│ │   dimension=dx:FTRrcoaog83;yqBkn9CWKih;...  │ │
│ │   &dimension=pe:LAST_QUARTER;THIS_QUARTER    │ │
│ │   &dimension=ou:YuQRtpLP10I;vWbkYPRmKyS;... │ │
│ │   &displayProperty=NAME                       │ │
│ │   &skipMeta=false                            │ │
│ │                                               │ │  ← Issue #0.5
│ │ Encoded Format: [📋 Copy]                    │ │     Fixed URLs
│ │ api/analytics?dimension=dx%3A...             │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ 📊 Data Preview (Loading...)  [🔄 Refresh]     │  ← Issue #0.5
│ ┌─────────────────────────────────────────────┐ │     Live data
│ │ Period  OrgUnit      Confirmed  Deaths  ... │ │
│ │ 2024Q3  Port Loko    45         2       ... │ │
│ │ 2024Q3  Pujehun      23         1       ... │ │
│ │ 2024Q3  Bonthe       12         0       ... │ │
│ │ 2024Q4  Port Loko    52         3       ... │ │
│ │ 2024Q4  Pujehun      28         1       ... │ │
│ │ 2024Q4  Bonthe       15         1       ... │ │
│ └─────────────────────────────────────────────┘ │
│ ✅ 6 rows returned                               │
│ ✅ URL and data match                           │
│                                                  │
│ [Cancel]  [Create Dataset and Create Chart]    │
└─────────────────────────────────────────────────┘
```

**Step 4: Dataset Created Successfully**

```
✅ Dataset "Malaria - Last Quarter" created successfully!

Dataset properties:
- Name: Malaria - Last Quarter
- Type: Virtual (DHIS2)
- Columns: Period, OrgUnit, Confirmed cases, Deaths, Severe cases
- SQL stored with DHIS2 parameters
- Ready for charting
```

### Entry Point 2: SQL Lab (SQL → SQL Lab)

**Step 1: Select DHIS2 Database**

```
┌─────────────────────────────────────────────────┐
│ SQL Editor                                      │
├─────────────────────────────────────────────────┤
│ Database: [DHIS2 - Uganda HMIS] ▼              │
│                                                  │
│ -- SQL Editor opens                             │
└─────────────────────────────────────────────────┘
```

**Step 2: DHIS2 Query Builder Appears (Same as Dataset Creation)**

The left sidebar automatically shows the DHIS2 Query Builder when a DHIS2 database is selected:

```
┌───────────────────┬─────────────────────────────┐
│ DHIS2 Builder     │ SQL Editor                  │
│                   │                             │
│ [Same UI as       │ 1  SELECT * FROM analytics  │
│  dataset          │ 2  /* DHIS2:                │
│  creation         │ 3    dimension=dx:...       │
│  shown above]     │ 4    &dimension=pe:...      │
│                   │ 5    &dimension=ou:...      │
│                   │ 6    &displayProperty=NAME  │
│ [Insert SQL]      │ 7    &skipMeta=false        │
│                   │ 8  */                       │
│                   │                             │
│                   │ [▶ Run]  [Save as Dataset]  │
└───────────────────┴─────────────────────────────┘
```

**Step 3: User Interaction**

```
User selects items in builder
       ↓
Clicks [Insert SQL]
       ↓
SQL automatically inserted in editor
       ↓
User clicks [▶ Run] to preview
       ↓
User clicks [Save as Dataset]
       ↓
Dataset created with proper name
```

### Entry Point 3: Editing Existing Dataset

**Step 1: Edit Dataset**

```
Datasets → Find dataset → [Edit]
       ↓
Query Builder opens with CURRENT selections pre-populated
       ↓
User can:
  - Add/remove data elements
  - Change periods
  - Change org units
  - Rename dataset
       ↓
Click [Save]
       ↓
Dataset parameters updated in extra field
       ↓
Columns automatically synced (no manual sync needed - Issue #4)
```

### Key Improvements Summary

**Before (Current State)**:
```
1. User manually types UIDs: jmWyJFtE7Af (hard)
2. Scrolls through 5000+ data elements (overwhelming)
3. Dataset named "analytics" (can't customize)
4. Preview shows wrong data (confusing)
5. Charts fail with stale metadata (broken)
6. Must manually sync columns (tedious)
```

**After (With All Fixes)**:
```
1. ✅ User sees "Malaria confirmed cases" (clear)
2. ✅ Clicks "Malaria" group → sees 12 items (organized)
3. ✅ Names dataset "Malaria - Last Quarter" (customizable)
4. ✅ Preview shows exact data for current selection (accurate)
5. ✅ Charts work immediately (reliable)
6. ✅ Columns auto-sync from API response (automatic)
```

### Complete API Flow

```
Frontend (Query Builder)
    ↓
1. Load Groups: GET /api/dataElementGroups
    ↓ (User clicks "Malaria")
2. Load Items:  GET /api/dataElementGroups/{id}?fields=dataElements[id,displayName]
    ↓ (User selects 3 data elements)
3. Generate dimension string: dx:FTRrcoaog83;yqBkn9CWKih;A2VfEfPflHV
    ↓
4. Preview: POST /api/v1/sqllab/execute/
    Body: {
      database_id: 5,
      sql: "SELECT * FROM analytics /* DHIS2: dimension=dx:... */"
    }
    ↓
5. Backend: Extract parameters from SQL comment
    ↓
6. Backend: Query DHIS2 API with parameters
    ↓
7. Backend: Normalize response (pivot, type convert)
    ↓
8. Backend: Return data + column metadata
    ↓
9. Frontend: Display preview
    ↓ (User clicks "Create Dataset")
10. Frontend: POST /api/v1/dataset/
    Body: {
      database_id: 5,
      table_name: "Malaria - Last Quarter",
      sql: "SELECT * FROM analytics /* DHIS2: dimension=dx:... */",
      extra: {
        dhis2_params: {
          analytics: "dimension=dx:...&dimension=pe:...&dimension=ou:..."
        }
      }
    }
    ↓
11. Backend: Create virtual dataset with parameters in extra field
    ↓
12. Backend: Fetch metadata from DHIS2 (columns)
    ↓
13. Backend: Store dataset in database
    ↓
14. Frontend: Redirect to chart creation
```

### Chart Creation Flow (Post-Dataset)

```
Charts → + Chart → Select dataset
    ↓
Superset loads dataset
    ↓
Superset reads SQL with DHIS2 parameters
    ↓
Parameters loaded from extra field (Issue #0 fix)
    ↓
Superset builds chart query with dimensions
    ↓
Backend executes DHIS2 API call with parameters
    ↓
Data returned with display names (Issue #3 fix)
    ↓
Chart rendered correctly
    ↓
User configures:
  - X-axis: OrgUnit (categorical text)
  - Metrics: SUM(Confirmed cases), SUM(Deaths)
  - Breakdown: Period
    ↓
Chart displays properly
```

---

## Issue 0.6: Period Selection Limit (Max 5) ✅ FIXED

**Problem**: Period selector limited users to only 5 periods, which was too restrictive for many use cases.

**Symptoms**:
- User sees warning: "Maximum periods selected"
- Cannot select more than 5 periods across all tabs (Years, Quarters, Months, Relative)
- Warning message: "You can select up to 5 periods. Remove a period to add another."
- Period selector shows "Select time periods for your data (max 5)"

**Root Cause**:
The `MAX_PERIODS = 5` constant in `PeriodSelector.tsx` artificially limited selections.

**Solution Implemented**:

1. **Removed MAX_PERIODS constant** (line 26):
```typescript
// Before:
const MAX_PERIODS = 5;

// After:
// Removed MAX_PERIODS limit - users can select as many periods as needed
```

2. **Removed limit checks and warnings**:
- Removed `isLimitReached` checks
- Removed `remainingSlots` calculations
- Removed Alert warnings about limit
- Removed disabled states when limit reached

3. **Updated onChange handlers** (all tabs):
```typescript
// Before:
onChange([...otherPeriods, ...selectedYears].slice(0, MAX_PERIODS));

// After:
onChange([...otherPeriods, ...selectedYears]);
```

4. **Increased maxTagCount** for better display:
```typescript
maxTagCount={10}  // Was 5, now 10 for better visibility
```

5. **Updated display text**:
```typescript
// Before:
{t('Selected')} ({value.length}/{MAX_PERIODS}):

// After:
{t('Selected')} ({value.length}):
```

6. **Removed "(max 5)" from description** in `DHIS2ParameterBuilder/index.tsx`:
```typescript
// Before:
{t('Select time periods for your data (max 5)')}

// After:
{t('Select time periods for your data')}
```

**Files Modified**:
- `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/PeriodSelector.tsx`
- `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/index.tsx`

**Impact**:
- ✅ Users can select unlimited periods
- ✅ Better support for trend analysis over many time periods
- ✅ No more artificial restrictions
- ✅ Consistent with DHIS2's flexible period selection

---

## Issue 0.7: Data Element Filter Error ✅ FIXED

**Problem**: Typing in the Data (dx) field caused a JavaScript error that broke filtering.

**Error Message**:
```
ERROR
_option$children.toLowerCase is not a function
TypeError: _option$children.toLowerCase is not a function
    at filterOption (DHIS2ParameterBuilder/index.tsx:358:2742)
```

**Root Cause**:
The `filterOption` function assumed `option?.children` was always a string, but it could be a React element or other type.

**Original Code** (line 482-484):
```typescript
filterOption={(input, option) =>
  (option?.children as string)?.toLowerCase().includes(input.toLowerCase())
}
```

**Problem**: Type assertion `as string` doesn't actually convert the value—it just tells TypeScript to treat it as a string. If `children` is actually a React element (like a disabled group header), calling `toLowerCase()` fails.

**Solution Implemented**:

Added type checking before calling `toLowerCase()`:

```typescript
filterOption={(input, option) => {
  const children = option?.children;
  if (typeof children === 'string') {
    return children.toLowerCase().includes(input.toLowerCase());
  }
  return false;
}}
```

**Why This Works**:
- ✅ Runtime type check ensures `children` is actually a string
- ✅ Returns `false` for non-string children (like group headers)
- ✅ Prevents error when typing in search field
- ✅ Maintains search functionality for actual data element options

**Files Modified**:
- `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/index.tsx` (line 482-488)

**Impact**:
- ✅ Search/filter works correctly
- ✅ No more JavaScript errors when typing
- ✅ Better user experience
- ✅ Proper TypeScript type safety

---

## Issue 0.5 Enhancement: Preview Data Refresh Button ✅ IMPROVED

**Enhancement**: Added refresh functionality to preview modal to fetch latest data.

**Context**:
The preview already fetched live data, but there was no way to re-fetch if:
- User changed selections after opening preview
- Data changed in DHIS2
- User wanted to verify current parameters

**Solution Implemented**:

1. **Extracted preview logic into reusable function** (line 413-527):
```typescript
const fetchPreviewData = async () => {
  // ... builds parameters from current selections
  // ... fetches live data via SQL Lab API
  // ... updates preview modal state
};
```

2. **Added refresh state**:
```typescript
const [isRefreshing, setIsRefreshing] = useState(false);
```

3. **Updated Preview Data button** to use new function:
```typescript
<Button
  type="primary"
  onClick={fetchPreviewData}
  loading={isRefreshing}
  disabled={selectedData.length === 0}
>
  {t('Preview Data')}
</Button>
```

4. **Added Refresh button in modal footer**:
```typescript
footer={[
  <Button
    key="refresh"
    onClick={fetchPreviewData}
    loading={isRefreshing}
    icon={<span>🔄</span>}
  >
    Refresh Data
  </Button>,
  // ... Copy URL and Close buttons
]}
```

5. **Updated helper text**:
```typescript
{t('Click to preview live data and see the generated API URL')}
```

**Files Modified**:
- `superset-frontend/src/features/datasets/AddDataset/DHIS2ParameterBuilder/index.tsx`

**Impact**:
- ✅ Users can refresh preview without closing modal
- ✅ Confirms data is live and matches current selections
- ✅ Better developer experience for testing
- ✅ Cleaner code with extracted function

**How It Works**:
1. User clicks "Preview Data" → fetches data based on current selections
2. Preview modal opens showing live data + API URL
3. User can click "Refresh Data" button to re-fetch with latest selections
4. Loading state shown during refresh
5. Table updates with fresh data

---

## Notes

- All changes should be backward compatible
- Existing datasets should continue to work
- User training needed for new grouped selection UI
- Consider adding tooltips/help text for new features
- The flow should feel natural and similar to DHIS2 Data Visualizer
- Minimize clicks and cognitive load for users
