# Testing DHIS2 Charting Implementation

## 🚀 Quick Start

### Step 1: Start Backend

Open a terminal and run:

```bash
cd /Users/edwinarinda/Projects/Redux/superset

# Stop any running services
pkill -f "superset run"
sleep 2

# Activate virtual environment
source venv/bin/activate

# Set configuration
export SUPERSET_CONFIG_PATH=/Users/edwinarinda/Projects/Redux/superset/superset_config.py
export FLASK_APP=superset

# Start Superset backend
superset run -p 8088 --with-threads --reload --debugger
```

**Expected output**: 
```
Loaded your LOCAL configuration at [/Users/edwinarinda/Projects/Redux/superset/superset_config.py]
...
Running on http://127.0.0.1:8088/ (Press CTRL+C to quit)
```

**Access**: Open browser to http://localhost:8088

---

## 🧪 Testing the Fix

### Test 1: Login and Access Dataset

1. **Open**: http://localhost:8088
2. **Login**: Use your admin credentials
3. **Navigate**: Data → Datasets → Find your DHIS2 dataset

**Expected**: Dataset loads without errors

---

### Test 2: Dataset Preview (New Feature!)

1. **In dataset view**, click the **Preview** tab
2. **Expected**: 
   - Data displays in horizontal format
   - Each data element as separate column
   - Columns: `Period`, `OrgUnit`, `[Data Element 1]`, `[Data Element 2]`, etc.

**Before the fix**: Preview might have failed or shown vertical format
**After the fix**: ✅ Preview works, shows horizontal columns

---

### Test 3: Create Chart with OrgUnit as X-Axis (Main Fix!)

1. **Click**: "Create Chart" on your DHIS2 dataset
2. **Select**: Visualization Type → **Bar Chart** (NOT Time-series)
3. **Configure**:
   - **X-Axis**: Click and select `OrgUnit` or `orgunit_name`
   - **Metrics**: Add a metric (e.g., `SUM(Malaria Cases)`)
   - **Filters**: Add `Period = "202401"` (or any period)
4. **Click**: "Run Query"

**Expected**: ✅ Chart displays with regions on X-axis

**Before the fix**: 
- ❌ Couldn't select OrgUnit as X-axis
- ❌ Period was forced as X-axis
- ❌ Error: "Datetime column not provided"

**After the fix**:
- ✅ OrgUnit appears as X-axis option
- ✅ Period can be used as filter
- ✅ No datetime errors!

---

### Test 4: Create Chart with Period as X-Axis

1. **Create new chart** from DHIS2 dataset
2. **Select**: Bar Chart or Line Chart (regular, not time-series)
3. **Configure**:
   - **X-Axis**: Select `Period`
   - **Metrics**: Add your metric
   - **Filters**: Add `OrgUnit = "Central"` (optional)
4. **Run Query**

**Expected**: ✅ Chart displays with periods on X-axis

**This tests**: Period works as a regular dimension (not forced temporal)

---

### Test 5: Create Pivot Table (Multi-Dimensional)

1. **Create new chart**
2. **Select**: Visualization Type → **Pivot Table**
3. **Configure**:
   - **Rows**: Add `OrgUnit`
   - **Columns**: Add `Period`
   - **Metrics**: Add multiple data elements
4. **Run Query**

**Expected**: ✅ Pivot table with regions in rows, periods in columns

**This tests**: Complete flexibility with dimensions

---

### Test 6: Try Different Chart Types

Test that ANY chart type works with ANY column:

#### Test 6a: Line Chart with OrgUnit
```
Chart: Line Chart
X-Axis: OrgUnit
Result: ✅ Should work!
```

#### Test 6b: Bar Chart with Period
```
Chart: Bar Chart
X-Axis: Period
Result: ✅ Should work!
```

#### Test 6c: Area Chart with DataElement (if available)
```
Chart: Area Chart
X-Axis: Any dimension
Result: ✅ Should work!
```

---

## ✅ Success Criteria

### Backend Tests
- [x] Migration applied (already done)
- [ ] Backend starts without errors
- [ ] Health check returns OK: `curl http://localhost:8088/health`

### Dataset Tests
- [ ] DHIS2 dataset loads without errors
- [ ] Dataset preview shows horizontal format (data elements as columns)
- [ ] No "datetime column required" errors

### Chart Creation Tests
- [ ] Can select OrgUnit as X-axis
- [ ] Can select Period as X-axis
- [ ] Can select any column as X-axis
- [ ] No forced Period as X-axis
- [ ] Charts display correctly
- [ ] Can use Period as filter (not forced as X-axis)

### Flexibility Tests
- [ ] Bar Chart works with OrgUnit as X-axis
- [ ] Bar Chart works with Period as X-axis
- [ ] Line Chart works with OrgUnit as X-axis
- [ ] Pivot Table works with any dimensions
- [ ] No chart type restrictions!

---

## 🐛 If Something Doesn't Work

### Issue: Backend won't start

**Check**: 
```bash
cat superset_backend.log
```

**Common causes**:
- Port 8088 already in use
- Virtual environment not activated
- Missing dependencies

**Solution**:
```bash
# Kill existing processes
pkill -f "superset run"

# Verify port is free
lsof -ti:8088

# Restart
source venv/bin/activate
export SUPERSET_CONFIG_PATH=/Users/edwinarinda/Projects/Redux/superset/superset_config.py
superset run -p 8088
```

---

### Issue: "Datetime column not provided" error

**This means**: Migration wasn't applied

**Solution**:
```bash
source venv/bin/activate
export SUPERSET_CONFIG_PATH=/Users/edwinarinda/Projects/Redux/superset/superset_config.py
superset db upgrade
```

**Verify**:
```bash
superset db current
```

Should show: `dhis2_categorical_fix` in the output

---

### Issue: Can't select OrgUnit as X-axis

**Check**:
1. Are you using "Bar Chart" or "Time-series Bar Chart"?
   - Use regular "Bar Chart"
2. Is the dataset DHIS2-based?
3. Was the migration applied?

**Debug**:
```bash
# Check dataset configuration in database
sqlite3 superset_home/superset.db
> SELECT id, table_name, main_dttm_col FROM tables WHERE database_id = 1;
> SELECT id, column_name, is_dttm, groupby FROM table_columns WHERE table_id = 1;
```

Expected:
- `main_dttm_col` should be NULL or not "period"
- Period columns should have `is_dttm = 0`
- OrgUnit columns should have `groupby = 1`

---

### Issue: Data shows in vertical format

**Check**: `dhis2_dialect.py` line ~1510

**Should be**:
```python
should_pivot = True  # Always pivot analytics to get dx as separate columns
```

---

## 📊 Example Test Workflow

### Complete Test Run

```bash
# 1. Start backend
cd /Users/edwinarinda/Projects/Redux/superset
source venv/bin/activate
export SUPERSET_CONFIG_PATH=$(pwd)/superset_config.py
superset run -p 8088

# In another terminal:

# 2. Test health
curl http://localhost:8088/health
# Expected: "OK"

# 3. Open browser
open http://localhost:8088

# 4. Test in UI:
#    - Login
#    - Go to DHIS2 dataset
#    - Create chart
#    - Select OrgUnit as X-axis ✅
#    - Run query
#    - Verify chart displays
```

---

## 🎉 What Success Looks Like

When you create a chart:

1. **X-Axis dropdown** shows ALL columns (not just Period)
2. **You can select** `OrgUnit`, `DataElement`, or any column
3. **No errors** about datetime columns
4. **Chart displays** with your selected column on X-axis
5. **Period can be** a filter instead of forced X-axis

**This is the complete flexibility you should have!**

---

## 📝 Report Test Results

After testing, document what works:

```
✅ Backend starts: YES/NO
✅ Dataset preview: YES/NO
✅ OrgUnit as X-axis: YES/NO
✅ Period as filter: YES/NO
✅ No datetime errors: YES/NO
✅ Charts display correctly: YES/NO

Notes:
[Any issues or observations]
```

---

## 🆘 Need Help?

If tests fail:
1. Check `superset_backend.log` for errors
2. Verify migration applied: `superset db current`
3. Check configuration: `grep GENERIC_CHART_AXES superset_config.py`
4. Review implementation files (see `FINAL_SUMMARY.md`)

---

**Ready to test!** Start the backend and follow the test cases above.

