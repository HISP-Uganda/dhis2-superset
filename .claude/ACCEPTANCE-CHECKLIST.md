# ACCEPTANCE-CHECKLIST.md
## Final Acceptance Checklist

### Multi-Instance Configuration
- [ ] One logical DHIS2 database supports multiple instances
- [ ] Per-instance create/edit/disable/delete works
- [ ] Connection testing works
- [ ] Secrets are handled securely

### Dataset Builder
- [ ] Variables can be selected from more than one DHIS2 instance
- [ ] Each variable stores source instance identity
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
- [ ] Variables are fetched from the correct source instance
- [ ] Partial failure handling works
- [ ] Job history is visible

### UI and UX
- [ ] Core workflows are intuitive and easy to understand
- [ ] UI is clean, professional, and responsive
- [ ] Key statuses and controls are clearly visible
- [ ] Interactive performance remains acceptable with large metadata lists

### Backward Compatibility
- [ ] Legacy one-instance setups still work
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
