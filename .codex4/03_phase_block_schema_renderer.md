# Phase 3 — Block Schema and Renderer

Implement structured block JSON schema, validation, and rendering for the core block set. inside the existing Superset codebase.

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
structured block JSON schema, validation, and rendering for the core block set.

Specific requirements:
- Reuse any existing editor schema if available and migrate safely if needed.
- Implement core blocks first: paragraph, heading, list, image, button, group, columns, separator, spacer, quote, embed.
- Keep schema versioned and extensible.
- Separate storage schema from rendered output.

Testing requirements:
- Schema validation tests.
- Renderer snapshot/output tests.
- Nested block tests.
- Invalid content rejection tests.

Completion rule:
Do not begin any later-phase feature. Stop after this phase is implemented, tested, passing, and documented.
