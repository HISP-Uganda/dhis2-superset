/* eslint-disable theme-colors/no-literal-colors */
import { useCallback, useEffect, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Select,
  Statistic,
  Tag,
  Tooltip,
} from '@superset-ui/core/components';
import { useToasts } from 'src/components/MessageToasts/withToasts';

/* ── Types ────────────────────────────────────────────── */

type UsageStats = {
  period_days: number;
  total_requests: number;
  successful: number;
  errors: number;
  error_rate: number;
  avg_duration_ms: number;
  total_question_chars: number;
  total_response_chars: number;
  avg_response_length: number;
  active_users: number;
  total_conversations: number;
  trend_pct: number;
  percentiles: { p50?: number; p90?: number; p99?: number; max?: number };
  by_mode: Record<string, { total: number; success: number; error: number }>;
  by_provider: { provider_id: string; count: number; avg_duration_ms: number }[];
  by_model: { model: string; count: number }[];
  daily: { date: string; success: number; error: number; total: number }[];
  top_users: {
    user_id: number;
    username: string;
    count: number;
    avg_duration_ms: number;
  }[];
  recent_errors: {
    id: number;
    mode: string;
    provider_id: string;
    model_name: string;
    error_message: string;
    created_on: string;
  }[];
  system?: {
    ai_enabled: boolean;
    default_provider: string | null;
    default_model: string | null;
    max_tokens: number;
    temperature: number;
    request_timeout_seconds: number;
    configured_providers: {
      provider_id: string;
      type: string;
      label: string;
      enabled: boolean;
      model_count: number;
      default_model: string | null;
    }[];
    configured_models: {
      provider_id: string;
      model: string;
      is_default: boolean;
      provider_enabled: boolean;
    }[];
    total_providers: number;
    enabled_providers: number;
    total_models: number;
  };
};

type LogEntry = {
  id: number;
  user_id: number;
  username: string;
  mode: string;
  provider_id: string;
  model_name: string;
  question_length?: number;
  response_length?: number;
  duration_ms?: number;
  status: string;
  error_message?: string;
  target_id?: string;
  created_on: string;
};

type LogResponse = {
  entries: LogEntry[];
  total: number;
};

/* ── Styled Components ───────────────────────────────── */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const HeaderRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
`;

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
`;

const SummaryCard = styled(Card)<{ $accent?: string }>`
  .ant-card-body {
    padding: 16px 20px;
    position: relative;
  }
  border-top: 3px solid ${({ $accent }) => $accent || '#3B82F6'};
`;

const TrendBadge = styled.span<{ $positive: boolean }>`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: ${({ $positive }) => ($positive ? '#D1FAE5' : '#FEE2E2')};
  color: ${({ $positive }) => ($positive ? '#065F46' : '#991B1B')};
`;

const SectionTitle = styled.h4`
  font-size: 15px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 12px;
`;

const BarChartContainer = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 160px;
  padding: 0 0 24px;
  position: relative;
`;

const BarGroup = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  position: relative;
  min-width: 0;
`;

const BarStack = styled.div`
  width: 100%;
  max-width: 32px;
  display: flex;
  flex-direction: column-reverse;
  border-radius: 3px 3px 0 0;
  overflow: hidden;
`;

const BarSegment = styled.div<{ $height: number; $color: string }>`
  width: 100%;
  height: ${({ $height }) => Math.max(0, $height)}px;
  background: ${({ $color }) => $color};
  transition: height 0.3s ease;
`;

const BarLabel = styled.div`
  position: absolute;
  bottom: 0;
  font-size: 9px;
  color: #9CA3AF;
  white-space: nowrap;
  transform: rotate(-45deg);
  transform-origin: top left;
  left: 50%;
`;

const ProgressRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 13px;
`;

const ProgressBar = styled.div<{ $pct: number; $color: string }>`
  flex: 1;
  height: 8px;
  background: #F3F4F6;
  border-radius: 4px;
  overflow: hidden;

  &::after {
    content: '';
    display: block;
    height: 100%;
    width: ${({ $pct }) => Math.min(100, $pct)}%;
    background: ${({ $color }) => $color};
    border-radius: 4px;
    transition: width 0.4s ease;
  }
`;

const ModeColors: Record<string, string> = {
  chart: '#3B82F6',
  dashboard: '#8B5CF6',
  sql: '#F59E0B',
  chart_generate: '#10B981',
};

const LogTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th, td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid #E5EAF0;
    white-space: nowrap;
  }
  th {
    font-weight: 600;
    color: #6B7280;
    background: #F9FAFB;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  tr:hover td { background: #F8FAFC; }
`;

const StatusDot = styled.span<{ $success: boolean }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $success }) => ($success ? '#10B981' : '#EF4444')};
  margin-right: 6px;
`;

const PaginationRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  font-size: 12px;
  color: #6B7280;
`;

const FilterBar = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
`;

const PercentileBar = styled.div`
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
`;

const PercentileItem = styled.div`
  text-align: center;
  .label { font-size: 10px; color: #9CA3AF; text-transform: uppercase; font-weight: 600; letter-spacing: 0.04em; }
  .value { font-size: 20px; font-weight: 700; color: #111827; }
  .unit { font-size: 11px; color: #6B7280; }
`;

const ConfigGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
`;

const ConfigItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #F9FAFB;
  border-radius: 6px;
  font-size: 13px;

  .config-label { color: #6B7280; }
  .config-value { font-weight: 600; color: #111827; }
`;

const ProviderCard = styled.div<{ $enabled: boolean }>`
  padding: 12px 16px;
  border: 1px solid ${({ $enabled }) => ($enabled ? '#D1FAE5' : '#FEE2E2')};
  border-radius: 8px;
  background: ${({ $enabled }) => ($enabled ? '#F0FDF4' : '#FEF2F2')};

  .provider-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .provider-name { font-weight: 700; font-size: 14px; color: #111827; }
  .provider-type { font-size: 11px; color: #6B7280; }
  .model-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
`;

const ErrorRow = styled.div`
  padding: 8px 12px;
  border-left: 3px solid #EF4444;
  background: #FEF2F2;
  border-radius: 0 6px 6px 0;
  margin-bottom: 6px;
  font-size: 12px;

  .error-meta {
    color: #9CA3AF;
    font-size: 11px;
    margin-bottom: 2px;
  }
  .error-msg {
    color: #991B1B;
    word-break: break-word;
  }
`;

const UserRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #F3F4F6;

  .rank {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #EFF6FF;
    color: #2563EB;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .name { flex: 1; font-weight: 600; font-size: 13px; color: #111827; }
  .stat { font-size: 12px; color: #6B7280; min-width: 60px; text-align: right; }
  .count { font-weight: 700; color: #111827; font-size: 14px; min-width: 40px; text-align: right; }
`;

/* ── Helpers ──────────────────────────────────────────── */

function formatDuration(ms: number | undefined | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Component ────────────────────────────────────────── */

export default function UsageAnalyticsTab() {
  const { addDangerToast } = useToasts();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(0);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<string | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(
    undefined,
  );
  const [filterProvider, setFilterProvider] = useState<string | undefined>(undefined);
  const [filterModel, setFilterModel] = useState<string | undefined>(undefined);

  const PAGE_SIZE = 50;

  const fetchStats = useCallback(async () => {
    try {
      const { json } = await SupersetClient.get({
        endpoint: `/api/v1/ai-management/usage/stats?days=${days}`,
      });
      setStats(json.result);
    } catch {
      addDangerToast(t('Failed to load usage stats'));
    }
  }, [addDangerToast, days]);

  const fetchLog = useCallback(
    async (page = 0) => {
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        if (filterMode) params.set('mode', filterMode);
        if (filterStatus) params.set('status', filterStatus);
        if (filterProvider) params.set('provider', filterProvider);
        if (filterModel) params.set('model', filterModel);
        const { json } = await SupersetClient.get({
          endpoint: `/api/v1/ai-management/usage/log?${params}`,
        });
        const resp = json.result;
        // Handle both old (flat array) and new ({entries, total}) format
        if (Array.isArray(resp)) {
          setLog(resp);
          setLogTotal(resp.length);
        } else {
          setLog(resp?.entries || []);
          setLogTotal(resp?.total || 0);
        }
      } catch {
        // table may not exist
      }
    },
    [filterMode, filterStatus, filterProvider, filterModel],
  );

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStats(), fetchLog(0)]).finally(() => setLoading(false));
  }, [fetchStats, fetchLog]);

  useEffect(() => {
    setLogPage(0);
    fetchLog(0);
  }, [filterMode, filterStatus, filterProvider, filterModel, fetchLog]);

  // Normalize stats fields that may be missing from an older backend
  const safeStats = stats
    ? {
        ...stats,
        error_rate: stats.error_rate ?? 0,
        trend_pct: stats.trend_pct ?? 0,
        active_users: stats.active_users ?? 0,
        total_conversations: stats.total_conversations ?? 0,
        avg_response_length: stats.avg_response_length ?? 0,
        total_question_chars: stats.total_question_chars ?? 0,
        total_response_chars: stats.total_response_chars ?? 0,
        percentiles: stats.percentiles ?? {},
        by_mode: stats.by_mode ?? {},
        by_provider: Array.isArray(stats.by_provider)
          ? stats.by_provider
          : Object.entries(stats.by_provider || {}).map(([pid, val]) => ({
              provider_id: pid,
              count: typeof val === 'number' ? val : (val as any)?.count ?? 0,
              avg_duration_ms: typeof val === 'number' ? 0 : (val as any)?.avg_duration_ms ?? 0,
            })),
        by_model: stats.by_model ?? [],
        daily: (stats.daily ?? []).map(d =>
          typeof d.total === 'number'
            ? d
            : { ...d, total: (d as any).count ?? 0, success: (d as any).count ?? 0, error: 0 },
        ),
        top_users: (stats.top_users ?? []).map(u => ({
          ...u,
          username: u.username ?? `User ${u.user_id}`,
          avg_duration_ms: u.avg_duration_ms ?? 0,
        })),
        recent_errors: stats.recent_errors ?? [],
      }
    : null;

  const maxDaily = safeStats
    ? Math.max(...safeStats.daily.map(d => d.total), 1)
    : 1;
  const chartHeight = 120;

  // by_mode may be old format {mode: count} or new {mode: {total, success, error}}
  const normalizedByMode: Record<string, { total: number; success: number; error: number }> =
    safeStats
      ? Object.fromEntries(
          Object.entries(safeStats.by_mode).map(([mode, val]) => [
            mode,
            typeof val === 'number'
              ? { total: val, success: val, error: 0 }
              : val,
          ]),
        )
      : {};

  const totalModeRequests =
    Object.values(normalizedByMode).reduce((s, m) => s + m.total, 0) || 1;

  // Only enabled providers and their models
  const enabledProviders = safeStats?.system?.configured_providers?.filter(p => p.enabled) ?? [];
  const enabledModels = safeStats?.system?.configured_models?.filter(m => m.provider_enabled) ?? [];

  return (
    <Container>
      {/* Header */}
      <HeaderRow>
        <div>
          <h3
            css={css`
              margin: 0;
              font-size: 18px;
              font-weight: 700;
              color: #111827;
            `}
          >
            {t('AI Usage Analytics')}
          </h3>
          <span
            css={css`
              font-size: 12px;
              color: #9ca3af;
            `}
          >
            {safeStats
              ? t(
                  'Showing data for the last %s days',
                  String(safeStats.period_days),
                )
              : ''}
          </span>
        </div>
        <div css={css`display: flex; gap: 8px; align-items: center;`}>
          <Select value={days} onChange={setDays} style={{ width: 150 }}>
            <Select.Option value={7}>{t('Last 7 days')}</Select.Option>
            <Select.Option value={30}>{t('Last 30 days')}</Select.Option>
            <Select.Option value={90}>{t('Last 90 days')}</Select.Option>
            <Select.Option value={365}>{t('Last year')}</Select.Option>
          </Select>
          <Button
            buttonStyle="secondary"
            onClick={() => {
              setLoading(true);
              Promise.all([fetchStats(), fetchLog(logPage)]).finally(() =>
                setLoading(false),
              );
            }}
          >
            {t('Refresh')}
          </Button>
        </div>
      </HeaderRow>

      {loading && !safeStats && (
        <Alert type="info" message={t('Loading analytics...')} />
      )}

      {/* ── System Configuration (always shown when stats loaded) ── */}
      {safeStats?.system && (
        <Card>
          <SectionTitle>
            {t('System Configuration')}
            <Tag
              color={safeStats.system.ai_enabled ? 'green' : 'red'}
              css={css`margin-left: 8px; font-size: 10px;`}
            >
              {safeStats.system.ai_enabled ? t('AI Enabled') : t('AI Disabled')}
            </Tag>
          </SectionTitle>

          <ConfigGrid>
            <ConfigItem>
              <span className="config-label">{t('Default Provider')}</span>
              <span className="config-value">{safeStats.system.default_provider || '—'}</span>
            </ConfigItem>
            <ConfigItem>
              <span className="config-label">{t('Default Model')}</span>
              <span className="config-value">{safeStats.system.default_model || '—'}</span>
            </ConfigItem>
            <ConfigItem>
              <span className="config-label">{t('Max Tokens')}</span>
              <span className="config-value">{formatNumber(safeStats.system.max_tokens)}</span>
            </ConfigItem>
            <ConfigItem>
              <span className="config-label">{t('Temperature')}</span>
              <span className="config-value">{safeStats.system.temperature}</span>
            </ConfigItem>
            <ConfigItem>
              <span className="config-label">{t('Timeout')}</span>
              <span className="config-value">{safeStats.system.request_timeout_seconds}s</span>
            </ConfigItem>
            <ConfigItem>
              <span className="config-label">{t('Active Providers')}</span>
              <span className="config-value">
                {safeStats.system.enabled_providers}
              </span>
            </ConfigItem>
            <ConfigItem>
              <span className="config-label">{t('Models Available')}</span>
              <span className="config-value">{enabledModels.length}</span>
            </ConfigItem>
          </ConfigGrid>

          {enabledProviders.length > 0 && (
            <div css={css`margin-top: 16px;`}>
              <div css={css`font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 8px;`}>
                {t('Active Providers')}
              </div>
              <Row gutter={12}>
                {enabledProviders.map(p => (
                  <Col key={p.provider_id} xs={24} sm={12} md={8} css={css`margin-bottom: 12px;`}>
                    <ProviderCard $enabled>
                      <div className="provider-header">
                        <StatusDot $success />
                        <span className="provider-name">{p.label}</span>
                        <span className="provider-type">({p.type})</span>
                      </div>
                      <div css={css`font-size: 12px; color: #6B7280;`}>
                        {p.model_count} {t('models')}
                        {p.default_model && (
                          <span> · {t('default')}: <strong>{p.default_model}</strong></span>
                        )}
                      </div>
                      <div className="model-list">
                        {enabledModels
                          .filter(m => m.provider_id === p.provider_id)
                          .map(m => (
                            <Tag
                              key={m.model}
                              color={m.is_default ? 'blue' : 'default'}
                              css={css`font-size: 10px; margin: 0;`}
                            >
                              {m.model}
                            </Tag>
                          ))}
                      </div>
                    </ProviderCard>
                  </Col>
                ))}
              </Row>
            </div>
          )}
        </Card>
      )}

      {safeStats && (
        <>
          {/* ── Summary Cards ── */}
          <SummaryGrid>
            <SummaryCard $accent="#3B82F6">
              <Statistic
                title={t('Total Requests')}
                value={safeStats.total_requests}
                formatter={(v) => formatNumber(Number(v))}
              />
              {safeStats.trend_pct !== 0 && (
                <TrendBadge $positive={safeStats.trend_pct > 0}>
                  {safeStats.trend_pct > 0 ? '+' : ''}
                  {safeStats.trend_pct}%
                </TrendBadge>
              )}
            </SummaryCard>
            <SummaryCard $accent="#10B981">
              <Statistic
                title={t('Success Rate')}
                value={
                  safeStats.total_requests > 0
                    ? (100 - safeStats.error_rate).toFixed(1)
                    : '—'
                }
                suffix="%"
                valueStyle={{
                  color:
                    safeStats.error_rate < 5
                      ? '#059669'
                      : safeStats.error_rate < 15
                        ? '#D97706'
                        : '#DC2626',
                }}
              />
            </SummaryCard>
            <SummaryCard $accent="#8B5CF6">
              <Statistic
                title={t('Active Users')}
                value={safeStats.active_users}
              />
            </SummaryCard>
            <SummaryCard $accent="#F59E0B">
              <Statistic
                title={t('Conversations')}
                value={safeStats.total_conversations}
              />
            </SummaryCard>
            <SummaryCard $accent="#6366F1">
              <Statistic
                title={t('Avg Response Time')}
                value={formatDuration(safeStats.avg_duration_ms)}
              />
            </SummaryCard>
            <SummaryCard $accent="#EC4899">
              <Statistic
                title={t('Errors')}
                value={safeStats.errors}
                valueStyle={{
                  color: safeStats.errors > 0 ? '#DC2626' : '#6B7280',
                }}
              />
            </SummaryCard>
            <SummaryCard $accent="#14B8A6">
              <Statistic
                title={t('Avg Response Length')}
                value={formatNumber(safeStats.avg_response_length)}
                suffix={t('chars')}
              />
            </SummaryCard>
            <SummaryCard $accent="#0EA5E9">
              <Statistic
                title={t('Total Content Generated')}
                value={formatNumber(safeStats.total_response_chars)}
                suffix={t('chars')}
              />
            </SummaryCard>
          </SummaryGrid>

          {/* ── Daily Volume Chart ── */}
          {safeStats.daily.length > 0 && (
            <Card
              title={
                <SectionTitle>{t('Daily Request Volume')}</SectionTitle>
              }
              css={css`.ant-card-head { border: none; padding-bottom: 0; }`}
            >
              <div css={css`display: flex; gap: 16px; margin-bottom: 8px; font-size: 11px;`}>
                <span>
                  <span css={css`display: inline-block; width: 10px; height: 10px; background: #3B82F6; border-radius: 2px; margin-right: 4px;`} />
                  {t('Success')}
                </span>
                <span>
                  <span css={css`display: inline-block; width: 10px; height: 10px; background: #EF4444; border-radius: 2px; margin-right: 4px;`} />
                  {t('Errors')}
                </span>
              </div>
              <BarChartContainer>
                {safeStats.daily.map(d => {
                  const successH =
                    (d.success / maxDaily) * chartHeight;
                  const errorH = (d.error / maxDaily) * chartHeight;
                  return (
                    <BarGroup key={d.date}>
                      <Tooltip
                        title={`${d.date}: ${d.total} total (${d.success} ok, ${d.error} err)`}
                      >
                        <BarStack>
                          <BarSegment
                            $height={successH}
                            $color="#3B82F6"
                          />
                          <BarSegment
                            $height={errorH}
                            $color="#EF4444"
                          />
                        </BarStack>
                      </Tooltip>
                      <BarLabel>{d.date.slice(5)}</BarLabel>
                    </BarGroup>
                  );
                })}
              </BarChartContainer>
            </Card>
          )}

          {/* ── Mode & Provider Breakdown ── */}
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Card>
                <SectionTitle>{t('Requests by Mode')}</SectionTitle>
                {Object.entries(normalizedByMode).map(([mode, data]) => (
                  <ProgressRow key={mode}>
                    <Tag color={ModeColors[mode] || '#6B7280'}>
                      {mode}
                    </Tag>
                    <ProgressBar
                      $pct={(data.total / totalModeRequests) * 100}
                      $color={ModeColors[mode] || '#6B7280'}
                    />
                    <strong>{data.total}</strong>
                  </ProgressRow>
                ))}
                {Object.keys(normalizedByMode).length === 0 && (
                  <span css={css`color: #9ca3af; font-size: 13px;`}>
                    {t('No data')}
                  </span>
                )}
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <SectionTitle>{t('Requests by Provider')}</SectionTitle>
                {safeStats.by_provider.map(p => (
                  <ProgressRow key={p.provider_id}>
                    <span
                      css={css`
                        font-weight: 600;
                        min-width: 80px;
                      `}
                    >
                      {p.provider_id}
                    </span>
                    <ProgressBar
                      $pct={
                        (p.count / safeStats.total_requests) * 100
                      }
                      $color="#6366F1"
                    />
                    <span css={css`min-width: 60px; text-align: right;`}>
                      <strong>{p.count}</strong>
                      <br />
                      <span css={css`font-size: 10px; color: #9CA3AF;`}>
                        {formatDuration(p.avg_duration_ms)}
                      </span>
                    </span>
                  </ProgressRow>
                ))}
                {safeStats.by_provider.length === 0 && (
                  <span css={css`color: #9ca3af; font-size: 13px;`}>
                    {t('No data')}
                  </span>
                )}
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card>
                <SectionTitle>{t('Models Used')}</SectionTitle>
                {safeStats.by_model.map(m => (
                  <ProgressRow key={m.model}>
                    <span
                      css={css`
                        flex: 1;
                        font-size: 12px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                      `}
                      title={m.model}
                    >
                      {m.model}
                    </span>
                    <strong>{m.count}</strong>
                  </ProgressRow>
                ))}
                {safeStats.by_model.length === 0 && (
                  <span css={css`color: #9ca3af; font-size: 13px;`}>
                    {t('No data')}
                  </span>
                )}
              </Card>
            </Col>
          </Row>

          {/* ── Response Time Percentiles ── */}
          {safeStats.percentiles && Object.keys(safeStats.percentiles).length > 0 && (
            <Card>
              <SectionTitle>{t('Response Time Distribution')}</SectionTitle>
              <PercentileBar>
                {safeStats.percentiles.p50 != null && (
                  <PercentileItem>
                    <div className="label">P50</div>
                    <div className="value">
                      {formatDuration(safeStats.percentiles.p50)}
                    </div>
                    <div className="unit">{t('median')}</div>
                  </PercentileItem>
                )}
                {safeStats.percentiles.p90 != null && (
                  <PercentileItem>
                    <div className="label">P90</div>
                    <div className="value">
                      {formatDuration(safeStats.percentiles.p90)}
                    </div>
                  </PercentileItem>
                )}
                {safeStats.percentiles.p99 != null && (
                  <PercentileItem>
                    <div className="label">P99</div>
                    <div className="value">
                      {formatDuration(safeStats.percentiles.p99)}
                    </div>
                  </PercentileItem>
                )}
                {safeStats.percentiles.max != null && (
                  <PercentileItem>
                    <div className="label">{t('Max')}</div>
                    <div className="value">
                      {formatDuration(safeStats.percentiles.max)}
                    </div>
                  </PercentileItem>
                )}
              </PercentileBar>
            </Card>
          )}

          {/* ── Top Users & Recent Errors ── */}
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Card>
                <SectionTitle>{t('Top Users')}</SectionTitle>
                {safeStats.top_users.map((user, idx) => (
                  <UserRow key={user.user_id}>
                    <div className="rank">{idx + 1}</div>
                    <div className="name">{user.username}</div>
                    <div className="stat">
                      {formatDuration(user.avg_duration_ms)}
                    </div>
                    <div className="count">{user.count}</div>
                  </UserRow>
                ))}
                {safeStats.top_users.length === 0 && (
                  <span css={css`color: #9ca3af; font-size: 13px;`}>
                    {t('No data')}
                  </span>
                )}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card>
                <SectionTitle>
                  {t('Recent Errors')}
                  {safeStats.recent_errors.length > 0 && (
                    <Tag
                      color="red"
                      css={css`
                        margin-left: 8px;
                        font-size: 10px;
                      `}
                    >
                      {safeStats.recent_errors.length}
                    </Tag>
                  )}
                </SectionTitle>
                {safeStats.recent_errors.map(err => (
                  <ErrorRow key={err.id}>
                    <div className="error-meta">
                      {timeAgo(err.created_on)} · {err.mode} ·{' '}
                      {err.provider_id}/{err.model_name}
                    </div>
                    <div className="error-msg">
                      {err.error_message || t('Unknown error')}
                    </div>
                  </ErrorRow>
                ))}
                {safeStats.recent_errors.length === 0 && (
                  <div
                    css={css`
                      text-align: center;
                      padding: 20px;
                      color: #10b981;
                      font-size: 13px;
                    `}
                  >
                    {t('No errors in this period')}
                  </div>
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* ── Activity Log ── */}
      <Card>
        <SectionTitle>{t('Activity Log')}</SectionTitle>

        <FilterBar>
          <Select
            value={filterMode}
            onChange={setFilterMode}
            allowClear
            placeholder={t('All modes')}
            style={{ width: 140 }}
          >
            <Select.Option value="chart">{t('Chart')}</Select.Option>
            <Select.Option value="dashboard">
              {t('Dashboard')}
            </Select.Option>
            <Select.Option value="sql">{t('SQL')}</Select.Option>
            <Select.Option value="chart_generate">
              {t('Chart Gen')}
            </Select.Option>
          </Select>
          <Select
            value={filterStatus}
            onChange={setFilterStatus}
            allowClear
            placeholder={t('All statuses')}
            style={{ width: 140 }}
          >
            <Select.Option value="success">{t('Success')}</Select.Option>
            <Select.Option value="error">{t('Error')}</Select.Option>
          </Select>
          <Select
            value={filterProvider}
            onChange={(val: string | undefined) => {
              setFilterProvider(val);
              setFilterModel(undefined);
            }}
            allowClear
            placeholder={t('All providers')}
            style={{ width: 160 }}
          >
            {enabledProviders.map(p => (
              <Select.Option key={p.provider_id} value={p.provider_id}>
                {p.label}
              </Select.Option>
            ))}
          </Select>
          <Select
            value={filterModel}
            onChange={setFilterModel}
            allowClear
            placeholder={t('All models')}
            style={{ width: 200 }}
          >
            {enabledModels
              .filter(m => !filterProvider || m.provider_id === filterProvider)
              .map(m => (
                <Select.Option key={`${m.provider_id}/${m.model}`} value={m.model}>
                  {m.model}
                </Select.Option>
              ))}
          </Select>
          <span
            css={css`
              font-size: 12px;
              color: #9ca3af;
              align-self: center;
            `}
          >
            {t('%s total entries', String(logTotal))}
          </span>
        </FilterBar>

        <div css={css`overflow-x: auto; max-height: 480px; overflow-y: auto;`}>
          <LogTable>
            <thead>
              <tr>
                <th>{t('Time')}</th>
                <th>{t('User')}</th>
                <th>{t('Mode')}</th>
                <th>{t('Provider')}</th>
                <th>{t('Model')}</th>
                <th>{t('Input')}</th>
                <th>{t('Output')}</th>
                <th>{t('Duration')}</th>
                <th>{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {log.map(entry => (
                <tr key={entry.id}>
                  <td>
                    <Tooltip
                      title={new Date(entry.created_on).toLocaleString()}
                    >
                      {timeAgo(entry.created_on)}
                    </Tooltip>
                  </td>
                  <td>{entry.username}</td>
                  <td>
                    <Tag
                      color={ModeColors[entry.mode] || 'default'}
                      css={css`font-size: 10px;`}
                    >
                      {entry.mode}
                    </Tag>
                  </td>
                  <td>{entry.provider_id}</td>
                  <td
                    css={css`
                      max-width: 140px;
                      overflow: hidden;
                      text-overflow: ellipsis;
                    `}
                    title={entry.model_name}
                  >
                    {entry.model_name}
                  </td>
                  <td>
                    {entry.question_length != null
                      ? formatNumber(entry.question_length)
                      : '—'}
                  </td>
                  <td>
                    {entry.response_length != null
                      ? formatNumber(entry.response_length)
                      : '—'}
                  </td>
                  <td>{formatDuration(entry.duration_ms)}</td>
                  <td>
                    <StatusDot $success={entry.status === 'success'} />
                    {entry.status === 'success' ? (
                      t('OK')
                    ) : (
                      <Tooltip title={entry.error_message}>
                        <span css={css`color: #DC2626;`}>
                          {t('Error')}
                        </span>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    css={css`
                      text-align: center;
                      padding: 24px;
                      color: #9ca3af;
                    `}
                  >
                    {t('No activity log entries')}
                  </td>
                </tr>
              )}
            </tbody>
          </LogTable>
        </div>

        {logTotal > PAGE_SIZE && (
          <PaginationRow>
            <span>
              {t(
                'Showing %s-%s of %s',
                String(logPage * PAGE_SIZE + 1),
                String(
                  Math.min((logPage + 1) * PAGE_SIZE, logTotal),
                ),
                String(logTotal),
              )}
            </span>
            <div css={css`display: flex; gap: 8px;`}>
              <Button
                buttonStyle="secondary"
                disabled={logPage === 0}
                onClick={() => {
                  const p = logPage - 1;
                  setLogPage(p);
                  fetchLog(p);
                }}
              >
                {t('Previous')}
              </Button>
              <Button
                buttonStyle="secondary"
                disabled={(logPage + 1) * PAGE_SIZE >= logTotal}
                onClick={() => {
                  const p = logPage + 1;
                  setLogPage(p);
                  fetchLog(p);
                }}
              >
                {t('Next')}
              </Button>
            </div>
          </PaginationRow>
        )}
      </Card>
    </Container>
  );
}
