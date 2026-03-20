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
import DHIS2LocalData from '.';

const mockClient = SupersetClient as jest.Mocked<typeof SupersetClient>;

beforeEach(() => {
  jest.clearAllMocks();

  mockClient.get.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
    if (endpoint.startsWith('/api/v1/database/')) {
      return {
        json: {
          count: 1,
          result: [{ id: 7, database_name: 'DHIS2 Uganda', backend: 'dhis2' }],
        },
      } as any;
    }
    if (
      endpoint ===
      '/api/v1/dhis2/staged-datasets/?database_id=7&include_inactive=true&include_stats=true'
    ) {
      return {
        json: {
          result: [
            {
              id: 11,
              database_id: 7,
              name: 'ANC Coverage',
              description: 'Main ANC dataset',
              is_active: true,
              last_sync_status: 'success',
              last_sync_at: '2026-03-13T12:00:00',
              staging_table_ref: 'dhis2_staging.ds_11_anc_coverage',
              serving_table_ref: 'dhis2_staging.sv_11_anc_coverage',
              serving_database_id: 13,
              serving_database_name: 'main',
              serving_columns: [
                {
                  column_name: 'region',
                  verbose_name: 'Region',
                  extra: '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 2}',
                },
                {
                  column_name: 'district',
                  verbose_name: 'District',
                  extra: '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 3}',
                },
                {
                  column_name: 'period',
                  verbose_name: 'Period',
                  extra: '{"dhis2_is_period": true}',
                },
                { column_name: 'anc_1st_visit', verbose_name: 'ANC 1st Visit' },
              ],
              stats: { total_rows: 2500 },
            },
          ],
        },
      } as any;
    }
    if (endpoint.startsWith('/api/v1/dhis2/staged-datasets/11/preview?limit=')) {
      const limit = Number(endpoint.split('limit=')[1] || 25);
      return {
        json: {
          result: {
            columns: ['source_instance_id', 'ou_name', 'pe', 'value'],
            rows: [
              {
                source_instance_id: 1,
                ou_name: 'Gulu Referral Hospital',
                pe: '2024Q1',
                value: 37,
              },
            ],
            limit,
            staging_table_ref: 'dhis2_staging.ds_11_anc_coverage',
            serving_table_ref: 'dhis2_serving.sv_11_anc_coverage',
            diagnostics: {
              table_exists: true,
              row_count: 2500,
              sql_preview:
                `SELECT * FROM dhis2_staging.ds_11_anc_coverage ` +
                'ORDER BY "source_instance_id", "pe", "dx_uid", "ou" ' +
                `LIMIT ${limit}`,
              rows_returned: 1,
              org_unit_columns: ['ou', 'ou_name', 'ou_level'],
              period_columns: ['pe'],
            },
          },
        },
      } as any;
    }
    throw new Error(`Unexpected GET ${endpoint}`);
  });

  mockClient.post.mockImplementation(
    async ({
      endpoint,
      jsonPayload,
    }: {
      endpoint: string;
      jsonPayload?: Record<string, any>;
    }) => {
    if (endpoint === '/api/v1/dhis2/staged-datasets/11/filters') {
      const filters = jsonPayload?.filters || [];
      const regionFilter = filters.find(
        (filter: Record<string, unknown>) => filter.column === 'region',
      );
      const districtFilter = filters.find(
        (filter: Record<string, unknown>) => filter.column === 'district',
      );
      return {
        json: {
          result: {
            org_unit_filters: [
              {
                column_name: 'region',
                verbose_name: 'Region',
                level: 2,
                options: [
                  { label: 'Acholi', value: 'Acholi', row_count: 50 },
                  { label: 'Central', value: 'Central', row_count: 90 },
                ],
              },
              {
                column_name: 'district',
                verbose_name: 'District',
                level: 3,
                options:
                  regionFilter?.value === 'Acholi'
                    ? [
                        { label: 'Gulu', value: 'Gulu', row_count: 25 },
                        { label: 'Kitgum', value: 'Kitgum', row_count: 25 },
                      ]
                    : [
                        { label: 'Gulu', value: 'Gulu', row_count: 25 },
                        { label: 'Kampala', value: 'Kampala', row_count: 65 },
                      ],
              },
            ],
            period_filter: {
              column_name: 'period',
              verbose_name: 'Period',
              options:
                districtFilter?.value === 'Gulu' || regionFilter?.value === 'Acholi'
                  ? [{ label: '2024Q1', value: '2024Q1', row_count: 25 }]
                  : [
                      { label: '2024Q1', value: '2024Q1', row_count: 50 },
                      { label: '2024Q2', value: '2024Q2', row_count: 51 },
                    ],
            },
          },
        },
      } as any;
    }
    if (endpoint === '/api/v1/dhis2/staged-datasets/11/query') {
      const page = Number(jsonPayload?.page || 1);
      const filters = jsonPayload?.filters || [];
      const hasCascadedFilters =
        filters.some(
          (filter: Record<string, unknown>) =>
            filter.column === 'region' && filter.value === 'Acholi',
        ) &&
        filters.some(
          (filter: Record<string, unknown>) =>
            filter.column === 'district' && filter.value === 'Gulu',
        ) &&
        filters.some(
          (filter: Record<string, unknown>) =>
            filter.column === 'period' &&
            Array.isArray(filter.value) &&
            filter.value.includes('2024Q1'),
        );
      return {
        json: {
          result: {
            columns: ['period', 'district', 'anc_1st_visit'],
            rows:
              hasCascadedFilters
                ? [
                    {
                      period: '2024Q1',
                      district: 'Gulu',
                      anc_1st_visit: 25,
                    },
                  ]
                : page === 2
                  ? [
                      {
                        period: '2024Q2',
                        district: 'Gulu',
                        anc_1st_visit: 18,
                      },
                    ]
                  : [
                      {
                        period: '2024Q1',
                        district: 'Kampala',
                        anc_1st_visit: 12,
                      },
                    ],
            limit: 100,
            page,
            total_pages: 2,
            total_rows: hasCascadedFilters ? 1 : 101,
            serving_table_ref: 'dhis2_staging.sv_11_anc_coverage',
            sql_preview:
              hasCascadedFilters
                ? 'SELECT "period", "district", "anc_1st_visit" FROM dhis2_staging.sv_11_anc_coverage WHERE "region" = \'Acholi\' AND "district" = \'Gulu\' AND "period" IN (\'2024Q1\') LIMIT 100'
                : page === 2
                ? 'SELECT "period", "district", "anc_1st_visit" FROM dhis2_staging.sv_11_anc_coverage LIMIT 100 OFFSET 100'
                : 'SELECT "period", "district", "anc_1st_visit" FROM dhis2_staging.sv_11_anc_coverage LIMIT 100',
          },
        },
      } as any;
    }
    if (endpoint === '/api/v1/dhis2/sync/trigger/11') {
      return {
        json: {
          result: {
            job_id: 55,
            status: 'running',
          },
        },
      } as any;
    }
    if (endpoint === '/api/v1/dhis2/staged-datasets/11/cleanup') {
      return {
        json: {
          result: {
            dataset_id: 11,
            total_rows: 0,
          },
        },
      } as any;
    }
    throw new Error(`Unexpected POST ${endpoint}`);
    },
  );

  mockClient.delete.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
    if (endpoint === '/api/v1/dhis2/staged-datasets/11') {
      return {
        json: {
          message: 'Deleted',
        },
      } as any;
    }
    throw new Error(`Unexpected DELETE ${endpoint}`);
  });
});

test('renders visible dataset actions and can query local staged data', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/local-data/']}>
      <DHIS2LocalData />
    </MemoryRouter>,
  );

  expect((await screen.findAllByText('ANC Coverage')).length).toBeGreaterThan(0);
  expect(
    screen.getByRole('button', { name: 'Load data' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Download CSV' }),
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole('button', { name: 'Refresh now' })[0],
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole('button', { name: 'Clear local data' })[0],
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole('button', { name: 'Delete dataset' })[0],
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Load data' }));

  await waitFor(() => {
    expect(mockClient.post).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/staged-datasets/11/query',
      }),
    );
  });

  expect(await screen.findByText('Kampala')).toBeInTheDocument();
  expect(
    screen.getByDisplayValue(
      'SELECT "period", "district", "anc_1st_visit" FROM dhis2_staging.sv_11_anc_coverage LIMIT 100',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Run query' }),
  ).toBeInTheDocument();
});

test('loads raw staged preview rows and diagnostics for the selected dataset', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/local-data/']}>
      <DHIS2LocalData />
    </MemoryRouter>,
  );

  expect((await screen.findAllByText('ANC Coverage')).length).toBeGreaterThan(0);

  await waitFor(() => {
    expect(mockClient.get).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/staged-datasets/11/preview?limit=25',
      }),
    );
  });

  expect(await screen.findByText('Gulu Referral Hospital')).toBeInTheDocument();
  expect(screen.getByText('Staging table detected')).toBeInTheDocument();
  expect(screen.getByText('Staging rows: 2,500')).toBeInTheDocument();
  expect(screen.getByText('Preview rows returned: 1')).toBeInTheDocument();
  expect(
    screen.getByText('Org unit columns: ou, ou_name, ou_level'),
  ).toBeInTheDocument();
  expect(screen.getByText('Period columns: pe')).toBeInTheDocument();
  expect(
    screen.getByDisplayValue(
      'SELECT * FROM dhis2_staging.ds_11_anc_coverage ORDER BY "source_instance_id", "pe", "dx_uid", "ou" LIMIT 25',
    ),
  ).toBeInTheDocument();
});

test('applies staged local org-unit cascade and period filters to the query', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/local-data/']}>
      <DHIS2LocalData />
    </MemoryRouter>,
  );

  expect((await screen.findAllByText('ANC Coverage')).length).toBeGreaterThan(0);

  await userEvent.click(screen.getAllByRole('combobox', { name: 'Region' })[0]);
  await userEvent.click(await screen.findByText('Acholi (50)'));

  await userEvent.click(screen.getAllByRole('combobox', { name: 'District' })[0]);
  await userEvent.click(await screen.findByText('Gulu (25)'));

  await userEvent.click(screen.getAllByRole('combobox', { name: 'Period' })[0]);
  await userEvent.click(await screen.findByText('2024Q1 (25)'));

  await userEvent.click(screen.getByRole('button', { name: 'Load data' }));

  await waitFor(() => {
    expect(mockClient.post).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/staged-datasets/11/query',
        jsonPayload: expect.objectContaining({
          filters: expect.arrayContaining([
            { column: 'region', operator: 'eq', value: 'Acholi' },
            { column: 'district', operator: 'eq', value: 'Gulu' },
            { column: 'period', operator: 'in', value: ['2024Q1'] },
          ]),
        }),
      }),
    );
  });

  expect((await screen.findAllByText('Gulu')).length).toBeGreaterThan(0);
  expect(
    screen.getByDisplayValue(
      'SELECT "period", "district", "anc_1st_visit" FROM dhis2_staging.sv_11_anc_coverage WHERE "region" = \'Acholi\' AND "district" = \'Gulu\' AND "period" IN (\'2024Q1\') LIMIT 100',
    ),
  ).toBeInTheDocument();
});

test('runs the generated sql and re-queries paginated results', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/local-data/']}>
      <DHIS2LocalData />
    </MemoryRouter>,
  );

  expect((await screen.findAllByText('ANC Coverage')).length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole('button', { name: 'Run query' }));

  await waitFor(() => {
    expect(mockClient.post).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/staged-datasets/11/query',
        jsonPayload: expect.objectContaining({
          limit: 100,
          page: 1,
        }),
      }),
    );
  });

  expect(await screen.findByText('Kampala')).toBeInTheDocument();

  await userEvent.click(screen.getByTitle('2'));

  await waitFor(() => {
    expect(mockClient.post).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/staged-datasets/11/query',
        jsonPayload: expect.objectContaining({
          limit: 100,
          page: 2,
        }),
      }),
    );
  });

  expect(await screen.findByText('Gulu')).toBeInTheDocument();
  expect(
    screen.getByDisplayValue(
      'SELECT "period", "district", "anc_1st_visit" FROM dhis2_staging.sv_11_anc_coverage LIMIT 100 OFFSET 100',
    ),
  ).toBeInTheDocument();
});

test('starts a manual refresh from the visible action bar', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/local-data/']}>
      <DHIS2LocalData />
    </MemoryRouter>,
  );

  expect((await screen.findAllByText('ANC Coverage')).length).toBeGreaterThan(0);
  await userEvent.click(screen.getAllByRole('button', { name: 'Refresh now' })[0]);

  await waitFor(() => {
    expect(mockClient.post).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/sync/trigger/11',
      }),
    );
  });

  expect(mockAddSuccessToast).toHaveBeenCalledWith(
    'Refresh now started for ANC Coverage. Job 55 is now running.',
  );
});

test('clears local staged rows without deleting the dataset definition', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/local-data/']}>
      <DHIS2LocalData />
    </MemoryRouter>,
  );

  expect((await screen.findAllByText('ANC Coverage')).length).toBeGreaterThan(0);
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Clear local data' })[0],
  );
  expect(
    await screen.findByText('Clear locally staged rows for ANC Coverage?'),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Yes, clear local data' }),
  );

  await waitFor(() => {
    expect(mockClient.post).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/staged-datasets/11/cleanup',
      }),
    );
  });

  expect(mockAddSuccessToast).toHaveBeenCalledWith(
    'Cleared local staged data for ANC Coverage. Variable mappings and dataset settings were preserved.',
  );
});

test('deletes the staged dataset and local tables from the workspace', async () => {
  render(
    <MemoryRouter initialEntries={['/superset/dhis2/local-data/']}>
      <DHIS2LocalData />
    </MemoryRouter>,
  );

  expect((await screen.findAllByText('ANC Coverage')).length).toBeGreaterThan(0);
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Delete dataset' })[0],
  );
  expect(await screen.findByText('Delete ANC Coverage?')).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Yes, delete dataset' }),
  );

  await waitFor(() => {
    expect(mockClient.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/dhis2/staged-datasets/11',
      }),
    );
  });

  expect(mockAddSuccessToast).toHaveBeenCalledWith(
    'Deleted ANC Coverage and removed its local staged data and serving tables.',
  );
});
