# DHIS2 SQL Lab Query Builder - Implementation Plan

## Goal
Add a visual DHIS2 parameter builder in SQL Lab that automatically generates the SQL comment with dimension parameters as users make selections, similar to the query builder experience in dataset creation.

## User Experience

### Current (Manual)
Users must manually type:
```sql
SELECT * FROM analytics
/* DHIS2: dimension=dx:FTRrcoaog83;FQ2o8UBlcrS&dimension=pe:LAST_YEAR&dimension=ou:UR31R1ogoal */
```

### Proposed (Visual)
1. User clicks "DHIS2 Query Builder" button in SQL Lab
2. Panel opens with parameter selectors
3. User selects data elements, periods, org units visually
4. SQL comment auto-generates in real-time
5. User clicks "Insert SQL" to add to query editor

## UI Design

### Location Options

#### Option 1: Left Panel Tab (Recommended ⭐)
- Add new tab next to "Tables" tab in SQL Lab left panel
- Tab labeled "DHIS2 Builder" or with DHIS2 icon
- Shows parameter builder when DHIS2 database is selected
- Hides when non-DHIS2 database selected

**Pros:**
- Consistent with existing SQL Lab UI patterns
- Always visible when working with DHIS2
- Doesn't clutter the main editor area

**Cons:**
- Takes up more permanent screen space

#### Option 2: Toolbar Button + Modal
- Add "DHIS2 Builder" button to SQL Lab toolbar
- Opens modal/drawer with parameter builder
- Modal has "Insert SQL" button to add to editor

**Pros:**
- Doesn't take permanent screen space
- Can be larger and more detailed

**Cons:**
- Less discoverable
- Requires extra click to open

### Component Structure

```
SqlLab/
├── components/
│   ├── DHIS2QueryBuilder/          # New component
│   │   ├── index.tsx               # Main container
│   │   ├── DataElementSelector.tsx # Multi-select for data elements
│   │   ├── PeriodSelector.tsx      # Period picker (relative + fixed)
│   │   ├── OrgUnitSelector.tsx     # Org unit tree/dropdown
│   │   ├── ParameterPreview.tsx    # Shows generated SQL comment
│   │   └── types.ts                # TypeScript interfaces
│   └── LeftPanel/
│       └── index.tsx               # Add DHIS2 tab here
```

## Component Details

### 1. DHIS2QueryBuilder (Main Container)

**State:**
```typescript
interface DHIS2Parameters {
  dataElements: string[];      // UIDs
  periods: string[];           // Period codes or dates
  orgUnits: string[];          // UIDs
  displayProperty: 'NAME' | 'SHORT_NAME' | 'CODE';
  skipMeta: boolean;
}
```

**Features:**
- Detect current database (show only for DHIS2)
- Real-time SQL generation
- "Insert at Cursor" button
- "Replace Query" button
- "Clear All" button
- Save/load parameter templates

### 2. DataElementSelector

**Features:**
- Search/filter data elements by name
- Group by data element groups (optional)
- Multi-select with checkboxes
- Show UID and display name
- Recently used data elements at top

**API Call:**
```
GET /api/dataElements?fields=id,displayName,dataElementGroups[id,displayName]&paging=false
```

**UI:**
```
┌─────────────────────────────────────┐
│ 🔍 Search data elements...          │
├─────────────────────────────────────┤
│ ☑ Acute Flaccid Paralysis (AFP) new│
│   FTRrcoaog83                       │
│ ☐ Measles referrals                 │
│   r6nrJANOqMw                       │
│ ☐ Malaria confirmed cases           │
│   abc123xyz                         │
└─────────────────────────────────────┘
   3 selected
```

### 3. PeriodSelector

**Features:**
- Tabs: "Relative Periods" | "Fixed Periods"
- Relative: Checkboxes for common periods
  - THIS_YEAR, LAST_YEAR
  - THIS_QUARTER, LAST_QUARTER
  - LAST_12_MONTHS, LAST_6_MONTHS, LAST_3_MONTHS
  - THIS_MONTH, LAST_MONTH
- Fixed: Date pickers for specific periods
  - Year: 2024, 2023, 2022...
  - Quarter: 2024Q1, 2024Q2...
  - Month: 202401, 202402...

**UI:**
```
┌─────────────────────────────────────┐
│ [Relative] [Fixed]                  │
├─────────────────────────────────────┤
│ ☑ LAST_YEAR                         │
│ ☐ THIS_YEAR                         │
│ ☐ LAST_12_MONTHS                    │
│ ☐ LAST_6_MONTHS                     │
│                                     │
│ Custom Years:                       │
│ ☑ 2024  ☑ 2023  ☐ 2022             │
└─────────────────────────────────────┘
   2 periods selected
```

### 4. OrgUnitSelector

**Features:**
- Special codes: USER_ORGUNIT, USER_ORGUNIT_CHILDREN, USER_ORGUNIT_GRANDCHILDREN
- Search org units by name
- Tree view (if hierarchy available)
- Recently used org units

**API Call:**
```
GET /api/organisationUnits?fields=id,displayName,level&paging=false
```

**UI:**
```
┌─────────────────────────────────────┐
│ Quick Select:                       │
│ [My Org Unit] [My Org + Children]   │
├─────────────────────────────────────┤
│ 🔍 Search org units...              │
├─────────────────────────────────────┤
│ ☑ Sierra Leone (ImspTQPwCqd)       │
│ ☐ │─ Bo (UR31R1ogoal)              │
│ ☐ │─ Bombali (lc3eMKXaEfw)         │
│ ☐ │─ Bonthe (wGpU8WCx3xA)          │
└─────────────────────────────────────┘
   1 selected
```

### 5. ParameterPreview

**Features:**
- Shows generated SQL comment in real-time
- Syntax highlighted
- Copy button
- Validation warnings (e.g., "No data elements selected")

**UI:**
```
┌─────────────────────────────────────┐
│ Generated SQL Comment:              │
├─────────────────────────────────────┤
│ /* DHIS2:                           │
│   dimension=dx:FTRrcoaog83;abc123  │
│   &dimension=pe:LAST_YEAR;2024     │
│   &dimension=ou:ImspTQPwCqd        │
│   &displayProperty=NAME            │
│   &skipMeta=false                  │
│ */                                  │
├─────────────────────────────────────┤
│ [📋 Copy]  [Insert at Cursor]       │
└─────────────────────────────────────┘
```

## SQL Generation Logic

### Function: `generateDHIS2Comment()`

```typescript
function generateDHIS2Comment(params: DHIS2Parameters): string {
  const parts: string[] = [];

  // Dimension: dx (data elements)
  if (params.dataElements.length > 0) {
    parts.push(`dimension=dx:${params.dataElements.join(';')}`);
  }

  // Dimension: pe (periods)
  if (params.periods.length > 0) {
    parts.push(`dimension=pe:${params.periods.join(';')}`);
  }

  // Dimension: ou (org units)
  if (params.orgUnits.length > 0) {
    parts.push(`dimension=ou:${params.orgUnits.join(';')}`);
  }

  // Additional parameters
  parts.push(`displayProperty=${params.displayProperty}`);
  parts.push(`skipMeta=${params.skipMeta}`);

  const commentBody = parts.join('&');

  return `/* DHIS2: ${commentBody} */`;
}
```

### Complete SQL Template

```typescript
function generateCompleteSQL(params: DHIS2Parameters, endpoint: string = 'analytics'): string {
  const comment = generateDHIS2Comment(params);

  return `SELECT * FROM ${endpoint}\n${comment}`;
}
```

## Integration Points

### 1. Detect DHIS2 Database

```typescript
// In SqlLab component
const isDHIS2Database = () => {
  const currentDatabase = databases.find(db => db.id === queryEditor.dbId);
  return currentDatabase?.backend === 'dhis2';
};
```

### 2. Insert SQL at Cursor

```typescript
function insertSQLAtCursor(sql: string) {
  const editor = aceEditorRef.current;
  if (editor) {
    const cursor = editor.getCursorPosition();
    editor.session.insert(cursor, sql);
  }
}
```

### 3. API Integration

**Fetch DHIS2 Metadata:**
```typescript
// Use Superset's existing database query API
async function fetchDHIS2Metadata(databaseId: number, endpoint: string) {
  const response = await SupersetClient.post({
    endpoint: '/api/v1/sqllab/execute/',
    postPayload: {
      database_id: databaseId,
      sql: `SELECT * FROM ${endpoint} LIMIT 1`,
      schema: 'dhis2',
    },
  });

  // Parse response to get available data elements, org units, etc.
  return response.json;
}
```

## File Changes Required

### Frontend Files to Create

1. **`superset-frontend/src/SqlLab/components/DHIS2QueryBuilder/index.tsx`**
   - Main container component
   - State management for all parameters
   - SQL generation logic

2. **`superset-frontend/src/SqlLab/components/DHIS2QueryBuilder/DataElementSelector.tsx`**
   - Data element search and selection

3. **`superset-frontend/src/SqlLab/components/DHIS2QueryBuilder/PeriodSelector.tsx`**
   - Period selection UI

4. **`superset-frontend/src/SqlLab/components/DHIS2QueryBuilder/OrgUnitSelector.tsx`**
   - Org unit selection UI

5. **`superset-frontend/src/SqlLab/components/DHIS2QueryBuilder/ParameterPreview.tsx`**
   - Real-time SQL preview

6. **`superset-frontend/src/SqlLab/components/DHIS2QueryBuilder/types.ts`**
   - TypeScript interfaces

7. **`superset-frontend/src/SqlLab/components/DHIS2QueryBuilder/utils.ts`**
   - Helper functions (SQL generation, validation)

### Frontend Files to Modify

8. **`superset-frontend/src/SqlLab/components/LeftPanel/index.tsx`**
   - Add "DHIS2 Builder" tab
   - Show/hide based on database type

9. **`superset-frontend/src/SqlLab/App.tsx`**
   - Import DHIS2QueryBuilder
   - Pass necessary props (database, editor ref)

### Backend Files (Optional Enhancement)

10. **`superset/databases/api.py`**
    - Add endpoint: `GET /api/v1/database/<id>/dhis2/metadata`
    - Returns cached list of data elements, org units, periods
    - Reduces API calls to DHIS2 server

## Implementation Phases

### Phase 1: Basic UI (MVP) ✅
- [ ] Create DHIS2QueryBuilder component structure
- [ ] Add tab to SQL Lab left panel
- [ ] Implement basic data element selector (text input for UIDs)
- [ ] Implement basic period selector (dropdown with common periods)
- [ ] Implement basic org unit selector (text input for UIDs)
- [ ] Implement SQL comment generation
- [ ] Add "Insert at Cursor" button

**Deliverable**: Users can build basic DHIS2 queries without typing dimension strings manually.

### Phase 2: Enhanced Selectors 🔧
- [ ] Data element search with API integration
- [ ] Multi-select with checkboxes
- [ ] Period selector with relative + fixed periods
- [ ] Org unit selector with search
- [ ] Parameter validation and warnings
- [ ] Real-time preview with syntax highlighting

**Deliverable**: Full-featured visual query builder matching dataset creation UX.

### Phase 3: Advanced Features 🚀
- [ ] Save/load parameter templates
- [ ] Recently used parameters
- [ ] Parameter history
- [ ] Org unit tree view
- [ ] Data element groups/categories
- [ ] Keyboard shortcuts
- [ ] Query templates library

**Deliverable**: Professional-grade DHIS2 query builder with power user features.

## Testing Strategy

### Unit Tests
- SQL generation function with various parameter combinations
- Parameter validation logic
- Component rendering and interactions

### Integration Tests
- Insert SQL into editor at cursor position
- Database type detection
- API calls for metadata fetching

### E2E Tests (Playwright)
- Open SQL Lab with DHIS2 database
- Open DHIS2 Query Builder
- Select parameters
- Insert SQL
- Execute query
- Verify results

## Success Metrics

1. **Usability**: Non-technical users can create DHIS2 queries without documentation
2. **Error Reduction**: 90%+ reduction in malformed dimension strings
3. **Time Savings**: 5x faster query creation vs manual typing
4. **Adoption**: 80%+ of DHIS2 queries use the builder within 1 month

## Related Work

This query builder should be **consistent with**:
- Dataset creation query builder (`AddDataset/DHIS2ParameterBuilder/`)
- Existing SQL Lab patterns (table browser, query history)
- Superset design system (Ant Design components)

**Reuse existing components where possible:**
- Data element selector logic from dataset creation
- Period utilities and constants
- API client patterns

## Questions to Resolve

1. **Metadata caching**: Cache DHIS2 metadata server-side or client-side?
2. **API rate limits**: How to handle large DHIS2 instances (thousands of data elements)?
3. **Multi-database**: Should builder support switching between DHIS2 databases within same session?
4. **Saved queries**: Should parameter selections save with SQL Lab query bookmarks?

## Next Steps

1. Review this plan with team
2. Create design mockups (Figma/wireframes)
3. Set up component structure
4. Implement Phase 1 (MVP)
5. User testing and feedback
6. Iterate to Phase 2 and 3
