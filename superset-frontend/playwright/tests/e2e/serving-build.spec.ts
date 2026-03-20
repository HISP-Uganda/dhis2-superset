import { expect, test } from '@playwright/test';

import {
  DHIS2_DATASET_ID,
  DHIS2_DATASET_NAME,
  attachFailureContext,
  fetchClickHouseCount,
  openLocalDataPage,
  selectDataset,
  watchConsoleMessages,
} from './helpers';

test.describe('Serving build', () => {
  test.setTimeout(240000);

  test('populates the canonical serving table from the staged table', async (
    { page, request },
    testInfo,
  ) => {
    const consoleMessages = watchConsoleMessages(page);

    try {
      const beforeServingCount = await fetchClickHouseCount(
        request,
        'dhis2_serving.sv_7_ep_malaria',
      );
      const stagingCount = await fetchClickHouseCount(
        request,
        'dhis2_staging.ds_7_ep_malaria',
      );
      expect(stagingCount).toBeGreaterThan(0);

      await openLocalDataPage(page);
      await selectDataset(page, DHIS2_DATASET_NAME);

      const responsePromise = page.waitForResponse(
        response =>
          response.url().includes(`/api/v1/dhis2/staged-datasets/${DHIS2_DATASET_ID}/query`) &&
          response.request().method() === 'POST',
        { timeout: 240000 },
      );

      await page.getByTestId('dhis2-local-data-run-query').click();

      const response = await responsePromise;
      expect(response.ok()).toBeTruthy();

      const payload = await response.json();
      const result = payload.result ?? payload;
      expect(Array.isArray(result.rows)).toBeTruthy();
      expect(result.rows.length).toBeGreaterThan(0);
      expect(String(result.serving_table_ref || '')).toContain('sv_7_ep_malaria');
      expect(String(result.sql_preview || '')).toContain('sv_7_ep_malaria');

      await expect(
        page.getByTestId('dhis2-local-data-query-results-table'),
      ).toBeVisible({ timeout: 60000 });

      await expect
        .poll(
          async () =>
            fetchClickHouseCount(request, 'dhis2_serving.sv_7_ep_malaria'),
          {
            timeout: 180000,
            message:
              'expected the serving build to persist rows into dhis2_serving.sv_7_ep_malaria',
          },
        )
        .toBeGreaterThan(0);

      const afterServingCount = await fetchClickHouseCount(
        request,
        'dhis2_serving.sv_7_ep_malaria',
      );

      await testInfo.attach('serving-build-counts', {
        body: JSON.stringify(
          {
            beforeServingCount,
            afterServingCount,
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
});
