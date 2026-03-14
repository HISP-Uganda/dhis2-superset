# IMPLEMENTATION-PLAN.md
## Comprehensive Codex Agent Implementation Plan
### Project: Platform-Wide Local Staging DB with DuckDB and ClickHouse

## 1. Objective

Implement a platform-wide Local Staging DB capability for Superset that supports two staging engines:

1. DuckDB
2. ClickHouse

Only one staging engine may be active at a time at platform level.

The active engine must be used by staged dataset creation, background loading, serving-object generation, retention handling, and operational status behavior.

## 2. Core architectural decision

### 2.1 Staging engine abstraction
Introduce a staging-engine abstraction layer rather than hardcoding engine logic directly into dataset workflows.

The abstraction must separate:
- platform settings and engine activation
- engine-specific connection/bootstrap logic
- dataset materialization planning
- load/merge/refresh logic
- retention and cleanup logic
- serving-object registration logic
- observability and admin diagnostics

### 2.2 Engine support model
- DuckDB: embedded/in-process preferred
- ClickHouse: integrated as a supported external/local service-backed staging engine
- only one engine active at a time

### 2.3 Scope of use
The active staging engine becomes the default local staging target for staged dataset creation and background loads.

## 3. Required user/admin behavior

### 3.1 Admin settings
Admins must be able to:
- enable Local Staging globally
- choose active staging engine: DuckDB or ClickHouse
- configure engine-specific settings
- configure retention policy settings if retention is enabled
- view health/status of the active engine
- switch engines intentionally with safe warnings and migration semantics

### 3.2 Dataset settings
During dataset creation/settings:
- if local staging is enabled platform-wide, show the active staging engine clearly
- the active staging engine must be used for local data loading and serving management
- background loading must respect the active engine automatically
- the dataset UI must not present conflicting multi-engine choices if only one platform-wide engine is active

## 4. Engine-specific implementation strategy

## 4.1 DuckDB strategy
DuckDB should be implemented as the embedded/in-process staging engine where possible.

Required direction:
- use DuckDB through the supported SQLAlchemy/driver path
- manage one or more controlled DuckDB database files under a platform-managed storage path
- define engine bootstrap, file lifecycle, locking/concurrency expectations, and maintenance flows
- support staging tables, serving views, and materialized derived objects where appropriate
- support efficient local ingest from source systems and source query results
- support retention cleanup and vacuum/compaction strategies where appropriate

Recommended role:
- default embedded local staging engine
- ideal for single-node or modest-to-medium local analytical staging workloads
- ideal for file-based embedded deployment inside Superset runtime environments where supported by deployment model

## 4.2 ClickHouse strategy
ClickHouse should be implemented as a supported high-performance staging engine for large-scale analytical workloads.

Required direction:
- integrate through the supported ClickHouse SQLAlchemy/client path
- support local/self-managed or remote ClickHouse service connection configuration
- define stage table creation, serving table/view/materialized view strategy, and ingestion path
- optimize for large analytical workloads, background sync, and retention management
- support engine-aware table design, partitioning, ordering, and cleanup strategy

Recommended role:
- high-scale staging engine
- preferred for large-volume, high-concurrency, low-latency analytical staging
- not treated as in-process embedded in the same way as DuckDB

## 5. Platform settings model

Introduce platform settings similar to:

- local_staging_enabled: boolean
- active_staging_engine: enum(`duckdb`, `clickhouse`)
- local_staging_retention_enabled: boolean
- retention_policy_mode: enum(`none`, `time_based`, `size_based`, `dataset_based`, `hybrid`)
- retention_policy_config: json
- local_staging_engine_config: json or structured model
- engine_health_status
- engine_last_validated_at

Engine-specific configuration examples:

### DuckDB config
- storage_path
- database_file_strategy
- max_file_size_guardrail if needed
- temp_path
- extension policy if used
- compaction/maintenance settings

### ClickHouse config
- host
- port
- database
- username
- secret ref
- secure/http settings
- compression settings where applicable
- local cluster/schema/table prefix settings

## 6. Dataset loading and serving behavior

When a staged dataset is created or refreshed:
1. read platform-wide active staging engine
2. use staging engine factory/adapter to generate target objects
3. load data into the active engine
4. register serving objects for Superset query use
5. expose freshness and load status
6. apply retention policy controls where relevant

This behavior must be automatic and consistent.

## 7. Retention policy implementation

Retention policies must be configurable from Admin settings.

Supported policy concepts:
- retain data for N days
- retain only latest N refresh versions
- retain max size per dataset
- retain max total staging storage size
- preserve latest successful snapshot while pruning older ones
- configurable cleanup schedule
- dry-run preview and cleanup reporting where feasible

Retention must be implemented safely and observably.

## 8. Migration and switching strategy

Switching active engine requires careful handling.

Required behavior:
- switching the platform-wide active engine must not silently destroy existing staged data
- provide explicit migration/rebuild semantics
- mark existing staged datasets as requiring rebuild on target engine where appropriate
- document whether cross-engine migration is supported or whether rebuild-on-switch is the required behavior
- prevent hidden inconsistent serving-state behavior

Recommended initial policy:
- engine switch marks staged datasets as stale/pending rebuild
- datasets are rebuilt into the newly active engine
- prior staged engine data may be retained temporarily subject to retention/admin cleanup policy

## 9. Observability requirements

Admins must be able to see:
- active staging engine
- engine health
- last validation time
- engine storage usage
- dataset counts by engine
- load failures
- retention cleanup activity
- stale dataset count after engine switch
- engine-specific diagnostics

## 10. Non-regression policy

No working Superset features may be broken by this implementation.
The local staging engine framework must integrate cleanly without regressing:
- existing dataset creation
- database management
- chart creation
- dashboard rendering
- current DHIS2 workflows
- current non-DHIS2 workflows

## 11. Suggested milestone sequence

### Milestone 1
- staging engine abstraction
- platform settings model
- migrations
- non-regression safety

### Milestone 2
- DuckDB engine integration
- embedded bootstrap and file/path management
- basic staged dataset load path
- tests

### Milestone 3
- ClickHouse engine integration
- service-backed staging path
- tests

### Milestone 4
- dataset/settings/admin UI integration
- active engine behavior in dataset creation
- engine diagnostics UI
- tests

### Milestone 5
- retention policy implementation
- cleanup jobs
- reporting and safeguards
- tests

### Milestone 6
- switching/rebuild semantics
- hardening
- docs
- performance validation
- final non-regression validation
