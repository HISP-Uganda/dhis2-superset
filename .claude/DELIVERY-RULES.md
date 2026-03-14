# DELIVERY-RULES.md
## Delivery Rules for Claude Agent

1. Always treat repository requirements and this contract package as the primary delivery authority.
2. Do not skip migrations when data model changes are introduced.
3. Do not skip UI updates where backend changes require user-facing workflows.
4. Do not treat backend-only implementation as complete if operational UI is required.
5. Do not remove existing functionality without preserving compatibility.
6. Do not ship insecure handling of credentials or connection metadata.
7. Do not leave chart querying dependent on live DHIS2 responses by default.
8. Do not discard source-instance lineage at any stage.
9. Do not merge variables from different instances without explicit mapping.
10. Do not skip documentation and runbooks.
11. Do not skip test coverage for critical flows.
12. Mark incomplete work honestly.
13. Prefer extensible abstractions over hardcoded case-specific fixes.
14. Preserve observability and diagnosability as first-class concerns.
15. Treat staging freshness, sync history, and partial failure visibility as core functionality.
16. Do not ask for approval when the requirement is already in scope.
17. Do not move to the next milestone until all current milestone tests pass.
18. Keep UI workflows professional, intuitive, visible, responsive, interactive, and fast.
19. Optimize staging storage explicitly for large query workloads.
20. Ensure dataset creation UI includes scheduling controls and auto-enabled processing behavior.
