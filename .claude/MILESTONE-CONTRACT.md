# MILESTONE-CONTRACT.md
## Milestone Delivery Contract
### Project: Multi-DHIS2 Superset Integration with Staging Storage

## Milestone 1: Metadata Model, Migrations, and Compatibility
### Required Outcomes
- introduce logical DHIS2 database abstraction or equivalent extension
- introduce DHIS2 instance registry
- support multiple instances under one logical database
- define variable mapping metadata model
- define sync job metadata model
- define staging metadata registry
- define scheduling metadata/default behavior
- create schema migrations
- migrate existing one-instance configurations safely

### Acceptance Criteria
- legacy configuration remains functional
- multiple instances can be stored under one logical database
- scheduling defaults are modeled
- migrations run successfully
- compatibility tests pass
- docs updated

## Milestone 2: Instance Management and Authentication
### Required Outcomes
- backend APIs for instance CRUD
- per-instance auth model
- secure secret handling
- connection testing endpoints/services
- frontend UI to manage instances

### Acceptance Criteria
- admin can add, edit, disable, test, and remove instances
- auth failures are distinguishable from connectivity failures
- no secret leakage
- backend and UI tests pass
- operational notes updated

## Milestone 3: Multi-Instance Dataset Builder and Schedule Configuration
### Required Outcomes
- dataset builder supports selection of variables from multiple DHIS2 instances
- metadata browsing per instance
- source-instance tagging in saved dataset variables
- aliasing and ambiguity handling
- edit/update support for dataset definitions
- schedule configuration within dataset creation UI
- auto-enabled background processing with no disable option

### Acceptance Criteria
- a dataset can contain variables from multiple instances
- each variable stores its source instance
- ambiguous same-name variables are handled safely
- UI clearly shows source-instance identity
- schedule can be defined at dataset creation time
- background processing is automatically active
- tests pass

## Milestone 4: Staging Storage and Query Path
### Required Outcomes
- PostgreSQL-based staging storage
- stage table or equivalent normalized storage design
- staged data registered/queryable by Superset
- local staged data becomes chart query source by default
- large-data indexing and optimization strategy

### Acceptance Criteria
- staged tables can store dataset data from multiple instances
- source-instance lineage is retained in staged records
- queries can run against staged data
- charts default to staged querying
- performance-focused indexes exist
- large-data query plan considerations are implemented
- tests pass

## Milestone 5: Background Sync Engine
### Required Outcomes
- manual refresh
- scheduled refresh framework
- grouped fetch by DHIS2 instance
- normalized load into stage tables
- job status, row counts, errors, and durations
- partial failure handling
- enforced auto-enabled background processing policy

### Acceptance Criteria
- sync engine fetches the right variables from the right instances
- stage tables are populated successfully
- failure in one instance does not corrupt others
- job history and status are visible
- background processing remains enabled by policy
- integration tests pass

## Milestone 6: Triangulation, Monitoring, Hardening, and Documentation
### Required Outcomes
- source-instance-aware filtering/grouping in analysis
- diagnostics and observability
- structured logs
- admin troubleshooting support
- complete docs and runbooks
- performance validation
- final hardening

### Acceptance Criteria
- analysts can compare across source instances
- sync freshness is visible
- job failures are diagnosable
- documentation is complete
- all tests pass
- final implementation is production-ready
