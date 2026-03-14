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
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
} from 'antd';

import { useToasts } from 'src/components/MessageToasts/withToasts';

import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import type {
  DHIS2ConnectionTestResult,
  DHIS2Instance,
} from 'src/features/dhis2/types';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import {
  formatDateTime,
  getAuthColor,
  getAuthLabel,
  getErrorMessage,
} from 'src/features/dhis2/utils';

const { Paragraph, Text } = Typography;

const SummaryGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: ${theme.sizeUnit * 4}px;

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

const InstanceActions = styled.div`
  ${({ theme }) => css`
    display: flex;
    justify-content: space-between;
    gap: ${theme.sizeUnit * 2}px;
    flex-wrap: wrap;
    margin-top: ${theme.sizeUnit * 4}px;
  `}
`;

interface InstanceFormValues {
  name: string;
  url: string;
  description?: string;
  auth_type: 'basic' | 'pat';
  username?: string;
  password?: string;
  access_token?: string;
  is_active: boolean;
}

export default function DHIS2Instances() {
  const { addDangerToast, addInfoToast, addSuccessToast } = useToasts();
  const {
    databases,
    loading: loadingDatabases,
    selectedDatabaseId,
    setSelectedDatabaseId,
  } = useDHIS2Databases(addDangerToast);
  const [instances, setInstances] = useState<DHIS2Instance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingInstance, setEditingInstance] = useState<DHIS2Instance | null>(
    null,
  );
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<
    Record<number, DHIS2ConnectionTestResult>
  >({});
  const [form] = Form.useForm<InstanceFormValues>();
  const authType = Form.useWatch('auth_type', form) || 'basic';

  const loadInstances = async () => {
    if (!selectedDatabaseId) {
      setInstances([]);
      return;
    }
    setLoadingInstances(true);
    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/instances/?database_id=${selectedDatabaseId}&include_inactive=true`,
      });
      setInstances((response.json.result || []) as DHIS2Instance[]);
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to load DHIS2 instances')),
      );
      setInstances([]);
    } finally {
      setLoadingInstances(false);
    }
  };

  useEffect(() => {
    void loadInstances();
  }, [selectedDatabaseId]);

  const openCreateModal = () => {
    setEditingInstance(null);
    form.resetFields();
    form.setFieldsValue({
      auth_type: 'basic',
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
    if (!selectedDatabaseId) {
      return;
    }
    try {
      const values = await form.validateFields();
      const payload: Record<string, unknown> = {
        name: values.name.trim(),
        url: values.url.trim(),
        description: values.description?.trim() || null,
        auth_type: values.auth_type,
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
        payload.database_id = selectedDatabaseId;
      }

      setSubmitting(true);
      try {
        if (editingInstance) {
          await SupersetClient.put({
            endpoint: `/api/v1/dhis2/instances/${editingInstance.id}`,
            jsonPayload: payload,
          });
          addSuccessToast(t('Updated DHIS2 instance: %s', values.name));
        } else {
          await SupersetClient.post({
            endpoint: '/api/v1/dhis2/instances/',
            jsonPayload: payload,
          });
          addSuccessToast(t('Created DHIS2 instance: %s', values.name));
        }
        closeModal();
        await loadInstances();
      } catch (error) {
        addDangerToast(
          getErrorMessage(error, t('Failed to save DHIS2 instance')),
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
      addSuccessToast(t('Deleted DHIS2 instance: %s', instance.name));
      await loadInstances();
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to delete DHIS2 instance')),
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
          ? t('Enabled DHIS2 instance: %s', instance.name)
          : t('Disabled DHIS2 instance: %s', instance.name),
      );
      await loadInstances();
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to update instance status')),
      );
    }
  };

  const handleMigrateLegacy = async () => {
    if (!selectedDatabaseId) {
      return;
    }
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/dhis2/instances/migrate-legacy',
        jsonPayload: { database_id: selectedDatabaseId },
      });
      if (response.json.result) {
        addSuccessToast(t('Migrated legacy DHIS2 configuration'));
        await loadInstances();
        return;
      }
      addInfoToast(t('No legacy DHIS2 configuration was found.'));
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to migrate legacy configuration')),
      );
    }
  };

  const activeCount = instances.filter(instance => instance.is_active).length;
  const inactiveCount = instances.length - activeCount;

  return (
    <DHIS2PageLayout
      activeTab="instances"
      databases={databases}
      description={t(
        'Manage every DHIS2 source that belongs to the selected logical Superset database. Each instance keeps its own credentials, status, and connection checks.',
      )}
      extra={
        <Button data-test="dhis2-add-instance" type="primary" onClick={openCreateModal}>
          {t('Add Instance')}
        </Button>
      }
      loadingDatabases={loadingDatabases}
      selectedDatabaseId={selectedDatabaseId}
      title={t('DHIS2 Instances')}
      onDatabaseChange={setSelectedDatabaseId}
    >
      <SummaryGrid>
        <Card>
          <Statistic title={t('Configured instances')} value={instances.length} />
        </Card>
        <Card>
          <Statistic title={t('Active instances')} value={activeCount} />
        </Card>
        <Card>
          <Statistic title={t('Inactive instances')} value={inactiveCount} />
        </Card>
      </SummaryGrid>

      <Card loading={loadingInstances} title={t('Instance registry')}>
        {instances.length ? (
          <List
            dataSource={instances}
            grid={{ gutter: 16, column: 2 }}
            renderItem={instance => {
              const testResult = testResults[instance.id];
              return (
                <List.Item>
                  <Card
                    title={
                      <Space wrap>
                        <Text strong>{instance.name}</Text>
                        <Tag color={instance.is_active ? 'green' : 'default'}>
                          {instance.is_active ? t('Active') : t('Inactive')}
                        </Tag>
                        <Tag color={getAuthColor(instance.auth_type)}>
                          {getAuthLabel(instance.auth_type)}
                        </Tag>
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
                        <Text type="secondary">
                          {t('No description provided')}
                        </Text>
                      )}
                      <Text type="secondary">
                        {t('Updated')} {formatDateTime(instance.changed_on)}
                      </Text>
                      {testResult ? (
                        <Alert
                          message={
                            testResult.success
                              ? t('Connection OK')
                              : t('Connection failed')
                          }
                          showIcon
                          type={testResult.success ? 'success' : 'error'}
                          description={testResult.message}
                        />
                      ) : null}
                    </CardMeta>
                    <InstanceActions>
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
                    </InstanceActions>
                  </Card>
                </List.Item>
              );
            }}
          />
        ) : (
          <Empty
            description={t(
              'No DHIS2 instances are configured for this database yet.',
            )}
          >
            <Space>
              <Button type="primary" onClick={openCreateModal}>
                {t('Add Instance')}
              </Button>
              <Button onClick={() => void handleMigrateLegacy()}>
                {t('Migrate Legacy Config')}
              </Button>
            </Space>
          </Empty>
        )}
      </Card>

      <Modal
        cancelText={t('Cancel')}
        destroyOnClose
        okButtonProps={{ loading: submitting }}
        okText={t('Save')}
        open={modalOpen}
        title={
          editingInstance ? t('Edit DHIS2 Instance') : t('Add DHIS2 Instance')
        }
        onCancel={closeModal}
        onOk={() => void handleSubmit()}
      >
        <Form
          form={form}
          initialValues={{ auth_type: 'basic', is_active: true }}
          layout="vertical"
        >
          <Form.Item
            label={t('Name')}
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
            label={t('Authentication type')}
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
              label={t('Access token')}
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
    </DHIS2PageLayout>
  );
}
