#!/usr/bin/env python3
"""
Test script to visualize SQL query building with multiple metrics and groupby dimensions.

This demonstrates how the SQL SELECT, GROUP BY, and WHERE clauses are constructed
when handling:
1. Multiple metrics (SUM, AVG, COUNT)
2. Groupby dimensions (Period, OrgUnit, etc.)
3. Column sanitization for DHIS2 data elements with special characters
"""

import re
from typing import List, Dict, Any


def sanitize_dhis2_column_name(name: str) -> str:
    """Sanitize DHIS2 column names for Superset compatibility."""
    name = re.sub(r'[^\w]', '_', name)
    name = re.sub(r'_+', '_', name)
    name = name.strip('_')
    return name


class MockTableColumn:
    def __init__(self, name: str, col_type: str = "string"):
        self.column_name = name
        self.type = col_type
    
    def __repr__(self):
        return f"Column({self.column_name})"


class MockMetric:
    def __init__(self, label: str, column: str, aggregate: str):
        self.label = label
        self.column = column
        self.aggregate = aggregate
    
    def __repr__(self):
        sanitized_col = sanitize_dhis2_column_name(self.column)
        return f"{self.aggregate}({sanitized_col})"


def simulate_sql_query_building():
    """Simulate the SQL query building process with multiple metrics and groupby."""
    
    print("\n" + "="*100)
    print("SQL QUERY BUILDING SIMULATION: Multiple Metrics with Groupby Dimensions")
    print("="*100)
    
    # Setup: DHIS2 dataset with data elements with special characters
    print("\n1. INPUT: DHIS2 Table Structure")
    print("-" * 100)
    
    columns = [
        MockTableColumn("Period"),  # X-axis dimension
        MockTableColumn("OrgUnit"),  # Dimension
        MockTableColumn("105-EP01b. Malaria Total"),  # Metric column (special chars)
        MockTableColumn("105-EP01a. Suspected fever"),  # Metric column (special chars)
    ]
    
    print("Table Columns:")
    for col in columns:
        print(f"  - {col.column_name}")
    
    # User selects:
    # - X-axis: Period
    # - Dimension: OrgUnit
    # - Metrics: SUM, AVG, COUNT on "105-EP01b. Malaria Total"
    
    print("\n2. USER SELECTION")
    print("-" * 100)
    
    groupby = [
        columns[0],  # Period
        columns[1],  # OrgUnit
    ]
    print(f"Groupby (Dimensions): {[col.column_name for col in groupby]}")
    
    metrics = [
        MockMetric("SUM(Malaria Total)", "105-EP01b. Malaria Total", "SUM"),
        MockMetric("AVG(Malaria Total)", "105-EP01b. Malaria Total", "AVG"),
        MockMetric("COUNT(Malaria Total)", "105-EP01b. Malaria Total", "COUNT"),
    ]
    print(f"Metrics (3 aggregates on same column):")
    for m in metrics:
        print(f"  - {m.aggregate}({m.column})")
    
    # Build SELECT clause
    print("\n3. QUERY BUILDING PHASE")
    print("-" * 100)
    
    print("\nA. SELECT Clause Construction")
    print("   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    
    # Add groupby columns to SELECT
    select_exprs = []
    for col in groupby:
        select_exprs.append(col.column_name)
        print(f"   + Add groupby column: {col.column_name}")
    
    # Add metrics to SELECT
    sanitized_col = sanitize_dhis2_column_name(metrics[0].column)
    for metric in metrics:
        expr = f"{metric.aggregate}({sanitized_col})"
        select_exprs.append(expr)
        print(f"   + Add metric: {expr}")
    
    print(f"\n   Final SELECT expressions ({len(select_exprs)} columns):")
    for i, expr in enumerate(select_exprs, 1):
        print(f"     [{i}] {expr}")
    
    # Build GROUP BY clause
    print("\n\nB. GROUP BY Clause Construction")
    print("   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    
    groupby_exprs = []
    for col in groupby:
        groupby_exprs.append(col.column_name)
        print(f"   + Add groupby column: {col.column_name}")
    
    print(f"\n   Final GROUP BY ({len(groupby_exprs)} columns):")
    for i, expr in enumerate(groupby_exprs, 1):
        print(f"     [{i}] {expr}")
    
    # Assemble final SQL
    print("\n\nC. Final SQL Query Assembly")
    print("   ~~~~~~~~~~~~~~~~~~~~~~~~~")
    
    select_clause = f"SELECT {', '.join(select_exprs)}"
    from_clause = "FROM dhis2_analytics"
    groupby_clause = f"GROUP BY {', '.join(groupby_exprs)}"
    
    sql = f"{select_clause}\n{from_clause}\n{groupby_clause}"
    
    print("\nGenerated SQL:")
    print("```sql")
    print(sql)
    print("```")
    
    # Explain what happens
    print("\n\n4. QUERY EXECUTION & RESULT SET")
    print("-" * 100)
    
    print("""
Expected Result:
┌─────────┬──────────┬──────────────────┬──────────────────┬──────────────────┐
│ Period  │ OrgUnit  │ SUM(Malaria...) │ AVG(Malaria...) │ COUNT(Malaria...) │
├─────────┼──────────┼──────────────────┼──────────────────┼──────────────────┤
│ 2024-Q1 │ District1│       1500       │       25.5       │       59          │
│ 2024-Q1 │ District2│       2100       │       35.0       │       60          │
│ 2024-Q2 │ District1│       1650       │       27.5       │       60          │
│ 2024-Q2 │ District2│       2300       │       38.3       │       60          │
└─────────┴──────────┴──────────────────┴──────────────────┴──────────────────┘

Explanation:
- Each row represents a unique combination of Period + OrgUnit
- SUM aggregates all cases for that period/orgunit
- AVG calculates average cases per facility/day
- COUNT shows number of data points in aggregation
    """)
    
    # Show the deduplication logic
    print("\n\n5. DEDUPLICATION LOGIC")
    print("-" * 100)
    
    print("""
When combining select_exprs + metrics_exprs:

Before Dedup: 5 total expressions
  [1] Period (groupby column)
  [2] OrgUnit (groupby column)
  [3] SUM(105_EP01b_Malaria_Total)  (metric 1)
  [4] AVG(105_EP01b_Malaria_Total)  (metric 2)
  [5] COUNT(105_EP01b_Malaria_Total) (metric 3)

Dedup Key Strategy: (str(expression), expression.name)
  Period -> ("Period", "Period") ✓ Unique
  OrgUnit -> ("OrgUnit", "OrgUnit") ✓ Unique
  SUM(...) -> ("SUM(105_EP01b_Malaria_Total)", "105_EP01b_Malaria_Total") ✓ Different str()!
  AVG(...) -> ("AVG(105_EP01b_Malaria_Total)", "105_EP01b_Malaria_Total") ✓ Different str()!
  COUNT(...) -> ("COUNT(105_EP01b_Malaria_Total)", "105_EP01b_Malaria_Total") ✓ Different str()!

After Dedup: 5 total expressions (all survive - correct!)
  All 3 metrics have SAME .name but DIFFERENT str() representations
  The key (str(x), x.name) allows them all to survive
    """)
    
    # Show column sanitization in action
    print("\n\n6. COLUMN SANITIZATION IN PIPELINE")
    print("-" * 100)
    
    print("""
Frontend sends: [SUM, AVG, COUNT] on "105-EP01b. Malaria Total"

Step 1: adhoc_metric_to_sqla() - Build SQLA expression
  Input: column_name = "105-EP01b. Malaria Total"
  Sanitize: "105-EP01b. Malaria Total" → "105_EP01b_Malaria_Total"
  Create: sa.column("105_EP01b_Malaria_Total")
  Apply: SUM(...) → SUM(105_EP01b_Malaria_Total)
  Label: "SUM(105_EP01b_Malaria_Total)"

Step 2: Postprocessing - Match DataFrame columns
  DataFrame has columns: Period, OrgUnit, 105_EP01b_Malaria_Total, 105_EP01a_Suspected_fever
  Query wants: SUM(105_EP01b_Malaria_Total)
  
  Method 1: Direct match
    "SUM(105_EP01b_Malaria_Total)" in df.columns? NO
  
  Method 2: Unwrap aggregate
    Extract inner: "105_EP01b_Malaria_Total"
    "105_EP01b_Malaria_Total" in df.columns? YES ✓
    Use this column for aggregation
    """)
    
    # Show multi-column example
    print("\n\n7. MULTI-COLUMN METRICS EXAMPLE")
    print("-" * 100)
    
    print("""
User selects different metrics on different columns:
  - SUM(105-EP01b. Malaria Total)
  - AVG(105-EP01a. Suspected fever)
  - COUNT(105-EP01d. Malaria cases treated)

Query becomes:
┌──────────────┬──────────────┬──────────────────┬──────────────────┬──────────────────┐
│ Period       │ OrgUnit      │ SUM(Malaria...) │ AVG(Suspected...) │ COUNT(Cases...) │
├──────────────┼──────────────┼──────────────────┼──────────────────┼──────────────────┤
│ 2024-Q1      │ District1    │       1500       │       12.3        │       890        │
│ 2024-Q1      │ District2    │       2100       │       15.7        │       920        │
│ 2024-Q2      │ District1    │       1650       │       13.2        │       910        │
│ 2024-Q2      │ District2    │       2300       │       16.1        │       945        │
└──────────────┴──────────────┴──────────────────┴──────────────────┴──────────────────┘

Each metric operates independently on its specified column.
No combination like SUM(ColA, ColB, ColC) happens.
    """)
    
    print("\n" + "="*100)
    print("Summary: SQL is built by combining SELECT columns (groupby + metrics)")
    print("         with GROUP BY using the groupby dimensions only")
    print("="*100 + "\n")


if __name__ == "__main__":
    simulate_sql_query_building()
