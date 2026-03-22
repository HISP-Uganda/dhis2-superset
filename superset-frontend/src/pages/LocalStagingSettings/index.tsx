import { useCallback, useEffect, useRef, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Radio,
  Row,
  Space,
  Spin,
  Statistic,
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
  DeleteOutlined,
  EyeOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  ImportOutlined,
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
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
  dependency_status?: Record<string, EngineDependencyStatus>;
  duckdb_available?: boolean;
  clickhouse_available?: boolean;
}

interface EngineDependencyPackage {
  package_name: string;
  module_name: string;
  installed: boolean;
  required: boolean;
}

interface EngineDependencyStatus {
  engine: string;
  ready: boolean;
  packages: EngineDependencyPackage[];
  install_command?: string | null;
}

interface StagingTable {
  schema: string;
  name: string;
  full_name?: string;
  type: string;
  role?: 'staging' | 'serving' | 'build' | 'other';
  managed?: boolean;
  row_count: number | null;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowcount: number;
  total_row_count?: number | null;
  table?: StagingTable;
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

interface DatabaseActionResult {
  action: string;
  processed_count: number;
  error_count: number;
  processed: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

const PageContainer = styled.div`
  ${({ theme }) => css`
    max-width: 1120px;
    margin: 0 auto;
    padding: ${theme.sizeUnit * 6}px ${theme.sizeUnit * 4}px;

    @media (max-width: 768px) {
      padding: ${theme.sizeUnit * 4}px ${theme.sizeUnit * 2}px;
    }
  `}
`;

const SectionCard = styled(Card)`
  ${({ theme }) => css`
    border-radius: ${theme.borderRadiusLG}px;
    box-shadow: 0 10px 32px rgba(15, 23, 42, 0.05);
  `}
`;

const MetricGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: ${theme.sizeUnit * 3}px;

    @media (max-width: 1200px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (max-width: 700px) {
      grid-template-columns: 1fr;
    }
  `}
`;

const EngineReadinessGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: ${theme.sizeUnit * 3}px;

    @media (max-width: 1100px) {
      grid-template-columns: 1fr;
    }
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

function getDependencyState(
  settings: LocalStagingSettingsData | null,
  engine: EngineType,
): EngineDependencyStatus | null {
  return (settings?.dependency_status?.[engine] as EngineDependencyStatus) || null;
}

function getRoleColor(role?: StagingTable['role']) {
  if (role === 'staging') return 'blue';
  if (role === 'serving') return 'green';
  if (role === 'build') return 'orange';
  return 'default';
}

function getRoleLabel(role?: StagingTable['role']) {
  if (role === 'staging') return t('Staging');
  if (role === 'serving') return t('Serving');
  if (role === 'build') return t('Build');
  return t('Other');
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

interface ExplorerTabProps {
  settings: LocalStagingSettingsData | null;
  onRefreshSettings: () => Promise<void>;
}

function ExplorerTab({ settings, onRefreshSettings }: ExplorerTabProps) {
  const { addDangerToast, addSuccessToast } = useToasts();
  const [tables, setTables] = useState<StagingTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [sql, setSql] = useState('SELECT * FROM information_schema.tables LIMIT 50');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryRunning, setQueryRunning] = useState(false);
  const [sqlLabExpose, setSqlLabExpose] = useState<boolean | null>(null);
  const [sqlLabSaving, setSqlLabSaving] = useState(false);
  const [sqlLabDbId, setSqlLabDbId] = useState<number | null>(null);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [maintenanceAction, setMaintenanceAction] = useState<string | null>(null);
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

  const handleTableAction = useCallback(async (
    table: StagingTable,
    action: 'preview' | 'truncate' | 'drop' | 'optimize',
  ) => {
    const actionKey = `${table.schema}.${table.name}:${action}`;
    setActionLoadingKey(actionKey);
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/local-staging/table-action',
        jsonPayload: {
          schema: table.schema,
          name: table.name,
          action,
          limit: 100,
        },
      });
      const result = response.json.result as QueryResult & { message?: string };
      if (action === 'preview') {
        setSql(`SELECT * FROM "${table.schema}"."${table.name}" LIMIT 100`);
        setQueryResult(result);
        addSuccessToast(t('Preview loaded for %s', table.name));
      } else {
        addSuccessToast(
          result.message ||
            (action === 'truncate'
              ? t('Rows cleared')
              : action === 'drop'
                ? t('Table deleted')
                : t('Table optimized')),
        );
        if (action === 'drop') {
          setQueryResult(current =>
            current?.table?.name === table.name ? null : current,
          );
        }
        void loadTables();
      }
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Table action failed')));
    } finally {
      setActionLoadingKey(null);
    }
  }, [addDangerToast, addSuccessToast, loadTables]);

  const handleDatabaseAction = useCallback(async (
    action: 'optimize_managed_tables' | 'cleanup_build_tables',
  ) => {
    setMaintenanceAction(action);
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/local-staging/database-action',
        jsonPayload: { action },
      });
      const result = response.json.result as DatabaseActionResult;
      addSuccessToast(
        action === 'cleanup_build_tables'
          ? t('Cleaned %s build table(s)', result.processed_count)
          : t('Optimized %s managed table(s)', result.processed_count),
      );
      if (result.error_count) {
        addDangerToast(
          t('%s action(s) reported errors', result.error_count),
        );
      }
      void loadTables();
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Database action failed')));
    } finally {
      setMaintenanceAction(null);
    }
  }, [addDangerToast, addSuccessToast, loadTables]);

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
    {
      title: t('Role'),
      dataIndex: 'role',
      key: 'role',
      render: (role?: StagingTable['role']) => (
        <Tag color={getRoleColor(role)}>{getRoleLabel(role)}</Tag>
      ),
    },
    { title: t('Type'), dataIndex: 'type', key: 'type',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: t('Rows'), dataIndex: 'row_count', key: 'row_count',
      render: (v: number | null) => v != null ? v.toLocaleString() : '—',
    },
    {
      title: t('Actions'),
      key: 'actions',
      width: 140,
      render: (_: unknown, row: StagingTable) => {
        const previewKey = `${row.schema}.${row.name}:preview`;
        const optimizeKey = `${row.schema}.${row.name}:optimize`;
        const rowLoading =
          actionLoadingKey === previewKey || actionLoadingKey === optimizeKey;
        const menuItems = row.managed
          ? [
              {
                key: 'optimize',
                label: t('Optimize'),
              },
              ...(row.role !== 'build'
                ? [
                    {
                      key: 'truncate',
                      label: t('Truncate rows'),
                    },
                  ]
                : []),
              {
                key: 'drop',
                danger: true,
                label: row.role === 'build' ? t('Clean up build') : t('Delete table'),
              },
            ]
          : [];

        return (
          <Space size={4} wrap>
            <Button
              size="small"
              icon={<EyeOutlined />}
              loading={actionLoadingKey === previewKey}
              onClick={() => void handleTableAction(row, 'preview')}
            >
              {t('Preview')}
            </Button>
            {row.managed ? (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: menuItems,
                  onClick: ({ key }) => {
                    if (key === 'truncate') {
                      if (!window.confirm(t('Clear all rows from %s?', row.name))) {
                        return;
                      }
                      void handleTableAction(row, 'truncate');
                      return;
                    }
                    if (key === 'drop') {
                      const confirmed = window.confirm(
                        row.role === 'build'
                          ? t('Delete this transient build table?')
                          : t('Drop %s completely?', row.name),
                      );
                      if (!confirmed) {
                        return;
                      }
                      void handleTableAction(row, 'drop');
                      return;
                    }
                    void handleTableAction(row, 'optimize');
                  },
                }}
              >
                <Button
                  size="small"
                  icon={<MoreOutlined />}
                  loading={rowLoading}
                />
              </Dropdown>
            ) : null}
          </Space>
        );
      },
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
  const activeEngine = settings?.active_engine || 'duckdb';
  const activeDependency = getDependencyState(settings, activeEngine);
  const managedTables = tables.filter(table => table.managed);
  const buildTables = tables.filter(table => table.role === 'build');
  const totalRows = tables.reduce(
    (sum, table) => sum + (Number(table.row_count) || 0),
    0,
  );
  const currentStatus = settings?.engine_health_status || {};

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <MetricGrid>
        <Card>
          <Statistic title={t('Active engine')} value={activeEngine} prefix={<DatabaseOutlined />} />
        </Card>
        <Card>
          <Statistic title={t('Managed tables')} value={managedTables.length} prefix={<TableOutlined />} />
        </Card>
        <Card>
          <Statistic title={t('Transient builds')} value={buildTables.length} prefix={<SettingOutlined />} />
        </Card>
        <Card>
          <Statistic
            title={t('Known rows')}
            value={totalRows}
            formatter={value => Number(value || 0).toLocaleString()}
            prefix={<ThunderboltOutlined />}
          />
        </Card>
      </MetricGrid>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <SectionCard
            title={
              <Space>
                <DatabaseOutlined />
                {t('Engine workspace')}
              </Space>
            }
            extra={
              <Button size="small" onClick={() => void onRefreshSettings()}>
                {t('Refresh status')}
              </Button>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label={t('Engine')}>
                  <Tag color="blue">{activeEngine}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label={t('Connectivity')}>
                  <Tag color={currentStatus.ok ? 'success' : 'error'}>
                    {currentStatus.ok ? t('Ready') : t('Attention')}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={t('Runtime packages')}>
                  <Tag color={activeDependency?.ready ? 'success' : 'warning'}>
                    {activeDependency?.ready ? t('Installed') : t('Missing packages')}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
              {currentStatus.message ? (
                <Alert
                  showIcon
                  type={currentStatus.ok ? 'success' : 'warning'}
                  message={currentStatus.message}
                />
              ) : null}
              {activeDependency?.packages?.length ? (
                <Space wrap>
                  {activeDependency.packages.map(pkg => (
                    <Tag
                      key={pkg.package_name}
                      color={pkg.installed ? 'success' : 'error'}
                    >
                      {pkg.package_name}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </Space>
          </SectionCard>

          <SectionCard
            title={
              <Space>
                <ThunderboltOutlined />
                {t('Maintenance')}
              </Space>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Text type="secondary">
                {t(
                  'Run maintenance safely on managed staging and serving objects without leaving the explorer.',
                )}
              </Text>
              <Space wrap>
                <Button
                  icon={<ReloadOutlined spin={tablesLoading} />}
                  loading={tablesLoading}
                  onClick={() => void loadTables()}
                >
                  {t('Refresh catalog')}
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={maintenanceAction === 'optimize_managed_tables'}
                  onClick={() => void handleDatabaseAction('optimize_managed_tables')}
                >
                  {t('Optimize managed')}
                </Button>
                <Popconfirm
                  title={t('Delete all transient build tables?')}
                  okText={t('Clean up')}
                  onConfirm={() => void handleDatabaseAction('cleanup_build_tables')}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    loading={maintenanceAction === 'cleanup_build_tables'}
                  >
                    {t('Clean build tables')}
                  </Button>
                </Popconfirm>
              </Space>
            </Space>
          </SectionCard>

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
                  {t('When enabled, the staging engine database is registered in SQL Lab so analysts can inspect serving tables directly.')}
                </Text>
              )}
            </Space>
          </SectionCard>

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
                  'These datasets still have rows in the legacy Superset-DB staging tables. Migrate them into the active engine without re-syncing from DHIS2.',
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
                    render: (_: unknown, row: MigratableDataset) => {
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
                    render: (_: unknown, row: MigratableDataset) =>
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
          <SectionCard
            data-test="local-staging-tables-card"
            title={
              <Space>
                <TableOutlined />
                {t('Managed catalog')}
              </Space>
            }
            extra={
              <Space>
                <Tag color="blue">{t('%s tables', tables.length)}</Tag>
                <Tag color="green">{t('%s managed', managedTables.length)}</Tag>
              </Space>
            }
          >
            <Table
              data-test="local-staging-tables-table"
              dataSource={tables}
              columns={tableColumns}
              rowKey={r => `${r.schema}.${r.name}`}
              size="small"
              pagination={{ pageSize: 12, hideOnSinglePage: true }}
              loading={tablesLoading}
              locale={{ emptyText: t('No tables found. Run a health check to verify the engine is reachable.') }}
              scroll={{ x: 'max-content' }}
            />
          </SectionCard>

          <SectionCard
            data-test="local-staging-query-card"
            title={
              <Space>
                <CodeOutlined />
                {t('Query workspace')}
              </Space>
            }
            extra={
              <Space>
                <Button
                  onClick={() =>
                    setSql('SELECT * FROM information_schema.tables LIMIT 50')
                  }
                >
                  {t('Reset SQL')}
                </Button>
                <Button
                  data-test="local-staging-query-run"
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={queryRunning}
                  onClick={() => void handleRunQuery()}
                >
                  {t('Run')}
                </Button>
              </Space>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Text type="secondary">
                {t(
                  'Preview tables, run bounded read-only SQL, and validate serving structures without leaving the staging workspace.',
                )}
              </Text>
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
              {queryResult ? (
                <div style={{ marginTop: 4 }}>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Text data-test="local-staging-query-rowcount" type="secondary">
                      {t('%s rows returned', queryResult.rowcount)}
                    </Text>
                    {queryResult.total_row_count != null ? (
                      <Tag color="blue">
                        {t('Total rows: %s', queryResult.total_row_count.toLocaleString())}
                      </Tag>
                    ) : null}
                    {queryResult.table?.role ? (
                      <Tag color={getRoleColor(queryResult.table.role)}>
                        {getRoleLabel(queryResult.table.role)}
                      </Tag>
                    ) : null}
                  </Space>
                  <Table
                    data-test="local-staging-query-results-table"
                    dataSource={queryResult.rows.map((r, i) => ({ ...r, __key: i }))}
                    columns={resultColumns}
                    rowKey="__key"
                    size="small"
                    scroll={{ x: 'max-content' }}
                    pagination={{ pageSize: 50, hideOnSinglePage: true }}
                  />
                </div>
              ) : (
                <Empty
                  description={t(
                    'Select a managed table to preview it, or run a bounded SELECT query.',
                  )}
                />
              )}
            </Space>
          </SectionCard>
      </Space>
    </Space>
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
  const [installingEngine, setInstallingEngine] = useState<EngineType | null>(null);

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

  const loadSettings = useCallback(async (showSpinner = true) => {
    if (showSpinner) {
      setLoading(true);
    }
    try {
      const resp = await SupersetClient.get({
        endpoint: '/api/v1/local-staging/settings',
      });
      const data = resp.json.result as LocalStagingSettingsData;
      setSettings(data);
      setActiveEngine(data.active_engine || 'superset_db');
      setRetentionEnabled(data.retention_enabled || false);
      if (data.duckdb_config) {
        const nextValues = data.duckdb_config as DuckDBConfig;
        setDuckdbInitialValues(prev => ({ ...prev, ...nextValues }));
        duckdbForm.setFieldsValue(nextValues);
      }
      if (data.clickhouse_config) {
        const nextValues = data.clickhouse_config as ClickHouseConfig;
        setClickhouseInitialValues(prev => ({ ...prev, ...nextValues }));
        clickhouseForm.setFieldsValue(nextValues);
      }
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Failed to load staging settings')));
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }, [
    addDangerToast,
    clickhouseForm,
    duckdbForm,
  ]);

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

  const handleInstallDependencies = useCallback(async (engine: EngineType) => {
    setInstallingEngine(engine);
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/local-staging/install-dependencies',
        jsonPayload: { engine },
      });
      const result = response.json.result as {
        ok?: boolean;
        message?: string;
        stderr?: string;
      };
      if (result.ok) {
        addSuccessToast(result.message || t('Dependencies installed'));
      } else {
        addDangerToast(result.stderr || result.message || t('Installation failed'));
      }
      await loadSettings(false);
    } catch (err) {
      addDangerToast(getErrorMessage(err, t('Failed to install dependencies')));
    } finally {
      setInstallingEngine(null);
    }
  }, [addDangerToast, addSuccessToast, loadSettings]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const dependencyStatus = settings?.dependency_status || {};
  const readyEngines = Object.values(dependencyStatus).filter(
    dependency => dependency?.ready,
  ).length;
  const healthStatus = settings?.engine_health_status || {};
  const selectedEngineDependency = getDependencyState(settings, activeEngine);

  if (loading) {
    return (
      <PageContainer>
        <Spin size="large" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div style={{ marginBottom: 24 }}>
        <Space
          align="start"
          size="large"
          style={{ justifyContent: 'space-between', width: '100%' }}
          wrap
        >
          <Space align="start" size="middle">
            <DatabaseOutlined style={{ fontSize: 28, marginTop: 4 }} />
            <div>
              <Title level={3} style={{ margin: 0 }}>
                {t('Local Staging Engine')}
              </Title>
              <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                {t(
                  'Manage the local DHIS2 staging and serving runtime from one workspace. Configure the active engine, install missing runtime modules, inspect managed tables, and run bounded maintenance safely.',
                )}
              </Paragraph>
            </div>
          </Space>
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void loadSettings(false)}
            >
              {t('Reload')}
            </Button>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={healthChecking}
              onClick={() => void handleHealthCheck()}
            >
              {t('Run health check')}
            </Button>
          </Space>
        </Space>
      </div>

      <MetricGrid style={{ marginBottom: 24 }}>
        <Card>
          <Statistic title={t('Saved engine')} value={settings?.active_engine || '—'} prefix={<DatabaseOutlined />} />
        </Card>
        <Card>
          <Statistic
            title={t('Health')}
            value={healthStatus.ok ? t('Ready') : t('Needs review')}
            prefix={<ThunderboltOutlined />}
          />
        </Card>
        <Card>
          <Statistic
            title={t('Runtime readiness')}
            value={t('%s / 3 ready', readyEngines)}
            prefix={<CheckCircleOutlined />}
          />
        </Card>
        <Card>
          <Statistic
            title={t('Retention')}
            value={retentionEnabled ? t('Enabled') : t('Off')}
            prefix={<SettingOutlined />}
          />
        </Card>
      </MetricGrid>

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
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
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
                            {t('Embedded analytical engine with strong local performance and zero external infrastructure.')}
                          </Text>
                          <Space wrap>
                            <Tag color="green">{t('Recommended')}</Tag>
                            <Tag color={getDependencyState(settings, 'duckdb')?.ready ? 'success' : 'warning'}>
                              {getDependencyState(settings, 'duckdb')?.ready ? t('Runtime ready') : t('Install runtime')}
                            </Tag>
                          </Space>
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
                            {t('Uses the existing Superset metadata database. Lowest setup overhead, but not ideal for heavy analytical staging volumes.')}
                          </Text>
                          <Space wrap>
                            <Tag color="blue">{t('Fallback')}</Tag>
                            <Tag color="success">{t('No extra packages')}</Tag>
                          </Space>
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
                            {t('High-throughput external columnar serving for larger DHIS2 deployments and sustained analytical concurrency.')}
                          </Text>
                          <Space wrap>
                            <Tag color="orange">{t('External service')}</Tag>
                            <Tag color={getDependencyState(settings, 'clickhouse')?.ready ? 'success' : 'warning'}>
                              {getDependencyState(settings, 'clickhouse')?.ready ? t('Connector ready') : t('Install connector')}
                            </Tag>
                          </Space>
                        </Space>
                      </EngineOptionCard>
                    </EngineCardGrid>
                  </SectionCard>

                  <SectionCard title={t('Engine readiness')}>
                    <EngineReadinessGrid>
                      {(['duckdb', 'superset_db', 'clickhouse'] as EngineType[]).map(engine => {
                        const dependency = getDependencyState(settings, engine);
                        const engineReady =
                          engine === 'superset_db' || Boolean(dependency?.ready);
                        const engineLabel =
                          engine === 'duckdb'
                            ? 'DuckDB'
                            : engine === 'clickhouse'
                              ? 'ClickHouse'
                              : 'Superset DB';
                        return (
                          <Card key={engine} size="small">
                            <Space direction="vertical" style={{ width: '100%' }}>
                              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                                <Text strong>{engineLabel}</Text>
                                <Tag color={engineReady ? 'success' : 'warning'}>
                                  {engineReady ? t('Ready') : t('Missing packages')}
                                </Tag>
                              </Space>
                              {dependency?.packages?.length ? (
                                <Space wrap>
                                  {dependency.packages.map(pkg => (
                                    <Tag
                                      key={pkg.package_name}
                                      color={pkg.installed ? 'success' : 'error'}
                                    >
                                      {pkg.package_name}
                                    </Tag>
                                  ))}
                                </Space>
                              ) : (
                                <Text type="secondary">
                                  {t('This engine does not require extra Python modules.')}
                                </Text>
                              )}
                              {!dependency?.ready && dependency?.packages?.length ? (
                                <Button
                                  type={activeEngine === engine ? 'primary' : 'default'}
                                  loading={installingEngine === engine}
                                  onClick={() => void handleInstallDependencies(engine)}
                                >
                                  {t('Install runtime')}
                                </Button>
                              ) : null}
                            </Space>
                          </Card>
                        );
                      })}
                    </EngineReadinessGrid>
                  </SectionCard>

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
                      {!settings?.duckdb_available && (
                        <Alert
                          message={t('DuckDB runtime is missing')}
                          description={
                            <Space direction="vertical" size={8}>
                              <Text>
                                {t('Install the embedded DuckDB runtime before saving or switching to this engine.')}
                              </Text>
                              <Button
                                type="primary"
                                loading={installingEngine === 'duckdb'}
                                onClick={() => void handleInstallDependencies('duckdb')}
                              >
                                {t('Install DuckDB runtime')}
                              </Button>
                            </Space>
                          }
                          showIcon
                          type="warning"
                        />
                      )}
                    </SectionCard>
                  )}

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
                          message={t('ClickHouse connector is missing')}
                          description={
                            <Space direction="vertical" size={8}>
                              <Text>
                                {t('Install the ClickHouse connector before enabling this engine.')}
                              </Text>
                              <Button
                                type="primary"
                                loading={installingEngine === 'clickhouse'}
                                onClick={() => void handleInstallDependencies('clickhouse')}
                              >
                                {t('Install ClickHouse connector')}
                              </Button>
                            </Space>
                          }
                          showIcon
                          type="warning"
                        />
                      )}
                    </SectionCard>
                  )}

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

                  <EngineStatusCard
                    loading={healthChecking}
                    status={settings?.engine_health_status || {}}
                    onCheck={() => void handleHealthCheck()}
                  />

                  {selectedEngineDependency && !selectedEngineDependency.ready ? (
                    <Alert
                      type="warning"
                      showIcon
                      message={t('Selected engine still needs runtime packages')}
                      description={
                        <Space wrap>
                          {selectedEngineDependency.packages.map(pkg => (
                            <Tag
                              key={pkg.package_name}
                              color={pkg.installed ? 'success' : 'error'}
                            >
                              {pkg.package_name}
                            </Tag>
                          ))}
                        </Space>
                      }
                    />
                  ) : null}

                  <Divider />
                  <Space wrap>
                    <Tooltip
                      title={
                        activeEngine === 'superset_db'
                          ? t('No external connection to test for the default engine')
                          : t('Test connectivity with the current form values before saving')
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

                    {!selectedEngineDependency?.ready && activeEngine !== 'superset_db' ? (
                      <Button
                        loading={installingEngine === activeEngine}
                        onClick={() => void handleInstallDependencies(activeEngine)}
                      >
                        {t('Install required runtime')}
                      </Button>
                    ) : null}

                    <Button
                      icon={<SaveOutlined />}
                      loading={saving}
                      type="primary"
                      onClick={() => void handleSave()}
                    >
                      {t('Save Settings')}
                    </Button>
                  </Space>

                  {settings && (
                    <div>
                      <Text type="secondary">
                        {t('Currently active engine:')}{' '}
                        <Tag>
                          <StatusDot $ok={settings.engine_health_status?.ok !== false} />
                          {settings.active_engine}
                        </Tag>
                      </Text>
                    </div>
                  )}
                </Space>
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
              children: (
                <ExplorerTab
                  settings={settings}
                  onRefreshSettings={() => loadSettings(false)}
                />
              ),
            },
          ]}
        />
    </PageContainer>
  );
}
