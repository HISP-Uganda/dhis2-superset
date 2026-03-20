import { expect, test } from '@playwright/test';

import {
  DHIS2_DATABASE_ID,
  DHIS2_DATASET_ID,
  ROUTES,
  attachFailureContext,
  watchConsoleMessages,
} from './helpers';

const AUTO_RESET_MESSAGE =
  'Auto-reset: job was stuck in running state (server restart?)';

test('surfaces recovered stuck jobs and shows no active running job for the dataset', async (
  { page, request },
  testInfo,
) => {
  const consoleMessages = watchConsoleMessages(page);

  try {
    const historyResponse = await request.get(
      `/api/v1/dhis2/diagnostics/sync-history/${DHIS2_DATABASE_ID}?limit=50&dataset_id=${DHIS2_DATASET_ID}`,
    );
    expect(historyResponse.ok()).toBeTruthy();

    const historyPayload = await historyResponse.json();
    const recoveredJob = (historyPayload.result || []).find(
      (job: { error_message?: string | null }) =>
        job.error_message === AUTO_RESET_MESSAGE,
    );

    expect(recoveredJob).toBeTruthy();

    const activeJobsResponse = await request.get(
      `/api/v1/dhis2/diagnostics/active-jobs/${DHIS2_DATABASE_ID}`,
    );
    expect(activeJobsResponse.ok()).toBeTruthy();
    const activeJobsPayload = await activeJobsResponse.json();
    expect(
      (activeJobsPayload.result || []).some(
        (job: { staged_dataset_id?: number; status?: string }) =>
          job.staged_dataset_id === DHIS2_DATASET_ID && job.status === 'running',
      ),
    ).toBeFalsy();

    await page.goto(ROUTES.syncHistory);
    await expect(page.getByText('Job History')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(AUTO_RESET_MESSAGE)).toBeVisible({
      timeout: 60000,
    });

    await testInfo.attach('recovered-job', {
      body: JSON.stringify(recoveredJob, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await attachFailureContext(page, testInfo, consoleMessages);
  }
});
