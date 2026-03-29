import { t } from '@superset-ui/core';

export const getDatabaseIdFromSearch = (search: string): number | undefined => {
  const params = new URLSearchParams(search);
  const rawValue = params.get('database');
  if (!rawValue) {
    return undefined;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const getDatasetIdFromSearch = (search: string): number | undefined => {
  const params = new URLSearchParams(search);
  const rawValue = params.get('dataset');
  if (!rawValue) {
    return undefined;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const getDHIS2Route = (pathname: string, databaseId?: number): string => {
  if (!databaseId) {
    return pathname;
  }
  const params = new URLSearchParams();
  params.set('database', String(databaseId));
  return `${pathname}?${params.toString()}`;
};

export const getSqlLabQueryRoute = (
  databaseId: number,
  sql: string,
): string => {
  const params = new URLSearchParams();
  params.set('dbid', String(databaseId));
  params.set('sql', sql);
  return `/sqllab?${params.toString()}`;
};

const pad = (value: number): string => String(value).padStart(2, '0');

export const formatDateTime = (value?: string | null): string => {
  if (!value) {
    return t('Never');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t('Never');
  }
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
};

export const formatFreshness = (minutes?: number | null): string => {
  if (minutes === null || minutes === undefined) {
    return t('Never synced');
  }
  if (minutes < 60) {
    return t('%s min ago', Math.max(1, Math.round(minutes)));
  }
  if (minutes < 1440) {
    return t('%s hr ago', Math.max(1, Math.round(minutes / 60)));
  }
  return t('%s d ago', Math.max(1, Math.round(minutes / 1440)));
};

export const formatDuration = (seconds?: number | null): string => {
  if (seconds === null || seconds === undefined) {
    return t('In progress');
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  return `${Math.round(seconds / 3600)}h`;
};

export const getStatusColor = (status?: string | null): string => {
  switch (status) {
    case 'ready':
    case 'complete':
    case 'success':
      return 'green';
    case 'partial':
      return 'gold';
    case 'failed':
      return 'red';
    case 'queued':
    case 'running':
      return 'blue';
    case 'pending':
    case 'missing':
      return 'default';
    default:
      return 'default';
  }
};

export const formatCount = (value?: number | null): string => {
  if (value === null || value === undefined) {
    return '0';
  }
  return new Intl.NumberFormat().format(value);
};

export const getAuthLabel = (authType: 'basic' | 'pat'): string =>
  authType === 'basic' ? t('Basic auth') : t('Personal access token');

export const getAuthColor = (authType: 'basic' | 'pat'): string =>
  authType === 'basic' ? 'blue' : 'purple';

export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object') {
    const body = 'body' in error ? (error as { body?: { message?: string } }).body : undefined;
    const message = 'message' in error ? (error as { message?: string }).message : undefined;
    return body?.message || message || fallback;
  }
  return fallback;
};
