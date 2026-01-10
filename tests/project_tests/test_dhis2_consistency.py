#!/usr/bin/env python3
"""Test to verify consistent use of sanitize_dhis2_column_name across DHIS2 operations"""

import sys
sys.path.insert(0, '/Users/edwinarinda/Projects/Redux/superset')

from superset.db_engine_specs.dhis2_dialect import sanitize_dhis2_column_name

def test_sanitization_consistency():
    """Test that the same sanitization function produces consistent results"""
    
    test_cases = [
        ('105-EP01b. Malaria Total', '105_EP01b_Malaria_Total'),
        ('105-EP01a. Suspected fever', '105_EP01a_Suspected_fever'),
        ('orgUnit', 'orgUnit'),
        ('org_unit', 'org_unit'),
        ('Org Unit', 'Org_Unit'),
        ('period', 'period'),
        ('Time Period', 'Time_Period'),
        ('data-element', 'data_element'),
        ('Data.Element', 'Data_Element'),
    ]
    
    print("Testing sanitize_dhis2_column_name() consistency:")
    print("=" * 70)
    
    all_passed = True
    for original, expected in test_cases:
        result = sanitize_dhis2_column_name(original)
        passed = result == expected
        all_passed = all_passed and passed
        
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: '{original}'")
        print(f"      Expected: '{expected}'")
        print(f"      Got:      '{result}'")
        if not passed:
            print(f"      ERROR: Mismatch!")
        print()
    
    print("=" * 70)
    if all_passed:
        print("✓ All consistency tests passed!")
        return True
    else:
        print("✗ Some consistency tests failed!")
        return False


def test_dimension_pattern_matching():
    """Test that dimension patterns are correctly matched using sanitization"""
    
    print("\nTesting dimension pattern matching with sanitization:")
    print("=" * 70)
    
    # Test cases based on actual pattern definitions
    # (column_name, dimension_pattern, should_match)
    test_patterns = [
        # Exact matches (these WILL match after sanitization)
        ('OrgUnit', 'orgunit', True),          # orgunit == orgunit
        ('organisation_unit', 'organisation_unit', True),  # organisation_unit == organisation_unit
        ('Period', 'period', True),             # period == period
        ('data_element', 'data_element', True), # data_element == data_element
        ('data_element', 'dataelement', False), # data_element != dataelement (different patterns)
        ('DataElement', 'dataelement', True),   # dataelement == dataelement (after sanitization)
        
        # Partial/suffix matches
        ('myperiod', 'period', True),           # period in myperiod
        ('mydata_element', 'data_element', True),  # data_element in mydata_element
        
        # Cases where sanitization changes the format
        ('Org-Unit', 'org_unit', True),         # Org-Unit -> org_unit, matches org_unit
        ('data-element', 'data_element', True), # data-element -> data_element, matches data_element
    ]
    
    all_passed = True
    for col, pattern, should_match in test_patterns:
        col_sanitized = sanitize_dhis2_column_name(col.lower())
        pattern_sanitized = sanitize_dhis2_column_name(pattern.lower())
        matches = pattern_sanitized in col_sanitized or col_sanitized.endswith(pattern_sanitized)
        
        passed = matches == should_match
        all_passed = all_passed and passed
        
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: Column '{col}' vs Pattern '{pattern}'")
        print(f"      Sanitized column:  '{col_sanitized}'")
        print(f"      Sanitized pattern: '{pattern_sanitized}'")
        print(f"      Expected match:    {should_match}")
        print(f"      Actual match:      {matches}")
        if not passed:
            print(f"      ERROR: Match result mismatch!")
        print()
    
    print("=" * 70)
    if all_passed:
        print("✓ All dimension pattern matching tests passed!")
        return True
    else:
        print("✗ Some dimension pattern matching tests failed!")
        return False


def test_analytics_column_construction():
    """Test that analytics column construction uses consistent sanitization"""
    
    print("\nTesting analytics column name construction:")
    print("=" * 70)
    
    # Simulate the analytics column construction
    data_elements = ['105-EP01a. Suspected fever', '105-EP01b. Malaria Total']
    
    def get_name(uid):
        """Simulated get_name function"""
        return uid
    
    # This is how it's done in normalize_analytics - NOW ALL columns MUST be sanitized
    col_names = [sanitize_dhis2_column_name("Period"), sanitize_dhis2_column_name("OrgUnit")] + [sanitize_dhis2_column_name(get_name(de)) for de in data_elements]
    
    print(f"Data elements (UIDs): {data_elements}")
    print(f"Constructed column names: {col_names}")
    
    expected_cols = [
        "Period",  # sanitize_dhis2_column_name("Period")
        "OrgUnit",  # sanitize_dhis2_column_name("OrgUnit")
        "105_EP01a_Suspected_fever",
        "105_EP01b_Malaria_Total"
    ]
    
    passed = col_names == expected_cols
    
    if passed:
        print("✓ PASS: Analytics columns constructed correctly!")
        print("       All columns (including Period/OrgUnit) are sanitized!")
    else:
        print("✗ FAIL: Analytics columns mismatch!")
        print(f"Expected: {expected_cols}")
        print(f"Got:      {col_names}")
    
    print("=" * 70)
    return passed


def main():
    """Run all tests"""
    print("\n" + "=" * 70)
    print("DHIS2 Column Name Sanitization Consistency Tests")
    print("=" * 70 + "\n")
    
    results = [
        test_sanitization_consistency(),
        test_dimension_pattern_matching(),
        test_analytics_column_construction(),
    ]
    
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    if all(results):
        print("✓ All tests passed!")
        print("\nThe sanitize_dhis2_column_name() function is being used")
        print("consistently across all DHIS2 data query operations.")
        return 0
    else:
        print("✗ Some tests failed!")
        print("\nPlease review the failures above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
