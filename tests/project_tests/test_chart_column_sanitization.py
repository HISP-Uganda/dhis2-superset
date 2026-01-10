#!/usr/bin/env python3
"""Test script to verify column name sanitization in chart queries"""

import sys
sys.path.insert(0, '/Users/edwinarinda/Projects/Redux/superset')

from superset.db_engine_specs.dhis2_dialect import sanitize_dhis2_column_name


class MockDatabase:
    """Mock database object with DHIS2 URI"""
    def __init__(self):
        self.sqlalchemy_uri = 'dhis2://play.dhis2.org/40.2.2'


class MockDatasource:
    """Mock datasource to test _sanitize_column_reference"""
    def __init__(self, is_dhis2=True):
        self.database = MockDatabase() if is_dhis2 else None

    def _sanitize_column_reference(self, column_ref: str) -> str:
        """
        Sanitize a column reference for datasources.
        For DHIS2, apply sanitization to match the column metadata stored in the database.
        """
        if not column_ref:
            return column_ref
            
        # Check if this is a DHIS2 dataset
        is_dhis2 = False
        if hasattr(self, 'database') and self.database:
            uri = getattr(self.database, 'sqlalchemy_uri_decrypted', None) or getattr(self.database, 'sqlalchemy_uri', '')
            is_dhis2 = 'dhis2://' in str(uri)
        
        if is_dhis2:
            # Apply DHIS2 column name sanitization
            try:
                return sanitize_dhis2_column_name(column_ref)
            except (ImportError, ModuleNotFoundError):
                pass
        
        return column_ref


def test_chart_column_sanitization():
    """Test that chart column references are sanitized for DHIS2"""
    
    print("Testing Chart Column Sanitization for DHIS2")
    print("=" * 70)
    
    datasource = MockDatasource(is_dhis2=True)
    
    # Test cases from formData
    test_cases = [
        ('105-EP01c. Malaria Confirmed (B/s and RDT Positive)', '105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive'),
        ('105-EP01b. Malaria Total', '105_EP01b_Malaria_Total'),
        ('105-EP01a. Suspected fever', '105_EP01a_Suspected_fever'),
        ('105-EP01d. Malaria cases treated', '105_EP01d_Malaria_cases_treated'),
        ('Period', 'Period'),
        ('OrgUnit', 'OrgUnit'),
    ]
    
    all_passed = True
    
    for original, expected in test_cases:
        # Simulate formData column reference being sanitized
        result = datasource._sanitize_column_reference(original)
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
        print("✓ All chart column sanitization tests passed!")
        print("\nWhen a chart's formData contains unsanitized column names,")
        print("they will be automatically sanitized to match dataset columns.")
        return True
    else:
        print("✗ Some tests failed!")
        return False


def test_non_dhis2_datasource():
    """Test that non-DHIS2 datasources don't get sanitization"""
    
    print("\n\nTesting Non-DHIS2 Datasource (No Sanitization)")
    print("=" * 70)
    
    datasource = MockDatasource(is_dhis2=False)
    
    test_cases = [
        ('some-column-name', 'some-column-name'),  # Should NOT be sanitized
        ('Column.With.Dots', 'Column.With.Dots'),   # Should NOT be sanitized
    ]
    
    all_passed = True
    
    for original, expected in test_cases:
        result = datasource._sanitize_column_reference(original)
        passed = result == expected
        all_passed = all_passed and passed
        
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: '{original}'")
        print(f"      Expected (no sanitization): '{expected}'")
        print(f"      Got:                         '{result}'")
        if not passed:
            print(f"      ERROR: Mismatch!")
        print()
    
    print("=" * 70)
    
    if all_passed:
        print("✓ Non-DHIS2 datasources are not sanitized (correct!)")
        return True
    else:
        print("✗ Some tests failed!")
        return False


def main():
    print("\n" + "=" * 70)
    print("CHART COLUMN SANITIZATION TEST SUITE")
    print("=" * 70 + "\n")
    
    results = [
        test_chart_column_sanitization(),
        test_non_dhis2_datasource(),
    ]
    
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    if all(results):
        print("✓ All tests passed!")
        print("\nChart column references from formData will now be automatically")
        print("sanitized when querying DHIS2 datasets. This fixes the issue where")
        print("data elements with special characters (/, -, ., etc.) would return")
        print("incorrect columns or index 0 (Period).")
        return 0
    else:
        print("✗ Some tests failed!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
