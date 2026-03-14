# CODEX-EXECUTION-PROMPT.md
## Final Codex Execution Prompt

Read and obey the following files as binding implementation authority:

- `.codex/AGENT.md`
- `.codex/REQUIREMENTS-MANDATES.md`
- `.codex/EXECUTION-CONTRACT.md`
- `.codex/MILESTONE-CONTRACT.md`
- `.codex/DELIVERY-RULES.md`
- `.codex/ACCEPTANCE-CHECKLIST.md`
- `.codex/DATA-MODEL-RELATIONS.md`
- `.codex/STAGING-STORAGE-ARCHITECTURE.md`
- `.codex/DATASET-WORKFLOW-REFACTOR.md`
- `.codex/UI-MODERNIZATION-REQUIREMENTS.md`
- `.codex/VISUAL-DESIGN-SYSTEM.md`
- `.codex/THEME-ARCHITECTURE.md`
- `.codex/PUBLIC-DASHBOARD-LAYOUTS.md`
- `.codex/NON-REGRESSION-RULES.md`

These files are mandatory.

## Mission
Implement the complete enterprise-grade modernization for this customized Superset repository, covering:
- platform-wide UI modernization
- improved navigation and layout
- cleaner dataset and database workflows
- DHIS2 Database multi-connection support
- generic staged local storage/serving for supported sources where enabled
- public dashboard presentation settings
- comprehensive working themes
- strict non-regression behavior

## Critical non-negotiables
- do not ask for approval
- make sound professional decisions
- do not deviate from the target architecture and UX direction
- working features MUST NOT be broken
- do not progress to the next milestone until current milestone tests pass
- do not copy proprietary Power BI branding/assets
- do build an original UI with comparable or better enterprise BI polish
- colors, surfaces, and backgrounds must blend professionally
- keep the UI clean, visible, responsive, interactive, and fast
- keep the implementation production-grade
- include migrations, tests, docs, and runbooks

## Required behavioral direction
1. Use Database as the top-level user-facing concept in dataset creation.
2. Support multiple configured DHIS2 connections under one DHIS2 Database.
3. Remove duplicated DHIS2 source/instance selection logic from the main workflow.
4. Modernize the global shell and navigation.
5. Build a coherent theme system.
6. Add dynamic public dashboard layout settings.
7. Preserve backward compatibility and protect working features.

## Execution sequence
1. Read all required `.codex/*` files fully.
2. Inspect the current codebase and identify:
   - current shell/navigation/layout patterns
   - existing theme and styling behavior
   - DHIS2-specific models and dataset creation workflows
   - current Database model and workflow behavior
   - staging-related abstractions
   - public dashboard rendering behavior
   - current regression-sensitive functional areas
3. Produce a concise implementation plan aligned to the milestone contract.
4. Implement milestone by milestone.
5. For each milestone:
   - implement completely
   - run relevant tests
   - fix all failing tests
   - verify no important working features are broken
   - only then continue
6. Update documentation and operational notes continuously.
7. Continue until all acceptance criteria are satisfied.

## Quality target
The final result must feel like a best-in-class enterprise analytics platform:
- original
- polished
- calm
- visually coherent
- easy to navigate
- professional in color blending and backgrounds
- fast and responsive
- stable and non-regressive

Begin now.
