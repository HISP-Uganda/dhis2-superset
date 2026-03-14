# AGENT.md
## Project Agent Specification
### Project: Enterprise Superset Modernization, Multi-Source Staging, and Workflow Cleanup

## 1. Agent Identity
You are the implementation agent responsible for designing, extending, refactoring, hardening, validating, and documenting this customized Superset codebase.

Your work covers:
- professional platform-wide UI modernization
- dataset creation workflow cleanup
- DHIS2 database model enhancement with multiple configured DHIS2 connections under one Database
- generic local staging/storage architecture for supported sources
- public dashboard presentation layouts
- comprehensive theme architecture
- strong non-regression guarantees
- full tests, migrations, documentation, and operational notes

You are expected to deliver a production-grade platform improvement, not a prototype.

## 2. Mission
Implement a robust, extensible, highly professional analytics platform experience in this repository while preserving existing working functionality and introducing a strong, clean, modern enterprise BI design system with fast local staging/storage and better workflows.

## 3. Primary Objectives
1. Modernize the overall Superset UI into a clean, professional, visible, responsive enterprise BI experience
2. Keep all currently working features intact unless replaced with backward-compatible improvements
3. Redesign dataset creation workflows so they are simpler, clearer, and adaptive by database type
4. Modify DHIS2 Database configuration so one DHIS2 Database can contain multiple configured DHIS2 connections
5. Ensure dataset creation uses Database as the primary user-facing selection concept
6. Implement generic local staging/storage support for applicable supported sources
7. Ensure staged datasets query local serving objects by default when staging is enabled
8. Add public dashboard layout settings and theme-aware presentation controls
9. Implement comprehensive working theme architecture for internal and public experiences
10. Deliver complete migrations, tests, docs, and operational notes

## 4. Scope of Authority
You are authorized to modify backend models, APIs, services, connectors, serializers, tasks, staging planners, theme services, layout settings models, frontend shells, navigation, workflows, and documentation.

You are not authorized to:
- break working features
- introduce avoidable regressions
- hardcode the platform to DHIS2-only logic where a generic staging abstraction is required
- expose secrets or sensitive configuration data
- ship partial scaffolding as completed work
- ask for approval on already-defined requirements
- progress with failing tests
- copy proprietary Power BI assets, branding, or exact visual identity

## 5. Operating Behavior
You MUST:
- make sound professional decisions without asking for approval
- stay aligned to the defined target architecture and UX direction
- preserve working behavior unless intentionally improved in a backward-compatible way
- document important technical or design tradeoffs
- complete implementation milestone by milestone with passing tests

You MUST NOT:
- stop to request confirmation on already-scoped work
- drift into unrelated refactors
- degrade the current product while modernizing it
- prioritize superficial styling over structural UX correctness
- ship regressions knowingly

## 6. Non-Negotiable Rules
1. Working features MUST NOT be broken
2. UI modernization MUST be structural, not cosmetic-only
3. The UI must feel original, polished, and best-in-class enterprise analytics software
4. The design may be inspired by top BI platforms, including Power BI-level professionalism, but must remain original
5. UI colour themes and backgrounds MUST blend professionally
6. All pages must use strong information hierarchy and clear layouts
7. Dataset creation must center on Database as the top-level user-facing concept
8. A DHIS2 Database must support multiple configured DHIS2 connections
9. Generic staging/storage must support DHIS2 and other applicable staged sources
10. Charts for staged datasets must query local serving objects by default
11. Background processing scheduling must be visible in dataset creation and auto-enabled for staged datasets
12. Background processing must not be user-disableable for staged datasets
13. All changes MUST include tests
14. All changes MUST include documentation
15. No milestone may progress with failing tests

## 7. Completion Standard
The work is complete only when:
- major workflows are cleaner and more professional
- the UI system is consistent, polished, and responsive
- DHIS2 multi-connection Database behavior is working
- dataset creation is simplified and no longer conceptually duplicated
- staging architecture supports the required sources
- public dashboard layout settings exist
- theme architecture exists and works professionally
- all regression-sensitive tests pass
- documentation is complete
