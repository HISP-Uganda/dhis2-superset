import { expect, test } from '@playwright/test';

import {
  DHIS2_DATASET_NAME,
  attachFailureContext,
  fetchClickHouseCount,
  openLocalDataPage,
  selectDataset,
  waitForStagingPreview,
  watchConsoleMessages,
} from './helpers';

test('shows raw staged preview rows for the populated ds table', async (
  { page, request },
  testInfo,
) => {
  const consoleMessages = watchConsoleMessages(page);

  try {
    const stagingCount = await fetchClickHouseCount(
      request,
      'dhis2_staging.ds_7_ep_malaria',
    );
    expect(stagingCount).toBeGreaterThan(0);

    await openLocalDataPage(page);
    await selectDataset(page, DHIS2_DATASET_NAME);
    await waitForStagingPreview(page);

    await expect(
      page.getByTestId('dhis2-staging-preview-staging-ref'),
    ).toContainText('ds_7_ep_malaria');
    await expect(
      page.getByTestId('dhis2-staging-preview-orgunit-columns'),
    ).toBeVisible();
    await expect(
      page.getByTestId('dhis2-staging-preview-period-columns'),
    ).toBeVisible();

    const previewTable = page.getByTestId('dhis2-staging-preview-table');
    await expect(previewTable).toBeVisible({ timeout: 60000 });

    const headers = await previewTable.locator('thead th').allInnerTexts();
    const firstRow = (await previewTable.locator('tbody tr').first().innerText()).trim();

    expect(headers.length).toBeGreaterThan(0);
    expect(firstRow.length).toBeGreaterThan(0);

    await testInfo.attach('staging-preview-sample', {
      body: JSON.stringify({ stagingCount, headers, firstRow }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await attachFailureContext(page, testInfo, consoleMessages);
  }
});
