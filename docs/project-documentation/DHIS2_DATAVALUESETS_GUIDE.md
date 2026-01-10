# DHIS2 dataValueSets API Integration Guide

## Overview

This guide documents the correct implementation of DHIS2's `dataValueSets` API endpoint in Superset, following DHIS2 API specifications.

## Common Mistakes Fixed

### ❌ INCORRECT API Request
```
api/dataValueSets?dataElement=JhvC7ZR9hUe,D9A0afrTYPw&period=LAST_5_YEARS&orgUnit=USER_ORGUNIT_GRANDCHILDREN
```

**Issues:**
1. `LAST_5_YEARS` (relative period) is **NOT supported** on `/api/dataValueSets`
2. `USER_ORGUNIT_GRANDCHILDREN` (relative org unit keyword) is **NOT supported** on dataValueSets
3. `dataElement` alone is **NOT a valid selector** for this endpoint - requires a `dataSet`

**Result:** Empty or error response

---

## ✅ CORRECT API Request

### Using `/api/dataValueSets` (Recommended for raw data values)

```
/api/dataValueSets.json
  ?dataSet=YOUR_DATASET_UID
  &orgUnit=ouId1,ouId2,ouId3
  &period=2020,2021,2022,2023,2024
  &dataElement=JhvC7ZR9hUe,D9A0afrTYPw,wUDxFVBapIc,QHnwKs2OUZv
```

**Required Parameters:**
- **dataSet**: Dataset UID (e.g., `BvD83haYO5d`) - REQUIRED
- **orgUnit**: Comma-separated concrete org unit UIDs - REQUIRED
- **period**: Comma-separated fixed period codes - REQUIRED

**Optional Parameters:**
- **dataElement**: Comma-separated data element UIDs
- **children**: `true` to include child org units

**Period Code Examples:**
- Years: `2020,2021,2022`
- Quarters: `2020Q1,2020Q2,2020Q3,2020Q4`
- Months: `202001,202002,202003`

### Using `/api/analytics/dataValueSet` (When you need relative periods)

If you **must** use relative periods and org unit keywords:

```
/api/analytics/dataValueSet.json
  ?dimension=dx:JhvC7ZR9hUe;D9A0afrTYPw;wUDxFVBapIc;QHnwKs2OUZv
  &dimension=pe:LAST_5_YEARS
  &dimension=ou:USER_ORGUNIT_GRANDCHILDREN
```

---

## Implementation in Superset

### 1. Utility Functions (`superset/dhis2/data_values.py`)

#### Build API Parameters
```python
from superset.dhis2.data_values import build_data_value_params, get_last_n_years

# Generate fixed period codes for the last 5 years
periods = get_last_n_years(5)  # Returns ['2020', '2021', '2022', '2023', '2024']

# Build parameters for dataValueSets endpoint
params = build_data_value_params(
    dataset_uid='BvD83haYO5d',
    org_units=['ImspD7YubBo', 'O6uvpzGd5pu'],
    periods=periods,
    data_elements=['JhvC7ZR9hUe', 'D9A0afrTYPw'],
    include_children=False
)
# Returns: {
#   'dataSet': 'BvD83haYO5d',
#   'orgUnit': 'ImspD7YubBo,O6uvpzGd5pu',
#   'period': '2020,2021,2022,2023,2024',
#   'dataElement': 'JhvC7ZR9hUe,D9A0afrTYPw'
# }
```

#### Expand Relative Keywords to Concrete UIDs
```python
from superset.dhis2.data_values import expand_org_unit_keywords

# Convert relative keywords to concrete UIDs
org_units = expand_org_unit_keywords(
    ['USER_ORGUNIT_CHILDREN'],
    user_org_units=['ImspD7YubBo', 'O6uvpzGd5pu']
)
# Returns: ['ImspD7YubBo', 'O6uvpzGd5pu']
```

### 2. REST API Endpoint (`superset/dhis2/data_values_api.py`)

The endpoint is automatically registered and available at:

```
GET /api/v1/dhis2_data_values/<database_id>/
```

#### Request Example
```bash
curl "http://localhost:8088/api/v1/dhis2_data_values/1/?dataSet=BvD83haYO5d&orgUnit=ImspD7YubBo&period=2020,2021"
```

#### Query Parameters
- **dataSet** (required): Dataset UID
- **orgUnit** (required): Comma-separated concrete org unit UIDs
- **period** (required): Comma-separated fixed period codes
- **dataElement** (optional): Comma-separated data element UIDs
- **includeChildren** (optional): `true` or `false`

#### Response
```json
{
  "dataValues": [
    {
      "dataElement": "JhvC7ZR9hUe",
      "period": "2020",
      "orgUnit": "ImspD7YubBo",
      "value": "1234",
      "storedBy": "username",
      "created": "2021-01-01T00:00:00.000Z"
    }
  ],
  "metadata": {
    "dataSet": "BvD83haYO5d",
    "period": "2020",
    "organisationUnit": "ImspD7YubBo",
    "lastUpdated": "2021-01-01T00:00:00.000Z"
  }
}
```

### 3. DHIS2 Dialect Support

The DHIS2 database dialect provides low-level access:

```python
from superset.models.core import Database

# Get database instance
db = db.session.query(Database).get(database_id)

# Fetch data values directly
engine = db.get_sqla_engine()
params = {
    'dataSet': 'BvD83haYO5d',
    'orgUnit': 'ImspD7YubBo',
    'period': '2020,2021'
}
response = engine.dialect.fetch_data_values(params)
```

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Request                                   │
│  GET /api/v1/dhis2_data_values/<database_id>/                   │
│  ?dataSet=XXX&orgUnit=XXX&period=2020,2021                      │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│         DHIS2DataValuesRestApi.get_data_values()                │
│  - Validate parameters                                           │
│  - Parse comma-separated values                                 │
│  - Call caching layer                                            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│         get_cached_data_values()                                │
│  - Check cache (1 hour TTL)                                      │
│  - Fetch from DHIS2 if not cached                               │
│  - Store in cache                                                │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│         fetch_data_values_from_dhis2()                          │
│  - Build request parameters                                      │
│  - Get SQLAlchemy engine                                         │
│  - Call dialect.fetch_data_values()                             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│         DHIS2Connection.fetch_data_values()                     │
│  - Construct API URL: /api/dataValueSets                        │
│  - Add query parameters                                          │
│  - Make HTTP GET request                                         │
│  - Return JSON response                                          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│         DHIS2 Server                                             │
│  GET /api/dataValueSets?dataSet=...&orgUnit=...&period=...      │
│  Returns: {dataValues: [...], metadata: {...}}                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Differences: dataValueSets vs Analytics

| Feature | dataValueSets | analytics |
|---------|---------------|-----------|
| **Relative Periods** | ❌ NOT supported | ✅ SUPPORTED (LAST_5_YEARS) |
| **Org Unit Keywords** | ❌ NOT supported | ✅ SUPPORTED (USER_ORGUNIT_*) |
| **Use Case** | Raw data entry values | Analyzed/aggregated data |
| **dataElement Filter** | ⚠️ Requires dataSet | ✅ Works standalone |
| **Period Format** | Fixed codes (2020, 2020Q1, 202001) | Fixed or relative (LAST_YEAR) |

---

## Migration Examples

### From Incorrect Request to Correct

**BEFORE (Incorrect):**
```python
# ❌ This returns empty - LAST_5_YEARS and USER_ORGUNIT_GRANDCHILDREN not supported
params = {
    'dataElement': 'JhvC7ZR9hUe,D9A0afrTYPw',
    'period': 'LAST_5_YEARS',
    'orgUnit': 'USER_ORGUNIT_GRANDCHILDREN'
}
```

**AFTER (Correct):**
```python
from superset.dhis2.data_values import get_last_n_years, build_data_value_params

# ✅ Generate fixed period codes
periods = get_last_n_years(5)  # ['2020', '2021', '2022', '2023', '2024']

# ✅ Use concrete org unit UIDs (fetch from user's org unit structure)
user_org_units = ['ImspD7YubBo', 'O6uvpzGd5pu', 'qhWMD43UnmE']

# ✅ Build parameters with dataSet requirement
params = build_data_value_params(
    dataset_uid='BvD83haYO5d',
    org_units=user_org_units,
    periods=periods,
    data_elements=['JhvC7ZR9hUe', 'D9A0afrTYPw']
)
```

---

## Error Handling

### Parameter Validation

The `build_data_value_params` function validates inputs:

```python
from superset.dhis2.data_values import build_data_value_params

# ✅ Valid
params = build_data_value_params(
    dataset_uid='BvD83haYO5d',
    org_units=['ImspD7YubBo'],
    periods=['2020']
)

# ❌ Raises ValueError: dataset_uid is required
params = build_data_value_params(
    dataset_uid='',
    org_units=['ImspD7YubBo'],
    periods=['2020']
)

# ❌ Raises ValueError: org_units list cannot be empty
params = build_data_value_params(
    dataset_uid='BvD83haYO5d',
    org_units=[],
    periods=['2020']
)

# ❌ Raises ValueError: periods list cannot be empty
params = build_data_value_params(
    dataset_uid='BvD83haYO5d',
    org_units=['ImspD7YubBo'],
    periods=[]
)
```

---

## Summary

✅ **USE dataValueSets when:**
- You need raw data entry values
- You have concrete org unit UIDs
- You have fixed period codes
- You want to include a specific dataset

❌ **DO NOT use relative periods/keywords on dataValueSets:**
- `LAST_5_YEARS` → Use fixed codes: `2020,2021,2022,2023,2024`
- `USER_ORGUNIT_GRANDCHILDREN` → Fetch concrete UIDs first
- `dataElement` alone → Always include `dataSet` parameter

📊 **For relative periods, use `/api/analytics/dataValueSet` instead**

---

## References

- DHIS2 API Documentation: https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/data-values.html
- Relative Periods: https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/analytics.html#relative-periods
- Organisation Units: https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/metadata.html#organisation-units
