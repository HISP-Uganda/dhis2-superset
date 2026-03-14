# EXECUTION-CONTRACT.md
## Formal Delivery Contract for Claude
### Project: Multi-DHIS2 Superset Integration with Staging Storage

## 1. Contract Purpose
This contract defines the binding execution rules for implementing the multi-DHIS2 federated integration and staging architecture in the customized Superset repository.

## 2. Binding Obligation
By proceeding, the implementation agent agrees to deliver a fully integrated, tested, and documented solution that satisfies the defined functional, technical, operational, performance, UI/UX, and backward compatibility requirements.

No milestone or component may be declared complete unless its required deliverables, tests, and supporting documentation are complete.

## 3. Mandatory Delivery Requirements
The agent MUST deliver all of the following:
1. support for multiple DHIS2 instances under one logical Superset DHIS2 database
2. per-instance authentication and connection testing
3. multi-instance dataset variable selection
4. variable-to-instance mapping persistence
5. local staging storage for dataset data
6. background synchronization jobs
7. staged-data-first chart and visualization querying
8. lineage preservation
9. backward compatibility with single-instance setups
10. observability and diagnostics
11. schema migrations
12. test coverage
13. technical documentation
14. migration documentation
15. operational runbook
16. schedule configuration in dataset creation UI
17. auto-enabled non-disableable background processing

## 4. Quality Threshold
The implementation is only acceptable if it is:
- production-ready
- secure
- maintainable
- extensible
- test-covered
- operationally diagnosable
- backward compatible where required
- clearly documented
- UI/UX polished and intuitive
- performant for large staged datasets

Prototype-grade or partial implementation is not acceptable.

## 5. Mandatory Technical Constraints
The agent MUST NOT:
- expose credentials in logs, APIs, or UI payloads
- use live DHIS2 fetches as the default chart execution mode
- lose source-instance lineage
- break legacy one-instance support
- introduce destructive schema changes without controlled migration
- ship without tests
- ship without documentation
- hardcode the number of supported DHIS2 instances
- merge data from separate instances without source attribution
- ask for approval on already-scoped implementation decisions
- progress to the next milestone with failing tests
- disable background processing for staged datasets

## 6. Execution Behavior Constraint
The agent MUST:
- make professional decisions without asking for approval
- stay aligned to the defined target
- complete the current milestone fully
- pass all tests before moving forward
- optimize staged storage for large query workloads
- ensure the dataset creation flow includes schedule configuration and auto-enabled processing behavior

## 7. Completion Definition
The contract is fulfilled only when the codebase supports:
- multi-instance DHIS2 configuration
- cross-instance dataset construction
- instance-tagged variables
- local staging
- background refresh
- staged querying
- triangulation support
- large-scale staged query optimization
- schedule configuration from dataset creation UI
- auto-enabled non-disableable background processing
- passing tests
- complete docs
- migration safety
