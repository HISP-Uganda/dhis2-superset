/* eslint-disable theme-colors/no-literal-colors */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Steps,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from '@superset-ui/core/components';
import { useToasts } from 'src/components/MessageToasts/withToasts';

const { Text, Paragraph } = Typography;

/* ── Types ────────────────────────────────────────────────────────── */

type Recipient = { type: string; target: string };

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
  recipients: Recipient[];
  report_format: string;
  include_charts: boolean;
  subject_line?: string | null;
  enabled: boolean;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  created_on: string;
  updated_on: string;
  results?: ResultEntry[];
};

type ResultEntry = {
  id: number;
  schedule_id: number;
  insight_text?: string | null;
  has_pdf: boolean;
  provider_id?: string | null;
  model_name?: string | null;
  duration_ms?: number | null;
  status: string;
  error_message?: string | null;
  recipients_notified?: number | null;
  created_on: string;
};

type DashboardOption = {
  id: number;
  title: string;
  slug?: string;
  chart_count: number;
};

type ChartOption = {
  id: number;
  name: string;
  viz_type?: string;
  datasource?: string | null;
};

/* ── Cron Presets ─────────────────────────────────────────────────── */

const CRON_PRESETS = [
  { label: 'Every day at 8 AM', value: '0 8 * * *' },
  { label: 'Every Monday at 8 AM', value: '0 8 * * 1' },
  { label: 'Every weekday at 7 AM', value: '0 7 * * 1-5' },
  { label: 'First day of month at 9 AM', value: '0 9 1 * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 0,12 * * *' },
  { label: 'Custom', value: '__custom__' },
];

/* ── Styled Components ────────────────────────────────────────────── */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const PageHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0 12px;
  border-bottom: 1px solid #E5E7EB;
  margin-bottom: 4px;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: #111827;
  }

  p {
    margin: 4px 0 0;
    font-size: 13px;
    color: #6B7280;
  }
`;

const ScheduleCard = styled(Card)<{ $enabled?: boolean }>`
  border-radius: 10px;
  border: 1px solid ${({ $enabled }) => ($enabled ? '#D1D5DB' : '#E5E7EB')};
  opacity: ${({ $enabled }) => ($enabled ? 1 : 0.7)};
  transition: box-shadow 0.2s;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .ant-card-body {
    padding: 18px 20px;
  }
`;

const ScheduleHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
`;

const ScheduleTitle = styled.div`
  flex: 1;

  .title {
    font-size: 15px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 2px;
  }

  .subtitle {
    font-size: 12px;
    color: #6B7280;
  }
`;

const StatusBadge = styled(Tag)<{ $status?: string }>`
  && {
    border-radius: 12px;
    padding: 2px 10px;
    font-size: 11px;
    font-weight: 600;
    border: none;
    background: ${({ $status }) =>
      $status === 'success'
        ? '#D1FAE5'
        : $status === 'error'
          ? '#FEE2E2'
          : $status === 'running'
            ? '#DBEAFE'
            : '#F3F4F6'};
    color: ${({ $status }) =>
      $status === 'success'
        ? '#065F46'
        : $status === 'error'
          ? '#991B1B'
          : $status === 'running'
            ? '#1E40AF'
            : '#6B7280'};
  }
`;

const MetaGrid = styled.div`
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #F3F4F6;
`;

const MetaItem = styled.div`
  font-size: 12px;

  .label {
    color: #9CA3AF;
    font-weight: 500;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.05em;
    margin-bottom: 2px;
  }

  .value {
    color: #374151;
    font-weight: 600;
  }
`;

const RecipientBadge = styled.span`
  display: inline-block;
  padding: 2px 8px;
  background: #EFF6FF;
  color: #1D4ED8;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  margin-right: 4px;
  margin-bottom: 4px;
`;

const ResultRow = styled.div<{ $status: string }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 6px;
  background: ${({ $status }) =>
    $status === 'success' ? '#F0FDF4' : $status === 'error' ? '#FEF2F2' : '#F9FAFB'};
  border: 1px solid ${({ $status }) =>
    $status === 'success' ? '#BBF7D0' : $status === 'error' ? '#FECACA' : '#E5E7EB'};
  font-size: 13px;
`;

const FormSection = styled.div`
  background: #F9FAFB;
  border-radius: 10px;
  padding: 20px 24px;
  margin-bottom: 12px;
  border: 1px solid #E5E7EB;

  h4 {
    margin: 0 0 14px;
    font-size: 14px;
    font-weight: 700;
    color: #374151;
  }
`;

const EmailChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  border-radius: 16px;
  font-size: 12px;
  color: #1D4ED8;
  margin: 2px 4px 2px 0;

  .remove {
    cursor: pointer;
    font-weight: 700;
    color: #93C5FD;
    &:hover { color: #DC2626; }
  }
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 48px 24px;
  background: #F9FAFB;
  border-radius: 12px;
  border: 2px dashed #D1D5DB;

  h4 {
    color: #374151;
    margin: 16px 0 8px;
    font-size: 16px;
  }

  p {
    color: #6B7280;
    font-size: 13px;
    max-width: 480px;
    margin: 0 auto;
  }
`;

/* ── Helpers ──────────────────────────────────────────────────────── */

function cronToHuman(cron: string): string {
  const preset = CRON_PRESETS.find(p => p.value === cron);
  if (preset) return preset.label;
  return cron;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ── Component ────────────────────────────────────────────────────── */

export default function PushAnalysisTab() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedResults, setExpandedResults] = useState<ResultEntry[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());

  // Form state
  const [dashboards, setDashboards] = useState<DashboardOption[]>([]);
  const [charts, setCharts] = useState<ChartOption[]>([]);
  const [formStep, setFormStep] = useState(0);
  const [emailInput, setEmailInput] = useState('');
  const [recipientList, setRecipientList] = useState<Recipient[]>([]);
  const [selectedDashboard, setSelectedDashboard] = useState<number | null>(null);
  const [selectedCronPreset, setSelectedCronPreset] = useState('0 8 * * 1');
  const [customCron, setCustomCron] = useState('');

  const [form] = Form.useForm();

  // ── Data Loading ──
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

  const fetchDashboards = useCallback(async () => {
    try {
      const { json } = await SupersetClient.get({
        endpoint: '/api/v1/ai/push-analysis/dashboards',
      });
      setDashboards(json.result || []);
    } catch {
      // silent
    }
  }, []);

  const fetchCharts = useCallback(
    async (dashboardId?: number | null) => {
      try {
        const qs = dashboardId ? `?dashboard_id=${dashboardId}` : '';
        const { json } = await SupersetClient.get({
          endpoint: `/api/v1/ai/push-analysis/charts${qs}`,
        });
        setCharts(json.result || []);
      } catch {
        // silent
      }
    },
    [],
  );

  const fetchResults = useCallback(
    async (scheduleId: number) => {
      if (expandedId === scheduleId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(scheduleId);
      setLoadingResults(true);
      try {
        const { json } = await SupersetClient.get({
          endpoint: `/api/v1/ai/push-analysis/${scheduleId}`,
        });
        setExpandedResults(json.result?.results || []);
      } catch {
        addDangerToast(t('Failed to load results'));
      } finally {
        setLoadingResults(false);
      }
    },
    [expandedId, addDangerToast],
  );

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  useEffect(() => {
    if (showForm) {
      fetchDashboards();
      fetchCharts();
    }
  }, [showForm, fetchDashboards, fetchCharts]);

  // Reload charts when dashboard changes
  useEffect(() => {
    if (selectedDashboard) {
      fetchCharts(selectedDashboard);
    }
  }, [selectedDashboard, fetchCharts]);

  // ── CRUD Operations ──
  const triggerRun = useCallback(
    async (scheduleId: number) => {
      setRunningIds(prev => new Set(prev).add(scheduleId));
      try {
        await SupersetClient.post({
          endpoint: `/api/v1/ai/push-analysis/${scheduleId}/run`,
        });
        addSuccessToast(t('Push analysis triggered - report will be generated and emailed'));
        // Update status
        setSchedules(prev =>
          prev.map(s =>
            s.id === scheduleId ? { ...s, last_status: 'running' } : s,
          ),
        );
      } catch {
        addDangerToast(t('Failed to trigger push analysis'));
      } finally {
        setTimeout(() => {
          setRunningIds(prev => {
            const next = new Set(prev);
            next.delete(scheduleId);
            return next;
          });
          fetchSchedules();
        }, 5000);
      }
    },
    [addDangerToast, addSuccessToast, fetchSchedules],
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

  // ── Form Handling ──
  const resetForm = useCallback(() => {
    setShowForm(false);
    setEditingSchedule(null);
    setFormStep(0);
    setRecipientList([]);
    setEmailInput('');
    setSelectedDashboard(null);
    setSelectedCronPreset('0 8 * * 1');
    setCustomCron('');
    form.resetFields();
  }, [form]);

  const openCreateForm = useCallback(() => {
    resetForm();
    setShowForm(true);
    form.setFieldsValue({
      schedule_type: 'periodic',
      report_format: 'pdf',
      include_charts: true,
      enabled: true,
    });
  }, [resetForm, form]);

  const openEditForm = useCallback(
    (schedule: Schedule) => {
      setEditingSchedule(schedule);
      setShowForm(true);
      setFormStep(0);
      setRecipientList(schedule.recipients || []);
      setSelectedDashboard(schedule.dashboard_id || null);
      const matchingPreset = CRON_PRESETS.find(
        p => p.value === schedule.crontab,
      );
      if (matchingPreset) {
        setSelectedCronPreset(matchingPreset.value);
        setCustomCron('');
      } else {
        setSelectedCronPreset('__custom__');
        setCustomCron(schedule.crontab || '');
      }
      form.setFieldsValue({
        name: schedule.name,
        schedule_type: schedule.schedule_type,
        dashboard_id: schedule.dashboard_id,
        chart_id: schedule.chart_id,
        question: schedule.question,
        report_format: schedule.report_format || 'pdf',
        include_charts: schedule.include_charts ?? true,
        subject_line: schedule.subject_line,
        enabled: schedule.enabled,
      });
    },
    [form],
  );

  const addEmailRecipient = useCallback(() => {
    const email = emailInput.trim();
    if (!email) return;
    if (!validateEmail(email)) {
      addDangerToast(t('Invalid email address'));
      return;
    }
    if (recipientList.some(r => r.target === email)) {
      addDangerToast(t('Email already added'));
      return;
    }
    setRecipientList(prev => [...prev, { type: 'email', target: email }]);
    setEmailInput('');
  }, [emailInput, recipientList, addDangerToast]);

  const removeRecipient = useCallback((target: string) => {
    setRecipientList(prev => prev.filter(r => r.target !== target));
  }, []);

  const handleSubmit = useCallback(
    async (values: any) => {
      const crontab =
        selectedCronPreset === '__custom__'
          ? customCron
          : selectedCronPreset;

      const payload = {
        name: values.name,
        schedule_type: values.schedule_type || 'periodic',
        crontab,
        dashboard_id: values.dashboard_id || null,
        chart_id: values.chart_id || null,
        question: values.question || null,
        recipients: recipientList,
        report_format: values.report_format || 'pdf',
        include_charts: values.include_charts ?? true,
        subject_line: values.subject_line || null,
        enabled: values.enabled ?? true,
      };

      try {
        if (editingSchedule) {
          const { json } = await SupersetClient.put({
            endpoint: `/api/v1/ai/push-analysis/${editingSchedule.id}`,
            jsonPayload: payload,
          });
          setSchedules(prev =>
            prev.map(s =>
              s.id === editingSchedule.id ? json.result : s,
            ),
          );
          addSuccessToast(t('Schedule updated'));
        } else {
          const { json } = await SupersetClient.post({
            endpoint: '/api/v1/ai/push-analysis/',
            jsonPayload: payload,
          });
          setSchedules(prev => [json.result, ...prev]);
          addSuccessToast(t('Schedule created'));
        }
        resetForm();
      } catch {
        addDangerToast(t('Failed to save schedule'));
      }
    },
    [
      editingSchedule, recipientList, selectedCronPreset, customCron,
      addDangerToast, addSuccessToast, resetForm,
    ],
  );

  // ── Render ──
  const dashboardMap = useMemo(
    () => new Map(dashboards.map(d => [d.id, d])),
    [dashboards],
  );

  return (
    <Container>
      <PageHeader>
        <div>
          <h3>{t('AI Push Analysis')}</h3>
          <p>
            {t(
              'Schedule AI-powered analysis reports for dashboards and charts. Reports are generated as professional PDFs and emailed to recipients automatically.',
            )}
          </p>
        </div>
        <Button buttonStyle="primary" onClick={openCreateForm}>
          {t('+ New Push Analysis')}
        </Button>
      </PageHeader>

      {/* ── Create / Edit Form ── */}
      {showForm && (
        <Card
          css={css`
            border-radius: 12px;
            border: 2px solid #2563EB;
          `}
        >
          <div
            css={css`
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 16px;
            `}
          >
            <Text strong css={css`font-size: 16px; color: #111827;`}>
              {editingSchedule ? t('Edit Push Analysis') : t('Create Push Analysis')}
            </Text>
            <Button onClick={resetForm}>{t('Cancel')}</Button>
          </div>

          <Steps
            current={formStep}
            size="small"
            css={css`margin-bottom: 24px;`}
            items={[
              { title: t('Configuration') },
              { title: t('Schedule') },
              { title: t('Recipients') },
            ]}
          />

          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
          >
            {/* Step 0: Configuration */}
            {formStep === 0 && (
              <>
                <FormSection>
                  <h4>{t('Report Configuration')}</h4>
                  <Form.Item
                    name="name"
                    label={t('Report Name')}
                    rules={[{ required: true, message: t('Required') }]}
                  >
                    <Input
                      placeholder={t('e.g., Weekly Malaria Dashboard Brief')}
                      maxLength={256}
                    />
                  </Form.Item>

                  <Form.Item
                    name="dashboard_id"
                    label={t('Dashboard')}
                    extra={t('Select the dashboard to analyze. AI will review all charts and data within it.')}
                  >
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="children"
                      placeholder={t('Select a dashboard...')}
                      onChange={(val: number | undefined) => {
                        setSelectedDashboard(val || null);
                        form.setFieldValue('chart_id', undefined);
                      }}
                    >
                      {dashboards.map(d => (
                        <Select.Option key={d.id} value={d.id}>
                          {d.title}
                          {d.chart_count
                            ? ` (${d.chart_count} charts)`
                            : ''}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>

                  <Form.Item
                    name="chart_id"
                    label={t('Specific Chart (optional)')}
                    extra={t('Optionally focus the analysis on a single chart instead of the entire dashboard.')}
                  >
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="children"
                      placeholder={t('All charts in dashboard')}
                    >
                      {charts.map(c => (
                        <Select.Option key={c.id} value={c.id}>
                          {c.name}
                          {c.viz_type ? ` (${c.viz_type})` : ''}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>

                  <Form.Item
                    name="question"
                    label={t('Analysis Focus / Custom Instructions')}
                    extra={t('Guide the AI on what to focus on in its analysis.')}
                  >
                    <Input.TextArea
                      rows={3}
                      placeholder={t(
                        'e.g., Focus on malaria positivity rate trends, highlight districts above 30% threshold, compare this month vs last month',
                      )}
                    />
                  </Form.Item>
                </FormSection>

                <FormSection>
                  <h4>{t('Report Format')}</h4>
                  <div css={css`display: flex; gap: 16px; flex-wrap: wrap;`}>
                    <Form.Item
                      name="report_format"
                      label={t('Format')}
                      css={css`flex: 1; min-width: 180px;`}
                    >
                      <Select>
                        <Select.Option value="pdf">
                          {t('PDF Report (recommended)')}
                        </Select.Option>
                        <Select.Option value="html">
                          {t('HTML Email Only')}
                        </Select.Option>
                        <Select.Option value="text">
                          {t('Plain Text')}
                        </Select.Option>
                      </Select>
                    </Form.Item>

                    <Form.Item
                      name="include_charts"
                      label={t('Include Chart Details')}
                      valuePropName="checked"
                      css={css`min-width: 160px;`}
                    >
                      <Switch />
                    </Form.Item>
                  </div>

                  <Form.Item
                    name="subject_line"
                    label={t('Email Subject (optional)')}
                    extra={t('Leave blank for auto-generated subject.')}
                  >
                    <Input placeholder={t('e.g., Weekly Malaria Report - {{date}}')} />
                  </Form.Item>
                </FormSection>

                <div css={css`display: flex; justify-content: flex-end; gap: 8px;`}>
                  <Button onClick={resetForm}>{t('Cancel')}</Button>
                  <Button
                    buttonStyle="primary"
                    onClick={() => {
                      form
                        .validateFields(['name'])
                        .then(() => setFormStep(1))
                        .catch(() => {});
                    }}
                  >
                    {t('Next: Schedule')}
                  </Button>
                </div>
              </>
            )}

            {/* Step 1: Schedule */}
            {formStep === 1 && (
              <>
                <FormSection>
                  <h4>{t('Schedule Configuration')}</h4>

                  <Form.Item
                    name="schedule_type"
                    label={t('Schedule Type')}
                  >
                    <Select>
                      <Select.Option value="periodic">
                        {t('Recurring Schedule')}
                      </Select.Option>
                      <Select.Option value="one_time">
                        {t('One-Time Run')}
                      </Select.Option>
                    </Select>
                  </Form.Item>

                  <Form.Item label={t('Frequency')}>
                    <Select
                      value={selectedCronPreset}
                      onChange={(val: string) => {
                        setSelectedCronPreset(val);
                        if (val !== '__custom__') setCustomCron('');
                      }}
                    >
                      {CRON_PRESETS.map(p => (
                        <Select.Option key={p.value} value={p.value}>
                          {t(p.label)}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>

                  {selectedCronPreset === '__custom__' && (
                    <Form.Item
                      label={t('Custom Cron Expression')}
                      extra={t('Format: minute hour day-of-month month day-of-week')}
                    >
                      <Input
                        value={customCron}
                        onChange={e => setCustomCron(e.target.value)}
                        placeholder="0 8 * * 1"
                      />
                    </Form.Item>
                  )}

                  <Form.Item
                    name="enabled"
                    label={t('Active')}
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </FormSection>

                <div css={css`display: flex; justify-content: flex-end; gap: 8px;`}>
                  <Button onClick={() => setFormStep(0)}>
                    {t('Back')}
                  </Button>
                  <Button
                    buttonStyle="primary"
                    onClick={() => setFormStep(2)}
                  >
                    {t('Next: Recipients')}
                  </Button>
                </div>
              </>
            )}

            {/* Step 2: Recipients */}
            {formStep === 2 && (
              <>
                <FormSection>
                  <h4>{t('Email Recipients')}</h4>
                  <p
                    css={css`
                      font-size: 13px;
                      color: #6B7280;
                      margin: 0 0 12px;
                    `}
                  >
                    {t(
                      'Add email addresses to receive the AI analysis report with attached PDF.',
                    )}
                  </p>

                  <div css={css`display: flex; gap: 8px; margin-bottom: 12px;`}>
                    <Input
                      value={emailInput}
                      onChange={e => setEmailInput(e.target.value)}
                      placeholder={t('email@example.com')}
                      onPressEnter={e => {
                        e.preventDefault();
                        addEmailRecipient();
                      }}
                      css={css`flex: 1;`}
                    />
                    <Button onClick={addEmailRecipient}>
                      {t('Add')}
                    </Button>
                  </div>

                  {recipientList.length > 0 && (
                    <div css={css`margin-bottom: 12px;`}>
                      {recipientList.map(r => (
                        <EmailChip key={r.target}>
                          {r.target}
                          <span
                            className="remove"
                            onClick={() => removeRecipient(r.target)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => {
                              if (e.key === 'Enter') removeRecipient(r.target);
                            }}
                          >
                            x
                          </span>
                        </EmailChip>
                      ))}
                    </div>
                  )}

                  {recipientList.length === 0 && (
                    <Alert
                      type="info"
                      message={t(
                        'No recipients configured. Reports will be generated and saved but not emailed.',
                      )}
                      css={css`margin-bottom: 12px;`}
                    />
                  )}
                </FormSection>

                {/* Summary */}
                <FormSection>
                  <h4>{t('Summary')}</h4>
                  <div css={css`font-size: 13px; color: #374151; line-height: 1.8;`}>
                    <div>
                      <Text strong>{t('Name')}: </Text>
                      {form.getFieldValue('name') || '-'}
                    </div>
                    <div>
                      <Text strong>{t('Dashboard')}: </Text>
                      {(() => {
                        const did = form.getFieldValue('dashboard_id');
                        const db = dashboardMap.get(did);
                        return db ? db.title : did || t('Not selected');
                      })()}
                    </div>
                    <div>
                      <Text strong>{t('Schedule')}: </Text>
                      {cronToHuman(
                        selectedCronPreset === '__custom__'
                          ? customCron
                          : selectedCronPreset,
                      )}
                    </div>
                    <div>
                      <Text strong>{t('Recipients')}: </Text>
                      {recipientList.length > 0
                        ? recipientList.map(r => r.target).join(', ')
                        : t('None')}
                    </div>
                    <div>
                      <Text strong>{t('Format')}: </Text>
                      {(form.getFieldValue('report_format') || 'pdf').toUpperCase()}
                    </div>
                  </div>
                </FormSection>

                <div css={css`display: flex; justify-content: flex-end; gap: 8px;`}>
                  <Button onClick={() => setFormStep(1)}>
                    {t('Back')}
                  </Button>
                  <Button buttonStyle="primary" htmlType="submit">
                    {editingSchedule ? t('Update Schedule') : t('Create Schedule')}
                  </Button>
                </div>
              </>
            )}
          </Form>
        </Card>
      )}

      {/* ── Loading ── */}
      {loading && <Alert type="info" message={t('Loading schedules...')} />}

      {/* ── Empty State ── */}
      {!loading && schedules.length === 0 && !showForm && (
        <EmptyState>
          <div css={css`font-size: 40px; color: #9CA3AF;`}>&#128202;</div>
          <h4>{t('No Push Analysis Schedules')}</h4>
          <p>
            {t(
              'Create your first AI push analysis to automatically generate professional reports from your dashboards and charts. Reports are delivered as PDF attachments via email on the schedule you configure.',
            )}
          </p>
          <Button
            buttonStyle="primary"
            onClick={openCreateForm}
            css={css`margin-top: 16px;`}
          >
            {t('Create First Schedule')}
          </Button>
        </EmptyState>
      )}

      {/* ── Schedule Cards ── */}
      {schedules.map(schedule => (
        <ScheduleCard key={schedule.id} $enabled={schedule.enabled}>
          <ScheduleHeader>
            <ScheduleTitle>
              <div className="title">
                {schedule.name}
                {schedule.last_status && (
                  <StatusBadge
                    $status={
                      runningIds.has(schedule.id) ? 'running' : schedule.last_status
                    }
                    css={css`margin-left: 8px;`}
                  >
                    {runningIds.has(schedule.id)
                      ? t('Running...')
                      : schedule.last_status}
                  </StatusBadge>
                )}
                {!schedule.enabled && (
                  <Tag css={css`&& { margin-left: 8px; }`} color="default">
                    {t('Paused')}
                  </Tag>
                )}
              </div>
              <div className="subtitle">
                {schedule.schedule_type === 'periodic' && schedule.crontab
                  ? cronToHuman(schedule.crontab)
                  : schedule.schedule_type === 'one_time'
                    ? t('One-time')
                    : t('Not scheduled')}
                {schedule.recipients && schedule.recipients.length > 0 && (
                  <span css={css`margin-left: 12px;`}>
                    {t('%s recipient(s)', String(schedule.recipients.length))}
                  </span>
                )}
              </div>
            </ScheduleTitle>

            <Space>
              <Tooltip title={schedule.enabled ? t('Pause') : t('Enable')}>
                <Switch
                  checked={schedule.enabled}
                  onChange={() => toggleEnabled(schedule)}
                  size="small"
                />
              </Tooltip>
              <Button
                onClick={() => triggerRun(schedule.id)}
                loading={runningIds.has(schedule.id)}
                disabled={runningIds.has(schedule.id)}
              >
                {t('Run Now')}
              </Button>
              <Button onClick={() => openEditForm(schedule)}>
                {t('Edit')}
              </Button>
              <Button onClick={() => fetchResults(schedule.id)}>
                {expandedId === schedule.id ? t('Hide History') : t('History')}
              </Button>
              <Button
                buttonStyle="danger"
                onClick={() => deleteSchedule(schedule.id)}
              >
                {t('Delete')}
              </Button>
            </Space>
          </ScheduleHeader>

          {/* Meta Info */}
          <MetaGrid>
            {schedule.dashboard_id && (
              <MetaItem>
                <div className="label">{t('Dashboard')}</div>
                <div className="value">
                  #{schedule.dashboard_id}
                  {dashboardMap.get(schedule.dashboard_id)
                    ? ` - ${dashboardMap.get(schedule.dashboard_id)!.title}`
                    : ''}
                </div>
              </MetaItem>
            )}
            {schedule.chart_id && (
              <MetaItem>
                <div className="label">{t('Chart')}</div>
                <div className="value">#{schedule.chart_id}</div>
              </MetaItem>
            )}
            <MetaItem>
              <div className="label">{t('Format')}</div>
              <div className="value">{(schedule.report_format || 'pdf').toUpperCase()}</div>
            </MetaItem>
            {schedule.last_run_at && (
              <MetaItem>
                <div className="label">{t('Last Run')}</div>
                <div className="value">
                  {new Date(schedule.last_run_at).toLocaleString()}
                </div>
              </MetaItem>
            )}
            {schedule.recipients && schedule.recipients.length > 0 && (
              <MetaItem>
                <div className="label">{t('Recipients')}</div>
                <div className="value">
                  {schedule.recipients.map(r => (
                    <RecipientBadge key={r.target}>{r.target}</RecipientBadge>
                  ))}
                </div>
              </MetaItem>
            )}
          </MetaGrid>

          {schedule.question && (
            <div
              css={css`
                margin-top: 10px;
                padding: 8px 12px;
                background: #F9FAFB;
                border-radius: 6px;
                font-size: 13px;
                color: #374151;
                font-style: italic;
                border-left: 3px solid #2563EB;
              `}
            >
              {schedule.question}
            </div>
          )}

          {schedule.last_error && schedule.last_status === 'error' && (
            <Alert
              type="error"
              message={t('Last run failed')}
              description={schedule.last_error}
              css={css`margin-top: 10px; border-radius: 6px;`}
              closable
            />
          )}

          {/* ── Expanded Results History ── */}
          {expandedId === schedule.id && (
            <div css={css`margin-top: 14px;`}>
              <Divider css={css`&& { margin: 10px 0; }`} />
              <Text
                strong
                css={css`font-size: 13px; color: #374151; display: block; margin-bottom: 8px;`}
              >
                {t('Run History')}
              </Text>
              {loadingResults && (
                <Alert type="info" message={t('Loading...')} />
              )}
              {!loadingResults && expandedResults.length === 0 && (
                <Text type="secondary" css={css`font-size: 12px;`}>
                  {t('No runs yet.')}
                </Text>
              )}
              {expandedResults.map(result => (
                <ResultRow key={result.id} $status={result.status}>
                  <div>
                    <Text strong css={css`font-size: 12px;`}>
                      {new Date(result.created_on).toLocaleString()}
                    </Text>
                    <div css={css`font-size: 11px; color: #6B7280;`}>
                      {result.duration_ms != null && (
                        <span>{(result.duration_ms / 1000).toFixed(1)}s</span>
                      )}
                      {result.provider_id && (
                        <span css={css`margin-left: 8px;`}>
                          {result.provider_id}
                          {result.model_name ? ` / ${result.model_name}` : ''}
                        </span>
                      )}
                      {result.recipients_notified != null &&
                        result.recipients_notified > 0 && (
                          <span css={css`margin-left: 8px;`}>
                            {t(
                              '%s emailed',
                              String(result.recipients_notified),
                            )}
                          </span>
                        )}
                    </div>
                    {result.error_message && (
                      <div
                        css={css`
                          font-size: 11px;
                          color: #DC2626;
                          margin-top: 2px;
                        `}
                      >
                        {result.error_message}
                      </div>
                    )}
                  </div>
                  <Space>
                    <StatusBadge $status={result.status}>
                      {result.status}
                    </StatusBadge>
                    {result.has_pdf && (
                      <Button
                        size="small"
                        onClick={() => {
                          window.open(
                            `/api/v1/ai/push-analysis/results/${result.id}/pdf`,
                            '_blank',
                          );
                        }}
                      >
                        {t('Download PDF')}
                      </Button>
                    )}
                  </Space>
                </ResultRow>
              ))}
            </div>
          )}
        </ScheduleCard>
      ))}
    </Container>
  );
}
