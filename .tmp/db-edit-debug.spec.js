const { test, expect } = require('playwright/test');

test('debug database 5 edit flow', async ({ page }) => {
  page.on('response', async response => {
    if (
      response.url().includes('/api/v1/database/5') &&
      response.request().method() === 'PUT'
    ) {
      console.log(`PUT_STATUS=${response.status()}`);
      console.log(`PUT_BODY=${await response.text()}`);
      console.log(`PUT_REQUEST=${response.request().postData() || ''}`);
    }
  });

  await page.goto('http://127.0.0.1:9001/login/');
  await page.getByLabel(/username/i).fill('admin');
  await page.getByLabel(/password/i).fill('Admin@2026');
  await page.getByRole('button', { name: /login/i }).click();

  await page.goto('http://127.0.0.1:9001/databaseview/list/');
  await page.getByText('UG Malaria Repository').waitFor();

  const databaseRow = page.locator('tr').filter({
    hasText: 'UG Malaria Repository',
  });
  await expect(databaseRow).toHaveCount(1);

  await databaseRow.locator('[data-test="database-edit"]').click();

  await page.getByRole('button', { name: /^Continue$/i }).click();
  await page.getByText(/step 3 of 5/i).waitFor();

  await page.getByRole('button', { name: /^Continue$/i }).click();
  await page.getByText(/step 4 of 5/i).waitFor();

  await page.getByRole('button', { name: /^Continue$/i }).click();
  await page.getByText(/step 5 of 5/i).waitFor();

  await page.getByRole('button', { name: /save database/i }).click();
  await page.waitForTimeout(3000);
});
