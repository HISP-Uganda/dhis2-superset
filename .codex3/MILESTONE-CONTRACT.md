# MILESTONE-CONTRACT.md
## Milestone Delivery Contract

## Milestone 1: Staging Engine Foundation
Required outcomes:
- engine abstraction layer
- platform settings model
- migration support
- single-active-engine policy
- compatibility-safe baseline

Acceptance:
- migrations succeed
- engine selection model exists
- no regressions in core flows
- tests pass

## Milestone 2: DuckDB Integration
Required outcomes:
- embedded DuckDB staging adapter
- storage path/file strategy
- staging object creation
- serving object registration
- tests

Acceptance:
- DuckDB can be selected as active engine
- staged datasets load into DuckDB
- serving objects are usable
- tests pass

## Milestone 3: ClickHouse Integration
Required outcomes:
- ClickHouse staging adapter
- connection/config validation
- stage/serving object strategy
- tests

Acceptance:
- ClickHouse can be selected as active engine
- staged datasets load into ClickHouse
- serving objects are usable
- tests pass

## Milestone 4: UI and Workflow Integration
Required outcomes:
- Admin UI for engine selection
- Admin UI for engine config and validation
- Dataset settings integration showing active engine
- background load behavior aligned to active engine
- tests

Acceptance:
- admins can select one active engine
- datasets respect active engine
- tests pass

## Milestone 5: Retention Policies
Required outcomes:
- retention settings
- cleanup job logic
- reporting/preview/status
- tests

Acceptance:
- retention policies can be configured
- cleanup works safely
- tests pass

## Milestone 6: Switching, Hardening, and Documentation
Required outcomes:
- engine-switch semantics
- rebuild/stale-marking behavior
- docs/runbooks
- performance and regression validation

Acceptance:
- engine switch is safe and explicit
- docs complete
- all relevant tests pass
