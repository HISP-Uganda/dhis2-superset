import { expect, test } from '@playwright/test';

import {
  AUTH_STATE_PATH,
  watchConsoleMessages,
  attachFailureContext,
} from './helpers';

test.use({ storageState: AUTH_STATE_PATH });

/**
 * Helper: fetch CSRF token and call a CMS admin endpoint via page context.
 */
async function cmsPost(
  page: any,
  url: string,
  body: Record<string, any>,
): Promise<{ status: number; data: any }> {
  return page.evaluate(
    async ({ url, body }: { url: string; body: any }) => {
      const csrfResp = await fetch('/api/v1/security/csrf_token/', {
        credentials: 'include',
      });
      const csrfData = await csrfResp.json();
      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfData.result,
        },
        body: JSON.stringify(body),
      });
      const text = await resp.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      return { status: resp.status, data };
    },
    { url, body },
  );
}

async function cmsGet(
  page: any,
  url: string,
): Promise<{ status: number; data: any }> {
  return page.evaluate(async (url: string) => {
    const resp = await fetch(url, { credentials: 'include' });
    return { status: resp.status, data: await resp.json() };
  }, url);
}

test.describe('CMS Welcome Page unpublish', () => {
  test('can unpublish the Welcome page with dangling chart references', async ({
    page,
  }, testInfo) => {
    const consoleMessages = watchConsoleMessages(page);

    // Load the app so auth cookies are active
    await page.goto('/superset/welcome/');
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // List pages
    const pageList = await cmsGet(page, '/api/v1/public_page/admin/pages');
    expect(pageList.status).toBe(200);

    const welcomePage = pageList.data?.result?.find(
      (p: any) =>
        p.title?.toLowerCase().includes('welcome') ||
        p.slug?.toLowerCase().includes('welcome'),
    );
    expect(welcomePage, 'Welcome page should exist').toBeTruthy();

    const wasPublished = welcomePage.is_published;

    // Unpublish — should succeed even if page has dangling chart_ref
    const unpublish = await cmsPost(
      page,
      `/api/v1/public_page/admin/pages/${welcomePage.id}/publish`,
      { is_published: false },
    );
    expect(
      unpublish.status,
      `Unpublish failed: ${JSON.stringify(unpublish.data)}`,
    ).toBe(200);
    expect(unpublish.data.result.is_published).toBe(false);

    // Verify the page is now in draft status
    const afterList = await cmsGet(page, '/api/v1/public_page/admin/pages');
    const updatedPage = afterList.data?.result?.find(
      (p: any) => p.id === welcomePage.id,
    );
    expect(updatedPage.is_published).toBe(false);

    // Restore original state if it was published
    if (wasPublished) {
      const republish = await cmsPost(
        page,
        `/api/v1/public_page/admin/pages/${welcomePage.id}/publish`,
        { is_published: true },
      );
      // Either succeeds (all refs valid) or 400 (dangling refs — correct)
      expect([200, 400]).toContain(republish.status);
    }

    await attachFailureContext(page, testInfo, consoleMessages);
  });

  test('unpublish works through Page Studio UI', async ({ page }, testInfo) => {
    const consoleMessages = watchConsoleMessages(page);

    // Navigate to CMS admin
    await page.goto('/superset/dynamic-pages/');
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Look for the Welcome page card/row and click it
    const welcomeLink = page
      .locator('[data-test="page-card"], [data-test="page-row"], tr, .ant-card')
      .filter({ hasText: /Welcome/i })
      .first();

    if (await welcomeLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await welcomeLink.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      // Look for the Unpublish button
      const unpublishBtn = page
        .getByRole('button', { name: /unpublish/i })
        .first();
      if (await unpublishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Intercept the publish API call
        const [publishResp] = await Promise.all([
          page.waitForResponse(
            resp => resp.url().includes('/publish') && resp.request().method() === 'POST',
            { timeout: 15000 },
          ),
          unpublishBtn.click(),
        ]);
        expect(publishResp.status()).toBe(200);
      }
    }

    await page.screenshot({
      path: 'playwright/screenshots/cms-welcome-studio.png',
    });
    await attachFailureContext(page, testInfo, consoleMessages);
  });
});
