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

jest.mock('file-saver', () => ({
  saveAs: jest.fn(),
}));

jest.mock('xlsx', () => ({
  utils: {
    json_to_sheet: jest.fn(),
    book_new: jest.fn(),
    book_append_sheet: jest.fn(),
  },
  write: jest.fn(),
}));

import { SupersetClient } from '@superset-ui/core';
import DHIS2Downloads from '.';

const mockClient = SupersetClient as jest.Mocked<typeof SupersetClient>;

beforeEach(() => {
  jest.clearAllMocks();

  mockClient.get.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
    if (endpoint.startsWith('/api/v1/database/')) {
      return {
        json: {
          count: 1,
          result: [{ id: 5, database_name: 'DHIS2 Uganda', backend: 'dhis2' }],
        },
      } as any;
    }

    if (endpoint === '/api/v1/dhis2/staged-datasets/?database_id=5&include_stats=true') {
      return {
        json: {
          result: [
            {
              id: 7,
              name: 'MAL - Routine eHMIS Indicators',
              description: 'Indicator serving dataset',
              is_active: true,
              last_sync_at: '2026-03-28T04:46:51',
              serving_columns: [
                { column_name: 'period' },
                { column_name: 'value' },
              ],
              stats: {
                total_rows: 0,
                serving_total_rows: 8364,
              },
            },
          ],
        },
      } as any;
    }

    throw new Error(`Unexpected GET ${endpoint}`);
  });
});

test('renders serving row counts and last sync timestamp on downloads page', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/downloads/']}>
      <DHIS2Downloads />
    </MemoryRouter>,
  );

  expect(
    await screen.findByText('MAL - Routine eHMIS Indicators'),
  ).toBeInTheDocument();
  expect(screen.getByText('8,364')).toBeInTheDocument();
  expect(screen.getByText('2026-03-28 04:46:51')).toBeInTheDocument();
  expect(screen.getByText('Downloadable rows')).toBeInTheDocument();
});
