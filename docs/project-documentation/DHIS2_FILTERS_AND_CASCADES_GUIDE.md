# DHIS2 Filters and Cascading Filters Guide

This guide explains how filters and cascading filters work with DHIS2 datasets in Superset.

## Overview

DHIS2 data is multi-dimensional with three primary dimensions:
- **dx (Data)**: Data elements, indicators, program indicators
- **pe (Period)**: Time periods (daily, weekly, monthly, quarterly, yearly)
- **ou (Organisation Unit)**: Hierarchical administrative units

Superset supports filtering on all these dimensions through:
1. **Dashboard Native Filters** - Filters at dashboard level affecting multiple charts
2. **Chart Filters** - Filters specific to individual charts
3. **Cascading Filters** - Hierarchical filters where child filter values depend on parent selection

---

## OrgUnit Data Disaggregation

### Understanding Aggregated vs Disaggregated Data

When querying DHIS2 analytics, you can choose how org unit data is displayed:

| Mode | Description | Example Result |
|------|-------------|----------------|
| **Aggregated** | Shows totals for selected org units only | "Acholi Region: 1,854,846 cases" |
| **Disaggregated** | Shows separate rows for each org unit under selection | Districts, Sub-counties, Facilities each as separate rows |

### How Disaggregation Works (Automatic)

When you select **"Disaggregated"** mode in the DHIS2 Query Builder:

1. **Automatic LEVEL Detection**: The system automatically fetches your DHIS2 organisation unit levels (e.g., National, Region, District, Sub County, Health Facility)

2. **Dynamic Query Construction**: The query is automatically built with all available levels from your DHIS2 instance:
   ```
   dimension=ou:SELECTED_UID;LEVEL-1;LEVEL-2;LEVEL-3;LEVEL-4;LEVEL-5
   ```

3. **DHIS2 Returns Disaggregated Data**: This tells DHIS2 to return data for each org unit at those levels **under the specified UID**, giving you separate rows for each district, sub-county, facility, etc.

### Example

If you select "Acholi" region with **Disaggregated** mode enabled:

**Query Automatically Generated:**
```
dimension=ou:SUvODYOcaVf;LEVEL-1;LEVEL-2;LEVEL-3;LEVEL-4;LEVEL-5
```

**Result:** Separate rows for each district, sub-county, and facility under Acholi:
```
Period | National    | Region | District | Sub_County | Facility    | Cases
2023   | MOH-Uganda  | Acholi | Gulu     | Gulu TC    | Gulu RRH   | 45,234
2023   | MOH-Uganda  | Acholi | Gulu     | Gulu TC    | Gulu HC IV | 12,456
2023   | MOH-Uganda  | Acholi | Kitgum   | Kitgum TC  | Kitgum RRH | 32,156
...
```

### Setting Up in Query Builder

In the Organisation Units section, you'll see two options:

```
📍 Aggregated - Show aggregated totals for selected org units only
🌳 Disaggregated - Show separate rows for each district, facility, etc.
```

When **"Disaggregated"** is selected:
- The system automatically detects available org unit levels from your DHIS2 instance
- `LEVEL-1`, `LEVEL-2`, etc. parameters are automatically added to the ou dimension
- DHIS2 returns data disaggregated by each org unit at those levels under your selection
- Each row in the result represents a specific org unit (district, facility, etc.)

### Available Hierarchy Columns

All DHIS2 endpoints now include complete org unit hierarchy columns:

| Endpoint | Hierarchy Columns |
|----------|------------------|
| analytics | Period, National, Region, District, Sub County, Health Facility, [Data Elements] |
| dataValueSets | dataElement, period, National, Region, District, Sub County, Health Facility, value, storedBy |
| events | event, program, National, Region, District, ..., eventDate, status |
| enrollments | enrollment, program, National, Region, District, ..., enrollmentDate |
| trackedEntityInstances | trackedEntityInstance, National, Region, District, ..., created |

### Setting Up Cascading OrgUnit Filters

To create cascading org unit filters on a dashboard:

1. **Create Parent Filter (e.g., Region)**
   - Add a Native Filter
   - Select your DHIS2 dataset
   - Choose "Region" column
   - Enable "Can select multiple values"

2. **Create Child Filter (e.g., District)**
   - Add another Native Filter
   - Select same DHIS2 dataset
   - Choose "District" column
   - In "Parent Filters" section, select "Region" filter
   - Enable "Cascading" option

3. **Create Grandchild Filter (e.g., Facility)**
   - Add another Native Filter
   - Select "Health_Facility" column
   - Set "District" as parent filter
   - Enable "Cascading"

### Example: 5-Level Hierarchy Cascade

```
National → Region → District → Sub County → Health Facility
```

Each level filters the values available in the next level.

---

## Period Filtering

### Period Column Types

DHIS2 periods follow standard formats:

| Period Type | Format | Example |
|-------------|--------|---------|
| Daily | yyyyMMdd | 20231215 |
| Weekly | yyyyWn | 2023W50 |
| Monthly | yyyyMM | 202312 |
| Bi-monthly | yyyyMMB | 202311B |
| Quarterly | yyyyQn | 2023Q4 |
| Six-monthly | yyyySn | 2023S2 |
| Yearly | yyyy | 2023 |
| Financial Year (July) | yyyyJuly | 2023July |
| Financial Year (April) | yyyyApril | 2023April |

### Hierarchical Period Aggregation

DHIS2 data can be aggregated upward based on the minimum period type:

```
Daily → Weekly → Monthly → Quarterly → Six-Monthly → Yearly
```

For example:
- Monthly data (202301, 202302, 202303) aggregates to Quarterly (2023Q1)
- Quarterly data aggregates to Yearly (2023)

### Setting Up Period Filters

#### Option 1: Period Value Filter
- Filter on the "Period" column directly
- Users select specific periods like "202312", "2023Q4", "2023"

#### Option 2: Period Type + Period Value Cascade
- Create a "Period Type" filter (Yearly, Quarterly, Monthly)
- Create a "Period" filter cascading from Period Type
- Only shows periods matching the selected type

### Period Relative Filters

For dynamic period selection, use relative periods:

| Relative Period | Description |
|----------------|-------------|
| THIS_YEAR | Current year |
| LAST_YEAR | Previous year |
| LAST_12_MONTHS | Rolling 12 months |
| LAST_4_QUARTERS | Rolling 4 quarters |
| THIS_QUARTER | Current quarter |
| LAST_QUARTER | Previous quarter |

---

## Filter Configuration Best Practices

### 1. OrgUnit Filters

```yaml
# Recommended setup for org unit filtering
filters:
  - name: Region
    column: Region
    type: select
    multiple: true
    
  - name: District  
    column: District
    type: select
    multiple: true
    parent: Region
    cascade: true
    
  - name: Facility
    column: Health_Facility
    type: select
    multiple: true
    parent: District
    cascade: true
```

### 2. Period Filters

```yaml
# Recommended setup for period filtering
filters:
  - name: Year
    column: Period
    type: select
    filter: "LIKE '____'" # 4-digit years only
    
  - name: Period
    column: Period
    type: select
    multiple: true
```

### 3. Data Element Filters

For analytics datasets with pivoted data elements:
```yaml
# Data element columns become individual columns
# Filter by showing/hiding columns or using chart controls
```

---

## Technical Implementation

### How Cascading Works

1. **Parent filter selection** creates `extraFormData` with filter clause
2. **Child filter query** includes parent's `extraFormData` as dependency
3. **Child filter values** are filtered by parent selection
4. **Chart queries** include all filter `extraFormData` in WHERE clause

### DHIS2 Column Metadata

All DHIS2 columns are defined with:
```python
{
    "name": "Region",           # Sanitized column name
    "type": types.String(),     # String type for dimensions
    "groupby": True,            # Can be used in GROUP BY
    "filterable": True,         # Can be filtered
    "is_numeric": False,        # Not aggregatable
}
```

### Filter Query Translation

When a filter is applied:
1. Superset builds SQL WHERE clause
2. DHIS2 dialect translates to API parameters
3. Data is fetched and filtered

Example:
```sql
-- Superset generates:
SELECT * FROM analytics WHERE Region = 'Acholi'

-- DHIS2 dialect translates to:
/* DHIS2: dimension=dx:..;pe:..;ou:.. */
-- Then filters result by Region = 'Acholi'
```

---

## Troubleshooting

### Filter Not Showing Values

1. Check column exists in dataset metadata
2. Verify column is marked as `filterable: true`
3. Ensure data exists for the filter values

### Cascade Not Working

1. Verify parent filter is correctly linked
2. Check `cascadeParentIds` in filter config
3. Ensure both filters use same dataset

### Period Aggregation Issues

1. Confirm period format matches DHIS2 standards
2. Check data exists at the aggregation level
3. Verify analytics tables are updated in DHIS2

---

## Example Dashboard Setup

### 1. Create DHIS2 Dataset
```
Table: analytics
Columns: Period, National, Region, District, Sub_County, Health_Facility, [Data Elements]
```

### 2. Add Native Filters
```
1. Region Filter (no parent)
2. District Filter (parent: Region, cascade: true)  
3. Period Filter (no parent)
```

### 3. Create Charts
```
1. Bar Chart: Data by Region
2. Line Chart: Trend over Period
3. Table: Detailed data with all dimensions
```

### 4. Apply Filters
- Select "Central Region"
- District filter now only shows Central Region districts
- All charts update to show Central Region data

---

## API Reference

### Dashboard Filter Configuration

```json
{
  "native_filter_configuration": [
    {
      "id": "filter_region",
      "name": "Region",
      "targets": [{"datasetId": 1, "column": {"name": "Region"}}],
      "cascadeParentIds": [],
      "filterType": "filter_select"
    },
    {
      "id": "filter_district", 
      "name": "District",
      "targets": [{"datasetId": 1, "column": {"name": "District"}}],
      "cascadeParentIds": ["filter_region"],
      "filterType": "filter_select"
    }
  ]
}
```

### Chart Extra Form Data

```json
{
  "extraFormData": {
    "filters": [
      {"col": "Region", "op": "IN", "val": ["Central"]}
    ]
  }
}
```
