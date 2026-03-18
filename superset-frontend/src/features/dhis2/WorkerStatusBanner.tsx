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
import { Alert } from 'antd';
import { t } from '@superset-ui/core';
import { SupersetClient } from '@superset-ui/core';

interface WorkerStatus {
  workers_available: boolean;
  worker_count: number;
}

/**
 * Displays a persistent warning banner when no Celery workers are available.
 * Polls every 30 seconds so the banner clears automatically when workers restart.
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

  if (!status || status.workers_available || dismissed) {
    return null;
  }

  return (
    <Alert
      type="warning"
      showIcon
      closable
      onClose={() => setDismissed(true)}
      style={{ marginBottom: 16 }}
      message={t('No background job processors running')}
      description={t(
        'Celery workers are not available. Dataset syncs and metadata refreshes ' +
          'will run in-process (thread mode) which may impact server performance. ' +
          'Scheduled syncs will not fire until workers are restarted. ' +
          'Run: deploy/deploy-supersets.sh restart-celery',
      )}
    />
  );
}
