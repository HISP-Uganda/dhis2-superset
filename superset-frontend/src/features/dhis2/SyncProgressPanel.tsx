import { useEffect, useRef, useState } from 'react';
import { t } from '@superset-ui/core';
import { Typography } from '@superset-ui/core/components';
import { Progress, Space, Tag } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import type { DHIS2SyncJob } from './types';
import { formatCount, getStatusColor } from './utils';

const { Text } = Typography;

interface SyncProgressPanelProps {
  job: DHIS2SyncJob;
}

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'running']);

/** Returns elapsed seconds since the given ISO timestamp, or null. */
function useElapsed(startedAt: string | null | undefined): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(null);
      return undefined;
    }
    const start = new Date(startedAt).getTime();
    const update = () => {
      const secs = Math.floor((Date.now() - start) / 1000);
      setElapsed(secs);
    };
    update();
    timerRef.current = setInterval(update, 1000);
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
    };
  }, [startedAt]);

  return elapsed;
}

function formatElapsed(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export default function SyncProgressPanel({ job }: SyncProgressPanelProps) {
  const isActive = ACTIVE_STATUSES.has(job.status);
  const elapsed = useElapsed(isActive ? job.started_at : null);
  const durationSeconds = isActive ? elapsed : job.duration_seconds ?? null;

  const percent =
    typeof job.percent_complete === 'number'
      ? Math.min(100, Math.max(0, job.percent_complete))
      : isActive
        ? undefined
        : job.status === 'success' || job.status === 'partial'
          ? 100
          : 0;

  const progressStatus =
    job.status === 'failed'
      ? 'exception'
      : job.status === 'success'
        ? 'success'
        : 'active';

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Space align="center" wrap>
        {isActive && (
          <LoadingOutlined spin style={{ fontSize: 14, color: '#1677ff' }} />
        )}
        <Tag color={getStatusColor(job.status)}>{job.status}</Tag>
        {job.current_step && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {job.current_step}
          </Text>
        )}
        {durationSeconds !== null && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('Elapsed: %s', formatElapsed(durationSeconds))}
          </Text>
        )}
      </Space>

      <Progress
        percent={percent}
        status={progressStatus}
        size="small"
        style={{ margin: 0 }}
      />

      <Space wrap size="large">
        {(job.total_units ?? 0) > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              'Instances: %s / %s',
              formatCount(job.completed_units),
              formatCount(job.total_units),
            )}
            {(job.failed_units ?? 0) > 0 && (
              <Text type="danger">
                {t(' (%s failed)', formatCount(job.failed_units))}
              </Text>
            )}
          </Text>
        )}
        {(job.rows_extracted ?? 0) > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('Fetched: %s rows', formatCount(job.rows_extracted))}
          </Text>
        )}
        {(job.rows_staged ?? 0) > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('Staged: %s rows', formatCount(job.rows_staged))}
          </Text>
        )}
        {(job.rows_merged ?? 0) > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('Serving: %s rows', formatCount(job.rows_merged))}
          </Text>
        )}
      </Space>
    </Space>
  );
}
