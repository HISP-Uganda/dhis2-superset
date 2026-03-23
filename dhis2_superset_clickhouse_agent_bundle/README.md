# DHIS2 Superset ClickHouse Refactor Agent Bundle

This bundle provides a comprehensive autonomous agent specification for refactoring the `HISP-Uganda/dhis2-superset` repository away from Python-driven serving-table materialization and into a ClickHouse-native staging and serving architecture optimized for Superset.

## Purpose

Use these documents to drive an autonomous code agent such as Gemini Code Agent, Codex, or another implementation-capable software agent.

## Intended outcome

- DHIS2 synchronization remains correct, reliable, and auditable.
- ClickHouse becomes the native engine for raw landing, staging, and serving.
- Superset uses PostgreSQL only for metadata.
- Superset charts, maps, and dashboards load as fast as possible.
- Public and authenticated dashboards both perform well.
- The old Python serving rebuild path is removed from the hot path.

## Included files

- `01_AGENT_MISSION.md`
- `02_CONTEXT_AND_GOALS.md`
- `03_CURRENT_STATE_AND_BOTTLENECKS.md`
- `04_TARGET_ARCHITECTURE.md`
- `05_MANDATORY_REQUIREMENTS.md`
- `06_IMPLEMENTATION_PLAN.md`
- `07_WORK_BREAKDOWN_AND_SEQUENCE.md`
- `08_CONTRACTS_AND_INTERFACES.md`
- `09_RULES_AND_GUARDRAILS.md`
- `10_ACCEPTANCE_CRITERIA.md`
- `11_TEST_AND_VALIDATION_PLAN.md`
- `12_OBSERVABILITY_AND_STATUS.md`
- `13_CONFIG_AND_DEPLOYMENT_REQUIREMENTS.md`
- `14_MIGRATION_AND_ROLLBACK.md`
- `15_RISKS_AND_DECISIONS.md`
- `16_GEMINI_CODE_AGENT_PROMPT.md`
- `17_EXECUTION_CHECKLIST.md`
- `18_DELIVERABLES_AND_OUTPUT_FORMAT.md`
- `19_CHANGE_CONTROL.md`
- `20_STATUS_TEMPLATE.md`

## How to use

1. Provide the contents of `16_GEMINI_CODE_AGENT_PROMPT.md` to the implementation agent.
2. Mount or attach the remaining markdown files as governing documentation.
3. Require the agent to follow all contracts, rules, and acceptance criteria.
4. Review implementation against the checklist and validation plan.

## Scope

This bundle is focused on the repository:

- `https://github.com/HISP-Uganda/dhis2-superset`

## Primary architectural rule

PostgreSQL stays metadata-only. ClickHouse becomes the analytical engine for both staging and serving. Superset must query ClickHouse serving marts only.
