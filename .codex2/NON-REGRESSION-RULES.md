# NON-REGRESSION-RULES.md
## Non-Regression and Stability Rules

1. Existing working features MUST NOT be broken.
2. UI modernization must not degrade existing functional workflows.
3. If a current feature works, retain it unless replacing it with a verified backward-compatible improvement.
4. All critical flows touched by the work must have regression-sensitive tests.
5. Any failing regression must be fixed before milestone completion.
6. Do not merge cosmetic modernization that destabilizes the product.
7. Verify:
   - database creation/editing
   - dataset creation/editing
   - chart creation/editing
   - dashboard browsing/editing
   - public dashboard rendering
   - theme application
   - DHIS2-specific paths
   - non-DHIS2 paths
   - staging-enabled paths where applicable
