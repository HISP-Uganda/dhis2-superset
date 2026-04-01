/* eslint-disable theme-colors/no-literal-colors */
import { useCallback, useEffect, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import {
  Alert,
  Card,
  Col,
  Row,
  Select,
  Statistic,
  Tag,
} from '@superset-ui/core/components';
import { useToasts } from 'src/components/MessageToasts/withToasts';

type UsageStats = {
  period_days: number;
  total_requests: number;
  successful: number;
  errors: number;
  avg_duration_ms: number;
  by_mode: Record<string, number>;
  by_provider: Record<string, number>;
  daily: { date: string; count: number }[];
  top_users: { user_id: number; count: number }[];
};

type LogEntry = {
  id: number;
  user_id: number;
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

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
`;

const StatCard = styled(Card)`
  .ant-card-body {
    padding: 16px;
  }
`;

const ChartBar = styled.div<{ $height: number; $maxHeight: number }>`
  width: 100%;
  height: ${({ $height, $maxHeight }) =>
    $maxHeight > 0 ? Math.max(4, ($height / $maxHeight) * 120) : 4}px;
  background: #3B82F6;
  border-radius: 2px;
  transition: height 0.3s ease;
`;

const DailyChart = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 140px;
  padding: 12px 0;
`;

const DailyBar = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`;

const DailyLabel = styled.div`
  font-size: 9px;
  color: #9CA3AF;
  transform: rotate(-45deg);
  white-space: nowrap;
`;

const LogTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th,
  td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid #E5EAF0;
  }

  th {
    font-weight: 600;
    color: #6B7280;
    background: #F9FAFB;
  }

  tr:hover td {
    background: #F3F4F6;
  }
`;

const StatusTag = styled(Tag)<{ $status: string }>`
  && {
    background: ${({ $status }) =>
      $status === 'success' ? '#D1FAE5' : '#FEE2E2'};
    color: ${({ $status }) =>
      $status === 'success' ? '#065F46' : '#991B1B'};
    border: none;
    font-size: 11px;
  }
`;

export default function UsageAnalyticsTab() {
  const { addDangerToast } = useToasts();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

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

  const fetchLog = useCallback(async () => {
    try {
      const { json } = await SupersetClient.get({
        endpoint: '/api/v1/ai-management/usage/log?limit=50',
      });
      setLog(json.result || []);
    } catch {
      // Log table may not exist yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchLog();
  }, [fetchStats, fetchLog]);

  const maxDaily = stats
    ? Math.max(...stats.daily.map(d => d.count), 1)
    : 1;

  return (
    <Container>
      <div
        css={css`
          display: flex;
          justify-content: space-between;
          align-items: center;
        `}
      >
        <h3>{t('AI Usage Analytics')}</h3>
        <Select value={days} onChange={setDays} style={{ width: 140 }}>
          <Select.Option value={7}>{t('Last 7 days')}</Select.Option>
          <Select.Option value={30}>{t('Last 30 days')}</Select.Option>
          <Select.Option value={90}>{t('Last 90 days')}</Select.Option>
        </Select>
      </div>

      {loading && <Alert type="info" message={t('Loading analytics...')} />}

      {stats && (
        <>
          <StatsGrid>
            <StatCard>
              <Statistic
                title={t('Total Requests')}
                value={stats.total_requests}
              />
            </StatCard>
            <StatCard>
              <Statistic
                title={t('Successful')}
                value={stats.successful}
                valueStyle={{ color: '#059669' }}
              />
            </StatCard>
            <StatCard>
              <Statistic
                title={t('Errors')}
                value={stats.errors}
                valueStyle={{ color: stats.errors > 0 ? '#DC2626' : '#6B7280' }}
              />
            </StatCard>
            <StatCard>
              <Statistic
                title={t('Avg Duration')}
                value={stats.avg_duration_ms}
                suffix="ms"
              />
            </StatCard>
          </StatsGrid>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Card title={t('Requests by Mode')}>
                {Object.entries(stats.by_mode).map(([mode, count]) => (
                  <div
                    key={mode}
                    css={css`
                      display: flex;
                      justify-content: space-between;
                      padding: 4px 0;
                      font-size: 13px;
                    `}
                  >
                    <span>{mode}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
                {Object.keys(stats.by_mode).length === 0 && (
                  <span
                    css={css`
                      color: #9ca3af;
                      font-size: 13px;
                    `}
                  >
                    {t('No data')}
                  </span>
                )}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title={t('Requests by Provider')}>
                {Object.entries(stats.by_provider).map(([pid, count]) => (
                  <div
                    key={pid}
                    css={css`
                      display: flex;
                      justify-content: space-between;
                      padding: 4px 0;
                      font-size: 13px;
                    `}
                  >
                    <span>{pid}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
                {Object.keys(stats.by_provider).length === 0 && (
                  <span
                    css={css`
                      color: #9ca3af;
                      font-size: 13px;
                    `}
                  >
                    {t('No data')}
                  </span>
                )}
              </Card>
            </Col>
          </Row>

          {stats.daily.length > 0 && (
            <Card title={t('Daily Request Volume')}>
              <DailyChart>
                {stats.daily.map(d => (
                  <DailyBar key={d.date} title={`${d.date}: ${d.count}`}>
                    <ChartBar $height={d.count} $maxHeight={maxDaily} />
                    <DailyLabel>{d.date.slice(5)}</DailyLabel>
                  </DailyBar>
                ))}
              </DailyChart>
            </Card>
          )}
        </>
      )}

      {log.length > 0 && (
        <Card title={t('Recent Activity Log')}>
          <div css={css`overflow-x: auto;`}>
            <LogTable>
              <thead>
                <tr>
                  <th>{t('Time')}</th>
                  <th>{t('User')}</th>
                  <th>{t('Mode')}</th>
                  <th>{t('Provider')}</th>
                  <th>{t('Model')}</th>
                  <th>{t('Duration')}</th>
                  <th>{t('Status')}</th>
                </tr>
              </thead>
              <tbody>
                {log.map(entry => (
                  <tr key={entry.id}>
                    <td>
                      {new Date(entry.created_on).toLocaleString()}
                    </td>
                    <td>{entry.user_id}</td>
                    <td>{entry.mode}</td>
                    <td>{entry.provider_id}</td>
                    <td>{entry.model_name}</td>
                    <td>
                      {entry.duration_ms != null
                        ? `${entry.duration_ms}ms`
                        : '—'}
                    </td>
                    <td>
                      <StatusTag $status={entry.status}>
                        {entry.status}
                      </StatusTag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </LogTable>
          </div>
        </Card>
      )}
    </Container>
  );
}
