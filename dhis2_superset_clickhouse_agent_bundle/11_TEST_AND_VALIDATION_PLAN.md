# Test and Validation Plan

## Test categories

### Unit tests
- changed-scope calculation
- refresh planning logic
- serving promotion logic
- configuration enforcement logic

### Integration tests
- DHIS2 extract to raw landing
- raw landing to staging normalization
- staging to serving refresh
- Superset dataset compatibility against serving marts

### Correctness tests
- row count reconciliation
- repeat sync idempotency
- retry safety
- multi-instance sync correctness
- partial failure recovery

### Consistency tests
- atomic visibility of serving data
- no partial serving exposure
- public dashboard-serving stability

### Performance smoke tests
- staging load throughput sanity check
- serving refresh duration sanity check
- serving query latency sanity check
- chart dataset query sanity check
- map dataset query sanity check

## Validation checkpoints
- before refactor baseline captured
- after schema introduction validated
- after serving refactor validated
- after Superset dataset migration validated
- after production config validation completed
