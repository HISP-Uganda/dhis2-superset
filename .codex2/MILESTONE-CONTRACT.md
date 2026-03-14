# MILESTONE-CONTRACT.md
## Milestone Delivery Contract

## Milestone 1: Foundation, Compatibility, and Design System
Required outcomes:
- define or refactor design tokens / theme tokens
- define application shell foundations
- define theme architecture
- define compatibility-safe model changes for DHIS2 Database multi-connection support
- define staging metadata abstractions where needed
- create migrations
- preserve compatibility

Acceptance criteria:
- migrations succeed
- current working features remain operational
- design system foundation exists
- compatibility tests pass

## Milestone 2: Navigation and Global UI Shell
Required outcomes:
- modernized global shell
- improved top/side navigation
- improved page headers and action zones
- improved empty/loading/error states
- responsive shell refinements

Acceptance criteria:
- navigation clarity improves
- shell remains stable
- no working feature regressions
- tests pass

## Milestone 3: Database and Dataset Workflow Cleanup
Required outcomes:
- Database-centric dataset creation workflow
- DHIS2 Database multi-connection configuration
- removal of duplicated DHIS2 source/instance selection logic
- improved loading/error/partial states
- improved workflow state management

Acceptance criteria:
- workflow is cleaner
- DHIS2 Database multi-connection behavior works
- non-DHIS2 flow still works
- tests pass

## Milestone 4: Staging and Serving Architecture
Required outcomes:
- raw stage and serving layer separation
- generic staging abstractions
- staged serving objects for charts
- optimized storage/indexing/partitioning strategy where needed
- schedule-aware background processing model

Acceptance criteria:
- staged datasets use local serving objects by default
- lineage is preserved
- tests pass

## Milestone 5: Public Dashboards and Theme System
Required outcomes:
- public dashboard shell
- layout presets and settings
- working platform themes
- dashboard/public theme layers
- professional blending of colors/backgrounds

Acceptance criteria:
- public dashboards look polished
- themes work coherently
- tests pass

## Milestone 6: Hardening, Regression, and Documentation
Required outcomes:
- regression cleanup
- performance refinements
- accessibility/responsiveness refinements
- updated docs, notes, and runbooks
- comprehensive validation

Acceptance criteria:
- all relevant tests pass
- working features remain intact
- docs are complete
- platform is production-ready
