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
import {
  CodeOutlined,
  ReloadOutlined,
  StopOutlined,
  TableOutlined,
} from '@ant-design/icons';

import { useToasts } from 'src/components/MessageToasts/withToasts';
import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import type { DHIS2MetadataStatus } from 'src/features/dhis2/types';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import WorkerStatusBanner from 'src/features/dhis2/WorkerStatusBanner';
import {
  formatCount,
  formatDateTime,
  getErrorMessage,
  getStatusColor,
} from 'src/features/dhis2/utils';

const { Text } = Typography;

type MetadataFamily =
  | 'variables'
  | 'programs'
  | 'categories'
  | 'org_units'
  | 'legend_sets'
  | 'boundaries';

type ViewMode = 'table' | 'json';

type MetadataPreviewRow = Record<string, unknown> & {
  id?: string;
  displayName?: string;
  name?: string;
  level?: number;
  source_instance_name?: string;
  groupLabels?: string[];
  members?: unknown[];
  categories?: unknown[];
  categoryCombo?: { displayName?: string } | null;
  dataDimensionType?: string;
  programType?: string;
  analyticsType?: string;
  legendDefinition?: {
    items?: unknown[];
  };
  // GeoJSON feature fields
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
  type?: string;
};

const VARIABLE_TYPE_OPTIONS = [
  { label: t('Data Elements'), value: 'dataElements' },
  { label: t('Indicators'), value: 'indicators' },
  { label: t('Program Indicators'), value: 'programIndicators' },
  { label: t('Event Data Items'), value: 'eventDataItems' },
  { label: t('Data Sets'), value: 'dataSets' },
  { label: t('Indicator Types'), value: 'indicatorTypes' },
  { label: t('Data Element Groups'), value: 'dataElementGroups' },
  { label: t('Data Element Group Sets'), value: 'dataElementGroupSets' },
  { label: t('Indicator Groups'), value: 'indicatorGroups' },
  { label: t('Indicator Group Sets'), value: 'indicatorGroupSets' },
];

const PROGRAM_TYPE_OPTIONS = [
  { label: t('Programs'), value: 'programs' },
  { label: t('Program Stages'), value: 'programStages' },
  { label: t('Tracked Entity Types'), value: 'trackedEntityTypes' },
];

const CATEGORY_TYPE_OPTIONS = [
  { label: t('Category Combos'), value: 'categoryCombos' },
  { label: t('Categories'), value: 'categories' },
  { label: t('Category Option Combos'), value: 'categoryOptionCombos' },
];

const ORG_UNIT_TYPE_OPTIONS = [
  { label: t('Organisation Units'), value: 'organisationUnits' },
  { label: t('Organisation Unit Levels'), value: 'organisationUnitLevels' },
  { label: t('Organisation Unit Groups'), value: 'organisationUnitGroups' },
  { label: t('Organisation Unit Group Sets'), value: 'organisationUnitGroupSets' },
];

const LEGEND_SET_TYPE_OPTIONS = [
  { label: t('Legend Sets'), value: 'legendSets' },
];

const BOUNDARY_TYPE_OPTIONS = [
  { label: t('Boundary GeoJSON'), value: 'geoJSON' },
  { label: t('OU Hierarchy'), value: 'orgUnitHierarchy' },
];

const POLL_INTERVAL_MS = 3000;

/** Extract rows from a metadata API response regardless of format. */
function extractRows(
  responseJson: Record<string, unknown>,
  metadataType: string,
): MetadataPreviewRow[] {
  // Helper: flatten a FeatureCollection into preview rows
  const featuresFromCollection = (
    collection: Record<string, unknown>,
  ): MetadataPreviewRow[] =>
    (collection.features as Record<string, unknown>[]).map((feature, idx) => {
      const props = (feature.properties as Record<string, unknown>) || {};
      return {
        ...props,
        id: (props.id as string) || (feature.id as string) || String(idx),
        displayName:
          (props.displayName as string) ||
          (props.name as string) ||
          (feature.id as string) ||
          String(idx),
        geometry: feature.geometry as MetadataPreviewRow['geometry'],
        type: feature.type as string,
        _raw_feature: feature,
      };
    });

  // GeoJSON: result wrapper (standard staged API format)
  const resultVal = responseJson.result as Record<string, unknown> | null;
  if (
    resultVal &&
    typeof resultVal === 'object' &&
    resultVal.type === 'FeatureCollection' &&
    Array.isArray(resultVal.features)
  ) {
    return featuresFromCollection(resultVal);
  }

  // GeoJSON: top-level FeatureCollection (rare, direct format)
  if (
    responseJson.type === 'FeatureCollection' &&
    Array.isArray(responseJson.features)
  ) {
    return featuresFromCollection(responseJson);
  }

  // orgUnitHierarchy is usually a tree — wrap as single row for JSON-only display
  if (metadataType === 'orgUnitHierarchy') {
    const root = responseJson.result ?? responseJson.data ?? responseJson;
    if (root && typeof root === 'object') {
      return [{ id: 'root', displayName: t('OU Hierarchy tree'), _tree: root }];
    }
    return [];
  }

  // Standard paginated API response
  if (Array.isArray(resultVal)) {
    return resultVal as MetadataPreviewRow[];
  }

  return [];
}

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
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [searchValue, setSearchValue] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeMetadataJobId, setActiveMetadataJobId] = useState<number | null>(null);
  const [cancellingJob, setCancellingJob] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewRows, setPreviewRows] = useState<MetadataPreviewRow[]>([]);
  const [rawJsonData, setRawJsonData] = useState<unknown>(null);
  const [previewStatus, setPreviewStatus] = useState<string>('idle');
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const typeOptions = useMemo(() => {
    if (family === 'variables') return VARIABLE_TYPE_OPTIONS;
    if (family === 'programs') return PROGRAM_TYPE_OPTIONS;
    if (family === 'categories') return CATEGORY_TYPE_OPTIONS;
    if (family === 'legend_sets') return LEGEND_SET_TYPE_OPTIONS;
    if (family === 'boundaries') return BOUNDARY_TYPE_OPTIONS;
    return ORG_UNIT_TYPE_OPTIONS;
  }, [family]);

  useEffect(() => {
    const nextValue = typeOptions[0]?.value;
    if (nextValue && !typeOptions.some(option => option.value === metadataType)) {
      setMetadataType(nextValue);
    }
  }, [metadataType, typeOptions]);

  // Default boundary types to JSON view; switch table for other families
  useEffect(() => {
    if (family === 'boundaries' && metadataType === 'orgUnitHierarchy') {
      setViewMode('json');
    }
  }, [family, metadataType]);

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
      setRawJsonData(null);
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
      // GeoJSON/hierarchy: no pagination params needed
      if (family !== 'boundaries') {
        params.set('page', '1');
        params.set('page_size', '25');
        if (submittedSearch.trim()) {
          params.set('search', submittedSearch.trim());
        }
      }

      const response = await SupersetClient.get({
        endpoint: `/api/v1/database/${selectedDatabaseId}/dhis2_metadata/?${params.toString()}`,
      });

      const json = response.json as Record<string, unknown>;
      setRawJsonData(json);
      setPreviewRows(extractRows(json, metadataType));
      setPreviewStatus((json.status as string) || 'success');
      setPreviewMessage((json.message as string) || null);
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to load local metadata preview')),
      );
      setPreviewRows([]);
      setRawJsonData(null);
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
  }, [selectedDatabaseId, metadataType, submittedSearch]);  // eslint-disable-line react-hooks/exhaustive-deps

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
      : family === 'programs'
        ? metadataStatus?.programs
        : family === 'categories'
          ? metadataStatus?.categories
          : family === 'legend_sets'
            ? metadataStatus?.legend_sets
            : family === 'boundaries'
              ? undefined
              : metadataStatus?.org_units;

  const _instanceCol = {
    title: t('Instance'),
    key: 'source_instance_name',
    render: (_value: unknown, row: MetadataPreviewRow) =>
      row.source_instance_name ? (
        <Tag>{row.source_instance_name}</Tag>
      ) : (
        <Text type="secondary">{t('Unknown')}</Text>
      ),
  };
  const _uidCol = { title: t('UID'), dataIndex: 'id', key: 'id' };
  const _nameCol = (label: string) => ({
    title: label,
    key: 'displayName',
    render: (_value: unknown, row: MetadataPreviewRow) =>
      row.displayName || row.name || row.id || t('Unknown'),
  });
  const _groupsCol = {
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
  };
  const _membersCol = {
    title: t('Members'),
    key: 'members',
    render: (_value: unknown, row: MetadataPreviewRow) => (
      <Text type="secondary">
        {Array.isArray(row.members) ? String(row.members.length) : '—'}
      </Text>
    ),
  };

  const previewColumns = (() => {
    if (family === 'boundaries' && metadataType === 'geoJSON') {
      return [
        _nameCol(t('Name / UID')),
        {
          title: t('Level'),
          key: 'level',
          render: (_value: unknown, row: MetadataPreviewRow) => {
            const lvl =
              row.level ??
              (row.properties as Record<string, unknown> | null)?.level;
            return lvl !== undefined && lvl !== null ? (
              <Tag>{String(lvl)}</Tag>
            ) : (
              <Text type="secondary">{t('—')}</Text>
            );
          },
        },
        {
          title: t('Geometry type'),
          key: 'geometry_type',
          render: (_value: unknown, row: MetadataPreviewRow) => {
            const geomType = row.geometry?.type;
            return geomType ? (
              <Tag color="blue">{geomType}</Tag>
            ) : (
              <Text type="secondary">{t('None')}</Text>
            );
          },
        },
        {
          title: t('Coordinates'),
          key: 'coord_count',
          render: (_value: unknown, row: MetadataPreviewRow) => {
            const coords = row.geometry?.coordinates;
            if (!coords) return <Text type="secondary">{t('—')}</Text>;
            const flat = JSON.stringify(coords);
            return (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {flat.slice(0, 60)}
                {flat.length > 60 ? '…' : ''}
              </Text>
            );
          },
        },
      ];
    }

    if (family === 'boundaries' && metadataType === 'orgUnitHierarchy') {
      return [
        _nameCol(t('Name')),
        _uidCol,
      ];
    }

    if (family === 'legend_sets') {
      return [
        _nameCol(t('Legend set')),
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
        _instanceCol,
        _uidCol,
      ];
    }

    if (family === 'org_units') {
      return [
        _nameCol(t('Organisation unit')),
        {
          title: t('Level'),
          dataIndex: 'level',
          key: 'level',
          render: (value: unknown) =>
            value === null || value === undefined ? (
              <Text type="secondary">{t('—')}</Text>
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
        _uidCol,
      ];
    }

    if (family === 'programs') {
      return [
        _nameCol(t('Program / Stage / Entity')),
        {
          title: t('Type'),
          key: 'programType',
          render: (_value: unknown, row: MetadataPreviewRow) => (
            <Text type="secondary">
              {String(row.programType || row.analyticsType || '—')}
            </Text>
          ),
        },
        _instanceCol,
        _uidCol,
      ];
    }

    if (family === 'categories') {
      return [
        _nameCol(t('Name')),
        {
          title: t('Dimension type / Combo'),
          key: 'dataDimensionType',
          render: (_value: unknown, row: MetadataPreviewRow) => (
            <Text type="secondary">
              {String(
                row.dataDimensionType ||
                  row.categoryCombo?.displayName ||
                  '—',
              )}
            </Text>
          ),
        },
        {
          title: t('Items'),
          key: 'categories',
          render: (_value: unknown, row: MetadataPreviewRow) => {
            const count = Array.isArray(row.categories)
              ? row.categories.length
              : null;
            return (
              <Text type="secondary">
                {count !== null ? String(count) : '—'}
              </Text>
            );
          },
        },
        _instanceCol,
        _uidCol,
      ];
    }

    // Default: variables (dataElements, indicators, groups, etc.)
    const hasGroups = [
      'dataElements', 'indicators', 'programIndicators', 'eventDataItems',
    ].includes(metadataType);
    const hasMembers = [
      'dataElementGroups', 'indicatorGroups',
      'dataElementGroupSets', 'indicatorGroupSets',
    ].includes(metadataType);
    const extraCol = hasMembers ? _membersCol : hasGroups ? _groupsCol : null;
    return [
      _nameCol(t('Variable')),
      _instanceCol,
      ...(extraCol ? [extraCol] : []),
      _uidCol,
    ];
  })();

  // Whether the current type can show a meaningful table
  const canShowTable = !(family === 'boundaries' && metadataType === 'orgUnitHierarchy');

  return (
    <DHIS2PageLayout
      activeTab="local-metadata"
      databases={databases}
      description={t(
        'Inspect metadata already staged locally for fast dataset creation. Refresh it, verify readiness by connection, and browse staged variables, legend sets, boundaries, or organisation units without waiting on live DHIS2 responses.',
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
        <WorkerStatusBanner />
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
                          size={10}
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
                  {t('Variables: %s', formatCount(metadataStatus.variables.count))}
                </Tag>
                {metadataStatus.programs ? (
                  <Tag color={getStatusColor(metadataStatus.programs.status)}>
                    {t('Programs: %s', formatCount(metadataStatus.programs.count))}
                  </Tag>
                ) : null}
                {metadataStatus.categories ? (
                  <Tag color={getStatusColor(metadataStatus.categories.status)}>
                    {t('Categories: %s', formatCount(metadataStatus.categories.count))}
                  </Tag>
                ) : null}
                {metadataStatus.legend_sets ? (
                  <Tag color={getStatusColor(metadataStatus.legend_sets.status)}>
                    {t('Legend sets: %s', formatCount(metadataStatus.legend_sets.count))}
                  </Tag>
                ) : null}
                <Tag color={getStatusColor(metadataStatus.org_units.status)}>
                  {t('Org units: %s', formatCount(metadataStatus.org_units.count))}
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
                  { label: t('Variables & Data'), value: 'variables' },
                  { label: t('Programs & Tracker'), value: 'programs' },
                  { label: t('Categories & Disaggregation'), value: 'categories' },
                  { label: t('Organisation Units'), value: 'org_units' },
                  { label: t('Legend Sets'), value: 'legend_sets' },
                  { label: t('Boundaries & GeoJSON'), value: 'boundaries' },
                ]}
                style={{ width: 230 }}
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
              {family !== 'boundaries' && (
                <Input.Search
                  allowClear
                  aria-label={t('Search local metadata')}
                  placeholder={t('Search local metadata')}
                  style={{ width: 260 }}
                  value={searchValue}
                  onChange={event => setSearchValue(event.target.value)}
                  onSearch={value => setSubmittedSearch(value)}
                />
              )}
              {canShowTable && (
                <Tooltip
                  title={
                    viewMode === 'table'
                      ? t('Switch to raw JSON view')
                      : t('Switch to table view')
                  }
                >
                  <Button
                    icon={viewMode === 'table' ? <CodeOutlined /> : <TableOutlined />}
                    onClick={() =>
                      setViewMode(prev => (prev === 'table' ? 'json' : 'table'))
                    }
                  >
                    {viewMode === 'table' ? t('JSON') : t('Table')}
                  </Button>
                </Tooltip>
              )}
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

          {/* JSON view */}
          {(viewMode === 'json' || !canShowTable) && rawJsonData !== null ? (
            <pre
              style={{
                background: '#1a1a2e',
                color: '#e2e8f0',
                borderRadius: 8,
                padding: 16,
                overflowX: 'auto',
                fontSize: 12,
                maxHeight: 600,
                overflowY: 'auto',
              }}
            >
              {JSON.stringify(rawJsonData, null, 2)}
            </pre>
          ) : viewMode === 'json' ? (
            <Empty description={t('No staged data loaded yet.')} />
          ) : null}

          {/* Table view */}
          {viewMode === 'table' && canShowTable && (
            previewRows.length ? (
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
            )
          )}
        </Card>
      </Space>
    </DHIS2PageLayout>
  );
}
