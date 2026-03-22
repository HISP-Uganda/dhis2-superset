# Phase 2 — Admin Page Management

Implement professional admin UX for CMS page listing, creation, editing, filtering, and simple visibility management. inside the existing Superset codebase.

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
professional admin UX for CMS page listing, creation, editing, filtering, and simple visibility management.

Specific requirements:
- Enhance existing admin views first.
- Include title, slug, status, visibility, template, featured image if supported, and navigation controls.
- Add professional public menu controls: show in menu, menu label override, parent menu/page selector, sort order.
- Only public pages can be added to public menus; enforce this in validation and UI.
- UX should be clean and WordPress-like without cloning WordPress exactly.

Testing requirements:
- UI/component tests for page list and page form.
- API/integration tests for CRUD flows.
- Permission tests for admin/editor boundaries if applicable.
- Filter/search tests.

Completion rule:
Do not begin any later-phase feature. Stop after this phase is implemented, tested, passing, and documented.
