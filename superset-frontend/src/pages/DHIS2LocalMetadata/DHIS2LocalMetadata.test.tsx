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
import DHIS2LocalMetadata from '.';

const mockClient = SupersetClient as jest.Mocked<typeof SupersetClient>;

beforeEach(() => {
  jest.clearAllMocks();

  mockClient.get.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
    if (endpoint.startsWith('/api/v1/database/?q=')) {
      return {
        json: {
          count: 1,
          result: [
            { id: 7, database_name: 'DHIS2 Uganda', backend: 'dhis2' },
          ],
        },
      } as any;
    }
    if (endpoint === '/api/v1/dhis2/diagnostics/metadata-status/7') {
      return {
        json: {
          result: {
            database_id: 7,
            database_name: 'DHIS2 Uganda',
            active_instance_count: 2,
            overall_status: 'ready',
            last_refreshed_at: '2026-03-13T12:00:00',
            variables: {
              status: 'ready',
              count: 42,
              last_refreshed_at: '2026-03-13T12:00:00',
            },
            org_units: {
              status: 'ready',
              count: 18,
              last_refreshed_at: '2026-03-13T12:00:00',
            },
          },
        },
      } as any;
    }
    if (endpoint.includes('/api/v1/database/7/dhis2_metadata/?type=dataElements')) {
      return {
        json: {
          status: 'success',
          result: [
            {
              id: 'de1',
              displayName: 'ANC Visits',
              source_instance_name: 'HMIS-Test',
              groupLabels: ['Maternal Health'],
            },
          ],
        },
      } as any;
    }
    throw new Error(`Unexpected GET ${endpoint}`);
  });

  mockClient.post.mockResolvedValue({ json: { result: { scheduled: true } } } as any);
});

test('renders local metadata status and can request a refresh', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/local-metadata/']}>
      <DHIS2LocalMetadata />
    </MemoryRouter>,
  );

  expect(
    await screen.findByRole('heading', { name: 'Local Metadata' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('ANC Visits')).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', { name: 'Refresh local metadata' }),
  );

  await waitFor(() => {
    expect(mockClient.post).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/diagnostics/metadata-refresh/7',
      }),
    );
  });
});
