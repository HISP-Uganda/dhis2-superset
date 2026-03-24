import { useCallback, useEffect, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  CloudDownloadOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  CodeOutlined,
  DownOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

import { useToasts } from 'src/components/MessageToasts/withToasts';
import DHIS2PageLayout from 'src/features/dhis2/DHIS2PageLayout';
import useDHIS2Databases from 'src/features/dhis2/useDHIS2Databases';
import {
  formatDateTime,
  formatCount,
  getErrorMessage,
} from 'src/features/dhis2/utils';

const { Text } = Typography;

interface ServingColumn {
  column_name: string;
  verbose_name?: string | null;
  type?: string;
  filterable?: boolean;
  groupby?: boolean;
  is_active?: boolean;
  is_dttm?: boolean;
  extra?: string | null;
}

interface DatasetSummary {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
  serving_table_ref?: string;
  serving_columns?: (string | ServingColumn)[];
  serving_superset_dataset_id?: number | null;
  stats?: {
    row_count?: number;
    last_updated?: string;
  } | null;
  last_synced_at?: string | null;
}

const PageContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const DatasetName = styled.span`
  ${({ theme }) => css`
    font-weight: ${theme.fontWeightStrong};
  `}
`;

const ColumnList = styled.div`
  ${({ theme }) => css`
    max-height: 160px;
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.sizeUnit}px;
    padding: ${theme.sizeUnit}px 0;
  `}
`;

function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'dhis2_dataset'
  );
}

async function fetchExportRaw(datasetId: number, format: string): Promise<Response> {
  const res = await SupersetClient.get({
    endpoint: `/api/v1/dhis2/staged-datasets/${datasetId}/export?format=${format}`,
    parseMethod: 'raw',
  });
  // SupersetClient with parseMethod:'raw' returns the native Response
  return res as unknown as Response;
}

async function triggerBlobDownload(
  datasetId: number,
  datasetName: string,
  format: string,
  mimeType: string,
  extension: string,
  addDangerToast: (msg: string) => void,
): Promise<void> {
  try {
    const response = await fetchExportRaw(datasetId, format);
    const blob = await response.blob();
    saveAs(blob, `${sanitizeFilename(datasetName)}.${extension}`);
  } catch (err) {
    addDangerToast(
      t('Download failed: %s', getErrorMessage(err, 'Unknown error')),
    );
  }
}

async function downloadAsXlsx(
  datasetId: number,
  datasetName: string,
  addDangerToast: (msg: string) => void,
): Promise<void> {
  try {
    const response = await fetchExportRaw(datasetId, 'json');
    const text = await response.text();
    const rows: Record<string, unknown>[] = JSON.parse(text);
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, `${sanitizeFilename(datasetName)}.xlsx`);
  } catch (err) {
    addDangerToast(t('Excel download failed: %s', getErrorMessage(err, 'Unknown error')));
  }
}

async function downloadAsPdf(
  datasetId: number,
  datasetName: string,
  addDangerToast: (msg: string) => void,
): Promise<void> {
  try {
    const response = await fetchExportRaw(datasetId, 'json');
    const text = await response.text();
    const rows: Record<string, unknown>[] = JSON.parse(text);
    if (!rows.length) {
      addDangerToast(t('No data to print.'));
      return;
    }
    const columns = Object.keys(rows[0]);
    const tableRows = rows
      .map(r => `<tr>${columns.map(c => `<td>${r[c] ?? ''}</td>`).join('')}</tr>`)
      .join('');
    const html = `<!DOCTYPE html><html><head><title>${datasetName}</title>
<style>
  body{font-family:sans-serif;font-size:11px;margin:16px;}
  h2{font-size:14px;margin-bottom:8px;}
  table{border-collapse:collapse;width:100%;}
  th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;white-space:nowrap;}
  th{background:#f0f0f0;font-weight:bold;}
  @media print{@page{size:landscape;margin:10mm;}}
</style></head><body>
<h2>${datasetName}</h2>
<table>
  <thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
  <tbody>${tableRows}</tbody>
</table></body></html>`;
    const win = window.open('', '_blank');
    if (!win) {
      addDangerToast(
        t('Unable to open print window — allow pop-ups for this site and try again.'),
      );
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  } catch (err) {
    addDangerToast(t('Print preparation failed: %s', getErrorMessage(err, 'Unknown error')));
  }
}

export default function DHIS2Downloads() {
  const { addDangerToast } = useToasts();
  const {
    databases,
    loading: loadingDatabases,
    selectedDatabaseId,
    setSelectedDatabaseId,
  } = useDHIS2Databases(addDangerToast);

  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const loadDatasets = useCallback(async () => {
    if (!selectedDatabaseId) return;
    setLoading(true);
    try {
      const resp = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/staged-datasets/?database_id=${selectedDatabaseId}&include_stats=true`,
      });
      setDatasets(((resp.json as any)?.result ?? []) as DatasetSummary[]);
    } catch (err) {
      addDangerToast(t('Failed to load datasets: %s', getErrorMessage(err, 'Unknown error')));
    } finally {
      setLoading(false);
    }
  }, [selectedDatabaseId]);

  useEffect(() => {
    void loadDatasets();
  }, [loadDatasets]);

  function withDownloadTracking(
    datasetId: number,
    fn: () => Promise<void>,
  ): void {
    setDownloadingId(datasetId);
    fn().finally(() => setDownloadingId(null));
  }

  function buildDownloadMenu(dataset: DatasetSummary): MenuProps {
    return {
      items: [
        {
          key: 'csv',
          icon: <FileTextOutlined />,
          label: t('Download CSV'),
          onClick: () =>
            withDownloadTracking(dataset.id, () =>
              triggerBlobDownload(
                dataset.id,
                dataset.name,
                'csv',
                'text/csv',
                'csv',
                addDangerToast,
              ),
            ),
        },
        {
          key: 'tsv',
          icon: <FileTextOutlined />,
          label: t('Download TSV'),
          onClick: () =>
            withDownloadTracking(dataset.id, () =>
              triggerBlobDownload(
                dataset.id,
                dataset.name,
                'tsv',
                'text/tab-separated-values',
                'tsv',
                addDangerToast,
              ),
            ),
        },
        {
          key: 'json',
          icon: <CodeOutlined />,
          label: t('Download JSON'),
          onClick: () =>
            withDownloadTracking(dataset.id, () =>
              triggerBlobDownload(
                dataset.id,
                dataset.name,
                'json',
                'application/json',
                'json',
                addDangerToast,
              ),
            ),
        },
        {
          key: 'xlsx',
          icon: <FileExcelOutlined />,
          label: t('Download Excel (XLSX)'),
          onClick: () =>
            withDownloadTracking(dataset.id, () =>
              downloadAsXlsx(dataset.id, dataset.name, addDangerToast),
            ),
        },
        { type: 'divider' as const },
        {
          key: 'pdf',
          icon: <FilePdfOutlined />,
          label: t('Print / Save as PDF'),
          onClick: () =>
            withDownloadTracking(dataset.id, () =>
              downloadAsPdf(dataset.id, dataset.name, addDangerToast),
            ),
        },
      ],
    };
  }

  const columns = [
    {
      title: t('Dataset'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: DatasetSummary) => (
        <Space direction="vertical" size={2}>
          <DatasetName>{name}</DatasetName>
          {record.description ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.description}
            </Text>
          ) : null}
          {!record.is_active ? (
            <Tag color="default" style={{ marginTop: 2 }}>
              {t('Inactive')}
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('Rows'),
      key: 'rows',
      width: 100,
      render: (_: unknown, record: DatasetSummary) => {
        const count = record.stats?.row_count;
        return count != null ? (
          <Text>{formatCount(count)}</Text>
        ) : (
          <Text type="secondary">—</Text>
        );
      },
    },
    {
      title: t('Columns'),
      key: 'columns',
      width: 100,
      render: (_: unknown, record: DatasetSummary) => {
        const cols = record.serving_columns;
        if (!cols?.length) return <Text type="secondary">—</Text>;
        const colNames = cols.map(c =>
          typeof c === 'string' ? c : c.column_name,
        );
        return (
          <Tooltip
            title={
              <ColumnList>
                {colNames.map(name => (
                  <Tag key={name} style={{ marginBottom: 2 }}>
                    {name}
                  </Tag>
                ))}
              </ColumnList>
            }
          >
            <Text style={{ cursor: 'help', borderBottom: '1px dashed #999' }}>
              {cols.length}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: t('Last Updated'),
      key: 'last_updated',
      width: 170,
      render: (_: unknown, record: DatasetSummary) => {
        const ts = record.last_synced_at || record.stats?.last_updated;
        return ts ? (
          <Text style={{ fontSize: 12 }}>{formatDateTime(ts)}</Text>
        ) : (
          <Text type="secondary">—</Text>
        );
      },
    },
    {
      title: t('Actions'),
      key: 'actions',
      width: 200,
      render: (_: unknown, record: DatasetSummary) => (
        <Space>
          <Dropdown menu={buildDownloadMenu(record)} trigger={['click']}>
            <Button
              size="small"
              icon={
                downloadingId === record.id ? (
                  <Spin size="small" style={{ marginRight: 4 }} />
                ) : (
                  <CloudDownloadOutlined />
                )
              }
              disabled={downloadingId === record.id}
            >
              {t('Download')} <DownOutlined />
            </Button>
          </Dropdown>
          {record.serving_superset_dataset_id ? (
            <Tooltip title={t('Open dataset in Explore')}>
              <Button
                size="small"
                type="link"
                href={`/explore/?datasource_id=${record.serving_superset_dataset_id}&datasource_type=table`}
                target="_blank"
              >
                {t('Explore')}
              </Button>
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <DHIS2PageLayout
      activeTab="downloads"
      title={t('Download Datasets')}
      description={t(
        'Download analytical data from DHIS2 datasets in CSV, TSV, JSON, Excel, or PDF formats.',
      )}
      databases={databases}
      loadingDatabases={loadingDatabases}
      selectedDatabaseId={selectedDatabaseId}
      onDatabaseChange={setSelectedDatabaseId}
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void loadDatasets()}
          loading={loading}
        >
          {t('Refresh')}
        </Button>
      }
    >
      <PageContent>
        {!selectedDatabaseId ? (
          <Alert
            message={t('Select a DHIS2 database above to view available datasets.')}
            type="info"
            showIcon
          />
        ) : loading ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Spin size="large" tip={t('Loading datasets…')} />
          </div>
        ) : !datasets.length ? (
          <Empty
            description={t(
              'No datasets found for this database. Configure datasets on the Health tab first.',
            )}
          />
        ) : (
          <Table
            dataSource={datasets}
            columns={columns}
            rowKey="id"
            size="middle"
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
          />
        )}
      </PageContent>
    </DHIS2PageLayout>
  );
}
