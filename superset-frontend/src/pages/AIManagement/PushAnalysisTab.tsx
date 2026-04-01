/* eslint-disable theme-colors/no-literal-colors */
import { useCallback, useEffect, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Tag,
} from '@superset-ui/core/components';
import { useToasts } from 'src/components/MessageToasts/withToasts';

type Schedule = {
  id: number;
  name: string;
  schedule_type: string;
  crontab?: string | null;
  dashboard_id?: number | null;
  chart_id?: number | null;
  provider_id?: string | null;
  model_name?: string | null;
  question?: string | null;
  enabled: boolean;
  last_run_at?: string | null;
  last_status?: string | null;
  created_on: string;
  updated_on: string;
  results?: any[];
};

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ScheduleCard = styled(Card)`
  .ant-card-body {
    padding: 16px;
  }
`;

const ScheduleHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const StatusBadge = styled(Tag)<{ $status?: string }>`
  && {
    background: ${({ $status }) =>
      $status === 'success' ? '#D1FAE5' : $status === 'error' ? '#FEE2E2' : '#F3F4F6'};
    color: ${({ $status }) =>
      $status === 'success' ? '#065F46' : $status === 'error' ? '#991B1B' : '#6B7280'};
    border: none;
  }
`;

const Meta = styled.div`
  font-size: 12px;
  color: #6B7280;
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
`;

export default function PushAnalysisTab() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchSchedules = useCallback(async () => {
    try {
      const { json } = await SupersetClient.get({
        endpoint: '/api/v1/ai/push-analysis/',
      });
      setSchedules(json.result || []);
    } catch {
      addDangerToast(t('Failed to load push analysis schedules'));
    } finally {
      setLoading(false);
    }
  }, [addDangerToast]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const triggerRun = useCallback(
    async (scheduleId: number) => {
      try {
        await SupersetClient.post({
          endpoint: `/api/v1/ai/push-analysis/${scheduleId}/run`,
        });
        addSuccessToast(t('Push analysis triggered'));
      } catch {
        addDangerToast(t('Failed to trigger push analysis'));
      }
    },
    [addDangerToast, addSuccessToast],
  );

  const toggleEnabled = useCallback(
    async (schedule: Schedule) => {
      try {
        await SupersetClient.put({
          endpoint: `/api/v1/ai/push-analysis/${schedule.id}`,
          jsonPayload: { enabled: !schedule.enabled },
        });
        setSchedules(prev =>
          prev.map(s =>
            s.id === schedule.id ? { ...s, enabled: !s.enabled } : s,
          ),
        );
      } catch {
        addDangerToast(t('Failed to update schedule'));
      }
    },
    [addDangerToast],
  );

  const deleteSchedule = useCallback(
    async (scheduleId: number) => {
      try {
        await SupersetClient.delete({
          endpoint: `/api/v1/ai/push-analysis/${scheduleId}`,
        });
        setSchedules(prev => prev.filter(s => s.id !== scheduleId));
        addSuccessToast(t('Schedule deleted'));
      } catch {
        addDangerToast(t('Failed to delete schedule'));
      }
    },
    [addDangerToast, addSuccessToast],
  );

  const createSchedule = useCallback(
    async (values: any) => {
      try {
        const { json } = await SupersetClient.post({
          endpoint: '/api/v1/ai/push-analysis/',
          jsonPayload: values,
        });
        setSchedules(prev => [json.result, ...prev]);
        setShowForm(false);
        addSuccessToast(t('Schedule created'));
      } catch {
        addDangerToast(t('Failed to create schedule'));
      }
    },
    [addDangerToast, addSuccessToast],
  );

  return (
    <Container>
      <div
        css={css`
          display: flex;
          justify-content: space-between;
          align-items: center;
        `}
      >
        <h3>{t('Push Analysis Schedules')}</h3>
        <Button buttonStyle="primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? t('Cancel') : t('New Schedule')}
        </Button>
      </div>

      {showForm && (
        <Card>
          <Form
            layout="vertical"
            onFinish={createSchedule}
            initialValues={{
              schedule_type: 'periodic',
              crontab: '0 8 * * 1',
              enabled: true,
            }}
          >
            <Form.Item
              name="name"
              label={t('Name')}
              rules={[{ required: true }]}
            >
              <Input placeholder={t('Weekly Dashboard Brief')} />
            </Form.Item>
            <Form.Item name="schedule_type" label={t('Schedule Type')}>
              <Select>
                <Select.Option value="periodic">
                  {t('Periodic (cron)')}
                </Select.Option>
                <Select.Option value="one_time">
                  {t('One-Time')}
                </Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="crontab" label={t('Cron Expression')}>
              <Input placeholder="0 8 * * 1" />
            </Form.Item>
            <Form.Item name="dashboard_id" label={t('Dashboard ID')}>
              <Input type="number" placeholder={t('Optional')} />
            </Form.Item>
            <Form.Item name="chart_id" label={t('Chart ID')}>
              <Input type="number" placeholder={t('Optional')} />
            </Form.Item>
            <Form.Item name="question" label={t('Question / Prompt')}>
              <Input.TextArea
                rows={3}
                placeholder={t(
                  'Provide a weekly brief highlighting key trends and anomalies',
                )}
              />
            </Form.Item>
            <Form.Item>
              <Button buttonStyle="primary" htmlType="submit">
                {t('Create Schedule')}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}

      {loading && <Alert type="info" message={t('Loading schedules...')} />}

      {!loading && schedules.length === 0 && !showForm && (
        <Alert
          type="info"
          message={t('No push analysis schedules')}
          description={t(
            'Create a schedule to automatically generate AI insights on a recurring basis.',
          )}
        />
      )}

      {schedules.map(schedule => (
        <ScheduleCard key={schedule.id}>
          <ScheduleHeader>
            <div>
              <strong>{schedule.name}</strong>
              {schedule.last_status && (
                <StatusBadge $status={schedule.last_status}>
                  {schedule.last_status}
                </StatusBadge>
              )}
            </div>
            <Space>
              <Switch
                checked={schedule.enabled}
                onChange={() => toggleEnabled(schedule)}
                size="small"
              />
              <Button onClick={() => triggerRun(schedule.id)}>
                {t('Run Now')}
              </Button>
              <Button
                buttonStyle="danger"
                onClick={() => deleteSchedule(schedule.id)}
              >
                {t('Delete')}
              </Button>
            </Space>
          </ScheduleHeader>
          <Meta>
            <span>
              {t('Type')}: {schedule.schedule_type}
            </span>
            {schedule.crontab && (
              <span>
                {t('Cron')}: {schedule.crontab}
              </span>
            )}
            {schedule.dashboard_id && (
              <span>
                {t('Dashboard')}: #{schedule.dashboard_id}
              </span>
            )}
            {schedule.chart_id && (
              <span>
                {t('Chart')}: #{schedule.chart_id}
              </span>
            )}
            {schedule.last_run_at && (
              <span>
                {t('Last Run')}: {new Date(schedule.last_run_at).toLocaleString()}
              </span>
            )}
          </Meta>
          {schedule.question && (
            <div
              css={css`
                margin-top: 8px;
                font-size: 13px;
                color: #374151;
                font-style: italic;
              `}
            >
              &ldquo;{schedule.question}&rdquo;
            </div>
          )}
        </ScheduleCard>
      ))}
    </Container>
  );
}
