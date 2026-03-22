# Superset Gutenberg CMS Codex Prompts v2

Run strictly in order:
1. 00_master_orchestrator.md
2. 01_phase_models_routing_permissions.md
3. 02_phase_admin_page_management.md
4. 03_phase_block_schema_renderer.md
5. 04_phase_visual_block_editor.md
6. 05_phase_reusable_blocks_patterns.md
7. 06_phase_superset_embed_blocks.md
8. 07_phase_styles_templates.md
9. 08_phase_revisions_seo_navigation.md
10. 09_phase_docs_hardening.md

Rules enforced in every prompt:
- Do not ask for confirmation or approvals.
- Inspect existing implementation first and enhance it.
- Keep user management simple.
- Use expert judgment to choose the best path.
- Minimize token usage while maximizing implementation quality.
- Run tests for the active phase and fix failures before stopping.
- Do not start the next phase until tests pass.
- Public page menu handling is required: pages marked public and menu-enabled must support menu/submenu placement.
