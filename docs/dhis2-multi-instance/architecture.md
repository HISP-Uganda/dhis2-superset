# Generic Staged-Source Architecture

This repository now carries a generic staged-source metadata model alongside the DHIS2-specific compatibility layer.

## Canonical Metadata Tables

- `staged_sources`: generic source registry
- `dhis2_logical_databases`: DHIS2 federation roots under one Superset database connection
- `staged_datasets`: canonical staged dataset metadata
- `staged_dataset_fields`: canonical field lineage and alias metadata
- `staged_dataset_dimensions`: query-facing dimension metadata
- `schedule_policies`: enforced background refresh policy metadata
- `sync_jobs`, `sync_job_sources`, `sync_job_fields`: execution tracking
- `stage_load_batches`, `stage_observations`, `stage_partitions`: raw-stage lineage and storage metadata
- `dataset_materializations`: serving-object metadata
- `dataset_metric_mappings`, `dataset_field_equivalences`: analytical harmonization metadata
- `source_metadata_cache`: fast source-browsing cache

## DHIS2 Metadata Staging

DHIS2 metadata browsing is now local-stage-first for the dataset wizard.

- creating or updating a DHIS2 Database registers an after-commit background metadata refresh
- creating, updating, or deleting a configured DHIS2 connection also schedules a background metadata refresh for the owning Database
- the `DHIS2Preloader` now performs scheduled staged-metadata refreshes instead of placeholder cache warmups
- per-connection snapshots for `dataElements`, `indicators`, `dataSets`, `programIndicators`, `eventDataItems`, `programs`, `trackedEntityTypes`, `dataElementGroups`, `indicatorGroups`, `organisationUnits`, `organisationUnitLevels`, `organisationUnitGroups`, `geoJSON`, and `orgUnitHierarchy` are persisted into `source_metadata_cache`
- dataset-creation metadata reads now use staged snapshots and only filter/merge locally; they no longer block on live DHIS2 metadata fetches in the request path
- DHIS2 boundary GeoJSON and org-unit hierarchy metadata now follow the same staged-local path, so DHIS2 maps and downstream cascade-style hierarchy consumers can render from local storage instead of live DHIS2 metadata requests
- when a requested snapshot is missing or stale, the API returns a staged `pending` or `partial` response and re-queues background refresh instead of falling back to live DHIS2 reads
- the DHIS2 Database UI exposes a `Local metadata staging` status card with explicit refresh controls, and dataset step 1 surfaces the same staged status so users can see whether variables and org units are ready before they enter data selection

## DHIS2 Compatibility Links

The DHIS2 tables remain in service for backward compatibility:

- `dhis2_instances.logical_database_id -> dhis2_logical_databases.id`
- `dhis2_staged_datasets.logical_database_id -> dhis2_logical_databases.id`
- `dhis2_staged_datasets.generic_dataset_id -> staged_datasets.id`
- `dhis2_dataset_variables.generic_field_id -> staged_dataset_fields.id`
- `dhis2_sync_jobs.generic_sync_job_id -> sync_jobs.id`

Create, update, and sync flows now mirror DHIS2 metadata into the generic tables automatically.

## Serving Direction

The architecture target is:

1. source extraction
2. raw stage lineage capture
3. serving object refresh
4. Superset datasets and charts query the local serving object by default

Current repository status:

- DHIS2 sync now writes two local objects:
  - the raw long-form `dhis2_staging.ds_*` stage table that preserves source lineage
  - a chart-facing `dhis2_staging.sv_*` serving table that pivots the selected dataset dimensions into user-facing analytical columns
- the same sync path now also records normalized raw-stage lineage in `stage_observations`, `stage_load_batches`, and `stage_partitions`
- staged-source capability metadata is exposed through `/api/v1/staging/sources/...`
- dataset creation now reads staged-source capability metadata instead of relying on DHIS2-only backend checks
- dataset creation is now Database-first and branch-aware:
  - the first screen always shows all created Superset Databases
  - selecting a Database determines the branch automatically: `dhis2` databases follow the staged DHIS2 flow and all other databases follow the normal table/query flow
  - the DHIS2 flow stays compact at four steps: database, data selection, dataset settings, review and create
  - the database flow stays compact at four steps: database, table/query source, dataset settings, review and create
  - a DHIS2 Database is selected only once; the UI no longer asks for a second top-level DHIS2 source or instance concept
  - the selected DHIS2 Database immediately loads its configured child connections from the saved Database configuration and includes all active ones automatically; the dataset step no longer re-exposes manual connection-scoping checkboxes
  - variables are loaded from local staged metadata across the selected configured connections and remain tagged with their originating connection lineage
  - after the staged dataset is created, Superset datasets and charts bind to the local `sv_*` serving table instead of querying the DHIS2 container database directly
  - the serving table columns now match the analytical choices the user made in the wizard:
    - `DHIS2 Instance` is included when more than one configured connection contributes data
    - selected organisation-unit hierarchy levels become named columns such as `Region`, `District`, or `Facility`
    - `Period` is always a first-class column
    - each selected variable becomes its own column using the variable alias or DHIS2 display name
  - dataset creation queues an initial background sync immediately so the local serving table begins filling as soon as the staged dataset is saved
  - that initial sync is a full load for the configured period scope, while later scheduled or manual refreshes run in incremental mode by default:
    - missing periods are fetched and upserted
    - the latest in-window period is re-fetched so rolling windows remain current
    - periods outside the configured rolling window are pruned from local staging
  - the per-dataset Celery sync task no longer enforces a task time limit, so long-running background refreshes can complete without being cut off by the worker
  - the variable picker now supports typed search by variable name or UID and typed search by group, program, or stage depending on the selected DHIS2 metadata type; data elements, indicators, program indicators, and event data items all use the same staged-search path
  - organisation units, organisation-unit levels, and organisation-unit groups are also loaded from staged local metadata for the selected configured connections instead of the legacy live credential path, with pending and partial-load diagnostics preserved in the UI
  - DHIS2 map boundary requests now use staged local `geoJSON` snapshots by default, and the browser-side boundary cache is no longer cleared on every fetch
  - when multiple configured connections are selected, the org-unit step supports either:
    - a primary configured connection policy, where one connection supplies the organisation hierarchy used for browsing and selection
    - a repository merge policy, where organisation units are combined into a repository org-unit structure with local level mappings and per-connection lineage preserved
    - a per-instance policy, where each configured connection keeps its own organisation hierarchy and duplicate DHIS2 org-unit ids remain selectable separately in local staging
  - selected organisation-unit metadata, local boundary GeoJSON, and derived org-unit hierarchy snapshots are now cached in `source_metadata_cache` and saved into dataset configuration with source-instance lineage so staged refreshes can safely reuse local metadata and filter federated org-unit selections per connection
  - the DHIS2 Database modal now owns configured-connection management directly, including per-connection ordering and persisted connection-test metadata
  - the DHIS2 Database create flow is now split into a logical container stage and a configured-instance stage: top-level Database details are captured first, while DHIS2 URLs and credentials are stored only on the child configured-instance records
  - a single workflow state tree drives database selection, dependent resets, schedule display, and review summaries

The remaining expansion area is the full generic staged-dataset builder and extraction path for non-DHIS2 sources.
