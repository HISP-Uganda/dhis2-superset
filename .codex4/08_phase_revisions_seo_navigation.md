# Phase 8 — Revisions, SEO, Navigation

Implement revisions, preview, SEO metadata, navigation integration, and professional public menu/submenu handling. inside the existing Superset codebase.

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
revisions, preview, SEO metadata, navigation integration, and professional public menu/submenu handling.

Specific requirements:
- Implement revision history, restore, duplicate, and preview.
- Add SEO fields and rendering.
- Finish professional public menu handling:
  - public pages with show_in_navigation=true appear in public menus
  - parent-child nesting for submenu support
  - menu ordering
  - menu title override
  - hidden pages excluded from menus
  - non-public pages never appear in public menus
- If the codebase already has navigation models, integrate instead of duplicating.
- Keep navigation logic simple and maintainable.

Testing requirements:
- Tests for revision creation and restore.
- Preview authorization tests.
- SEO/meta rendering tests.
- Navigation visibility tests.
- Public menu/submenu tree tests.

Completion rule:
Do not begin any later-phase feature. Stop after this phase is implemented, tested, passing, and documented.
