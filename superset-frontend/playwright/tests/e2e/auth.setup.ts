import fs from 'node:fs';

import { expect, test } from '@playwright/test';

import { AuthPage } from '../../pages/AuthPage';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  AUTH_STATE_DIR,
  AUTH_STATE_PATH,
  ROUTES,
} from './helpers';

test('creates an authenticated admin session', async ({ page }) => {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });

  const authPage = new AuthPage(page);
  await authPage.goto();
  await authPage.waitForLoginForm();

  const loginRequestPromise = authPage.waitForLoginRequest();
  await authPage.loginWithCredentials(ADMIN_USERNAME, ADMIN_PASSWORD);

  const loginResponse = await loginRequestPromise;
  expect(loginResponse.status()).toBe(302);

  await page.waitForURL(url => !url.pathname.endsWith(ROUTES.login), {
    timeout: 30000,
  });
  await expect(page.locator('body')).toContainText(/Home|Welcome/);

  await page.context().storageState({ path: AUTH_STATE_PATH });
});
