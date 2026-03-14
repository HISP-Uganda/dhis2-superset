# DATA-MODEL-RELATIONS.md
## Formal Data Model and Relationship Requirements

## 1. Purpose
The model must support:
- Database-centric dataset creation
- DHIS2 Database with multiple configured DHIS2 connections
- generic staged datasets for applicable sources
- strong lineage
- schedule/background metadata
- public dashboard settings and theme settings
- safe compatibility evolution

## 2. Core Entities
### database
Existing Superset Database concept remains the main user-facing object.

### dhis2_connection
Child connection/end-point configuration under a DHIS2 Database.

Suggested fields:
- id
- database_id
- name
- base_url
- auth_type
- secret_ref
- is_active
- last_test_status
- last_tested_at
- display_order
- created_at
- updated_at

### staged_dataset
Generic staged dataset abstraction.

### staged_dataset_field
Selected field/variable/column within the staged dataset.

### schedule_policy
Background sync schedule metadata.

### sync_job
Refresh execution metadata.

### sync_job_source
Source/connection-level execution tracking.

### stage_observation
Raw staged row/fact lineage.

### dataset_materialization
Serving tables/views/materialized views.

### theme_profile
Theme preset/profile for internal or public experiences.

### public_dashboard_layout_settings
Public dashboard presentation and layout configuration.

## 3. Required Relationships
- one database has many dhis2_connection rows where database type is DHIS2
- one database may have many staged_dataset rows
- one staged_dataset has many staged_dataset_field rows
- one staged_dataset has one schedule policy
- one staged_dataset has many sync_job rows
- one sync_job has many sync_job_source rows
- one stage_observation belongs to one staged_dataset
- one stage_observation belongs to one staged_dataset_field
- one staged_dataset has many dataset_materialization rows
- one public dashboard may have one public_dashboard_layout_settings row
- one theme profile may be referenced by internal/public settings as appropriate

## 4. Compatibility Rule
Existing single-DHIS2-connection behavior must remain valid through a compatibility-safe migration path.
