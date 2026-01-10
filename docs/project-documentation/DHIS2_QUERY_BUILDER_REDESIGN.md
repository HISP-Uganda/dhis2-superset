# DHIS2 Query Builder Redesign Plan

## Problem Statement

The current DHIS2 Query Builder becomes unusable with large DHIS2 instances:
- **11,411 data elements** in Uganda HMIS
- Single dropdown tries to load 1,000+ items
- No search, no grouping, no organization
- Users cannot find specific data elements (e.g., "105-EP01a. Suspected Malaria")

## Solution: Multi-Level Filtering UI

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  DHIS2 Dataset Builder                                          │
├─────────────────────────────────────────────────────────────────┤
│  Step 1: Choose Data Type                                       │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │ All Types│Indicators│Data Elem.│Data Sets │Programs  │      │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘      │
│                                                                  │
│  Step 2: Filter by Category/Group                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔍 Search: [malaria_________________] [Search]          │   │
│  │                                                          │   │
│  │ Filter by Group:  [Malaria ▼]                           │   │
│  │                                                          │   │
│  │ Quick Filters:    ☐ Numeric only  ☐ Aggregatable       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Step 3: Select Items (showing 50 of 234 matching)             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ Select All   [Load More]                              │   │
│  │                                                          │   │
│  │ ☐ 105-EP01a. Suspected Malaria (fever)                  │   │
│  │ ☐ 105-EP01b. Malaria Tested (B/s & RDT)                 │   │
│  │ ☐ 105-EP01c. Malaria confirmed (B/s & RDT)              │   │
│  │ ☐ 105-EP01d. Confirmed Malaria cases treated            │   │
│  │ ☐ 105-EP01e Total malaria cases treated                 │   │
│  │                                                          │   │
│  │ [Load 50 more...]                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Selected: (5 items)                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ✓ 105-EP01a. Suspected Malaria (fever)        [×]       │   │
│  │ ✓ 105-EP01b. Malaria Tested (B/s & RDT)       [×]       │   │
│  │ ✓ 105-EP01c. Malaria confirmed (B/s & RDT)    [×]       │   │
│  │ ✓ 105-EP01d. Confirmed Malaria cases treated  [×]       │   │
│  │ ✓ 105-EP01e Total malaria cases treated       [×]       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  [Continue to Periods →]                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Backend API Enhancements (1-2 days)

#### 1.1 Add Search Parameter

**File**: `superset/databases/api.py`

**Current**:
```python
@expose("/<int:pk>/dhis2_metadata/", methods=["GET"])
def dhis2_metadata(self, pk: int):
    metadata_type = request.args.get("type", "dataElements")
    # ... fetches ALL items
```

**Enhanced**:
```python
@expose("/<int:pk>/dhis2_metadata/", methods=["GET"])
def dhis2_metadata(self, pk: int):
    metadata_type = request.args.get("type", "dataElements")
    search_term = request.args.get("search", "")  # NEW
    group_id = request.args.get("group", "")      # NEW
    page = request.args.get("page", 1, type=int)  # NEW
    page_size = request.args.get("pageSize", 50, type=int)  # NEW

    # Add search filter
    if search_term:
        params["filter"].append(f"displayName:ilike:{search_term}")

    # Add group filter
    if group_id and metadata_type == "dataElements":
        params["filter"].append(f"dataElementGroups.id:eq:{group_id}")

    # Add pagination
    params["page"] = page
    params["pageSize"] = page_size
    params["paging"] = "true"
```

#### 1.2 Add Data Element Groups Endpoint

**New endpoint**: `/api/v1/database/<pk>/dhis2_metadata/groups/`

```python
@expose("/<int:pk>/dhis2_metadata/groups/", methods=["GET"])
def dhis2_metadata_groups(self, pk: int):
    """
    Fetch DHIS2 data element groups for organizing large lists.

    Returns:
        {
            "result": [
                {"id": "abc123", "displayName": "Malaria", "count": 45},
                {"id": "def456", "displayName": "HIV", "count": 78},
                ...
            ]
        }
    """
    # Fetch from DHIS2: /api/dataElementGroups
    response = requests.get(
        f"{base_url}/dataElementGroups",
        params={
            "fields": "id,displayName,dataElements~size",
            "paging": "false"
        },
        auth=auth
    )

    groups = response.json().get("dataElementGroups", [])

    # Format for frontend
    result = [
        {
            "id": g["id"],
            "displayName": g["displayName"],
            "count": g.get("dataElements", {}).get("~size", 0)
        }
        for g in groups
    ]

    return self.response(200, result=result)
```

---

### Phase 2: Frontend UI Redesign (2-3 days)

#### 2.1 Component Structure

**New file**: `superset-frontend/src/features/datasets/AddDataset/DHIS2DataSelector/`

```
DHIS2DataSelector/
├── index.tsx              # Main component
├── TypeTabs.tsx           # All types | Indicators | Data Elements | etc.
├── SearchBar.tsx          # Search input with debounce
├── GroupFilter.tsx        # Data element groups dropdown
├── ItemList.tsx           # Virtualized list with checkboxes
├── SelectedItems.tsx      # Chips showing selected items
└── types.ts               # TypeScript types
```

#### 2.2 Main Component Logic

```typescript
// DHIS2DataSelector/index.tsx

interface DHIS2DataSelectorProps {
  databaseId: number;
  onSelectionChange: (selectedIds: string[]) => void;
}

export function DHIS2DataSelector({ databaseId, onSelectionChange }: DHIS2DataSelectorProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'indicators' | 'dataElements'>('dataElements');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [items, setItems] = useState<DHIS2Item[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Debounced search
  const debouncedSearch = useDebounce(searchTerm, 500);

  // Fetch items when filters change
  useEffect(() => {
    loadItems(1); // Reset to page 1
  }, [activeTab, debouncedSearch, selectedGroup]);

  const loadItems = async (pageNum: number) => {
    setLoading(true);
    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/`,
        params: {
          type: activeTab === 'all' ? 'dataElements' : activeTab,
          search: debouncedSearch,
          group: selectedGroup || undefined,
          page: pageNum,
          pageSize: 50,
        },
      });

      const newItems = response.json.result;

      if (pageNum === 1) {
        setItems(newItems);
      } else {
        setItems(prev => [...prev, ...newItems]);
      }

      setHasMore(newItems.length === 50); // Has more if full page returned
      setPage(pageNum);
    } catch (error) {
      console.error('Failed to load items:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      loadItems(page + 1);
    }
  };

  const handleToggleItem = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
    onSelectionChange(Array.from(newSelected));
  };

  return (
    <Container>
      <TypeTabs active={activeTab} onChange={setActiveTab} />

      <SearchBar
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search by name, code, or keyword..."
      />

      {activeTab === 'dataElements' && (
        <GroupFilter
          databaseId={databaseId}
          value={selectedGroup}
          onChange={setSelectedGroup}
        />
      )}

      <SelectedItems
        items={items.filter(i => selectedIds.has(i.id))}
        onRemove={(id) => handleToggleItem(id)}
      />

      <ItemList
        items={items}
        selectedIds={selectedIds}
        onToggle={handleToggleItem}
        loading={loading}
        onLoadMore={handleLoadMore}
        hasMore={hasMore}
      />
    </Container>
  );
}
```

#### 2.3 Type Tabs Component

```typescript
// TypeTabs.tsx

const TABS = [
  { key: 'all', label: 'All Types', icon: '📊' },
  { key: 'indicators', label: 'Indicators', icon: '📈' },
  { key: 'dataElements', label: 'Data Elements', icon: '🔢' },
  { key: 'dataSets', label: 'Data Sets', icon: '📋' },
  { key: 'programIndicators', label: 'Program Indicators', icon: '🎯' },
];

export function TypeTabs({ active, onChange }: TypeTabsProps) {
  return (
    <Tabs>
      {TABS.map(tab => (
        <Tab
          key={tab.key}
          active={active === tab.key}
          onClick={() => onChange(tab.key)}
        >
          <span>{tab.icon}</span>
          <span>{tab.label}</span>
        </Tab>
      ))}
    </Tabs>
  );
}
```

#### 2.4 Search Bar with Debounce

```typescript
// SearchBar.tsx

export function SearchBar({ value, onChange, placeholder }: SearchBarProps) {
  return (
    <SearchContainer>
      <SearchIcon>🔍</SearchIcon>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <ClearButton onClick={() => onChange('')}>
          ×
        </ClearButton>
      )}
    </SearchContainer>
  );
}

// Custom hook for debouncing
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
```

#### 2.5 Virtualized Item List

```typescript
// ItemList.tsx
import { FixedSizeList as List } from 'react-window';

export function ItemList({ items, selectedIds, onToggle, loading, onLoadMore, hasMore }: ItemListProps) {
  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = items[index];
    const isSelected = selectedIds.has(item.id);

    return (
      <ItemRow style={style} selected={isSelected}>
        <Checkbox
          checked={isSelected}
          onChange={() => onToggle(item.id)}
        />
        <ItemContent>
          <ItemName>{item.displayName}</ItemName>
          {item.typeInfo && <ItemMeta>{item.typeInfo}</ItemMeta>}
        </ItemContent>
      </ItemRow>
    );
  };

  return (
    <ListContainer>
      <List
        height={400}
        itemCount={items.length}
        itemSize={50}
        width="100%"
      >
        {Row}
      </List>

      {hasMore && (
        <LoadMoreButton onClick={onLoadMore} disabled={loading}>
          {loading ? 'Loading...' : 'Load More'}
        </LoadMoreButton>
      )}
    </ListContainer>
  );
}
```

---

### Phase 3: Integration (1 day)

#### 3.1 Replace Old Selector

In `DHIS2ParameterBuilder/index.tsx`, replace the current multi-select dropdown with the new component:

```typescript
// Old (lines 600-660)
<StyledSelect
  mode="multiple"
  showSearch
  placeholder={t('Select indicators or data elements')}
  value={selectedData}
  onChange={setSelectedData}
>
  {indicators.map(ind => (
    <Option key={ind.id} value={ind.id}>
      {ind.displayName}
    </Option>
  ))}
  {dataElements.map(de => (
    <Option key={de.id} value={de.id}>
      {de.displayName}
    </Option>
  ))}
</StyledSelect>

// New
<DHIS2DataSelector
  databaseId={databaseId}
  onSelectionChange={setSelectedData}
/>
```

---

## Benefits of Redesign

### Before (Current)
- ❌ Load all 11,411 items → crashes browser
- ❌ Limited to 1,000 items → missing data
- ❌ No search → impossible to find
- ❌ No grouping → overwhelming
- ❌ Slow UI → dropdown lag

### After (Redesigned)
- ✅ Load only 50 items at a time → fast
- ✅ Server-side search → find anything instantly
- ✅ Group by category → organized
- ✅ Type-based tabs → clear navigation
- ✅ Pagination → browse thousands of items

---

## User Experience Example

### Scenario: User wants "105-EP01a. Suspected Malaria"

**Current UI** (broken):
1. Open dropdown
2. Wait 10 seconds for 1,000 items to load
3. Scroll through alphabetically
4. Item not found (it's #3,456 out of 11,411)
5. Give up

**Redesigned UI**:
1. Click "Data Elements" tab
2. Type "105-EP" in search box
3. See 6 matching items instantly
4. Check the 5 malaria ones
5. Done in 10 seconds ✅

---

## Alternative: Quick Implementation (If Short on Time)

If we don't have time for full redesign, do **minimal fixes**:

### Quick Fix 1: Add Search Input (30 min)

```typescript
// Add above the current dropdown
<Input
  placeholder="Search data elements..."
  onChange={(e) => setSearchTerm(e.target.value)}
/>

// Filter items client-side
const filteredDataElements = dataElements.filter(de =>
  de.displayName.toLowerCase().includes(searchTerm.toLowerCase())
);

// Use filtered list in dropdown
<StyledSelect>
  {filteredDataElements.map(de => ...)}
</StyledSelect>
```

### Quick Fix 2: Increase Backend Limit (5 min)

```python
# In dhis2_metadata endpoint
return self.response(200, result=items[:5000])  # Was 1000
```

### Quick Fix 3: Add Server-Side Search (1 hour)

```python
# In dhis2_metadata endpoint
search_term = request.args.get("search")
if search_term:
    params["filter"] = f"displayName:ilike:{search_term}"
```

```typescript
// In frontend
const searchDataElements = debounce(async (term) => {
  const response = await fetch(
    `/api/v1/database/${dbId}/dhis2_metadata/?type=dataElements&search=${term}`
  );
  setDataElements(response.result);
}, 500);
```

---

## Recommendation

**For Production**: Implement the **full redesign** (Phases 1-3). It solves the problem properly and scales to any DHIS2 instance size.

**For Quick Demo**: Do **Quick Fixes 1-3** to make it work immediately, then plan the full redesign for later.

---

## Timeline

- **Phase 1** (Backend): 1-2 days
- **Phase 2** (Frontend): 2-3 days
- **Phase 3** (Integration): 1 day
- **Testing**: 1 day

**Total**: 5-7 days for production-ready solution

Or **Quick Fixes**: 2-3 hours to make it usable now

---

## Next Steps

1. ✅ Approve this design
2. Decide: Full redesign or quick fixes first?
3. I'll implement whichever approach you choose
4. Test with Uganda HMIS (11,411 data elements)
5. Deploy and document

What's your preference? Full redesign or quick fixes first?
