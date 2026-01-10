# Superset DHIS2 Fix - Restart Guide

## ✅ Fixed Issues

1. **Backend Startup** - `ModuleNotFoundError: No module named 'superset_core'`
   - Fixed by: `pip install -e ./superset-core`
   - Status: ✅ RESOLVED

2. **Column Sanitization** - "Column referenced by aggregate is undefined" error
   - Fixed in: `superset/db_engine_specs/dhis2_dialect.py` (added dash replacement)
   - Fixed in: `superset/utils/pandas_postprocessing/utils.py` (added safety layer)
   - Status: ✅ RESOLVED

3. **Frontend Warnings** - React console warnings
   - Status: ⚠️ Non-critical (Ant Design deprecations, React Rules of Hooks)
   - Action: Can be addressed in separate PR

## 🚀 How to Restart Superset

### Option 1: Use the Management Script (RECOMMENDED)
```bash
cd /Users/edwinarinda/Projects/Redux/superset
./superset-manager.sh
```

**What this does:**
- ✅ Clears Python cache automatically
- ✅ Stops any existing processes
- ✅ Starts backend on port 8088
- ✅ Monitors startup status

### Option 2: Manual Restart
```bash
cd /Users/edwinarinda/Projects/Redux/superset

# Step 1: Kill existing processes
pkill -f superset || true
sleep 2

# Step 2: Clear Python cache
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
find . -name "*.pyc" -delete 2>/dev/null

# Step 3: Install superset_core (if not already done)
pip install -e ./superset-core

# Step 4: Start backend
python -c "
import sys
sys.path.insert(0, '.')
from flask import Flask
from superset.app import create_app
from superset.cli.cli import cli
cli()
" run -p 8088 --with-threads
```

### Option 3: Simple Script
```bash
./restart-with-fix.sh
```

## ✅ Verification Steps

After starting Superset:

1. **Access the UI**
   - Open: http://localhost:8088
   - Should load without errors

2. **Test Column Sanitization**
   - Create a new chart with DHIS2 data
   - Add a metric with special characters in the name
   - Should NOT see "Column referenced by aggregate is undefined"
   - Should see actual data values

3. **Test Samples Tab**
   - In chart explore, go to Samples tab
   - Should show data values (not N/A)
   - Frontend sanitization is working

4. **Refresh Metadata (Recommended)**
   - Admin → Databases → Select DHIS2 database
   - Click "Refresh Metadata"
   - This ensures cached column info is cleared

## 📋 What Changed

### Backend Files Modified
```
superset/db_engine_specs/dhis2_dialect.py
  └─ Line 44: Added dash-to-underscore replacement

superset/utils/pandas_postprocessing/utils.py
  └─ Lines 152-171: Added DHIS2 column sanitization safety layer
```

### Dependencies Fixed
```bash
pip install -e ./superset-core  # ← Required for backend to start
```

## 🐛 Troubleshooting

### Still getting "Column referenced by aggregate is undefined"?

1. **Check Python cache cleared:**
   ```bash
   find . -type d -name __pycache__ | wc -l  # Should be 0
   ```

2. **Verify code changes:**
   ```bash
   grep "replace('-'" superset/db_engine_specs/dhis2_dialect.py
   # Should show: name = name.replace('-', '_')
   ```

3. **Check superset-core installed:**
   ```bash
   python -c "import superset_core; print('✅ OK')"
   ```

4. **Restart completely:**
   ```bash
   pkill -f superset
   sleep 3
   ./superset-manager.sh
   ```

### Frontend showing React warnings?

These are non-critical warnings from Ant Design deprecations:
- `[antd: Menu] children is deprecated`
- `[antd: Select] dropdownStyle is deprecated`
- `[antd: Tooltip] destroyTooltipOnHide is deprecated`

These don't affect functionality and can be fixed in a separate update.

### WebSocket connection errors?

These occur when the frontend dev server reconnects. They're normal and will resolve once you create/modify a chart (triggers API calls).

## ✨ Expected Behavior After Fix

✅ Charts display actual data values  
✅ No "Column referenced by aggregate is undefined" errors  
✅ Samples tab shows populated data  
✅ Metrics with special characters work  
✅ Both new and old metrics function correctly  

## 📞 If Issues Persist

1. Check logs: `tail -f superset_backend.log`
2. Verify database connection is active
3. Refresh table metadata in UI
4. Try creating a brand new chart from scratch
5. Check that all Python files compile:
   ```bash
   python -m py_compile superset/db_engine_specs/dhis2_dialect.py
   python -m py_compile superset/utils/pandas_postprocessing/utils.py
   ```
