# STAGING-STORAGE-ARCHITECTURE.md
## Formal Storage Architecture Requirements

## 1. Purpose
The local staging/storage architecture must support fast local analytical serving for applicable staged datasets while preserving lineage and supporting generic source abstractions.

It must support:
- DHIS2-derived staged datasets
- staged datasets from other supported sources where enabled
- raw stage + serving layer separation
- large-data query optimization
- sync/job/batch lineage
- schedule-driven refresh

## 2. Required Architecture
Implement:
source extraction -> raw stage -> serving layer -> Superset chart/query serving

Staged datasets must use local serving objects by default.

## 3. Mandatory Behavior
- preserve source lineage
- preserve job/batch lineage
- support bulk load
- support typed values where appropriate
- support partitioning/indexing strategies where justified
- support materialized serving objects where needed
- integrate with schedule/background processing

## 4. Generic Scope
The staging framework must not be DHIS2-only.
DHIS2 may use special adapters, but the storage framework must support other staged source types as applicable.
