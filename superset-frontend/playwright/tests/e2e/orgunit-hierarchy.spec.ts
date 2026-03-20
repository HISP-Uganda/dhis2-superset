import { expect, test } from '@playwright/test';

import {
  DHIS2_DATASET_ID,
  DHIS2_DATASET_NAME,
  attachFailureContext,
  openLocalDataPage,
  selectDataset,
  selectFirstDropdownOption,
  watchConsoleMessages,
} from './helpers';

test('keeps orgUnit hierarchy available without forcing deeper child levels', async (
  { page },
  testInfo,
) => {
  const consoleMessages = watchConsoleMessages(page);

  try {
    await openLocalDataPage(page);
    await selectDataset(page, DHIS2_DATASET_NAME);

    const orgUnitFilters = page.locator(
      '[data-test^="dhis2-local-data-ou-filter-"]',
    );
    await expect(orgUnitFilters.first()).toBeVisible({ timeout: 60000 });

    const filterCount = await orgUnitFilters.count();
    expect(filterCount).toBeGreaterThan(1);

    const firstFilter = orgUnitFilters.nth(0);
    const secondFilter = orgUnitFilters.nth(1);
    const firstFilterKey = (
      await firstFilter.getAttribute('data-test')
    )?.replace('dhis2-local-data-ou-filter-', '');
    const secondFilterKey = (
      await secondFilter.getAttribute('data-test')
    )?.replace('dhis2-local-data-ou-filter-', '');

    expect(firstFilterKey).toBeTruthy();
    expect(secondFilterKey).toBeTruthy();

    const selectedLevel = await selectFirstDropdownOption(page, firstFilter);
    await expect(secondFilter).toBeVisible({ timeout: 30000 });

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
      filters?: Array<{ column?: string; value?: unknown }>;
    };
    const filters = body.filters || [];

    expect(filters.some(filter => filter.column === firstFilterKey)).toBeTruthy();
    expect(filters.some(filter => filter.column === secondFilterKey)).toBeFalsy();

    const result = (await response.json()).result;
    expect(Array.isArray(result.rows)).toBeTruthy();
    expect(result.rows.length).toBeGreaterThan(0);

    await testInfo.attach('orgunit-query-context', {
      body: JSON.stringify(
        {
          firstFilterKey,
          secondFilterKey,
          selectedLevel,
          appliedFilters: filters,
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
