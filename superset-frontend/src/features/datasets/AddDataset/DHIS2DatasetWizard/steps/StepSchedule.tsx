import { useCallback } from 'react';
import { styled } from '@superset-ui/core';
import { Select, Input, Alert } from 'antd';
import { Typography } from '@superset-ui/core/components';

const { Title, Paragraph } = Typography;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScheduleConfig {
  cron: string;
  timezone: string;
  preset: 'hourly' | 'every6h' | 'daily' | 'weekly' | 'monthly' | 'custom';
}

export interface StepScheduleProps {
  scheduleConfig: ScheduleConfig;
  onChange: (config: ScheduleConfig) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESET_CRON: Record<Exclude<ScheduleConfig['preset'], 'custom'>, string> =
  {
    hourly: '0 * * * *',
    every6h: '0 */6 * * *',
    daily: '0 5 * * *',
    weekly: '0 5 * * 1',
    monthly: '0 5 1 * *',
  };

const PRESET_OPTIONS: Array<{
  label: string;
  value: ScheduleConfig['preset'];
  description: string;
}> = [
  {
    label: 'Hourly',
    value: 'hourly',
    description: 'Runs at the start of every hour',
  },
  {
    label: 'Every 6 hours',
    value: 'every6h',
    description: 'Runs at midnight, 6 AM, noon, and 6 PM',
  },
  {
    label: 'Daily at 5 AM',
    value: 'daily',
    description: 'Runs once per day at 5:00 AM in the selected timezone',
  },
  {
    label: 'Weekly (Mon 5 AM)',
    value: 'weekly',
    description: 'Runs every Monday at 5:00 AM in the selected timezone',
  },
  {
    label: 'Monthly (1st at 5 AM)',
    value: 'monthly',
    description: 'Runs on the 1st of each month at 5:00 AM',
  },
  {
    label: 'Custom cron expression',
    value: 'custom',
    description: 'Enter a custom cron expression',
  },
];

const TIMEZONES = [
  { label: 'UTC', value: 'UTC' },
  { label: 'Africa/Kampala (EAT, UTC+3)', value: 'Africa/Kampala' },
  { label: 'Africa/Nairobi (EAT, UTC+3)', value: 'Africa/Nairobi' },
  { label: 'Africa/Lagos (WAT, UTC+1)', value: 'Africa/Lagos' },
  { label: 'America/New_York (ET)', value: 'America/New_York' },
  { label: 'Europe/London (GMT/BST)', value: 'Europe/London' },
  { label: 'Asia/Bangkok (ICT, UTC+7)', value: 'Asia/Bangkok' },
];

// ─── Cron validation ─────────────────────────────────────────────────────────

const CRON_FIELD_RANGES = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 7 },
];

function validateCron(cron: string): string | null {
  if (!cron.trim()) return 'Cron expression is required.';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 'A cron expression must have exactly 5 fields.';

  for (let i = 0; i < 5; i += 1) {
    const field = parts[i];
    const range = CRON_FIELD_RANGES[i];
    if (field === '*' || field === '?') continue;
    // Allow */n step notation
    if (/^\*\/\d+$/.test(field)) continue;
    // Allow ranges like 1-5
    if (/^\d+-\d+$/.test(field)) continue;
    // Allow lists like 1,2,3
    if (/^\d+(,\d+)*$/.test(field)) {
      const nums = field.split(',').map(Number);
      if (nums.every(n => n >= range.min && n <= range.max)) continue;
      return `Field "${range.name}" value out of range (${range.min}–${range.max}).`;
    }
    // Plain number
    if (/^\d+$/.test(field)) {
      const n = Number(field);
      if (n < range.min || n > range.max) {
        return `Field "${range.name}" value ${n} out of range (${range.min}–${range.max}).`;
      }
      continue;
    }
    return `Invalid value "${field}" in field "${range.name}".`;
  }
  return null;
}

function describePreset(preset: ScheduleConfig['preset']): string {
  const found = PRESET_OPTIONS.find(p => p.value === preset);
  return found?.description ?? '';
}

// ─── Styled components ───────────────────────────────────────────────────────

const StepContainer = styled.div`
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const Section = styled.div`
  ${({ theme }) => `
    background: ${theme.colorBgElevated};
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  `}
`;

const FieldLabel = styled.label`
  ${({ theme }) => `
    display: block;
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 6px;
    color: ${theme.colorText};
  `}
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
`;

const HelpText = styled.span`
  ${({ theme }) => `
    font-size: 12px;
    color: ${theme.colorTextSecondary};
    margin-top: 4px;
  `}
`;

const DescriptionBox = styled.div`
  ${({ theme }) => `
    margin-top: 8px;
    padding: 10px 14px;
    background: ${theme.colorBgContainer};
    border-radius: ${theme.borderRadius}px;
    border: 1px solid ${theme.colorBorderSecondary};
    font-size: 13px;
    color: ${theme.colorText};
  `}
`;

const CronMonospaceInput = styled(Input)`
  font-family: monospace;
  letter-spacing: 0.05em;
`;

const CronError = styled.div`
  font-size: 12px;
  color: #cf1322;
  margin-top: 4px;
`;

// ─── Non-dismissable notice ───────────────────────────────────────────────────

const NoticeBox = styled.div`
  ${({ theme }) => `
    display: flex;
    gap: 12px;
    padding: 14px 16px;
    background: #e6f7ff;
    border: 1px solid #91d5ff;
    border-radius: ${theme.borderRadius}px;
    font-size: 13px;
    color: #0050b3;
    line-height: 1.5;
  `}
`;

const NoticeIcon = styled.span`
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 1px;
`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function StepSchedule({
  scheduleConfig,
  onChange,
}: StepScheduleProps) {
  const cronError =
    scheduleConfig.preset === 'custom'
      ? validateCron(scheduleConfig.cron)
      : null;

  const handlePresetChange = useCallback(
    (preset: ScheduleConfig['preset']) => {
      const cron =
        preset === 'custom'
          ? scheduleConfig.cron
          : PRESET_CRON[preset as Exclude<typeof preset, 'custom'>];
      onChange({ ...scheduleConfig, preset, cron });
    },
    [scheduleConfig, onChange],
  );

  const handleCustomCronChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...scheduleConfig, cron: e.target.value, preset: 'custom' });
    },
    [scheduleConfig, onChange],
  );

  const handleTimezoneChange = useCallback(
    (timezone: string) => {
      onChange({ ...scheduleConfig, timezone });
    },
    [scheduleConfig, onChange],
  );

  return (
    <StepContainer>
      <div>
        <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
          Sync Schedule
        </Title>
        <Paragraph style={{ margin: 0, color: '#666' }}>
          Configure how often this dataset is synchronized from DHIS2.
        </Paragraph>
      </div>

      {/* Non-dismissable notice */}
      <NoticeBox>
        <NoticeIcon>ℹ</NoticeIcon>
        <span>
          Background processing is automatically enabled for staged datasets and
          cannot be disabled. You can pause a dataset entirely using the{' '}
          <strong>Active</strong> toggle on the dataset list.
        </span>
      </NoticeBox>

      <Section>
        <FieldGroup>
          <FieldLabel>Sync frequency</FieldLabel>
          <Select
            value={scheduleConfig.preset}
            onChange={handlePresetChange}
            size="large"
            style={{ width: '100%' }}
            options={PRESET_OPTIONS.map(opt => ({
              label: opt.label,
              value: opt.value,
            }))}
          />

          {scheduleConfig.preset !== 'custom' && (
            <DescriptionBox>
              📅 {describePreset(scheduleConfig.preset)}
            </DescriptionBox>
          )}
        </FieldGroup>

        {scheduleConfig.preset === 'custom' && (
          <FieldGroup>
            <FieldLabel>Custom cron expression</FieldLabel>
            <CronMonospaceInput
              value={scheduleConfig.cron}
              onChange={handleCustomCronChange}
              placeholder="e.g. 0 5 * * *"
              status={cronError ? 'error' : ''}
              size="large"
            />
            {cronError ? (
              <CronError>{cronError}</CronError>
            ) : (
              <HelpText>
                Standard 5-field cron: minute hour day month weekday. Example:{' '}
                <code>0 5 * * *</code> runs daily at 5 AM.
              </HelpText>
            )}
            {!cronError && scheduleConfig.cron.trim() && (
              <DescriptionBox style={{ fontFamily: 'monospace' }}>
                {scheduleConfig.cron}
              </DescriptionBox>
            )}
          </FieldGroup>
        )}

        <FieldGroup>
          <FieldLabel>Timezone</FieldLabel>
          <Select
            value={scheduleConfig.timezone}
            onChange={handleTimezoneChange}
            size="large"
            style={{ width: '100%' }}
            options={TIMEZONES}
          />
          <HelpText>
            All schedule times are interpreted in the selected timezone.
          </HelpText>
        </FieldGroup>
      </Section>

      <Alert
        type="info"
        showIcon
        message="Cron expression reference"
        description={
          <span>
            Fields (left to right): <code>minute</code> <code>hour</code>{' '}
            <code>day-of-month</code> <code>month</code>{' '}
            <code>day-of-week</code>. Use <code>*</code> for every unit,{' '}
            <code>*/n</code> for every n units.
          </span>
        }
      />
    </StepContainer>
  );
}
