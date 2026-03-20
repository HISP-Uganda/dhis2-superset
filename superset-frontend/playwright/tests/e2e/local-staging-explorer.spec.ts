import { expect, test } from '@playwright/test';

import {
  ROUTES,
  attachFailureContext,
  watchConsoleMessages,
} from './helpers';

test('runs a local-staging explorer query for the canonical serving table', async (
  { page },
  testInfo,
) => {
  const consoleMessages = watchConsoleMessages(page);

  try {
    await page.goto(ROUTES.localStaging);
    await expect(
      page.getByRole('heading', { name: 'Local Staging Engine' }),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole('tab', { name: 'Data Explorer' }).click();

    const tablesTable = page.getByTestId('local-staging-tables-table');
    await expect(tablesTable).toBeVisible({ timeout: 30000 });

    await tablesTable.getByRole('button', { name: 'sv_7_ep_malaria' }).click();

    const queryResponsePromise = page.waitForResponse(
      response =>
        response.url().includes('/api/v1/local-staging/run-query') &&
        response.request().method() === 'POST',
      { timeout: 60000 },
    );

    await page.getByTestId('local-staging-query-run').click();

    const response = await queryResponsePromise;
    expect(response.ok()).toBeTruthy();

    const payload = await response.json();
    const result = payload.result ?? payload;
    expect(Array.isArray(result.rows)).toBeTruthy();
    expect(result.rows.length).toBeGreaterThan(0);
    expect(Array.isArray(result.columns)).toBeTruthy();
    expect(result.columns).toContain('dhis2_instance');

    await expect(
      page.getByTestId('local-staging-query-results-table'),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByTestId('local-staging-query-rowcount'),
    ).toContainText('rows returned', { timeout: 30000 });

    await testInfo.attach('local-staging-query-result', {
      body: JSON.stringify(
        {
          columns: result.columns,
          rowcount: result.rowcount,
          firstRow: result.rows[0] ?? null,
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
