import { expect, test } from '@playwright/test';

import { ROUTES, attachFailureContext, watchConsoleMessages } from './helpers';

/**
 * Public Dashboard Layout Tests
 *
 * Verifies that the public dashboard header and filter bar render
 * correctly without unnecessary wrapper gaps, and that the filter
 * drawer opens/closes properly.
 */

/** Navigate to a public dashboard via the portal's dashboard selector */
async function navigateToPublicDashboard(page: import('@playwright/test').Page) {
  await page.goto(ROUTES.publicPortal);

  // Wait for the portal page to finish loading (look for any nav/header element)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  // Take a diagnostic screenshot so we can see the portal state
  await page.screenshot({
    path: 'playwright/screenshots/portal-loaded.png',
    fullPage: false,
  });

  // Strategy: find the Ant Select dashboard picker and select the first dashboard.
  // The portal nav has a "Select a Dashboard" label next to an Ant Select dropdown.
  // The Ant Select renders as .ant-select with a placeholder "Search dashboards..."
  const antSelect = page.locator('.ant-select').first();
  await expect(antSelect).toBeVisible({ timeout: 15000 });
  await antSelect.click();

  // Wait for dropdown options to appear
  const firstOption = page
    .locator('.ant-select-dropdown .ant-select-item-option')
    .first();
  await expect(firstOption).toBeVisible({ timeout: 10000 });
  await firstOption.click();

  // Wait for the dashboard to load — either the header container or a loading spinner
  await page
    .locator('[data-test="dashboard-header-container"]')
    .waitFor({ state: 'visible', timeout: 60000 });
}

test.describe('Public Dashboard Header & Filter Bar', () => {
  test('dashboard header renders without unnecessary wrapper gaps', async ({
    page,
  }, testInfo) => {
    const consoleMessages = watchConsoleMessages(page);

    try {
      await navigateToPublicDashboard(page);

      const headerContainer = page.locator(
        '[data-test="dashboard-header-container"]',
      );
      await expect(headerContainer).toBeVisible({ timeout: 30000 });

      // CRITICAL: In public view, there should be NO dragdroppable wrappers
      // around the header. The fix renders the header directly (no Droppable).
      const headerParent = page.locator(
        '.dragdroppable:has([data-test="dashboard-header-container"])',
      );
      const parentCount = await headerParent.count();
      expect(parentCount).toBe(0);

      // Verify header has no unexpected top margin/gap
      const headerBox = await headerContainer.boundingBox();
      expect(headerBox).toBeTruthy();
      if (headerBox) {
        // Header should be near the top (below portal nav ~52px + padding)
        expect(headerBox.y).toBeLessThan(200);
      }

      // Verify the dashboard title is visible
      const titleInput = headerContainer.locator(
        '[data-test="editable-title-input"], .dynamic-title-input',
      );
      await expect(titleInput).toBeVisible({ timeout: 10000 });

      // Verify the title has proper styling (bold)
      const titleFontWeight = await titleInput.evaluate(
        el => getComputedStyle(el).fontWeight,
      );
      expect(
        titleFontWeight === '700' || titleFontWeight === 'bold',
      ).toBeTruthy();

      // Verify no double borders or extra spacing between header and content
      const headerBottom = headerBox ? headerBox.y + headerBox.height : 0;
      const contentArea = page.locator(
        '[data-test="dashboard-content-wrapper"], .dashboard-content',
      );
      if (await contentArea.isVisible({ timeout: 5000 }).catch(() => false)) {
        const contentBox = await contentArea.boundingBox();
        if (contentBox && headerBox) {
          const gap = contentBox.y - headerBottom;
          expect(gap).toBeLessThan(20);
        }
      }

      await page.screenshot({
        path: 'playwright/screenshots/public-dashboard-header.png',
        fullPage: false,
      });
    } finally {
      await attachFailureContext(page, testInfo, consoleMessages);
    }
  });

  test('filter drawer button and drawer work correctly', async ({
    page,
  }, testInfo) => {
    const consoleMessages = watchConsoleMessages(page);

    try {
      await navigateToPublicDashboard(page);

      const headerContainer = page.locator(
        '[data-test="dashboard-header-container"]',
      );
      await expect(headerContainer).toBeVisible({ timeout: 30000 });

      // Find the Filters button in the header
      const filtersBtn = page.getByRole('button', { name: /Filters/i });
      // Filters button may not exist if no native filters are configured
      const hasFilters = await filtersBtn
        .isVisible({ timeout: 10000 })
        .catch(() => false);

      if (hasFilters) {
        // Verify Filters button is positioned in the header area
        const btnBox = await filtersBtn.boundingBox();
        const headerBox = await headerContainer.boundingBox();
        if (btnBox && headerBox) {
          // Button should be vertically near the header
          expect(btnBox.y).toBeGreaterThanOrEqual(headerBox.y - 10);
          expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(
            headerBox.y + headerBox.height + 10,
          );
        }

        // Click the Filters button to open the drawer
        await filtersBtn.click();

        // Verify the filter drawer opens
        const drawer = page.locator(
          '.pro-filter-drawer, .ant-drawer-content-wrapper',
        );
        await expect(drawer.first()).toBeVisible({ timeout: 10000 });

        // Close the drawer
        const closeBtn = page.locator('.ant-drawer-close').first();
        if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await closeBtn.click();
        } else {
          await page.keyboard.press('Escape');
        }

        // Wait for close animation
        await page.waitForTimeout(500);
      }

      await page.screenshot({
        path: 'playwright/screenshots/public-dashboard-filters.png',
        fullPage: false,
      });
    } finally {
      await attachFailureContext(page, testInfo, consoleMessages);
    }
  });

  test('header has no vertical gaps between portal nav and dashboard header', async ({
    page,
  }, testInfo) => {
    const consoleMessages = watchConsoleMessages(page);

    try {
      await navigateToPublicDashboard(page);

      // Measure gaps using JavaScript evaluation
      const layoutMetrics = await page.evaluate(() => {
        const header = document.querySelector(
          '[data-test="dashboard-header-container"]',
        );
        if (!header) return null;

        const headerRect = header.getBoundingClientRect();

        // Walk up ancestors looking for dragdroppable wrappers
        let wrapperCount = 0;
        let el: HTMLElement | null = header as HTMLElement;
        const wrapperClasses: string[] = [];
        while (el && wrapperCount < 10) {
          if (
            el.classList.contains('dragdroppable') ||
            el.classList.contains('dragdroppable-column')
          ) {
            wrapperClasses.push(el.className);
          }
          el = el.parentElement;
          wrapperCount++;
        }

        // Check computed margins/paddings on header and its parent
        const headerStyles = getComputedStyle(header);
        const parentStyles = header.parentElement
          ? getComputedStyle(header.parentElement)
          : null;

        // Find the portal header (fixed at top) to measure the gap
        const portalHeader = document.querySelector('header');
        const portalHeaderBottom = portalHeader
          ? portalHeader.getBoundingClientRect().bottom
          : 0;

        return {
          headerTop: headerRect.top,
          headerHeight: headerRect.height,
          headerMarginTop: headerStyles.marginTop,
          headerPaddingTop: headerStyles.paddingTop,
          parentMarginTop: parentStyles?.marginTop || 'N/A',
          parentPaddingTop: parentStyles?.paddingTop || 'N/A',
          dragdroppableWrappers: wrapperClasses,
          wrapperCount: wrapperClasses.length,
          portalHeaderBottom,
          gapBetweenHeaders: headerRect.top - portalHeaderBottom,
        };
      });

      expect(layoutMetrics).toBeTruthy();
      if (layoutMetrics) {
        // No dragdroppable wrappers should exist around the public header
        expect(layoutMetrics.wrapperCount).toBe(0);

        // Header should not have excessive top margin
        const marginTop = parseInt(layoutMetrics.headerMarginTop, 10) || 0;
        expect(marginTop).toBeLessThanOrEqual(2);

        // Header height should be reasonable (40-80px)
        expect(layoutMetrics.headerHeight).toBeGreaterThan(30);
        expect(layoutMetrics.headerHeight).toBeLessThan(80);

        // Gap between portal nav bottom and dashboard header top should be minimal
        // Allow up to 10px for borders/shadows
        expect(layoutMetrics.gapBetweenHeaders).toBeLessThan(10);
      }

      await page.screenshot({
        path: 'playwright/screenshots/public-dashboard-layout.png',
        fullPage: true,
      });
    } finally {
      await attachFailureContext(page, testInfo, consoleMessages);
    }
  });
});
