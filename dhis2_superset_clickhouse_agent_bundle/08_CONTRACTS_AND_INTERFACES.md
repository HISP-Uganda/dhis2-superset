# Contracts and Interfaces

## Contract 1. Source extraction contract
The extractor must deliver:
- source instance identifier
- extraction window metadata
- stable row shape or documented mapping
- clear error semantics

## Contract 2. Raw landing contract
Raw landing tables must:
- accept append batches
- preserve source lineage
- retain sync job references
- allow replay or rebuild support

## Contract 3. Normalized staging contract
Staging must:
- represent DHIS2 data in typed analytical form
- include fields needed for serving refresh scope calculation
- be queryable by changed partitions and dimensions

## Contract 4. Serving mart contract
Each serving mart must document:
- source staging tables
- aggregation grain
- partitioning strategy
- ordering strategy
- expected filters
- expected Superset datasets
- refresh semantics

## Contract 5. Synchronization contract
Each sync job must record:
- job id
- dataset or logical asset
- source instance
- start and end timestamps
- loaded row counts
- transformed row counts
- served row counts
- refresh scope
- status
- error details if any

## Contract 6. Atomic visibility contract
A serving refresh must guarantee one of the following user-visible outcomes only:
- old-good data remains visible
- new-good data becomes visible

Partial or mixed refresh state must not be visible.

## Contract 7. Superset dataset contract
Each production dashboard dataset must map to:
- a serving mart or thin ClickHouse view
- documented filter columns
- documented grain
- documented refresh dependency

## Contract 8. Operational contract
The system must expose sufficient state for operators to answer:
- what synced
- what failed
- what is stale
- what serving version is active
- what data range is covered
