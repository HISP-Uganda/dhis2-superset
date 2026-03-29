import { useEffect, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
} from 'antd';

import { useToasts } from 'src/components/MessageToasts/withToasts';
import type {
  DHIS2ConnectionTestResult,
  DHIS2Instance,
  DHIS2MetadataRefreshFamilyProgress,
  DHIS2MetadataRefreshInstanceProgress,
  DHIS2MetadataStatus,
} from 'src/features/dhis2/types';
import {
  formatCount,
  formatDateTime,
  getAuthColor,
  getAuthLabel,
  getErrorMessage,
  getStatusColor,
} from 'src/features/dhis2/utils';

const { Paragraph, Text } = Typography;

const SummaryGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: ${theme.sizeUnit * 4}px;

    @media (max-width: 1200px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (max-width: 900px) {
      grid-template-columns: 1fr;
    }
  `}
`;

const CardMeta = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit * 2}px;
  `}
`;

const ConnectionActions = styled.div`
  ${({ theme }) => css`
    display: flex;
    justify-content: space-between;
    gap: ${theme.sizeUnit * 2}px;
    flex-wrap: wrap;
    margin-top: ${theme.sizeUnit * 4}px;
  `}
`;

const ProgressSection = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit * 3}px;
  `}
`;

interface DHIS2ConfiguredConnectionsPanelProps {
  databaseId?: number;
  databaseName?: string;
  onInstancesChange?: (instances: DHIS2Instance[]) => void;
}

interface ConnectionFormValues {
  name: string;
  url: string;
  description?: string;
  auth_type: 'basic' | 'pat';
  display_order: number;
  username?: string;
  password?: string;
  access_token?: string;
  is_active: boolean;
}

export default function DHIS2ConfiguredConnectionsPanel({
  databaseId,
  databaseName,
  onInstancesChange,
}: DHIS2ConfiguredConnectionsPanelProps) {
  const { addDangerToast, addInfoToast, addSuccessToast } = useToasts();
  const [instances, setInstances] = useState<DHIS2Instance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metadataStatus, setMetadataStatus] = useState<DHIS2MetadataStatus | null>(
    null,
  );
  const [metadataStatusLoading, setMetadataStatusLoading] = useState(false);
  const [metadataStatusError, setMetadataStatusError] = useState<string | null>(
    null,
  );
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingInstance, setEditingInstance] = useState<DHIS2Instance | null>(
    null,
  );
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<
    Record<number, DHIS2ConnectionTestResult>
  >({});
  const [form] = Form.useForm<ConnectionFormValues>();
  const authType = Form.useWatch('auth_type', form) || 'basic';

  const formatMetadataStatus = (
    status?: DHIS2MetadataStatus['overall_status'],
  ): string => {
    switch (status) {
      case 'ready':
        return t('Ready');
      case 'partial':
        return t('Partially ready');
      case 'pending':
        return t('Loading');
      case 'failed':
        return t('Failed');
      case 'missing':
        return t('Not staged yet');
      default:
        return t('Unknown');
    }
  };

  const formatRefreshProgressStatus = (status?: string | null): string => {
    switch (status) {
      case 'queued':
        return t('Queued');
      case 'running':
        return t('Loading');
      case 'partial':
        return t('Loading with some failures');
      case 'complete':
        return t('Completed');
      case 'failed':
        return t('Failed');
      default:
        return t('Unknown');
    }
  };

  const getProgressStatus = (
    status?: string | null,
  ): 'normal' | 'success' | 'exception' | 'active' => {
    switch (status) {
      case 'queued':
      case 'running':
        return 'active';
      case 'complete':
        return 'success';
      case 'failed':
        return 'exception';
      default:
        return 'normal';
    }
  };

  const formatRefreshProgressCounter = (
    progress?:
      | DHIS2MetadataRefreshFamilyProgress
      | DHIS2MetadataRefreshInstanceProgress
      | null,
  ): string => {
    if (!progress) {
      return t('Waiting for staged metadata');
    }
    if (
      progress.total_count_estimate !== null &&
      progress.total_count_estimate !== undefined &&
      progress.total_count_estimate > 0
    ) {
      return t(
        '%s of %s loaded',
        formatCount(progress.loaded_count),
        formatCount(progress.total_count_estimate),
      );
    }
    return t('%s loaded', formatCount(progress.loaded_count));
  };

  const loadMetadataStatus = async () => {
    if (!databaseId) {
      setMetadataStatus(null);
      setMetadataStatusError(null);
      return;
    }
    setMetadataStatusLoading(true);
    setMetadataStatusError(null);
    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/diagnostics/metadata-status/${databaseId}`,
      });
      setMetadataStatus(
        ((response.json as { result?: DHIS2MetadataStatus })?.result ||
          null) as DHIS2MetadataStatus | null,
      );
    } catch (error) {
      const message = getErrorMessage(
        error,
        t('Failed to load metadata staging status'),
      );
      setMetadataStatus(null);
      setMetadataStatusError(message);
    } finally {
      setMetadataStatusLoading(false);
    }
  };

  const loadInstances = async () => {
    if (!databaseId) {
      setInstances([]);
      setLoadError(null);
      onInstancesChange?.([]);
      return;
    }
    setLoadingInstances(true);
    setLoadError(null);
    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/instances/?database_id=${databaseId}&include_inactive=true`,
      });
      const nextInstances = ((response.json.result || []) as DHIS2Instance[]).sort(
        (left, right) => {
          if (left.is_active !== right.is_active) {
            return left.is_active ? -1 : 1;
          }
          if ((left.display_order || 0) !== (right.display_order || 0)) {
            return (left.display_order || 0) - (right.display_order || 0);
          }
          return left.name.localeCompare(right.name);
        },
      );
      setInstances(nextInstances);
      onInstancesChange?.(nextInstances);
    } catch (error) {
      const message = getErrorMessage(
        error,
        t('Failed to load configured DHIS2 connections'),
      );
      addDangerToast(message);
      setLoadError(message);
      setInstances([]);
      onInstancesChange?.([]);
    } finally {
      setLoadingInstances(false);
    }
  };

  useEffect(() => {
    void loadInstances();
    void loadMetadataStatus();
  }, [databaseId]);

  useEffect(() => {
    if (
      !databaseId ||
      !metadataStatus ||
      !(
        ['pending', 'partial', 'missing'].includes(metadataStatus.overall_status) ||
        ['queued', 'running', 'partial'].includes(
          metadataStatus.refresh_progress?.status || '',
        )
      )
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadMetadataStatus();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [databaseId, metadataStatus]);

  const handleRefreshMetadata = async () => {
    if (!databaseId) {
      return;
    }
    setRefreshingMetadata(true);
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/dhis2/diagnostics/metadata-refresh/${databaseId}`,
      });
      addSuccessToast(t('Queued a staged metadata refresh.'));
      await loadMetadataStatus();
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to queue a staged metadata refresh')),
      );
    } finally {
      setRefreshingMetadata(false);
    }
  };

  const openCreateModal = () => {
    setEditingInstance(null);
    form.resetFields();
    form.setFieldsValue({
      auth_type: 'basic',
      display_order: instances.length * 10,
      is_active: true,
    });
    setModalOpen(true);
  };

  const openEditModal = (instance: DHIS2Instance) => {
    setEditingInstance(instance);
    form.resetFields();
    form.setFieldsValue({
      name: instance.name,
      url: instance.url,
      description: instance.description || '',
      auth_type: instance.auth_type,
      display_order: instance.display_order || 0,
      username: instance.username || '',
      password: '',
      access_token: '',
      is_active: instance.is_active,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingInstance(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    if (!databaseId) {
      return;
    }
    try {
      const values = await form.validateFields();
      const payload: Record<string, unknown> = {
        name: values.name.trim(),
        url: values.url.trim(),
        description: values.description?.trim() || null,
        auth_type: values.auth_type,
        display_order: values.display_order || 0,
        is_active: values.is_active,
      };

      if (values.auth_type === 'basic') {
        payload.username = values.username?.trim() || '';
        payload.password = editingInstance
          ? values.password?.trim() || null
          : values.password?.trim() || '';
        if (editingInstance?.auth_type === 'pat') {
          payload.access_token = '';
        }
      } else {
        payload.access_token = editingInstance
          ? values.access_token?.trim() || null
          : values.access_token?.trim() || '';
        if (editingInstance?.auth_type === 'basic') {
          payload.username = '';
          payload.password = '';
        }
      }

      if (!editingInstance) {
        payload.database_id = databaseId;
      }

      setSubmitting(true);
      try {
        if (editingInstance) {
          await SupersetClient.put({
            endpoint: `/api/v1/dhis2/instances/${editingInstance.id}`,
            jsonPayload: payload,
          });
          addSuccessToast(
            t('Updated configured DHIS2 connection: %s', values.name),
          );
        } else {
          await SupersetClient.post({
            endpoint: '/api/v1/dhis2/instances/',
            jsonPayload: payload,
          });
          addSuccessToast(
            t('Created configured DHIS2 connection: %s', values.name),
          );
        }
        closeModal();
        await loadInstances();
        await loadMetadataStatus();
      } catch (error) {
        addDangerToast(
          getErrorMessage(error, t('Failed to save configured connection')),
        );
      } finally {
        setSubmitting(false);
      }
    } catch {
      return;
    }
  };

  const handleTestConnection = async (instance: DHIS2Instance) => {
    setTestingId(instance.id);
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/dhis2/instances/${instance.id}/test`,
      });
      const result = response.json.result as DHIS2ConnectionTestResult;
      setTestResults(current => ({
        ...current,
        [instance.id]: result,
      }));
      setInstances(current =>
        current.map(candidate =>
          candidate.id === instance.id
            ? {
                ...candidate,
                last_test_status: result.success ? 'success' : 'failed',
                last_test_message: result.message,
                last_test_response_time_ms: result.response_time_ms ?? null,
                last_tested_on: new Date().toISOString(),
                last_test_result: {
                  status: result.success ? 'success' : 'failed',
                  message: result.message,
                  response_time_ms: result.response_time_ms ?? null,
                  tested_on: new Date().toISOString(),
                },
              }
            : candidate,
        ),
      );
      if (result.success) {
        addSuccessToast(t('Connection test succeeded for %s', instance.name));
      } else {
        addDangerToast(result.message || t('Connection test failed'));
      }
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Connection test failed unexpectedly')),
      );
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (instance: DHIS2Instance) => {
    try {
      await SupersetClient.delete({
        endpoint: `/api/v1/dhis2/instances/${instance.id}`,
      });
      addSuccessToast(t('Deleted configured connection: %s', instance.name));
      await loadInstances();
      await loadMetadataStatus();
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to delete configured connection')),
      );
    }
  };

  const handleToggleActive = async (
    instance: DHIS2Instance,
    isActive: boolean,
  ) => {
    try {
      await SupersetClient.put({
        endpoint: `/api/v1/dhis2/instances/${instance.id}`,
        jsonPayload: { is_active: isActive },
      });
      addSuccessToast(
        isActive
          ? t('Enabled configured connection: %s', instance.name)
          : t('Disabled configured connection: %s', instance.name),
      );
      await loadInstances();
      await loadMetadataStatus();
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to update configured connection')),
      );
    }
  };

  const handleMigrateLegacy = async () => {
    if (!databaseId) {
      return;
    }
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/dhis2/instances/migrate-legacy',
        jsonPayload: { database_id: databaseId },
      });
      if (response.json.result) {
        addSuccessToast(t('Migrated the legacy DHIS2 connection into a configured connection.'));
        await loadInstances();
        await loadMetadataStatus();
        return;
      }
      addInfoToast(t('No legacy DHIS2 connection was found on this Database.'));
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to migrate legacy configuration')),
      );
    }
  };

  const activeCount = instances.filter(instance => instance.is_active).length;
  const inactiveCount = instances.length - activeCount;

  if (!databaseId) {
    return (
      <Alert
        showIcon
        type="info"
        message={t('Save the Database first')}
        description={t(
          'Create the DHIS2 Database first, then add one or more configured DHIS2 connections under it.',
        )}
      />
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        showIcon
        type="info"
        message={t('Configured DHIS2 connections belong to this Database')}
        description={
          databaseName
            ? t(
                'Manage the named DHIS2 endpoints, credentials, and health checks that belong to %s. Database-level credentials remain available only as a backward-compatible fallback.',
                databaseName,
              )
            : t(
                'Manage the named DHIS2 endpoints, credentials, and health checks that belong to this Database. Database-level credentials remain available only as a backward-compatible fallback.',
              )
        }
      />

      <SummaryGrid>
        <Card>
          <Statistic title={t('Configured connections')} value={instances.length} />
        </Card>
        <Card>
          <Statistic title={t('Active connections')} value={activeCount} />
        </Card>
        <Card>
          <Statistic title={t('Inactive connections')} value={inactiveCount} />
        </Card>
      </SummaryGrid>

      <Card
        loading={metadataStatusLoading}
        title={t('Local metadata staging')}
        extra={
          <Space wrap>
            <Button onClick={() => void loadMetadataStatus()}>{t('Refresh status')}</Button>
            <Button
              loading={refreshingMetadata}
              type="primary"
              onClick={() => void handleRefreshMetadata()}
            >
              {t('Refresh staged metadata')}
            </Button>
          </Space>
        }
      >
        {metadataStatusError ? (
          <Alert
            showIcon
            type="warning"
            message={t('Metadata staging status unavailable')}
            description={metadataStatusError}
          />
        ) : metadataStatus ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <SummaryGrid>
              <Card>
                <Statistic
                  title={t('Overall status')}
                  value={formatMetadataStatus(metadataStatus.overall_status)}
                />
              </Card>
              <Card>
                <Statistic
                  title={t('Variables staged')}
                  value={`${metadataStatus.variables.count} (${formatMetadataStatus(
                    metadataStatus.variables.status,
                  )})`}
                />
              </Card>
              <Card>
                <Statistic
                  title={t('Org units staged')}
                  value={`${metadataStatus.org_units.count} (${formatMetadataStatus(
                    metadataStatus.org_units.status,
                  )})`}
                />
              </Card>
              <Card>
                <Statistic
                  title={t('Legend sets staged')}
                  value={`${
                    metadataStatus.legend_sets?.count ?? 0
                  } (${formatMetadataStatus(
                    metadataStatus.legend_sets?.status || 'missing',
                  )})`}
                />
              </Card>
            </SummaryGrid>
            <Space wrap>
              <Tag color={getStatusColor(metadataStatus.overall_status)}>
                {t('Status: %s', formatMetadataStatus(metadataStatus.overall_status))}
              </Tag>
              <Tag color={getStatusColor(metadataStatus.variables.status)}>
                {t('Variables: %s', formatMetadataStatus(metadataStatus.variables.status))}
              </Tag>
              <Tag color={getStatusColor(metadataStatus.org_units.status)}>
                {t('Org units: %s', formatMetadataStatus(metadataStatus.org_units.status))}
              </Tag>
              {metadataStatus.legend_sets ? (
                <Tag color={getStatusColor(metadataStatus.legend_sets.status)}>
                  {t(
                    'Legend sets: %s',
                    formatMetadataStatus(metadataStatus.legend_sets.status),
                  )}
                </Tag>
              ) : null}
            </Space>
            <Text type="secondary">
              {t('Last refreshed')}: {formatDateTime(metadataStatus.last_refreshed_at)}
            </Text>
            {metadataStatus.refresh_progress &&
            ['queued', 'running', 'partial'].includes(
              metadataStatus.refresh_progress.status,
            ) ? (
              <ProgressSection>
                <Card size="small">
                  <Space
                    align="center"
                    style={{ justifyContent: 'space-between', width: '100%' }}
                    wrap
                  >
                    <Text strong>{t('Background metadata refresh')}</Text>
                    <Tag color={getStatusColor(metadataStatus.refresh_progress.status)}>
                      {formatRefreshProgressStatus(
                        metadataStatus.refresh_progress.status,
                      )}
                    </Tag>
                  </Space>
                  <Progress
                    percent={metadataStatus.refresh_progress.overall.percent_complete}
                    status={getProgressStatus(metadataStatus.refresh_progress.status)}
                    strokeColor="#1677ff"
                    style={{ marginTop: 12, marginBottom: 8 }}
                  />
                  <Text type="secondary">
                    {t(
                      '%s of %s staging steps completed.',
                      formatCount(
                        metadataStatus.refresh_progress.overall.completed_units,
                      ),
                      formatCount(metadataStatus.refresh_progress.overall.total_units),
                    )}
                  </Text>
                </Card>
                {(
                  [
                    {
                      key: 'variables',
                      label: t('Variables metadata'),
                      progress: metadataStatus.refresh_progress.variables,
                      strokeColor: '#1677ff',
                    },
                    {
                      key: 'legend_sets',
                      label: t('Legend sets metadata'),
                      progress: metadataStatus.refresh_progress.legend_sets,
                      strokeColor: '#fa8c16',
                    },
                    {
                      key: 'org_units',
                      label: t('Organisation units metadata'),
                      progress: metadataStatus.refresh_progress.org_units,
                      strokeColor: '#13a8a8',
                    },
                  ] as Array<{
                    key: string;
                    label: string;
                    progress?: DHIS2MetadataRefreshFamilyProgress;
                    strokeColor: string;
                  }>
                ).flatMap(section => {
                  const progress = section.progress;
                  if (
                    !progress ||
                    (progress.total_units <= 0 && progress.loaded_count <= 0)
                  ) {
                    return [];
                  }

                  return [
                    <Card key={section.key} size="small">
                    <Space
                      align="center"
                      style={{ justifyContent: 'space-between', width: '100%' }}
                      wrap
                    >
                      <div>
                        <Text strong>{section.label}</Text>
                        <div>
                          <Text type="secondary">
                            {formatRefreshProgressCounter(progress)}
                          </Text>
                        </div>
                      </div>
                      <Tag color={getStatusColor(progress.status)}>
                        {formatRefreshProgressStatus(progress.status)}
                      </Tag>
                    </Space>
                    <Progress
                      percent={progress.percent_complete}
                      status={getProgressStatus(progress.status)}
                      strokeColor={section.strokeColor}
                      style={{ marginTop: 12, marginBottom: 8 }}
                    />
                    {progress.instances.map(instance => (
                      <div key={`${section.key}-${instance.id}`} style={{ marginTop: 10 }}>
                        <Space
                          align="center"
                          style={{ justifyContent: 'space-between', width: '100%' }}
                          wrap
                        >
                          <Text>{instance.name}</Text>
                          <Text type="secondary">
                            {instance.percent_complete}% •{' '}
                            {formatRefreshProgressCounter(instance)}
                          </Text>
                        </Space>
                        <Progress
                          percent={instance.percent_complete}
                          showInfo={false}
                          size="small"
                          status={getProgressStatus(instance.status)}
                          strokeColor={section.strokeColor}
                        />
                      </div>
                    ))}
                  </Card>
                  ];
                })}
              </ProgressSection>
            ) : null}
          </Space>
        ) : (
          <Empty
            description={t(
              'No metadata staging status is available yet for this Database.',
            )}
          />
        )}
      </Card>

      <Card
        loading={loadingInstances}
        title={t('Configured DHIS2 Connections')}
        extra={
          <Space wrap>
            <Button onClick={() => void loadInstances()}>{t('Refresh')}</Button>
            <Button type="primary" onClick={openCreateModal}>
              {t('Add Connection')}
            </Button>
          </Space>
        }
      >
        {loadError ? (
          <Alert
            showIcon
            type="error"
            message={t('Unable to load configured connections')}
            description={loadError}
            style={{ marginBottom: 16 }}
            action={<Button onClick={() => void loadInstances()}>{t('Retry')}</Button>}
          />
        ) : null}
        {instances.length ? (
          <List
            dataSource={instances}
            grid={{ gutter: 16, column: 2 }}
            renderItem={instance => {
              const testResult = testResults[instance.id];
              const effectiveResult = testResult
                ? {
                    status: testResult.success ? 'success' : 'failed',
                    message: testResult.message,
                  }
                : instance.last_test_result;
              return (
                <List.Item>
                  <Card
                    title={
                      <Space wrap>
                        <Text strong>{instance.name}</Text>
                        <Tag color={instance.is_active ? 'green' : 'default'}>
                          {instance.is_active ? t('Active') : t('Inactive')}
                        </Tag>
                        <Tag>{t('Order %s', instance.display_order || 0)}</Tag>
                        <Tag color={getAuthColor(instance.auth_type)}>
                          {getAuthLabel(instance.auth_type)}
                        </Tag>
                        {effectiveResult?.status === 'success' ? (
                          <Tag color="success">{t('Healthy')}</Tag>
                        ) : null}
                        {effectiveResult?.status === 'failed' ? (
                          <Tag color="error">{t('Test failed')}</Tag>
                        ) : null}
                      </Space>
                    }
                  >
                    <CardMeta>
                      <Text>{instance.url}</Text>
                      {instance.description ? (
                        <Paragraph style={{ marginBottom: 0 }}>
                          {instance.description}
                        </Paragraph>
                      ) : (
                        <Text type="secondary">{t('No description provided')}</Text>
                      )}
                      <Text type="secondary">
                        {t('Updated')} {formatDateTime(instance.changed_on)}
                      </Text>
                      {effectiveResult ? (
                        <Alert
                          description={effectiveResult.message}
                          message={
                            effectiveResult.status === 'success' ||
                            (testResult && testResult.success)
                              ? t('Connection OK')
                              : t('Connection failed')
                          }
                          showIcon
                          type={
                            effectiveResult.status === 'success' ||
                            (testResult && testResult.success)
                              ? 'success'
                              : 'error'
                          }
                        />
                      ) : null}
                      {instance.last_tested_on ? (
                        <Text type="secondary">
                          {t('Last tested')} {formatDateTime(instance.last_tested_on)}
                        </Text>
                      ) : null}
                    </CardMeta>
                    <ConnectionActions>
                      <Space wrap>
                        <Button
                          loading={testingId === instance.id}
                          onClick={() => handleTestConnection(instance)}
                        >
                          {t('Test Connection')}
                        </Button>
                        <Button onClick={() => openEditModal(instance)}>
                          {t('Edit')}
                        </Button>
                        <Popconfirm
                          okText={t('Delete')}
                          title={t('Delete %s?', instance.name)}
                          onConfirm={() => handleDelete(instance)}
                        >
                          <Button danger>{t('Delete')}</Button>
                        </Popconfirm>
                      </Space>
                      <Space>
                        <Text type="secondary">{t('Active')}</Text>
                        <Switch
                          checked={instance.is_active}
                          onChange={checked =>
                            void handleToggleActive(instance, checked)
                          }
                        />
                      </Space>
                    </ConnectionActions>
                  </Card>
                </List.Item>
              );
            }}
          />
        ) : (
          <Empty
            description={t(
              'No configured DHIS2 connections exist under this Database yet.',
            )}
          >
            <Space wrap>
              <Button type="primary" onClick={openCreateModal}>
                {t('Add Connection')}
              </Button>
              <Button onClick={() => void handleMigrateLegacy()}>
                {t('Migrate Legacy Connection')}
              </Button>
            </Space>
          </Empty>
        )}
      </Card>

      <Modal
        cancelText={t('Cancel')}
        destroyOnHidden
        okButtonProps={{ loading: submitting }}
        okText={t('Save')}
        open={modalOpen}
        title={
          editingInstance
            ? t('Edit Configured DHIS2 Connection')
            : t('Add Configured DHIS2 Connection')
        }
        onCancel={closeModal}
        onOk={() => void handleSubmit()}
      >
          <Form
          form={form}
          initialValues={{ auth_type: 'basic', display_order: 0, is_active: true }}
          layout="vertical"
        >
          <Form.Item
            label={t('Connection Name')}
            name="name"
            rules={[{ required: true, message: t('A name is required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label={t('Base URL')}
            name="url"
            rules={[
              { required: true, message: t('A DHIS2 URL is required') },
              { type: 'url', message: t('Enter a valid URL') },
            ]}
          >
            <Input placeholder="https://hmis.example.org" />
          </Form.Item>
          <Form.Item label={t('Description')} name="description">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
          <Form.Item
            label={t('Display Order')}
            name="display_order"
            tooltip={t('Lower numbers are shown first in the dataset builder.')}
          >
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label={t('Authentication Type')}
            name="auth_type"
            rules={[
              {
                required: true,
                message: t('Choose an authentication type'),
              },
            ]}
          >
            <Select
              options={[
                { label: t('Basic authentication'), value: 'basic' },
                { label: t('Personal access token'), value: 'pat' },
              ]}
            />
          </Form.Item>
          {authType === 'basic' ? (
            <>
              <Form.Item
                label={t('Username')}
                name="username"
                rules={[
                  { required: true, message: t('A username is required') },
                ]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                extra={
                  editingInstance
                    ? t('Leave blank to keep the stored password.')
                    : undefined
                }
                label={t('Password')}
                name="password"
                rules={
                  editingInstance
                    ? []
                    : [{ required: true, message: t('A password is required') }]
                }
              >
                <Input.Password />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              extra={
                editingInstance
                  ? t('Leave blank to keep the stored token.')
                  : undefined
              }
              label={t('Access Token')}
              name="access_token"
              rules={
                editingInstance
                  ? []
                  : [{ required: true, message: t('A token is required') }]
              }
            >
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item label={t('Active')} name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
