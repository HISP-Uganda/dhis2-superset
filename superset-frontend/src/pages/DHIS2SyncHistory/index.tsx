import { useCallback, useEffect, useRef, useState } from 'react';
import { SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Badge,
  Button,
  Card,
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
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  SyncOutlined,
} from '@ant-design/icons';

import { useToasts } from 'src/components/MessageToasts/withToasts';

import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import type { DHIS2AnyJob, DHIS2MetadataJob, DHIS2SyncJob } from 'src/features/dhis2/types';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import {
  formatDateTime,
  formatDuration,
  getErrorMessage,
  getStatusColor,
} from 'src/features/dhis2/utils';

const { Text } = Typography;
const POLL_INTERVAL_MS = 4000;
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

  const successCount = jobs.filter(j => j.status === 'success').length;
  const failedCount = jobs.filter(j => j.status === 'failed' || j.status === 'cancelled').length;
  const activeCount = jobs.filter(j => ACTIVE_STATUSES.has(j.status)).length;
  const metaCount = jobs.filter(j => j.job_category === 'metadata').length;

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

        <Card loading={loading} title={t('Jobs')}>
          {jobs.length ? (
            <Table
              dataSource={jobs}
              pagination={{ pageSize: 15, showSizeChanger: false }}
              rowKey={j => `${j.job_category}-${j.id}`}
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
                    const instCount = (mj.instance_ids || []).length;
                    return instCount
                      ? t('%s instance(s)', instCount)
                      : t('All instances');
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
                  width: 90,
                  render: (_: unknown, job: DHIS2AnyJob) => {
                    const loaded = job.rows_loaded ?? 0;
                    if (ACTIVE_STATUSES.has(job.status)) {
                      return (
                        <Space size={4}>
                          <SyncOutlined spin style={{ color: '#1677ff' }} />
                          <Text>{loaded}</Text>
                        </Space>
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
                      <Text type="secondary">{t('None')}</Text>
                    ),
                },
                {
                  title: t('Actions'),
                  key: 'actions',
                  width: 200,
                  render: (_: unknown, job: DHIS2AnyJob) => {
                    const isActive = ACTIVE_STATUSES.has(job.status);
                    const isTerminal = TERMINAL_STATUSES.has(job.status);
                    const isPaused = isSyncJob(job) && !isActive;

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
                          <Tooltip title={t('Restart with same parameters')}>
                            <Button
                              icon={<ReloadOutlined />}
                              loading={!!actionLoading[`${job.job_category}-${job.id}-restart`]}
                              size="small"
                              onClick={() => void callJobAction(job, 'restart')}
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
                expandedRowRender: (job: DHIS2AnyJob) => {
                  const results = job.instance_results || {};
                  const entries = Object.entries(results);
                  if (!entries.length) {
                    return <Text type="secondary">{t('No instance details')}</Text>;
                  }
                  return (
                    <Space direction="vertical" size="small">
                      {entries.map(([instId, result]) => {
                        const r = result as Record<string, unknown>;
                        return (
                          <Card key={instId} size="small">
                            <Space direction="vertical" size={0}>
                              <Text strong>{t('Instance %s', instId)}</Text>
                              {r.status !== undefined && (
                                <Text>{t('Status')}: {String(r.status)}</Text>
                              )}
                              {r.rows !== undefined && (
                                <Text>{t('Rows')}: {String(r.rows)}</Text>
                              )}
                              {r.error ? (
                                <Text type="danger">{String(r.error)}</Text>
                              ) : null}
                            </Space>
                          </Card>
                        );
                      })}
                    </Space>
                  );
                },
                rowExpandable: (job: DHIS2AnyJob) =>
                  Object.keys(job.instance_results || {}).length > 0,
              }}
            />
          ) : (
            <Empty description={t('No jobs found for the selected filter.')} />
          )}
          {activeCount > 0 && (
            <div style={{ paddingTop: 8 }}>
              <Progress percent={100} status="active" showInfo={false} strokeWidth={4} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('%s job(s) in progress — auto-refreshing every %ss',
                  activeCount, POLL_INTERVAL_MS / 1000)}
              </Text>
            </div>
          )}
        </Card>
      </Space>
    </DHIS2PageLayout>
  );
}
