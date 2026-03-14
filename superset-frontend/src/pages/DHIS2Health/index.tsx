import { useEffect, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  List,
  Space,
  Statistic,
  Tag,
} from 'antd';

import { useToasts } from 'src/components/MessageToasts/withToasts';

import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import type {
  DHIS2AdminSummary,
  DHIS2FederationHealth,
  DHIS2HealthDatasetSummary,
  DHIS2StaleDataset,
} from 'src/features/dhis2/types';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import {
  formatDateTime,
  formatFreshness,
  getErrorMessage,
  getStatusColor,
} from 'src/features/dhis2/utils';

const { Text } = Typography;

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

  const loadHealth = async () => {
    if (!selectedDatabaseId) {
      setHealth(null);
      setStaleDatasets([]);
      return;
    }
    setLoading(true);
    try {
      const [healthResponse, staleResponse] = await Promise.all([
        SupersetClient.get({
          endpoint: `/api/v1/dhis2/diagnostics/health/${selectedDatabaseId}`,
        }),
        SupersetClient.get({
          endpoint: `/api/v1/dhis2/diagnostics/stale/${selectedDatabaseId}?threshold_hours=25`,
        }),
      ]);
      setHealth(healthResponse.json as DHIS2FederationHealth);
      setStaleDatasets(
        (staleResponse.json.result || []) as DHIS2StaleDataset[],
      );
    } catch (error) {
      addDangerToast(getErrorMessage(error, t('Failed to load health data')));
      setHealth(null);
      setStaleDatasets([]);
    } finally {
      setLoading(false);
    }
  };

  const loadAdminSummary = async () => {
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
  };

  useEffect(() => {
    void loadAdminSummary();
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [selectedDatabaseId]);

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

  return (
    <DHIS2PageLayout
      activeTab="health"
      databases={databases}
      description={t(
        'Monitor freshness, staging integrity, and recent sync behavior for the selected federation. Use this view to spot stale datasets, missing tables, and unhealthy sources quickly.',
      )}
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
              renderItem={dataset => (
                <List.Item>
                  <Card
                    style={{ width: '100%' }}
                    title={
                      <Space wrap>
                        <Text strong>{dataset.name}</Text>
                        <Tag color={dataset.is_active ? 'green' : 'default'}>
                          {dataset.is_active ? t('Active') : t('Inactive')}
                        </Tag>
                        <Tag color={getStatusColor(dataset.last_sync_status)}>
                          {dataset.last_sync_status || t('Never synced')}
                        </Tag>
                      </Space>
                    }
                    extra={
                      !dataset.staging_table_exists ? (
                        <Button
                          loading={repairingIds[dataset.id]}
                          onClick={() => void handleRepairTable(dataset)}
                        >
                          {t('Repair Table')}
                        </Button>
                      ) : null
                    }
                  >
                    <Descriptions bordered column={2} size="small">
                      <Descriptions.Item label={t('Last sync')}>
                        {formatDateTime(dataset.last_sync_at)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('Freshness')}>
                        {formatFreshness(dataset.freshness_minutes)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('Rows loaded')}>
                        {dataset.last_sync_rows ?? t('Unknown')}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('Rows in staging')}>
                        {dataset.staging_row_count ?? t('Unknown')}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('Staging table')}>
                        {dataset.staging_table_exists
                          ? t('Present')
                          : t('Missing')}
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
                </List.Item>
              )}
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
