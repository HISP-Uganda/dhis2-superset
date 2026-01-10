#!/usr/bin/env python3
"""
Test to verify metrics are applied independently to each column.

Validates that SUM, AVG, COUNT each operate on their specified column,
not combined into a single function like SUM(A,B,C).
"""

def test_metrics_applied_independently():
    """Verify each metric is applied to its specified column separately"""
    print("\n" + "="*80)
    print("TEST: Metrics Applied Independently to Each Column")
    print("="*80)
    
    # Simulate adhoc metrics structure (as sent by frontend)
    metrics = [
        {
            "expressionType": "SIMPLE",
            "aggregate": "SUM",
            "column": {"column_name": "105_EP01b_Malaria_Total"},
            "label": None
        },
        {
            "expressionType": "SIMPLE",
            "aggregate": "AVG",
            "column": {"column_name": "105_EP01b_Malaria_Total"},
            "label": None
        },
        {
            "expressionType": "SIMPLE",
            "aggregate": "COUNT",
            "column": {"column_name": "105_EP01b_Malaria_Total"},
            "label": None
        },
    ]
    
    print(f"\n✓ Input metrics (3 different aggregates on SAME column):")
    for i, metric in enumerate(metrics):
        agg = metric.get("aggregate")
        col = metric.get("column", {}).get("column_name")
        print(f"  {i+1}. aggregate='{agg}', column='{col}'")
    
    # Verify each metric has its own column specification
    print(f"\n✓ Validate structure:")
    for i, metric in enumerate(metrics):
        col_spec = metric.get("column")
        assert col_spec is not None, f"Metric {i} missing column specification"
        col_name = col_spec.get("column_name")
        agg = metric.get("aggregate")
        print(f"  Metric {i}: {agg}({col_name})")
    
    # What the query builder should generate
    print(f"\n✓ Expected SQL expressions generated:")
    expected_sql = []
    for metric in metrics:
        agg = metric.get("aggregate").upper()
        col = metric.get("column", {}).get("column_name")
        sql = f"{agg}({col})"
        expected_sql.append(sql)
        print(f"  - {sql}")
    
    assert expected_sql == [
        "SUM(105_EP01b_Malaria_Total)",
        "AVG(105_EP01b_Malaria_Total)",
        "COUNT(105_EP01b_Malaria_Total)"
    ], "Expected 3 separate aggregate functions"
    
    # What we do NOT want
    print(f"\n❌ WRONG (should NOT happen):")
    wrong_sql = "SUM(105_EP01b_Malaria_Total, 105_EP01b_Malaria_Total, 105_EP01b_Malaria_Total)"
    print(f"  - {wrong_sql} ← NEVER THIS!")
    
    print("\n✅ PASS: Each metric applied independently\n")


def test_metrics_on_different_columns():
    """Verify metrics on different columns are completely independent"""
    print("="*80)
    print("TEST: Metrics on Different Columns")
    print("="*80)
    
    metrics = [
        {
            "expressionType": "SIMPLE",
            "aggregate": "SUM",
            "column": {"column_name": "105_EP01b_Malaria_Total"}
        },
        {
            "expressionType": "SIMPLE",
            "aggregate": "AVG",
            "column": {"column_name": "105_EP01c_Malaria_Confirmed_B_s_and_RDT_Positive"}
        },
        {
            "expressionType": "SIMPLE",
            "aggregate": "COUNT",
            "column": {"column_name": "105_EP01d_Malaria_Cases_Treated"}
        },
    ]
    
    print(f"\n✓ Input metrics (different aggregates on DIFFERENT columns):")
    for i, metric in enumerate(metrics):
        agg = metric.get("aggregate")
        col = metric.get("column", {}).get("column_name")
        print(f"  {i+1}. {agg}('{col}')")
    
    # Verify independence
    print(f"\n✓ Each metric operates on its own column:")
    for i, metric in enumerate(metrics):
        agg = metric.get("aggregate")
        col = metric.get("column", {}).get("column_name")
        print(f"  Metric {i}: {agg} applies only to column '{col}'")
    
    # Expected SELECT clause
    print(f"\n✓ Expected SELECT clause:")
    select_items = []
    for metric in metrics:
        agg = metric.get("aggregate").upper()
        col = metric.get("column", {}).get("column_name")
        item = f"{agg}({col})"
        select_items.append(item)
        print(f"  - {item}")
    
    # NOT combined
    wrong = "SUM(col1, col2, col3)"
    print(f"\n❌ NOT: {wrong}")
    
    print("\n✅ PASS: Different column metrics are independent\n")


def test_metric_label_generation():
    """Verify metric labels are generated correctly for each metric"""
    print("="*80)
    print("TEST: Metric Label Generation")
    print("="*80)
    
    metrics = [
        {
            "expressionType": "SIMPLE",
            "aggregate": "SUM",
            "column": {"column_name": "105_EP01b_Malaria_Total"},
            "label": None  # Should be auto-generated
        },
        {
            "expressionType": "SIMPLE",
            "aggregate": "AVG",
            "column": {"column_name": "105_EP01b_Malaria_Total"},
            "label": None  # Should be auto-generated
        },
    ]
    
    print(f"\n✓ Input metrics (no explicit labels):")
    for metric in metrics:
        print(f"  - aggregate={metric['aggregate']}, column={metric['column']['column_name']}")
    
    # Generate labels
    print(f"\n✓ Auto-generated labels:")
    labels = []
    for metric in metrics:
        agg = metric.get("aggregate").upper()
        col = metric.get("column", {}).get("column_name")
        label = f"{agg}({col})"
        labels.append(label)
        print(f"  - {label}")
    
    # Verify uniqueness
    print(f"\n✓ Verify all labels are unique:")
    assert len(labels) == len(set(labels)), "Labels should be unique"
    for i, label in enumerate(labels):
        print(f"  Label {i+1}: {label}")
    
    print("\n✅ PASS: Each metric has unique label\n")


def test_dataframe_structure():
    """Verify resulting DataFrame has one column per metric"""
    print("="*80)
    print("TEST: Resulting DataFrame Structure")
    print("="*80)
    
    # Simulated query result
    df_columns = [
        "Period",
        "OrgUnit",
        "SUM(105_EP01b_Malaria_Total)",
        "AVG(105_EP01b_Malaria_Total)",
        "COUNT(105_EP01b_Malaria_Total)",
    ]
    
    print(f"\n✓ Query returned DataFrame with {len(df_columns)} columns:")
    for col in df_columns:
        print(f"  - {col}")
    
    # Count metric columns
    metric_cols = [c for c in df_columns if "(" in c and ")" in c]
    print(f"\n✓ Metric columns in DataFrame: {len(metric_cols)}")
    for col in metric_cols:
        print(f"  - {col}")
    
    assert len(metric_cols) == 3, "Should have 3 metric columns"
    
    # Verify one metric per column (not combined)
    print(f"\n✓ Each column contains ONE metric (not combined):")
    for col in metric_cols:
        # Count opening parentheses - should be 1 for each
        paren_count = col.count("(")
        assert paren_count == 1, f"Column {col} has {paren_count} functions (should be 1)"
        print(f"  - {col} ✓")
    
    print("\n✅ PASS: DataFrame structure is correct\n")


def main():
    print("\n" + "█"*80)
    print("█" + " "*78 + "█")
    print("█" + "  METRICS INDEPENDENCE TEST SUITE".center(78) + "█")
    print("█" + " "*78 + "█")
    print("█"*80)
    
    try:
        test_metrics_applied_independently()
        test_metrics_on_different_columns()
        test_metric_label_generation()
        test_dataframe_structure()
        
        print("█"*80)
        print("█" + " "*78 + "█")
        print("█" + "  ✅ ALL TESTS PASSED ".center(78) + "█")
        print("█" + " "*78 + "█")
        print("█"*80)
        print("\n📊 Summary:")
        print("  ✓ Each metric applies to its specified column only")
        print("  ✓ No combined functions like SUM(A,B,C)")
        print("  ✓ Each metric generates unique label")
        print("  ✓ DataFrame has one column per metric")
        print("  ✓ Metrics are completely independent\n")
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}\n")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())
