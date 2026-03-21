import { useCallback, useEffect, useRef, useState } from 'react';
import { SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Popconfirm,
  Progress,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  SyncOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';

import { useToasts } from 'src/components/MessageToasts/withToasts';

import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import type {
  DHIS2AnyJob,
  DHIS2MetadataJob,
  DHIS2MetadataTypeResult,
  DHIS2RequestLog,
  DHIS2RequestLogSummary,
  DHIS2SyncJob,
} from 'src/features/dhis2/types';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import WorkerStatusBanner from 'src/features/dhis2/WorkerStatusBanner';
import {
  formatDateTime,
  formatDuration,
  getErrorMessage,
  getStatusColor,
} from 'src/features/dhis2/utils';

const { Text } = Typography;
const POLL_INTERVAL_MS = 15 * 60 * 1000;
const POLL_INTERVAL_LABEL = '15 min';
const ACTIVE_STATUSES = new Set(['running', 'queued', 'pending']);
const TERMINAL_STATUSES = new Set(['success', 'partial', 'failed', 'cancelled']);

function isSyncJob(job: DHIS2AnyJob): job is DHIS2SyncJob {
  return job.job_category === 'sync';
}

export default function DHIS2SyncHistory() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const {
    databases,
    loading: loadingDatabases,
    selectedDatabaseId,
    setSelectedDatabaseId,
  } = useDHIS2Databases(addDangerToast);
  const [jobs, setJobs] = useState<DHIS2AnyJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(50);
  const [typeFilter, setTypeFilter] = useState<'both' | 'sync' | 'metadata'>('both');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  // Per-job request logs: keyed by job id, fetched lazily on row expand
  const [requestLogs, setRequestLogs] = useState<
    Record<number, { logs: DHIS2RequestLog[]; summary: DHIS2RequestLogSummary | null; loading: boolean }>
  >({});
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPollingRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    isPollingRef.current = false;
  }, []);

  const fetchJobs = useCallback(
    async (dbId: number, currentLimit: number, type: string) => {
      const params = new URLSearchParams({
        database_id: String(dbId),
        limit: String(currentLimit),
        type,
      });
      const response = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/jobs/?${params.toString()}`,
      });
      return (response.json.result || []) as DHIS2AnyJob[];
    },
    [],
  );

  const scheduleNextPoll = useCallback(
    (dbId: number, currentLimit: number, type: string) => {
      stopPolling();
      isPollingRef.current = true;
      pollTimerRef.current = setTimeout(async () => {
        if (!isPollingRef.current) return;
        try {
          const fetched = await fetchJobs(dbId, currentLimit, type);
          setJobs(fetched);
          const hasActive = fetched.some(j => ACTIVE_STATUSES.has(j.status));
          if (hasActive) {
            scheduleNextPoll(dbId, currentLimit, type);
          } else {
            stopPolling();
          }
        } catch {
          stopPolling();
        }
      }, POLL_INTERVAL_MS);
    },
    [fetchJobs, stopPolling],
  );

  const loadJobs = useCallback(
    async (quiet = false) => {
      if (!selectedDatabaseId) {
        setJobs([]);
        return;
      }
      if (!quiet) setLoading(true);
      try {
        const fetched = await fetchJobs(selectedDatabaseId, limit, typeFilter);
        setJobs(fetched);
        const hasActive = fetched.some(j => ACTIVE_STATUSES.has(j.status));
        if (hasActive) {
          scheduleNextPoll(selectedDatabaseId, limit, typeFilter);
        } else {
          stopPolling();
        }
      } catch (error) {
        addDangerToast(getErrorMessage(error, t('Failed to load job history')));
        setJobs([]);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [selectedDatabaseId, limit, typeFilter, fetchJobs, scheduleNextPoll, stopPolling, addDangerToast],
  );

  useEffect(() => {
    stopPolling();
    void loadJobs();
    return () => stopPolling();
  }, [selectedDatabaseId, limit, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const callJobAction = useCallback(
    async (job: DHIS2AnyJob, action: 'cancel' | 'restart' | 'pause' | 'resume', method: 'POST' | 'DELETE' = 'POST') => {
      const key = `${job.job_category}-${job.id}-${action}`;
      setActionLoading(prev => ({ ...prev, [key]: true }));
      try {
        const endpoint = `/api/v1/dhis2/jobs/${job.job_category}/${job.id}/${action}`;
        await SupersetClient.post({ endpoint });
        addSuccessToast(t('Job %s: %s succeeded', String(job.id), action));
        await loadJobs(true);
      } catch (error) {
        addDangerToast(getErrorMessage(error, t('Action "%s" failed', action)));
      } finally {
        setActionLoading(prev => ({ ...prev, [key]: false }));
      }
    },
    [addSuccessToast, addDangerToast, loadJobs],
  );

  const deleteJob = useCallback(
    async (job: DHIS2AnyJob) => {
      const key = `${job.job_category}-${job.id}-delete`;
      setActionLoading(prev => ({ ...prev, [key]: true }));
      try {
        await SupersetClient.delete({
          endpoint: `/api/v1/dhis2/jobs/${job.job_category}/${job.id}`,
        });
        addSuccessToast(t('Job %s deleted', String(job.id)));
        setJobs(prev => prev.filter(j => j.id !== job.id || j.job_category !== job.job_category));
      } catch (error) {
        addDangerToast(getErrorMessage(error, t('Delete failed')));
      } finally {
        setActionLoading(prev => ({ ...prev, [key]: false }));
      }
    },
    [addSuccessToast, addDangerToast],
  );

  const fetchRequestLogs = useCallback(async (jobId: number) => {
    setRequestLogs(prev => ({ ...prev, [jobId]: { logs: [], summary: null, loading: true } }));
    try {
      const resp = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/jobs/sync/${jobId}/requests`,
      });
      setRequestLogs(prev => ({
        ...prev,
        [jobId]: {
          logs: resp.json.result || [],
          summary: resp.json.summary || null,
          loading: false,
        },
      }));
    } catch {
      setRequestLogs(prev => ({
        ...prev,
        [jobId]: { logs: [], summary: null, loading: false },
      }));
    }
  }, []);

  const successCount = jobs.filter(j => j.status === 'success').length;
  const failedCount = jobs.filter(j => j.status === 'failed' || j.status === 'cancelled').length;
  const activeCount = jobs.filter(j => ACTIVE_STATUSES.has(j.status)).length;
  const metaCount = jobs.filter(j => j.job_category === 'metadata').length;

  // One-job-at-a-time: sets of dataset IDs / metadata scope that already have an active job
  const activeSyncDatasetIds = new Set<number>(
    jobs
      .filter(j => j.job_category === 'sync' && ACTIVE_STATUSES.has(j.status))
      .map(j => (j as { staged_dataset_id: number }).staged_dataset_id),
  );
  const hasActiveMetadataJob = jobs.some(
    j => j.job_category === 'metadata' && ACTIVE_STATUSES.has(j.status),
  );

  return (
    <DHIS2PageLayout
      activeTab="sync-history"
      databases={databases}
      description={t(
        'Unified history of dataset syncs and metadata refreshes. Stop, restart, pause, or delete jobs from here.',
      )}
      extra={
        <Space wrap>
          {activeCount > 0 && (
            <Badge count={activeCount} size="small">
              <Tag icon={<SyncOutlined spin />} color="processing">
                {t('Live')}
              </Tag>
            </Badge>
          )}
          <Select
            aria-label={t('Job type')}
            options={[
              { label: t('All jobs'), value: 'both' },
              { label: t('Dataset syncs'), value: 'sync' },
              { label: t('Metadata refreshes'), value: 'metadata' },
            ]}
            style={{ width: 180 }}
            value={typeFilter}
            onChange={val => setTypeFilter(val)}
          />
          <Select
            aria-label={t('History limit')}
            options={[
              { label: t('25 jobs'), value: 25 },
              { label: t('50 jobs'), value: 50 },
              { label: t('100 jobs'), value: 100 },
            ]}
            style={{ width: 140 }}
            value={limit}
            onChange={value => setLimit(value)}
          />
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void loadJobs()}
          >
            {t('Refresh')}
          </Button>
        </Space>
      }
      loadingDatabases={loadingDatabases}
      selectedDatabaseId={selectedDatabaseId}
      title={t('Job History')}
      onDatabaseChange={setSelectedDatabaseId}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <WorkerStatusBanner />
        <Space style={{ width: '100%' }} wrap>
          <Card style={{ minWidth: 160 }}>
            <Statistic title={t('Total loaded')} value={jobs.length} />
          </Card>
          <Card style={{ minWidth: 160 }}>
            <Statistic
              title={t('Active')}
              value={activeCount}
              valueStyle={activeCount > 0 ? { color: '#1677ff' } : undefined}
              suffix={activeCount > 0 ? <Spin size="small" /> : undefined}
            />
          </Card>
          <Card style={{ minWidth: 160 }}>
            <Statistic title={t('Successful')} value={successCount} />
          </Card>
          <Card style={{ minWidth: 160 }}>
            <Statistic title={t('Failed / Cancelled')} value={failedCount} />
          </Card>
          <Card style={{ minWidth: 160 }}>
            <Statistic title={t('Metadata jobs')} value={metaCount} />
          </Card>
        </Space>

        {activeCount > 0 && (
          <Alert
            type="info"
            showIcon
            icon={<SyncOutlined spin />}
            message={
              <Space>
                <Text strong>{t('%s job(s) currently running', activeCount)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t(
                    'Auto-refreshing every %s. Only one job per dataset may run at a time.',
                    POLL_INTERVAL_LABEL,
                  )}
                </Text>
              </Space>
            }
          />
        )}

        <Card loading={loading} title={t('Jobs')}>
          {jobs.length ? (
            <Table
              dataSource={jobs}
              pagination={{ pageSize: 15, showSizeChanger: false }}
              rowKey={j => `${j.job_category}-${j.id}`}
              rowClassName={(j: DHIS2AnyJob) =>
                ACTIVE_STATUSES.has(j.status) ? 'ant-table-row-active-job' : ''
              }
              columns={[
                {
                  title: t('Type'),
                  key: 'job_category',
                  width: 110,
                  render: (_: unknown, job: DHIS2AnyJob) => (
                    <Tag color={job.job_category === 'metadata' ? 'purple' : 'blue'}>
                      {job.job_category === 'metadata' ? t('Metadata') : t('Sync')}
                    </Tag>
                  ),
                },
                {
                  title: t('Dataset / Scope'),
                  key: 'scope',
                  render: (_: unknown, job: DHIS2AnyJob) => {
                    if (isSyncJob(job)) {
                      return job.staged_dataset_name || `#${job.staged_dataset_id}`;
                    }
                    const mj = job as DHIS2MetadataJob;
                    const ids = mj.instance_ids || [];
                    const nameMap = mj.instance_name_map || {};
                    if (ids.length === 0) return t('All instances');
                    const names = ids.map(id => nameMap[String(id)] || `#${id}`);
                    if (names.length === 1) return names[0];
                    return (
                      <Tooltip title={names.join(', ')}>
                        <span>{t('%s instances', names.length)}</span>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: t('Job type'),
                  dataIndex: 'job_type',
                  key: 'job_type',
                  width: 90,
                },
                {
                  title: t('Status'),
                  key: 'status',
                  width: 130,
                  render: (_: unknown, job: DHIS2AnyJob) => (
                    <Tag
                      icon={ACTIVE_STATUSES.has(job.status) ? <SyncOutlined spin /> : undefined}
                      color={getStatusColor(job.status)}
                    >
                      {job.status}
                    </Tag>
                  ),
                },
                {
                  title: t('Started'),
                  dataIndex: 'started_at',
                  key: 'started_at',
                  render: (v: string | null) => formatDateTime(v),
                },
                {
                  title: t('Duration'),
                  dataIndex: 'duration_seconds',
                  key: 'duration_seconds',
                  render: (v: number | null) => formatDuration(v),
                },
                {
                  title: t('Rows'),
                  key: 'rows',
                  width: 110,
                  render: (_: unknown, job: DHIS2AnyJob) => {
                    const loaded = job.rows_loaded ?? 0;
                    const extracted = isSyncJob(job) ? (job.rows_extracted ?? null) : null;
                    const fetchedDiffers = extracted !== null && extracted > 0 && extracted !== loaded;
                    if (ACTIVE_STATUSES.has(job.status)) {
                      return (
                        <Space size={4}>
                          <SyncOutlined spin style={{ color: '#1677ff' }} />
                          <Text>{loaded}</Text>
                        </Space>
                      );
                    }
                    if (fetchedDiffers) {
                      return (
                        <Tooltip title={t('%s fetched from DHIS2, %s written to local staging', String(extracted), String(loaded))}>
                          <Space size={2}>
                            <Text>{loaded}</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>({extracted} {t('fetched')})</Text>
                          </Space>
                        </Tooltip>
                      );
                    }
                    return String(loaded);
                  },
                },
                {
                  title: t('Error'),
                  dataIndex: 'error_message',
                  key: 'error_message',
                  ellipsis: true,
                  render: (v: string | null) =>
                    v ? (
                      <Tooltip title={v}>
                        <Text type="danger" ellipsis>{v}</Text>
                      </Tooltip>
                    ) : (
                      <Text type="secondary">—</Text>
                    ),
                },
                {
                  title: t('Actions'),
                  key: 'actions',
                  width: 200,
                  render: (_: unknown, job: DHIS2AnyJob) => {
                    const isActive = ACTIVE_STATUSES.has(job.status);
                    const isTerminal = TERMINAL_STATUSES.has(job.status);
                    const isPaused = isSyncJob(job) && !isActive && !isTerminal;

                    // One-job-at-a-time: block restart if another job for this
                    // dataset (sync) or any metadata job is already running.
                    const conflictingJobRunning = isSyncJob(job)
                      ? activeSyncDatasetIds.has(job.staged_dataset_id)
                      : hasActiveMetadataJob;
                    const restartBlocked = isTerminal && conflictingJobRunning;
                    const restartTooltip = restartBlocked
                      ? t('Another job for this dataset is currently running. Cancel it first.')
                      : t('Restart with same parameters');

                    return (
                      <Space size={4} wrap>
                        {isActive && (
                          <Tooltip title={t('Cancel this job')}>
                            <Popconfirm
                              title={t('Cancel job #%s?', String(job.id))}
                              onConfirm={() => void callJobAction(job, 'cancel')}
                              okText={t('Yes, cancel')}
                              cancelText={t('No')}
                            >
                              <Button
                                danger
                                icon={<StopOutlined />}
                                loading={!!actionLoading[`${job.job_category}-${job.id}-cancel`]}
                                size="small"
                              >
                                {t('Cancel')}
                              </Button>
                            </Popconfirm>
                          </Tooltip>
                        )}
                        {isActive && isSyncJob(job) && (
                          <Tooltip title={t('Cancel and deactivate dataset')}>
                            <Popconfirm
                              title={t('Pause dataset and cancel job #%s?', String(job.id))}
                              onConfirm={() => void callJobAction(job, 'pause')}
                              okText={t('Yes, pause')}
                              cancelText={t('No')}
                            >
                              <Button
                                icon={<PauseCircleOutlined />}
                                loading={!!actionLoading[`${job.job_category}-${job.id}-pause`]}
                                size="small"
                              >
                                {t('Pause')}
                              </Button>
                            </Popconfirm>
                          </Tooltip>
                        )}
                        {isPaused && isSyncJob(job) && (
                          <Tooltip title={t('Re-activate dataset for scheduled syncs')}>
                            <Button
                              icon={<PlayCircleOutlined />}
                              loading={!!actionLoading[`${job.job_category}-${job.id}-resume`]}
                              size="small"
                              onClick={() => void callJobAction(job, 'resume')}
                            >
                              {t('Resume')}
                            </Button>
                          </Tooltip>
                        )}
                        {isTerminal && (
                          <Tooltip title={restartTooltip}>
                            <Button
                              disabled={restartBlocked}
                              icon={<ReloadOutlined />}
                              loading={!!actionLoading[`${job.job_category}-${job.id}-restart`]}
                              size="small"
                              onClick={restartBlocked ? undefined : () => void callJobAction(job, 'restart')}
                            >
                              {t('Restart')}
                            </Button>
                          </Tooltip>
                        )}
                        {isTerminal && (
                          <Tooltip title={t('Delete this job record')}>
                            <Popconfirm
                              title={t('Delete job #%s?', String(job.id))}
                              onConfirm={() => void deleteJob(job)}
                              okText={t('Delete')}
                              cancelText={t('No')}
                              okButtonProps={{ danger: true }}
                            >
                              <Button
                                danger
                                icon={<DeleteOutlined />}
                                loading={!!actionLoading[`${job.job_category}-${job.id}-delete`]}
                                size="small"
                              />
                            </Popconfirm>
                          </Tooltip>
                        )}
                      </Space>
                    );
                  },
                },
              ]}
              expandable={{
                onExpand: (expanded: boolean, job: DHIS2AnyJob) => {
                  if (expanded && isSyncJob(job) && !requestLogs[job.id]) {
                    void fetchRequestLogs(job.id);
                  }
                },
                expandedRowRender: (job: DHIS2AnyJob) => {
                  const results = job.instance_results || {};
                  const instEntries = Object.entries(results);
                  const logData = isSyncJob(job) ? requestLogs[job.id] : undefined;
                  const nameMap = !isSyncJob(job)
                    ? ((job as DHIS2MetadataJob).instance_name_map || {})
                    : {};

                  // ── Metadata job: instance cards + per-type breakdown ──
                  const renderMetadataInstances = () => {
                    if (instEntries.length === 0) {
                      return <Text type="secondary">{t('No instance details recorded')}</Text>;
                    }
                    return (
                      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        {instEntries.map(([instId, typeResults]) => {
                          const typeMap = typeResults as Record<string, DHIS2MetadataTypeResult>;
                          const typeRows = Object.entries(typeMap)
                            .map(([typeName, r]) => ({ typeName, ...r }))
                            .sort((a, b) => a.typeName.localeCompare(b.typeName));
                          const totalCount = typeRows.reduce((s, r) => s + (r.count || 0), 0);
                          const failedTypes = typeRows.filter(r => r.status !== 'success' && r.status !== 'unsupported');
                          const instanceName = nameMap[instId] || `Instance ${instId}`;
                          const allOk = failedTypes.length === 0;

                          return (
                            <Card
                              key={instId}
                              size="small"
                              title={
                                <Space>
                                  {allOk
                                    ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                                    : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
                                  <Text strong>{instanceName}</Text>
                                  <Tag color={allOk ? 'success' : 'error'} style={{ fontSize: 11 }}>
                                    {allOk ? t('success') : t('%s failed', failedTypes.length)}
                                  </Tag>
                                  <Text type="secondary" style={{ fontSize: 12 }}>
                                    {t('%s total items', totalCount.toLocaleString())}
                                  </Text>
                                </Space>
                              }
                              style={{ borderColor: allOk ? '#b7eb8f' : '#ffccc7' }}
                            >
                              <Table<{ typeName: string; count: number; status: string; message?: string | null }>
                                dataSource={typeRows}
                                rowKey="typeName"
                                size="small"
                                pagination={false}
                                scroll={{ y: 320 }}
                                rowClassName={r => r.status !== 'success' && r.status !== 'unsupported' ? 'ant-table-row-danger' : ''}
                                columns={[
                                  {
                                    title: t('Metadata type'),
                                    dataIndex: 'typeName',
                                    key: 'typeName',
                                    render: (v: string) => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</Text>,
                                  },
                                  {
                                    title: t('Count'),
                                    dataIndex: 'count',
                                    key: 'count',
                                    width: 90,
                                    align: 'right' as const,
                                    render: (v: number) => (
                                      <Text strong style={{ fontSize: 12 }}>
                                        {(v || 0).toLocaleString()}
                                      </Text>
                                    ),
                                  },
                                  {
                                    title: t('Status'),
                                    dataIndex: 'status',
                                    key: 'status',
                                    width: 110,
                                    render: (v: string) => {
                                      const color = v === 'success' ? 'success' : v === 'unsupported' ? 'default' : 'error';
                                      return <Tag color={color} style={{ fontSize: 11 }}>{v}</Tag>;
                                    },
                                  },
                                  {
                                    title: t('Note'),
                                    dataIndex: 'message',
                                    key: 'message',
                                    ellipsis: true,
                                    render: (v: string | null) =>
                                      v ? <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text> : null,
                                  },
                                ]}
                              />
                            </Card>
                          );
                        })}
                      </Space>
                    );
                  };

                  // ── Sync job: instance status cards ────────────────────
                  const renderSyncInstances = () => {
                    if (instEntries.length === 0) {
                      return <Text type="secondary">{t('No instance details')}</Text>;
                    }
                    return (
                      <Space wrap size="small">
                        {instEntries.map(([instId, result]) => {
                          const r = result as Record<string, unknown>;
                          const isOk = r.status === 'success';
                          const instanceName = nameMap[instId] || `Instance ${instId}`;
                          return (
                            <Card
                              key={instId}
                              size="small"
                              style={{
                                minWidth: 220,
                                borderColor: isOk ? '#b7eb8f' : '#ffccc7',
                                background: isOk ? '#f6ffed' : '#fff2f0',
                              }}
                            >
                              <Space direction="vertical" size={2}>
                                <Space>
                                  {isOk
                                    ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                                    : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
                                  <Text strong style={{ fontSize: 13 }}>{instanceName}</Text>
                                  <Tag color={isOk ? 'success' : 'error'} style={{ fontSize: 11 }}>
                                    {String(r.status)}
                                  </Tag>
                                </Space>
                                {r.rows !== undefined && (
                                  <Text style={{ fontSize: 12 }}>
                                    {t('Rows loaded')}: <Text strong>{String(r.rows)}</Text>
                                  </Text>
                                )}
                                {r.sync_mode && (
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    {t('Mode')}: {String(r.sync_mode)}
                                  </Text>
                                )}
                                {r.error && (
                                  <Tooltip title={String(r.error)}>
                                    <Text type="danger" ellipsis style={{ fontSize: 12, maxWidth: 260 }}>
                                      {String(r.error)}
                                    </Text>
                                  </Tooltip>
                                )}
                              </Space>
                            </Card>
                          );
                        })}
                      </Space>
                    );
                  };

                  return (
                    <div style={{ padding: '8px 0' }}>
                      <Collapse
                        defaultActiveKey={['instances', 'requests']}
                        ghost
                        size="small"
                        items={[
                          // ── Instance summary panel ──────────────────────
                          {
                            key: 'instances',
                            label: (
                              <Space>
                                <UnorderedListOutlined />
                                <Text strong>{t('Instance Summary')}</Text>
                                {instEntries.length > 0 && (
                                  <Badge count={instEntries.length} color="blue" />
                                )}
                              </Space>
                            ),
                            children: isSyncJob(job)
                              ? renderSyncInstances()
                              : renderMetadataInstances(),
                          },

                          // ── Per-batch request log panel (sync only) ────
                          ...(isSyncJob(job) ? [{
                            key: 'requests',
                            label: (
                              <Space>
                                <UnorderedListOutlined />
                                <Text strong>{t('Analytics Request Log')}</Text>
                                {logData?.summary && (
                                  <Space size={4}>
                                    <Tag color="success" style={{ fontSize: 11 }}>
                                      {logData.summary.success_count} {t('ok')}
                                    </Tag>
                                    {logData.summary.failed_count > 0 && (
                                      <Tag color="error" style={{ fontSize: 11 }}>
                                        {logData.summary.failed_count} {t('failed')}
                                      </Tag>
                                    )}
                                  </Space>
                                )}
                                {logData?.loading && <Spin size="small" />}
                                <Button
                                  size="small"
                                  icon={<ReloadOutlined />}
                                  loading={logData?.loading}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void fetchRequestLogs(job.id);
                                  }}
                                  style={{ marginLeft: 4 }}
                                >
                                  {t('Refresh')}
                                </Button>
                              </Space>
                            ),
                            children: (() => {
                              if (!logData || logData.loading) {
                                return (
                                  <Space>
                                    <Spin size="small" />
                                    <Text type="secondary">{t('Loading request log…')}</Text>
                                  </Space>
                                );
                              }
                              if (logData.logs.length === 0) {
                                return (
                                  <Text type="secondary">
                                    {ACTIVE_STATUSES.has(job.status)
                                      ? t('No request logs yet — sync is starting…')
                                      : t('No request logs recorded for this job.')}
                                  </Text>
                                );
                              }
                              const { summary } = logData;
                              return (
                                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                  {/* Summary bar */}
                                  {summary && (
                                    <Space wrap size="small" style={{ marginBottom: 4 }}>
                                      <Tag bordered={false} color="blue">
                                        {t('%s requests total', summary.total_requests)}
                                      </Tag>
                                      <Tag bordered={false} color="success">
                                        {t('%s succeeded', summary.success_count)}
                                      </Tag>
                                      {summary.failed_count > 0 && (
                                        <Tag bordered={false} color="error">
                                          {t('%s failed', summary.failed_count)}
                                        </Tag>
                                      )}
                                      <Tag bordered={false} color="default">
                                        {t('%s rows fetched', summary.total_rows_fetched.toLocaleString())}
                                      </Tag>
                                      <Tag bordered={false} color="default">
                                        {t('Total %s', formatDuration(summary.total_duration_ms / 1000))}
                                      </Tag>
                                    </Space>
                                  )}
                                  {/* Request log table */}
                                  <Table<DHIS2RequestLog>
                                    dataSource={logData.logs}
                                    rowKey="id"
                                    size="small"
                                    pagination={{ pageSize: 20, showSizeChanger: false, size: 'small' }}
                                    scroll={{ x: 900 }}
                                    rowClassName={(r) =>
                                      r.status === 'failed' ? 'ant-table-row-danger' : ''
                                    }
                                    columns={[
                                      {
                                        title: t('#'),
                                        dataIndex: 'request_seq',
                                        key: 'seq',
                                        width: 50,
                                        render: (v: number) => (
                                          <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>
                                        ),
                                      },
                                      {
                                        title: t('Instance'),
                                        dataIndex: 'instance_name',
                                        key: 'instance',
                                        width: 160,
                                        render: (v: string | null) => (
                                          <Text style={{ fontSize: 12 }}>{v || '—'}</Text>
                                        ),
                                      },
                                      {
                                        title: t('Status'),
                                        dataIndex: 'status',
                                        key: 'status',
                                        width: 90,
                                        render: (v: string) =>
                                          v === 'success' ? (
                                            <Tag icon={<CheckCircleOutlined />} color="success" style={{ fontSize: 11 }}>
                                              {t('OK')}
                                            </Tag>
                                          ) : (
                                            <Tag icon={<CloseCircleOutlined />} color="error" style={{ fontSize: 11 }}>
                                              {t('Failed')}
                                            </Tag>
                                          ),
                                      },
                                      {
                                        title: t('OU count'),
                                        dataIndex: 'ou_count',
                                        key: 'ou_count',
                                        width: 80,
                                        render: (v: number | null) => (
                                          <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text>
                                        ),
                                      },
                                      {
                                        title: t('DX count'),
                                        dataIndex: 'dx_count',
                                        key: 'dx_count',
                                        width: 80,
                                        render: (v: number | null) => (
                                          <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text>
                                        ),
                                      },
                                      {
                                        title: t('Pages'),
                                        dataIndex: 'pages_fetched',
                                        key: 'pages',
                                        width: 65,
                                        render: (v: number | null) => (
                                          <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text>
                                        ),
                                      },
                                      {
                                        title: t('Rows'),
                                        dataIndex: 'rows_returned',
                                        key: 'rows',
                                        width: 80,
                                        render: (v: number | null) => (
                                          <Text style={{ fontSize: 12 }}>
                                            {v !== null && v !== undefined ? v.toLocaleString() : '—'}
                                          </Text>
                                        ),
                                      },
                                      {
                                        title: t('Duration'),
                                        dataIndex: 'duration_ms',
                                        key: 'duration',
                                        width: 90,
                                        render: (v: number | null) => (
                                          <Text style={{ fontSize: 12 }}>
                                            {v !== null && v !== undefined
                                              ? v >= 1000
                                                ? `${(v / 1000).toFixed(1)}s`
                                                : `${v}ms`
                                              : '—'}
                                          </Text>
                                        ),
                                      },
                                      {
                                        title: t('HTTP'),
                                        dataIndex: 'http_status_code',
                                        key: 'http',
                                        width: 65,
                                        render: (v: number | null) =>
                                          v ? (
                                            <Tag
                                              color={v < 300 ? 'success' : v < 500 ? 'warning' : 'error'}
                                              style={{ fontSize: 11 }}
                                            >
                                              {v}
                                            </Tag>
                                          ) : (
                                            <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
                                          ),
                                      },
                                      {
                                        title: t('DHIS2 Code'),
                                        dataIndex: 'dhis2_error_code',
                                        key: 'error_code',
                                        width: 100,
                                        render: (v: string | null) =>
                                          v ? (
                                            <Tooltip title={t('DHIS2 server error code')}>
                                              <Tag color="volcano" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                                                {v}
                                              </Tag>
                                            </Tooltip>
                                          ) : (
                                            <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
                                          ),
                                      },
                                      {
                                        title: t('Started'),
                                        dataIndex: 'started_at',
                                        key: 'started_at',
                                        width: 140,
                                        render: (v: string | null) => (
                                          <Text type="secondary" style={{ fontSize: 11 }}>
                                            {formatDateTime(v)}
                                          </Text>
                                        ),
                                      },
                                      {
                                        title: t('Error'),
                                        dataIndex: 'error_message',
                                        key: 'error',
                                        ellipsis: true,
                                        render: (v: string | null) =>
                                          v ? (
                                            <Tooltip title={v}>
                                              <Text type="danger" ellipsis style={{ fontSize: 12, maxWidth: 320 }}>
                                                {v}
                                              </Text>
                                            </Tooltip>
                                          ) : (
                                            <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
                                          ),
                                      },
                                    ]}
                                  />
                                  {/* Highlight E7144 if present */}
                                  {logData.logs.some(l => l.dhis2_error_code === 'E7144') && (
                                    <Alert
                                      type="error"
                                      showIcon
                                      message={t('Analytics tables not built (E7144)')}
                                      description={t(
                                        'DHIS2 reported that analytics aggregation tables do not exist on this server. ' +
                                        'A DHIS2 administrator must run the Analytics job under Data Administration → Analytics before data can be exported.',
                                      )}
                                    />
                                  )}
                                </Space>
                              );
                            })(),
                          }] : []),
                        ]}
                      />
                    </div>
                  );
                },
                rowExpandable: () => true,
              }}
            />
          ) : (
            <Empty description={t('No jobs found for the selected filter.')} />
          )}
          {activeCount > 0 && (
            <div style={{ paddingTop: 8 }}>
              <Progress percent={100} status="active" showInfo={false} strokeWidth={4} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t(
                  '%s job(s) in progress — auto-refreshing every %s',
                  activeCount,
                  POLL_INTERVAL_LABEL,
                )}
              </Text>
            </div>
          )}
        </Card>
      </Space>
    </DHIS2PageLayout>
  );
}
