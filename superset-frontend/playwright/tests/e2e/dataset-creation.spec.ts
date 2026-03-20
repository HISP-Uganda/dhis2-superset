import { expect, test } from '@playwright/test';

import { attachFailureContext, watchConsoleMessages } from './helpers';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('dataset creation hides internal databases and shows real org-unit level names', async (
  { page },
  testInfo,
) => {
  const consoleMessages = watchConsoleMessages(page);

  try {
    await page.goto('/dataset/add/');

    await expect(page.getByTestId('branching-dataset-wizard')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByPlaceholder('Search Databases')).toBeVisible({
      timeout: 30000,
    });

    const sourceCards = page.getByTestId('dataset-source-card');
    await expect(sourceCards.first()).toBeVisible({ timeout: 30000 });

    await expect(page.getByText('DHIS2 Serving (ClickHouse)')).toHaveCount(0);
    await expect(page.getByText('DHIS2 Staging (DuckDB)')).toHaveCount(0);

    const dhis2Card = page
      .locator('[data-test="dataset-source-card"][data-backend="dhis2"]')
      .first();
    await expect(dhis2Card).toBeVisible({ timeout: 30000 });

    const selectedDatabase = (
      (await dhis2Card.locator('.source-name').textContent()) || ''
    ).trim();
    await dhis2Card.click();
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByRole('heading', { name: 'Data Selection' })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(selectedDatabase)).toBeVisible();

    const levelsResponsePromise = page.waitForResponse(response =>
      response.url().includes('type=organisationUnitLevels') &&
      response.url().includes('staged=true'),
    );

    await page.getByRole('tab', { name: 'Organisation Units' }).click();

    const levelsResponse = await levelsResponsePromise;
    expect(levelsResponse.ok()).toBeTruthy();
    const levelsPayload = (await levelsResponse.json()) as {
      result?: Array<Record<string, unknown>>;
    };

    await expect(page.getByTestId('dhis2-level-mapping')).toBeVisible({
      timeout: 60000,
    });

    const levelWithRealNames = (levelsPayload.result || []).find(item => {
      const names = Object.values(
        (item.instance_level_names as Record<string, unknown>) || {},
      ).filter((value): value is string => typeof value === 'string' && value.length > 0);
      return names.length > 0;
    });

    expect(levelWithRealNames).toBeTruthy();
    const level = Number(levelWithRealNames?.level || 0);
    const visibleNames = Array.from(
      new Set(
        Object.values(
          (levelWithRealNames?.instance_level_names as Record<string, unknown>) || {},
        ).filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    ).slice(0, 2);

    expect(level).toBeGreaterThan(0);
    expect(visibleNames.length).toBeGreaterThan(0);

    for (const name of visibleNames) {
      await expect(
        page
          .getByTestId('dhis2-level-mapping')
          .getByText(new RegExp(`^${escapeRegex(`${level}. ${name}`)}$`))
          .first(),
      ).toBeVisible();
    }

    await testInfo.attach('dataset-creation-levels', {
      body: JSON.stringify(
        {
          database: selectedDatabase,
          sampled_level: levelWithRealNames,
          visible_names: visibleNames,
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
