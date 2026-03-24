/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { useEffect, useState } from 'react';
import { Alert, Badge, Space, Tooltip } from 'antd';
import { t } from '@superset-ui/core';
import { SupersetClient } from '@superset-ui/core';

interface WorkerStatus {
  workers_available: boolean;
  worker_count: number;
  worker_names: string[];
  beat_running: boolean;
  beat_pid: number | null;
}

function workerLabel(names: string[]): string {
  if (!names.length) return '';
  // Celery worker names look like: celery@hostname — strip the hostname part for brevity
  const short = names.map(n => n.split('@')[0] || n);
  return short.join(', ');
}

/**
 * Shows a live status strip for Celery workers + Celery Beat.
 * Polls every 30 s. Also displays a warning Alert when workers are offline.
 */
export default function WorkerStatusBanner() {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkWorkers = async () => {
      try {
        const resp = await SupersetClient.get({
          endpoint: '/api/v1/dhis2/diagnostics/worker-status',
        });
        if (cancelled) return;
        const result = (resp.json as any)?.result;
        if (result) {
          setStatus(result);
          if (result.workers_available) {
            setDismissed(false);
          }
        }
      } catch {
        // silently ignore — banner stays hidden on network error
      }
    };

    checkWorkers();
    const interval = setInterval(checkWorkers, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!status) return null;

  const workerOk = status.workers_available;
  const beatOk = status.beat_running;

  const statusStrip = (
    <Space size="middle" style={{ marginBottom: workerOk && beatOk ? 0 : 8 }}>
      <Tooltip
        title={
          workerOk
            ? t('Workers: %s', workerLabel(status.worker_names) || String(status.worker_count))
            : t('No Celery workers are responding')
        }
      >
        <span>
          <Badge
            status={workerOk ? 'success' : 'error'}
            text={
              <span style={{ fontSize: 12 }}>
                {t('Celery workers')}
                {workerOk ? ` (${status.worker_count})` : ` — ${t('offline')}`}
              </span>
            }
          />
        </span>
      </Tooltip>

      <Tooltip
        title={
          beatOk
            ? t('Celery Beat scheduler is running (PID %s)', status.beat_pid ?? '?')
            : t('Celery Beat is not running — scheduled syncs will not fire')
        }
      >
        <span>
          <Badge
            status={beatOk ? 'success' : 'warning'}
            text={
              <span style={{ fontSize: 12 }}>
                {t('Celery Beat')}
                {beatOk
                  ? status.beat_pid
                    ? ` (PID ${status.beat_pid})`
                    : ''
                  : ` — ${t('offline')}`}
              </span>
            }
          />
        </span>
      </Tooltip>
    </Space>
  );

  return (
    <>
      {statusStrip}
      {!workerOk && !dismissed && (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setDismissed(true)}
          style={{ marginTop: 8, marginBottom: 8 }}
          message={t('No background job processors running')}
          description={t(
            'Celery workers are not available. Dataset syncs and metadata refreshes ' +
              'will run in-process (thread mode) which may impact server performance. ' +
              'Scheduled syncs will not fire until workers are restarted. ' +
              'Run: bash superset-manager.sh restart-celery',
          )}
        />
      )}
    </>
  );
}
