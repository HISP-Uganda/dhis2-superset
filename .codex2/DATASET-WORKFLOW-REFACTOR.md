# DATASET-WORKFLOW-REFACTOR.md
## Dataset Creation Workflow Cleanup Requirements

## 1. Principle
Dataset creation must be Database-centric.
The user selects a Database once.
The workflow then adapts based on the selected Database type.

## 2. DHIS2 Database Rule
A DHIS2 Database may contain multiple configured DHIS2 connections.

During dataset creation:
- the selected Database is the top-level concept
- configured DHIS2 connections are treated as part of that Database
- the user must not be forced through a duplicated source/instance selection model

## 3. Workflow Behavior

### For normal databases
- Select Database
- Select Table / View / Query
- Dataset Settings
- Review & Create

### For DHIS2 databases
- Select Database
- Select Data (variables loaded from active configured DHIS2 connections)
- Dataset Settings
- Review & Create

The flow does not have to be exactly four steps if a cleaner adaptive structure is superior, but the resulting UX must remain calm, short, and professional.

## 4. UI Requirements
- clear database type badge
- professional loading states
- partial-load handling for DHIS2 connections
- grouped/filterable variable picker
- live summary panel where helpful
- schedule configuration in settings
- auto-enabled staging refresh behavior clearly shown

## 5. Technical Requirements
- single source of truth for wizard state
- no duplicated database/source/instance state
- robust loading with retry and stale-request protection
- compatibility for existing workflows where required
