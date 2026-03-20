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

/// <reference types="node" />

// eslint-disable-next-line import/no-extraneous-dependencies
import { defineConfig } from '@playwright/test';

const AUTH_STATE_PATH = 'playwright/.auth/admin.json';

export default defineConfig({
  // Test directory
  testDir: './playwright/tests',

  // Timeout settings
  timeout: 120000,
  expect: { timeout: 15000 },

  // Parallel execution
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,

  // Retry logic - 2 retries in CI, 0 locally
  retries: process.env.CI ? 2 : 0,

  // Reporter configuration - multiple reporters for better visibility
  reporter: process.env.CI
    ? [
        ['github'], // GitHub Actions annotations
        ['list'], // Detailed output with summary table
        ['html', { outputFolder: 'playwright-report', open: 'never' }], // Interactive report
        ['json', { outputFile: 'test-results/results.json' }], // Machine-readable
      ]
    : [
        ['list'], // Shows summary table locally
        ['html', { outputFolder: 'playwright-report', open: 'on-failure' }], // Auto-open on failure
      ],

  // Global test setup
  use: {
    // Use environment variable for base URL in CI, default to localhost:9001 for local
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:9001',

    // Browser settings
    headless:
      process.env.PLAYWRIGHT_HEADLESS === undefined
        ? !!process.env.CI
        : process.env.PLAYWRIGHT_HEADLESS !== 'false',

    viewport: { width: 1400, height: 1000 },

    // Screenshots and videos on failure
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Trace collection for debugging
    trace: 'retain-on-failure',

    launchOptions: {
      env: {
        ...process.env,
        HOME: process.env.PLAYWRIGHT_HOME || '/tmp/playwright-home',
      },
    },
  },

  projects: [
    {
      name: 'auth',
      use: {
        browserName: 'chromium',
        testIdAttribute: 'data-test',
      },
      testMatch: /playwright\/tests\/auth\/.*\.spec\.ts/,
    },
    {
      name: 'setup',
      testMatch: /playwright\/tests\/e2e\/auth\.setup\.ts/,
      use: {
        browserName: 'chromium',
        testIdAttribute: 'data-test',
      },
    },
    {
      name: 'e2e',
      dependencies: ['setup'],
      testIgnore: /playwright\/tests\/e2e\/auth\.setup\.ts/,
      testMatch: /playwright\/tests\/e2e\/.*\.spec\.ts/,
      use: {
        browserName: 'chromium',
        testIdAttribute: 'data-test',
        storageState: AUTH_STATE_PATH,
      },
    },
  ],
});
