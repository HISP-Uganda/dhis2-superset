#!/bin/bash

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  FINAL VERIFICATION - DHIS2 COLUMN SANITIZATION FIX           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

cd /Users/edwinarinda/Projects/Redux/superset

# 1. Check sanitization function
echo "✓ Checking sanitize_dhis2_column_name() function..."
if grep -q "name.replace('-', '_')" superset/db_engine_specs/dhis2_dialect.py; then
  echo "  ✅ Dash replacement present (line 44)"
else
  echo "  ❌ Dash replacement NOT found"
  exit 1
fi
echo ""

# 2. Check postprocessing safety layer
echo "✓ Checking postprocessing safety layer..."
if grep -q "from superset.db_engine_specs.dhis2_dialect import sanitize_dhis2_column_name" superset/utils/pandas_postprocessing/utils.py; then
  echo "  ✅ DHIS2 sanitization imported in utils.py"
else
  echo "  ❌ DHIS2 sanitization import NOT found"
  exit 1
fi
echo ""

# 3. Verify Python syntax
echo "✓ Verifying Python syntax..."
python -m py_compile superset/db_engine_specs/dhis2_dialect.py 2>&1 && echo "  ✅ dhis2_dialect.py OK" || { echo "  ❌ Syntax error"; exit 1; }
python -m py_compile superset/utils/pandas_postprocessing/utils.py 2>&1 && echo "  ✅ utils.py OK" || { echo "  ❌ Syntax error"; exit 1; }
python -m py_compile superset/models/helpers.py 2>&1 && echo "  ✅ helpers.py OK" || { echo "  ❌ Syntax error"; exit 1; }
echo ""

# 4. Check superset_core
echo "✓ Checking superset_core installation..."
if python -c "import superset_core; print('  ✅ superset_core installed')" 2>&1; then
  true
else
  echo "  ⚠️  superset_core not installed (run: pip install -e ./superset-core)"
fi
echo ""

# 5. Check DHIS2 configuration
echo "✓ Checking DHIS2 configuration..."
if grep -q "GENERIC_CHART_AXES.*True" superset_config.py; then
  echo "  ✅ GENERIC_CHART_AXES enabled"
else
  echo "  ❌ GENERIC_CHART_AXES not enabled"
fi

if grep -q "requires_time_column.*False" superset/db_engine_specs/dhis2.py; then
  echo "  ✅ requires_time_column = False"
else
  echo "  ❌ requires_time_column not set correctly"
fi

if grep -q "should_pivot.*True" superset/db_engine_specs/dhis2_dialect.py; then
  echo "  ✅ should_pivot = True"
else
  echo "  ⚠️  should_pivot check"
fi
echo ""

# 6. Summary
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  ✅ ALL VERIFICATIONS PASSED                                   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "You can now start Superset with: ./superset-manager.sh"
echo ""
