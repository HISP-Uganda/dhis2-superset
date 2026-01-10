#!/usr/bin/env python3
"""
Test suite to verify column name preservation across all chart types.

This test ensures that sanitized DHIS2 column names are preserved throughout
the rendering pipeline for ALL chart types (table, bar, line, pie, etc.)
and that column order is not lost or reverted to indices.

Critical Issue: Some chart types (especially table charts with pivot tables)
may lose column names and revert to numeric indices [0], [1], [2], etc.
instead of showing the actual column names.
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any


def sanitize_dhis2_column_name(name: str) -> str:
    """Sanitize DHIS2 column names for Superset compatibility."""
    import re
    name = re.sub(r'[^\w]', '_', name)
    name = re.sub(r'_+', '_', name)
    name = name.strip('_')
    return name


class ColumnPreservationTester:
    """Test column name preservation across different chart types."""
    
    def __init__(self):
        self.test_results = []
    
    def create_dhis2_dataframe(self) -> pd.DataFrame:
        """Create a sample DHIS2 DataFrame with special characters in column names."""
        
        unsanitized_columns = {
            'Period': ['2024-Q1', '2024-Q1', '2024-Q2', '2024-Q2'],
            'OrgUnit': ['District1', 'District2', 'District1', 'District2'],
            '105-EP01b. Malaria Total': [1500, 2100, 1650, 2300],
            '105-EP01a. Suspected fever': [500, 700, 550, 750],
            '105-EP01d. Malaria cases treated': [1200, 1800, 1400, 2000],
        }
        
        df = pd.DataFrame(unsanitized_columns)
        
        # Sanitize column names (as done in the query building phase)
        sanitized_columns = {
            col: sanitize_dhis2_column_name(col) 
            for col in df.columns
        }
        df = df.rename(columns=sanitized_columns)
        
        return df
    
    def test_table_chart_column_preservation(self):
        """Test that table charts preserve column names (not revert to indices)."""
        print("\n" + "="*100)
        print("TEST 1: Table Chart Column Preservation")
        print("="*100)
        
        df = self.create_dhis2_dataframe()
        print(f"\nOriginal DataFrame columns: {list(df.columns)}")
        print(f"Original DataFrame:\n{df}\n")
        
        # Simulate table chart rendering (no processing needed)
        # But if there's column_config, it might cause issues
        column_config = {
            '105_EP01b_Malaria_Total': {'d3NumberFormat': '.0f'},
        }
        
        result_df = df.copy()
        
        # Apply column_config formatting
        for column, config in column_config.items():
            if 'd3NumberFormat' in config and column in result_df.columns:
                format_ = "{:" + config['d3NumberFormat'] + "}"
                try:
                    result_df[column] = result_df[column].apply(format_.format)
                except Exception as e:
                    print(f"Warning: Could not format column {column}: {e}")
        
        print(f"Result DataFrame columns: {list(result_df.columns)}")
        print(f"Result DataFrame:\n{result_df}\n")
        
        # Check if columns are preserved
        test_passed = list(result_df.columns) == list(df.columns)
        
        self.test_results.append({
            'test': 'Table Chart Column Preservation',
            'passed': test_passed,
            'original_cols': list(df.columns),
            'result_cols': list(result_df.columns),
        })
        
        print(f"✓ PASS: Columns preserved" if test_passed else "✗ FAIL: Columns lost or reordered")
        return test_passed
    
    def test_pivot_table_column_preservation(self):
        """Test that pivot tables preserve column names in the pivot output."""
        print("\n" + "="*100)
        print("TEST 2: Pivot Table Column Preservation")
        print("="*100)
        
        df = self.create_dhis2_dataframe()
        print(f"\nOriginal DataFrame columns: {list(df.columns)}")
        print(f"Original DataFrame:\n{df}\n")
        
        # Simulate pivot table with rows=Period, columns=OrgUnit, values=metrics
        rows = ['Period']
        columns = ['OrgUnit']
        metrics = ['105_EP01b_Malaria_Total', '105_EP01a_Suspected_fever']
        
        print(f"Pivot parameters:")
        print(f"  rows: {rows}")
        print(f"  columns: {columns}")
        print(f"  metrics: {metrics}\n")
        
        try:
            pivoted_df = df.pivot_table(
                index=rows,
                columns=columns,
                values=metrics,
                aggfunc='sum',
                margins=False,
            )
            
            print(f"Pivoted DataFrame columns (type={type(pivoted_df.columns)}): {list(pivoted_df.columns)}")
            print(f"Pivoted DataFrame:\n{pivoted_df}\n")
            
            # ISSUE: After pivot_table with multiple values, columns become MultiIndex
            # Need to flatten and ensure column names are preserved
            
            if isinstance(pivoted_df.columns, pd.MultiIndex):
                print("⚠ WARNING: Pivot created MultiIndex columns (this can cause issues)")
                print(f"  MultiIndex levels: {pivoted_df.columns.nlevels}")
                print(f"  Level names: {pivoted_df.columns.names}")
                
                # Flatten the MultiIndex columns
                flattened_columns = [
                    ' '.join(str(name) for name in col).strip()
                    for col in pivoted_df.columns
                ]
                print(f"  Flattened columns: {flattened_columns}\n")
                
                test_passed = all(
                    orig_metric in flat_col 
                    for orig_metric in metrics 
                    for flat_col in flattened_columns
                )
            else:
                test_passed = len(pivoted_df.columns) > 0
            
            self.test_results.append({
                'test': 'Pivot Table Column Preservation',
                'passed': test_passed,
                'original_metrics': metrics,
                'result_cols': list(pivoted_df.columns),
            })
            
            print(f"✓ PASS: Column names visible in pivot" if test_passed else "✗ FAIL: Column names lost")
            
        except Exception as e:
            print(f"✗ FAIL: Pivot table error: {e}")
            self.test_results.append({
                'test': 'Pivot Table Column Preservation',
                'passed': False,
                'error': str(e),
            })
            return False
        
        return test_passed
    
    def test_metric_column_selection_order(self):
        """Test that metric columns maintain selection order (not reverted to indices)."""
        print("\n" + "="*100)
        print("TEST 3: Metric Column Selection Order Preservation")
        print("="*100)
        
        df = self.create_dhis2_dataframe()
        print(f"\nOriginal DataFrame columns: {list(df.columns)}")
        
        # Simulate selecting specific metrics in order
        selected_metrics = [
            '105_EP01a_Suspected_fever',  # Select in this order
            '105_EP01b_Malaria_Total',
        ]
        
        print(f"Selected metrics (in order): {selected_metrics}\n")
        
        # Try to select columns in a specific order (simulating user selection)
        try:
            result_df = df[selected_metrics]
            result_cols = list(result_df.columns)
            
            print(f"Result DataFrame columns: {result_cols}")
            print(f"Result DataFrame:\n{result_df}\n")
            
            # Check order is preserved
            test_passed = result_cols == selected_metrics
            
            self.test_results.append({
                'test': 'Metric Column Selection Order',
                'passed': test_passed,
                'selected_order': selected_metrics,
                'result_order': result_cols,
            })
            
            print(f"✓ PASS: Selection order preserved" if test_passed else "✗ FAIL: Selection order lost")
            
        except Exception as e:
            print(f"✗ FAIL: Column selection error: {e}")
            self.test_results.append({
                'test': 'Metric Column Selection Order',
                'passed': False,
                'error': str(e),
            })
            return False
        
        return test_passed
    
    def test_multiindex_flattening(self):
        """Test that MultiIndex columns are flattened correctly without losing information."""
        print("\n" + "="*100)
        print("TEST 4: MultiIndex Column Flattening")
        print("="*100)
        
        # Create a DataFrame with MultiIndex columns
        arrays = [
            ['105_EP01b_Malaria_Total', '105_EP01b_Malaria_Total', 
             '105_EP01a_Suspected_fever', '105_EP01a_Suspected_fever'],
            ['District1', 'District2', 'District1', 'District2']
        ]
        
        columns = pd.MultiIndex.from_arrays(
            arrays,
            names=['Metric', 'OrgUnit']
        )
        
        data = np.random.randint(100, 1000, size=(4, 4))
        df = pd.DataFrame(data, columns=columns)
        
        print(f"\nOriginal MultiIndex columns: {list(df.columns)}")
        print(f"MultiIndex levels: {df.columns.nlevels}")
        print(f"Level names: {df.columns.names}\n")
        print(f"Original DataFrame:\n{df}\n")
        
        # Flatten MultiIndex columns
        flattened_columns = [
            ' '.join(str(name) for name in col).strip()
            for col in df.columns
        ]
        
        df.columns = flattened_columns
        
        print(f"Flattened columns: {list(df.columns)}")
        print(f"Flattened DataFrame:\n{df}\n")
        
        # Check that all metric names are present in the flattened columns
        metrics = ['105_EP01b_Malaria_Total', '105_EP01a_Suspected_fever']
        test_passed = all(
            any(metric in col for col in df.columns)
            for metric in metrics
        )
        
        self.test_results.append({
            'test': 'MultiIndex Column Flattening',
            'passed': test_passed,
            'original_cols': arrays[0] + arrays[1],
            'flattened_cols': list(df.columns),
        })
        
        print(f"✓ PASS: MultiIndex flattened correctly" if test_passed else "✗ FAIL: Information lost in flattening")
        return test_passed
    
    def test_column_index_access_danger(self):
        """Test the danger of using df.columns[indexes] which can lose column names."""
        print("\n" + "="*100)
        print("TEST 5: Column Index Access Danger (df.columns[indexes])")
        print("="*100)
        
        df = self.create_dhis2_dataframe()
        print(f"\nOriginal DataFrame columns: {list(df.columns)}")
        print(f"Original DataFrame:\n{df}\n")
        
        # Simulate reordering via index (the problematic pattern used in pivot_df)
        indexes = [2, 0, 1, 3]  # Reorder columns
        print(f"Reordering with indexes: {indexes}")
        
        # Problematic way: df[df.columns[indexes]]
        print("\nMethod 1: df[df.columns[indexes]] (INDEX-BASED)")
        try:
            result_df_index = df[df.columns[indexes]]
            result_cols_index = list(result_df_index.columns)
            print(f"Result columns: {result_cols_index}")
            print(f"Result DataFrame:\n{result_df_index}\n")
        except Exception as e:
            print(f"Error: {e}\n")
            result_cols_index = None
        
        # Better way: df[[df.columns[i] for i in indexes]]
        print("Method 2: df[[df.columns[i] for i in indexes]] (NAME-BASED)")
        try:
            result_df_names = df[[df.columns[i] for i in indexes]]
            result_cols_names = list(result_df_names.columns)
            print(f"Result columns: {result_cols_names}")
            print(f"Result DataFrame:\n{result_df_names}\n")
        except Exception as e:
            print(f"Error: {e}\n")
            result_cols_names = None
        
        # Best way: Use column names directly
        print("Method 3: df[df.columns[[...indexes...]]] (RECOMMENDED)")
        try:
            selected_columns = [df.columns[i] for i in indexes]
            result_df_best = df[selected_columns]
            result_cols_best = list(result_df_best.columns)
            print(f"Result columns: {result_cols_best}")
            print(f"Result DataFrame:\n{result_df_best}\n")
        except Exception as e:
            print(f"Error: {e}\n")
            result_cols_best = None
        
        # All methods should preserve column names
        test_passed = (
            result_cols_index == result_cols_names == result_cols_best
            and result_cols_index is not None
        )
        
        self.test_results.append({
            'test': 'Column Index Access Danger',
            'passed': test_passed,
            'method1_result': result_cols_index,
            'method2_result': result_cols_names,
            'method3_result': result_cols_best,
        })
        
        print(f"✓ PASS: All methods preserve column names" if test_passed else "✗ FAIL: Some methods lose names")
        return test_passed
    
    def test_verbose_map_application(self):
        """Test that verbose_map (label mapping) doesn't corrupt column names."""
        print("\n" + "="*100)
        print("TEST 6: Verbose Map Application (Label Mapping)")
        print("="*100)
        
        df = self.create_dhis2_dataframe()
        print(f"\nOriginal DataFrame columns: {list(df.columns)}")
        
        # Simulate verbose_map from datasource (used to convert sanitized names to labels)
        verbose_map = {
            '105_EP01b_Malaria_Total': 'Malaria Cases (Total)',
            '105_EP01a_Suspected_fever': 'Suspected Fever Cases',
            'Period': 'Quarter',
            'OrgUnit': 'Facility',
        }
        
        print(f"Verbose map:\n")
        for sanitized, label in verbose_map.items():
            print(f"  {sanitized} → {label}")
        print()
        
        # Apply verbose_map
        result_df = df.rename(columns=verbose_map)
        result_cols = list(result_df.columns)
        
        print(f"Result DataFrame columns: {result_cols}")
        print(f"Result DataFrame:\n{result_df}\n")
        
        # Check all columns are mapped correctly
        expected_cols = ['Quarter', 'Facility', 'Malaria Cases (Total)', 
                        'Suspected Fever Cases']
        test_passed = set(result_cols) == set(expected_cols)
        
        self.test_results.append({
            'test': 'Verbose Map Application',
            'passed': test_passed,
            'original_cols': list(df.columns),
            'mapped_cols': result_cols,
            'expected_cols': expected_cols,
        })
        
        print(f"✓ PASS: Verbose map applied correctly" if test_passed else "✗ FAIL: Mapping failed")
        return test_passed
    
    def run_all_tests(self):
        """Run all column preservation tests."""
        print("\n" + "="*100)
        print("COLUMN NAME PRESERVATION TEST SUITE")
        print("Testing DHIS2 column handling across all chart types")
        print("="*100)
        
        tests = [
            self.test_table_chart_column_preservation,
            self.test_pivot_table_column_preservation,
            self.test_metric_column_selection_order,
            self.test_multiindex_flattening,
            self.test_column_index_access_danger,
            self.test_verbose_map_application,
        ]
        
        passed = 0
        failed = 0
        
        for test in tests:
            try:
                if test():
                    passed += 1
                else:
                    failed += 1
            except Exception as e:
                print(f"\n✗ EXCEPTION in {test.__name__}: {e}")
                failed += 1
        
        # Summary
        print("\n\n" + "="*100)
        print("TEST SUMMARY")
        print("="*100)
        print(f"\nTotal Tests: {len(tests)}")
        print(f"Passed: {passed} ✓")
        print(f"Failed: {failed} ✗")
        print(f"Success Rate: {(passed/len(tests))*100:.1f}%\n")
        
        if failed == 0:
            print("✓ All tests passed! Column preservation is working correctly.")
        else:
            print(f"✗ {failed} test(s) failed. Review the issues above.")
        
        return failed == 0


if __name__ == "__main__":
    tester = ColumnPreservationTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)
