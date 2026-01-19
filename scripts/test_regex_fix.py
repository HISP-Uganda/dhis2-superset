#!/usr/bin/env python3
"""
Test regex pattern for WHERE clause with quoted column names
"""
import re

# Test query with quoted column name
test_query = """
SELECT "Region", "105_EP01d_Malaria_cases_treated"
FROM (SELECT * FROM analytics
/* DHIS2: table=analytics&dx=JhvC7ZR9hUe&pe=LAST_5_YEARS&ou=yx0ieyZNF0l;QBPg7KKCeoA&ouMode=DESCENDANTS */
) AS virtual_table
WHERE "Region" IN ('Bunyoro')
LIMIT 10000
"""

# Extract WHERE clause
where_match = re.search(r'WHERE\s+(.+?)(?:ORDER BY|GROUP BY|LIMIT|$)', test_query, re.IGNORECASE | re.DOTALL)
if where_match:
    conditions = where_match.group(1)
    print("=" * 80)
    print("WHERE clause extracted:")
    print("=" * 80)
    print(conditions.strip())
    print()

    # Test NEW regex pattern (handles quoted and unquoted)
    print("=" * 80)
    print("Testing NEW regex pattern:")
    print("=" * 80)

    org_unit_columns = [
        'National', 'Region', 'District', 'Sub_County', 'Sub_County_Town_Council_Div',
        'Health_Facility', 'orgUnit', 'ou', 'OrganisationUnit'
    ]

    where_ou_filters = []

    # NEW pattern: (?:"(\w+)"|(\w+))\s+IN\s*\(([^)]+)\)
    for match in re.finditer(r'(?:"(\w+)"|(\w+))\s+IN\s*\(([^)]+)\)', conditions, re.IGNORECASE):
        field = match.group(1) or match.group(2)  # Get whichever group matched
        values_str = match.group(3)
        values = re.findall(r'[\'"]([^\'"]+)[\'"]', values_str)

        print(f"  Match found:")
        print(f"    - Field (group 1 - quoted): {match.group(1)}")
        print(f"    - Field (group 2 - unquoted): {match.group(2)}")
        print(f"    - Final field: {field}")
        print(f"    - Values string: {values_str}")
        print(f"    - Parsed values: {values}")
        print(f"    - Is org unit column? {field in org_unit_columns}")

        if field in org_unit_columns:
            where_ou_filters.extend(values)
            print(f"    ✅ Added to where_ou_filters")
        print()

    print("=" * 80)
    print("RESULT:")
    print("=" * 80)
    if where_ou_filters:
        print(f"✅ SUCCESS! Extracted filters: {where_ou_filters}")
    else:
        print(f"❌ FAILED! No filters extracted")
    print("=" * 80)
else:
    print("❌ No WHERE clause found!")
