# DHIS2 Charting Fix - Implementation Guide

## Problem Summary

DHIS2-based datasets in Superset were incorrectly forcing **Period** as the X-axis on all charts, even when users selected other dimensions like **OrgUnit** (Regions). This prevented creating charts grouped by regions, data element groups, or other DHIS2 dimensions.

## Root Causes

1. **Time-series bias**: Superset was treating DHIS2 datasets as time-series by default
2. **Period as main datetime column**: Period was auto-flagged as the primary temporal column
3. **Chart type confusion**: Using time-series chart types when categorical charts were needed
4. **GENERIC_CHART_AXES not enabled**: Legacy time controls were forcing Period usage

## Solution Overview

The fix involves both **configuration** and **workflow changes**:

### 1. Configuration (Already Applied)

✅ **Enabled in `superset_config.py`:**

```python
FEATURE_FLAGS = {
    "GENERIC_CHART_AXES": True,  # Allows non-temporal X-axis on charts
}
```

This decouples the X-axis from automatic time column selection.

### 2. Dataset Configuration (Required for Each DHIS2 Dataset)

When creating or editing DHIS2 datasets:

#### Option A: Period as Categorical (Recommended for most use cases)

1. Go to **Data > Datasets** → Select your DHIS2 dataset → **Edit**
2. In the **Columns** tab:
   - Find the **Period** column
   - Ensure **"Is Temporal"** is **UNCHECKED** (not marked as datetime)
3. In the **Settings** tab:
   - **Main Datetime Column**: Set to `None` or a different column if you have a real date field
4. Save the dataset

**Result**: Period can now be used as a regular categorical dimension.

#### Option B: Dual Period Columns (For Both Time-Series and Categorical)

If you need both time-series AND categorical period charts:

1. Add two Period columns to your DHIS2 dataset:
   - `period` (string, categorical) - for grouping by period text
   - `period_date` (temporal) - parsed date for time-series charts
2. Mark only `period_date` as temporal
3. Use the appropriate column based on chart type

### 3. Chart Creation Workflow

#### For Charts with **Regions/OrgUnits as Categories** (Most Common)

**Chart Type**: **Bar Chart** (categorical, NOT "Time-series Bar Chart")

**Configuration**:
- **X-Axis / Group By**: `orgunit` or `orgunit_name`
- **Metrics**: Your DHIS2 indicator values (e.g., `SUM(value)`)
- **Period Handling** - Choose one:
  
  **Option 1: Filter to Single Period** (Recommended)
  - Add **Filter**: `period = "202301"` (or your desired period)
  - Shows data for one time period across regions
  
  **Option 2: Compare Periods as Series**
  - **Series / Breakdown**: `period`
  - Creates clustered/stacked bars comparing periods within each region
  
  **Option 3: Aggregate Across Periods**
  - **Metrics**: Use aggregation (SUM, AVG) across all selected periods
  - No period dimension in the chart

**Example Chart Configurations**:

```
Chart 1: Malaria Cases by Region (Single Month)
- Type: Bar Chart
- X-Axis: orgunit_name
- Metric: SUM(malaria_cases)
- Filter: period = "2024-01"

Chart 2: Malaria Cases by Region (Comparing Quarters)
- Type: Bar Chart  
- X-Axis: orgunit_name
- Metric: SUM(malaria_cases)
- Series: period
- Filter: period IN ("2024Q1", "2024Q2", "2024Q3")
```

#### For **Time-Series Charts** (Period as X-Axis)

**Chart Type**: **Time-series Bar Chart** or **Time-series Line Chart**

**Configuration**:
- **X-Axis**: `period_date` (if you have it) OR `period` (if marked temporal)
- **Time Grain**: Select appropriate grain (Month, Quarter, Year)
- **OrgUnit Handling** - Choose one:
  - **Filter**: `orgunit = "Uganda"` (single region)
  - **Series / Breakdown**: `orgunit_name` (compare regions over time)

#### For **Multi-Dimensional Analysis**

**Chart Type**: **Pivot Table**

**Configuration**:
- **Rows**: `orgunit_name`, `data_element_group`
- **Columns**: `period`
- **Metrics**: Your indicator values

---

## Quick Setup & Run Instructions

### First-Time Setup (Python 3.11 Required)

Apache Superset doesn't support Python 3.13 yet due to dependency issues. You need Python 3.11 or 3.10.

**Run the automated setup:**

```bash
cd /Users/edwinarinda/Projects/Redux/superset

# Run setup script (installs Python 3.11, creates venv, installs dependencies)
./setup-python311.sh
```

**Manual setup (if script fails):**

```bash
# Install Python 3.11
brew install python@3.11

# Remove old virtual environment
rm -rf .venv

# Create new venv with Python 3.11
python3.11 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install --upgrade pip setuptools wheel
pip install -e .
pip install -r requirements/development.txt

# Initialize Superset
export SUPERSET_CONFIG_PATH=$(pwd)/superset_config.py
superset db upgrade
superset init
superset fab create-admin
```

### Running Superset (Non-Docker)

**Quick start:**

```bash
./run-superset.sh
```

**Manual start:**

```bash
source .venv/bin/activate
export SUPERSET_CONFIG_PATH=/Users/edwinarinda/Projects/Redux/superset/superset_config.py
export FLASK_APP=superset
superset run -p 8088 --with-threads --reload --debugger
```

Visit: **http://localhost:8088**

---

## Testing the Fix

### Test Case 1: Bar Chart with Regions as X-Axis

1. **Create Chart**:
   - Dataset: Your DHIS2 dataset
   - Visualization Type: **Bar Chart**
   - X-Axis: Select `orgunit` or `orgunit_name`
   - Metrics: Add `SUM(value)` or your indicator
   - Filters: `period = "202301"`

2. **Expected Result**:
   - X-axis shows region names
   - Bars show values per region
   - Period is NOT forced as X-axis

3. **Verify**:
   - Try changing X-axis to different dimensions
   - Confirm Period stays as filter (not forced to X-axis)

### Test Case 2: Period as Categorical Dimension

1. **Create Chart**:
   - Visualization Type: **Bar Chart**
   - X-Axis: `period`
   - Metrics: `SUM(value)`
   - Filters: `orgunit = "Central Region"`

2. **Expected Result**:
   - X-axis shows period labels (202301, 202302, etc.)
   - No time-series controls required
   - Works without time range or time grain

### Test Case 3: Pivot Table with DHIS2 Dimensions

1. **Create Chart**:
   - Visualization Type: **Pivot Table**
   - Rows: `orgunit_name`
   - Columns: `period`
   - Metrics: `SUM(value)`

2. **Expected Result**:
   - Rows grouped by org unit
   - Columns grouped by period
   - Period not forced into any specific axis

---

## Troubleshooting

### Issue: Period Still Forced as X-Axis

**Solution**:
1. Check dataset configuration:
   - Edit dataset → Columns → Ensure Period is NOT marked as temporal
   - Settings → Main Datetime Column → Set to None
2. Use **Bar Chart** (categorical), not "Time-series Bar Chart"
3. Clear browser cache and refresh

### Issue: "Time Range Required" Error

**Solution**:
- You're using a time-series chart type with a non-temporal column
- Either:
  - Change to categorical chart type (Bar Chart, not Time-series Bar), OR
  - Mark Period as temporal in dataset and provide time range

### Issue: Can't Select OrgUnit on X-Axis

**Solution**:
- Check chart type supports categorical X-axis (Bar Chart, Table, Pivot)
- Verify OrgUnit column exists in dataset
- Refresh the Explore page

### Issue: Python 3.13 Compatibility Error (gevent)

**Solution**:
- Run `./setup-python311.sh` to reinstall with Python 3.11
- Or manually: `brew install python@3.11` then recreate venv

---

## Implementation Plan Reference

For the complete technical implementation plan to fix this at the code level (if deeper changes are needed), see the research notes at the top of this repository's plan output.

**Key Phases**:
1. ✅ Phase 1: Configuration (GENERIC_CHART_AXES enabled)
2. ✅ Phase 2: Dataset metadata modeling (automated script available)
3. 🔄 Phase 3: Query building fixes (may need code changes)
4. 🔄 Phase 4: Frontend Explore controls (may need code changes)
5. ✅ Phase 5: Feature flags (enabled)
6. ✅ Phase 6: Migration for existing datasets (automated script available)

**Note**: The current fix uses configuration and workflow changes. If you still experience issues after following this guide, deeper code changes in the query builder and Explore controls may be needed (see the full implementation plan).

---

## Automated Tools

### Quick Restart Script (NEW!)

Use the automated restart script to start both backend and frontend:

```bash
./restart-all.sh
```

This script will:
- Stop all running Superset services
- Clear all caches
- Verify GENERIC_CHART_AXES configuration
- Start backend on port 8088
- Start frontend on port 9000
- Display access URLs and process IDs

**Monitor logs:**
```bash
./monitor-logs.sh
```

### Automated Dataset Fix Script (NEW!)

To automatically fix all DHIS2 datasets' temporal configuration:

```bash
# Activate virtual environment first
source .venv/bin/activate

# Run the fix script
python scripts/fix_dhis2_dataset_temporal.py
```

This script will:
- Find all datasets with 'period' columns
- Remove Period as main datetime column
- Unmark period columns as temporal
- Show before/after summary

**Note**: This automates the manual steps described in "Dataset Configuration" above.

---

## Resources

- **Superset GENERIC_CHART_AXES Documentation**: [UPDATING.md](UPDATING.md)
- **DHIS2 Integration Guide**: [DHIS2_QUICK_START.md](DHIS2_QUICK_START.md)
- **Configuration File**: [superset_config.py](superset_config.py)
- **Setup Scripts**: 
  - [setup-python311.sh](setup-python311.sh)
  - [run-superset.sh](run-superset.sh)

---

## Support

If you encounter issues:

1. Check this guide's Troubleshooting section
2. Review your dataset configuration (Period temporal flag, main datetime column)
3. Verify chart type (categorical vs time-series)
4. Check browser console for errors
5. Review Superset logs: `tail -f superset_backend.log`

**Remember**: The key insight is that DHIS2 data is **multi-dimensional**, not strictly time-series. Period is just one dimension among many (OrgUnits, groups, indicators). Superset should treat it flexibly based on your chart configuration.

