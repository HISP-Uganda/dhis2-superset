import path from 'node:path';

import {
  APIRequestContext,
  expect,
  Locator,
  Page,
  TestInfo,
} from '@playwright/test';

export const ADMIN_USERNAME = process.env.PLAYWRIGHT_ADMIN_USERNAME || 'admin';
export const ADMIN_PASSWORD =
  process.env.PLAYWRIGHT_ADMIN_PASSWORD || 'Admin@2026';
export const AUTH_STATE_PATH = 'playwright/.auth/admin.json';
export const AUTH_STATE_DIR = path.dirname(AUTH_STATE_PATH);

export const DHIS2_DATABASE_ID = Number(
  process.env.PLAYWRIGHT_DHIS2_DATABASE_ID || '1',
);
export const DHIS2_DATASET_ID = Number(
  process.env.PLAYWRIGHT_DHIS2_DATASET_ID || '7',
);
export const DHIS2_DATASET_NAME =
  process.env.PLAYWRIGHT_DHIS2_DATASET_NAME || 'EP-Malaria';

export const ROUTES = {
  localStaging: '/superset/local-staging/',
  localData: `/superset/dhis2/local-data/?database=${DHIS2_DATABASE_ID}`,
  login: '/login/',
  publicPortal: '/superset/public/',
  syncHistory: `/superset/dhis2/sync-history/?database=${DHIS2_DATABASE_ID}`,
  welcome: '/superset/welcome/',
} as const;

export function watchConsoleMessages(page: Page): string[] {
  const messages: string[] = [];

  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });

  page.on('pageerror', error => {
    messages.push(`pageerror: ${error.message}`);
  });

  return messages;
}

export async function attachFailureContext(
  page: Page,
  testInfo: TestInfo,
  consoleMessages: string[],
): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }

  await testInfo.attach('current-url', {
    body: page.url(),
    contentType: 'text/plain',
  });

  if (consoleMessages.length) {
    await testInfo.attach('console-messages', {
      body: JSON.stringify(consoleMessages, null, 2),
      contentType: 'application/json',
    });
  }

  const visibleErrors = await page
    .locator('[role="alert"], .ant-alert, .ant-message-notice')
    .allInnerTexts()
    .catch(() => []);
  if (visibleErrors.length) {
    await testInfo.attach('visible-errors', {
      body: JSON.stringify(visibleErrors, null, 2),
      contentType: 'application/json',
    });
  }
}

export async function fetchClickHouseCount(
  request: APIRequestContext,
  tableRef: string,
): Promise<number> {
  const response = await request.get(
    `http://127.0.0.1:8123/?query=${encodeURIComponent(
      `SELECT count() FROM ${tableRef}`,
    )}`,
  );
  expect(response.ok()).toBeTruthy();
  return Number((await response.text()).trim());
}

export async function openLocalDataPage(page: Page): Promise<void> {
  await page.goto(ROUTES.localData);
  await expect(
    page.getByRole('heading', { name: 'Data Workspace' }),
  ).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId('dhis2-local-data-dataset-select')).toBeVisible(
    {
      timeout: 30000,
    },
  );
}

export async function selectDataset(
  page: Page,
  datasetName = DHIS2_DATASET_NAME,
): Promise<void> {
  const selector = page.getByTestId('dhis2-local-data-dataset-select');
  if ((await selector.textContent())?.includes(datasetName)) {
    await expect(selector).toContainText(datasetName, { timeout: 30000 });
    return;
  }

  await selector.click();

  const option = page
    .locator('.ant-select-dropdown .ant-select-item-option')
    .filter({ hasText: datasetName })
    .first();
  await expect(option).toBeVisible({ timeout: 30000 });
  await option.click();

  await expect(selector).toContainText(datasetName, { timeout: 30000 });
}

export async function waitForStagingPreview(page: Page): Promise<void> {
  await expect(page.getByTestId('dhis2-staging-preview-card')).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByTestId('dhis2-staging-preview-row-count'),
  ).toContainText('Staging rows:', { timeout: 60000 });
}

export async function selectFirstDropdownOption(
  page: Page,
  locator: Locator,
): Promise<string> {
  await locator.click();
  const option = page
    .locator('.ant-select-dropdown .ant-select-item-option')
    .first();
  await expect(option).toBeVisible({ timeout: 30000 });
  const text = (await option.innerText()).trim();
  await option.click();
  return text;
}
