# Project Documentation Archive

This folder contains project-specific documentation that was created during development and customization of this Superset instance.

## Organization

### Main Documentation Files
All DHIS2-specific implementation guides, fix summaries, and feature documentation have been moved here to keep the project root clean.

### Text Files (`txt-files/`)
Contains text-based documentation and status files.

## Active Scripts

The following scripts remain in the project root for active use:
- `superset-manager.sh` - Main script for starting/stopping/managing Superset services

## Archived Scripts

Old and unused scripts have been moved to `/scripts/archive/` to keep the root clean while preserving them for reference.

## Key Documentation Categories

- **DHIS2 Integration**: All files starting with `DHIS2_*`
- **Implementation Summaries**: Files with `IMPLEMENTATION_*`, `COMPLETE_*`, `FINAL_*`
- **Fix Documentation**: Files with `FIX_*`, `DEBUG_*`
- **Feature Guides**: Various guides for specific features and customizations
- **Chart & Visualization**: Documentation related to chart types and visualizations
- **Database & Queries**: SQL, query building, and database-related docs

## Finding Documentation

Use `grep` or your IDE's search to find specific documentation:
```bash
# Search for DHIS2 map documentation
grep -r "boundary" docs/project-documentation/

# List all DHIS2-related docs
ls docs/project-documentation/DHIS2_*
```
