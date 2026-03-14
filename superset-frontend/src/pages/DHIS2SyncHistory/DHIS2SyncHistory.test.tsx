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
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockAddDangerToast = jest.fn();

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
  }),
}));

import { SupersetClient } from '@superset-ui/core';
import DHIS2SyncHistory from '.';

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
    if (endpoint === '/api/v1/dhis2/diagnostics/sync-history/7?limit=50') {
      return {
        json: {
          count: 1,
          result: [
            {
              id: 91,
              staged_dataset_id: 11,
              staged_dataset_name: 'ANC Coverage',
              job_type: 'manual',
              status: 'partial',
              started_at: '2026-03-12T08:00:00',
              completed_at: '2026-03-12T08:05:00',
              duration_seconds: 300,
              rows_loaded: 120,
              rows_failed: 10,
              error_message: 'Instance 2 timed out',
              instance_results: {
                '1': { status: 'success', rows: 120, error: null },
                '2': { status: 'failed', rows: 0, error: 'Timeout' },
              },
            },
          ],
        },
      } as any;
    }
    throw new Error(`Unexpected GET ${endpoint}`);
  });
});

test('renders the sync history table with dataset names and instance results', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/sync-history/']}>
      <DHIS2SyncHistory />
    </MemoryRouter>,
  );

  expect(await screen.findByText('ANC Coverage')).toBeInTheDocument();
  expect(screen.getByText('partial')).toBeInTheDocument();
  expect(screen.getByText('1: success')).toBeInTheDocument();
  expect(screen.getByText('2: failed')).toBeInTheDocument();
});
