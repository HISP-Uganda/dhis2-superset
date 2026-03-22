# Phase 6 — Superset Embed Blocks

Implement custom blocks for Superset charts, dashboards, KPI panels, and safe embed behavior. inside the existing Superset codebase.

Required behavior:
- Audit the repository first and map existing implementation relevant to this phase.
- Preserve working code and enhance it instead of rewriting without cause.
- Do not ask for confirmation or approvals.
- Use expert judgment to choose the best architecture and lowest-risk path.
- Keep prompts, comments, and output concise.
- Keep user management simple.
- Implement only this phase.
- Add/update tests for this phase.
- Run tests and fix failures before stopping.
- Document completed work and remaining known gaps for later phases only if strictly relevant.

Phase objective:
custom blocks for Superset charts, dashboards, KPI panels, and safe embed behavior.

Specific requirements:
- Build on existing Superset embedding utilities.
- Add chart block, dashboard block, and KPI block at minimum.
- Respect Superset permissions and anonymous/public behavior.
- Provide stable fallbacks and loading states.
- Keep embed configuration editor-friendly, not overly technical.

Testing requirements:
- Tests for chart/dashboard lookup.
- Permission-aware rendering tests.
- Missing-resource fallback tests.
- Responsive container tests.

Completion rule:
Do not begin any later-phase feature. Stop after this phase is implemented, tested, passing, and documented.
