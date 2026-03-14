import { useEffect, useState } from 'react';
import { SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Button,
  Card,
  Empty,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
} from 'antd';

import { useToasts } from 'src/components/MessageToasts/withToasts';

import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import type { DHIS2SyncJob } from 'src/features/dhis2/types';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import {
  formatDateTime,
  formatDuration,
  getErrorMessage,
  getStatusColor,
} from 'src/features/dhis2/utils';

const { Text } = Typography;

export default function DHIS2SyncHistory() {
  const { addDangerToast } = useToasts();
  const {
    databases,
    loading: loadingDatabases,
    selectedDatabaseId,
    setSelectedDatabaseId,
  } = useDHIS2Databases(addDangerToast);
  const [jobs, setJobs] = useState<DHIS2SyncJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(50);

  const loadJobs = async () => {
    if (!selectedDatabaseId) {
      setJobs([]);
      return;
    }
    setLoading(true);
    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/diagnostics/sync-history/${selectedDatabaseId}?limit=${limit}`,
      });
      setJobs((response.json.result || []) as DHIS2SyncJob[]);
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to load sync history')),
      );
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
  }, [selectedDatabaseId, limit]);

  const successCount = jobs.filter(job => job.status === 'success').length;
  const failedCount = jobs.filter(job => job.status === 'failed').length;
  const partialCount = jobs.filter(job => job.status === 'partial').length;

  return (
    <DHIS2PageLayout
      activeTab="sync-history"
      databases={databases}
      description={t(
        'Track manual and scheduled staging runs across the selected federation. Review dataset freshness, instance-level partial failures, and row movement from one screen.',
      )}
      extra={
        <Space wrap>
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
          <Button onClick={() => void loadJobs()}>{t('Refresh')}</Button>
        </Space>
      }
      loadingDatabases={loadingDatabases}
      selectedDatabaseId={selectedDatabaseId}
      title={t('Sync History')}
      onDatabaseChange={setSelectedDatabaseId}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space style={{ width: '100%' }} wrap>
          <Card style={{ minWidth: 180 }}>
            <Statistic title={t('Jobs loaded')} value={jobs.length} />
          </Card>
          <Card style={{ minWidth: 180 }}>
            <Statistic title={t('Successful')} value={successCount} />
          </Card>
          <Card style={{ minWidth: 180 }}>
            <Statistic title={t('Partial')} value={partialCount} />
          </Card>
          <Card style={{ minWidth: 180 }}>
            <Statistic title={t('Failed')} value={failedCount} />
          </Card>
        </Space>

        <Card loading={loading} title={t('Recent jobs')}>
          {jobs.length ? (
            <Table
              dataSource={jobs}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              rowKey="id"
              columns={[
                {
                  title: t('Dataset'),
                  dataIndex: 'staged_dataset_name',
                  key: 'dataset',
                  render: (_value: unknown, job: DHIS2SyncJob) =>
                    job.staged_dataset_name || `#${job.staged_dataset_id}`,
                },
                {
                  title: t('Type'),
                  dataIndex: 'job_type',
                  key: 'job_type',
                },
                {
                  title: t('Status'),
                  dataIndex: 'status',
                  key: 'status',
                  render: (value: string) => (
                    <Tag color={getStatusColor(value)}>{value}</Tag>
                  ),
                },
                {
                  title: t('Started'),
                  dataIndex: 'started_at',
                  key: 'started_at',
                  render: (value: string | null) => formatDateTime(value),
                },
                {
                  title: t('Completed'),
                  dataIndex: 'completed_at',
                  key: 'completed_at',
                  render: (value: string | null) => formatDateTime(value),
                },
                {
                  title: t('Duration'),
                  dataIndex: 'duration_seconds',
                  key: 'duration_seconds',
                  render: (value: number | null) => formatDuration(value),
                },
                {
                  title: t('Rows'),
                  key: 'rows',
                  render: (_value: unknown, job: DHIS2SyncJob) =>
                    `${job.rows_loaded ?? 0} / ${job.rows_failed ?? 0}`,
                },
                {
                  title: t('Instances'),
                  key: 'instance_results',
                  render: (_value: unknown, job: DHIS2SyncJob) => {
                    const entries = Object.entries(job.instance_results || {});
                    if (!entries.length) {
                      return <Text type="secondary">{t('No details')}</Text>;
                    }
                    return (
                      <Space wrap>
                        {entries.map(([instanceId, result]) => (
                          <Tag
                            key={instanceId}
                            color={getStatusColor(result.status)}
                          >
                            {instanceId}: {result.status || t('unknown')}
                          </Tag>
                        ))}
                      </Space>
                    );
                  },
                },
                {
                  title: t('Error'),
                  dataIndex: 'error_message',
                  key: 'error_message',
                  ellipsis: true,
                  render: (value: string | null) =>
                    value || <Text type="secondary">{t('None')}</Text>,
                },
              ]}
              expandable={{
                expandedRowRender: (job: DHIS2SyncJob) => {
                  const entries = Object.entries(job.instance_results || {});
                  if (!entries.length) {
                    return <Text type="secondary">{t('No instance breakdown')}</Text>;
                  }
                  return (
                    <Space direction="vertical" size="small">
                      {entries.map(([instanceId, result]) => (
                        <Card key={instanceId} size="small">
                          <Space direction="vertical" size={0}>
                            <Text strong>{t('Instance %s', instanceId)}</Text>
                            <Text>{t('Status')}: {result.status || t('unknown')}</Text>
                            <Text>{t('Rows')}: {result.rows ?? 0}</Text>
                            {result.error ? (
                              <Text type="danger">{result.error}</Text>
                            ) : null}
                          </Space>
                        </Card>
                      ))}
                    </Space>
                  );
                },
              }}
            />
          ) : (
            <Empty description={t('No sync jobs were found for this database.')} />
          )}
        </Card>
      </Space>
    </DHIS2PageLayout>
  );
}
