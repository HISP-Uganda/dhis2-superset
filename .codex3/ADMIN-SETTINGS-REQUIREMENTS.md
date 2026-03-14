# ADMIN-SETTINGS-REQUIREMENTS.md
## Admin UI and Settings Requirements

## 1. Platform-wide local staging settings
Admins must be able to configure:
- Enable Local Staging: on/off
- Active Staging Engine: DuckDB or ClickHouse
- Engine configuration section
- Validation / test button
- Current health/status
- Storage usage summary
- Retention policy enablement and configuration

## 2. DuckDB settings
Provide fields for:
- storage path
- database file strategy
- temp/work path if needed
- maintenance/compaction settings if exposed
- validation controls

## 3. ClickHouse settings
Provide fields for:
- host
- port
- database/schema
- username
- secret/credential reference
- secure/http options as needed
- validation controls

## 4. Dataset settings
When local staging is enabled:
- show the active staging engine clearly
- show that local staging data loading will use the active engine
- do not present conflicting multi-engine options
- show retention implications if useful
- keep background processing consistent with active engine behavior

## 5. UX quality
The admin settings UI must be:
- professional
- clear
- safe
- explicit about impact
- non-destructive by default
