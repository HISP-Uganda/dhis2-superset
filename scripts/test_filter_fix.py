#!/usr/bin/env python3
"""
Quick test to verify WHERE clause filter detection is working
"""

# Test SQL with WHERE clause
test_query = """
SELECT "Region", "105_EP01d_Malaria_cases_treated"
FROM (SELECT * FROM analytics
/* DHIS2: table=analytics&dx=JhvC7ZR9hUe&pe=LAST_5_YEARS&ou=yx0ieyZNF0l;QBPg7KKCeoA&ouMode=DESCENDANTS */
) AS virtual_table
WHERE "Region" IN ('Bunyoro')
LIMIT 10000
"""

# Import the modified code
import sys
sys.path.insert(0, '/Users/edwinarinda/Projects/Redux/superset')

from superset.db_engine_specs.dhis2_dialect import DHIS2Cursor

# Create a mock cursor
cursor = DHIS2Cursor(None)

# Test the _extract_query_params method
params = cursor._extract_query_params(test_query)

print("=" * 80)
print("TEST: WHERE Clause Filter Detection")
print("=" * 80)
print(f"\nTest Query:")
print(test_query)
print("\n" + "=" * 80)
print("Extracted Parameters:")
print("=" * 80)
for key, value in params.items():
    print(f"  {key}: {value}")

print("\n" + "=" * 80)
print("Expected Results:")
print("=" * 80)
print("✅ Should have: 'ou_name_filters': ['Bunyoro']")
print("✅ Should have: 'ou_filter_level': 2")
print("✅ Should have base params from SQL comments")

print("\n" + "=" * 80)
print("Actual Results:")
print("=" * 80)
if 'ou_name_filters' in params:
    print(f"✅ 'ou_name_filters' found: {params['ou_name_filters']}")
else:
    print("❌ 'ou_name_filters' NOT found!")

if 'ou_filter_level' in params:
    print(f"✅ 'ou_filter_level' found: {params['ou_filter_level']}")
else:
    print("⚠️  'ou_filter_level' not set (this is OK)")

if 'table' in params:
    print(f"✅ Base params loaded: table={params['table']}")
else:
    print("❌ Base params NOT loaded!")

print("\n" + "=" * 80)
if 'ou_name_filters' in params and params['ou_name_filters'] == ['Bunyoro']:
    print("🎉 SUCCESS! WHERE clause filter detection is working!")
else:
    print("❌ FAILED! Code changes may not be loaded.")
    print("   Try: rm -rf superset/db_engine_specs/__pycache__")
    print("   Then restart Superset")
print("=" * 80)
