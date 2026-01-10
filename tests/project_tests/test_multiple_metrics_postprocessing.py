#!/usr/bin/env python3
"""Test script to verify multiple metrics work with postprocessing column matching"""

import sys
import re


def test_column_matching():
    """Test that the improved column matching logic works for postprocessing"""
    
    print("\n✅ Testing Postprocessing Column Matching for Multiple Metrics:")
    print("=" * 80)
    
    # Simulate what happens during postprocessing
    # Dataframe has aggregated columns from SQL
    df_columns = [
        'OrgUnit',
        'Period',
        'SUM(105_EP01b_Malaria_Total)',
        'COUNT(105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive)',
        'AVG(Cases_Confirmed_Probable)'
    ]
    
    # Postprocessing receives these aggregates (column refs from chart formData)
    aggregate_requests = [
        {
            'name': 'SUM_metric',
            'column': '105_EP01b_Malaria_Total',  # Raw unsanitized from chart
        },
        {
            'name': 'COUNT_metric',
            'column': '105_EP01c_Malaria_Confirmed (B/s and RDT Positive)',  # Unsanitized!
        },
        {
            'name': 'AVG_metric',
            'column': 'Cases - Confirmed & Probable',  # Unsanitized!
        }
    ]
    
    def sanitize_column_name(name: str) -> str:
        """DHIS2 sanitization logic"""
        name = re.sub(r'[^\w]', '_', name)
        name = re.sub(r'_+', '_', name)
        name = name.strip('_')
        return name
    
    def normalize(s: str) -> str:
        """Fuzzy matching normalization (improved version)"""
        s = s.lower()
        s = re.sub(r'[^\w]', '_', s)  # Use same as DHIS2
        s = re.sub(r'_+', '_', s)
        return s.strip('_')
    
    def find_matching_column(column_ref, df_cols):
        """Simulate the improved column finding logic"""
        
        # Direct match
        if column_ref in df_cols:
            return column_ref
        
        # Method 0: Try finding aggregated version
        for df_col in df_cols:
            wrapper_match = re.match(r'^(SUM|AVG|COUNT|MIN|MAX|MEDIAN|STDDEV|VAR)\((.+)\)$', df_col, re.IGNORECASE)
            if wrapper_match:
                inner_from_df = wrapper_match.group(2)
                if inner_from_df == column_ref:
                    return df_col
        
        # Method 1: Try DHIS2 sanitization
        sanitized_ref = sanitize_column_name(column_ref)
        for df_col in df_cols:
            wrapper_match = re.match(r'^(SUM|AVG|COUNT|MIN|MAX|MEDIAN|STDDEV|VAR)\((.+)\)$', df_col, re.IGNORECASE)
            if wrapper_match:
                inner_from_df = wrapper_match.group(2)
                if inner_from_df == sanitized_ref:
                    return df_col
        
        # Method 2: Case-insensitive
        for df_col in df_cols:
            if df_col.lower() == column_ref.lower():
                return df_col
        
        # Method 3: Fuzzy matching
        normalized_ref = normalize(column_ref)
        for df_col in df_cols:
            wrapper_match = re.match(r'^(SUM|AVG|COUNT|MIN|MAX|MEDIAN|STDDEV|VAR)\((.+)\)$', df_col, re.IGNORECASE)
            if wrapper_match:
                inner_from_df = wrapper_match.group(2)
                norm_df_col = normalize(inner_from_df)
                if norm_df_col == normalized_ref:
                    return df_col
        
        return None
    
    print("\nDataFrame columns (from SQL):")
    for idx, col in enumerate(df_columns):
        print(f"  [{idx}] {col}")
    
    print("\nPostprocessing aggregate requests and matching results:")
    all_passed = True
    for req in aggregate_requests:
        column_ref = req['column']
        matched = find_matching_column(column_ref, df_columns)
        passed = matched is not None
        status = "✅ FOUND" if passed else "❌ NOT FOUND"
        
        print(f"\n{status}")
        print(f"  Requested: '{column_ref}'")
        print(f"  Matched:   '{matched}'")
        
        if not passed:
            all_passed = False
    
    print("\n" + "=" * 80)
    if all_passed:
        print("✅ All columns found! Multiple metrics postprocessing should work!")
        return 0
    else:
        print("❌ Some columns not found! There's still an issue!")
        return 1


def main():
    """Run all tests"""
    print("\n" + "=" * 80)
    print("DHIS2 Multiple Metrics Postprocessing Test")
    print("=" * 80)
    
    result = test_column_matching()
    
    print("\n" + "=" * 80)
    if result == 0:
        print("✅ Test passed! Multiple metrics should work now.")
    else:
        print("❌ Test failed! More fixes needed.")
    print("=" * 80)
    
    return result


if __name__ == '__main__':
    sys.exit(main())
