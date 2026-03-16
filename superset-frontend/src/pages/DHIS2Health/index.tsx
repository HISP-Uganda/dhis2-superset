import { useCallback, useEffect, useRef, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  List,
  Modal,
  Progress,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { SyncOutlined } from '@ant-design/icons';

import { useToasts } from 'src/components/MessageToasts/withToasts';

import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import type {
  DHIS2AdminSummary,
  DHIS2FederationHealth,
  DHIS2HealthDatasetSummary,
  DHIS2StaleDataset,
  DHIS2SyncJob,
} from 'src/features/dhis2/types';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import {
  formatCount,
  formatDateTime,
  formatDuration,
  formatFreshness,
  getDHIS2Route,
  getErrorMessage,
  getStatusColor,
} from 'src/features/dhis2/utils';

const { Text } = Typography;
const POLL_INTERVAL_MS = 4000;

const SummaryGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: ${theme.sizeUnit * 4}px;

    @media (max-width: 1100px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (max-width: 700px) {
      grid-template-columns: 1fr;
    }
  `}
`;

const SectionStack = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit * 4}px;
  `}
`;

const ProgressRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
`;

/** Convert sync status to Ant Design Progress status */
function toProgressStatus(
  status?: string | null,
): 'active' | 'success' | 'exception' | 'normal' {
  if (status === 'running' || status === 'queued') return 'active';
  if (status === 'success') return 'success';
  if (status === 'failed') return 'exception';
  return 'normal';
}

interface DatasetSyncState {
  syncing: boolean;
  latestJob: DHIS2SyncJob | null;
  logModalOpen: boolean;
  logs: DHIS2SyncJob[];
  logsLoading: boolean;
}

export default function DHIS2Health() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const {
    databases,
    loading: loadingDatabases,
    selectedDatabaseId,
    setSelectedDatabaseId,
  } = useDHIS2Databases(addDangerToast);
  const [health, setHealth] = useState<DHIS2FederationHealth | null>(null);
  const [adminSummary, setAdminSummary] = useState<DHIS2AdminSummary | null>(
    null,
  );
  const [staleDatasets, setStaleDatasets] = useState<DHIS2StaleDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [repairingIds, setRepairingIds] = useState<Record<number, boolean>>({});
  const [datasetStates, setDatasetStates] = useState<
    Record<number, DatasetSyncState>
  >({});
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- helpers ----
  const getDatasetState = (id: number): DatasetSyncState =>
    datasetStates[id] ?? {
      syncing: false,
      latestJob: null,
      logModalOpen: false,
      logs: [],
      logsLoading: false,
    };

  const patchDatasetState = useCallback(
    (id: number, patch: Partial<DatasetSyncState>) => {
      setDatasetStates(prev => ({
        ...prev,
        [id]: { ...getDatasetState(id), ...prev[id], ...patch },
      }));
    },
    [],
  );

  // ---- load health ----
  const loadHealth = useCallback(async () => {
    if (!selectedDatabaseId) {
      setHealth(null);
      setStaleDatasets([]);
      return;
    }
    setLoading(true);
    try {
      const [healthResp, staleResp] = await Promise.all([
        SupersetClient.get({
          endpoint: `/api/v1/dhis2/diagnostics/health/${selectedDatabaseId}`,
        }),
        SupersetClient.get({
          endpoint: `/api/v1/dhis2/diagnostics/stale/${selectedDatabaseId}?threshold_hours=25`,
        }),
      ]);
      setHealth(healthResp.json as DHIS2FederationHealth);
      setStaleDatasets((staleResp.json.result || []) as DHIS2StaleDataset[]);
    } catch (error) {
      addDangerToast(getErrorMessage(error, t('Failed to load health data')));
      setHealth(null);
      setStaleDatasets([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDatabaseId, addDangerToast]);

  const loadAdminSummary = useCallback(async () => {
    try {
      const response = await SupersetClient.get({
        endpoint: '/api/v1/dhis2/diagnostics/admin/summary',
      });
      setAdminSummary(response.json as DHIS2AdminSummary);
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to load system-wide DHIS2 summary')),
      );
    }
  }, [addDangerToast]);

  // ---- poll active jobs ----
  const pollActiveJobs = useCallback(async () => {
    if (!selectedDatabaseId) return;
    try {
      const resp = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/diagnostics/active-jobs/${selectedDatabaseId}`,
      });
      const activeJobs = (resp.json.result || []) as DHIS2SyncJob[];
      activeJobs.forEach(job => {
        patchDatasetState(job.staged_dataset_id, { latestJob: job });
      });
    } catch {
      // silent – polling errors shouldn't toast
    }
  }, [selectedDatabaseId, patchDatasetState]);

  // ---- poll latest job for a specific dataset ----
  const pollDatasetJob = useCallback(
    async (datasetId: number) => {
      try {
        const resp = await SupersetClient.get({
          endpoint: `/api/v1/dhis2/staged-datasets/${datasetId}/jobs/latest`,
        });
        const job = resp.json.result as DHIS2SyncJob | null;
        const isStillRunning =
          job?.status === 'running' || job?.status === 'queued';
        patchDatasetState(datasetId, {
          latestJob: job,
          syncing: isStillRunning,
        });
        if (!isStillRunning) {
          // Refresh health card so rows/status update
          void loadHealth();
        }
        return isStillRunning;
      } catch {
        return false;
      }
    },
    [patchDatasetState, loadHealth],
  );

  // Start/stop global poll when any dataset is syncing
  useEffect(() => {
    const anySyncing = Object.values(datasetStates).some(s => s.syncing);
    if (anySyncing && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(() => {
        void pollActiveJobs();
      }, POLL_INTERVAL_MS);
    } else if (!anySyncing && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    return () => {
      if (!anySyncing && pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [datasetStates, pollActiveJobs]);

  useEffect(() => {
    void loadAdminSummary();
  }, [loadAdminSummary]);

  useEffect(() => {
    void loadHealth();
    // Reset per-dataset states on database change
    setDatasetStates({});
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, [selectedDatabaseId, loadHealth]);

  // ---- sync now ----
  const handleSyncNow = async (
    dataset: DHIS2HealthDatasetSummary,
    incremental = true,
  ) => {
    patchDatasetState(dataset.id, { syncing: true });
    try {
      const resp = await SupersetClient.post({
        endpoint: `/api/v1/dhis2/staged-datasets/${dataset.id}/sync`,
        jsonPayload: { incremental },
      });
      const result = resp.json.result as { mode?: string; job_id?: number };
      addSuccessToast(
        result.mode === 'celery'
          ? t('Sync queued via Celery for "%s"', dataset.name)
          : t('Sync started for "%s"', dataset.name),
      );
      // Begin polling this dataset
      const poll = async () => {
        const stillRunning = await pollDatasetJob(dataset.id);
        if (stillRunning) setTimeout(() => void poll(), POLL_INTERVAL_MS);
      };
      void poll();
    } catch (error) {
      addDangerToast(getErrorMessage(error, t('Failed to start sync')));
      patchDatasetState(dataset.id, { syncing: false });
    }
  };

  // ---- repair table ----
  const handleRepairTable = async (dataset: DHIS2HealthDatasetSummary) => {
    setRepairingIds(current => ({ ...current, [dataset.id]: true }));
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/dhis2/staged-datasets/${dataset.id}/ensure-table`,
      });
      addSuccessToast(t('Ensured staging table for %s', dataset.name));
      await loadHealth();
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to ensure staging table')),
      );
    } finally {
      setRepairingIds(current => ({ ...current, [dataset.id]: false }));
    }
  };

  // ---- open sync logs modal ----
  const handleOpenLogs = async (dataset: DHIS2HealthDatasetSummary) => {
    patchDatasetState(dataset.id, { logModalOpen: true, logsLoading: true });
    try {
      const resp = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/staged-datasets/${dataset.id}/jobs?limit=30`,
      });
      patchDatasetState(dataset.id, {
        logs: (resp.json.result || []) as DHIS2SyncJob[],
        logsLoading: false,
      });
    } catch (error) {
      addDangerToast(getErrorMessage(error, t('Failed to load sync logs')));
      patchDatasetState(dataset.id, { logsLoading: false });
    }
  };

  const handleCloseLogs = (datasetId: number) => {
    patchDatasetState(datasetId, { logModalOpen: false });
  };

  // ---- cancel a running sync job ----
  const handleCancelJob = async (
    dataset: DHIS2HealthDatasetSummary,
    job: DHIS2SyncJob,
  ) => {
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/dhis2/jobs/sync/${job.id}/cancel`,
      });
      addSuccessToast(t('Job #%s cancelled', String(job.id)));
      patchDatasetState(dataset.id, {
        syncing: false,
        latestJob: { ...job, status: 'cancelled' },
      });
    } catch (error) {
      addDangerToast(getErrorMessage(error, t('Failed to cancel job')));
    }
  };

  // ---- render dataset card ----
  const renderDatasetCard = (dataset: DHIS2HealthDatasetSummary) => {
    const state = getDatasetState(dataset.id);
    const liveJob = state.latestJob;
    const isRunning =
      state.syncing ||
      liveJob?.status === 'running' ||
      liveJob?.status === 'queued';
    const rowsLoaded =
      liveJob?.rows_loaded ?? dataset.last_sync_rows ?? null;
    const progressStatus = toProgressStatus(
      liveJob?.status ?? dataset.last_sync_status,
    );

    return (
      <List.Item key={dataset.id}>
        <Card
          style={{ width: '100%' }}
          title={
            <Space wrap>
              <Text strong>{dataset.name}</Text>
              <Tag color={dataset.is_active ? 'green' : 'default'}>
                {dataset.is_active ? t('Active') : t('Inactive')}
              </Tag>
              <Tag
                color={getStatusColor(
                  liveJob?.status ?? dataset.last_sync_status,
                )}
              >
                {liveJob?.status ?? dataset.last_sync_status ?? t('Never synced')}
                {isRunning ? (
                  <SyncOutlined spin style={{ marginLeft: 4 }} />
                ) : null}
              </Tag>
            </Space>
          }
          extra={
            <Space wrap>
              <Button
                size="small"
                onClick={() => void handleOpenLogs(dataset)}
              >
                {t('Sync Logs')}
              </Button>
              <Tooltip title={t('Browse locally staged rows and download CSV')}>
                <Button
                  size="small"
                  href={getDHIS2Route(
                    '/superset/dhis2/local-data/',
                    selectedDatabaseId,
                  )}
                >
                  {t('View Data')}
                </Button>
              </Tooltip>
              {dataset.serving_superset_dataset_id ? (
                <Tooltip title={t('Open this dataset in Superset Explore to start charting')}>
                  <Button
                    size="small"
                    type="default"
                    href={`/explore/?datasource_id=${dataset.serving_superset_dataset_id}&datasource_type=table`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('Open in Explore')}
                  </Button>
                </Tooltip>
              ) : null}
              {!dataset.staging_table_exists ? (
                <Button
                  loading={repairingIds[dataset.id]}
                  size="small"
                  onClick={() => void handleRepairTable(dataset)}
                >
                  {t('Repair Table')}
                </Button>
              ) : null}
              {isRunning && liveJob ? (
                <Tooltip title={t('Cancel this sync job')}>
                  <Button
                    danger
                    size="small"
                    onClick={() => void handleCancelJob(dataset, liveJob)}
                  >
                    {t('Cancel')}
                  </Button>
                </Tooltip>
              ) : null}
              <Tooltip
                title={
                  isRunning
                    ? t('Sync in progress…')
                    : !dataset.is_active
                      ? t('Dataset is inactive — resume it in Job History')
                      : t('Trigger an incremental sync now')
                }
              >
                <Button
                  disabled={!dataset.is_active || isRunning}
                  icon={<SyncOutlined spin={isRunning} />}
                  loading={state.syncing && !liveJob}
                  size="small"
                  type="primary"
                  onClick={() => void handleSyncNow(dataset, true)}
                >
                  {isRunning ? t('Syncing…') : t('Sync Now')}
                </Button>
              </Tooltip>
            </Space>
          }
        >
          {/* Live progress bar */}
          {isRunning ? (
            <ProgressRow>
              <Progress
                percent={
                  rowsLoaded
                    ? Math.min(99, Math.round((rowsLoaded / Math.max(rowsLoaded, 1)) * 100))
                    : undefined
                }
                showInfo={false}
                status={progressStatus}
                strokeColor={progressStatus === 'active' ? '#1890ff' : undefined}
                style={{ flex: 1 }}
              />
              <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                {rowsLoaded != null
                  ? t('%s rows loaded', formatCount(rowsLoaded))
                  : t('Starting…')}
              </Text>
            </ProgressRow>
          ) : null}

          {/* Completed job result */}
          {liveJob &&
          !isRunning &&
          (liveJob.status === 'success' ||
            liveJob.status === 'partial' ||
            liveJob.status === 'failed') ? (
            <Alert
              closable
              message={
                liveJob.status === 'failed'
                  ? t('Last sync failed')
                  : liveJob.status === 'partial'
                    ? t('Last sync partially succeeded')
                    : t('Last sync completed')
              }
              description={
                liveJob.error_message ? (
                  <Text type="danger">{liveJob.error_message}</Text>
                ) : (
                  t(
                    '%s rows loaded in %s',
                    formatCount(liveJob.rows_loaded),
                    formatDuration(liveJob.duration_seconds),
                  )
                )
              }
              showIcon
              style={{ marginBottom: 8 }}
              type={
                liveJob.status === 'failed'
                  ? 'error'
                  : liveJob.status === 'partial'
                    ? 'warning'
                    : 'success'
              }
              onClose={() => patchDatasetState(dataset.id, { latestJob: null })}
            />
          ) : null}

          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label={t('Last sync')}>
              {formatDateTime(dataset.last_sync_at)}
            </Descriptions.Item>
            <Descriptions.Item label={t('Freshness')}>
              {formatFreshness(dataset.freshness_minutes)}
            </Descriptions.Item>
            <Descriptions.Item label={t('Rows loaded (last)')}>
              {formatCount(dataset.last_sync_rows)}
            </Descriptions.Item>
            <Descriptions.Item label={t('Rows in staging')}>
              {formatCount(dataset.staging_row_count)}
            </Descriptions.Item>
            <Descriptions.Item label={t('Staging table')}>
              {dataset.staging_table_exists ? (
                <Tag color="green">{t('Present')}</Tag>
              ) : (
                <Tag color="red">{t('Missing')}</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('Recent jobs')}>
              <Space wrap>
                {dataset.recent_jobs.length ? (
                  dataset.recent_jobs.map(job => (
                    <Tag key={job.id} color={getStatusColor(job.status)}>
                      {job.status}
                    </Tag>
                  ))
                ) : (
                  <Text type="secondary">{t('None yet')}</Text>
                )}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </Card>

        {/* Sync logs modal */}
        <Modal
          footer={
            <Button onClick={() => handleCloseLogs(dataset.id)}>
              {t('Close')}
            </Button>
          }
          open={state.logModalOpen}
          title={t('Sync logs — %s', dataset.name)}
          width={900}
          onCancel={() => handleCloseLogs(dataset.id)}
        >
          <SyncLogsTable
            jobs={state.logs}
            loading={state.logsLoading}
          />
        </Modal>
      </List.Item>
    );
  };

  return (
    <DHIS2PageLayout
      activeTab="health"
      databases={databases}
      description={t(
        'Monitor freshness, staging integrity, and recent sync behavior. Use Sync Now to manually trigger a dataset refresh and watch live progress.',
      )}
      extra={
        <Button onClick={() => void loadHealth()}>{t('Refresh')}</Button>
      }
      loadingDatabases={loadingDatabases}
      selectedDatabaseId={selectedDatabaseId}
      title={t('Federation Health')}
      onDatabaseChange={setSelectedDatabaseId}
    >
      <SectionStack>
        {adminSummary ? (
          <Card title={t('System-wide summary')}>
            <SummaryGrid>
              <Card>
                <Statistic
                  title={t('Active instances')}
                  value={`${adminSummary.active_instances}/${adminSummary.total_instances}`}
                />
              </Card>
              <Card>
                <Statistic
                  title={t('Active datasets')}
                  value={`${adminSummary.active_staged_datasets}/${adminSummary.total_staged_datasets}`}
                />
              </Card>
              <Card>
                <Statistic
                  title={t('Datasets synced in 24h')}
                  value={adminSummary.datasets_synced_in_24h}
                />
              </Card>
              <Card>
                <Statistic
                  title={t('Failed jobs in 24h')}
                  value={adminSummary.failed_sync_jobs_in_24h}
                />
              </Card>
            </SummaryGrid>
          </Card>
        ) : null}

        <Card loading={loading} title={t('Selected database summary')}>
          {health ? (
            <SummaryGrid>
              <Card>
                <Statistic
                  title={t('Active instances')}
                  value={`${health.summary.active_instances}/${health.summary.total_instances}`}
                />
              </Card>
              <Card>
                <Statistic
                  title={t('Active staged datasets')}
                  value={`${health.summary.active_staged_datasets}/${health.summary.total_staged_datasets}`}
                />
              </Card>
              <Card>
                <Statistic
                  title={t('Datasets synced in 24h')}
                  value={health.summary.datasets_synced_in_24h}
                />
              </Card>
              <Card>
                <Statistic
                  title={t('Never synced')}
                  value={health.summary.datasets_never_synced}
                />
              </Card>
            </SummaryGrid>
          ) : (
            <Empty description={t('No health data available yet.')} />
          )}
        </Card>

        <Card loading={loading} title={t('Instances')}>
          {health?.instances.length ? (
            <List
              dataSource={health.instances}
              renderItem={instance => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space wrap>
                        <Text strong>{instance.name}</Text>
                        <Tag color={instance.is_active ? 'green' : 'default'}>
                          {instance.is_active ? t('Active') : t('Inactive')}
                        </Tag>
                      </Space>
                    }
                    description={instance.url}
                  />
                  <Text type="secondary">
                    {t('%s staged datasets', instance.staged_dataset_count)}
                  </Text>
                </List.Item>
              )}
            />
          ) : (
            <Empty description={t('No instances found for this database.')} />
          )}
        </Card>

        <Card loading={loading} title={t('Staged datasets')}>
          {health?.staged_datasets.length ? (
            <List
              dataSource={health.staged_datasets}
              renderItem={renderDatasetCard}
            />
          ) : (
            <Empty
              description={t(
                'No staged datasets have been created for this database yet.',
              )}
            />
          )}
        </Card>

        <Card loading={loading} title={t('Stale datasets')}>
          {staleDatasets.length ? (
            <List
              dataSource={staleDatasets}
              renderItem={dataset => (
                <List.Item>
                  <Alert
                    message={dataset.name}
                    showIcon
                    style={{ width: '100%' }}
                    type="warning"
                    description={
                      <Space direction="vertical" size={0}>
                        <Text>
                          {t('Last sync')}: {formatDateTime(dataset.last_sync_at)}
                        </Text>
                        <Text>
                          {t('Freshness')}: {formatFreshness(dataset.freshness_minutes)}
                        </Text>
                        <Text>
                          {t('Status')}: {dataset.last_sync_status || t('Never synced')}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty
              description={t(
                'No stale datasets were detected for the current threshold.',
              )}
            />
          )}
        </Card>
      </SectionStack>
    </DHIS2PageLayout>
  );
}

// ---------------------------------------------------------------------------
// Sync logs table (reused in the modal)
// ---------------------------------------------------------------------------

interface SyncLogsTableProps {
  jobs: DHIS2SyncJob[];
  loading: boolean;
}

function SyncLogsTable({ jobs, loading }: SyncLogsTableProps) {
  if (!loading && !jobs.length) {
    return <Empty description={t('No sync jobs recorded yet.')} />;
  }
  return (
    <Table
      columns={[
        {
          title: t('Status'),
          dataIndex: 'status',
          key: 'status',
          width: 110,
          render: (value: string) => (
            <Tag color={getStatusColor(value)}>{value}</Tag>
          ),
        },
        {
          title: t('Type'),
          dataIndex: 'job_type',
          key: 'job_type',
          width: 90,
        },
        {
          title: t('Started'),
          dataIndex: 'started_at',
          key: 'started_at',
          width: 160,
          render: (v: string | null) => formatDateTime(v),
        },
        {
          title: t('Duration'),
          dataIndex: 'duration_seconds',
          key: 'duration_seconds',
          width: 100,
          render: (v: number | null) => formatDuration(v),
        },
        {
          title: t('Rows loaded'),
          dataIndex: 'rows_loaded',
          key: 'rows_loaded',
          width: 110,
          render: (v: number | null) => formatCount(v),
        },
        {
          title: t('Error'),
          dataIndex: 'error_message',
          key: 'error_message',
          ellipsis: true,
          render: (v: string | null) =>
            v ? (
              <Text type="danger" style={{ fontSize: 12 }}>
                {v}
              </Text>
            ) : (
              <Text type="secondary">{t('None')}</Text>
            ),
        },
      ]}
      dataSource={jobs}
      expandable={{
        expandedRowRender: (job: DHIS2SyncJob) => {
          const entries = Object.entries(job.instance_results || {});
          if (!entries.length) {
            return (
              <Text type="secondary">{t('No per-instance breakdown.')}</Text>
            );
          }
          return (
            <Collapse ghost>
              {entries.map(([instanceId, result]) => (
                <Collapse.Panel
                  key={instanceId}
                  header={
                    <Space>
                      <Tag color={getStatusColor(result.status)}>
                        {result.status ?? t('unknown')}
                      </Tag>
                      <Text>
                        {t('Instance %s', instanceId)} —{' '}
                        {formatCount(result.rows)} {t('rows')}
                      </Text>
                    </Space>
                  }
                >
                  {result.error ? (
                    <Alert
                      message={t('Instance error')}
                      description={result.error}
                      showIcon
                      type="error"
                    />
                  ) : (
                    <Text type="secondary">{t('No errors.')}</Text>
                  )}
                </Collapse.Panel>
              ))}
            </Collapse>
          );
        },
        rowExpandable: (job: DHIS2SyncJob) =>
          Object.keys(job.instance_results || {}).length > 0,
      }}
      loading={loading}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      rowKey="id"
      size="small"
    />
  );
}
