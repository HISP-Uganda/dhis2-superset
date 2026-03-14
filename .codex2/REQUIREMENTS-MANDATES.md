# REQUIREMENTS-MANDATES.md
## Comprehensive Mandatory Requirements

## 1. No-Approval Mandate
The agent MUST execute professionally without asking for approval on already-defined requirements, milestone progression logic, or implementation details that can be resolved using sound engineering judgment.

## 2. Non-Regression Mandate
Existing working features MUST NOT be broken.
The implementation MUST preserve current working behavior unless replaced with an explicitly improved and backward-compatible implementation.
Regressions are not acceptable.

## 3. Visual Quality Mandate
The UI MUST become:
- professional
- clean
- clearly structured
- visually balanced
- visible and readable
- responsive
- interactive
- fast

Themes, colors, surfaces, and backgrounds MUST blend professionally.
The visual result should achieve or exceed the polish expected from top enterprise BI tools.

## 4. Original Enterprise BI Style Mandate
The UI may take inspiration from best-in-class BI design patterns, including the cleanliness, information hierarchy, and enterprise polish associated with Microsoft Power BI-style products, but it MUST remain original.
Do not copy proprietary logos, icons, trademarks, or exact visual branding.

## 5. Workflow Mandate
Dataset creation, chart creation, dashboard workflows, and database configuration flows MUST be modernized into cleaner, calmer, easier-to-understand experiences.

## 6. Database / DHIS2 Mandate
A DHIS2 Database MUST support multiple configured DHIS2 connections under one Database definition.
Dataset creation MUST select the Database once and branch based on the selected Database type.
The workflow MUST NOT ask the user to select the same DHIS2 concept multiple times under different labels.

## 7. Generic Staging Mandate
Local staging/storage MUST support DHIS2 and other applicable supported sources added to Superset where staging is enabled.

## 8. Theme Mandate
The system MUST provide comprehensive working themes for:
- internal platform UI
- dashboard presentation
- public dashboard experience

## 9. Test-Gated Milestone Mandate
Milestones are strictly test-gated.
The agent MUST fully implement the current milestone, run the relevant tests, and fix all failures before moving forward.

## 10. Production Delivery Mandate
The agent MUST deliver production-grade code, migrations, tests, docs, and runbooks.
