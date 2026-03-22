import fetchMock from 'fetch-mock';
import {
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from 'spec/helpers/testing-library';

import WizardStepDataElements from './StepDataElements';

const metadataEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=dataElements&federated=true&staged=true*';
const dataElementGroupsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=dataElementGroups&federated=true&staged=true*';
const dataElementGroupSetsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=dataElementGroupSets&federated=true&staged=true*';

const baseWizardState = {
  datasetName: 'Malaria staging dataset',
  description: '',
  selectedInstanceIds: [101, 102],
  variableMappings: [],
  dataElements: [],
  periods: [],
  orgUnits: [],
  includeChildren: false,
  dataLevelScope: 'selected' as const,
  columns: [],
  previewData: [],
  scheduleConfig: {
    preset: 'daily' as const,
    cron: '0 5 * * *',
    timezone: 'UTC',
  },
};

const instances = [
  {
    id: 101,
    name: 'National eHMIS DHIS2',
    is_active: true,
    database_id: 9,
    database_name: 'Malaria Repository Multiple Sources',
  },
  {
    id: 102,
    name: 'Non Routine DHIS2',
    is_active: true,
    database_id: 9,
    database_name: 'Malaria Repository Multiple Sources',
  },
];

afterEach(() => {
  fetchMock.restore();
});

function mockDefaultDataElementFilterCatalog() {
  fetchMock.get(dataElementGroupsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'grp_1',
        displayName: 'Maternal Health',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
      {
        id: 'grp_2',
        displayName: 'Malaria',
        source_instance_id: 102,
        source_instance_name: 'Non Routine DHIS2',
      },
    ],
  });
  fetchMock.get(dataElementGroupSetsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'gs_1',
        displayName: 'Clinical Domains',
        dataElementGroups: [{ id: 'grp_1', displayName: 'Maternal Health' }],
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
    ],
  });
}

test('toggles the disaggregation dimension setting in wizard state', async () => {
  const updateState = jest.fn();
  mockDefaultDataElementFilterCatalog();
  fetchMock.get(metadataEndpoint, {
    status: 'success',
    result: [],
    instance_results: [],
  });

  render(
    <WizardStepDataElements
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  await userEvent.click(screen.getByRole('switch'));

  expect(updateState).toHaveBeenCalledWith({
    includeDisaggregationDimension: true,
  });
});

test('loads federated variables across configured connections and preserves source lineage', async () => {
  const updateState = jest.fn();
  mockDefaultDataElementFilterCatalog();
  fetchMock.get(metadataEndpoint, {
    status: 'success',
    result: [
      {
        id: 'de1',
        displayName: 'ANC Visits',
        groupLabels: ['Maternal Health'],
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
      {
        id: 'de2',
        displayName: 'Malaria Cases',
        source_instance_id: 102,
        source_instance_name: 'Non Routine DHIS2',
      },
    ],
    instance_results: [
      { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 1 },
      { id: 102, name: 'Non Routine DHIS2', status: 'success', count: 1 },
    ],
  });

  render(
    <WizardStepDataElements
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect((await screen.findAllByText(/National eHMIS DHIS2/i)).length).toBeGreaterThan(0);
  expect((await screen.findAllByText(/Non Routine DHIS2/i)).length).toBeGreaterThan(0);
  expect(await screen.findByText(/Maternal Health/i)).toBeVisible();

  const ancRow = await screen.findByText('ANC Visits');
  expect(
    within(ancRow.closest('button') as HTMLElement).getByText(
      /National eHMIS DHIS2/i,
    ),
  ).toBeVisible();

  await userEvent.click(screen.getByText('ANC Visits'));

  await waitFor(() => {
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({
        variableMappings: [
          expect.objectContaining({
            variableId: 'de1',
            variableName: 'ANC Visits',
            instanceId: 101,
            instanceName: 'National eHMIS DHIS2',
          }),
        ],
      }),
    );
  });
});

test('resolves variable lineage labels from the configured DHIS2 instance list', async () => {
  const updateState = jest.fn();
  mockDefaultDataElementFilterCatalog();
  fetchMock.get(metadataEndpoint, {
    status: 'success',
    result: [
      {
        id: 'de1',
        displayName: 'ANC Visits',
        groupLabels: ['Maternal Health'],
        source_instance_id: 101,
        source_instance_name: 'Malaria Repository Multiple Sources',
      },
    ],
    instance_results: [
      {
        id: 101,
        name: 'Malaria Repository Multiple Sources',
        status: 'success',
        count: 1,
      },
    ],
  });

  render(
    <WizardStepDataElements
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  const ancRow = await screen.findByText('ANC Visits');
  expect(
    within(ancRow.closest('button') as HTMLElement).getByText(
      /National eHMIS DHIS2/i,
    ),
  ).toBeVisible();

  await userEvent.click(ancRow);

  await waitFor(() => {
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({
        variableMappings: [
          expect.objectContaining({
            instanceName: 'National eHMIS DHIS2',
          }),
        ],
      }),
    );
  });
});

test('shows partial-load diagnostics and retries federated variable loading', async () => {
  const updateState = jest.fn();
  mockDefaultDataElementFilterCatalog();
  fetchMock.get(metadataEndpoint, {
    status: 'partial',
    message: 'Some configured DHIS2 connections could not be loaded.',
    result: [
      {
        id: 'de1',
        displayName: 'ANC Visits',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
    ],
    instance_results: [
      { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 1 },
      {
        id: 102,
        name: 'Non Routine DHIS2',
        status: 'failed',
        error: 'DHIS2 API error: 503 Gateway timeout',
      },
    ],
  });

  render(
    <WizardStepDataElements
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByText(/Some configured connections could not be loaded/i),
  ).toBeVisible();
  expect(
    await screen.findByText(/Non Routine DHIS2: DHIS2 API error: 503 Gateway timeout/i),
  ).toBeVisible();

  fetchMock.get(
    metadataEndpoint,
    {
      status: 'success',
      result: [
        {
          id: 'de1',
          displayName: 'ANC Visits',
          source_instance_id: 101,
          source_instance_name: 'National eHMIS DHIS2',
        },
        {
          id: 'de2',
          displayName: 'Malaria Cases',
          source_instance_id: 102,
          source_instance_name: 'Non Routine DHIS2',
        },
      ],
      instance_results: [
        { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 1 },
        { id: 102, name: 'Non Routine DHIS2', status: 'success', count: 1 },
      ],
    },
    { overwriteRoutes: true },
  );

  await userEvent.click(screen.getByRole('button', { name: /^Retry$/i }));

  await waitFor(() => {
    expect(screen.queryByText(/Some configured connections could not be loaded/i)).toBeNull();
  });
  expect(await screen.findByText(/Malaria Cases/i)).toBeVisible();
});

test('shows staged metadata pending state and allows retry', async () => {
  const updateState = jest.fn();
  mockDefaultDataElementFilterCatalog();
  fetchMock.get(metadataEndpoint, {
    status: 'pending',
    message:
      'DHIS2 metadata is being prepared in local staging. Retry shortly or inspect the DHIS2 admin pages for connection diagnostics.',
    result: [],
    instance_results: [
      {
        id: 101,
        name: 'National eHMIS DHIS2',
        status: 'pending',
        error: 'Metadata snapshot not ready yet.',
      },
      {
        id: 102,
        name: 'Non Routine DHIS2',
        status: 'pending',
        error: 'Metadata snapshot not ready yet.',
      },
    ],
  });

  render(
    <WizardStepDataElements
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByText(/Local metadata staging is still running/i),
  ).toBeVisible();
  expect(
    await screen.findByText(/Metadata is still being prepared in local staging/i),
  ).toBeVisible();

  fetchMock.get(
    metadataEndpoint,
    {
      status: 'success',
      result: [
        {
          id: 'de1',
          displayName: 'ANC Visits',
          source_instance_id: 101,
          source_instance_name: 'National eHMIS DHIS2',
        },
      ],
      instance_results: [
        { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 1 },
      ],
    },
    { overwriteRoutes: true },
  );

  await userEvent.click(screen.getByRole('button', { name: /^Retry$/i }));

  expect(await screen.findByText(/ANC Visits/i)).toBeVisible();
});

test('passes typed group search to staged metadata loading', async () => {
  const updateState = jest.fn();
  mockDefaultDataElementFilterCatalog();
  fetchMock.get(metadataEndpoint, {
    status: 'success',
    result: [
      {
        id: 'de1',
        displayName: 'ANC Visits',
        groupLabels: ['Maternal Health'],
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
    ],
    instance_results: [
      { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 1 },
    ],
  });

  render(
    <WizardStepDataElements
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/ANC Visits/i)).toBeVisible();

  await userEvent.type(screen.getByLabelText(/Group Search/i), 'Maternal');

  await waitFor(() => {
    const matchingCall = fetchMock.calls().some(call =>
      String(call[0]).includes('group_search=Maternal'),
    );
    expect(matchingCall).toBe(true);
  });
});

test('supports staged pagination and advances to the next page', async () => {
  const updateState = jest.fn();
  mockDefaultDataElementFilterCatalog();
  fetchMock.get(
    metadataEndpoint,
    (url: string) => {
      const currentPage = url.includes('page=2') ? 2 : 1;
      return {
        status: 'success',
        result:
          currentPage === 1
            ? [
                {
                  id: 'de1',
                  displayName: 'ANC Visits',
                  source_instance_id: 101,
                  source_instance_name: 'National eHMIS DHIS2',
                },
              ]
            : [
                {
                  id: 'de26',
                  displayName: 'Malaria Cases',
                  source_instance_id: 102,
                  source_instance_name: 'Non Routine DHIS2',
                },
              ],
        instance_results: [
          { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 20 },
          { id: 102, name: 'Non Routine DHIS2', status: 'success', count: 20 },
        ],
        pagination: {
          page: currentPage,
          page_size: 25,
          total: 40,
          total_pages: 2,
          has_next: currentPage < 2,
          has_previous: currentPage > 1,
        },
      };
    },
    { overwriteRoutes: true },
  );

  render(
    <WizardStepDataElements
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/Showing 1-25 of 40 variables/i)).toBeVisible();
  expect(await screen.findByText(/Page 1 of 2/i)).toBeVisible();
  expect(await screen.findByText(/ANC Visits/i)).toBeVisible();

  await userEvent.click(screen.getByTitle('Next Page'));

  await waitFor(() => {
    expect(screen.queryByText(/ANC Visits/i)).not.toBeInTheDocument();
  });
  expect(await screen.findByText(/Malaria Cases/i)).toBeVisible();
  expect(await screen.findByText(/Page 2 of 2/i)).toBeVisible();
});

test('passes selected DHIS2 group filters to staged metadata loading', async () => {
  const updateState = jest.fn();
  mockDefaultDataElementFilterCatalog();
  fetchMock.get(
    metadataEndpoint,
    (url: string) => ({
      status: 'success',
      result: url.includes('groupId=grp_1')
        ? [
            {
              id: 'de1',
              displayName: 'ANC Visits',
              groupLabels: ['Maternal Health'],
              source_instance_id: 101,
              source_instance_name: 'National eHMIS DHIS2',
            },
          ]
        : [
            {
              id: 'de1',
              displayName: 'ANC Visits',
              groupLabels: ['Maternal Health'],
              source_instance_id: 101,
              source_instance_name: 'National eHMIS DHIS2',
            },
            {
              id: 'de2',
              displayName: 'Malaria Cases',
              groupLabels: ['Malaria'],
              source_instance_id: 102,
              source_instance_name: 'Non Routine DHIS2',
            },
          ],
      instance_results: [
        { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 1 },
      ],
      pagination: {
        page: 1,
        page_size: 25,
        total: url.includes('groupId=grp_1') ? 1 : 2,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
    }),
    { overwriteRoutes: true },
  );

  render(
    <WizardStepDataElements
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/ANC Visits/i)).toBeVisible();

  const groupSelect = screen.getAllByLabelText(/^Group$/i)[0].closest(
    '.ant-select',
  ) as HTMLElement;
  fireEvent.mouseDown(
    groupSelect.querySelector('.ant-select-selector') as Element,
  );
  await userEvent.click(
    await screen.findByText(/Maternal Health • National eHMIS DHIS2/i),
  );

  await waitFor(() => {
    const matchingCall = fetchMock.calls().some(call =>
      String(call[0]).includes('groupId=grp_1'),
    );
    expect(matchingCall).toBe(true);
  });
  await waitFor(() => {
    expect(screen.queryByText(/Malaria Cases/i)).not.toBeInTheDocument();
  });
  expect(await screen.findByText(/ANC Visits/i)).toBeVisible();
});
