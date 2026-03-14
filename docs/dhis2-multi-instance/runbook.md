# DHIS2 Multi-Instance Operational Runbook

This runbook covers day-to-day administration of the DHIS2 multi-instance federation. All API examples use `curl` with a valid Superset session cookie or bearer token.

---

## 0. Metadata Architecture

DHIS2 staging now writes through two metadata layers:

- Legacy compatibility tables: `dhis2_instances`, `dhis2_staged_datasets`, `dhis2_dataset_variables`, `dhis2_sync_jobs`
- Generic staged-source tables: `staged_sources`, `dhis2_logical_databases`, `staged_datasets`, `staged_dataset_fields`, `sync_jobs`, and related observability tables

The DHIS2 APIs remain backward compatible, but new staged-source features should treat the generic staged-source tables as the canonical lineage model.

The main mapping rules are:

- one Superset DHIS2 database connection becomes one `dhis2_logical_databases` row
- each DHIS2 instance links to that logical database via `logical_database_id`
- each staged dataset mirrors into `staged_datasets`
- each dataset variable mirrors into `staged_dataset_fields`
- each DHIS2 sync job mirrors into generic `sync_jobs` and `sync_job_sources`

This means diagnostics, lineage, and future non-DHIS2 staged sources can share the same metadata graph.

In addition to dataset staging, DHIS2 metadata now has its own staged background pipeline:

- a newly created or updated DHIS2 Database queues a metadata snapshot refresh after commit
- creating, updating, or deleting a configured DHIS2 connection also queues a metadata snapshot refresh for the owning Database
- the background `DHIS2Preloader` performs scheduled staged metadata refreshes for all DHIS2 Databases
- metadata snapshots are stored in `source_metadata_cache` and power the dataset wizard and DHIS2 map boundary lookups without requiring live DHIS2 metadata requests in the UI path

---

## 1. Managing Configured DHIS2 Connections

**Via the API:**

```bash
curl -X POST /api/v1/dhis2/instances/ \
  -H "Content-Type: application/json" \
  -d '{
    "database_id": 1,
    "name": "Uganda HMIS",
    "url": "https://hmis.health.go.ug",
    "auth_type": "basic",
    "username": "api_user",
    "password": "••••••••"
  }'
```

**Via the UI:** open the target DHIS2 Database in the Database modal and use the **Configured Connections** tab. That tab now owns the named DHIS2 endpoints under the selected Database, including:

- connection name
- base URL
- auth type and credentials
- active flag
- display order
- persisted last-test status

The legacy **Settings > DHIS2 Instances** screen remains available for admin diagnostics and direct maintenance.

**Required fields:** `database_id`, `name`, `url`.
**Auth types:** `basic` (username + password) or `pat` (Personal Access Token).

After adding a configured connection, test connectivity:

```bash
curl -X POST /api/v1/dhis2/instances/<id>/test
```

A successful response returns `"success": true` with a `response_time_ms` value, and the result is now persisted back onto the configured connection metadata for later diagnostics.

After the Database or configured connection is saved, the background metadata service starts staging the connection metadata locally. The dataset wizard will read from this staged metadata and show a professional `metadata is being prepared in local staging` state until the first snapshot is ready.

The same Database modal now exposes a `Local metadata staging` card for saved DHIS2 Databases. Use that card to inspect variable, org-unit, boundary, and hierarchy staging counts, see the last refresh timestamp, and trigger `Refresh staged metadata` without leaving the Database UI.

---

## 2. Creating a Staged Dataset

A staged dataset defines which variables to fetch and how often.

```bash
curl -X POST /api/v1/dhis2/staged-datasets/ \
  -H "Content-Type: application/json" \
  -d '{
    "database_id": 1,
    "name": "ANC Coverage 2024",
    "schedule_cron": "0 2 * * *",
    "schedule_timezone": "Africa/Kampala",
    "dataset_config": {
      "periods": ["LAST_12_MONTHS"],
      "org_units": ["LEVEL-3"]
    }
  }'
```

This creates the metadata row and provisions the physical staging table. Note the returned `id` and `staging_table_name`.

**Add variable mappings** to tell the dataset which DHIS2 data elements to fetch from which instance:

```bash
curl -X POST /api/v1/dhis2/staged-datasets/<dataset_id>/variables \
  -H "Content-Type: application/json" \
  -d '{
    "instance_id": 1,
    "variable_id": "fbfJHSPpUQD",
    "variable_type": "dataElement",
    "variable_name": "ANC 1st visit"
  }'
```

Repeat for every variable + instance combination needed.

### UI workflow

The dataset creation UI is now Database-first.

- Step 1 always shows all created Superset Databases.
- Selecting a DHIS2 Database starts the staged DHIS2 flow automatically.
- Selecting a non-DHIS2 Database starts the normal database dataset flow automatically.

For DHIS2 Databases:

- Step 1: `Database`
- Step 2: `Data Selection`
- Step 3: `Dataset Settings`
- Step 4: `Review & Create`

For non-DHIS2 Databases:

- Step 1: `Database`
- Step 2: `Table / Query Source`
- Step 3: `Dataset Settings`
- Step 4: `Review & Create`

A DHIS2 Database is selected only once. The workflow no longer asks for a second top-level DHIS2 source or instance concept. Instead, the database step immediately loads the configured child DHIS2 connections already defined under that Database.

All active configured DHIS2 instances saved under that Database are included automatically. The dataset step no longer exposes manual checkboxes for re-selecting or narrowing those child connections, which removes the duplicated source-selection concept. If the connection load fails, the step shows an inline retry action and a link to the DHIS2 diagnostics screens. If some connections later fail during staged metadata browsing, the variable picker and organisation-unit picker both show partial-load diagnostics while keeping successful connections usable.

Dataset step 1 now also shows the staged metadata status directly on the selected Database card:

- variables metadata status and staged count
- org-unit metadata status and staged count
- last metadata refresh timestamp
- `Refresh staged metadata` and `Refresh status` actions

The DHIS2 Database create flow is also split cleanly:

- Step 1: select `DHIS2` as the Database type
- Step 2: configure the logical Superset Database details
- Step 3: add the DHIS2 instances and authentication details under that Database
- Step 4: review and save the Database

The variable picker, organisation-unit picker, and DHIS2 map boundary loader now request `staged=true` metadata. That means the API only filters and merges locally staged snapshots in `source_metadata_cache`; it does not perform live metadata refreshes in the user request path. If a snapshot is not ready yet, the UI stays usable and shows a pending local-staging state with retry.

The variable picker supports:

- typed variable search by name or UID
- typed group search for data elements and indicators
- typed program search for program indicators
- typed program, stage, or group search for event data items

All of those searches operate on the staged metadata cache rather than on live DHIS2 requests.

When more than one configured connection remains selected in the org-unit step, the user can choose one of three org-unit source policies:

- `Primary configured connection`: browse organisation units from one selected connection and use that hierarchy as the authoritative picker.
- `Repository org-unit structure`: browse a deduplicated repository merge of organisation units from all selected configured connections. The UI also shows the merged level mapping derived from the staged local metadata.
- `Keep each configured connection separate`: browse each configured connection hierarchy independently. Duplicate DHIS2 org-unit ids remain separate through staged local selection keys and source lineage.

In all three cases, the organisation-unit metadata is cached locally in `source_metadata_cache`. The same staged refresh also stores per-instance boundary GeoJSON and a derived org-unit hierarchy snapshot so DHIS2 maps and hierarchy-dependent selectors can load locally. The saved staged dataset definition keeps selected org-unit details, selection keys, and source-instance lineage so refresh jobs can safely reuse the local metadata and avoid pushing merged or per-instance org-unit selections to the wrong DHIS2 connection.

The settings step always surfaces the managed schedule. Background processing and staged refresh stay system-managed for staged datasets and are not user-disableable in the wizard.

When a staged DHIS2 dataset is saved, the application now creates two local database objects:

- `ds_*`: the raw long-form stage table used for lineage and refresh bookkeeping
- `sv_*`: the analytical serving table used by dataset preview, Explore, and chart creation

The `sv_*` serving table is what users see in Superset. Its columns are intentionally user-facing:

- `DHIS2 Instance` when more than one configured connection contributes data
- hierarchy columns such as `Region`, `District`, or `Facility`, derived from the staged local org-unit hierarchy
- `Period`
- one column per selected variable, using the alias or the DHIS2 display name

The initial data load is now queued automatically in the background as part of staged dataset creation. If a newly created dataset preview is still empty, first check the staged dataset sync status rather than reloading metadata from DHIS2 in the request path.

Background staged-data refresh is now delta-based after the initial load:

- the first sync loads the full configured period window into local staging
- subsequent scheduled or manual refreshes fetch only missing periods plus the latest active period in the configured window
- periods that fall out of a rolling relative window are pruned locally so the staged data stays aligned with the dataset definition
- the per-dataset background task no longer applies a Celery execution time limit, so large refreshes can run to completion

The main top navigation now exposes a dedicated `Data` menu. Use `Data -> Data Workspace` to work with staged DHIS2 datasets without hovering over row actions:

- select a staged dataset directly
- preview local served rows
- apply simplified column and filter selections
- download the filtered result as CSV
- queue a manual local staging refresh
- jump to SQL Lab with the generated local-serving query
- open the local metadata page for the same logical database

---

## 3. Monitoring Sync Status

**Per-database health snapshot:**

```bash
curl /api/v1/dhis2/diagnostics/health/<database_id>
```

Returns:
- `instances` – list of registered instances with active status.
- `staged_datasets` – list of datasets with `last_sync_at`, `freshness_minutes`, `staging_row_count`.
- `summary` – counts of active instances, synced/never-synced datasets.

**Stale datasets (older than 25 hours):**

```bash
curl "/api/v1/dhis2/diagnostics/stale/<database_id>?threshold_hours=25"
```

**Recent sync job history:**

```bash
curl "/api/v1/dhis2/diagnostics/sync-history/<database_id>?limit=20"
```

For a newly created staged dataset, this is the first place to confirm that the initial background load started and completed. A `pending` or `running` job means the local `sv_*` preview table may still be empty temporarily even though the dataset and columns were created successfully.

**System-wide admin summary:**

```bash
curl /api/v1/dhis2/diagnostics/admin/summary
```

Returns aggregate counts across all databases including `failed_sync_jobs_in_24h`.

---

## 4. Diagnosing Sync Failures

### Step 1: Identify the failed job

```bash
curl "/api/v1/dhis2/diagnostics/sync-history/<database_id>?limit=10"
```

Look for jobs with `"status": "failed"` or `"status": "partial"`. Note the `id` and `error_message`.

### Step 2: Inspect per-instance results

The `instance_results` field in a sync job contains a dict keyed by instance ID:

```json
{
  "1": {"status": "success", "rows": 4200, "error": null},
  "2": {"status": "failed", "rows": 0, "error": "HTTPError: 401 Unauthorized"}
}
```

A `"partial"` job means at least one instance succeeded while another failed. The data from the successful instance is already loaded.

### Step 3: Test the failing instance's connection

```bash
curl /api/v1/dhis2/diagnostics/instance/<instance_id>
```

The response includes a live `connection_test` result. Common outcomes:

| Error | Likely Cause |
|---|---|
| `401 Unauthorized` | Credentials expired or changed in DHIS2 |
| `Connection timed out` | Network route blocked; firewall rule needed |
| `Connection error: refused` | DHIS2 server is down or URL is wrong |
| `500 Internal Server Error` | DHIS2 server error; check DHIS2 logs |

### Step 4: Fix and re-trigger

Update credentials if needed:

```bash
curl -X PUT /api/v1/dhis2/instances/<id> \
  -d '{"password": "new_password"}'
```

Re-trigger a manual sync:

```bash
curl -X POST /api/v1/dhis2/sync/trigger/<dataset_id>
```

---

## 5. Recovering from Partial Sync Failure

A partial failure leaves the previously loaded data for the failed instance intact in the staging table. Only data from the failed instance is stale.

**Recovery procedure:**

1. Identify which instance failed (see `instance_results` in the job record).
2. Fix the root cause (credentials, network, DHIS2 outage).
3. Re-trigger the sync: `POST /api/v1/dhis2/sync/trigger/<dataset_id>`.
4. The sync service performs a full `DELETE + INSERT` for the affected instance, replacing its stale rows with fresh data. Rows from other instances are unaffected.
5. Verify recovery: check `last_sync_status` is `"success"` and `freshness_minutes` is small.

---

## 6. Common Issues and Solutions

### Staging table not found

**Symptom:** `"staging_table_exists": false` in the diagnostics response.

**Cause:** The physical table was dropped manually, or the staging schema was recreated.

**Fix:** Call `ensure_staging_table` via the service layer or re-create the dataset:

```bash
curl -X POST /api/v1/dhis2/staged-datasets/<id>/ensure-table
```

### Dataset stuck in "running" state

**Symptom:** A sync job shows `status: running` for more than 30 minutes.

**Cause:** The Celery worker crashed mid-job leaving the job record stale.

**Fix:** Manually update the stuck job to `failed` via the Superset admin or database:

```sql
UPDATE dhis2_sync_jobs SET status = 'failed', completed_at = NOW(),
  error_message = 'Manually reset: worker crash'
WHERE id = <stuck_job_id>;
```

Then re-trigger the sync.

### Generic metadata not linked for an older dataset

**Symptom:** a legacy DHIS2 dataset exists and still works, but it has a null `generic_dataset_id` or missing logical-database linkage.

**Cause:** the dataset predates the generic staged-source metadata migration and has not yet been rewritten by a create/update/sync flow.

**Fix:** trigger a metadata repair by updating the dataset definition or running a manual sync. Those code paths now backfill:

- `dhis2_instances.logical_database_id`
- `dhis2_staged_datasets.logical_database_id`
- `dhis2_staged_datasets.generic_dataset_id`
- `dhis2_dataset_variables.generic_field_id`
- `dhis2_sync_jobs.generic_sync_job_id`

If a direct database repair is needed, confirm the generic rows exist:

```sql
SELECT id, source_type, source_connection_id, source_name
FROM staged_sources
WHERE source_type = 'dhis2';

SELECT id, database_id, staged_source_id, name
FROM dhis2_logical_databases;
```

Then confirm the mirrored dataset row:

```sql
SELECT id, source_type, staged_source_id, dhis2_logical_database_id, name, slug
FROM staged_datasets
WHERE source_type = 'dhis2';
```

### Variables returning no data

**Symptom:** Sync succeeds with `rows: 0` for a particular instance.

**Cause:** The DHIS2 analytics API returned an empty result for the configured periods/org units.

**Fix:** Verify the `dataset_config` periods and org units:

```bash
curl /api/v1/dhis2/staged-datasets/<id>
# Check dataset_config.periods and dataset_config.org_units
```

Test the analytics request manually against DHIS2:

```
GET https://your-dhis2.org/api/analytics.json
    ?dimension=dx:fbfJHSPpUQD
    &dimension=pe:LAST_12_MONTHS
    &dimension=ou:LEVEL-3
```

### Credentials visible in a log

This should not happen. If you observe a credential in any log file, rotate the credential immediately in DHIS2, then update the instance record in Superset. File a security issue with the engineering team.
