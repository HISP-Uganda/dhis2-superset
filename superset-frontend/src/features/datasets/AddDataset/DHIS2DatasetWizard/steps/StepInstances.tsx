import { useState, useEffect, useCallback } from 'react';
import { styled, SupersetClient } from '@superset-ui/core';
import { Button, Tag, Alert } from 'antd';
import { Typography, Loading } from '@superset-ui/core/components';

const { Title, Paragraph, Text } = Typography;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DHIS2InstanceInfo {
  id: number;
  name: string;
  url: string;
  auth_type: 'basic' | 'pat';
  is_active: boolean;
  description?: string;
}

export interface StepInstancesProps {
  databaseId: number;
  selectedInstanceIds: number[];
  onChange: (selectedIds: number[]) => void;
}

// ─── Styled components ───────────────────────────────────────────────────────

const StepContainer = styled.div`
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const InstanceGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const InstanceCard = styled.div<{ selected: boolean; inactive: boolean }>`
  ${({ theme, selected, inactive }) => `
    background: ${selected ? theme.colorPrimaryBg : theme.colorBgElevated};
    border: 2px solid ${selected ? theme.colorPrimary : theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    padding: 16px;
    cursor: ${inactive ? 'default' : 'pointer'};
    opacity: ${inactive ? 0.65 : 1};
    transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
    display: flex;
    align-items: flex-start;
    gap: 16px;

    &:hover {
      border-color: ${inactive ? theme.colorBorder : selected ? theme.colorPrimaryActive : theme.colorPrimaryHover};
      box-shadow: ${inactive ? 'none' : `0 2px 8px ${theme.colorBorderSecondary}`};
    }
  `}
`;

const InstanceCheckbox = styled.div<{ selected: boolean }>`
  ${({ theme, selected }) => `
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: 2px solid ${selected ? theme.colorPrimary : theme.colorBorder};
    background: ${selected ? theme.colorPrimary : 'transparent'};
    flex-shrink: 0;
    margin-top: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: #fff;
    font-size: 12px;
  `}
`;

const InstanceBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const InstanceHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
`;

const InstanceName = styled.span`
  ${({ theme }) => `
    font-weight: 600;
    font-size: 14px;
    color: ${theme.colorText};
  `}
`;

const InstanceUrl = styled.div`
  ${({ theme }) => `
    font-size: 12px;
    color: ${theme.colorTextSecondary};
    margin-bottom: 4px;
    word-break: break-all;
  `}
`;

const InstanceDescription = styled.div`
  ${({ theme }) => `
    font-size: 12px;
    color: ${theme.colorTextSecondary};
    margin-top: 4px;
  `}
`;

const InstanceActions = styled.div`
  display: flex;
  align-items: flex-start;
  flex-shrink: 0;
`;

const SelectedSummary = styled.div`
  ${({ theme }) => `
    padding: 12px 16px;
    background: ${theme.colorPrimaryBg};
    border: 1px solid ${theme.colorPrimaryBorder};
    border-radius: ${theme.borderRadius}px;
    font-size: 13px;
    color: ${theme.colorPrimary};
  `}
`;

const EmptyBox = styled.div`
  ${({ theme }) => `
    text-align: center;
    padding: 48px 24px;
    background: ${theme.colorBgElevated};
    border: 1px dashed ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    color: ${theme.colorTextSecondary};
  `}
`;

const ErrorBox = styled.div`
  ${({ theme }) => `
    padding: 12px 16px;
    background: #fff1f0;
    border: 1px solid #ffa39e;
    border-radius: ${theme.borderRadius}px;
    color: #cf1322;
    font-size: 13px;
  `}
`;

// ─── Connection test state ────────────────────────────────────────────────────

type TestStatus = 'idle' | 'testing' | 'success' | 'failed';

// ─── Component ────────────────────────────────────────────────────────────────

export default function StepInstances({
  databaseId,
  selectedInstanceIds,
  onChange,
}: StepInstancesProps) {
  const [loading, setLoading] = useState(false);
  const [instances, setInstances] = useState<DHIS2InstanceInfo[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [testStatuses, setTestStatuses] = useState<Record<number, TestStatus>>(
    {},
  );
  const [testMessages, setTestMessages] = useState<Record<number, string>>({});

  const fetchInstances = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/instances/?database_id=${databaseId}`,
      });
      const result: DHIS2InstanceInfo[] = (response.json as any)?.result || [];
      setInstances(result);
    } catch (err: any) {
      setFetchError(
        err?.message ||
          err?.body?.message ||
          'Failed to load DHIS2 instances.',
      );
    } finally {
      setLoading(false);
    }
  }, [databaseId]);

  useEffect(() => {
    if (databaseId) {
      fetchInstances();
    }
  }, [databaseId, fetchInstances]);

  const handleToggle = (instance: DHIS2InstanceInfo) => {
    if (!instance.is_active) return;
    const isSelected = selectedInstanceIds.includes(instance.id);
    const updated = isSelected
      ? selectedInstanceIds.filter(id => id !== instance.id)
      : [...selectedInstanceIds, instance.id];
    onChange(updated);
  };

  const handleTestConnection = async (
    e: React.MouseEvent,
    instance: DHIS2InstanceInfo,
  ) => {
    e.stopPropagation();
    setTestStatuses(prev => ({ ...prev, [instance.id]: 'testing' }));
    setTestMessages(prev => ({ ...prev, [instance.id]: '' }));
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/dhis2/instances/${instance.id}/test`,
      });
      const result = (response.json as any)?.result || {};
      const ok = !!result?.success;
      const msg = result?.message || '';
      setTestStatuses(prev => ({
        ...prev,
        [instance.id]: ok ? 'success' : 'failed',
      }));
      setTestMessages(prev => ({ ...prev, [instance.id]: msg }));
    } catch (err: any) {
      setTestStatuses(prev => ({ ...prev, [instance.id]: 'failed' }));
      setTestMessages(prev => ({
        ...prev,
        [instance.id]:
          err?.message || err?.body?.message || 'Connection failed.',
      }));
    }
  };

  const getTestBadgeProps = (
    instanceId: number,
  ): { color: string; text: string } | null => {
    const status = testStatuses[instanceId];
    if (!status || status === 'idle') return null;
    if (status === 'testing') return { color: 'blue', text: 'Testing…' };
    if (status === 'success') return { color: 'green', text: 'Connected' };
    return { color: 'red', text: 'Failed' };
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <StepContainer>
        <div>
          <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
            Select DHIS2 Instances
          </Title>
          <Paragraph style={{ margin: 0, color: '#666' }}>
            Choose one or more DHIS2 instances to include in this dataset.
          </Paragraph>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Loading />
        </div>
      </StepContainer>
    );
  }

  return (
    <StepContainer>
      <div>
        <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
          Select DHIS2 Instances
        </Title>
        <Paragraph style={{ margin: 0, color: '#666' }}>
          Choose one or more DHIS2 instances to pull data from. Only active
          instances can be selected.
        </Paragraph>
      </div>

      {fetchError && (
        <ErrorBox>
          Failed to load instances: {fetchError}
          <Button
            size="small"
            style={{ marginLeft: 12 }}
            onClick={fetchInstances}
          >
            Retry
          </Button>
        </ErrorBox>
      )}

      {!fetchError && instances.length === 0 && !loading && (
        <EmptyBox>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🌐</div>
          <Text strong>No DHIS2 instances configured</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 13 }}>
            Configure DHIS2 instances in the database settings before creating a
            multi-instance dataset.
          </Text>
        </EmptyBox>
      )}

      {instances.length > 0 && (
        <>
          {selectedInstanceIds.length > 0 && (
            <SelectedSummary>
              {selectedInstanceIds.length} instance
              {selectedInstanceIds.length !== 1 ? 's' : ''} selected
            </SelectedSummary>
          )}

          <InstanceGrid>
            {instances.map(instance => {
              const isSelected = selectedInstanceIds.includes(instance.id);
              const testBadge = getTestBadgeProps(instance.id);
              const testMsg = testMessages[instance.id];

              return (
                <InstanceCard
                  key={instance.id}
                  selected={isSelected}
                  inactive={!instance.is_active}
                  onClick={() => handleToggle(instance)}
                >
                  <InstanceCheckbox selected={isSelected}>
                    {isSelected && '✓'}
                  </InstanceCheckbox>

                  <InstanceBody>
                    <InstanceHeader>
                      <InstanceName>{instance.name}</InstanceName>

                      {instance.is_active ? (
                        <Tag color="green">Active</Tag>
                      ) : (
                        <Tag color="default">Inactive</Tag>
                      )}

                      {instance.auth_type === 'basic' ? (
                        <Tag color="blue">Basic Auth</Tag>
                      ) : (
                        <Tag color="purple">Personal Access Token</Tag>
                      )}

                      {testBadge && (
                        <Tag color={testBadge.color}>{testBadge.text}</Tag>
                      )}
                    </InstanceHeader>

                    <InstanceUrl>{instance.url}</InstanceUrl>

                    {instance.description && (
                      <InstanceDescription>
                        {instance.description}
                      </InstanceDescription>
                    )}

                    {testMsg && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 12,
                          color:
                            testStatuses[instance.id] === 'success'
                              ? '#389e0d'
                              : '#cf1322',
                        }}
                      >
                        {testMsg}
                      </div>
                    )}

                    {!instance.is_active && (
                      <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
                        This instance is inactive and cannot be selected.
                      </div>
                    )}
                  </InstanceBody>

                  <InstanceActions>
                    <Button
                      size="small"
                      loading={testStatuses[instance.id] === 'testing'}
                      onClick={e => handleTestConnection(e, instance)}
                    >
                      Test Connection
                    </Button>
                  </InstanceActions>
                </InstanceCard>
              );
            })}
          </InstanceGrid>

          <Alert
            type="info"
            showIcon
            message="Tip"
            description="You can select multiple instances. Data from all selected instances will be merged in your dataset. Make sure the instances contain compatible data elements."
          />
        </>
      )}
    </StepContainer>
  );
}
