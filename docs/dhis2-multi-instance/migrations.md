# DHIS2 Multi-Instance Migration Guide

## Overview

The `2026_01_01_dhis2_multi_instance` Alembic migration introduces four new tables that power the multi-instance DHIS2 federation:

| Table | Purpose |
|---|---|
| `dhis2_instances` | Registry of DHIS2 server connections per logical database |
| `dhis2_staged_datasets` | Metadata for materialised datasets synced from DHIS2 |
| `dhis2_dataset_variables` | Per-variable source mapping (which variable from which instance) |
| `dhis2_sync_jobs` | Audit trail for background sync job executions |

All four tables are additive: no existing Superset tables are modified. The migration is designed to be safe for production systems running the previous single-instance DHIS2 connector.

---

## Running the Migration

### Prerequisites

- PostgreSQL 13+ (required for staging table DDL).
- Superset virtualenv activated.
- Database connection configured in `superset_config.py`.
- Celery workers **stopped** during the migration to avoid partial-state issues.

### Apply the migration

```bash
# From the repo root
superset db upgrade
```

This applies all pending Alembic migrations in order, including `2026_01_01_dhis2_multi_instance`.

Verify the new tables exist:

```bash
psql "$DATABASE_URL" -c "\dt dhis2_*"
```

Expected output:

```
             List of relations
 Schema |          Name             | Type  |  Owner
--------+---------------------------+-------+---------
 public | dhis2_dataset_variables   | table | superset
 public | dhis2_instances           | table | superset
 public | dhis2_staged_datasets     | table | superset
 public | dhis2_sync_jobs           | table | superset
```

### Create the staging schema

The migration does **not** create the `dhis2_staging` schema (physical staging tables are created on-demand when staged datasets are first created). If you want to pre-create it:

```sql
CREATE SCHEMA IF NOT EXISTS dhis2_staging;
GRANT ALL ON SCHEMA dhis2_staging TO superset;
```

---

## Backward Compatibility

### Legacy single-instance databases

Existing Superset `Database` records that were configured for DHIS2 (with credentials stored in `encrypted_extra`) continue to work after the migration. The legacy connector code (`superset/dhis2/api.py`) is not removed.

When a legacy database is first accessed via the new multi-instance APIs, the system attempts an automatic migration:

1. `migrate_legacy_instance(database_id)` reads `Database.encrypted_extra`.
2. It creates a `DHIS2Instance` record named `"default"` for that database.
3. The `is_single_instance_compat` property on the instance returns `True` for this sentinel name, allowing backward-compatible logic.

This migration is **non-destructive**: the original `encrypted_extra` data is not modified.

### Feature flag behaviour

No feature flag gates the new APIs. They are available to all authenticated users as soon as the migration is applied.

---

## Rollback Procedure

### Standard rollback (migration not yet applied to production)

```bash
superset db downgrade 2026_01_01_dhis2_multi_instance~1
```

This removes the four new tables and their indexes. No data loss occurs on existing Superset tables.

### Emergency rollback (migration applied to production)

If staged datasets have already been created, a downgrade will destroy all `dhis2_*` metadata rows. Back up first:

```bash
# Dump the DHIS2 tables before rolling back
pg_dump "$DATABASE_URL" \
  -t dhis2_instances \
  -t dhis2_staged_datasets \
  -t dhis2_dataset_variables \
  -t dhis2_sync_jobs \
  > dhis2_backup_$(date +%Y%m%d_%H%M%S).sql

# Then downgrade
superset db downgrade 2026_01_01_dhis2_multi_instance~1
```

Physical staging tables in `dhis2_staging.*` are **not** dropped by the Alembic downgrade. Drop them manually if needed:

```sql
-- List staging tables
SELECT tablename FROM pg_tables WHERE schemaname = 'dhis2_staging';

-- Drop each one
DROP TABLE IF EXISTS dhis2_staging.ds_1_anc_coverage;
-- ...

-- Drop the schema when empty
DROP SCHEMA IF EXISTS dhis2_staging;
```

### Restoring from backup after rollback

If you need to re-apply after a rollback:

```bash
superset db upgrade  # Re-apply the migration
psql "$DATABASE_URL" < dhis2_backup_<timestamp>.sql  # Restore data
```

---

## Post-Migration Checklist

After applying the migration to production:

- [ ] `superset db upgrade` completed with exit code 0.
- [ ] All four `dhis2_*` tables exist in PostgreSQL.
- [ ] Superset web server restarted.
- [ ] Celery workers restarted.
- [ ] `GET /api/v1/dhis2/instances/?database_id=1` returns HTTP 200.
- [ ] `GET /api/v1/dhis2/diagnostics/admin/summary` returns HTTP 200.
- [ ] Legacy dashboards using DHIS2 databases still render correctly.
- [ ] A test staged dataset can be created and synced successfully.
