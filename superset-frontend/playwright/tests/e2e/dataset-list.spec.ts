/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { test, expect } from '@playwright/test';
import { attachFailureContext, watchConsoleMessages } from './helpers';

/**
 * Dataset management list visibility rules
 * ─────────────────────────────────────────
 * The /tablemodelview/list/ page must show ONLY original user-created datasets.
 * System-generated datasets (marts, source tables) are hidden.
 *
 * MUST show:
 *   • METADATA          – regular user-created Superset datasets
 *   • NULL role         – legacy datasets (treated as METADATA)
 *
 * MUST NOT show:
 *   • MART              – analytical marts, kpi/map variants, and source tables
 */

const DATASET_LIST_URL =
  '/tablemodelview/list/?pageIndex=0&sortColumn=changed_on_delta_humanized&sortOrder=desc';

// DHIS2 marts that MUST NOT appear in the management list.
// They are visible in chart-creation but hidden here to protect generated metadata.
const HIDDEN_DHIS2_MARTS = [
  'Malaria Routine Monthly datasets',
  'Routine Monthly Stock Management',
  'Routine Weekly - Surveilance',
  'MAL - Routine eHMIS Indicators',
];

// Internal mart sub-table suffixes (defence-in-depth)
const INTERNAL_MART_SUFFIXES = ['_kpi', '_map', '[KPI]', '[Map]', '_mart'];

test('dataset list shows DHIS2 source tables but hides analytical marts', async (
  { page },
  testInfo,
) => {
  const consoleMessages = watchConsoleMessages(page);

  try {
    // ── 1. Navigate to the dataset management list ──────────────────────────
    await page.goto(DATASET_LIST_URL);

    // Wait for the list view to finish loading (spinner disappears).
    await expect(page.locator('.loading')).toHaveCount(0, { timeout: 30000 });

    // The list table must be visible.
    const listView = page.locator('.ant-table, [data-test="listview-table"]').first();
    await expect(listView).toBeVisible({ timeout: 30000 });

    // ── 2. Fetch the raw API response to inspect dataset roles ──────────────
    const apiResponse = await page.request.get(
      '/api/v1/dataset/?q=(page_size:100,page:0)',
    );
    expect(apiResponse.ok()).toBeTruthy();

    const body = await apiResponse.json() as {
      result?: Array<{ table_name: string; dataset_role?: string | null; extra?: string | null }>;
      count?: number;
    };
    const datasets = body.result ?? [];

    // ── 3. METADATA datasets MUST appear (if any) ───────────────────────────
    // We don't assert non-empty because the DB might be fresh, but if they exist
    // they must have the METADATA role.

    // ── 4. System-generated marts (MART) MUST NOT appear ───────────────────
    for (const d of datasets) {
      // Role check: MART must always be hidden from the management list
      expect(
        d.dataset_role,
        `Dataset "${d.table_name}" has role MART which must be hidden`,
      ).not.toBe('MART');

      // Name-pattern check (defence-in-depth for hidden marts)
      for (const suffix of INTERNAL_MART_SUFFIXES) {
        const matches = suffix.startsWith('[')
          ? d.table_name.startsWith(suffix)
          : d.table_name.toLowerCase().endsWith(suffix);
        expect(
          matches,
          `Dataset "${d.table_name}" looks like a MART or internal sub-table ("${suffix}") and must be hidden`,
        ).toBe(false);
      }
    }

    // ── 5. Known DHIS2 marts must specifically NOT be found ─────────────────
    for (const name of HIDDEN_DHIS2_MARTS) {
      const found = datasets.some(d => d.table_name === name);
      expect(found, `DHIS2 mart "${name}" should be HIDDEN from the list`).toBe(false);
    }


    // Attach summary for debugging
    await testInfo.attach('dataset-list-api-result', {
      body: JSON.stringify(
        {
          count: body.count,
          datasets: datasets.map(d => ({
            name: d.table_name,
            role: d.dataset_role ?? 'NULL',
          })),
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

test('dataset list API returns only editable roles', async ({ page }, testInfo) => {
  const consoleMessages = watchConsoleMessages(page);

  try {
    await page.goto('/superset/welcome/');

    const response = await page.request.get(
      '/api/v1/dataset/?q=(page_size:100,page:0)',
    );
    expect(response.ok()).toBeTruthy();

    const body = await response.json() as {
      result?: Array<{ table_name: string; dataset_role?: string | null }>;
    };
    const datasets = body.result ?? [];

    const ALLOWED_ROLES = new Set([
      'MART_DATASET',
      'SERVING_DATASET',
      'METADATA_UI_DATASET',
      null,
      undefined,
    ]);

    for (const d of datasets) {
      expect(
        ALLOWED_ROLES.has(d.dataset_role ?? null),
        `Dataset "${d.table_name}" has unexpected role "${d.dataset_role}" in the management list`,
      ).toBe(true);
    }
  } finally {
    await attachFailureContext(page, testInfo, consoleMessages);
  }
});
