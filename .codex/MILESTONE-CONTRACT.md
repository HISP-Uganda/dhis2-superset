# MILESTONE-CONTRACT.md
## Milestone Delivery Contract
### Project: Fast Multi-Source Superset Staging and Local Analytical Storage

## Milestone 1: Metadata Model, Migrations, and Compatibility
### Required Outcomes
- introduce generic staged dataset abstraction
- introduce or extend DHIS2 logical database abstraction
- introduce source connection/source adapter registry concepts where needed
- support multiple DHIS2 instances under one logical database
- define dataset variable/field/column lineage metadata model
- define sync job metadata model
- define staging metadata registry
- define scheduling metadata/default behavior
- create schema migrations
- migrate existing one-instance DHIS2 configurations safely

### Acceptance Criteria
- legacy configuration remains functional
- generic staged dataset metadata exists
- scheduling defaults are modeled
- migrations run successfully
- compatibility tests pass
- docs updated

## Milestone 2: Source Management and Connection Handling
### Required Outcomes
- backend APIs for relevant source metadata / instance management
- per-instance/per-source connection handling preservation
- secure secret handling
- connection testing endpoints/services where applicable
- frontend UI to manage DHIS2 instances and staged-source options

### Acceptance Criteria
- admin can add, edit, disable, test, and remove DHIS2 instances as applicable
- generic staged-source selection is modeled cleanly
- no secret leakage
- backend and UI tests pass
- operational notes updated

## Milestone 3: Dataset Builder and Schedule Configuration
### Required Outcomes
- staged dataset builder supports DHIS2 and other supported staged sources
- metadata browsing per source
- source lineage tagging in saved dataset fields
- aliasing and ambiguity handling
- edit/update support for dataset definitions
- schedule configuration within dataset creation UI
- auto-enabled background processing with no disable option

### Acceptance Criteria
- a staged dataset can be defined from supported source types
- each staged field stores source lineage
- ambiguous same-name fields are handled safely
- UI clearly shows source identity
- schedule can be defined at dataset creation time
- background processing is automatically active
- tests pass

## Milestone 4: Staging Storage and Query Path
### Required Outcomes
- PostgreSQL-based staging storage first
- raw stage table or equivalent normalized storage design
- serving objects registered/queryable by Superset
- local staged data becomes chart query source by default
- large-data indexing and optimization strategy
- generic source adapter path for materialization

### Acceptance Criteria
- staged tables can store dataset data from supported source types
- source lineage is retained in staged records
- queries can run against staged data
- charts default to staged querying
- performance-focused indexes exist
- large-data query plan considerations are implemented
- tests pass

## Milestone 5: Background Sync Engine
### Required Outcomes
- manual refresh
- scheduled refresh framework
- grouped fetch/extract by source connection
- normalized load into stage tables
- job status, row counts, errors, and durations
- partial failure handling
- enforced auto-enabled background processing policy

### Acceptance Criteria
- sync engine extracts the right fields from the right source connections
- stage tables are populated successfully
- failure in one source does not corrupt others
- job history and status are visible
- background processing remains enabled by policy
- integration tests pass

## Milestone 6: Hardening, Monitoring, and Documentation
### Required Outcomes
- source-aware filtering/grouping in analysis
- diagnostics and observability
- structured logs
- admin troubleshooting support
- complete docs and runbooks
- performance validation
- final hardening

### Acceptance Criteria
- analysts can compare or filter by source where relevant
- sync freshness is visible
- job failures are diagnosable
- documentation is complete
- all tests pass
- final implementation is production-ready
