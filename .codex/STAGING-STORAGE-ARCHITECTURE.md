# STAGING-STORAGE-ARCHITECTURE.md
## Formal Storage Architecture Requirements
### Project: Fast Multi-Source Superset Staging and Local Analytical Storage
### Target Agent: Codex Agent

## 1. Purpose

This document defines the mandatory storage architecture requirements for implementing the local staging layer that powers high-performance analytics for the customized Superset environment.

The local staging layer MUST function as an analytical serving architecture, not merely a cache.

It must support:
- large-scale data ingestion from multiple DHIS2 instances
- staged ingestion from other supported databases/sources added to Superset
- complete source lineage
- flexible analytical querying
- fast chart and dashboard performance
- scheduled background refresh
- incremental and full reload patterns
- operational observability
- serving-layer optimization for Superset

## 2. Core Architecture Goal

The storage architecture MUST implement this logical flow:

Source adapters / source queries / source extraction → raw stage ingestion layer → serving layer / materialized analytical objects → Superset datasets and charts

The architecture MUST NOT rely on live source queries as the default chart execution path for staged datasets.

## 3. Scope of Supported Sources

The local staging framework MUST NOT be restricted to DHIS2.

It MUST support:
- DHIS2 via a specialized source adapter layer
- SQL databases and other supported database connections added to Superset where staging is enabled
- future source adapters via a generic staging abstraction

The framework MUST therefore separate:
- generic staging/storage infrastructure
- source-specific extraction and metadata adapters

## 4. Mandatory Storage Layers

The implementation MUST include at least two storage layers:

### 4.1 Raw Stage Layer
A normalized ingestion layer that stores extracted observations/rows with complete lineage and refresh traceability.

### 4.2 Serving Layer
A query-optimized analytical layer that is used by Superset datasets, Explore, charts, and dashboards.

The raw stage layer and serving layer MUST be logically separate even if implemented in the same database.

## 5. Required Core Entities

The implementation MUST define and persist the following entities or their equivalent models:
- staged_source
- staged_dataset
- staged_dataset_field
- staged_dataset_dimension
- schedule_policy
- sync_job
- sync_job_source
- sync_job_field
- stage_load_batch
- stage_observation
- stage_partition
- dataset_materialization
- dataset_metric_mapping
- dataset_field_equivalence
- source_metadata_cache

DHIS2-specific support MUST additionally include:
- dhis2_logical_database
- dhis2_instance

## 6. Mandatory Relationship Requirements

The implementation MUST enforce these logical relationships:
- one staged dataset has many staged fields
- one staged dataset has many dimensions
- one staged dataset has one active schedule policy
- one staged dataset has many sync jobs
- one sync job has many source-level job records
- one sync job has many field-level job records
- one stage observation belongs to one staged dataset
- one stage observation belongs to one staged dataset field
- one stage observation belongs to one sync job
- one stage observation belongs to one load batch
- one staged dataset can have many serving objects
- one staged dataset can have many metric mappings
- one staged dataset field can participate in many equivalence mappings

DHIS2-specific logical relationships MUST additionally preserve:
- one logical database has many DHIS2 instances
- one DHIS2 logical database has many staged datasets where relevant
- each DHIS2-derived staged field belongs to exactly one source instance

## 7. Raw Stage Layer Requirements

The raw stage layer MUST:
1. store one row per normalized observation or extracted row grain
2. preserve staged dataset lineage
3. preserve source lineage
4. preserve staged field lineage
5. preserve sync job lineage
6. preserve load batch lineage
7. support typed values or typed extracted columns
8. support bulk insert / bulk merge workflows
9. support large data refresh operations
10. support partitioning

### 7.1 Required raw stage columns
At minimum, stage_observation or equivalent MUST include:
- dataset_id
- dataset_field_id
- source_type
- staged_source_id nullable
- source_instance_id nullable
- sync_job_id
- load_batch_id
- period/date columns where applicable
- relevant dimensional columns
- typed value columns or typed extracted field storage
- source_row_hash
- ingested_at
- last_synced_at

### 7.2 Typed value requirement
The implementation MUST NOT store all staged values as plain text if numeric/date/boolean types are known or inferable.

## 8. Serving Layer Requirements

The serving layer MUST:
1. be the default query source for Superset charts and Explore when staging is enabled
2. be optimized for filtering, grouping, comparison, and aggregation
3. be derived from the raw stage layer
4. preserve source awareness
5. support canonical metric naming
6. support comparison across sources where appropriate
7. support pre-aggregated or materialized forms where needed
8. support friendly chart-ready dimensions and metrics

### 8.1 Serving-layer objects
The implementation MUST support:
- serving tables
- serving views
- materialized views

At least one of these MUST be defined as the primary serving object for each staged dataset.

## 9. Partitioning Requirements

The implementation MUST support physical partitioning for large-stage storage.

### 9.1 Required partitioning approach
At minimum, the raw stage layer MUST support partitioning by:
- dataset_id
or
- time period/date
or
- a documented composite strategy

### 9.2 Preferred approach
The preferred initial strategy is:
- primary partitioning by dataset_id
- optional subpartitioning by period/date range where justified

### 9.3 Partition metadata
The system MUST track partition metadata including:
- partition name
- partition key
- row count
- size
- last analyzed timestamp

## 10. Indexing Requirements

The implementation MUST explicitly create indexes aligned to real analytical query patterns.

### 10.1 Required raw-stage indexes
At minimum, create indexes equivalent to:
- (dataset_id, date/period)
- (dataset_id, source lineage key)
- (dataset_id, dataset_field_id)
- (dataset_id, major analytical dimension)
- (dataset_id, source lineage key, dataset_field_id, date/period)
- (sync_job_id)

### 10.2 Required serving-layer indexes
At minimum, create indexes equivalent to:
- (date/period)
- (source lineage key)
- (major analytical dimension)
- (canonical_metric_key or equivalent)
- (source lineage key, date/period)
- (major analytical dimension, date/period)
- (dataset_id, source lineage key, date/period)

### 10.3 Large-data performance requirement
Indexes MUST be selected deliberately to balance:
- ingestion speed
- query speed
- storage overhead
- maintenance cost

## 11. Incremental Refresh Requirements

The architecture MUST support incremental refresh and full refresh.

### 11.1 First load
The first load for a staged dataset MAY be full.

### 11.2 Subsequent loads
Subsequent loads SHOULD default to incremental refresh where supported.

### 11.3 Refresh scope
Refresh scope MUST support:
- date/period window
- source subset
- field subset
- full reload

### 11.4 Refresh metadata
The system MUST track:
- last successful sync
- last partial sync
- last failed sync
- refresh scope
- rows inserted
- rows updated
- rows skipped
- rows deleted where applicable

## 12. Ingestion Pipeline Requirements

The ingestion pipeline MUST:
1. extract data grouped by source connection where appropriate
2. extract only fields mapped to the correct source
3. use batch-oriented loading
4. avoid row-by-row inserts for large volumes
5. load into temporary or batch-controlled structures where appropriate
6. merge or upsert into raw stage safely
7. refresh serving objects after successful raw-stage updates
8. preserve raw-stage integrity on partial failure

### 12.1 Batch tracking
Every load MUST be traceable to a load batch and sync job.

## 13. Query Flexibility Requirements

The storage architecture MUST support flexible analytics, including:
- filtering by source
- filtering by date/period
- filtering by org unit or equivalent dimensions
- filtering by field/metric
- grouping by source
- grouping by date/period
- grouping by major dimensions
- comparison across DHIS2 instances
- comparison across staged source datasets where applicable
- derived metrics using harmonized mappings
- canonical metric naming for charts
- serving both narrow and optionally wide analytical shapes

## 14. Variable / Field Equivalence and Harmonization Requirements

Because different sources may use different identifiers for equivalent concepts, the implementation MUST support semantic harmonization.

The storage metadata model MUST support:
- equivalence mappings between staged fields
- canonical metric keys
- comparison groups
- optional confidence or mapping notes

## 15. Schedule and Background Processing Requirements

Background processing is mandatory for staged datasets.

The implementation MUST:
- allow schedule configuration from dataset creation UI
- automatically enable background refresh for staged datasets
- not provide a disable option for staged background processing
- store schedule policy metadata
- execute scheduled jobs against the correct source connections
- show schedule and refresh state clearly in UI

## 16. Superset Integration Requirements

The serving layer MUST integrate cleanly with Superset.

Superset datasets MUST bind to serving objects, not live source extraction, for normal chart execution when staging is enabled.

Serving objects SHOULD expose chart-friendly columns such as:
- period_date / event_date / time_key
- dimension labels
- source name
- canonical_metric_key
- metric_display_name
- typed value fields

## 17. Observability Requirements

The architecture MUST support observability at storage and refresh level.

The system MUST track:
- sync jobs
- source-level sync status
- field-level sync status
- load batch status
- row counts
- failures
- partition health
- serving object refresh status
- last successful refresh timestamps

## 18. Maintenance Requirements

The implementation MUST include maintenance support for large data workloads.

This includes:
- analyze / statistics refresh
- vacuum or equivalent maintenance where relevant
- partition lifecycle management
- index health awareness
- stale serving object refresh management

## 19. Data Integrity Requirements

The storage architecture MUST ensure:
- no ambiguous source lineage
- no silent field remapping
- no destructive overwrite without defined refresh semantics
- no invalid foreign key relationships
- no serving-layer rebuilds without traceable source sync metadata

## 20. Prohibited Shortcuts

The implementation MUST NOT:
- use a single flat unpartitioned, unindexed stage table for all workloads
- depend on live-source fetch during chart rendering as default behavior for staged datasets
- store all values as plain text
- omit source lineage
- omit sync job lineage
- omit batch lineage
- omit schedule metadata
- omit serving-layer materialization metadata
- progress without migrations, tests, and documentation

## 21. Required Deliverables

The Codex agent MUST deliver:
1. schema/model updates
2. migration files
3. raw stage layer implementation
4. serving layer implementation
5. partitioning strategy implementation
6. indexing strategy implementation
7. sync/load tracking tables
8. semantic mapping support
9. schedule metadata support
10. Superset binding to serving-layer objects
11. test coverage
12. documentation and operational notes

## 22. Completion Criteria

The storage architecture implementation is complete only when:
- raw stage exists and is populated via batch-based sync
- serving objects exist and power Superset analytics
- relevant relations are implemented and enforced
- partitioning exists for large-stage storage
- indexes exist for analytical query paths
- incremental refresh is supported
- source lineage is preserved end-to-end
- schedule metadata is implemented
- background processing is auto-enabled
- tests pass
- documentation is complete
