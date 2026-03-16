import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Progress,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { ReloadOutlined, StopOutlined } from '@ant-design/icons';

import { useToasts } from 'src/components/MessageToasts/withToasts';
import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import type { DHIS2MetadataStatus } from 'src/features/dhis2/types';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import {
  formatCount,
  formatDateTime,
  getErrorMessage,
  getStatusColor,
} from 'src/features/dhis2/utils';

const { Text } = Typography;

type MetadataFamily = 'variables' | 'legend_sets' | 'org_units';
type MetadataPreviewRow = Record<string, unknown> & {
  id?: string;
  displayName?: string;
  name?: string;
  level?: number;
  source_instance_name?: string;
  groupLabels?: string[];
  legendDefinition?: {
    items?: unknown[];
  };
};

const VARIABLE_TYPE_OPTIONS = [
  { label: t('Data Elements'), value: 'dataElements' },
  { label: t('Indicators'), value: 'indicators' },
  { label: t('Program Indicators'), value: 'programIndicators' },
  { label: t('Event Data Items'), value: 'eventDataItems' },
  { label: t('Data Sets'), value: 'dataSets' },
];

const ORG_UNIT_TYPE_OPTIONS = [
  { label: t('Organisation Units'), value: 'organisationUnits' },
  { label: t('Organisation Unit Levels'), value: 'organisationUnitLevels' },
  { label: t('Organisation Unit Groups'), value: 'organisationUnitGroups' },
];

const LEGEND_SET_TYPE_OPTIONS = [
  { label: t('Legend Sets'), value: 'legendSets' },
];

const POLL_INTERVAL_MS = 3000;

export default function DHIS2LocalMetadata() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const {
    databases,
    loading: loadingDatabases,
    selectedDatabaseId,
    setSelectedDatabaseId,
  } = useDHIS2Databases(addDangerToast);
  const [metadataStatus, setMetadataStatus] = useState<DHIS2MetadataStatus | null>(
    null,
  );
  const [family, setFamily] = useState<MetadataFamily>('variables');
  const [metadataType, setMetadataType] = useState('dataElements');
  const [searchValue, setSearchValue] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeMetadataJobId, setActiveMetadataJobId] = useState<number | null>(null);
  const [cancellingJob, setCancellingJob] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewRows, setPreviewRows] = useState<MetadataPreviewRow[]>([]);
  const [previewStatus, setPreviewStatus] = useState<string>('idle');
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const typeOptions = useMemo(
    () =>
      family === 'variables'
        ? VARIABLE_TYPE_OPTIONS
        : family === 'legend_sets'
          ? LEGEND_SET_TYPE_OPTIONS
          : ORG_UNIT_TYPE_OPTIONS,
    [family],
  );

  useEffect(() => {
    const nextValue = typeOptions[0]?.value;
    if (nextValue && !typeOptions.some(option => option.value === metadataType)) {
      setMetadataType(nextValue);
    }
  }, [metadataType, typeOptions]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchMetadataStatus = useCallback(async (dbId: number) => {
    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/diagnostics/metadata-status/${dbId}`,
      });
      const status = (response.json.result || null) as DHIS2MetadataStatus | null;
      setMetadataStatus(status);
      return status;
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to load local metadata status')),
      );
      setMetadataStatus(null);
      return null;
    }
  }, [addDangerToast]);

  const scheduleNextPoll = useCallback((dbId: number) => {
    stopPolling();
    pollTimerRef.current = setTimeout(async () => {
      const status = await fetchMetadataStatus(dbId);
      const prog = status?.refresh_progress;
      if (prog && (prog.status === 'running' || prog.status === 'queued')) {
        scheduleNextPoll(dbId);
      } else {
        pollTimerRef.current = null;
      }
    }, POLL_INTERVAL_MS);
  }, [fetchMetadataStatus, stopPolling]);

  const loadMetadataStatus = useCallback(async () => {
    if (!selectedDatabaseId) {
      setMetadataStatus(null);
      return;
    }

    setLoadingStatus(true);
    const status = await fetchMetadataStatus(selectedDatabaseId);
    setLoadingStatus(false);

    const prog = status?.refresh_progress;
    if (prog && (prog.status === 'running' || prog.status === 'queued')) {
      scheduleNextPoll(selectedDatabaseId);
    }
  }, [selectedDatabaseId, fetchMetadataStatus, scheduleNextPoll]);

  const loadPreview = async () => {
    if (!selectedDatabaseId || !metadataType) {
      setPreviewRows([]);
      setPreviewStatus('idle');
      setPreviewMessage(null);
      return;
    }

    setLoadingPreview(true);
    try {
      const params = new URLSearchParams();
      params.set('type', metadataType);
      params.set('federated', 'true');
      params.set('staged', 'true');
      params.set('page', '1');
      params.set('page_size', '25');
      if (submittedSearch.trim()) {
        params.set('search', submittedSearch.trim());
      }

      const response = await SupersetClient.get({
        endpoint: `/api/v1/database/${selectedDatabaseId}/dhis2_metadata/?${params.toString()}`,
      });

      setPreviewRows((response.json.result || []) as MetadataPreviewRow[]);
      setPreviewStatus((response.json.status as string) || 'success');
      setPreviewMessage((response.json.message as string) || null);
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to load local metadata preview')),
      );
      setPreviewRows([]);
      setPreviewStatus('failed');
      setPreviewMessage(t('Failed to load local metadata preview.'));
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    stopPolling();
    void loadMetadataStatus();
    return () => stopPolling();
  }, [selectedDatabaseId]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadPreview();
  }, [selectedDatabaseId, metadataType, submittedSearch]);

  const handleRefresh = async () => {
    if (!selectedDatabaseId) {
      return;
    }
    setRefreshing(true);
    try {
      const resp = await SupersetClient.post({
        endpoint: `/api/v1/dhis2/diagnostics/metadata-refresh/${selectedDatabaseId}`,
      });
      const result = resp.json?.result as { refresh?: { job_id?: number }; job_id?: number } | undefined;
      const jobId = result?.refresh?.job_id ?? result?.job_id;
      if (jobId) {
        setActiveMetadataJobId(jobId);
      }
      addSuccessToast(t('Local metadata refresh started.'));
      // Fetch status immediately then start polling
      const status = await fetchMetadataStatus(selectedDatabaseId);
      const prog = status?.refresh_progress;
      if (prog && (prog.status === 'running' || prog.status === 'queued')) {
        scheduleNextPoll(selectedDatabaseId);
      }
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to request local metadata refresh')),
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleCancelMetadataJob = async () => {
    if (!activeMetadataJobId) return;
    setCancellingJob(true);
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/dhis2/jobs/metadata/${activeMetadataJobId}/cancel`,
      });
      addSuccessToast(t('Metadata refresh job #%s cancelled', String(activeMetadataJobId)));
      setActiveMetadataJobId(null);
      stopPolling();
      if (selectedDatabaseId) {
        void fetchMetadataStatus(selectedDatabaseId);
      }
    } catch (error) {
      addDangerToast(getErrorMessage(error, t('Failed to cancel metadata job')));
    } finally {
      setCancellingJob(false);
    }
  };

  const familyStatus =
    family === 'variables'
      ? metadataStatus?.variables
      : family === 'legend_sets'
        ? metadataStatus?.legend_sets
        : metadataStatus?.org_units;

  const previewColumns =
    family === 'variables'
      ? [
          {
            title: t('Variable'),
            key: 'displayName',
            render: (_value: unknown, row: MetadataPreviewRow) =>
              row.displayName || row.name || row.id || t('Unknown'),
          },
          {
            title: t('Instance'),
            key: 'source_instance_name',
            render: (_value: unknown, row: MetadataPreviewRow) =>
              row.source_instance_name ? (
                <Tag>{row.source_instance_name}</Tag>
              ) : (
                <Text type="secondary">{t('Unknown')}</Text>
              ),
          },
          {
            title: t('Groups'),
            key: 'groupLabels',
            render: (_value: unknown, row: MetadataPreviewRow) =>
              Array.isArray(row.groupLabels) && row.groupLabels.length ? (
                <Space wrap>
                  {row.groupLabels.slice(0, 3).map(label => (
                    <Tag key={label}>{label}</Tag>
                  ))}
                </Space>
              ) : (
                <Text type="secondary">{t('None')}</Text>
              ),
          },
          {
            title: t('UID'),
            dataIndex: 'id',
            key: 'id',
          },
        ]
      : family === 'legend_sets'
        ? [
            {
              title: t('Legend set'),
              key: 'displayName',
              render: (_value: unknown, row: MetadataPreviewRow) =>
                row.displayName || row.name || row.id || t('Unknown'),
            },
            {
              title: t('Legends'),
              key: 'legendCount',
              render: (_value: unknown, row: MetadataPreviewRow) =>
                String(
                  Array.isArray(row.legendDefinition?.items)
                    ? row.legendDefinition?.items.length
                    : 0,
                ),
            },
            {
              title: t('Instance'),
              key: 'source_instance_name',
              render: (_value: unknown, row: MetadataPreviewRow) =>
                row.source_instance_name ? (
                  <Tag>{row.source_instance_name}</Tag>
                ) : (
                  <Text type="secondary">{t('Unknown')}</Text>
                ),
            },
            {
              title: t('UID'),
              dataIndex: 'id',
              key: 'id',
            },
          ]
        : [
          {
            title: t('Organisation unit'),
            key: 'displayName',
            render: (_value: unknown, row: MetadataPreviewRow) =>
              row.displayName || row.name || row.id || t('Unknown'),
          },
          {
            title: t('Level'),
            dataIndex: 'level',
            key: 'level',
            render: (value: unknown) =>
              value === null || value === undefined ? (
                <Text type="secondary">{t('Unknown')}</Text>
              ) : (
                String(value)
              ),
          },
          {
            title: t('Instance'),
            key: 'source_instance_name',
            render: (_value: unknown, row: MetadataPreviewRow) =>
              row.source_instance_name ? (
                <Tag>{row.source_instance_name}</Tag>
              ) : (
                <Text type="secondary">{t('Merged')}</Text>
              ),
          },
          {
            title: t('UID'),
            dataIndex: 'id',
            key: 'id',
          },
        ];

  return (
    <DHIS2PageLayout
      activeTab="local-metadata"
      databases={databases}
      description={t(
        'Inspect metadata already staged locally for fast dataset creation. Refresh it, verify readiness by connection, and browse staged variables, legend sets, or organisation units without waiting on live DHIS2 responses.',
      )}
      extra={
        <Space>
          {activeMetadataJobId &&
            metadataStatus?.refresh_progress &&
            (metadataStatus.refresh_progress.status === 'running' ||
              metadataStatus.refresh_progress.status === 'queued') ? (
            <Tooltip title={t('Stop the running metadata refresh job')}>
              <Button
                danger
                icon={<StopOutlined />}
                loading={cancellingJob}
                size="small"
                onClick={() => void handleCancelMetadataJob()}
              >
                {t('Cancel')}
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip
            title={
              metadataStatus?.refresh_progress &&
              (metadataStatus.refresh_progress.status === 'running' ||
                metadataStatus.refresh_progress.status === 'queued')
                ? t('Refresh in progress…')
                : t('Fetch latest metadata from all active DHIS2 instances')
            }
          >
            <Button
              disabled={
                refreshing ||
                !!(
                  metadataStatus?.refresh_progress &&
                  (metadataStatus.refresh_progress.status === 'running' ||
                    metadataStatus.refresh_progress.status === 'queued')
                )
              }
              icon={
                refreshing ? (
                  <Spin size="small" />
                ) : (
                  <ReloadOutlined spin={false} />
                )
              }
              onClick={() => void handleRefresh()}
            >
              {t('Refresh local metadata')}
            </Button>
          </Tooltip>
        </Space>
      }
      loadingDatabases={loadingDatabases}
      selectedDatabaseId={selectedDatabaseId}
      title={t('Local Metadata')}
      onDatabaseChange={setSelectedDatabaseId}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space style={{ width: '100%' }} wrap>
          <Card style={{ minWidth: 190 }}>
            <Statistic
              title={t('Overall status')}
              value={metadataStatus?.overall_status || t('unknown')}
            />
          </Card>
          <Card style={{ minWidth: 190 }}>
            <Statistic
              title={t('Active connections')}
              value={metadataStatus?.active_instance_count ?? 0}
            />
          </Card>
          <Card style={{ minWidth: 190 }}>
            <Statistic
              title={t('Family records')}
              value={formatCount(familyStatus?.count)}
            />
          </Card>
          <Card style={{ minWidth: 190 }}>
            <Statistic
              title={t('Last refreshed')}
              value={formatDateTime(
                familyStatus?.last_refreshed_at || metadataStatus?.last_refreshed_at,
              )}
            />
          </Card>
        </Space>

        <Card loading={loadingStatus} title={t('Local staging status')}>
          {metadataStatus ? (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              {(() => {
                const prog = metadataStatus.refresh_progress;
                if (!prog) return null;
                const isActive = prog.status === 'running' || prog.status === 'queued';
                const pct = Math.round(prog.overall.percent_complete ?? 0);
                const antStatus =
                  prog.status === 'complete'
                    ? 'success'
                    : prog.status === 'failed'
                      ? 'exception'
                      : 'active';

                return (
                  <Card
                    size="small"
                    style={{ background: '#fafafa', borderRadius: 8 }}
                    title={
                      <Space>
                        {isActive && <Spin size="small" />}
                        <span>
                          {isActive
                            ? t('Metadata refresh in progress…')
                            : t('Last refresh result: %s', prog.status)}
                        </span>
                      </Space>
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('Overall — %s / %s units',
                            prog.overall.completed_units,
                            prog.overall.total_units)}
                          {prog.overall.failed_units
                            ? t(' (%s failed)', prog.overall.failed_units)
                            : ''}
                        </Text>
                        <Progress
                          percent={pct}
                          status={antStatus}
                          strokeWidth={10}
                        />
                      </div>

                      {/* Per-family progress bars */}
                      {(['variables', 'legend_sets', 'org_units'] as const).map(fam => {
                        const fp =
                          fam === 'variables'
                            ? prog.variables
                            : fam === 'legend_sets'
                              ? prog.legend_sets
                              : prog.org_units;
                        if (!fp) return null;
                        const famPct = Math.round(fp.percent_complete ?? 0);
                        const famStatus =
                          fp.status === 'complete'
                            ? 'success'
                            : fp.status === 'failed'
                              ? 'exception'
                              : 'active';
                        const label =
                          fam === 'variables'
                            ? t('Variables')
                            : fam === 'legend_sets'
                              ? t('Legend Sets')
                              : t('Org Units');
                        return (
                          <div key={fam}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {label}
                              {fp.current_metadata_type
                                ? ` — ${fp.current_metadata_type}`
                                : ''}
                              {fp.current_instance_name
                                ? ` (${fp.current_instance_name})`
                                : ''}
                            </Text>
                            <Progress
                              percent={famPct}
                              size="small"
                              status={famStatus}
                              strokeWidth={6}
                            />
                          </div>
                        );
                      })}

                      {prog.variables?.last_error && (
                        <Alert
                          message={t('Last error')}
                          description={prog.variables.last_error}
                          showIcon
                          type="error"
                        />
                      )}
                      {prog.org_units?.last_error && (
                        <Alert
                          message={t('Org units error')}
                          description={prog.org_units.last_error}
                          showIcon
                          type="error"
                        />
                      )}
                    </Space>
                  </Card>
                );
              })()}

              <Space wrap>
                <Tag color={getStatusColor(metadataStatus.variables.status)}>
                  {t('Variables: %s', metadataStatus.variables.status)}
                </Tag>
                {metadataStatus.legend_sets ? (
                  <Tag color={getStatusColor(metadataStatus.legend_sets.status)}>
                    {t('Legend sets: %s', metadataStatus.legend_sets.status)}
                  </Tag>
                ) : null}
                <Tag color={getStatusColor(metadataStatus.org_units.status)}>
                  {t('Org units: %s', metadataStatus.org_units.status)}
                </Tag>
              </Space>
            </Space>
          ) : (
            <Empty description={t('No local metadata status is available yet.')} />
          )}
        </Card>

        <Card
          extra={
            <Space wrap>
              <Select
                aria-label={t('Metadata family')}
                options={[
                  { label: t('Variables'), value: 'variables' },
                  { label: t('Legend Sets'), value: 'legend_sets' },
                  { label: t('Organisation Units'), value: 'org_units' },
                ]}
                style={{ width: 180 }}
                value={family}
                onChange={value => setFamily(value)}
              />
              <Select
                aria-label={t('Metadata type')}
                options={typeOptions}
                style={{ width: 220 }}
                value={metadataType}
                onChange={value => setMetadataType(value)}
              />
              <Input.Search
                allowClear
                aria-label={t('Search local metadata')}
                placeholder={t('Search local metadata')}
                style={{ width: 260 }}
                value={searchValue}
                onChange={event => setSearchValue(event.target.value)}
                onSearch={value => setSubmittedSearch(value)}
              />
            </Space>
          }
          loading={loadingPreview}
          title={t('Local metadata browser')}
        >
          {previewMessage ? (
            <Alert
              message={previewStatus === 'failed' ? t('Load failed') : t('Status')}
              description={previewMessage}
              showIcon
              style={{ marginBottom: 16 }}
              type={previewStatus === 'failed' ? 'error' : 'info'}
            />
          ) : null}
          {previewRows.length ? (
            <Table
              columns={previewColumns}
              dataSource={previewRows}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              rowKey={row =>
                `${row.source_instance_name || 'shared'}-${row.id || row.displayName || row.name}`
              }
            />
          ) : (
            <Empty
              description={t(
                'No staged metadata matched the current selection.',
              )}
            />
          )}
        </Card>
      </Space>
    </DHIS2PageLayout>
  );
}
