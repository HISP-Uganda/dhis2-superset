# CODEX-EXECUTION-PROMPT.md
## Final Codex Execution Prompt

Read and obey these files as binding implementation authority:
- `.codex/IMPLEMENTATION-PLAN.md`
- `.codex/EXECUTION-CONTRACT.md`
- `.codex/MILESTONE-CONTRACT.md`
- `.codex/ENGINE-SELECTION-ARCHITECTURE.md`
- `.codex/ADMIN-SETTINGS-REQUIREMENTS.md`
- `.codex/RETENTION-POLICY-REQUIREMENTS.md`
- `.codex/NON-REGRESSION-RULES.md`

Implement a platform-wide Local Staging DB capability for this customized Superset repository with support for DuckDB and ClickHouse.

Mandatory requirements:
1. Support DuckDB as an embedded/in-process staging engine where possible
2. Support ClickHouse as a high-performance staging engine integrated through its supported client/dialect path
3. Allow admins to enable Local Staging platform-wide
4. Allow admins to choose exactly one active staging engine at a time
5. Ensure the active staging engine is automatically used during staged dataset creation and data loading
6. Add Admin UI and Dataset Settings behavior for engine visibility and management
7. Add retention policy settings and cleanup behavior if enabled
8. Do not break working features
9. Do not ask for approval on already-defined requirements
10. Do not progress milestone-to-milestone with failing tests

Execution sequence:
1. Inspect current staging/local-loading architecture and current Admin settings patterns
2. Design the staging-engine abstraction and single-active-engine settings model
3. Implement migrations and compatibility-safe settings/models
4. Implement DuckDB adapter and tests
5. Implement ClickHouse adapter and tests
6. Implement Admin UI and Dataset Settings integration
7. Implement retention policies and cleanup
8. Run all relevant tests for each milestone and fix failures before proceeding
9. Complete documentation and operational notes

Quality bar:
- production-grade
- non-regressive
- explicit and safe engine switching
- coherent admin UX
- clear dataset behavior
- documented operational semantics

Proceed now.
