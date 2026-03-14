# RETENTION-POLICY-REQUIREMENTS.md
## Local Data Retention Policy Requirements

## 1. Optional enablement
Retention policies are optional and admin-controlled.

## 2. Supported policy dimensions
The implementation should support one or more of:
- time-based retention
- version-count retention
- dataset-level size retention
- global storage-cap retention
- hybrid policies

## 3. Policy configuration
Admins should be able to configure:
- enable/disable retention
- retention mode
- days to retain
- number of historical versions/snapshots to retain
- cleanup schedule
- preserve latest successful version
- dry-run/report mode where feasible

## 4. Safety requirements
Retention cleanup must:
- not silently delete the latest valid version unless explicitly allowed
- log cleanup actions
- be observable in admin UI or logs
- support engine-aware cleanup logic
- be test-covered

## 5. Engine-aware implementation
DuckDB and ClickHouse retention cleanup may differ technically, but the admin-facing policy model should be coherent.

## 6. Required observability
Track:
- last cleanup run
- rows/objects removed
- storage reclaimed where feasible
- failures/warnings
