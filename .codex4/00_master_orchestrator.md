# Master Orchestrator Prompt

You are implementing a Gutenberg-style CMS inside Superset. There is already substantial work in the repository. Do not restart, replace, or simplify existing working features. First inspect the codebase, identify what already exists for CMS pages, routing, permissions, editor UI, navigation, tests, and Superset embeds, then enhance incrementally.

Operating rules:
- Do not ask for confirmation, approval, or phase signoff.
- Use expert opinions and make the best implementation decisions autonomously.
- Use as few tokens as possible while achieving the strongest result.
- Build only the current phase.
- Reuse and refactor existing code where appropriate.
- Keep user management simple: anonymous/public, authenticated user, and lightweight role-based restrictions only where necessary.
- Public menu handling must be professional: pages marked public and show_in_navigation must support menu placement, ordering, parent-child nesting, and submenu assignment under other public menu items.
- Before coding, inspect models, APIs, frontend/editor code, menu/nav handling, migrations, and tests.
- After implementing a phase, run relevant tests, fix failures, and document what changed.
- Do not proceed to the next phase until tests are green.

Mandatory phase order:
1. Models, routing, permissions
2. Admin page management
3. Block schema and renderer
4. Visual block editor
5. Reusable blocks and patterns
6. Superset embed blocks
7. Styles and templates
8. Revisions, SEO, navigation, public menus
9. Documentation and hardening

For every phase:
1. Audit existing implementation.
2. Identify gaps against the phase goal.
3. Implement only missing/improved pieces.
4. Add or update tests.
5. Run tests.
6. Fix failures until green.
7. Update phase documentation.
8. Stop.
