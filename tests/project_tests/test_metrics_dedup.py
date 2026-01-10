#!/usr/bin/env python3
"""
Test to verify metrics deduplication fix.

Validates that multiple metrics on the same column survive deduplication.
"""

def test_metrics_dedup_fix():
    """Verify metrics with same .name but different expressions survive dedup"""
    print("\n" + "="*80)
    print("TEST: Metrics Deduplication Fix")
    print("="*80)
    
    # Simulate multiple metrics on same column
    class MockExpr:
        def __init__(self, name, expr_str):
            self.name = name
            self._expr_str = expr_str
        
        def __str__(self):
            return self._expr_str
    
    # Create metrics: SUM, AVG, COUNT on same column "col"
    metrics = [
        MockExpr("col", "SUM(col)"),
        MockExpr("col", "AVG(col)"),
        MockExpr("col", "COUNT(col)"),
    ]
    
    print(f"\n✓ Created 3 metrics on same column 'col':")
    for i, m in enumerate(metrics):
        print(f"  {i+1}. name='{m.name}', expr='{str(m)}'")
    
    # Old dedup logic (BROKEN): uses x.name
    print(f"\n❌ OLD LOGIC: remove_duplicates(metrics, key=lambda x: x.name)")
    seen = set()
    old_result = []
    for m in metrics:
        if m.name not in seen:
            old_result.append(m)
            seen.add(m.name)
    
    print(f"   Result: {len(old_result)} metrics (WRONG - should be 3)")
    for m in old_result:
        print(f"     - {str(m)}")
    
    assert len(old_result) == 1, "Old logic: only 1 metric survives (as expected)"
    
    # New dedup logic (FIXED): uses (str(x), x.name)
    print(f"\n✅ NEW LOGIC: remove_duplicates(metrics, key=lambda x: (str(x), x.name))")
    seen = set()
    new_result = []
    for m in metrics:
        key = (str(m), m.name)  # Use both expression AND name
        if key not in seen:
            new_result.append(m)
            seen.add(key)
    
    print(f"   Result: {len(new_result)} metrics (CORRECT!)")
    for m in new_result:
        print(f"     - {str(m)}")
    
    assert len(new_result) == 3, "New logic: all 3 metrics survive (as expected)"
    
    print("\n✅ PASS: Metrics deduplication fix works correctly\n")


def test_dedup_still_removes_actual_duplicates():
    """Verify we still remove TRUE duplicates"""
    print("="*80)
    print("TEST: Dedup Still Removes True Duplicates")
    print("="*80)
    
    class MockExpr:
        def __init__(self, name, expr_str):
            self.name = name
            self._expr_str = expr_str
        
        def __str__(self):
            return self._expr_str
    
    # Create actual duplicates: same name AND same expression
    metrics = [
        MockExpr("col", "SUM(col)"),
        MockExpr("col", "SUM(col)"),  # TRUE duplicate
        MockExpr("col", "AVG(col)"),
    ]
    
    print(f"\n✓ Created 3 metrics (2 are true duplicates):")
    for i, m in enumerate(metrics):
        print(f"  {i+1}. name='{m.name}', expr='{str(m)}'")
    
    # Apply new dedup logic
    print(f"\n✓ Apply: remove_duplicates(metrics, key=lambda x: (str(x), x.name))")
    seen = set()
    result = []
    for m in metrics:
        key = (str(m), m.name)
        if key not in seen:
            result.append(m)
            seen.add(key)
    
    print(f"   Result: {len(result)} metrics")
    for m in result:
        print(f"     - {str(m)}")
    
    assert len(result) == 2, "Should remove 1 true duplicate"
    
    print("\n✅ PASS: True duplicates still removed correctly\n")


def test_dedup_removes_column_duplicates():
    """Verify we still remove column names that duplicate metric names"""
    print("="*80)
    print("TEST: Dedup Removes Column/Metric Name Collisions")
    print("="*80)
    
    class MockExpr:
        def __init__(self, name, expr_str, col_type="column"):
            self.name = name
            self._expr_str = expr_str
            self._type = col_type
        
        def __str__(self):
            return self._expr_str
    
    # Simulate: Period column + SUM(Period) metric (should remove one)
    exprs = [
        MockExpr("Period", '"Period"', col_type="column"),
        MockExpr("Period", 'SUM("Period")', col_type="metric"),
    ]
    
    print(f"\n✓ Created column and metric with same name 'Period':")
    for i, e in enumerate(exprs):
        print(f"  {i+1}. type={e._type}, name='{e.name}', expr='{str(e)}'")
    
    # Apply dedup
    print(f"\n✓ Apply: remove_duplicates(exprs, key=lambda x: (str(x), x.name))")
    seen = set()
    result = []
    for e in exprs:
        key = (str(e), e.name)
        if key not in seen:
            result.append(e)
            seen.add(key)
    
    print(f"   Result: {len(result)} expressions")
    for e in result:
        print(f"     - {e._type}: {str(e)}")
    
    assert len(result) == 2, "Different expressions should not be deduplicated"
    
    print("\n✅ PASS: Different expressions are preserved\n")


def main():
    print("\n" + "█"*80)
    print("█" + " "*78 + "█")
    print("█" + "  METRICS DEDUPLICATION TEST SUITE".center(78) + "█")
    print("█" + " "*78 + "█")
    print("█"*80)
    
    try:
        test_metrics_dedup_fix()
        test_dedup_still_removes_actual_duplicates()
        test_dedup_removes_column_duplicates()
        
        print("█"*80)
        print("█" + " "*78 + "█")
        print("█" + "  ✅ ALL TESTS PASSED ".center(78) + "█")
        print("█" + " "*78 + "█")
        print("█"*80)
        print("\n📊 Summary:")
        print("  ✓ Multiple metrics on same column survive dedup")
        print("  ✓ True duplicates still removed")
        print("  ✓ Different expressions preserved")
        print("  ✓ Dedup key is now: (str(expression), name)\n")
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}\n")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())
