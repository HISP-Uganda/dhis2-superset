# DHIS2 Filter Name-to-UID Mapping Solution

## Problem Statement

### Current Behavior ❌
When users apply dashboard native filters (e.g., Region, District filters), Superset extracts the **display names** and passes them to the DHIS2 API:

```python
# Filter selection by user
["Ibanda District", "Mbarara City", "Isingiro District"]

# What Superset generates in SQL WHERE clause
WHERE District IN ('Ibanda District', 'Mbarara City', 'Isingiro District')

# What gets passed to DHIS2 API (WRONG!)
dimension=ou:Ibanda District;Mbarara City;Isingiro District
```

###  Root Cause
DHIS2 API **requires UIDs (unique identifiers)**, not names:

```
# What DHIS2 needs (CORRECT)
dimension=ou:A1B2C3D4E5F;X9Y8Z7W6V5U;Q5R4S3T2U1V
```

### Where This Fails

**Location:** [superset/db_engine_specs/dhis2_dialect.py:2425-2431](superset/db_engine_specs/dhis2_dialect.py#L2425-L2431)

```python
# FIFTH: Extract from WHERE clause (lowest priority)
where_match = re.search(r'WHERE\s+(.+?)(?:ORDER BY|GROUP BY|LIMIT|$)', query, re.IGNORECASE | re.DOTALL)
if where_match:
    conditions = where_match.group(1)
    # Parse simple conditions: field='value' or field="value"
    for match in re.finditer(r'(\w+)\s*=\s*[\'"]([^\'"]+)[\'"]', conditions):
        field, value = match.groups()
        params[field] = value  # ← Stores "Ibanda District" instead of UID!
```

### Why This Happens

1. **Dashboard Native Filters** extract values from dataset columns
2. **Dataset columns contain display names** (Region, District, etc.) not UIDs
3. **WHERE clause** gets names like `WHERE District = 'Ibanda District'`
4. **DHIS2 dialect** extracts these names and passes to API
5. **DHIS2 API rejects** or returns no data (name doesn't match UID)

---

## Findings from Backend Logs

From `superset/logs/superset_backend.log`:

- At `2026-01-19 10:12:42,836` the DHIS2 dialect logs: `DHIS2 API returned 4439 rows`.
- The **Region** native filter dropdown is populated from this full 4,439-row result set.

This leads to two visible issues:

1. **Region filter shows 4,439 options** instead of a small set of regions because Superset is:
   - Fetching **all analytics rows** from DHIS2, then
   - Extracting unique values from the `Region` column across all rows.
2. **The WHERE clause itself is correct** when the user applies the filter (e.g. `WHERE "Region" IN ('Bunyoro')`), but:
   - The filter still uses **names**, not UIDs.
   - The DHIS2 dialect later forwards these names to the DHIS2 API as the `ou` dimension, which expects UIDs.

So there are **two layers** to fix:

- **Filter options layer**: make Region/District filters query only distinct org-unit values instead of the full fact table.
- **Execution layer**: translate selected org-unit **names → UIDs** before constructing the DHIS2 API request.

---

## Solution Design

### Approach: Name-to-UID Resolution at Query Execution Time

Add a new method to resolve organization unit names to UIDs before making the API call.

### Filter Configuration Alignment (Region/District dropdowns)

In addition to the runtime name→UID resolution, native filters should be configured so that:

- The **Region** filter dataset returns only **distinct regions**, e.g.:
  - `SELECT DISTINCT "Region" FROM analytics` (or equivalent in Superset's virtual dataset), or
  - A dedicated DHIS2 query such as `/organisationUnits?level=2&fields=id,displayName&paging=false` exposed via a small helper view.
- The **District** filter similarly returns only distinct districts (and may optionally depend on the selected Region).
- Filters should **not** be built on top of the full analytics fact table without a `DISTINCT` projection, otherwise every (Period × OrgUnit × Metric) row contributes duplicate options.

This keeps the dropdowns small and meaningful, while the runtime logic below ensures that the **selected names** are converted to **UIDs** before calling DHIS2.

### Implementation Strategy

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Filter Applied                                           │
│    User selects: ["Ibanda District", "Mbarara City"]       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. SQL WHERE Clause Generated                               │
│    WHERE District IN ('Ibanda District', 'Mbarara City')    │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Execute Method (dhis2_dialect.py:3205)                   │
│    - Extract params including WHERE clause values           │
│    - **NEW: Detect orgUnit dimension filters**              │
│    - **NEW: Resolve names to UIDs**                         │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Name-to-UID Resolution                                   │
│    - Call DHIS2 API: /organisationUnits?                    │
│      filter=displayName:in:[Ibanda District,Mbarara City]   │
│    - Get back UIDs: [A1B2C3D4E5F, X9Y8Z7W6V5U]             │
│    - Cache mapping for performance                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. API Call with UIDs                                       │
│    dimension=ou:A1B2C3D4E5F;X9Y8Z7W6V5U                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### Step 1: Add Name-to-UID Resolution Method

**File:** `superset/db_engine_specs/dhis2_dialect.py`

**Location:** Add after `fetch_org_unit_levels()` method (around line 1800)

```python
...existing code...

def resolve_orgunit_names_to_uids(
    self,
    org_unit_names: list[str],
    level: int | None = None
) -> dict[str, str]:
    """Resolve organization unit display names to UIDs using DHIS2 API.

    Args:
        org_unit_names: List of org unit display names to resolve
        level: Optional org unit level filter (1=National, 2=Region, 3=District, etc.)

    Returns:
        Dictionary mapping display name to UID: {"Ibanda District": "A1B2C3D4E5F", ...}
    """
    # ...implementation as described...
```

...existing code with the full implementation and caching logic...

### Step 2: Modify `_extract_query_params()` to Detect OrgUnit Filters

**File:** `superset/db_engine_specs/dhis2_dialect.py`

**Location:** Line 2425-2431 (WHERE clause extraction)

```python
# FIFTH: Extract from WHERE clause (lowest priority)
where_match = re.search(r'WHERE\s+(.+?)(?:ORDER BY|GROUP BY|LIMIT|$)', query, re.IGNORECASE | re.DOTALL)
if where_match:
    conditions = where_match.group(1)

    # Track which filters are org unit dimensions
    ou_dimension_filters = {}

    # Parse simple conditions: field='value' or field="value"
    for match in re.finditer(r'(\w+)\s*=\s*[\'"]([^\'"]+)[\'"]', conditions):
        field, value = match.groups()
        # ...existing code extended to detect org-unit columns...

    # Handle IN clauses: field IN ('val1', 'val2', ...)
    for match in re.finditer(r'(\w+)\s+IN\s*\(([^)]+)\)', conditions, re.IGNORECASE):
        field, values_str = match.groups()
        # ...existing code extended to collect org-unit name filters...

    # ...existing code...
```

### Step 3: Add Resolution Step in `execute()` Method

**File:** `superset/db_engine_specs/dhis2_dialect.py`

**Location:** Line 3222-3230 (after extracting params, before API call)

```python
query_params = self._extract_query_params(query)
logger.info(f"Query params: {query_params}")

# NEW: Resolve org unit name filters to UIDs
if 'ou_name_filters' in query_params and query_params['ou_name_filters']:
    ou_names = query_params['ou_name_filters']
    ou_level = query_params.get('ou_filter_level')

    # ...existing code that calls resolve_orgunit_names_to_uids and rewrites the 'dimension' param...

# Merge all parameter sources
api_params = self._merge_params(endpoint, query_params)
```

---

## Performance Optimization: Caching

...existing caching section as described above...

---

## Testing

...existing testing section (Test Case 1, 2, 3)...

---

## Alternative Approach: Store UIDs in Dataset

...existing Option B section...

---

## Recommended Solution

...existing Recommended Solution section, now understood in combination with:

- Proper **filter datasets** (DISTINCT Region/District from org-unit hierarchy).
- Runtime **name→UID resolution** in the DHIS2 dialect.
