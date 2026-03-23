# Gemini Code Agent Prompt

You are an autonomous senior code agent working on the GitHub repository:
https://github.com/HISP-Uganda/dhis2-superset

Your mission is to fully refactor the DHIS2-to-Superset analytical data pipeline so that synchronization remains correct and reliable, while ClickHouse becomes the native high-performance engine for staging and serving, and Superset dashboards, charts, and maps load as fast as possible.

You must work autonomously and complete the implementation end-to-end within a single milestone. Do not produce only analysis or partial recommendations. You must inspect the repository, identify the current Python-based serving build and staging hot paths, refactor them, add tests, update configuration, and document the new architecture.

## Core objective

Replace any Python-driven full serving-table materialization pipeline with a ClickHouse-native staging-to-serving architecture, while preserving synchronization correctness and ensuring fast Superset chart, map, and dashboard performance.

## Mandatory architecture

Implement this architecture:

DHIS2 API -> ClickHouse raw/staging -> ClickHouse serving marts -> Superset datasets -> dashboards

PostgreSQL must remain only for Superset metadata, users, charts, dashboards, and internal state.

Do not use PostgreSQL as analytical staging or serving storage.

## Known likely bottlenecks to eliminate

You must confirm and refactor code paths related to the following likely bottlenecks if present:

1. Python-based full serving-table materialization by fetching staging rows into Python memory and bulk reinserting them into ClickHouse.
2. Rebuilding serving tables multiple times during one sync cycle, especially per instance and then again at the end.
3. Frequent ClickHouse row delete mutations in the normal sync hot path.
4. Excessive DHIS2 API request multiplication from chunking, pagination, and retry patterns without downstream efficiency.
5. Duplicate persistence of large staged analytical rows into metadata-side storage paths.
6. Production execution paths that use background thread fallback instead of proper worker-based async processing.
7. Any configuration path that can silently fall back away from ClickHouse.

## Hard requirements

You MUST implement all of the following.

### A. ClickHouse-native data layers
Create or refactor explicit ClickHouse layers:
- raw landing tables
- normalized staging tables
- serving marts optimized for Superset

Each layer must have explicit and justified schema design:
- ENGINE
- PARTITION BY
- ORDER BY
- PRIMARY KEY where relevant
- correct data types
- minimal nullability
- no unnecessary wide schemas in dashboard-serving tables

### B. Remove Python from serving hot path
Python may orchestrate jobs only.
Python must not:
- fetch all staging rows into memory to build serving tables
- compute large serving datasets row-by-row
- repeatedly recreate serving tables from Python materialized data

All heavy transformation and materialization must run in ClickHouse SQL.

### C. Incremental serving refresh
Implement incremental refresh of only affected data scope:
- affected periods
- affected org units
- affected indicators or data elements
- affected DHIS2 instance or dataset slice

Do not rebuild the entire serving layer after every sync unless an explicit full rebuild is requested.

### D. Safe refresh semantics
Users must never see partially refreshed serving data.
Implement one or more of:
- atomic table swap
- partition replacement
- versioned serving views
- promotion from build tables to active tables

Guarantee that dashboards always see either old-good or new-good data.

### E. Reduce or eliminate heavy delete mutation usage
Refactor away from frequent ALTER TABLE ... DELETE in normal sync flows.
Use partition-aware replacement, versioned append, or other ClickHouse-friendly patterns.

### F. Dashboard-optimized serving marts
Create dedicated serving marts for common workloads, at minimum:
- trend charts
- KPI summaries
- org unit breakdowns
- period summaries
- map datasets
- category breakdowns
- public dashboard optimized summaries

These marts must be narrow, pre-aggregated where practical, and aligned to actual Superset filter and group-by patterns.

### G. Map performance
Implement dedicated map-serving structures with pre-resolved geographic fields and precomputed metrics at the correct geographic grain.
Do not require heavy live joins for common map rendering.

### H. Synchronization correctness
Preserve and validate sync correctness:
- idempotent behavior
- deterministic refresh
- retries
- partial failure handling
- reconciliation checks
- row count validation across extract, staging, and serving

A failed sync must not corrupt serving state or expose incomplete dashboard data.

### I. Superset integration
Refactor Superset datasets to use ClickHouse serving marts only, or very thin ClickHouse views on top of them.
Do not rely on heavy virtual datasets or runtime transformations for production dashboards.

### J. Production readiness
Ensure Superset performance support is in place:
- Redis-backed caching
- Celery workers for async and background tasks
- no heavy background-thread fallback in production sync execution
- config validation for ClickHouse being the active engine

### K. Observability
Add metrics, logging, and timing for:
- DHIS2 extraction duration
- staging load duration
- serving refresh duration
- chart query latency
- dashboard load-related timings where measurable
- failure counts
- retry counts
- row counts by layer

### L. Testing
Add or update:
- unit tests
- integration tests
- sync correctness tests
- serving consistency tests
- failure and retry tests
- performance smoke tests

## Implementation constraints

- Preserve existing user-facing functionality unless a change is necessary for performance or correctness.
- Prefer minimal invasive changes where possible, but make structural changes when required.
- Keep orchestration code clean and explicit.
- Keep ClickHouse SQL definitions versioned and understandable.
- Avoid hidden magic.
- Document all new tables, refresh semantics, and configuration changes.
- Ensure multiple DHIS2 instances continue to work correctly.

## Required outputs

You must produce all of the following in the repo:

1. Refactored code implementing the ClickHouse-native staging-to-serving pipeline.
2. Schema definitions, migrations, or DDL for raw, staging, and serving tables.
3. Refactored sync orchestration logic that triggers incremental serving refresh safely.
4. Removal or isolation of old Python serving build logic.
5. Updated Superset dataset integration path or dataset guidance where relevant.
6. Updated production configuration and environment documentation.
7. Tests covering correctness and failure safety.
8. A migration guide from the previous pipeline to the new one.
9. A concise architecture document explaining the new flow and why it is faster.

## Validation checklist you must satisfy before finishing

Before you finalize, verify and document:

- ClickHouse is the active analytical engine for staging and serving.
- PostgreSQL remains only Superset metadata storage.
- No full serving-table build happens in Python.
- No repeated serving rebuild happens per instance unless explicitly required.
- Charts and dashboards point to serving marts, not raw staging.
- Map datasets use optimized serving structures.
- Incremental sync works for changed data only.
- Failed sync does not expose partial serving results.
- Tests pass.
- Documentation is updated.

## Working style

Act autonomously.
Inspect the repository first, then implement.
Do not stop at analysis.
Do not leave placeholders where implementation is feasible.
If you encounter ambiguity, choose the option that best improves correctness, ClickHouse-native execution, and dashboard speed, and document your reasoning in the code or docs.

At the end, provide:
- a summary of changes made
- files changed
- migration notes
- remaining risks or follow-up recommendations
