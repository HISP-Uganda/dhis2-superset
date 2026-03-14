import { useState, useEffect, useRef, useCallback } from 'react';
import { styled, SupersetClient } from '@superset-ui/core';
import {
  Table,
  Empty,
  Alert,
  Typography,
  Loading,
} from '@superset-ui/core/components';
import { DHIS2WizardState } from '../index';

const { Title, Paragraph, Text } = Typography;

const StepContainer = styled.div`
  max-width: 100%;
  margin: 0 auto;
`;

interface MetadataItem {
  id: string;
  displayName: string;
  level?: number;
  parent?: any;
}

interface StepColumnPreviewProps {
  wizardState: DHIS2WizardState;
  updateState: (updates: Partial<DHIS2WizardState>) => void;
  databaseId?: number;
  dataElements: string[];
  periods: string[];
  orgUnits: string[];
}

export default function WizardStepColumnPreview({
  wizardState,
  updateState,
  databaseId,
  dataElements,
  periods,
  orgUnits,
}: StepColumnPreviewProps) {
  const [loading, setLoading] = useState(false);
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  const [tableData, setTableData] = useState<any[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    const runFetch = async () => {
      if (databaseId && dataElements.length > 0 && isMountedRef.current) {
        await fetchMetadataAndGeneratePreview();
      }
    };

    runFetch().catch(() => {});

    return () => {
      isMountedRef.current = false;
    };
  }, [
    databaseId,
    dataElements,
    periods,
    orgUnits,
    wizardState.includeChildren,
    wizardState.dataLevelScope,
  ]);

  const fetchMetadataAndGeneratePreview = async () => {
    if (!isMountedRef.current) return;
    setLoading(true);
    try {
      const deMetadata: MetadataItem[] = [];
      const periodMetadata: MetadataItem[] = [];
      const ouMetadata: MetadataItem[] = [];

      const fetchDXDisplayName = async (
        deId: string,
        dxTypes: string[],
      ): Promise<MetadataItem> => {
        const results = await Promise.allSettled(
          dxTypes.map(dxType =>
            SupersetClient.get({
              endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=${dxType}&search=${deId}&staged=true`,
            }),
          ),
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            const items = result.value.json?.result || [];
            const item = items.find((i: any) => i.id === deId);
            if (item && item.displayName) {
              return { id: item.id, displayName: item.displayName };
            }
          }
        }
        return { id: deId, displayName: deId };
      };

      const dxTypes = [
        'dataElements',
        'indicators',
        'dataSets',
        'programIndicators',
      ];
      const dePromises = dataElements.map(deId =>
        fetchDXDisplayName(deId, dxTypes),
      );
      deMetadata.push(...(await Promise.all(dePromises)));

      for (const periodId of periods) {
        const displayName = periodId.split('|')[1] || periodId;
        periodMetadata.push({ id: periodId, displayName });
      }

      const ouPromises = orgUnits.map(async ouId => {
        try {
          const response = await SupersetClient.get({
            endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=organisationUnits&search=${ouId}&staged=true`,
          });
          const items = response.json?.result || [];
          const item = items.find((i: any) => i.id === ouId);
          if (item) {
            return {
              id: item.id,
              displayName: item.displayName,
              level: item.level,
              parent: item.parent,
            };
          }
          return { id: ouId, displayName: ouId, level: 0, parent: null };
        } catch {
          return { id: ouId, displayName: ouId, level: 0, parent: null };
        }
      });
      ouMetadata.push(...(await Promise.all(ouPromises)));

      const metadata = {
        dataElements: deMetadata,
        periods: periodMetadata,
        orgUnits: ouMetadata,
      };

      if (isMountedRef.current) {
        await generateColumnPreview(metadata);
      }
    } catch {
      if (isMountedRef.current) {
        setTableColumns([]);
        setTableData([]);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const generateColumnPreview = async (meta: {
    dataElements: MetadataItem[];
    periods: MetadataItem[];
    orgUnits: MetadataItem[];
  }) => {
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/database/${databaseId}/dhis2_preview/columns/`,
        jsonPayload: {
          data_elements: meta.dataElements,
          periods: meta.periods,
          org_units: meta.orgUnits,
          include_children: wizardState.includeChildren,
          data_level_scope: wizardState.dataLevelScope || 'selected',
        },
      });

      const cols = response.json?.columns || [];
      const rows = response.json?.rows || [];

      const ouIdToDisplayName: Record<string, string> = {};
      const deIdToDisplayName: Record<string, string> = {};
      const periodIdToDisplayName: Record<string, string> = {};

      meta.orgUnits.forEach(ou => {
        ouIdToDisplayName[ou.id] = ou.displayName;
      });
      meta.dataElements.forEach(de => {
        deIdToDisplayName[de.id] = de.displayName;
      });
      meta.periods.forEach(period => {
        periodIdToDisplayName[period.id] = period.displayName;
      });

      const transformedColumns = cols.map((col: any) => {
        const title = col.title || col.dataIndex || col.key;
        const key = col.key || col.dataIndex || '';
        const dataIndex = col.dataIndex || '';

        // Hierarchy level columns already have proper titles from backend
        if (dataIndex.startsWith('ou_level_')) {
          // Title is already set by backend (e.g., "National", "Region", etc.)
          return {
            ...col,
            title: title,
            ellipsis: true,
          };
        }

        // Check for org unit columns
        for (const ouId in ouIdToDisplayName) {
          if (title.includes(ouId) || key.includes(ouId)) {
            return {
              ...col,
              title: ouIdToDisplayName[ouId],
              ellipsis: true,
            };
          }
        }

        // Check for data element columns - key format is "de_{uid}"
        for (const deId in deIdToDisplayName) {
          // Check if key ends with the DE ID or dataIndex contains DE ID
          if (
            key === `de_${deId}` ||
            dataIndex === `de_${deId}` ||
            title === deId ||
            title.includes(deId)
          ) {
            return {
              ...col,
              title: deIdToDisplayName[deId],
              ellipsis: true,
            };
          }
        }

        // Check for period columns
        for (const periodId in periodIdToDisplayName) {
          if (title.includes(periodId) || key.includes(periodId)) {
            return {
              ...col,
              title: periodIdToDisplayName[periodId],
              ellipsis: true,
            };
          }
        }

        return {
          ...col,
          ellipsis: true,
        };
      });

      console.log('[StepColumnPreview] Generated columns:', {
        count: transformedColumns.length,
        hierarchyLevels: transformedColumns.filter((c: any) =>
          c.dataIndex?.startsWith('ou_level_'),
        ).length,
        periodColumns: transformedColumns.filter(
          (c: any) => c.dataIndex === 'period',
        ).length,
        dataElementColumns: transformedColumns.filter((c: any) =>
          c.dataIndex?.startsWith('de_'),
        ).length,
        columns: transformedColumns.map((c: any) => ({
          name: c.dataIndex || c.key,
          title: c.title,
        })),
      });

      setTableColumns(transformedColumns);
      setTableData(
        rows.map((row: any, idx: number) => ({
          ...row,
          key: `row-${idx}`,
        })),
      );

      // Transform columns to wizard state format (name, type, verbose_name, is_dttm)
      // Data element columns (de_*) should be FLOAT for numeric values
      // Hierarchy columns (ou_level_*) and period should be STRING
      const wizardColumns = transformedColumns.map((col: any) => {
        const colKey = col.dataIndex || col.key || '';
        const isDataElement = colKey.startsWith('de_');
        return {
          name: colKey,
          type: isDataElement ? 'FLOAT' : 'STRING',
          verbose_name: col.title,
          is_dttm: colKey === 'period',
        };
      });

      updateState({ columns: wizardColumns });

      console.log(
        '[StepColumnPreview] Updated wizard state with column preview',
        wizardColumns,
      );
    } catch {
      setTableColumns([]);
      setTableData([]);
    }
  };

  // Group columns by type for display
  const getColumnSummary = useCallback(() => {
    const hierarchyCols = tableColumns.filter(
      col =>
        col.dataIndex?.startsWith('ou_level_') ||
        col.key?.startsWith('ou_level_'),
    );
    const periodCols = tableColumns.filter(
      col => col.dataIndex === 'period' || col.key === 'period',
    );
    const dataCols = tableColumns.filter(
      col => col.dataIndex?.startsWith('de_') || col.key?.startsWith('de_'),
    );

    return { hierarchyCols, periodCols, dataCols };
  }, [tableColumns]);

  const { hierarchyCols, periodCols, dataCols } = getColumnSummary();

  return (
    <StepContainer>
      <div style={{ marginBottom: 16 }}>
        <Title level={5} style={{ margin: 0, marginBottom: 4 }}>
          Column Preview
        </Title>
        <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
          Preview of the dataset columns that will be created
        </Paragraph>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Loading />
        </div>
      )}

      {!loading && tableColumns.length === 0 ? (
        <Empty
          description="Select data elements, periods, and organization units to see preview"
          style={{ marginTop: 20, marginBottom: 20 }}
        />
      ) : (
        !loading && (
          <>
            {wizardState.includeChildren && (
              <Alert
                message="Including descendants - hierarchy columns will show full organization unit path"
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
              />
            )}

            {/* Column Summary */}
            <ColumnSummaryBox>
              <Title level={5} style={{ margin: '0 0 8px 0', fontSize: 13 }}>
                Dataset Columns ({tableColumns.length} total)
              </Title>

              {hierarchyCols.length > 0 && (
                <ColumnSection>
                  <Text strong type="secondary">
                    Organization Hierarchy ({hierarchyCols.length} levels):
                  </Text>
                  <ColumnList>
                    {hierarchyCols.map((col, idx) => (
                      <ColumnItem key={col.key}>
                        Level {idx + 1}: <Text code>{col.title}</Text>
                      </ColumnItem>
                    ))}
                  </ColumnList>
                </ColumnSection>
              )}

              {periodCols.length > 0 && (
                <ColumnSection>
                  <Text strong type="secondary">
                    Time Dimension:
                  </Text>{' '}
                  <Text code>Period</Text>
                </ColumnSection>
              )}

              {dataCols.length > 0 && (
                <ColumnSection>
                  <Text strong type="secondary">
                    Data Elements ({dataCols.length}):
                  </Text>
                  <ColumnList>
                    {dataCols.map(col => (
                      <ColumnItem key={col.key}>
                        • <Text code>{col.title}</Text>
                      </ColumnItem>
                    ))}
                  </ColumnList>
                </ColumnSection>
              )}
            </ColumnSummaryBox>

            {/* Data Preview Table */}
            <div style={{ marginBottom: 8 }}>
              <Text strong>Sample Data Preview:</Text>
            </div>
            <div style={{ overflowX: 'auto', marginBottom: 12 }}>
              <Table
                columns={tableColumns}
                data={tableData}
                pagination={false}
                scroll={{ x: 'max-content' }}
              />
            </div>
            <Paragraph style={{ margin: 0 }}>
              <Text type="secondary">
                Showing {tableData.length} sample rows with{' '}
                {tableColumns.length} columns
              </Text>
            </Paragraph>
          </>
        )
      )}
    </StepContainer>
  );
}

const ColumnSummaryBox = styled.div`
  ${({ theme }) => `
    margin-bottom: 16px;
    padding: 12px 16px;
    background: ${theme.colorBgContainer};
    border-radius: 6px;
    border: 1px solid ${theme.colorBorder};
  `}
`;

const ColumnSection = styled.div`
  margin-bottom: 8px;
`;

const ColumnList = styled.div`
  margin-left: 12px;
  margin-top: 4px;
`;

const ColumnItem = styled.div`
  ${({ theme }) => `
    font-size: 11px;
    color: ${theme.colorTextSecondary};
    padding: 2px 0;
  `}
`;
