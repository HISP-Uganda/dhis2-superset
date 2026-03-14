# Codex Agent Prompt Package
## Final Package: Multi-Source Superset Staging + Fast Local Storage

This package defines the final agent instructions for implementing a fast local staging/storage architecture in a customized Superset environment.

## Key update
Local staging/storage is **not limited to DHIS2**.

It MUST support:
- DHIS2 instances
- SQL databases added to Superset
- API-backed sources where supported by the repository architecture
- future source adapters through a generic source abstraction

The architecture therefore treats DHIS2 as an important source type, but not the only one.

## Included files
- `AGENT.md`
- `REQUIREMENTS-MANDATES.md`
- `EXECUTION-CONTRACT.md`
- `MILESTONE-CONTRACT.md`
- `DELIVERY-RULES.md`
- `ACCEPTANCE-CHECKLIST.md`
- `DATA-MODEL-RELATIONS.md`
- `STAGING-STORAGE-ARCHITECTURE.md`
- `CODEX-EXECUTION-PROMPT.md`

## Placement
Recommended repository location:
`.codex/`

## Execution
Read and use `CODEX-EXECUTION-PROMPT.md` as the main Codex execution instruction.
