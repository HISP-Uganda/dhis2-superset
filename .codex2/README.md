# Codex Prompt Package
## Enterprise Superset Modernization + Multi-Source Staging + Workflow Cleanup

This package contains a comprehensive Codex instruction set for implementing:

- professional platform-wide UI modernization
- cleaned-up dataset creation workflows
- multi-DHIS2 database support under one Superset Database definition
- generic local staging/storage for supported sources
- public dashboard layout settings
- comprehensive working themes
- strict non-regression and test-gated delivery rules

## Core non-negotiable direction

- Working features MUST NOT be broken.
- The implementation MUST preserve existing working behavior unless intentionally replaced with a backward-compatible improvement.
- UI color themes and backgrounds MUST blend professionally.
- The UI MUST be designed in an original, high-end enterprise BI style inspired by best-in-class analytics platforms such as Microsoft Power BI, but must not copy proprietary branding, trademarks, or exact visual assets.
- Prompts MUST be executed professionally without asking for approvals on already-defined requirements.
- Milestone progression is test-gated: all tests for the current milestone must pass before moving on.

## Included files

- `AGENT.md`
- `REQUIREMENTS-MANDATES.md`
- `EXECUTION-CONTRACT.md`
- `MILESTONE-CONTRACT.md`
- `DELIVERY-RULES.md`
- `ACCEPTANCE-CHECKLIST.md`
- `DATA-MODEL-RELATIONS.md`
- `STAGING-STORAGE-ARCHITECTURE.md`
- `DATASET-WORKFLOW-REFACTOR.md`
- `UI-MODERNIZATION-REQUIREMENTS.md`
- `VISUAL-DESIGN-SYSTEM.md`
- `THEME-ARCHITECTURE.md`
- `PUBLIC-DASHBOARD-LAYOUTS.md`
- `NON-REGRESSION-RULES.md`
- `CODEX-EXECUTION-PROMPT.md`

## Recommended repository location

Place under `.codex/`.

## Execution

Use `CODEX-EXECUTION-PROMPT.md` as the main execution instruction for Codex after placing all files under `.codex/`.
