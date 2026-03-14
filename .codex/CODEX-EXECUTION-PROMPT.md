# CODEX-EXECUTION-PROMPT.md
## Final Codex Execution Prompt
### Project: Fast Multi-Source Superset Staging and Local Analytical Storage

Read and obey the following files as binding implementation authority:
- `.codex/AGENT.md`
- `.codex/REQUIREMENTS-MANDATES.md`
- `.codex/EXECUTION-CONTRACT.md`
- `.codex/MILESTONE-CONTRACT.md`
- `.codex/DELIVERY-RULES.md`
- `.codex/ACCEPTANCE-CHECKLIST.md`
- `.codex/DATA-MODEL-RELATIONS.md`
- `.codex/STAGING-STORAGE-ARCHITECTURE.md`

## Your mission

Implement the complete fast local staging and analytical serving architecture for this Superset repository.

## Important clarification

Local staging/storage is NOT limited to DHIS2.

You MUST implement:
1. specialized support for federated multi-instance DHIS2
2. a generic local staging/storage framework that can support other databases/sources added to Superset where staging is enabled
3. a source-adapter-based architecture so staging is reusable beyond DHIS2

## Mandatory constraints

- do not ask for approval
- do not deviate from the target architecture
- do not progress to the next milestone until all current milestone tests pass
- keep the UI professional, intuitive, visible, responsive, interactive, and fast
- optimize local staging for large-scale querying with proper indexing and partitioning
- schedule background processing from dataset creation UI
- background processing must be auto-enabled and non-disableable for staged datasets
- preserve backward compatibility
- include migrations, tests, docs, and runbooks
- charts for staged datasets must use local serving objects by default
- preserve end-to-end source lineage
- keep DHIS2 support strong while generalizing the framework for other staged sources

## Execution sequence

1. Read all `.codex/*` files listed above
2. Analyze the current repository implementation and identify current DHIS2-specific logic, existing datasource abstractions, query paths, and dataset models
3. Produce a concise execution plan aligned to the milestone contract
4. Implement milestone by milestone
5. Run required tests for each milestone
6. Fix all failing tests before continuing
7. Continue until the scoped work is complete
8. Update relevant documentation and operational notes as part of each milestone

## Implementation target summary

The final implementation must provide:
- federated multi-DHIS2 support
- generic staged dataset support for supported Superset sources
- raw stage and serving layer separation
- optimized local storage for large datasets
- partitioning and indexing strategy
- sync job, load batch, and lineage metadata
- serving tables/views/materialized views for Superset
- auto-enabled scheduled background processing configured in the dataset creation UI
- production-grade UI/UX
- full tests, migrations, docs, and runbooks

Begin now.
