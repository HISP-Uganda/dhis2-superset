# ACCEPTANCE-CHECKLIST.md
## Final Acceptance Checklist

### Multi-Source Staging
- [ ] Generic local staging framework exists for supported Superset sources
- [ ] DHIS2 remains supported under the generalized staging architecture
- [ ] Source lineage is preserved end-to-end

### DHIS2 Multi-Instance Configuration
- [ ] One logical DHIS2 database supports multiple instances
- [ ] Per-instance create/edit/disable/delete works
- [ ] Connection testing works
- [ ] Secrets are handled securely

### Dataset Builder
- [ ] Staged datasets can be created from supported source types
- [ ] Variables/fields/columns store source identity
- [ ] Duplicate naming ambiguity is handled
- [ ] Dataset editing preserves mappings
- [ ] Schedule can be configured from dataset creation UI
- [ ] Background processing is auto-enabled and not disableable

### Staging
- [ ] Local staging storage exists
- [ ] Staged records retain source lineage
- [ ] Stage storage is indexed and queryable
- [ ] Stage storage is optimized for large analytical workloads
- [ ] Superset charts use staged data by default

### Background Sync
- [ ] Manual refresh works
- [ ] Scheduled refresh framework exists
- [ ] Fields are extracted from the correct source connection
- [ ] Partial failure handling works
- [ ] Job history is visible

### UI and UX
- [ ] Core workflows are intuitive and easy to understand
- [ ] UI is clean, professional, and responsive
- [ ] Key statuses and controls are clearly visible
- [ ] Interactive performance remains acceptable with large metadata lists

### Backward Compatibility
- [ ] Legacy one-instance DHIS2 setups still work
- [ ] Migration path is safe
- [ ] Existing datasets remain functional where expected

### Quality
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] UI tests pass where applicable
- [ ] Documentation is complete
- [ ] Migration notes are complete
- [ ] Operational runbook is complete
- [ ] No milestone was progressed with failing tests
