# Current State and Likely Bottlenecks

## Likely bottlenecks previously identified

### 1. Python-based full serving-table materialization
The current pipeline likely fetches staged rows into Python, transforms them in memory, and bulk reinserts them into ClickHouse. This defeats ClickHouse's in-engine strengths.

### 2. Repeated serving rebuilds during sync
Serving tables may be rebuilt multiple times in a single synchronization cycle, including per instance and again at the end.

### 3. Frequent ClickHouse delete mutations
Normal sync flows may use heavy delete-mutation patterns instead of ClickHouse-friendly refresh semantics.

### 4. DHIS2 request multiplication
Chunking, pagination, and retry logic may multiply request counts before data lands in ClickHouse.

### 5. Duplicate persistence of staged rows in metadata-side storage
Analytical row bodies may be mirrored into metadata-side storage, increasing write amplification and adding unnecessary load.

### 6. Weak production execution fallback
Heavy jobs may fall back to thread-based execution instead of proper worker execution.

### 7. Configuration ambiguity
The active staging engine may not always be guaranteed to be ClickHouse if configuration is incomplete or defaults are unsafe.

## Guiding conclusion

The main performance problem is likely structural: ClickHouse is present but not fully allowed to do the heavy analytical work. The repo must be refactored so ClickHouse does the transformations and serving materialization natively.
