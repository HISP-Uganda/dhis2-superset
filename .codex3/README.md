# Codex Agent Package
## Local Staging Engines: DuckDB + ClickHouse for Superset

This package defines the implementation plan, contracts, and execution prompt for integrating a platform-wide Local Staging DB capability in the customized Superset platform.

## Scope
- DuckDB integration for embedded/in-process local staging
- ClickHouse integration for high-volume analytical local staging
- platform-wide staging engine selection (one active engine at a time)
- dataset-creation behavior that respects the active staging engine
- admin settings for engine selection and retention policies
- non-regression and test-gated milestone delivery

## Core policy
- DuckDB should be embedded within Superset where possible
- ClickHouse should be integrated as a supported staging engine using its supported client/dialect model
- Only one platform-wide staging engine may be active at a time
- The active staging engine must be used during staged dataset creation and loading
- Admins must be able to configure retention policies if enabled

## Included files
- IMPLEMENTATION-PLAN.md
- EXECUTION-CONTRACT.md
- MILESTONE-CONTRACT.md
- ENGINE-SELECTION-ARCHITECTURE.md
- ADMIN-SETTINGS-REQUIREMENTS.md
- RETENTION-POLICY-REQUIREMENTS.md
- NON-REGRESSION-RULES.md
- CODEX-EXECUTION-PROMPT.md
