import { expect, test } from '@playwright/test';

import {
  DHIS2_DATASET_ID,
  DHIS2_DATASET_NAME,
  attachFailureContext,
  openLocalDataPage,
  selectDataset,
  selectFirstDropdownOption,
  waitForStagingPreview,
  watchConsoleMessages,
} from './helpers';

test('supports dynamic period hierarchy filtering from the UI', async (
  { page },
  testInfo,
) => {
  const consoleMessages = watchConsoleMessages(page);

  try {
    await openLocalDataPage(page);
    await selectDataset(page, DHIS2_DATASET_NAME);
    await waitForStagingPreview(page);

    await expect(
      page.getByTestId('dhis2-staging-preview-period-columns'),
    ).toBeVisible();

    const periodFilter = page.getByTestId('dhis2-local-data-period-filter');
    await expect(periodFilter).toBeVisible({ timeout: 60000 });

    const selectedPeriod = await selectFirstDropdownOption(page, periodFilter);

    const requestPromise = page.waitForRequest(
      request =>
        request.url().includes(`/api/v1/dhis2/staged-datasets/${DHIS2_DATASET_ID}/query`) &&
        request.method() === 'POST',
    );

    const responsePromise = page.waitForResponse(
      response =>
        response.url().includes(`/api/v1/dhis2/staged-datasets/${DHIS2_DATASET_ID}/query`) &&
        response.request().method() === 'POST',
    );

    await page.getByTestId('dhis2-local-data-run-query').click();

    const request = await requestPromise;
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();

    const body = request.postDataJSON() as {
      filters?: Array<{ column?: string; operator?: string; value?: unknown }>;
    };
    const filters = body.filters || [];
    const periodFilterPayload = filters.find(
      filter =>
        filter.operator === 'in' &&
        Array.isArray(filter.value) &&
        filter.value.length > 0,
    );

    expect(periodFilterPayload).toBeTruthy();

    const result = (await response.json()).result;
    expect(Array.isArray(result.rows)).toBeTruthy();
    expect(result.rows.length).toBeGreaterThan(0);

    await testInfo.attach('period-query-context', {
      body: JSON.stringify(
        {
          selectedPeriod,
          periodFilterPayload,
          returnedRows: result.rows.length,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    await attachFailureContext(page, testInfo, consoleMessages);
  }
});
