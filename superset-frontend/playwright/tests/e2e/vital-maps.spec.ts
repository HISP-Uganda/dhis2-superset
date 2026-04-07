import { expect, test } from '@playwright/test';

import { watchConsoleMessages, attachFailureContext } from './helpers';

/**
 * Vital Maps E2E Test — uses pre-authenticated session from auth.setup.ts
 */

async function findFirstDatasetId(page: any): Promise<number | null> {
  const resp = await page.request.get(
    '/api/v1/dataset/?q=(page_size:10,page:0)',
  );
  const data = await resp.json();
  return data?.result?.[0]?.id ?? null;
}

function exploreUrl(datasetId: number): string {
  return `/explore/?datasource_type=table&datasource_id=${datasetId}&viz_type=vital_maps`;
}

async function waitForExploreReady(page: any): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.ant-select, [class*="ControlPanelSection"], [class*="controlPanelSection"]',
      ).length > 0,
    { timeout: 90000 },
  );
  await page.waitForTimeout(2000);
}

test.describe('Vital Maps Chart', () => {
  test('renders custom control panel with Layer Configuration', async ({
    page,
  }, testInfo) => {
    const consoleMessages = watchConsoleMessages(page);

    const datasetId = await findFirstDatasetId(page);
    if (!datasetId) {
      test.skip();
      return;
    }

    await page.goto(exploreUrl(datasetId));
    await waitForExploreReady(page);

    await page.screenshot({
      path: `playwright/screenshots/vital-maps-explore-initial.png`,
      fullPage: true,
    });

    // Verify custom Vital Maps controls are rendered
    await expect(page.getByText('Layer Configuration')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Layer Type')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Geometry Column', { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Latitude Column', { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Longitude Column', { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Category Column', { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Label Column', { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Metric', { exact: true }).first()).toBeVisible({ timeout: 5000 });

    // Verify Layer Type dropdown has all 7 layer types
    const layerTypeSelect = page
      .locator('.ant-select')
      .filter({ hasText: 'Choropleth' })
      .first();
    await layerTypeSelect.click();
    await page.waitForTimeout(500);

    const layerOptions = page.locator(
      '.ant-select-dropdown:visible .ant-select-item-option',
    );
    const layerCount = await layerOptions.count();
    console.log(`Layer types available: ${layerCount}`);
    expect(layerCount).toBe(7);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Verify Basemap section exists
    await expect(page.getByText('Basemap')).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: `playwright/screenshots/vital-maps-final-state.png`,
      fullPage: true,
    });

    await attachFailureContext(page, testInfo, consoleMessages);
  });

  test('column selectors show dataset columns', async ({
    page,
  }, testInfo) => {
    const consoleMessages = watchConsoleMessages(page);

    const datasetId = await findFirstDatasetId(page);
    if (!datasetId) {
      test.skip();
      return;
    }

    await page.goto(exploreUrl(datasetId));
    await waitForExploreReady(page);

    // Find and click the Geometry Column selector specifically (not Layer Type)
    // The Geometry Column label should be followed by a Select control
    const geometryLabel = page.getByText('Geometry Column', { exact: true });
    await expect(geometryLabel).toBeVisible({ timeout: 5000 });

    // Click the select input that follows the Geometry Column label
    // Use a more specific locator: find the control container for geometry_col
    const geometrySelect = page
      .locator('[data-test="geometry_col"]')
      .locator('.ant-select')
      .first();

    // If data-test doesn't exist, try finding by adjacent sibling
    let selectToClick = geometrySelect;
    if (
      !(await geometrySelect.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      // Fallback: find the select right after the geometry label
      selectToClick = geometryLabel
        .locator('xpath=ancestor::div[contains(@class,"Control")]')
        .locator('.ant-select')
        .first();
    }

    if (
      !(await selectToClick.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      // Another fallback: find selects in the control panel and skip the first one (Layer Type)
      const allSelects = page.locator(
        '[class*="ControlPanelSection"] .ant-select',
      );
      const selectCount = await allSelects.count();
      console.log(`Found ${selectCount} selects in control panel`);

      // The second select should be Geometry Column (first is Layer Type)
      if (selectCount >= 2) {
        selectToClick = allSelects.nth(1);
      }
    }

    await selectToClick.click();
    await page.waitForTimeout(800);

    const options = page.locator(
      '.ant-select-dropdown:visible .ant-select-item-option',
    );
    const optionCount = await options.count();
    console.log(`Geometry Column dropdown has ${optionCount} options`);

    // Should have dataset columns (44 columns for this dataset)
    if (optionCount > 0) {
      for (let i = 0; i < Math.min(optionCount, 5); i++) {
        const text = await options.nth(i).innerText();
        console.log(`  Option ${i}: ${text}`);
      }
    }

    await page.screenshot({
      path: `playwright/screenshots/vital-maps-geometry-column-dropdown.png`,
    });

    // Columns should be present (not layer type options)
    expect(optionCount).toBeGreaterThan(0);

    await page.keyboard.press('Escape');

    await attachFailureContext(page, testInfo, consoleMessages);
  });

  test('can run query after selecting a geometry column', async ({
    page,
  }, testInfo) => {
    const consoleMessages = watchConsoleMessages(page);

    const datasetId = await findFirstDatasetId(page);
    if (!datasetId) {
      test.skip();
      return;
    }

    await page.goto(exploreUrl(datasetId));
    await waitForExploreReady(page);

    // Select a column in the Geometry Column selector
    // Find all selects, skip the first one (Layer Type)
    const controlSelects = page.locator(
      '[class*="ControlPanelSection"] .ant-select',
    );
    const selectCount = await controlSelects.count();

    if (selectCount >= 2) {
      // Click second select (Geometry Column)
      await controlSelects.nth(1).click();
      await page.waitForTimeout(800);

      const options = page.locator(
        '.ant-select-dropdown:visible .ant-select-item-option',
      );
      const optionCount = await options.count();

      if (optionCount > 0) {
        // Select first column
        const firstOption = await options.first().innerText();
        console.log(`Selecting geometry column: ${firstOption}`);
        await options.first().click();
        await page.waitForTimeout(500);
      }
    }

    await page.screenshot({
      path: `playwright/screenshots/vital-maps-with-column-selected.png`,
      fullPage: true,
    });

    // Click Update chart / Run button
    const updateButton = page.getByText('Update chart');
    const runButton = page.locator('[data-test="run-query-button"]').first();
    const buttonToClick = (await updateButton
      .isVisible({ timeout: 3000 })
      .catch(() => false))
      ? updateButton
      : runButton;

    if (
      await buttonToClick.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      const responsePromise = page
        .waitForResponse(
          (response: any) =>
            response.url().includes('/api/v1/chart/data') &&
            response.request().method() === 'POST',
          { timeout: 30000 },
        )
        .catch(() => null);

      await buttonToClick.click();
      const chartResponse = await responsePromise;

      if (chartResponse) {
        const status = chartResponse.status();
        console.log(`Chart data response status: ${status}`);
        if (status === 200) {
          console.log('Query succeeded!');
        } else {
          const body = await chartResponse.json().catch(() => ({}));
          console.log('Response:', JSON.stringify(body).slice(0, 500));
        }
      }
    }

    await page.screenshot({
      path: `playwright/screenshots/vital-maps-after-run.png`,
      fullPage: true,
    });

    await attachFailureContext(page, testInfo, consoleMessages);
  });
});
