# Phase 1 — Models, Routing, Permissions

Implement CMS models, migrations, slug routing, page visibility, publish states, and lightweight access control. inside the existing Superset codebase.

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
CMS models, migrations, slug routing, page visibility, publish states, and lightweight access control.

Specific requirements:
- Build on existing CMS/page models if present.
- Support visibility: public, authenticated, optional simple role-based.
- Ensure dynamic page routing by slug.
- Add fields for menu handling now if missing: show_in_navigation, menu_title, parent_page_id, sort_order.
- Keep menu fields compatible with future submenu rendering.
- Avoid overcomplicated user/group systems.

Testing requirements:
- Model tests for CMS page fields, slug uniqueness, publish/archive states.
- API/service tests for create, update, list, and access rules.
- Route tests for public pages, authenticated pages, and restricted pages.
- Migration tests or migration validation where the repo standard supports it.

Completion rule:
Do not begin any later-phase feature. Stop after this phase is implemented, tested, passing, and documented.
