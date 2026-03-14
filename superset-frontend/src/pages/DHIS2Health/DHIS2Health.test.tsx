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
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockAddDangerToast = jest.fn();
const mockAddSuccessToast = jest.fn();

jest.mock('@superset-ui/core', () => {
  const React = require('react');

  const createStyledComponent = (Component: any) => () =>
    React.forwardRef(({ children, ...props }: any, ref: any) =>
      React.createElement(Component, { ref, ...props }, children),
    );

  return {
    __esModule: true,
    SupersetClient: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    },
    css: () => '',
    styled: new Proxy(createStyledComponent('div'), {
      apply: (_target, _thisArg, argList) => createStyledComponent(argList[0]),
      get: (_target, prop) => createStyledComponent(prop),
    }),
    t: (template: string, ...args: Array<string | number>) =>
      args.reduce<string>(
        (message, arg) => message.replace('%s', String(arg)),
        template,
      ),
  };
});

jest.mock('@superset-ui/core/components', () => ({
  __esModule: true,
  Typography: {
    Title: ({ children }: any) => <h1>{children}</h1>,
    Paragraph: ({ children }: any) => <p>{children}</p>,
    Text: ({ children }: any) => <span>{children}</span>,
  },
  Loading: () => <div>Loading</div>,
}));

jest.mock('src/features/home/SubMenu', () => ({
  __esModule: true,
  default: ({ name, tabs }: any) => (
    <div>
      <div>{name}</div>
      {tabs?.map((tab: any) => (
        <span key={tab.name}>{tab.label}</span>
      ))}
    </div>
  ),
}));

jest.mock('src/components/MessageToasts/withToasts', () => ({
  useToasts: () => ({
    addDangerToast: mockAddDangerToast,
    addSuccessToast: mockAddSuccessToast,
  }),
}));

import { SupersetClient } from '@superset-ui/core';
import DHIS2Health from '.';

const mockClient = SupersetClient as jest.Mocked<typeof SupersetClient>;

beforeEach(() => {
  jest.clearAllMocks();

  mockClient.get.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
    if (endpoint.startsWith('/api/v1/database/')) {
      return {
        json: {
          count: 1,
          result: [
            {
              id: 7,
              database_name: 'DHIS2 Uganda',
              backend: 'dhis2',
            },
          ],
        },
      } as any;
    }
    if (endpoint === '/api/v1/dhis2/diagnostics/admin/summary') {
      return {
        json: {
          total_instances: 3,
          active_instances: 2,
          total_staged_datasets: 4,
          active_staged_datasets: 3,
          datasets_synced_in_24h: 2,
          datasets_never_synced: 1,
          total_sync_jobs: 20,
          failed_sync_jobs_in_24h: 1,
        },
      } as any;
    }
    if (endpoint === '/api/v1/dhis2/diagnostics/health/7') {
      return {
        json: {
          database_id: 7,
          instances: [
            {
              id: 1,
              name: 'Uganda HMIS',
              url: 'https://uganda.example.org',
              is_active: true,
              staged_dataset_count: 2,
            },
          ],
          staged_datasets: [
            {
              id: 11,
              name: 'ANC Coverage',
              is_active: true,
              last_sync_at: '2026-03-12T08:30:00',
              last_sync_status: 'partial',
              last_sync_rows: 120,
              freshness_minutes: 45,
              staging_table_exists: false,
              staging_row_count: 5400,
              recent_jobs: [
                {
                  id: 5,
                  staged_dataset_id: 11,
                  status: 'partial',
                  instance_results: {},
                },
              ],
            },
          ],
          summary: {
            total_instances: 1,
            active_instances: 1,
            total_staged_datasets: 1,
            active_staged_datasets: 1,
            datasets_synced_in_24h: 1,
            datasets_never_synced: 0,
          },
        },
      } as any;
    }
    if (endpoint === '/api/v1/dhis2/diagnostics/stale/7?threshold_hours=25') {
      return {
        json: {
          count: 1,
          result: [
            {
              id: 11,
              name: 'ANC Coverage',
              last_sync_at: '2026-03-11T03:00:00',
              last_sync_status: 'partial',
              freshness_minutes: 1800,
              threshold_hours: 25,
            },
          ],
        },
      } as any;
    }
    throw new Error(`Unexpected GET ${endpoint}`);
  });

  mockClient.post.mockResolvedValue({
    json: {
      result: {
        staging_table_ref: 'dhis2_staging.ds_11_anc_coverage',
      },
    },
  } as any);
});

test('renders health data and can trigger staging table repair', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/health/']}>
      <DHIS2Health />
    </MemoryRouter>,
  );

  expect((await screen.findAllByText('ANC Coverage')).length).toBeGreaterThan(0);
  expect(screen.getByText('System-wide summary')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Repair Table' }));

  await waitFor(() => {
    expect(mockClient.post).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/staged-datasets/11/ensure-table',
      }),
    );
  });
});
