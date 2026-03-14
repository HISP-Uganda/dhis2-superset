# ACCEPTANCE-CHECKLIST.md
## Final Acceptance Checklist

### Non-Regression
- [ ] Existing working features are still working
- [ ] No critical regressions were introduced
- [ ] Backward compatibility is preserved where required

### UI Modernization
- [ ] Global shell is cleaner and more professional
- [ ] Navigation is clearer and easier to use
- [ ] Major pages have better information hierarchy
- [ ] Colors and backgrounds blend professionally
- [ ] UI feels like a polished enterprise BI platform
- [ ] The visual system is original and not a clone of proprietary branding

### Workflow Improvements
- [ ] Dataset creation is cleaner and Database-centric
- [ ] DHIS2 duplicated source/instance logic is removed from the main flow
- [ ] Non-DHIS2 dataset creation still works
- [ ] Loading/error/partial states are professional and clear

### DHIS2 Database Enhancement
- [ ] One DHIS2 Database can contain multiple configured DHIS2 connections
- [ ] Existing single-connection setups remain supported
- [ ] Variables can be loaded across active configured connections where required

### Staging / Serving
- [ ] Generic staging framework exists for applicable staged sources
- [ ] Staged datasets use local serving objects by default
- [ ] Storage/indexing/lineage behavior is implemented appropriately

### Themes and Public Dashboards
- [ ] Theme architecture works for platform and public dashboards
- [ ] Public dashboard layout settings exist
- [ ] Public dashboard experience is polished and professional

### Quality
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] UI tests pass where applicable
- [ ] Docs and runbooks are complete
- [ ] No milestone was progressed with failing tests
