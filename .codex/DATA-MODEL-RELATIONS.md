# DATA-MODEL-RELATIONS.md
## Formal Data Model and Relationship Requirements
### Project: Fast Multi-Source Superset Staging and Local Analytical Storage

## 1. Goal

The data model MUST support:
- multi-instance DHIS2 federation
- generic staged datasets from other supported Superset sources
- full lineage across source, dataset, field, sync job, and serving object
- complete and flexible querying
- large-data staging and materialization
- operational observability
- schedule-driven background processing

## 2. Core Entities

### 2.1 staged_source
Generic source registration concept for staged datasets.

Required attributes:
- id
- source_type (`dhis2`, `sql_database`, `api_source`, etc.)
- source_connection_id or equivalent
- source_name
- is_active
- created_at
- updated_at

### 2.2 dhis2_logical_database
Required for federated DHIS2 sources.

### 2.3 dhis2_instance
Child source instances under one DHIS2 logical database.

### 2.4 staged_dataset
Generic staged dataset entity.

Required attributes:
- id
- source_type
- staged_source_id nullable where DHIS2 uses logical model
- dhis2_logical_database_id nullable
- name
- slug
- description
- dataset_mode
- stage_schema_name
- primary_serving_object_name
- refresh_enabled default true
- schedule_policy_id
- created_by
- created_at
- updated_at
- last_successful_sync_at
- last_partial_sync_at
- last_failed_sync_at
- last_sync_status

### 2.5 staged_dataset_field
Generic field/variable/column selected into the staged dataset.

Required attributes:
- id
- dataset_id
- field_kind (`dhis2_variable`, `database_column`, `api_field`, etc.)
- source_instance_id nullable
- staged_source_id nullable
- source_object_name
- source_field_name
- source_field_id nullable
- source_field_code nullable
- source_field_label
- dataset_alias
- canonical_metric_key
- comparison_group
- value_type
- aggregation_type
- is_required
- is_active
- display_order
- created_at
- updated_at

### 2.6 staged_dataset_dimension
Dataset dimension metadata.

### 2.7 schedule_policy
Auto-enabled background processing schedule metadata.

### 2.8 sync_job
Dataset refresh execution.

### 2.9 sync_job_source
Source-level execution detail inside a sync job.

### 2.10 sync_job_field
Field-level execution detail inside a sync job.

### 2.11 stage_load_batch
Batch-level load tracking.

### 2.12 stage_observation
Raw normalized staged row.

Required lineage:
- dataset_id
- dataset_field_id
- source_type
- staged_source_id nullable
- source_instance_id nullable
- sync_job_id
- load_batch_id

### 2.13 stage_partition
Partition metadata.

### 2.14 dataset_materialization
Serving tables/views/materialized views per dataset.

### 2.15 dataset_metric_mapping
Canonical metric definitions exposed to Superset.

### 2.16 dataset_field_equivalence
Semantic equivalence mapping across source fields.

### 2.17 source_metadata_cache
Cached source metadata for fast UI browsing.

## 3. Mandatory Relationships

The implementation MUST enforce these relationships:

- one staged_source has many staged_datasets where applicable
- one dhis2_logical_database has many dhis2_instances
- one dhis2_logical_database has many staged_datasets
- one staged_dataset has many staged_dataset_fields
- one staged_dataset has many staged_dataset_dimensions
- one staged_dataset has one active schedule_policy
- one staged_dataset has many sync_jobs
- one sync_job has many sync_job_source rows
- one sync_job has many sync_job_field rows
- one stage_observation belongs to one staged_dataset
- one stage_observation belongs to one staged_dataset_field
- one stage_observation belongs to one sync_job
- one stage_observation belongs to one stage_load_batch
- one staged_dataset has many dataset_materializations
- one staged_dataset has many dataset_metric_mappings
- one staged_dataset_field can participate in many dataset_field_equivalence mappings

## 4. Query-Flexibility Requirement

The model MUST support:
- filtering by source
- filtering by period/date
- filtering by org unit or equivalent dimensions
- grouping by source
- grouping by field alias / canonical metric
- comparison across DHIS2 instances
- comparison across staged source datasets where applicable
- derived metrics and harmonized metrics

## 5. Minimum Foreign Keys

At minimum, foreign keys or equivalent constraints MUST exist between:
- staged_dataset.schedule_policy_id -> schedule_policy.id
- staged_dataset_field.dataset_id -> staged_dataset.id
- sync_job.dataset_id -> staged_dataset.id
- sync_job_source.sync_job_id -> sync_job.id
- sync_job_field.sync_job_id -> sync_job.id
- sync_job_field.dataset_field_id -> staged_dataset_field.id
- stage_load_batch.dataset_id -> staged_dataset.id
- stage_load_batch.sync_job_id -> sync_job.id
- stage_observation.dataset_id -> staged_dataset.id
- stage_observation.dataset_field_id -> staged_dataset_field.id
- stage_observation.sync_job_id -> sync_job.id
- stage_observation.load_batch_id -> stage_load_batch.id
- dataset_materialization.dataset_id -> staged_dataset.id
- dataset_metric_mapping.dataset_id -> staged_dataset.id

DHIS2-specific keys MUST additionally enforce:
- dhis2_instance.logical_database_id -> dhis2_logical_database.id
- staged_dataset.dhis2_logical_database_id -> dhis2_logical_database.id
- staged_dataset_field.source_instance_id -> dhis2_instance.id

## 6. Required Design Rule

The local storage data model MUST NOT be designed as DHIS2-only.
It MUST support DHIS2 and other staged source types under a generalized staged dataset model, while preserving specialized DHIS2 capabilities where needed.
