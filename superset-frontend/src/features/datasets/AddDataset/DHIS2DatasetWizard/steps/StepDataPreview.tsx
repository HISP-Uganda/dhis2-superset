import { useState, useEffect, useRef, useCallback } from 'react';
import { styled, SupersetClient } from '@superset-ui/core';
import {
  Table,
  Empty,
  Alert,
  Typography,
  Loading,
  Select,
  Button,
} from '@superset-ui/core/components';
import { DHIS2WizardState } from '../index';

const { Title, Paragraph, Text } = Typography;

const StepContainer = styled.div`
  max-width: 100%;
  margin: 0 auto;
`;

const ControlsContainer = styled.div`
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
`;

const RowLimitSelector = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ColumnSummaryPanel = styled.div`
  ${({ theme }) => `
    margin-bottom: 16px;
    padding: 12px 16px;
    background: ${theme.colorBgElevated};
    border-radius: ${theme.borderRadius}px;
    border: 1px solid ${theme.colorBorder};
  `}
`;

const ColumnTagsContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const ColumnTag = styled(Text)`
  font-size: 11px;
  ${({ theme }) => `
    background: ${theme.colorBgContainer};
    border: 1px solid ${theme.colorBorder};
  `}
  padding: 2px 8px;
  border-radius: 4px;
`;

const HierarchyColumnTag = styled(ColumnTag)`
  ${
    // eslint-disable-next-line theme-colors/no-literal-colors
    () => `
    background: #e6f7ff;
    color: #0050b3;
    border: 1px solid #91d5ff;
  `
  }
  font-weight: 500;
`;

const PeriodColumnTag = styled(ColumnTag)`
  ${
    // eslint-disable-next-line theme-colors/no-literal-colors
    () => `
    background: #f6ffed;
    color: #274000;
    border: 1px solid #b7eb8f;
  `
  }
  font-weight: 500;
`;

const DataElementColumnTag = styled(ColumnTag)`
  ${
    // eslint-disable-next-line theme-colors/no-literal-colors
    () => `
    background: #fff7e6;
    color: #7c4500;
    border: 1px solid #ffd591;
  `
  }
  font-weight: 500;
`;

interface StepDataPreviewProps {
  wizardState: DHIS2WizardState;
  updateState: (updates: Partial<DHIS2WizardState>) => void;
  databaseId?: number;
  endpoint?: string | null;
  dataElements: string[];
  periods: string[];
  orgUnits: string[];
  includeChildren?: boolean;
}

const ROW_LIMIT_OPTIONS = [
  { value: 20, label: '20 rows' },
  { value: 50, label: '50 rows' },
  { value: 100, label: '100 rows' },
  { value: 500, label: '500 rows' },
  { value: 1000, label: '1000 rows' },
  { value: 100000, label: 'All rows' },
];

const DEFAULT_PREVIEW_LIMIT = 20;
const DEBOUNCE_DELAY = 800;

interface FetchParams {
  dataElements: string[];
  periods: string[];
  orgUnits: string[];
  databaseId?: number;
  endpoint?: string | null;
  limit: number;
  includeChildren: boolean;
  dataLevelScope: string;
}

interface OrgUnitMetadata {
  id: string;
  displayName: string;
  level?: number;
  parent: any;
}

const paramsToKey = (params: FetchParams): string =>
  `${params.databaseId}:${params.dataElements.join(',')}:${params.periods.join(',')}:${params.orgUnits.join(',')}:${params.endpoint}:${params.limit}:${params.includeChildren}:${params.dataLevelScope}`;

export default function WizardStepDataPreview({
  wizardState,
  updateState,
  databaseId,
  endpoint,
  dataElements,
  periods,
  orgUnits,
  includeChildren = false,
}: StepDataPreviewProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rowLimit, setRowLimit] = useState(DEFAULT_PREVIEW_LIMIT);
  const [metadataMap, setMetadataMap] = useState<{
    dataElements: Record<string, string>;
    periods: Record<string, string>;
    orgUnits: Record<string, string>;
  }>({
    dataElements: {},
    periods: {},
    orgUnits: {},
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchParamsRef = useRef<FetchParams | null>(null);
  const isMountedRef = useRef(true);
  const [cacheKey, setCacheKey] = useState(0);

  const resetPreview = useCallback(() => {
    setData([]);
    setColumns([]);
    setTotalRows(0);
    setError(null);
    lastFetchParamsRef.current = null;
  }, []);

  const clearCache = useCallback(() => {
    lastFetchParamsRef.current = null;
    setCacheKey(prev => prev + 1);
  }, []);

  const fetchOrgUnitMetadata = useCallback(
    async (ids: string[]): Promise<OrgUnitMetadata[]> => {
      if (!databaseId || ids.length === 0) return [];

      const promises = ids.map(async id => {
        try {
          const response = await SupersetClient.get({
            endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=organisationUnits&search=${id}&staged=true`,
          });
          const items = response.json?.result || [];
          const item = items.find((i: any) => i.id === id);
          if (item) {
            return {
              id: item.id,
              displayName: item.displayName || item.name || id,
              level: item.level,
              parent: item.parent,
            };
          }
          return { id, displayName: id, level: 0, parent: null };
        } catch {
          return { id, displayName: id, level: 0, parent: null };
        }
      });

      return Promise.all(promises);
    },
    [databaseId],
  );

  const fetchMetadata = useCallback(
    async (
      ids: string[],
      type: 'dataElements' | 'organisationUnits',
    ): Promise<Record<string, string>> => {
      if (!databaseId || ids.length === 0) return {};

      try {
        const map: Record<string, string> = {};

        // For DX types, try multiple endpoints
        const dxTypes =
          type === 'dataElements'
            ? ['dataElements', 'indicators', 'dataSets', 'programIndicators']
            : [type];

        const fetchIdMetadata = async (id: string): Promise<void> => {
          // eslint-disable-next-line no-await-in-loop
          for (const dxType of dxTypes) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const response = await SupersetClient.get({
                endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=${dxType}&search=${id}&staged=true`,
              });
              const items = response.json?.result || [];
              const item = items.find((i: any) => i.id === id);
              if (item && item.displayName) {
                map[id] = item.displayName || item.name || id;
                return;
              }
            } catch {
              // Try next type
            }
          }
          // If not found in any type, use the ID
          if (!map[id]) {
            map[id] = id;
          }
        };

        const promises = ids.map(fetchIdMetadata);
        await Promise.all(promises);
        return map;
      } catch {
        return {};
      }
    },
    [databaseId],
  );

  const transformDataWithDisplayNames = useCallback(
    (
      rawRows: any[],
      rawColumns: any[],
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ouMetadata?: Record<string, string>,
    ) => {
      const transformedColumns = rawColumns.map((col: any) => {
        let displayName = col.title || col.dataIndex || col.key;
        const key = col.key || col.dataIndex || '';
        const dataIndex = col.dataIndex || '';

        // Hierarchy level columns already have proper titles from backend
        if (dataIndex.startsWith('ou_level_')) {
          // Title is already set by backend (e.g., "National", "Region", etc.)
          return {
            title: displayName,
            dataIndex,
            key,
            width: col.width || 140,
            ellipsis: true,
            render: (value: any) => (
              <Text type="secondary" ellipsis>
                {value !== null && value !== undefined ? String(value) : '-'}
              </Text>
            ),
          };
        }

        // Period column
        if (dataIndex === 'period' || key === 'period') {
          return {
            title: 'Period',
            dataIndex,
            key,
            width: col.width || 120,
            ellipsis: true,
            render: (value: any) => (
              <Text type="secondary" ellipsis>
                {value !== null && value !== undefined ? String(value) : '-'}
              </Text>
            ),
          };
        }

        // Check for data element columns - key format is "de_{uid}"
        for (const [deId, deName] of Object.entries(metadataMap.dataElements)) {
          if (
            key === `de_${deId}` ||
            dataIndex === `de_${deId}` ||
            displayName === deId ||
            displayName.includes(deId)
          ) {
            displayName = deName;
            break;
          }
        }

        return {
          title: displayName,
          dataIndex: col.dataIndex || col.key,
          key: col.key,
          width: col.width || 120,
          ellipsis: true,
          render: (value: any) => (
            <Text type="secondary" ellipsis>
              {value !== null && value !== undefined ? String(value) : '-'}
            </Text>
          ),
        };
      });

      const transformedRows = rawRows.map((row: any, idx: number) => ({
        ...row,
        key: `row-${idx}`,
      }));

      return { transformedColumns, transformedRows };
    },
    [metadataMap],
  );

  const fetchDataPreview = useCallback(
    async (fetchParams: FetchParams) => {
      const currentParamsKey = paramsToKey(fetchParams);
      const lastParamsKey = lastFetchParamsRef.current
        ? paramsToKey(lastFetchParamsRef.current)
        : null;

      // eslint-disable-next-line no-console
      console.log('[StepDataPreview] Cache check:', {
        currentParamsKey,
        lastParamsKey,
        willFetch: currentParamsKey !== lastParamsKey,
        includeChildren: fetchParams.includeChildren,
      });

      if (currentParamsKey === lastParamsKey) {
        return;
      }

      lastFetchParamsRef.current = fetchParams;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const { signal } = abortControllerRef.current;

      setLoading(true);
      setError(null);

      try {
        // Step 1: Fetch metadata for proper column mapping
        const deMap = await fetchMetadata(
          fetchParams.dataElements,
          'dataElements',
        );
        const ouMetadataList = await fetchOrgUnitMetadata(fetchParams.orgUnits);
        const ouMap: Record<string, string> = {};
        ouMetadataList.forEach(ou => {
          ouMap[ou.id] = ou.displayName;
        });

        const periodMap: Record<string, string> = {};
        fetchParams.periods.forEach(periodId => {
          periodMap[periodId] = periodId.split('|')[1] || periodId;
        });

        const newMetadataMap = {
          dataElements: deMap,
          periods: periodMap,
          orgUnits: ouMap,
        };
        setMetadataMap(newMetadataMap);

        console.log('[StepDataPreview] Using fetchParams:', {
          includeChildren: fetchParams.includeChildren,
          dataLevelScope: fetchParams.dataLevelScope,
        });

        console.log('[StepDataPreview] Org units metadata:', ouMetadataList);

        // Step 2: Get column structure using columns endpoint (same as ColumnPreview)
        const columnsPayload = {
          data_elements: fetchParams.dataElements.map(id => ({
            id,
            displayName: deMap[id] || id,
          })),
          periods: fetchParams.periods.map(id => ({
            id,
            displayName: periodMap[id] || id,
          })),
          org_units: ouMetadataList,
          include_children: fetchParams.includeChildren,
          data_level_scope: fetchParams.dataLevelScope,
        };

        console.log('[StepDataPreview] Fetching column structure:', {
          data_elements: columnsPayload.data_elements,
          org_units: columnsPayload.org_units,
          include_children: columnsPayload.include_children,
          data_level_scope: columnsPayload.data_level_scope,
        });

        const columnsResponse = await SupersetClient.post({
          endpoint: `/api/v1/database/${fetchParams.databaseId}/dhis2_preview/columns/`,
          jsonPayload: columnsPayload,
          signal,
        });

        if (signal.aborted || !isMountedRef.current) {
          console.log(
            '[StepDataPreview] Request was aborted or component unmounted',
          );
          return;
        }

        const structureColumns = columnsResponse.json?.columns || [];

        // Step 3: Fetch actual data
        // Send full org unit metadata to allow backend to build hierarchy
        const dataPayload = {
          data_elements: fetchParams.dataElements,
          periods: fetchParams.periods,
          org_units: ouMetadataList,
          endpoint: fetchParams.endpoint,
          limit: fetchParams.limit,
          offset: 0,
          include_children: fetchParams.includeChildren,
          data_level_scope: fetchParams.dataLevelScope,
        };

        console.log('[StepDataPreview] Fetching data with payload:', {
          data_elements: dataPayload.data_elements,
          periods: dataPayload.periods,
          org_units: dataPayload.org_units,
          include_children: dataPayload.include_children,
          data_level_scope: dataPayload.data_level_scope,
          limit: dataPayload.limit,
        });

        const dataResponse = await SupersetClient.post({
          endpoint: `/api/v1/database/${fetchParams.databaseId}/dhis2_preview/data/`,
          jsonPayload: dataPayload,
          signal,
        });

        if (signal.aborted || !isMountedRef.current) {
          console.log(
            '[StepDataPreview] Request was aborted or component unmounted',
          );
          return;
        }

        const rows = dataResponse.json?.rows || [];
        const total = dataResponse.json?.total || 0;

        console.log('[StepDataPreview] Received response:', {
          rowCount: rows.length,
          columnCount: structureColumns.length,
          total,
          includeChildren: fetchParams.includeChildren,
          orgUnits: fetchParams.orgUnits,
        });

        // Step 4: Transform columns with proper metadata
        const transformedColumns = structureColumns.map((col: any) => {
          const title = col.title || col.dataIndex || col.key;
          const key = col.key || col.dataIndex || '';
          const dataIndex = col.dataIndex || '';

          let displayName = title;

          // Hierarchy level columns already have proper titles from backend
          if (dataIndex.startsWith('ou_level_')) {
            // Title is already set by backend (e.g., "National", "Region", etc.)
            return {
              title: displayName,
              dataIndex,
              key,
              width: col.width || 140,
              ellipsis: true,
              render: (value: any) => (
                <Text type="secondary" ellipsis>
                  {value !== null && value !== undefined ? String(value) : '-'}
                </Text>
              ),
            };
          }

          // Check for org unit columns
          for (const ouId in ouMap) {
            if (title.includes(ouId) || key.includes(ouId)) {
              displayName = ouMap[ouId];
              break;
            }
          }

          // Check for data element columns
          for (const deId in deMap) {
            if (
              key === `de_${deId}` ||
              dataIndex === `de_${deId}` ||
              title === deId ||
              title.includes(deId)
            ) {
              displayName = deMap[deId];
              break;
            }
          }

          // Check for period columns
          for (const periodId in periodMap) {
            if (title.includes(periodId) || key.includes(periodId)) {
              displayName = periodMap[periodId];
              break;
            }
          }

          return {
            ...col,
            title: displayName,
            dataIndex: col.dataIndex || col.key,
            key: col.key,
            width: col.width || 120,
            ellipsis: true,
            render: (value: any) => (
              <Text type="secondary" ellipsis>
                {value !== null && value !== undefined ? String(value) : '-'}
              </Text>
            ),
          };
        });

        const transformedRows = rows.map((row: any, idx: number) => ({
          ...row,
          key: `row-${idx}`,
        }));

        setData(transformedRows);
        setColumns(transformedColumns);
        setTotalRows(total);

        // Data element columns (de_*) should be FLOAT for numeric values
        // Hierarchy columns (ou_level_*) and period should be STRING
        const metadata = transformedColumns.map((col: any) => {
          const colKey = col.dataIndex || col.key || '';
          const isDataElement = colKey.startsWith('de_');
          return {
            name: colKey,
            type: isDataElement ? 'FLOAT' : 'STRING',
            verbose_name: col.title,
            is_dttm: colKey === 'period',
          };
        });

        console.log('[StepDataPreview] Generated column metadata:', {
          count: metadata.length,
          metadata,
        });

        updateState({
          previewData: transformedRows,
          columns: metadata,
        });

        console.log('[StepDataPreview] Updated wizard state with columns');
      } catch (err) {
        if (signal.aborted || !isMountedRef.current) {
          console.log(
            '[StepDataPreview] Error caught but request was aborted or component unmounted',
          );
          return;
        }
        const errorMsg =
          err instanceof Error ? err.message : 'Failed to load preview data';
        console.error('[StepDataPreview] Error fetching data:', {
          message: errorMsg,
          error: err,
          params: {
            dataElements: fetchParams.dataElements,
            periods: fetchParams.periods,
            orgUnits: fetchParams.orgUnits,
            includeChildren: fetchParams.includeChildren,
          },
        });
        setError(errorMsg);
        setData([]);
        setColumns([]);
        setTotalRows(0);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [updateState, fetchMetadata, fetchOrgUnitMetadata, transformDataWithDisplayNames],
  );

  useEffect(() => {
    if (
      databaseId &&
      dataElements.length > 0 &&
      periods.length > 0 &&
      orgUnits.length > 0
    ) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      console.log('[StepDataPreview] Scheduling fetch with:', {
        databaseId,
        dataElementsCount: dataElements.length,
        periodsCount: periods.length,
        orgUnitsCount: orgUnits.length,
        includeChildren,
        cacheKey,
      });

      debounceTimerRef.current = setTimeout(() => {
        console.log('[StepDataPreview] Executing fetch after debounce');
        fetchDataPreview({
          dataElements,
          periods,
          orgUnits,
          databaseId,
          endpoint,
          limit: rowLimit,
          includeChildren,
          dataLevelScope: wizardState.dataLevelScope || 'selected',
        });
      }, DEBOUNCE_DELAY);
    } else {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      console.log(
        '[StepDataPreview] Missing required parameters, resetting preview',
      );
      resetPreview();
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    databaseId,
    dataElements,
    periods,
    orgUnits,
    endpoint,
    fetchDataPreview,
    resetPreview,
    rowLimit,
    includeChildren,
    cacheKey,
    wizardState.dataLevelScope,
  ]);

  useEffect(() => {
    isMountedRef.current = true;
    console.log('[StepDataPreview] Component mounted');

    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      console.log('[StepDataPreview] Component unmounted');
    };
  }, []);

  return (
    <StepContainer>
      <div style={{ marginBottom: 16 }}>
        <Title level={5} style={{ margin: 0, marginBottom: 4 }}>
          Data Preview
        </Title>
      </div>

      {error && (
        <Alert
          message="Error loading preview"
          description={error}
          type="error"
          showIcon
          closable
          style={{ marginBottom: 12 }}
        />
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Loading />
          <Text type="secondary" style={{ marginTop: 16, display: 'block' }}>
            Loading preview data...
          </Text>
        </div>
      )}

      {!loading &&
      (dataElements.length === 0 ||
        periods.length === 0 ||
        orgUnits.length === 0) ? (
        <Empty
          description={`Complete all selections: ${dataElements.length === 0 ? 'Data Elements, ' : ''}${periods.length === 0 ? 'Periods, ' : ''}${orgUnits.length === 0 ? 'Organization Units' : ''}`.replace(
            /, $/,
            '',
          )}
          style={{ marginTop: 20, marginBottom: 20 }}
        />
      ) : !loading && data.length === 0 ? (
        <Empty
          description="No data available. Please try different selections or check your DHIS2 connection."
          style={{ marginTop: 20, marginBottom: 20 }}
        />
      ) : (
        !loading && (
          <>
            <ControlsContainer>
              <RowLimitSelector>
                <Text>Display rows:</Text>
                <Select
                  options={ROW_LIMIT_OPTIONS}
                  value={ROW_LIMIT_OPTIONS.find(opt => opt.value === rowLimit)}
                  onChange={(val: any) => setRowLimit(val.value)}
                  showSearch={false}
                  ariaLabel="Select number of rows to display"
                />
              </RowLimitSelector>
              <Button
                type="default"
                onClick={() => {
                  console.log('[StepDataPreview] User clicked refresh button');
                  clearCache();
                }}
              >
                Refresh Data
              </Button>
            </ControlsContainer>

            <ColumnSummaryPanel>
              <div style={{ marginBottom: 12 }}>
                <Title level={5} style={{ margin: '0 0 4px 0', fontSize: 13 }}>
                  Actual Dataset Columns ({columns.length} total)
                </Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {includeChildren
                    ? '✓ Include children: data shows full organization unit hierarchy'
                    : 'Selected organization units only (no child units)'}
                </Text>
              </div>
              <ColumnTagsContainer>
                {columns.map((col, idx) => {
                  const colKey = col.key || col.dataIndex || '';
                  let TagComponent = ColumnTag;

                  if (colKey.startsWith('ou_level_')) {
                    TagComponent = HierarchyColumnTag;
                  } else if (colKey === 'period') {
                    TagComponent = PeriodColumnTag;
                  } else if (colKey.startsWith('de_')) {
                    TagComponent = DataElementColumnTag;
                  }

                  return (
                    <TagComponent key={colKey || idx} code>
                      {col.title}
                    </TagComponent>
                  );
                })}
              </ColumnTagsContainer>
            </ColumnSummaryPanel>

            <Alert
              message={`${rowLimit === 100000 ? `All ${totalRows} rows` : `First ${rowLimit} rows of ${totalRows} total`}`}
              type="info"
              showIcon
              style={{ marginBottom: 12, fontSize: 12 }}
            />

            <div style={{ overflowX: 'auto', marginBottom: 12 }}>
              <Table
                columns={columns}
                data={data}
                pagination={false}
                scroll={{ x: 'max-content' }}
              />
            </div>

            <Paragraph style={{ margin: 0 }}>
              <Text type="secondary">
                {data.length} rows displayed - {columns.length} columns
              </Text>
            </Paragraph>
          </>
        )
      )}
    </StepContainer>
  );
}
