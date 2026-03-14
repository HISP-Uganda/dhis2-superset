# NON-REGRESSION-RULES.md
## Non-Regression Rules

1. Working Superset features must not be broken
2. Existing dataset creation behavior must remain stable for non-staged paths
3. Existing DHIS2 and non-DHIS2 flows must remain functional
4. Admin UI changes must not degrade other settings behavior
5. Engine integration must not destabilize chart creation or dashboard rendering
6. Add regression-sensitive tests around:
   - engine selection
   - dataset creation with active engine
   - engine switch handling
   - retention cleanup
   - existing non-staged flows
