# DHIS2 in Superset - Quick Start Guide

## Current Status ✅

DHIS2 chart creation is **functional**. Users can create datasets and charts from DHIS2 data.

## Creating DHIS2 Datasets

### Method 1: Query Builder (Recommended)
1. Go to **Datasets** → **+ Dataset**
2. Select your DHIS2 database
3. Use the **DHIS2 Parameter Builder** to:
   - Select data elements
   - Choose periods
   - Pick org units
4. Click **Create Dataset and Create Chart**

### Method 2: SQL Lab
1. Go to **SQL Lab** → **SQL Editor**
2. Select your DHIS2 database
3. Write query with DHIS2 comment:
   ```sql
   SELECT * FROM analytics
   /* DHIS2: dimension=dx:FTRrcoaog83;FQ2o8UBlcrS&dimension=pe:LAST_YEAR&dimension=ou:ImspTQPwCqd&displayProperty=NAME&skipMeta=false */
   ```
4. Run query to verify data
5. Click **Save** → **Save as Dataset**

## Creating Charts

1. Go to **Charts** → **+ Chart**
2. Select your DHIS2 dataset
3. Choose chart type (Bar, Line, Table, etc.)
4. Configure:
   - **X-axis**: Period or OrgUnit (categorical)
   - **Metrics**: SUM(data_element_name) or COUNT(*)
   - **Dimensions**: Period, OrgUnit
5. Click **Update chart** to preview
6. Click **Save** when satisfied

## DHIS2 Dimension Parameters

### Format
```
/* DHIS2: dimension=dx:id1;id2&dimension=pe:period&dimension=ou:orgunit&displayProperty=NAME&skipMeta=false */
```

### Data Elements (dx)
```
dimension=dx:FTRrcoaog83;r6nrJANOqMw;FQ2o8UBlcrS
```
- Separate UIDs with semicolons (`;`)
- Find UIDs in DHIS2 Maintenance app

### Periods (pe)
**Relative Periods:**
```
dimension=pe:LAST_YEAR;LAST_12_MONTHS;LAST_QUARTER
```

Common relative periods:
- `LAST_YEAR`, `THIS_YEAR`
- `LAST_12_MONTHS`, `LAST_6_MONTHS`, `LAST_3_MONTHS`
- `LAST_QUARTER`, `THIS_QUARTER`
- `LAST_MONTH`, `THIS_MONTH`
- `LAST_WEEK`, `THIS_WEEK`

**Fixed Periods:**
```
dimension=pe:2024;2023;2022;2023Q1;202401
```
- Years: `2024`, `2023`
- Quarters: `2024Q1`, `2024Q2`
- Months: `202401`, `202402` (YYYYMM)

### Org Units (ou)
**Special Codes:**
```
dimension=ou:USER_ORGUNIT
dimension=ou:USER_ORGUNIT_CHILDREN
dimension=ou:USER_ORGUNIT_GRANDCHILDREN
```

**Specific Org Units:**
```
dimension=ou:ImspTQPwCqd;UR31R1ogoal;lc3eMKXaEfw
```
- Separate UIDs with semicolons (`;`)
- Find UIDs in DHIS2 Organisation Units app

### Display Property
```
displayProperty=NAME        # Full names (default)
displayProperty=SHORT_NAME  # Short names
displayProperty=CODE        # Codes
```

### Skip Metadata
```
skipMeta=false  # Include metadata (recommended)
skipMeta=true   # Exclude metadata (faster, but no names)
```

## Common Issues and Solutions

### Issue 1: "Column referenced by aggregate is undefined"

**Cause**: Dataset metadata doesn't match current query dimensions.

**Solution**:
1. Go to **Datasets** → Find your DHIS2 dataset
2. Click **Edit**
3. Click **Columns** tab
4. Click **Sync columns from source**
5. Click **Save**

### Issue 2: Chart shows 0 rows

**Cause**: DHIS2 dimension parameters missing or malformed.

**Solution**:
1. Check dataset SQL includes `/* DHIS2: ... */` comment
2. Verify dimension format: `dimension=dx:id1;id2&dimension=pe:period&dimension=ou:orgunit`
3. Use `&` to separate parameters (not commas)
4. Use `;` to separate UIDs within dimensions (not commas)

### Issue 3: "Could not convert string to numeric"

**Cause**: Column contains text values being treated as numbers.

**Solution**: This should be automatically handled. If it persists, the data element may return non-numeric values.

## Best Practices

### 1. Use Relative Periods
✅ **Good**: `dimension=pe:LAST_YEAR;LAST_12_MONTHS`
❌ **Avoid**: `dimension=pe:2024;2023;2022` (becomes outdated)

### 2. Use USER_ORGUNIT for User-Specific Data
✅ **Good**: `dimension=ou:USER_ORGUNIT_CHILDREN`
❌ **Avoid**: Hardcoding specific org unit UIDs (not reusable)

### 3. Limit Data Elements
✅ **Good**: 3-10 data elements per dataset
❌ **Avoid**: 50+ data elements (slow queries, cluttered charts)

### 4. Name Datasets Descriptively
✅ **Good**: "Malaria Indicators - Last 12 Months"
❌ **Avoid**: "analytics 54", "test dataset"

### 5. Sync Metadata After Changing Dimensions
✅ **Always**: Sync columns when you change dimension parameters
❌ **Never**: Leave stale metadata (causes chart errors)

## Examples

### Example 1: Single Data Element, Multiple Periods
```sql
SELECT * FROM analytics
/* DHIS2: dimension=dx:FTRrcoaog83&dimension=pe:LAST_YEAR;LAST_12_MONTHS;LAST_MONTH&dimension=ou:USER_ORGUNIT&displayProperty=NAME&skipMeta=false */
```

**Chart**: Line chart with Period on x-axis showing trends

### Example 2: Multiple Data Elements, Single Period
```sql
SELECT * FROM analytics
/* DHIS2: dimension=dx:FTRrcoaog83;FQ2o8UBlcrS;M62VHgYT2n0;WO8yRIZb7nb&dimension=pe:LAST_YEAR&dimension=ou:USER_ORGUNIT&displayProperty=NAME&skipMeta=false */
```

**Chart**: Bar chart comparing different indicators

### Example 3: Multiple Org Units, Single Data Element
```sql
SELECT * FROM analytics
/* DHIS2: dimension=dx:FTRrcoaog83&dimension=pe:LAST_YEAR&dimension=ou:ImspTQPwCqd;UR31R1ogoal;lc3eMKXaEfw;wGpU8WCx3xA&displayProperty=NAME&skipMeta=false */
```

**Chart**: Bar chart with OrgUnit on x-axis comparing districts

## What's Next?

### Coming Soon
- **SQL Lab Query Builder**: Visual parameter builder for SQL Lab (like dataset creation)
- **Dynamic Column Discovery**: No more manual metadata sync
- **Parameter Templates**: Save and reuse common dimension combinations

### Documentation
- Full implementation details: [DHIS2_CHART_IMPLEMENTATION_COMPLETE.md](./DHIS2_CHART_IMPLEMENTATION_COMPLETE.md)
- SQL Lab query builder plan: [DHIS2_SQL_LAB_QUERY_BUILDER_PLAN.md](./DHIS2_SQL_LAB_QUERY_BUILDER_PLAN.md)

## Getting Help

- DHIS2 API Documentation: https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/analytics.html
- Superset Documentation: https://superset.apache.org/docs/intro
- Report Issues: Create a GitHub issue with "DHIS2" label
