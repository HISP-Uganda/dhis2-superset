export interface DHIS2DatabaseOption {
  id: number;
  database_name: string;
  backend?: string;
}

export interface DHIS2Instance {
  id: number;
  database_id: number;
  name: string;
  url: string;
  auth_type: 'basic' | 'pat';
  username?: string | null;
  is_active: boolean;
  description?: string | null;
  display_order?: number;
  last_test_status?: 'success' | 'failed' | null;
  last_test_message?: string | null;
  last_test_response_time_ms?: number | null;
  last_tested_on?: string | null;
  last_test_result?: {
    status?: 'success' | 'failed' | null;
    message?: string | null;
    response_time_ms?: number | null;
    tested_on?: string | null;
  } | null;
  changed_on?: string | null;
}

export interface DHIS2ConnectionTestResult {
  success: boolean;
  message: string;
  response_time_ms?: number | null;
}

export interface DHIS2SyncJobInstanceResult {
  status?: string;
  rows?: number;
  error?: string | null;
}

export interface DHIS2SyncJob {
  id: number;
  staged_dataset_id: number;
  staged_dataset_name?: string | null;
  job_type: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  created_on?: string | null;
  duration_seconds?: number | null;
  rows_loaded?: number | null;
  rows_failed?: number | null;
  error_message?: string | null;
  instance_results: Record<string, DHIS2SyncJobInstanceResult>;
}

export interface DHIS2HealthInstanceSummary {
  id: number;
  name: string;
  url: string;
  is_active: boolean;
  staged_dataset_count: number;
}

export interface DHIS2HealthDatasetSummary {
  id: number;
  name: string;
  is_active: boolean;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  last_sync_rows?: number | null;
  freshness_minutes?: number | null;
  staging_table_exists: boolean;
  staging_row_count?: number | null;
  recent_jobs: DHIS2SyncJob[];
}

export interface DHIS2FederationSummary {
  total_instances: number;
  active_instances: number;
  total_staged_datasets: number;
  active_staged_datasets: number;
  datasets_synced_in_24h: number;
  datasets_never_synced: number;
}

export interface DHIS2FederationHealth {
  database_id: number;
  instances: DHIS2HealthInstanceSummary[];
  staged_datasets: DHIS2HealthDatasetSummary[];
  summary: DHIS2FederationSummary;
}

export interface DHIS2StaleDataset {
  id: number;
  name: string;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  freshness_minutes?: number | null;
  threshold_hours: number;
}

export interface DHIS2AdminSummary {
  total_instances: number;
  active_instances: number;
  total_staged_datasets: number;
  active_staged_datasets: number;
  datasets_synced_in_24h: number;
  datasets_never_synced: number;
  total_sync_jobs: number;
  failed_sync_jobs_in_24h: number;
}

export interface DHIS2MetadataTypeStatus {
  status: 'ready' | 'pending' | 'partial' | 'failed' | 'missing';
  count: number;
  message?: string | null;
  cache_refreshed_at?: string | null;
}

export interface DHIS2MetadataInstanceStatus {
  id: number;
  name: string;
  status: 'ready' | 'pending' | 'partial' | 'failed' | 'missing';
  count: number;
  types: Record<string, DHIS2MetadataTypeStatus>;
}

export interface DHIS2MetadataFamilyStatus {
  status: 'ready' | 'pending' | 'partial' | 'failed' | 'missing';
  count: number;
  last_refreshed_at?: string | null;
  ready_instances: number;
  pending_instances: number;
  failed_instances: number;
  partial_instances: number;
  missing_instances: number;
  instances: DHIS2MetadataInstanceStatus[];
}

export interface DHIS2MetadataRefreshInstanceProgress {
  id: number | null;
  name: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'partial';
  loaded_count: number;
  total_count_estimate?: number | null;
  completed_units: number;
  failed_units?: number;
  total_units: number;
  percent_complete: number;
  current_metadata_type?: string | null;
  last_error?: string | null;
}

export interface DHIS2MetadataRefreshFamilyProgress {
  status: 'queued' | 'running' | 'complete' | 'failed' | 'partial';
  loaded_count: number;
  total_count_estimate?: number | null;
  completed_units: number;
  failed_units?: number;
  total_units: number;
  percent_complete: number;
  current_metadata_type?: string | null;
  current_instance_id?: number | null;
  current_instance_name?: string | null;
  last_error?: string | null;
  instances: DHIS2MetadataRefreshInstanceProgress[];
}

export interface DHIS2MetadataRefreshProgress {
  status: 'queued' | 'running' | 'complete' | 'failed' | 'partial';
  reason?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  overall: {
    completed_units: number;
    failed_units?: number;
    total_units: number;
    percent_complete: number;
  };
  variables: DHIS2MetadataRefreshFamilyProgress;
  org_units: DHIS2MetadataRefreshFamilyProgress;
}

export interface DHIS2MetadataStatus {
  database_id: number;
  database_name: string;
  active_instance_count: number;
  overall_status: 'ready' | 'pending' | 'partial' | 'failed' | 'missing';
  last_refreshed_at?: string | null;
  variables: DHIS2MetadataFamilyStatus;
  org_units: DHIS2MetadataFamilyStatus;
  refresh_progress?: DHIS2MetadataRefreshProgress | null;
}

export interface DHIS2StagedDatasetStats {
  total_rows: number;
  rows_per_instance: Record<string, number>;
  min_synced_at?: string | null;
  max_synced_at?: string | null;
  table_size_bytes?: number | null;
}

export interface DHIS2StagedDatasetSummary {
  id: number;
  database_id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
  schedule_cron?: string | null;
  schedule_timezone?: string | null;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  staging_table_name?: string | null;
  staging_table_ref?: string | null;
  serving_table_ref?: string | null;
  serving_database_id?: number | null;
  serving_database_name?: string | null;
  serving_columns?: Array<{
    column_name: string;
    verbose_name?: string;
    type?: string;
    is_dttm?: boolean;
    filterable?: boolean;
    groupby?: boolean;
    is_active?: boolean;
    extra?: string;
  }>;
  stats?: DHIS2StagedDatasetStats | null;
}

export interface DHIS2StagedDatasetPreview {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  limit: number;
  staging_table_ref: string;
  serving_table_ref?: string;
}

export interface DHIS2LocalDataFilter {
  id: string;
  column?: string;
  operator?:
    | 'contains'
    | 'eq'
    | 'neq'
    | 'starts_with'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'in';
  value?: string | string[];
}

export interface DHIS2LocalDataQueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  limit: number;
  page: number;
  total_pages: number;
  total_rows: number;
  serving_table_ref: string;
  sql_preview: string;
}

export interface DHIS2LocalFilterOption {
  label: string;
  value: string;
  row_count?: number;
}

export interface DHIS2LocalOrgUnitFilter {
  column_name: string;
  verbose_name: string;
  level: number;
  options: DHIS2LocalFilterOption[];
}

export interface DHIS2LocalPeriodFilter {
  column_name: string;
  verbose_name: string;
  options: DHIS2LocalFilterOption[];
}

export interface DHIS2LocalFilterOptionsResult {
  org_unit_filters: DHIS2LocalOrgUnitFilter[];
  period_filter?: DHIS2LocalPeriodFilter | null;
}
