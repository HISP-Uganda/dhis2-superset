import fetchMock from 'fetch-mock';
import { fireEvent } from '@testing-library/react';
import { render, screen, userEvent, waitFor } from 'spec/helpers/testing-library';

import WizardStepOrgUnits from './StepOrgUnits';

const orgUnitsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnits*&staged=true*';
const orgUnitLevelsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitLevels*&staged=true*';
const orgUnitGroupsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroups*&staged=true*';
const primaryOrgUnitsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnits*&org_unit_source_mode=primary&primary_instance_id=101&staged=true*';
const primaryOrgUnitLevelsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitLevels*&org_unit_source_mode=primary&primary_instance_id=101&staged=true*';
const primaryOrgUnitGroupsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroups*&org_unit_source_mode=primary&primary_instance_id=101&staged=true*';
const perInstanceOrgUnitsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnits*&org_unit_source_mode=per_instance&staged=true*';
const perInstanceOrgUnitLevelsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitLevels*&org_unit_source_mode=per_instance&staged=true*';
const perInstanceOrgUnitGroupsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroups*&org_unit_source_mode=per_instance&staged=true*';

const instances = [
  {
    id: 101,
    name: 'National eHMIS DHIS2',
    is_active: true,
  },
  {
    id: 102,
    name: 'Non Routine DHIS2',
    is_active: true,
  },
];

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
  levelMapping: {
    enabled: true,
    rows: [
      {
        merged_level: 1,
        label: 'National',
        instance_levels: {
          '101': 1,
          '102': 1,
        },
      },
      {
        merged_level: 2,
        label: 'District',
        instance_levels: {
          '101': 2,
          '102': 2,
        },
      },
    ],
  },
};

afterEach(() => {
  fetchMock.restore();
});

test('loads federated organisation units across selected configured connections', async () => {
  const updateState = jest.fn();

  fetchMock.get(orgUnitsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'OU_1',
        displayName: 'Uganda',
        level: 1,
      },
      {
        id: 'OU_2',
        displayName: 'Kampala',
        level: 2,
        parent: { id: 'OU_1' },
      },
      {
        id: 'OU_1',
        displayName: 'Uganda',
        level: 1,
        source_instance_id: 102,
      },
    ],
    instance_results: [
      { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 2 },
      { id: 102, name: 'Non Routine DHIS2', status: 'success', count: 1 },
    ],
  });
  fetchMock.get(orgUnitLevelsEndpoint, {
    status: 'success',
    result: [
      { level: 1, displayName: 'National' },
      { level: 2, displayName: 'District' },
    ],
  });
  fetchMock.get(orgUnitGroupsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'g1',
        displayName: 'Urban',
        organisationUnits: [{ id: 'OU_2', displayName: 'Kampala' }],
      },
    ],
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByText(/Currently loading from 2 configured connection/i),
  ).toBeVisible();
  expect(await screen.findByText(/Uganda/i)).toBeVisible();
  expect(await screen.findByText(/Kampala/i)).toBeVisible();
  expect(
    screen.queryByText(/Some configured connections could not be fully loaded/i),
  ).toBeNull();
});

test('shows partial-load diagnostics for organisation units and retries cleanly', async () => {
  const updateState = jest.fn();

  fetchMock.get(orgUnitsEndpoint, {
    status: 'partial',
    message: 'Some configured DHIS2 connections could not be loaded.',
    result: [
      {
        id: 'OU_1',
        displayName: 'Uganda',
        level: 1,
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
  fetchMock.get(orgUnitLevelsEndpoint, {
    status: 'success',
    result: [{ level: 1, displayName: 'National' }],
  });
  fetchMock.get(orgUnitGroupsEndpoint, {
    status: 'success',
    result: [],
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByText(/Some configured connections could not be fully loaded/i),
  ).toBeVisible();
  expect(
    await screen.findByText(/Non Routine DHIS2: DHIS2 API error: 503 Gateway timeout/i),
  ).toBeVisible();

  fetchMock.get(
    orgUnitsEndpoint,
    {
      status: 'success',
      result: [
        {
          id: 'OU_1',
          displayName: 'Uganda',
          level: 1,
        },
        {
          id: 'OU_2',
          displayName: 'Kampala',
          level: 2,
          parent: { id: 'OU_1' },
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
    expect(
      screen.queryByText(/Some configured connections could not be fully loaded/i),
    ).toBeNull();
  });
  expect(await screen.findByText(/Kampala/i)).toBeVisible();
});

test('asks the user to return to the database step when no configured connections are selected', async () => {
  const updateState = jest.fn();

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        selectedInstanceIds: [],
      }}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByText(/No configured connections are currently selected/i),
  ).toBeVisible();
});

test('uses per-instance org-unit level names in repository level mapping', async () => {
  const updateState = jest.fn();

  fetchMock.get(orgUnitsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'OU_1',
        displayName: 'Uganda',
        level: 1,
        source_instance_id: 101,
      },
    ],
  });
  fetchMock.get(orgUnitLevelsEndpoint, {
    status: 'success',
    result: [
      {
        level: 1,
        displayName: 'National',
        source_instance_ids: [101, 102],
        instance_level_names: {
          101: 'National',
          102: 'Country',
        },
      },
      {
        level: 2,
        displayName: 'District',
        source_instance_ids: [101, 102],
        instance_level_names: {
          101: 'District',
          102: 'Province',
        },
      },
    ],
  });
  fetchMock.get(orgUnitGroupsEndpoint, {
    status: 'success',
    result: [],
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect(await screen.findByText('1. National')).toBeVisible();
  expect(await screen.findByText('1. Country')).toBeVisible();
  expect(await screen.findByText('2. District')).toBeVisible();
  expect(await screen.findByText('2. Province')).toBeVisible();
});

test('loads organisation units from the primary configured connection when primary mode is selected', async () => {
  const updateState = jest.fn();

  fetchMock.get(primaryOrgUnitsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'OU_PRIMARY',
        displayName: 'Primary Uganda',
        level: 1,
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
    ],
    instance_results: [
      { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 1 },
    ],
  });
  fetchMock.get(primaryOrgUnitLevelsEndpoint, {
    status: 'success',
    result: [{ level: 1, displayName: 'National' }],
  });
  fetchMock.get(primaryOrgUnitGroupsEndpoint, {
    status: 'success',
    result: [],
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        orgUnitSourceMode: 'primary',
        primaryOrgUnitInstanceId: 101,
      }}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByText(/Currently loading organisation units from the primary configured connection/i),
  ).toBeVisible();
  expect(await screen.findByText(/Primary Uganda/i)).toBeVisible();
  expect(fetchMock.calls(primaryOrgUnitsEndpoint)).toHaveLength(1);
});

test('keeps organisation units separate per configured connection in local staging mode', async () => {
  const updateState = jest.fn();

  fetchMock.get(perInstanceOrgUnitsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'OU_SHARED',
        displayName: 'Uganda',
        level: 1,
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
      {
        id: 'OU_SHARED',
        displayName: 'Uganda',
        level: 1,
        source_instance_id: 102,
        source_instance_name: 'Non Routine DHIS2',
      },
    ],
    instance_results: [
      { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 1 },
      { id: 102, name: 'Non Routine DHIS2', status: 'success', count: 1 },
    ],
  });
  fetchMock.get(perInstanceOrgUnitLevelsEndpoint, {
    status: 'success',
    result: [{ level: 1, displayName: 'National' }],
  });
  fetchMock.get(perInstanceOrgUnitGroupsEndpoint, {
    status: 'success',
    result: [],
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        orgUnitSourceMode: 'per_instance',
      }}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByText(/Per-connection org-unit browsing is enabled/i),
  ).toBeVisible();
  expect(await screen.findByText(/Uganda \(National eHMIS DHIS2\)/i)).toBeVisible();
  expect(await screen.findByText(/Uganda \(Non Routine DHIS2\)/i)).toBeVisible();
});

test('shows staged pending state for organisation units and allows retry', async () => {
  const updateState = jest.fn();

  fetchMock.get(orgUnitsEndpoint, {
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
  fetchMock.get(orgUnitLevelsEndpoint, {
    status: 'success',
    result: [],
  });
  fetchMock.get(orgUnitGroupsEndpoint, {
    status: 'success',
    result: [],
  });

  render(
    <WizardStepOrgUnits
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
    orgUnitsEndpoint,
    {
      status: 'success',
      result: [
        {
          id: 'OU_1',
          displayName: 'Uganda',
          level: 1,
        },
      ],
      instance_results: [
        { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 1 },
      ],
    },
    { overwriteRoutes: true },
  );

  await userEvent.click(screen.getByRole('button', { name: /^Retry$/i }));

  expect(await screen.findByText(/Uganda/i)).toBeVisible();
});

test('filters organisation units by level and group selectors', async () => {
  const updateState = jest.fn();

  fetchMock.get(orgUnitsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'OU_1',
        displayName: 'Uganda',
        level: 1,
      },
      {
        id: 'OU_2',
        displayName: 'Kampala',
        level: 2,
        parent: { id: 'OU_1' },
      },
    ],
    instance_results: [
      { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 2 },
      { id: 102, name: 'Non Routine DHIS2', status: 'success', count: 0 },
    ],
  });
  fetchMock.get(orgUnitLevelsEndpoint, {
    status: 'success',
    result: [
      { level: 1, displayName: 'National' },
      { level: 2, displayName: 'District' },
    ],
  });
  fetchMock.get(orgUnitGroupsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'g1',
        displayName: 'Urban Facilities',
        organisationUnits: [{ id: 'OU_2', displayName: 'Kampala', level: 2 }],
      },
    ],
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={baseWizardState}
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/Uganda/i)).toBeVisible();
  expect(await screen.findByText(/Kampala/i)).toBeVisible();

  const levelSelect = screen
    .getByText(/Filter by level/i)
    .parentElement?.querySelector('.ant-select') as HTMLElement;
  fireEvent.mouseDown(levelSelect.querySelector('.ant-select-selector') as Element);
  await userEvent.type(
    levelSelect.querySelector('input[role="combobox"]') as Element,
    'District',
  );
  await userEvent.click(await screen.findByRole('option', { name: /^District$/i }));

  await waitFor(() => {
    expect(screen.queryByText(/^Uganda$/i)).not.toBeInTheDocument();
  });
  expect(await screen.findByText(/^Kampala$/i)).toBeVisible();

  const groupSelect = screen
    .getByText(/Filter by group/i)
    .parentElement?.querySelector('.ant-select') as HTMLElement;
  fireEvent.mouseDown(groupSelect.querySelector('.ant-select-selector') as Element);
  await userEvent.type(
    groupSelect.querySelector('input[role="combobox"]') as Element,
    'Urban',
  );
  await userEvent.click(
    await screen.findByRole('option', { name: /Urban Facilities/i }),
  );

  expect(await screen.findByText(/^Kampala$/i)).toBeVisible();
});

test('prunes descendant org-unit selections that exceed the chosen data scope', async () => {
  const updateState = jest.fn();

  fetchMock.get(orgUnitsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'OU_REGION',
        displayName: 'Central Region',
        level: 2,
        path: '/ROOT/OU_REGION',
      },
      {
        id: 'OU_DISTRICT',
        displayName: 'Kampala',
        level: 3,
        parent: { id: 'OU_REGION' },
        path: '/ROOT/OU_REGION/OU_DISTRICT',
      },
      {
        id: 'OU_FACILITY',
        displayName: 'Mulago Hospital',
        level: 4,
        parent: { id: 'OU_DISTRICT' },
        path: '/ROOT/OU_REGION/OU_DISTRICT/OU_FACILITY',
      },
    ],
    instance_results: [
      { id: 101, name: 'National eHMIS DHIS2', status: 'success', count: 3 },
      { id: 102, name: 'Non Routine DHIS2', status: 'success', count: 0 },
    ],
  });
  fetchMock.get(orgUnitLevelsEndpoint, {
    status: 'success',
    result: [
      { level: 2, displayName: 'Region' },
      { level: 3, displayName: 'District' },
      { level: 4, displayName: 'Facility' },
    ],
  });
  fetchMock.get(orgUnitGroupsEndpoint, {
    status: 'success',
    result: [],
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        orgUnits: ['OU_REGION', 'OU_FACILITY'],
        dataLevelScope: 'children',
        selectedOrgUnitDetails: [
          {
            id: 'OU_REGION',
            selectionKey: 'OU_REGION',
            sourceOrgUnitId: 'OU_REGION',
            displayName: 'Central Region',
            level: 2,
            path: '/ROOT/OU_REGION',
            sourceInstanceIds: [101],
            sourceInstanceNames: ['National eHMIS DHIS2'],
          },
          {
            id: 'OU_FACILITY',
            selectionKey: 'OU_FACILITY',
            sourceOrgUnitId: 'OU_FACILITY',
            displayName: 'Mulago Hospital',
            parentId: 'OU_DISTRICT',
            level: 4,
            path: '/ROOT/OU_REGION/OU_DISTRICT/OU_FACILITY',
            sourceInstanceIds: [101],
            sourceInstanceNames: ['National eHMIS DHIS2'],
          },
        ],
      }}
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/Selection scope is enforced/i)).toBeVisible();
  expect(
    await screen.findByText(/deeper than the chosen data scope/i),
  ).toBeVisible();

  await waitFor(() => {
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({
        orgUnits: ['OU_REGION'],
        selectedOrgUnitDetails: [
          expect.objectContaining({
            id: 'OU_REGION',
            selectionKey: 'OU_REGION',
          }),
        ],
      }),
    );
  });
});
