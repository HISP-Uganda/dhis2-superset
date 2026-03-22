# Phase 4 — Visual Block Editor

Implement visual editor capabilities for block insertion, ordering, nesting, editing, previewing, and autosave. inside the existing Superset codebase.

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
visual editor capabilities for block insertion, ordering, nesting, editing, previewing, and autosave.

Specific requirements:
- Enhance current editor implementation if one exists.
- Use concise, efficient UI flows.
- Support desktop/tablet/mobile preview modes if feasible in the existing stack.
- Keep the editor modular for later custom blocks.

Testing requirements:
- Frontend component tests for inserter and inspector.
- State tests for insert/reorder/update/remove.
- Autosave tests.
- End-to-end happy-path editing test if the stack already supports it.

Completion rule:
Do not begin any later-phase feature. Stop after this phase is implemented, tested, passing, and documented.
