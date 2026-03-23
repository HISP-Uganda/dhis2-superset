# Work Breakdown and Execution Sequence

## Step 1
Audit current pipeline and produce a code-level bottleneck map.

## Step 2
Define target schemas and ClickHouse contracts.

## Step 3
Implement raw landing and staging normalization contracts.

## Step 4
Implement serving marts and refresh semantics in ClickHouse.

## Step 5
Refactor sync orchestration to call native refresh logic.

## Step 6
Remove or isolate legacy Python serving materialization.

## Step 7
Refactor Superset datasets to point to serving marts.

## Step 8
Implement map-serving optimization.

## Step 9
Implement cache, worker, and engine validation.

## Step 10
Add tests, metrics, docs, migration, and rollback procedures.

## Step 11
Benchmark and finalize.
