# REQUIREMENTS-MANDATES.md
## Comprehensive Mandatory Requirements for the Agent

## 1. Decision-Making Mandate
The agent MUST act with senior professional judgment and MUST NOT ask for approval on already-defined requirements, design direction, milestone progression within the test gate, or implementation details that can be resolved using sound engineering judgment.

## 2. Target Fidelity Mandate
The agent MUST remain aligned to the target architecture:
- multi-instance DHIS2 federation
- generic local staging/storage for supported Superset sources
- dataset-level source lineage preservation
- local staging-first analytics
- scheduled background processing from dataset creation UI
- auto-enabled non-disableable background processing
- optimized large-scale staged querying
- intuitive, professional, fast UI workflows

The agent MUST NOT drift into unrelated refactors or alternate architectures.

## 3. Test-Gated Execution Mandate
The agent MUST only move to the next milestone after:
- all milestone requirements are implemented
- all milestone tests are executed
- all milestone tests pass

Any failing test MUST be fixed before progression.

## 4. UI Mandate
The agent MUST deliver UI workflows that are:
- intuitive
- visible
- professional
- clean
- responsive
- interactive
- fast
- easy to understand

UI design MUST clearly expose:
- selected source connections / instances
- source lineage tags
- dataset freshness
- background processing status
- schedule details
- failure states
- loading states

## 5. Staging Performance Mandate
Local staging storage MUST be designed for large-scale analytical querying and high-throughput processing across supported source types.

The implementation MUST include:
- indexing on commonly filtered dimensions
- indexing on dataset and source lineage keys
- scalable table design
- efficient aggregation support
- query-plan-conscious schema design
- support for large data refresh operations without degrading query performance
- serving objects optimized for Superset charts and dashboards

Partitioning, clustering, materialized summaries, or equivalent mechanisms should be used where justified.

## 6. Background Processing Mandate
Background processing:
- MUST be schedulable from dataset creation UI
- MUST be auto-enabled for staged datasets
- MUST NOT be user-disableable
- MUST run against the correct source connection and dataset/field mapping
- MUST provide transparent status and execution history
- MUST handle partial failures safely
- MUST preserve staged data integrity

## 7. Generic Source Support Mandate
The local staging framework MUST NOT be restricted to DHIS2.
It MUST be designed so that:
- DHIS2 uses a specialized adapter on top of the generic staging framework
- SQL databases added to Superset can also use local staging
- future source adapters can be added cleanly

## 8. Professional Delivery Mandate
The agent MUST deliver:
- production-grade code
- passing tests
- migrations
- documentation
- runbooks
- observability
- backward compatibility

Prototype shortcuts are non-compliant.
