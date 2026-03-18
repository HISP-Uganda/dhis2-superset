import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SupersetClient, styled, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
} from 'antd';

import { useToasts } from 'src/components/MessageToasts/withToasts';
import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import type {
  DHIS2LocalDataFilter,
  DHIS2LocalFilterOptionsResult,
  DHIS2LocalDataQueryResult,
  DHIS2StagedDatasetSummary,
  DHIS2SyncJob,
} from 'src/features/dhis2/types';
import SyncProgressPanel from 'src/features/dhis2/SyncProgressPanel';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import {
  formatCount,
  formatDateTime,
  getDHIS2Route,
  getErrorMessage,
  getSqlLabQueryRoute,
  getStatusColor,
} from 'src/features/dhis2/utils';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const PREVIEW_LIMIT_OPTIONS = [25, 50, 100, 250];
const DATASET_POLL_INTERVAL_MS = 4000;
const JOB_PROGRESS_POLL_MS = 2000;
const ACTIVE_SYNC_STATUSES = new Set(['pending', 'queued', 'running']);
const EMPTY_LOCAL_FILTER_OPTIONS: DHIS2LocalFilterOptionsResult = {
  org_unit_filters: [],
  period_filter: null,
};
const FILTER_OPERATOR_OPTIONS: Array<{
  label: string;
  value: DHIS2LocalDataFilter['operator'];
}> = [
  { label: t('Contains'), value: 'contains' },
  { label: t('Equals'), value: 'eq' },
  { label: t('Not equal'), value: 'neq' },
  { label: t('Starts with'), value: 'starts_with' },
  { label: t('Greater than'), value: 'gt' },
  { label: t('Greater or equal'), value: 'gte' },
  { label: t('Less than'), value: 'lt' },
  { label: t('Less or equal'), value: 'lte' },
];

const ActionBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const FilterRow = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(140px, 180px) minmax(220px, 1fr) auto;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
  align-items: center;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const QueryPreview = styled(TextArea)`
  font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
`;

const createFilter = (): DHIS2LocalDataFilter => ({
  id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
  operator: 'contains',
});

const quoteIdentifier = (value: string): string =>
  `"${String(value).replace(/"/g, '""')}"`;

const escapeLiteral = (value: string): string => value.replace(/'/g, "''");

type ParsedServingColumn = {
  columnName: string;
  label: string;
  extra: Record<string, unknown>;
};

type StructuredFilter = Omit<DHIS2LocalDataFilter, 'id'>;

const parseColumnExtra = (rawExtra?: string): Record<string, unknown> => {
  if (!rawExtra) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawExtra);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const shallowEqualRecord = (
  left: Record<string, string | undefined>,
  right: Record<string, string | undefined>,
): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(key => left[key] === right[key]);
};

export default function DHIS2LocalData() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const {
    databases,
    loading: loadingDatabases,
    selectedDatabaseId,
    setSelectedDatabaseId,
  } = useDHIS2Databases(addDangerToast);
  const [datasets, setDatasets] = useState<DHIS2StagedDatasetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeDatasetId, setActiveDatasetId] = useState<number | undefined>();
  const [queryColumns, setQueryColumns] = useState<string[]>([]);
  const [queryFilters, setQueryFilters] = useState<DHIS2LocalDataFilter[]>([]);
  const [queryLimit, setQueryLimit] = useState(100);
  const [queryPage, setQueryPage] = useState(1);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState<DHIS2LocalDataQueryResult | null>(
    null,
  );
  const [refreshingDatasetId, setRefreshingDatasetId] = useState<number | null>(
    null,
  );
  const [_activeJobId, setActiveJobId] = useState<number | null>(null);
  const [activeJobProgress, setActiveJobProgress] = useState<DHIS2SyncJob | null>(null);
  const jobProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks mount state to prevent state updates on unmounted component
  const isMountedRef = useRef(true);
  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );
  // Stable ref to loadDatasets so scheduleJobPoll can call it without stale closure issues
  const loadDatasetsRef = useRef<() => Promise<void>>(async () => {});
  const [cleaningDatasetId, setCleaningDatasetId] = useState<number | null>(null);
  const [deletingDatasetId, setDeletingDatasetId] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [localFilterOptions, setLocalFilterOptions] =
    useState<DHIS2LocalFilterOptionsResult>(EMPTY_LOCAL_FILTER_OPTIONS);
  const [loadingLocalFilterOptions, setLoadingLocalFilterOptions] =
    useState(false);
  const [orgUnitSelections, setOrgUnitSelections] = useState<
    Record<string, string | undefined>
  >({});
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>([]);

  const stopJobPolling = useCallback(() => {
    if (jobProgressTimerRef.current !== null) {
      clearTimeout(jobProgressTimerRef.current);
      jobProgressTimerRef.current = null;
    }
  }, []);

  const scheduleJobPoll = useCallback(
    (jobId: number) => {
      stopJobPolling();
      jobProgressTimerRef.current = setTimeout(async () => {
        if (!isMountedRef.current) return;
        try {
          const response = await SupersetClient.get({
            endpoint: `/api/v1/dhis2/sync/job/${jobId}`,
          });
          if (!isMountedRef.current) return;
          const job = response.json?.result as DHIS2SyncJob | null;
          if (!job) return;
          setActiveJobProgress(job);
          if (ACTIVE_SYNC_STATUSES.has(job.status)) {
            scheduleJobPoll(jobId);
          } else {
            // Terminal — clear active job and refresh dataset list
            setActiveJobId(null);
            void loadDatasetsRef.current();
          }
        } catch {
          if (isMountedRef.current) {
            setActiveJobId(null);
          }
        }
      }, JOB_PROGRESS_POLL_MS);
    },
    // loadDatasets is defined below; we reference it via a ref trick instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopJobPolling],
  );

  // Cleanup poll timer on unmount
  useEffect(() => () => stopJobPolling(), [stopJobPolling]);

  const loadDatasets = async () => {
    if (!selectedDatabaseId) {
      setDatasets([]);
      setActiveDatasetId(undefined);
      setQueryResult(null);
      return;
    }
    setLoading(true);
    try {
      const response = await SupersetClient.get({
        endpoint:
          `/api/v1/dhis2/staged-datasets/?database_id=${selectedDatabaseId}` +
          '&include_inactive=true&include_stats=true',
      });
      if (!isMountedRef.current) return;
      const nextDatasets = (response.json.result || []) as DHIS2StagedDatasetSummary[];
      setDatasets(nextDatasets);
      setActiveDatasetId(currentId => {
        if (currentId && nextDatasets.some(dataset => dataset.id === currentId)) {
          return currentId;
        }
        return nextDatasets[0]?.id;
      });
    } catch (error) {
      if (!isMountedRef.current) return;
      addDangerToast(
        getErrorMessage(error, t('Failed to load local staged datasets')),
      );
      setDatasets([]);
      setActiveDatasetId(undefined);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  // Keep ref up-to-date so scheduleJobPoll always calls the latest version
  loadDatasetsRef.current = loadDatasets;

  useEffect(() => {
    void loadDatasets();
  }, [selectedDatabaseId]);

  useEffect(() => {
    if (!selectedDatabaseId) {
      return undefined;
    }
    if (
      refreshingDatasetId === null &&
      cleaningDatasetId === null &&
      !datasets.some(dataset =>
        ACTIVE_SYNC_STATUSES.has(dataset.last_sync_status || ''),
      )
    ) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      void loadDatasets();
    }, DATASET_POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedDatabaseId, datasets, refreshingDatasetId, cleaningDatasetId]);

  const activeDataset = useMemo(
    () => datasets.find(dataset => dataset.id === activeDatasetId) || null,
    [datasets, activeDatasetId],
  );

  const parsedServingColumns = useMemo<ParsedServingColumn[]>(
    () =>
      (activeDataset?.serving_columns || []).map(column => ({
        columnName: column.column_name,
        label: column.verbose_name || column.column_name,
        extra: parseColumnExtra(column.extra),
      })),
    [activeDataset],
  );

  const availableColumns = useMemo(
    () =>
      parsedServingColumns.map(column => ({
        label: column.label,
        value: column.columnName,
      })),
    [parsedServingColumns],
  );

  const orgUnitFilterDefinitions = useMemo(
    () =>
      parsedServingColumns
        .filter(column => column.extra.dhis2_is_ou_hierarchy === true)
        .map(column => ({
          columnName: column.columnName,
          label: column.label,
          level: Number(column.extra.dhis2_ou_level || 0),
        }))
        .filter(column => Number.isFinite(column.level) && column.level > 0)
        .sort((left, right) => left.level - right.level),
    [parsedServingColumns],
  );

  const periodFilterDefinition = useMemo(
    () =>
      parsedServingColumns.find(
        column =>
          column.extra.dhis2_is_period === true ||
          column.columnName === 'period',
      ) || null,
    [parsedServingColumns],
  );

  const genericFilterColumns = useMemo(() => {
    const excludedColumns = new Set([
      ...orgUnitFilterDefinitions.map(column => column.columnName),
      periodFilterDefinition?.columnName,
    ]);
    return availableColumns.filter(column => !excludedColumns.has(column.value));
  }, [availableColumns, orgUnitFilterDefinitions, periodFilterDefinition]);

  useEffect(() => {
    if (!availableColumns.length) {
      setQueryColumns([]);
      return;
    }
    setQueryColumns(current =>
      current.filter(column =>
        availableColumns.some(option => option.value === column),
      ),
    );
  }, [availableColumns]);

  useEffect(() => {
    setQueryResult(null);
    setQueryFilters([]);
    setLocalFilterOptions(EMPTY_LOCAL_FILTER_OPTIONS);
    setOrgUnitSelections({});
    setSelectedPeriods([]);
    setQueryPage(1);
  }, [activeDatasetId]);

  const structuredFilters = useMemo<StructuredFilter[]>(() => {
    const nextFilters: StructuredFilter[] = [];
    orgUnitFilterDefinitions.forEach(filterDefinition => {
      const value = orgUnitSelections[filterDefinition.columnName];
      if (value) {
        nextFilters.push({
          column: filterDefinition.columnName,
          operator: 'eq',
          value,
        });
      }
    });

    if (periodFilterDefinition && selectedPeriods.length) {
      nextFilters.push({
        column: periodFilterDefinition.columnName,
        operator: 'in',
        value: selectedPeriods,
      });
    }
    return nextFilters;
  }, [
    orgUnitFilterDefinitions,
    orgUnitSelections,
    periodFilterDefinition,
    selectedPeriods,
  ]);

  const sanitizedAdditionalFilters = useMemo(
    () =>
      queryFilters.filter(filter => {
        if (!filter.column || !filter.operator) {
          return false;
        }
        if (Array.isArray(filter.value)) {
          return filter.value.some(value => String(value || '').trim().length > 0);
        }
        return String(filter.value || '').trim().length > 0;
      }),
    [queryFilters],
  );

  const combinedFilters = useMemo<StructuredFilter[]>(
    () => [
      ...structuredFilters,
      ...sanitizedAdditionalFilters.map(({ id, ...rest }) => rest),
    ],
    [structuredFilters, sanitizedAdditionalFilters],
  );

  useEffect(() => {
    setQueryPage(1);
  }, [queryColumns, combinedFilters, queryLimit]);

  const totalRows = useMemo(
    () =>
      datasets.reduce(
        (sum, dataset) => sum + Number(dataset.stats?.total_rows || 0),
        0,
      ),
    [datasets],
  );

  const effectiveSelectedColumns = useMemo(
    () =>
      queryColumns.length
        ? queryColumns
        : availableColumns.map(column => column.value),
    [queryColumns, availableColumns],
  );

  useEffect(() => {
    if (!activeDataset) {
      return;
    }
    if (!orgUnitFilterDefinitions.length && !periodFilterDefinition) {
      setLocalFilterOptions(EMPTY_LOCAL_FILTER_OPTIONS);
      return;
    }

    const loadLocalFilterOptions = async () => {
      setLoadingLocalFilterOptions(true);
      try {
        const response = await SupersetClient.post({
          endpoint: `/api/v1/dhis2/staged-datasets/${activeDataset.id}/filters`,
          jsonPayload: {
            filters: combinedFilters,
          },
        });
        const nextResult = (response.json.result ||
          EMPTY_LOCAL_FILTER_OPTIONS) as DHIS2LocalFilterOptionsResult;
        setLocalFilterOptions(nextResult);
        setOrgUnitSelections(current => {
          const nextSelections: Record<string, string | undefined> = {};
          for (const filter of nextResult.org_unit_filters || []) {
            const currentValue = current[filter.column_name];
            if (!currentValue) {
              continue;
            }
            const optionValues = new Set(
              (filter.options || []).map(option => option.value),
            );
            if (!optionValues.has(currentValue)) {
              break;
            }
            nextSelections[filter.column_name] = currentValue;
          }
          return shallowEqualRecord(current, nextSelections)
            ? current
            : nextSelections;
        });
        setSelectedPeriods(current => {
          const validPeriods = new Set(
            (nextResult.period_filter?.options || []).map(option => option.value),
          );
          const nextPeriods = current.filter(period => validPeriods.has(period));
          return nextPeriods.length === current.length &&
            nextPeriods.every((value, index) => value === current[index])
            ? current
            : nextPeriods;
        });
      } catch (error) {
        addDangerToast(
          getErrorMessage(error, t('Failed to load local filter options')),
        );
        setLocalFilterOptions(EMPTY_LOCAL_FILTER_OPTIONS);
      } finally {
        setLoadingLocalFilterOptions(false);
      }
    };

    void loadLocalFilterOptions();
  }, [
    activeDataset,
    addDangerToast,
    combinedFilters,
    orgUnitFilterDefinitions,
    periodFilterDefinition,
  ]);

  const sqlPreview = useMemo(() => {
    if (!activeDataset) {
      return '';
    }
    const selectColumns = effectiveSelectedColumns.length
      ? effectiveSelectedColumns.map(quoteIdentifier).join(', ')
      : '*';
    const sourceRef =
      activeDataset.serving_table_ref || activeDataset.staging_table_ref || '';
    const whereClauses = combinedFilters.map(filter => {
      const quotedColumn = quoteIdentifier(filter.column || '');
      const value = Array.isArray(filter.value)
        ? filter.value.map(item => String(item || ''))
        : String(filter.value || '');
      if (filter.operator === 'in' && Array.isArray(value)) {
        const sanitizedValues = value.filter(item => item.trim().length > 0);
        if (!sanitizedValues.length) {
          return null;
        }
        return `${quotedColumn} IN (${sanitizedValues
          .map(item => `'${escapeLiteral(item)}'`)
          .join(', ')})`;
      }
      const scalarValue = Array.isArray(value) ? value.join(', ') : value;
      switch (filter.operator) {
        case 'contains':
          return `LOWER(CAST(${quotedColumn} AS TEXT)) LIKE '%${escapeLiteral(
            scalarValue.toLowerCase(),
          )}%'`;
        case 'starts_with':
          return `LOWER(CAST(${quotedColumn} AS TEXT)) LIKE '${escapeLiteral(
            scalarValue.toLowerCase(),
          )}%'`;
        case 'neq':
          return `${quotedColumn} != '${escapeLiteral(scalarValue)}'`;
        case 'gt':
          return `${quotedColumn} > '${escapeLiteral(scalarValue)}'`;
        case 'gte':
          return `${quotedColumn} >= '${escapeLiteral(scalarValue)}'`;
        case 'lt':
          return `${quotedColumn} < '${escapeLiteral(scalarValue)}'`;
        case 'lte':
          return `${quotedColumn} <= '${escapeLiteral(scalarValue)}'`;
        case 'eq':
        default:
          return `${quotedColumn} = '${escapeLiteral(scalarValue)}'`;
      }
    });
    return [
      `SELECT ${selectColumns}`,
      `FROM ${sourceRef}`,
      whereClauses.length
        ? `WHERE ${whereClauses.filter(Boolean).join('\n  AND ')}`
        : null,
      `LIMIT ${queryLimit}`,
    ]
      .filter(Boolean)
      .join('\n');
  }, [activeDataset, combinedFilters, effectiveSelectedColumns, queryLimit]);

  const runQuery = async (
    dataset: DHIS2StagedDatasetSummary = activeDataset!,
    page = queryPage,
  ) => {
    if (!dataset) {
      return;
    }
    setQueryLoading(true);
    try {
      const response = await SupersetClient.post({
          endpoint: `/api/v1/dhis2/staged-datasets/${dataset.id}/query`,
        jsonPayload: {
          columns: effectiveSelectedColumns,
          filters: combinedFilters,
          limit: queryLimit,
          page,
        },
      });
      setQueryPage(page);
      setQueryResult(
        (response.json.result || null) as DHIS2LocalDataQueryResult | null,
      );
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to query local staged data')),
      );
      setQueryResult(null);
    } finally {
      setQueryLoading(false);
    }
  };

  const refreshDataset = async (dataset: DHIS2StagedDatasetSummary) => {
    setRefreshingDatasetId(dataset.id);
    // Clear any previous progress for a fresh run
    setActiveJobProgress(null);
    stopJobPolling();
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/dhis2/sync/trigger/${dataset.id}`,
      });
      const result = response.json?.result;
      const status = result?.status || 'running';
      const jobId: number | null = result?.job_id ?? null;
      addSuccessToast(
        status === 'running'
          ? t(
              'Refresh now started for %s. Job %s is now running.',
              dataset.name,
              jobId ?? '',
            )
          : t(
              'Refresh now queued for %s. Job %s is now %s.',
              dataset.name,
              jobId ?? '',
              status,
            ),
      );
      if (jobId !== null) {
        setActiveJobId(jobId);
        scheduleJobPoll(jobId);
      } else {
        await loadDatasets();
      }
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to queue a local data refresh')),
      );
    } finally {
      setRefreshingDatasetId(null);
    }
  };

  const cleanupDataset = async (dataset: DHIS2StagedDatasetSummary) => {
    setCleaningDatasetId(dataset.id);
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/dhis2/staged-datasets/${dataset.id}/cleanup`,
      });
      addSuccessToast(
        t(
          'Cleared local staged data for %s. Variable mappings and dataset settings were preserved.',
          dataset.name,
        ),
      );
      if (activeDatasetId === dataset.id) {
        setQueryResult(null);
      }
      await loadDatasets();
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to clear local staged data')),
      );
    } finally {
      setCleaningDatasetId(null);
    }
  };

  const deleteDataset = async (dataset: DHIS2StagedDatasetSummary) => {
    setDeletingDatasetId(dataset.id);
    try {
      await SupersetClient.delete({
        endpoint: `/api/v1/dhis2/staged-datasets/${dataset.id}`,
      });
      addSuccessToast(
        t(
          'Deleted %s and removed its local staged data and serving tables.',
          dataset.name,
        ),
      );
      if (activeDatasetId === dataset.id) {
        setQueryResult(null);
      }
      await loadDatasets();
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to delete the staged dataset')),
      );
    } finally {
      setDeletingDatasetId(null);
    }
  };

  const renderRefreshButton = (dataset: DHIS2StagedDatasetSummary) => (
    <Button
      data-test={`dhis2-local-data-refresh-${dataset.id}`}
      loading={refreshingDatasetId === dataset.id}
      onClick={() => void refreshDataset(dataset)}
    >
      {t('Refresh now')}
    </Button>
  );

  const renderCleanupButton = (dataset: DHIS2StagedDatasetSummary) => (
    <Popconfirm
      cancelText={t('Cancel')}
      okButtonProps={{ loading: cleaningDatasetId === dataset.id }}
      okText={t('Yes, clear local data')}
      placement="top"
      title={t('Clear locally staged rows for %s?', dataset.name)}
      description={t(
        'This keeps the dataset definition and DHIS2 variable mappings, but removes all locally loaded rows until the next refresh.',
      )}
      onConfirm={() => cleanupDataset(dataset)}
    >
      <Button
        danger
        data-test={`dhis2-local-data-cleanup-${dataset.id}`}
        disabled={deletingDatasetId === dataset.id}
      >
        {t('Clear local data')}
      </Button>
    </Popconfirm>
  );

  const renderDeleteButton = (dataset: DHIS2StagedDatasetSummary) => (
    <Popconfirm
      cancelText={t('Cancel')}
      okButtonProps={{ danger: true, loading: deletingDatasetId === dataset.id }}
      okText={t('Yes, delete dataset')}
      placement="top"
      title={t('Delete %s?', dataset.name)}
      description={t(
        'This removes the dataset definition, local staged rows, and local serving tables.',
      )}
      onConfirm={() => deleteDataset(dataset)}
    >
      <Button
        danger
        data-test={`dhis2-local-data-delete-${dataset.id}`}
        disabled={cleaningDatasetId === dataset.id}
      >
        {t('Delete dataset')}
      </Button>
    </Popconfirm>
  );

  const downloadQuery = async () => {
    if (!activeDataset) {
      return;
    }
    setDownloading(true);
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/dhis2/staged-datasets/${activeDataset.id}/download`,
        jsonPayload: {
          columns: effectiveSelectedColumns,
          filters: combinedFilters,
          limit: queryLimit,
        },
        parseMethod: 'raw',
      });
      const blob = await (response as Response).blob();
      const url = window.URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download =
          response.headers.get('Content-Disposition')?.match(/filename=\"?([^"]+)\"?/)?.[1] ||
          `${activeDataset.name}_local_data.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } finally {
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      addDangerToast(
        getErrorMessage(error, t('Failed to download local staged data')),
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleOrgUnitSelectionChange = (
    columnName: string,
    nextValue?: string,
  ) => {
    setOrgUnitSelections(current => {
      const nextSelections: Record<string, string | undefined> = {};
      for (const filterDefinition of orgUnitFilterDefinitions) {
        if (filterDefinition.columnName === columnName) {
          if (nextValue) {
            nextSelections[columnName] = nextValue;
          }
          break;
        }
        if (current[filterDefinition.columnName]) {
          nextSelections[filterDefinition.columnName] =
            current[filterDefinition.columnName];
        }
      }
      return shallowEqualRecord(current, nextSelections)
        ? current
        : nextSelections;
    });
  };

  const clearLocalCascadeFilters = () => {
    setOrgUnitSelections({});
    setSelectedPeriods([]);
  };

  const queryHref =
    activeDataset?.serving_database_id && sqlPreview
      ? getSqlLabQueryRoute(activeDataset.serving_database_id, sqlPreview)
      : undefined;

  return (
    <DHIS2PageLayout
      activeTab="local-data"
      databases={databases}
      description={t(
        'Select a staged dataset, preview locally served rows, refresh now, clear local cache rows, delete datasets, and open the same query in SQL Lab without leaving the local staging workflow.',
      )}
      extra={<Button onClick={() => void loadDatasets()}>{t('Reload datasets')}</Button>}
      loadingDatabases={loadingDatabases}
      selectedDatabaseId={selectedDatabaseId}
      title={t('Data Workspace')}
      onDatabaseChange={setSelectedDatabaseId}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space style={{ width: '100%' }} wrap>
          <Card style={{ minWidth: 180 }}>
            <Statistic title={t('Staged datasets')} value={datasets.length} />
          </Card>
          <Card style={{ minWidth: 180 }}>
            <Statistic
              title={t('Active datasets')}
              value={datasets.filter(dataset => dataset.is_active).length}
            />
          </Card>
          <Card style={{ minWidth: 180 }}>
            <Statistic title={t('Local rows')} value={formatCount(totalRows)} />
          </Card>
        </Space>

        <Card loading={loading} title={t('Selected dataset')}>
          {activeDataset ? (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Select
                aria-label={t('Select staged dataset')}
                data-test="dhis2-local-data-dataset-select"
                options={datasets.map(dataset => ({
                  label: dataset.name,
                  value: dataset.id,
                }))}
                placeholder={t('Select a staged dataset')}
                style={{ width: '100%' }}
                value={activeDataset.id}
                onChange={value => setActiveDatasetId(value)}
              />
              <Space wrap>
                <Tag color={activeDataset.is_active ? 'green' : 'default'}>
                  {activeDataset.is_active ? t('Active') : t('Inactive')}
                </Tag>
                <Tag color={getStatusColor(activeDataset.last_sync_status)}>
                  {activeDataset.last_sync_status || t('Never synced')}
                </Tag>
                <Text type="secondary">
                  {t('Last sync: %s', formatDateTime(activeDataset.last_sync_at))}
                </Text>
                <Text type="secondary">
                  {t('Rows: %s', formatCount(activeDataset.stats?.total_rows))}
                </Text>
              </Space>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {activeDataset.description ||
                  t(
                    'This staged dataset serves local analytical columns for charts, previews, and controlled downloads.',
                  )}
              </Paragraph>
              <Alert
                showIcon
                type="info"
                message={t('DHIS2 variable mappings are preserved')}
                description={t(
                  'Refresh and Clear local data keep the saved variable-to-instance mappings intact. Only the locally staged rows are reloaded or removed.',
                )}
              />
              {activeJobProgress &&
                activeJobProgress.staged_dataset_id === activeDataset.id && (
                  <Card
                    size="small"
                    style={{ background: '#fafafa', borderRadius: 8 }}
                    title={t('Sync progress')}
                  >
                    <SyncProgressPanel job={activeJobProgress} />
                  </Card>
                )}
              <ActionBar>
                <Button
                  data-test="dhis2-local-data-run-query"
                  type="primary"
                  onClick={() => void runQuery(activeDataset, 1)}
                >
                  {t('Load data')}
                </Button>
                <Button
                  data-test="dhis2-local-data-download"
                  loading={downloading}
                  onClick={() => void downloadQuery()}
                >
                  {t('Download CSV')}
                </Button>
                {renderRefreshButton(activeDataset)}
                {renderCleanupButton(activeDataset)}
                {renderDeleteButton(activeDataset)}
                <Button
                  href={getDHIS2Route(
                    '/superset/dhis2/local-metadata/',
                    selectedDatabaseId,
                  )}
                >
                  {t('View metadata')}
                </Button>
                <Button disabled={!queryHref} href={queryHref} target="_blank">
                  {t('Open in SQL Lab')}
                </Button>
              </ActionBar>
            </Space>
          ) : (
            <Empty
              description={t(
                'No staged datasets are available for this database yet.',
              )}
            />
          )}
        </Card>

        <Card title={t('Simplified query')}>
          {activeDataset ? (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Text strong>{t('Columns')}</Text>
                <Select
                  aria-label={t('Columns')}
                  data-test="dhis2-local-data-column-select"
                  mode="multiple"
                  options={availableColumns}
                  placeholder={t('Choose columns to include')}
                  style={{ width: '100%' }}
                  value={queryColumns}
                  onChange={value => setQueryColumns(value)}
                />
                <Text type="secondary">
                  {t(
                    'Leave this empty to include every serving column for the selected dataset.',
                  )}
                </Text>
              </Space>

              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                  <Text strong>{t('Local cascade filters')}</Text>
                  <Button
                    disabled={
                      !Object.values(orgUnitSelections).some(Boolean) &&
                      !selectedPeriods.length
                    }
                    onClick={clearLocalCascadeFilters}
                  >
                    {t('Clear local filters')}
                  </Button>
                </Space>
                <Text type="secondary">
                  {t(
                    'Organisation unit and period options are loaded from the local staged serving table. Selecting a higher org-unit level narrows the lower levels automatically.',
                  )}
                </Text>
                {orgUnitFilterDefinitions.length ? (
                  localFilterOptions.org_unit_filters.map(filter => (
                    <Space
                      direction="vertical"
                      key={filter.column_name}
                      size="small"
                      style={{ width: '100%' }}
                    >
                      <Text>{filter.verbose_name}</Text>
                      <Select
                        allowClear
                        aria-label={filter.verbose_name}
                        data-test={`dhis2-local-data-ou-filter-${filter.column_name}`}
                        loading={loadingLocalFilterOptions}
                        options={(filter.options || []).map(option => ({
                          label: `${option.label} (${formatCount(option.row_count)})`,
                          value: option.value,
                        }))}
                        placeholder={t('Select %s', filter.verbose_name)}
                        style={{ width: '100%' }}
                        value={orgUnitSelections[filter.column_name]}
                        onChange={value =>
                          handleOrgUnitSelectionChange(
                            filter.column_name,
                            value || undefined,
                          )
                        }
                      />
                    </Space>
                  ))
                ) : (
                  <Text type="secondary">
                    {t(
                      'This staged dataset does not expose hierarchy columns for local cascade filtering.',
                    )}
                  </Text>
                )}
                {periodFilterDefinition ? (
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    <Text>{periodFilterDefinition.label}</Text>
                    <Select
                      allowClear
                      aria-label={periodFilterDefinition.label}
                      data-test="dhis2-local-data-period-filter"
                      loading={loadingLocalFilterOptions}
                      mode="multiple"
                      options={(localFilterOptions.period_filter?.options || []).map(
                        option => ({
                          label: `${option.label} (${formatCount(option.row_count)})`,
                          value: option.value,
                        }),
                      )}
                      placeholder={t('Select periods from local staged data')}
                      style={{ width: '100%' }}
                      value={selectedPeriods}
                      onChange={value => setSelectedPeriods(value)}
                    />
                  </Space>
                ) : null}
              </Space>

              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                  <Text strong>{t('Additional filters')}</Text>
                  <Button
                    disabled={!genericFilterColumns.length}
                    onClick={() =>
                      setQueryFilters(current => [...current, createFilter()])
                    }
                  >
                    {t('Add filter')}
                  </Button>
                </Space>
                {queryFilters.length ? (
                  queryFilters.map(filter => (
                    <FilterRow key={filter.id}>
                      <Select
                        aria-label={t('Filter column')}
                        options={genericFilterColumns}
                        placeholder={t('Column')}
                        value={filter.column}
                        onChange={value =>
                          setQueryFilters(current =>
                            current.map(item =>
                              item.id === filter.id ? { ...item, column: value } : item,
                            ),
                          )
                        }
                      />
                      <Select
                        aria-label={t('Filter operator')}
                        options={FILTER_OPERATOR_OPTIONS}
                        placeholder={t('Operator')}
                        value={filter.operator}
                        onChange={value =>
                          setQueryFilters(current =>
                            current.map(item =>
                              item.id === filter.id ? { ...item, operator: value } : item,
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label={t('Filter value')}
                        placeholder={t('Value')}
                        value={Array.isArray(filter.value) ? filter.value.join(', ') : filter.value}
                        onChange={event =>
                          setQueryFilters(current =>
                            current.map(item =>
                              item.id === filter.id
                                ? { ...item, value: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <Button
                        danger
                        onClick={() =>
                          setQueryFilters(current =>
                            current.filter(item => item.id !== filter.id),
                          )
                        }
                      >
                        {t('Remove')}
                      </Button>
                    </FilterRow>
                  ))
                ) : (
                  <Text type="secondary">
                    {genericFilterColumns.length
                      ? t(
                          'No extra filters are applied. Use these for non-org-unit and non-period columns.',
                        )
                      : t(
                          'All staged dimensions are already covered by the local cascade controls for this dataset.',
                        )}
                  </Text>
                )}
              </Space>

              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Text strong>{t('Row limit')}</Text>
                <Select
                  aria-label={t('Row limit')}
                  options={PREVIEW_LIMIT_OPTIONS.map(value => ({
                    label: t('%s rows', value),
                    value,
                  }))}
                  style={{ width: 180 }}
                  value={queryLimit}
                  onChange={value => setQueryLimit(value)}
                />
              </Space>

              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Text strong>{t('Generated SQL')}</Text>
                <QueryPreview
                  autoSize={{ minRows: 4, maxRows: 10 }}
                  readOnly
                  value={queryResult?.sql_preview || sqlPreview}
                />
                <Space>
                  <Button
                    data-test="dhis2-local-data-run-generated-sql"
                    loading={queryLoading}
                    type="primary"
                    onClick={() => void runQuery(activeDataset, 1)}
                  >
                    {t('Run query')}
                  </Button>
                  <Text type="secondary">
                    {t(
                      'Executes the generated SQL against the local serving table and loads paginated results below.',
                    )}
                  </Text>
                </Space>
              </Space>
            </Space>
          ) : (
            <Empty description={t('Select a staged dataset to compose a local query.')} />
          )}
        </Card>

        <Card title={t('Query results')}>
          {activeDataset?.last_sync_status &&
          ['pending', 'queued', 'running'].includes(activeDataset.last_sync_status) ? (
            <Alert
              message={t('Local data refresh is still in progress')}
              showIcon
              style={{ marginBottom: 16 }}
              type="info"
              description={t(
                'The dataset is already available for analysis, and the background staging job is still loading more rows into the local serving table.',
              )}
            />
          ) : null}
          {queryResult?.rows?.length ? (
            <Table
              columns={queryResult.columns.map(column => ({
                title:
                  availableColumns.find(option => option.value === column)?.label || column,
                dataIndex: column,
                key: column,
                render: (value: unknown) =>
                  value === null || value === undefined || value === '' ? (
                    <Text type="secondary">{t('Empty')}</Text>
                  ) : (
                    String(value)
                  ),
              }))}
              dataSource={queryResult.rows}
              loading={queryLoading}
              pagination={{
                current: queryResult.page || queryPage,
                pageSize: queryResult.limit,
                total: queryResult.total_rows,
                showSizeChanger: false,
                onChange: page => {
                  if (activeDataset && page !== (queryResult.page || queryPage)) {
                    void runQuery(activeDataset, page);
                  }
                },
              }}
              rowKey={(_row, index) =>
                `${queryResult.page || queryPage}_${index}`
              }
              scroll={{ x: true }}
            />
          ) : (
            <Empty
              description={
                queryLoading
                  ? t('Loading local staged data...')
                  : t(
                      'No rows are currently shown. Use Load data to preview the selected local serving dataset.',
                    )
              }
            />
          )}
        </Card>

        <Card loading={loading} title={t('Available staged datasets')}>
          {datasets.length ? (
            <Table
              columns={[
                {
                  title: t('Dataset'),
                  key: 'name',
                  render: (_value: unknown, dataset: DHIS2StagedDatasetSummary) => (
                    <Space direction="vertical" size={0}>
                      <Text strong>{dataset.name}</Text>
                      {dataset.description ? (
                        <Text type="secondary">{dataset.description}</Text>
                      ) : null}
                    </Space>
                  ),
                },
                {
                  title: t('Status'),
                  key: 'status',
                  render: (_value: unknown, dataset: DHIS2StagedDatasetSummary) => (
                    <Space wrap>
                      <Tag color={dataset.is_active ? 'green' : 'default'}>
                        {dataset.is_active ? t('Active') : t('Inactive')}
                      </Tag>
                      <Tag color={getStatusColor(dataset.last_sync_status)}>
                        {dataset.last_sync_status || t('Never synced')}
                      </Tag>
                    </Space>
                  ),
                },
                {
                  title: t('Rows'),
                  key: 'rows',
                  render: (_value: unknown, dataset: DHIS2StagedDatasetSummary) =>
                    formatCount(dataset.stats?.total_rows),
                },
                {
                  title: t('Actions'),
                  key: 'actions',
                  render: (_value: unknown, dataset: DHIS2StagedDatasetSummary) => (
                    <ActionBar>
                      <Button
                        onClick={() => {
                          setActiveDatasetId(dataset.id);
                          setTimeout(() => {
                            void runQuery(dataset);
                          }, 0);
                        }}
                      >
                        {t('Use dataset')}
                      </Button>
                      {renderRefreshButton(dataset)}
                      {renderCleanupButton(dataset)}
                      {renderDeleteButton(dataset)}
                    </ActionBar>
                  ),
                },
              ]}
              dataSource={datasets}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              rowKey="id"
            />
          ) : (
            <Empty
              description={t(
                'No staged datasets are available for this database yet.',
              )}
            />
          )}
        </Card>
      </Space>
    </DHIS2PageLayout>
  );
}
