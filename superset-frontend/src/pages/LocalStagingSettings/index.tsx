import { useCallback, useEffect, useRef, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  DatabaseOutlined,
  PlayCircleOutlined,
  ImportOutlined,
  ReloadOutlined,
  SaveOutlined,
  TableOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons';

import { useToasts } from 'src/components/MessageToasts/withToasts';

const { Title, Text, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EngineType = 'superset_db' | 'duckdb' | 'clickhouse';

interface DuckDBConfig {
  db_path: string;
  memory_limit?: string;
  threads?: number;
}

interface ClickHouseConfig {
  host: string;
  http_port?: number;
  port?: number;
  database?: string;
  serving_database?: string;
  user?: string;
  password?: string;
  secure?: boolean;
  verify?: boolean;
  connect_timeout?: number;
  send_receive_timeout?: number;
}

interface EngineHealthStatus {
  ok?: boolean;
  message?: string;
  engine?: string;
  checked_at?: string;
  [key: string]: unknown;
}

interface LocalStagingSettingsData {
  active_engine: EngineType;
  duckdb_config: DuckDBConfig | null;
  clickhouse_config: ClickHouseConfig | null;
  retention_enabled: boolean;
  retention_config: Record<string, unknown> | null;
  engine_health_status: EngineHealthStatus;
  clickhouse_available?: boolean;
}

interface StagingTable {
  schema: string;
  name: string;
  type: string;
  row_count: number | null;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowcount: number;
}

interface MigratableDataset {
  dataset_id: number;
  dataset_name: string;
  source_table: string;
  source_rows: number;
  destination_exists: boolean;
  destination_rows: number;
  needs_migration: boolean;
}

interface MigrationResult {
  dataset_id: number;
  dataset_name: string;
  status: 'ok' | 'partial' | 'skipped';
  imported?: number;
  reason?: string;
  serving_error?: string | null;
}

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

const PageContainer = styled.div`
  ${({ theme }) => css`
    max-width: 960px;
    margin: 0 auto;
    padding: ${theme.sizeUnit * 6}px ${theme.sizeUnit * 4}px;
  `}
`;

const SectionCard = styled(Card)`
  ${({ theme }) => css`
    margin-bottom: ${theme.sizeUnit * 4}px;
  `}
`;

const EngineCardGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: ${theme.sizeUnit * 3}px;

    @media (max-width: 700px) {
      grid-template-columns: 1fr;
    }
  `}
`;

const EngineOptionCard = styled(Card, {
  shouldForwardProp: prop => prop !== '$selected',
})<{ $selected?: boolean }>`
  ${({ theme, $selected }) => css`
    cursor: pointer;
    border: 2px solid
      ${$selected ? theme.colorPrimary : theme.colorBorderSecondary};
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    &:hover {
      border-color: ${theme.colorPrimary};
    }

    ${$selected &&
    css`
      box-shadow: 0 0 0 2px ${theme.colorPrimaryBg};
    `}
  `}
`;

const StatusDot = styled.span<{ $ok?: boolean }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  background: ${({ $ok }) => ($ok ? '#52c41a' : '#ff4d4f')};
`;

const SqlEditor = styled.textarea`
  ${({ theme }) => css`
    width: 100%;
    min-height: 120px;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 13px;
    padding: ${theme.sizeUnit * 2}px;
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadius}px;
    resize: vertical;
    background: ${theme.colorBgContainer};
    color: ${theme.colorText};
    outline: none;

    &:focus {
      border-color: ${theme.colorPrimary};
    }
  `}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getErrorMessage(error: unknown, fallback = t('Unknown error')): string {
  if (typeof error === 'string') return error;
  if (error && typeof (error as any).message === 'string')
    return (error as any).message;
  return fallback;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface EngineStatusCardProps {
  status: EngineHealthStatus;
  loading: boolean;
  onCheck: () => void;
}

function EngineStatusCard({ status, loading, onCheck }: EngineStatusCardProps) {
  const hasStatus = Object.keys(status).length > 0;
  return (
    <SectionCard
      title={
        <Space>
          <ThunderboltOutlined />
          {t('Engine Status')}
        </Space>
      }
      extra={
        <Button
          icon={<ReloadOutlined spin={loading} />}
          loading={loading}
          size="small"
          onClick={onCheck}
        >
          {t('Run Health Check')}
        </Button>
      }
    >
      {!hasStatus ? (
        <Text type="secondary">
          {t('No health check has been run yet. Click "Run Health Check" to test the active engine.')}
        </Text>
      ) : (
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label={t('Status')} span={2}>
            {status.ok ? (
              <Tag icon={<CheckCircleOutlined />} color="success">
                {t('Connected')}
              </Tag>
            ) : (
              <Tag icon={<CloseCircleOutlined />} color="error">
                {t('Error')}
              </Tag>
            )}
          </Descriptions.Item>
          {status.message && (
            <Descriptions.Item label={t('Message')} span={2}>
              <Text type={status.ok ? undefined : 'danger'}>{status.message}</Text>
            </Descriptions.Item>
          )}
          {status.engine && (
            <Descriptions.Item label={t('Engine')}>
              <Tag>{status.engine}</Tag>
            </Descriptions.Item>
          )}
          {status.checked_at && (
            <Descriptions.Item label={t('Checked at')}>
              <Text type="secondary">
                {new Date(status.checked_at).toLocaleString()}
              </Text>
            </Descriptions.Item>
          )}
          {status.db_path && (
            <Descriptions.Item label={t('DB path')} span={2}>
              <Text code>{String(status.db_path)}</Text>
            </Descriptions.Item>
          )}
          {status.host && (
            <Descriptions.Item label={t('Host')}>
              {String(status.host)}
            </Descriptions.Item>
          )}
          {status.database && (
            <Descriptions.Item label={t('Database')}>
              {String(status.database)}
            </Descriptions.Item>
          )}
        </Descriptions>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Explorer tab
// ---------------------------------------------------------------------------

function ExplorerTab() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const [tables, setTables] = useState<StagingTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [sql, setSql] = useState('SELECT * FROM main.information_schema.tables LIMIT 50');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryRunning, setQueryRunning] = useState(false);
  const [sqlLabExpose, setSqlLabExpose] = useState<boolean | null>(null);
  const [sqlLabSaving, setSqlLabSaving] = useState(false);
  const [sqlLabDbId, setSqlLabDbId] = useState<number | null>(null);
  const sqlLabLoaded = useRef(false);

  // Migration from superset_db
  const [migratable, setMigratable] = useState<MigratableDataset[]>([]);
  const [migratableLoading, setMigratableLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationResults, setMigrationResults] = useState<MigrationResult[]>([]);

  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    try {
      const resp = await SupersetClient.get({
        endpoint: '/api/v1/local-staging/tables',
      });
      setTables((resp.json.result as StagingTable[]) || []);
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Failed to load tables')));
    } finally {
      setTablesLoading(false);
    }
  }, [addDangerToast]);

  // Load SQL Lab exposure state from the settings endpoint
  const loadSqlLabState = useCallback(async () => {
    if (sqlLabLoaded.current) return;
    try {
      const resp = await SupersetClient.get({
        endpoint: '/api/v1/local-staging/settings',
      });
      const _data = resp.json.result as any; void _data;
      // The expose flag lives on the Superset Database record. We probe it
      // via the sqllab-expose endpoint's PUT response once available, but
      // on first load we check the serving database_id indirectly.
      // If there's no serving DB yet, default to false.
      setSqlLabExpose(false);
      sqlLabLoaded.current = true;
    } catch {
      // ignore
    }
  }, []);

  const loadMigratable = useCallback(async () => {
    setMigratableLoading(true);
    try {
      const resp = await SupersetClient.get({
        endpoint: '/api/v1/local-staging/migrate-from-superset-db',
      });
      setMigratable((resp.json.result as MigratableDataset[]) || []);
    } catch {
      // Not critical — migration panel is informational
    } finally {
      setMigratableLoading(false);
    }
  }, []);

  const handleMigrate = useCallback(async (datasetIds?: number[]) => {
    setMigrating(true);
    setMigrationResults([]);
    try {
      const resp = await SupersetClient.post({
        endpoint: '/api/v1/local-staging/migrate-from-superset-db',
        jsonPayload: datasetIds ? { dataset_ids: datasetIds } : {},
      });
      const results = (resp.json.result as MigrationResult[]) || [];
      setMigrationResults(results);
      const ok = results.filter(r => r.status === 'ok').length;
      const skip = results.filter(r => r.status === 'skipped').length;
      if (ok > 0) addSuccessToast(t('Migrated %s dataset(s)', ok));
      if (skip > 0) addDangerToast(t('%s dataset(s) skipped', skip));
      void loadMigratable();
      void loadTables();
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Migration failed')));
    } finally {
      setMigrating(false);
    }
  }, [addSuccessToast, addDangerToast, loadMigratable, loadTables]);

  useEffect(() => {
    void loadTables();
    void loadSqlLabState();
    void loadMigratable();
  }, [loadTables, loadSqlLabState, loadMigratable]);

  const handleRunQuery = useCallback(async () => {
    if (!sql.trim()) return;
    setQueryRunning(true);
    setQueryResult(null);
    try {
      const resp = await SupersetClient.post({
        endpoint: '/api/v1/local-staging/run-query',
        jsonPayload: { sql, limit: 500 },
      });
      setQueryResult(resp.json.result as QueryResult);
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Query failed')));
    } finally {
      setQueryRunning(false);
    }
  }, [sql, addDangerToast]);

  const handleTableClick = useCallback((table: StagingTable) => {
    setSql(`SELECT * FROM "${table.schema}"."${table.name}" LIMIT 100`);
  }, []);

  const handleSqlLabToggle = useCallback(async (checked: boolean) => {
    setSqlLabSaving(true);
    try {
      const resp = await SupersetClient.put({
        endpoint: '/api/v1/local-staging/sqllab-expose',
        jsonPayload: { expose: checked },
      });
      const result = resp.json.result as any;
      setSqlLabExpose(checked);
      setSqlLabDbId(result.database_id ?? null);
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Failed to update SQL Lab exposure')));
    } finally {
      setSqlLabSaving(false);
    }
  }, [addDangerToast]);

  const tableColumns = [
    { title: t('Table'), dataIndex: 'name', key: 'name',
      render: (name: string, row: StagingTable) => (
        <Button type="link" size="small" onClick={() => handleTableClick(row)}>
          {name}
        </Button>
      ),
    },
    { title: t('Schema'), dataIndex: 'schema', key: 'schema' },
    { title: t('Type'), dataIndex: 'type', key: 'type',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: t('Rows'), dataIndex: 'row_count', key: 'row_count',
      render: (v: number | null) => v != null ? v.toLocaleString() : '—',
    },
  ];

  const resultColumns = (queryResult?.columns || []).map(col => ({
    title: col,
    dataIndex: col,
    key: col,
    ellipsis: true,
    render: (v: unknown) => v == null ? <Text type="secondary">null</Text> : String(v),
  }));

  const needsMigration = migratable.filter(d => d.needs_migration);

  return (
    <div>
      {/* Migration from superset_db */}
      {(migratableLoading || migratable.length > 0) && (
        <SectionCard
          title={
            <Space>
              <ImportOutlined />
              {t('Migrate from Superset DB')}
              {needsMigration.length > 0 && (
                <Tag color="warning">
                  <WarningOutlined /> {needsMigration.length} {t('pending')}
                </Tag>
              )}
            </Space>
          }
          extra={
            <Space>
              <Button
                size="small"
                icon={<ReloadOutlined spin={migratableLoading} />}
                onClick={() => void loadMigratable()}
                loading={migratableLoading}
              >
                {t('Refresh')}
              </Button>
              {needsMigration.length > 0 && (
                <Button
                  type="primary"
                  size="small"
                  icon={<ImportOutlined />}
                  loading={migrating}
                  onClick={() => void handleMigrate()}
                >
                  {t('Migrate All')}
                </Button>
              )}
            </Space>
          }
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {t(
              'These datasets have existing rows in the legacy Superset-DB staging tables. ' +
              'Migrate them to copy the data into the active engine (DuckDB) without re-syncing from DHIS2.',
            )}
          </Text>
          <Table
            dataSource={migratable}
            rowKey="dataset_id"
            size="small"
            loading={migratableLoading}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            columns={[
              { title: t('Dataset'), dataIndex: 'dataset_name', key: 'name' },
              {
                title: t('Source table'),
                dataIndex: 'source_table',
                key: 'src',
                render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text>,
              },
              {
                title: t('Source rows'),
                dataIndex: 'source_rows',
                key: 'src_rows',
                render: (v: number) => v >= 0 ? v.toLocaleString() : '—',
              },
              {
                title: t('Destination rows'),
                dataIndex: 'destination_rows',
                key: 'dst_rows',
                render: (v: number) => v >= 0 ? v.toLocaleString() : '—',
              },
              {
                title: t('Status'),
                key: 'status',
                render: (_: any, row: MigratableDataset) => {
                  const res = migrationResults.find(r => r.dataset_id === row.dataset_id);
                  if (res) {
                    return (
                      <Tag color={res.status === 'ok' ? 'success' : res.status === 'partial' ? 'warning' : 'default'}>
                        {res.status === 'ok' ? t('Migrated (%s rows)', res.imported) : res.status === 'skipped' ? t('Skipped') : t('Partial')}
                      </Tag>
                    );
                  }
                  return row.needs_migration
                    ? <Tag color="warning">{t('Needs migration')}</Tag>
                    : <Tag color="success">{t('Up to date')}</Tag>;
                },
              },
              {
                title: '',
                key: 'action',
                render: (_: any, row: MigratableDataset) =>
                  row.needs_migration ? (
                    <Button
                      size="small"
                      loading={migrating}
                      onClick={() => void handleMigrate([row.dataset_id])}
                    >
                      {t('Migrate')}
                    </Button>
                  ) : null,
              },
            ]}
          />
        </SectionCard>
      )}

      {/* SQL Lab exposure */}
      <SectionCard
        title={
          <Space>
            <DatabaseOutlined />
            {t('SQL Lab Access')}
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Switch
              checked={sqlLabExpose === true}
              loading={sqlLabSaving}
              onChange={handleSqlLabToggle}
            />
            <Text>
              {t('Expose staging database in SQL Lab')}
            </Text>
          </Space>
          {sqlLabExpose && sqlLabDbId && (
            <Alert
              type="success"
              showIcon
              message={
                <Text>
                  {t('Staging database is visible in SQL Lab (Database ID: %s).', sqlLabDbId)}
                  {' '}
                  {t('Users with SQL Lab access can browse and query serving tables directly.')}
                </Text>
              }
            />
          )}
          {sqlLabExpose === false && (
            <Text type="secondary">
              {t('When enabled, the staging engine database is registered in SQL Lab so analysts can run raw SQL against serving tables. Only SELECT is permitted via DuckDB\'s read-only connection.')}
            </Text>
          )}
        </Space>
      </SectionCard>

      {/* Table browser */}
      <SectionCard
        data-test="local-staging-tables-card"
        title={
          <Space>
            <TableOutlined />
            {t('Tables')}
          </Space>
        }
        extra={
          <Button
            icon={<ReloadOutlined spin={tablesLoading} />}
            size="small"
            onClick={loadTables}
            loading={tablesLoading}
          >
            {t('Refresh')}
          </Button>
        }
      >
        <Table
          data-test="local-staging-tables-table"
          dataSource={tables}
          columns={tableColumns}
          rowKey={r => `${r.schema}.${r.name}`}
          size="small"
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          loading={tablesLoading}
          locale={{ emptyText: t('No tables found. Run a health check to verify the engine is reachable.') }}
        />
      </SectionCard>

      {/* Query runner */}
      <SectionCard
        data-test="local-staging-query-card"
        title={
          <Space>
            <CodeOutlined />
            {t('SQL Query')}
          </Space>
        }
        extra={
          <Button
            data-test="local-staging-query-run"
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={queryRunning}
            onClick={() => void handleRunQuery()}
          >
            {t('Run')}
          </Button>
        }
      >
        <div data-test="local-staging-query-editor">
          <SqlEditor
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleRunQuery();
              }
            }}
            placeholder={t('Enter a SELECT query… (Ctrl+Enter to run)')}
            spellCheck={false}
          />
        </div>
        {queryResult && (
          <div style={{ marginTop: 16 }}>
            <Text data-test="local-staging-query-rowcount" type="secondary">
              {t('%s rows returned', queryResult.rowcount)}
            </Text>
            <Table
              data-test="local-staging-query-results-table"
              dataSource={queryResult.rows.map((r, i) => ({ ...r, __key: i }))}
              columns={resultColumns}
              rowKey="__key"
              size="small"
              scroll={{ x: 'max-content' }}
              pagination={{ pageSize: 50, hideOnSinglePage: true }}
              style={{ marginTop: 8 }}
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function LocalStagingSettingsPage() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const [settings, setSettings] = useState<LocalStagingSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [healthChecking, setHealthChecking] = useState(false);

  // Local form state (mirrors settings but editable before save)
  const [activeEngine, setActiveEngine] = useState<EngineType>('superset_db');
  const [duckdbForm] = Form.useForm<DuckDBConfig>();
  const [clickhouseForm] = Form.useForm<ClickHouseConfig>();
  const [duckdbInitialValues, setDuckdbInitialValues] = useState<DuckDBConfig>({
    db_path: '',
    memory_limit: '1GB',
    threads: 2,
  });
  const [clickhouseInitialValues, setClickhouseInitialValues] = useState<ClickHouseConfig>({
    host: '',
    http_port: 8123,
    database: 'dhis2_staging',
    serving_database: 'dhis2_serving',
    user: 'dhis2_user',
    password: '',
    secure: false,
    verify: true,
    connect_timeout: 10,
    send_receive_timeout: 300,
  });
  const [retentionEnabled, setRetentionEnabled] = useState(false);

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await SupersetClient.get({
        endpoint: '/api/v1/local-staging/settings',
      });
      const data = resp.json.result as LocalStagingSettingsData;
      setSettings(data);
      setActiveEngine(data.active_engine || 'superset_db');
      setRetentionEnabled(data.retention_enabled || false);
      if (data.duckdb_config) {
        setDuckdbInitialValues(prev => ({ ...prev, ...(data.duckdb_config as DuckDBConfig) }));
      }
      if (data.clickhouse_config) {
        setClickhouseInitialValues(prev => ({ ...prev, ...(data.clickhouse_config as ClickHouseConfig) }));
      }
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Failed to load staging settings')));
    } finally {
      setLoading(false);
    }
  }, [addDangerToast]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    let duckdbConfig: DuckDBConfig | null = null;
    let clickhouseConfig: ClickHouseConfig | null = null;

    try {
      if (activeEngine === 'duckdb') {
        duckdbConfig = await duckdbForm.validateFields();
      }
      if (activeEngine === 'clickhouse') {
        clickhouseConfig = await clickhouseForm.validateFields();
      }
    } catch {
      return; // form validation failed
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        active_engine: activeEngine,
        retention_enabled: retentionEnabled,
      };
      if (duckdbConfig) payload.duckdb_config = duckdbConfig;
      if (clickhouseConfig) payload.clickhouse_config = clickhouseConfig;

      const resp = await SupersetClient.put({
        endpoint: '/api/v1/local-staging/settings',
        jsonPayload: payload,
      });
      const updated = resp.json.result as LocalStagingSettingsData;
      setSettings(updated);
      addSuccessToast(t('Staging engine settings saved'));
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Failed to save settings')));
    } finally {
      setSaving(false);
    }
  }, [
    activeEngine,
    duckdbForm,
    clickhouseForm,
    retentionEnabled,
    addDangerToast,
    addSuccessToast,
  ]);

  // ---------------------------------------------------------------------------
  // Test connection
  // ---------------------------------------------------------------------------

  const handleTestConnection = useCallback(async () => {
    let config: DuckDBConfig | ClickHouseConfig | Record<string, unknown> = {};
    try {
      if (activeEngine === 'duckdb') {
        config = await duckdbForm.validateFields();
      }
      if (activeEngine === 'clickhouse') {
        config = await clickhouseForm.validateFields();
      }
    } catch {
      return;
    }

    setTesting(true);
    try {
      const resp = await SupersetClient.post({
        endpoint: '/api/v1/local-staging/test-connection',
        jsonPayload: { engine: activeEngine, config },
      });
      const result = resp.json.result as EngineHealthStatus;
      if (result.ok) {
        addSuccessToast(t('Connection successful: %s', result.message || ''));
      } else {
        addDangerToast(t('Connection failed: %s', result.message || ''));
      }
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Test connection failed')));
    } finally {
      setTesting(false);
    }
  }, [activeEngine, duckdbForm, clickhouseForm, addDangerToast, addSuccessToast]);

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  const handleHealthCheck = useCallback(async () => {
    setHealthChecking(true);
    try {
      const resp = await SupersetClient.post({
        endpoint: '/api/v1/local-staging/health-check',
        jsonPayload: {},
      });
      const status = resp.json.result as EngineHealthStatus;
      setSettings(prev =>
        prev ? { ...prev, engine_health_status: status } : prev,
      );
      if (status.ok) {
        addSuccessToast(t('Engine is healthy'));
      } else {
        addDangerToast(t('Engine health check failed: %s', status.message || ''));
      }
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Health check failed')));
    } finally {
      setHealthChecking(false);
    }
  }, [addDangerToast, addSuccessToast]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <PageContainer>
        <Spin size="large" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Space align="center">
          <DatabaseOutlined style={{ fontSize: 28 }} />
          <div>
            <Title level={3} style={{ margin: 0 }}>
              {t('Local Staging Engine')}
            </Title>
            <Paragraph type="secondary" style={{ margin: 0 }}>
              {t(
                'Choose where DHIS2 staged data is physically stored. ' +
                  'The default Superset DB works out of the box. ' +
                  'Switch to DuckDB for faster embedded analytics or ClickHouse for large-scale columnar storage.',
              )}
            </Paragraph>
          </div>
        </Space>
      </div>

      <Tabs
        defaultActiveKey="settings"
        items={[
          {
            key: 'settings',
            label: (
              <Space>
                <ThunderboltOutlined />
                {t('Settings')}
              </Space>
            ),
            children: (
              <div>
          {/* Engine selector */}
          <SectionCard title={t('Storage Engine')}>
            <EngineCardGrid>
              <EngineOptionCard
                $selected={activeEngine === 'duckdb'}
                onClick={() => setActiveEngine('duckdb')}
              >
                <Space direction="vertical" size={4}>
                  <Space>
                    <Radio checked={activeEngine === 'duckdb'} />
                    <Text strong>DuckDB</Text>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('Default — embedded file-based analytical database. Zero external services. Internal access only: not exposed in SQL Lab. Ideal for this deployment.')}
                  </Text>
                  <Tag color="green">{t('Default — recommended')}</Tag>
                </Space>
              </EngineOptionCard>

              <EngineOptionCard
                $selected={activeEngine === 'superset_db'}
                onClick={() => setActiveEngine('superset_db')}
              >
                <Space direction="vertical" size={4}>
                  <Space>
                    <Radio checked={activeEngine === 'superset_db'} />
                    <Text strong>Superset DB</Text>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('Stores data in the same database Superset uses for its own metadata. No extra setup required. Suitable for small datasets only.')}
                  </Text>
                  <Tag color="blue">{t('Fallback option')}</Tag>
                </Space>
              </EngineOptionCard>

              <EngineOptionCard
                $selected={activeEngine === 'clickhouse'}
                onClick={() => setActiveEngine('clickhouse')}
              >
                <Space direction="vertical" size={4}>
                  <Space>
                    <Radio checked={activeEngine === 'clickhouse'} />
                    <Text strong>ClickHouse</Text>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('External high-performance columnar store. Best for hundreds of millions of rows and multi-tenant workloads.')}
                  </Text>
                  <Tag color="orange">{t('Requires separate ClickHouse service')}</Tag>
                </Space>
              </EngineOptionCard>
            </EngineCardGrid>
          </SectionCard>

          {/* DuckDB config */}
          {activeEngine === 'duckdb' && (
            <SectionCard title={t('DuckDB Configuration')}>
              <Form form={duckdbForm} layout="vertical" initialValues={duckdbInitialValues}>
                <Form.Item
                  label={t('Database file path')}
                  name="db_path"
                  rules={[
                    {
                      required: true,
                      message: t('Database file path is required'),
                    },
                  ]}
                  extra={t(
                    'Absolute path where the DuckDB file will be created, e.g. /var/lib/superset/dhis2_staging.duckdb',
                  )}
                >
                  <Input
                    placeholder="/var/lib/superset/dhis2_staging.duckdb"
                    style={{ fontFamily: 'monospace' }}
                  />
                </Form.Item>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      label={t('Memory limit')}
                      name="memory_limit"
                      extra={t('e.g. 512MB, 2GB')}
                    >
                      <Input placeholder="1GB" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      label={t('Threads')}
                      name="threads"
                      extra={t('Parallel query threads')}
                    >
                      <InputNumber min={1} max={32} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            </SectionCard>
          )}

          {/* ClickHouse config */}
          {activeEngine === 'clickhouse' && (
            <SectionCard title={t('ClickHouse Configuration')}>
              <Form form={clickhouseForm} layout="vertical" initialValues={clickhouseInitialValues}>
                <Row gutter={16}>
                  <Col span={16}>
                    <Form.Item
                      label={t('Host')}
                      name="host"
                      rules={[{ required: true, message: t('Host is required') }]}
                    >
                      <Input placeholder="localhost" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label={t('HTTP Port')} name="http_port">
                      <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      label={t('Staging Database')}
                      name="database"
                      extra={t('Database for raw staging tables (ds_*)')}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      label={t('Serving Database')}
                      name="serving_database"
                      extra={t('Database for serving tables (sv_*) queried by Superset')}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label={t('User')} name="user">
                      <Input autoComplete="username" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label={t('Password')} name="password">
                      <Input.Password
                        placeholder={t('Leave blank if none')}
                        autoComplete="current-password"
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item
                      label={t('TLS / Secure')}
                      name="secure"
                      valuePropName="checked"
                      extra={t('Encrypt the connection')}
                    >
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item
                      label={t('Verify TLS Certificate')}
                      name="verify"
                      valuePropName="checked"
                      extra={t('Validate server certificate')}
                    >
                      <Switch />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      label={t('Connect Timeout (s)')}
                      name="connect_timeout"
                    >
                      <InputNumber min={1} max={120} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      label={t('Send/Receive Timeout (s)')}
                      name="send_receive_timeout"
                    >
                      <InputNumber min={1} max={3600} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              </Form>

              {settings?.clickhouse_available === false && (
                <Alert
                  message={t('Dependency required')}
                  description={
                    <Text>
                      {t('Install the ClickHouse client before enabling this engine:')}
                      {' '}
                      <Text code>pip install clickhouse-connect</Text>
                    </Text>
                  }
                  showIcon
                  type="warning"
                  style={{ marginTop: 8 }}
                />
              )}
            </SectionCard>
          )}

          {/* Retention policy */}
          <SectionCard
            title={
              <Space>
                {t('Retention Policy')}
                <Switch
                  checked={retentionEnabled}
                  checkedChildren={t('On')}
                  size="small"
                  unCheckedChildren={t('Off')}
                  onChange={setRetentionEnabled}
                />
              </Space>
            }
          >
            {retentionEnabled ? (
              <Alert
                message={t('Retention configuration coming soon')}
                description={t(
                  'You have enabled retention. Configure max age, max versions, and size limits in a future release.',
                )}
                showIcon
                type="info"
              />
            ) : (
              <Text type="secondary">
                {t('Retention is disabled. Staged data is kept indefinitely.')}
              </Text>
            )}
          </SectionCard>

          {/* Status */}
          <EngineStatusCard
            loading={healthChecking}
            status={settings?.engine_health_status || {}}
            onCheck={() => void handleHealthCheck()}
          />

          {/* Actions */}
          <Divider />
          <Space>
            <Tooltip
              title={
                activeEngine === 'superset_db'
                  ? t('No external connection to test for the default engine')
                  : t('Test connectivity with the current form values (before saving)')
              }
            >
              <Button
                disabled={activeEngine === 'superset_db'}
                icon={<CheckCircleOutlined />}
                loading={testing}
                onClick={() => void handleTestConnection()}
              >
                {t('Test Connection')}
              </Button>
            </Tooltip>

            <Button
              icon={<SaveOutlined />}
              loading={saving}
              type="primary"
              onClick={() => void handleSave()}
            >
              {t('Save Settings')}
            </Button>
          </Space>

          {/* Current active engine indicator */}
          {settings && (
            <div style={{ marginTop: 16 }}>
              <Text type="secondary">
                {t('Currently active engine:')}{' '}
                <Tag>
                  <StatusDot $ok={settings.engine_health_status?.ok !== false} />
                  {settings.active_engine}
                </Tag>
              </Text>
            </div>
              )}
            </div>
            ),
          },
          {
            key: 'explorer',
            label: (
              <Space>
                <CodeOutlined />
                {t('Data Explorer')}
              </Space>
            ),
            children: <ExplorerTab />,
          },
        ]}
      />
    </PageContainer>
  );
}
