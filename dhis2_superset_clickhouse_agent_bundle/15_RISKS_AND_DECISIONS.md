# Risks and Decisions

## Major decisions
- Keep PostgreSQL metadata-only.
- Make ClickHouse authoritative for analytics.
- Use serving marts instead of relying on universal raw/staging access.
- Prefer incremental refresh over full rebuild.

## Key risks
- Hidden dependencies on old serving-table names or schemas.
- Existing dashboards may rely on wide virtual datasets.
- Multi-instance sync logic may have implicit assumptions.
- Map behavior may rely on runtime joins not yet documented.
- Config defaults may cause accidental fallback behavior.

## Required handling
- Document every intentional schema or dataset contract change.
- Preserve compatibility where practical.
- Add migration and fallback notes for dashboard owners.
- Add configuration validation and startup warnings.
