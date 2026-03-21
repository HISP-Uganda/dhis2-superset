import { expect, test } from '@playwright/test';

import { ROUTES, attachFailureContext, watchConsoleMessages } from './helpers';

test('renders the public portal, navigates pages, and saves layout preferences', async ({
  page,
}, testInfo) => {
  const consoleMessages = watchConsoleMessages(page);

  try {
    await page.goto(ROUTES.publicPortal);
    const portalNav = page.locator('nav').first();

    await expect(page.getByText('Uganda Malaria Analytics Portal')).toBeVisible(
      { timeout: 30000 },
    );
    await expect(page.locator('[data-test="navbar-top"]')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Customize layout' }),
    ).toBeVisible({ timeout: 30000 });

    await portalNav
      .getByRole('button', { name: 'Dashboards', exact: true })
      .click();
    await expect(page.getByText('Public Dashboards')).toBeVisible({
      timeout: 30000,
    });

    await portalNav.getByRole('button', { name: 'Pages', exact: true }).click();
    await page.getByText('About').click();
    await expect(page.getByText('National Malaria Programme')).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole('button', { name: 'Customize layout' }).click();
    await expect(page.getByText('Customize Page Layout')).toBeVisible({
      timeout: 30000,
    });

    const saveResponsePromise = page.waitForResponse(
      response =>
        response.url().includes('/api/v1/public_page/page-layout') &&
        response.request().method() === 'POST',
    );

    await page.getByRole('button', { name: 'Save' }).click();

    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();

    await page.getByRole('button', { name: 'Page studio' }).click();
    await expect(
      page.locator('.ant-drawer-title').getByText('Page Studio'),
    ).toBeVisible({
      timeout: 30000,
    });
  } finally {
    await attachFailureContext(page, testInfo, consoleMessages);
  }
});
