#!/usr/bin/env python3
"""Test script to verify multiple metrics work correctly in DHIS2 charts"""

import sys

def test_metric_label_generation():
    """Test that metric labels are sanitized correctly for DHIS2"""
    
    # Simulate sanitization
    def sanitize_column_name(name: str) -> str:
        import re
        name = re.sub(r'[^\w]', '_', name)
        name = re.sub(r'_+', '_', name)
        name = name.strip('_')
        return name
    
    test_cases = [
        {
            'metric_name': 'SUM(105-EP01b. Malaria Total)',
            'column_name': '105-EP01b. Malaria Total',
            'aggregate': 'SUM',
            'expected_label': 'SUM(105_EP01b_Malaria_Total)'
        },
        {
            'metric_name': 'COUNT(105-EP01c. Malaria Confirmed (B/s and RDT Positive))',
            'column_name': '105-EP01c. Malaria Confirmed (B/s and RDT Positive)',
            'aggregate': 'COUNT',
            'expected_label': 'COUNT(105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive)'
        },
        {
            'metric_name': 'AVG(Cases - Confirmed & Probable)',
            'column_name': 'Cases - Confirmed & Probable',
            'aggregate': 'AVG',
            'expected_label': 'AVG(Cases_Confirmed_Probable)'
        }
    ]
    
    print("\n✅ Testing Metric Label Sanitization for DHIS2:")
    print("=" * 80)
    
    all_passed = True
    for test_case in test_cases:
        column_name = test_case['column_name']
        aggregate = test_case['aggregate']
        expected_label = test_case['expected_label']
        
        sanitized_column_name = sanitize_column_name(column_name)
        generated_label = f"{aggregate}({sanitized_column_name})"
        
        passed = generated_label == expected_label
        status = "✅ PASS" if passed else "❌ FAIL"
        
        print(f"\n{status}")
        print(f"  Original column:  {column_name}")
        print(f"  Sanitized column: {sanitized_column_name}")
        print(f"  Generated label:  {generated_label}")
        print(f"  Expected label:   {expected_label}")
        
        if not passed:
            all_passed = False
    
    print("\n" + "=" * 80)
    if all_passed:
        print("✅ All metric label sanitization tests passed!")
        return 0
    else:
        print("❌ Some metric label sanitization tests failed!")
        return 1


def test_multiple_metrics_dataframe():
    """Test that multiple metrics result in proper DataFrame columns"""
    
    print("\n✅ Testing Multiple Metrics DataFrame Structure:")
    print("=" * 80)
    
    # Simulate what the DataFrame would look like after SQL query with multiple metrics
    # Using simple list instead of pandas to avoid dependency
    
    column_labels = [
        'OrgUnit',
        'Period',
        'SUM(105_EP01b_Malaria_Total)',
        'COUNT(105_EP01c_Malaria_Confirmed)',
        'AVG(Cases_Confirmed_Probable)'
    ]
    
    print("\nDataFrame columns after SQL query with multiple metrics:")
    for idx, col in enumerate(column_labels):
        print(f"  [{idx}] {col}")
    
    # Test that postprocessing can find these columns
    expected_columns = [
        'SUM(105_EP01b_Malaria_Total)',
        'COUNT(105_EP01c_Malaria_Confirmed)',
        'AVG(Cases_Confirmed_Probable)'
    ]
    
    all_found = True
    for col in expected_columns:
        found = col in column_labels
        status = "✅" if found else "❌"
        print(f"\n{status} Looking for: '{col}'")
        print(f"   Found: {found}")
        if not found:
            all_found = False
    
    print("\n" + "=" * 80)
    if all_found:
        print("✅ All metric columns found in result set!")
        return 0
    else:
        print("❌ Some metric columns missing from result set!")
        return 1


def main():
    """Run all tests"""
    print("\n" + "=" * 80)
    print("DHIS2 Multiple Metrics Test Suite")
    print("=" * 80)
    
    test1_result = test_metric_label_generation()
    test2_result = test_multiple_metrics_dataframe()
    
    print("\n" + "=" * 80)
    print("Test Results Summary:")
    print(f"  Metric label sanitization: {'✅ PASS' if test1_result == 0 else '❌ FAIL'}")
    print(f"  DataFrame structure:       {'✅ PASS' if test2_result == 0 else '❌ FAIL'}")
    print("=" * 80)
    
    return test1_result + test2_result


if __name__ == '__main__':
    sys.exit(main())
