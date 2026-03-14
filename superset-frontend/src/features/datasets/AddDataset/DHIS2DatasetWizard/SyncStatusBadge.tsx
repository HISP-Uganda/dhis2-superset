import { styled } from '@superset-ui/core';
import { Spin, Tooltip } from 'antd';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncStatusBadgeProps {
  status: 'success' | 'partial' | 'failed' | 'pending' | 'running' | null;
  lastSyncAt: string | null;
  rowCount: number | null;
  compact?: boolean;
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function humanRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return 'unknown time';

  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs !== 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}

// ─── Status config ────────────────────────────────────────────────────────────

interface StatusConfig {
  color: string;
  bg: string;
  border: string;
  icon: string | null; // null = spinner
  label: string;
}

function getStatusConfig(
  status: SyncStatusBadgeProps['status'],
): StatusConfig {
  switch (status) {
    case 'success':
      return {
        color: '#389e0d',
        bg: '#f6ffed',
        border: '#b7eb8f',
        icon: '✓',
        label: 'Synced',
      };
    case 'partial':
      return {
        color: '#ad6800',
        bg: '#fffbe6',
        border: '#ffe58f',
        icon: '◑',
        label: 'Partial',
      };
    case 'failed':
      return {
        color: '#cf1322',
        bg: '#fff1f0',
        border: '#ffa39e',
        icon: '✕',
        label: 'Failed',
      };
    case 'running':
      return {
        color: '#0050b3',
        bg: '#e6f7ff',
        border: '#91d5ff',
        icon: null, // spinner
        label: 'Running',
      };
    case 'pending':
      return {
        color: '#0050b3',
        bg: '#e6f7ff',
        border: '#91d5ff',
        icon: null, // spinner
        label: 'Pending',
      };
    default:
      return {
        color: '#595959',
        bg: '#fafafa',
        border: '#d9d9d9',
        icon: '–',
        label: 'Never synced',
      };
  }
}

// ─── Styled components ───────────────────────────────────────────────────────

const BadgeWrapper = styled.span<{
  color: string;
  bg: string;
  border: string;
  compact: boolean;
}>`
  display: inline-flex;
  align-items: center;
  gap: ${({ compact }) => (compact ? '4px' : '6px')};
  padding: ${({ compact }) => (compact ? '2px 8px' : '4px 10px')};
  border-radius: 12px;
  border: 1px solid ${({ border }) => border};
  background: ${({ bg }) => bg};
  color: ${({ color }) => color};
  font-size: ${({ compact }) => (compact ? '11px' : '12px')};
  font-weight: 600;
  white-space: nowrap;
  line-height: 1.4;
`;

const IconSpan = styled.span`
  font-size: 12px;
  line-height: 1;
`;

const TimestampText = styled.span<{ compact: boolean }>`
  font-weight: 400;
  opacity: 0.85;
  font-size: ${({ compact }) => (compact ? '10px' : '11px')};
`;

const RowCountText = styled.span`
  font-weight: 400;
  opacity: 0.75;
  font-size: 11px;
`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function SyncStatusBadge({
  status,
  lastSyncAt,
  rowCount,
  compact = false,
}: SyncStatusBadgeProps) {
  const cfg = getStatusConfig(status);
  const relativeTime = lastSyncAt ? humanRelativeTime(lastSyncAt) : null;
  const absoluteTime = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString()
    : null;

  const badge = (
    <BadgeWrapper
      color={cfg.color}
      bg={cfg.bg}
      border={cfg.border}
      compact={compact}
    >
      {cfg.icon === null ? (
        <Spin size="small" style={{ color: cfg.color }} />
      ) : (
        <IconSpan>{cfg.icon}</IconSpan>
      )}

      <span>{cfg.label}</span>

      {relativeTime && !compact && (
        <TimestampText compact={compact}>{relativeTime}</TimestampText>
      )}

      {rowCount !== null && !compact && (
        <RowCountText>
          &middot; {rowCount.toLocaleString()} row{rowCount !== 1 ? 's' : ''}
        </RowCountText>
      )}
    </BadgeWrapper>
  );

  // In compact mode show full details in a tooltip
  if (compact) {
    const tooltipLines: string[] = [cfg.label];
    if (relativeTime) tooltipLines.push(`Last sync: ${relativeTime}`);
    if (absoluteTime) tooltipLines.push(absoluteTime);
    if (rowCount !== null)
      tooltipLines.push(`${rowCount.toLocaleString()} rows`);

    return (
      <Tooltip title={tooltipLines.join('\n')} placement="top">
        {badge}
      </Tooltip>
    );
  }

  if (absoluteTime) {
    return (
      <Tooltip title={absoluteTime} placement="top">
        {badge}
      </Tooltip>
    );
  }

  return badge;
}
