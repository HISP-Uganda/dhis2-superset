import fetchMock from 'fetch-mock';
import { within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { render, screen, userEvent, waitFor } from 'spec/helpers/testing-library';

import WizardStepOrgUnits from './StepOrgUnits';

const orgUnitsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnits*&staged=true*';
const orgUnitLevelsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitLevels*&staged=true*';
const orgUnitGroupsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroups*&staged=true*';
const orgUnitGroupSetsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroupSets*&staged=true*';
const primaryOrgUnitsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnits*&org_unit_source_mode=primary&primary_instance_id=101&staged=true*';
const primaryOrgUnitLevelsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitLevels*&org_unit_source_mode=primary&primary_instance_id=101&staged=true*';
const primaryOrgUnitGroupsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroups*&org_unit_source_mode=primary&primary_instance_id=101&staged=true*';
const primaryOrgUnitGroupSetsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroupSets*&org_unit_source_mode=primary&primary_instance_id=101&staged=true*';
const perInstanceOrgUnitsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnits*&org_unit_source_mode=per_instance&staged=true*';
const perInstanceOrgUnitLevelsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitLevels*&org_unit_source_mode=per_instance&staged=true*';
const perInstanceOrgUnitGroupsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroups*&org_unit_source_mode=per_instance&staged=true*';
const perInstanceOrgUnitGroupSetsEndpoint =
  'glob:*/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroupSets*&org_unit_source_mode=per_instance&staged=true*';
const repositoryDatabaseEndpoint = 'glob:*/api/v1/database/9';

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

beforeEach(() => {
  fetchMock.get(orgUnitGroupSetsEndpoint, {
    status: 'success',
    result: [],
  });
  fetchMock.get(primaryOrgUnitGroupSetsEndpoint, {
    status: 'success',
    result: [],
  });
  fetchMock.get(perInstanceOrgUnitGroupSetsEndpoint, {
    status: 'success',
    result: [],
  });
});

test('locks map-and-merge data scope and limits lowest data level choices to mapped repository levels', async () => {
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
        id: 'OU_3',
        displayName: 'Mulago',
        level: 3,
        parent: { id: 'OU_2' },
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
      { level: 3, displayName: 'Facility' },
      { level: 1, displayName: 'National' },
      { level: 2, displayName: 'District' },
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
        orgUnitSourceMode: 'repository',
        dataLevelScope: 'children',
        includeChildren: true,
        maxOrgUnitLevel: 2,
      }}
      hideSourceModeSelector
      forceSourceMode="repository"
      hideAutoDetect
      hideUserScopeOptions
      includeAncestorsScope
      lockedDataScope="all_levels"
      dataScopeLockedMessage="Map and merge follows the mapped repository hierarchy automatically."
      lowestDataLevelOptions={[
        { value: '2', label: 'Repository level 2' },
        { value: '1', label: 'Repository level 1' },
      ]}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByText(/Map and merge follows the mapped repository hierarchy automatically/i),
  ).toBeVisible();
  expect(screen.getByText(/District \(Level 2\)/i)).toBeVisible();
  expect(screen.queryByText(/Repository level 2/i)).not.toBeInTheDocument();
  const lowestDataLevelHeading = screen.getByText(/Lowest data level to use/i);
  const dataScopeHeading = screen.getByText(/^Data scope$/i);
  expect(
    lowestDataLevelHeading.compareDocumentPosition(dataScopeHeading) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);

  await waitFor(() => {
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({
        dataLevelScope: 'all_levels',
        includeChildren: true,
      }),
    );
  });

  const allLevelsRadio = screen.getByRole('radio', {
    name: /All levels \(down to District\)/i,
  });
  expect(allLevelsRadio).toBeChecked();
  expect(allLevelsRadio).toBeDisabled();
  expect(
    screen.getByText(
      /Includes all descendants down to District\. Org units below that selected lowest data level are excluded\./i,
    ),
  ).toBeVisible();

  const lowestDataLevelSection = screen
    .getByText(/Lowest data level to use/i)
    .closest('div');
  expect(lowestDataLevelSection).not.toBeNull();
  const filterByLevelSection = screen
    .getByText(/Filter by level/i)
    .parentElement?.querySelector('.ant-select') as HTMLElement;
  fireEvent.mouseDown(
    filterByLevelSection.querySelector('.ant-select-selector') as Element,
  );
  const filterOptions = (await screen.findAllByRole('option')).map(
    option => option.textContent,
  );
  expect(filterOptions).toEqual(
    expect.arrayContaining(['National', 'District', 'Facility']),
  );
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

test('returns org unit group sets in the metadata callback', async () => {
  const updateState = jest.fn();
  const onMetadataLoaded = jest.fn();

  fetchMock.restore();
  fetchMock.get(orgUnitsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'OU_1',
        displayName: 'Uganda',
        level: 1,
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
  fetchMock.get(orgUnitGroupSetsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'gs_ownership',
        displayName: 'Ownership',
        organisationUnitGroups: [{ id: 'g_public', displayName: 'Public' }],
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
      onMetadataLoaded={onMetadataLoaded}
    />,
    { useRedux: true },
  );

  await waitFor(() => {
    expect(onMetadataLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        orgUnitGroupSets: [
          expect.objectContaining({
            id: 'gs_ownership',
            displayName: 'Ownership',
          }),
        ],
      }),
    );
  });
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

test('defaults to the active configured connections when no selection is persisted yet', async () => {
  const updateState = jest.fn();

  fetchMock.get(orgUnitsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'OU_1',
        displayName: 'Uganda',
        level: 1,
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
      wizardState={{
        ...baseWizardState,
        selectedInstanceIds: [],
      }}
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/^Uganda$/i)).toBeVisible();
  expect(
    screen.queryByText(/No configured connections are currently selected/i),
  ).not.toBeInTheDocument();
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
    .getByText(/^Filter by group$/i)
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

test('loads repository organisation units from the saved database hierarchy', async () => {
  const updateState = jest.fn();

  fetchMock.get(repositoryDatabaseEndpoint, {
    result: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      repository_org_unit_config: {
        level_mapping: {
          enabled: true,
          rows: [
            { merged_level: 1, label: 'Region', instance_levels: { '101': 2 } },
            { merged_level: 2, label: 'District', instance_levels: { '101': 3 } },
          ],
        },
      },
      repository_org_units: [
        {
          repository_key: '1:region',
          display_name: 'Central',
          level: 1,
          hierarchy_path: '1:region',
          parent_repository_key: null,
          source_lineage_label: 'A',
          lineage: [
            {
              instance_id: 101,
              source_instance_code: 'A',
              source_org_unit_uid: 'OU_REGION',
              source_org_unit_name: 'Central',
              source_parent_uid: null,
              source_path: '/OU_REGION',
              source_level: 2,
              provenance: { repositoryLevelName: 'Region' },
            },
          ],
        },
        {
          repository_key: '1:region/2:district',
          display_name: 'Kampala',
          level: 2,
          hierarchy_path: '1:region/2:district',
          parent_repository_key: '1:region',
          source_lineage_label: 'A,B',
          lineage: [
            {
              instance_id: 101,
              source_instance_code: 'A',
              source_org_unit_uid: 'OU_DISTRICT_A',
              source_org_unit_name: 'Kampala',
              source_parent_uid: 'OU_REGION',
              source_path: '/OU_REGION/OU_DISTRICT_A',
              source_level: 3,
              provenance: { repositoryLevelName: 'District' },
            },
            {
              instance_id: 102,
              source_instance_code: 'B',
              source_org_unit_uid: 'OU_DISTRICT_B',
              source_org_unit_name: 'Kampala',
              source_parent_uid: 'OU_REGION_B',
              source_path: '/OU_REGION_B/OU_DISTRICT_B',
              source_level: 3,
              provenance: { repositoryLevelName: 'District' },
            },
          ],
        },
      ],
    },
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      metadataMode="repository"
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        selectedInstanceIds: [101, 102],
        orgUnitSourceMode: 'repository',
      }}
      forceSourceMode="repository"
      hideSourceModeSelector
      hideSourceModeConfiguration
      hideUserScopeOptions
      hideGroupFilter
      hideAutoDetect
      labels={{
        title: 'Repository organisation units',
        description: 'Choose saved repository organisation units.',
      }}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByRole('heading', {
      name: /Repository organisation units/i,
    }),
  ).toBeVisible();
  expect(await screen.findByText(/^Central$/i)).toBeVisible();
  expect(await screen.findByText(/^Kampala$/i)).toBeVisible();
  expect(screen.queryByText(/Organisation-unit source policy/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/User organisation unit options/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Filter by group/i)).not.toBeInTheDocument();
  const lowestDataLevelSection = screen
    .getByText(/Lowest data level to use/i)
    .closest('div');
  expect(lowestDataLevelSection).not.toBeNull();
  await userEvent.click(
    within(lowestDataLevelSection as HTMLElement).getByRole('combobox'),
  );
  expect(await screen.findByText(/Region \(Level 1\)/i)).toBeInTheDocument();
  expect(screen.getByText(/District \(Level 2\)/i)).toBeInTheDocument();
});

test('uses source hierarchy names for repository level filters when saved labels are generic', async () => {
  const updateState = jest.fn();

  fetchMock.get(repositoryDatabaseEndpoint, {
    result: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      repository_org_unit_config: {
        level_mapping: {
          enabled: true,
          rows: [
            {
              merged_level: 1,
              label: 'Repository level 1',
              instance_levels: { '101': 1 },
            },
            {
              merged_level: 6,
              label: 'Repository level 6',
              instance_levels: { '101': 6 },
            },
          ],
        },
      },
      repository_org_units: [
        {
          repository_key: '1:national',
          display_name: 'Uganda',
          level: 1,
          hierarchy_path: '1:national',
          parent_repository_key: null,
          source_lineage_label: 'A',
          lineage: [],
        },
        {
          repository_key: '1:national/6:facility',
          display_name: 'Mulago',
          level: 6,
          hierarchy_path: '1:national/6:facility',
          parent_repository_key: '1:national',
          source_lineage_label: 'A',
          lineage: [],
        },
      ],
    },
  });
  fetchMock.get(orgUnitLevelsEndpoint, {
    status: 'success',
    result: [
      {
        level: 1,
        displayName: 'National',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
      {
        level: 6,
        displayName: 'Health Facilities',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
    ],
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      metadataMode="repository"
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        selectedInstanceIds: [101, 102],
        orgUnitSourceMode: 'repository',
      }}
      forceSourceMode="repository"
      hideSourceModeSelector
      hideSourceModeConfiguration
      hideUserScopeOptions
      hideGroupFilter={false}
      hideAutoDetect
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/^Mulago$/i)).toBeVisible();

  const filterByLevelSection = screen
    .getByText(/Filter by level/i)
    .parentElement?.querySelector('.ant-select') as HTMLElement;
  expect(filterByLevelSection).not.toBeNull();
  fireEvent.mouseDown(
    filterByLevelSection.querySelector('.ant-select-selector') as Element,
  );

  expect(
    await screen.findByRole('option', { name: /^Health Facilities$/i }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/^Repository level 6$/i)).not.toBeInTheDocument();
});

test('loads repository-configured levels, group sets, and groups for repository org-unit filters', async () => {
  const updateState = jest.fn();

  fetchMock.get(repositoryDatabaseEndpoint, {
    result: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      repository_org_unit_config: {
        enabled_dimensions: {
          levels: [
            {
              key: 'level:3',
              label: 'Districts',
              repository_level: 3,
              source_refs: [{ instance_id: 101, source_level: 3 }],
            },
          ],
          groups: [
            {
              key: 'g_urban',
              label: 'Urban Facilities',
              source_refs: [{ instance_id: 101, source_id: 'g_urban' }],
            },
            {
              key: 'g_rural',
              label: 'Rural Facilities',
              source_refs: [{ instance_id: 101, source_id: 'g_rural' }],
            },
            {
              key: 'g_public',
              label: 'Public Facilities',
              source_refs: [{ instance_id: 101, source_id: 'g_public' }],
            },
          ],
          group_sets: [
            {
              key: 'gs_settlement',
              label: 'Settlement',
              member_group_keys: ['g_urban', 'g_rural'],
              member_group_labels: ['Urban Facilities', 'Rural Facilities'],
              source_refs: [{ instance_id: 101, source_id: 'gs_settlement' }],
            },
          ],
        },
      },
      repository_org_units: [
        {
          repository_key: '1:region/3:kampala',
          display_name: 'Kampala',
          level: 3,
          hierarchy_path: '1:region/3:kampala',
          parent_repository_key: '1:region',
          source_lineage_label: 'A',
          lineage: [
            {
              instance_id: 101,
              source_instance_code: 'A',
              source_org_unit_uid: 'OU_KAMPALA',
              source_org_unit_name: 'Kampala',
              source_parent_uid: 'OU_REGION',
              source_path: '/OU_REGION/OU_KAMPALA',
              source_level: 3,
              provenance: { repositoryLevelName: 'Districts' },
            },
          ],
        },
        {
          repository_key: '1:region/3:mubende',
          display_name: 'Mubende',
          level: 3,
          hierarchy_path: '1:region/3:mubende',
          parent_repository_key: '1:region',
          source_lineage_label: 'A',
          lineage: [
            {
              instance_id: 101,
              source_instance_code: 'A',
              source_org_unit_uid: 'OU_MUBENDE',
              source_org_unit_name: 'Mubende',
              source_parent_uid: 'OU_REGION',
              source_path: '/OU_REGION/OU_MUBENDE',
              source_level: 3,
              provenance: { repositoryLevelName: 'Districts' },
            },
          ],
        },
      ],
    },
  });
  fetchMock.get(orgUnitLevelsEndpoint, {
    status: 'success',
    result: [
      {
        level: 3,
        displayName: 'District',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
      },
    ],
  });
  fetchMock.get(orgUnitGroupsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'g_urban',
        displayName: 'Urban Facilities',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
        organisationUnits: [{ id: 'OU_KAMPALA', displayName: 'Kampala' }],
      },
      {
        id: 'g_rural',
        displayName: 'Rural Facilities',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
        organisationUnits: [{ id: 'OU_MUBENDE', displayName: 'Mubende' }],
      },
      {
        id: 'g_public',
        displayName: 'Public Facilities',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
        organisationUnits: [{ id: 'OU_MUBENDE', displayName: 'Mubende' }],
      },
    ],
  });
  fetchMock.get(
    orgUnitGroupSetsEndpoint,
    {
      status: 'success',
      result: [
        {
        id: 'gs_settlement',
        displayName: 'Settlement',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
        organisationUnitGroups: [
          { id: 'g_urban', displayName: 'Urban Facilities' },
          { id: 'g_rural', displayName: 'Rural Facilities' },
        ],
      },
      {
        id: 'gs_ownership',
        displayName: 'Ownership',
        source_instance_id: 101,
        source_instance_name: 'National eHMIS DHIS2',
        organisationUnitGroups: [
          { id: 'g_public', displayName: 'Public Facilities' },
        ],
        },
      ],
    },
    { overwriteRoutes: true },
  );

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      metadataMode="repository"
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        selectedInstanceIds: [101, 102],
        orgUnitSourceMode: 'repository',
      }}
      forceSourceMode="repository"
      hideSourceModeSelector
      hideSourceModeConfiguration
      hideUserScopeOptions
      hideAutoDetect
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/^Kampala$/i)).toBeVisible();
  expect(await screen.findByText(/^Mubende$/i)).toBeVisible();

  const levelSelect = screen
    .getByText(/Filter by level/i)
    .parentElement?.querySelector('.ant-select') as HTMLElement;
  fireEvent.mouseDown(levelSelect.querySelector('.ant-select-selector') as Element);
  expect(await screen.findByRole('option', { name: /^Districts$/i })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /^District$/i })).not.toBeInTheDocument();

  const groupSetSelect = screen
    .getByText(/Filter by group set/i)
    .parentElement?.querySelector('.ant-select') as HTMLElement;
  fireEvent.mouseDown(groupSetSelect.querySelector('.ant-select-selector') as Element);
  await userEvent.click(
    await screen.findByRole('option', { name: /^Settlement$/i }),
  );

  const groupSelect = screen
    .getByText(/^Filter by group$/i)
    .parentElement?.querySelector('.ant-select') as HTMLElement;
  fireEvent.mouseDown(groupSelect.querySelector('.ant-select-selector') as Element);
  expect(
    await screen.findByRole('option', { name: /^Urban Facilities$/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('option', { name: /^Rural Facilities$/i }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: /^Public Facilities$/i }),
  ).not.toBeInTheDocument();

  await userEvent.click(
    await screen.findByRole('option', { name: /^Urban Facilities$/i }),
  );

  expect(await screen.findByText(/^Kampala$/i)).toBeVisible();
  await waitFor(() => {
    expect(screen.queryByText(/^Mubende$/i)).not.toBeInTheDocument();
  });
});

test('loads repository organisation units even when saved records have no lineage array', async () => {
  const updateState = jest.fn();

  fetchMock.get(repositoryDatabaseEndpoint, {
    result: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      repository_org_unit_config: {},
      repository_org_units: [
        {
          repository_key: 'OU_ROOT',
          display_name: 'Uganda',
          level: 1,
          hierarchy_path: 'OU_ROOT',
          parent_repository_key: null,
        },
      ],
    },
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      metadataMode="repository"
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        selectedInstanceIds: [101, 102],
        orgUnitSourceMode: 'repository',
      }}
      forceSourceMode="repository"
      hideSourceModeSelector
      hideSourceModeConfiguration
      hideUserScopeOptions
      hideGroupFilter
      hideAutoDetect
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/^Uganda$/i)).toBeVisible();
  expect(screen.queryByText(/Unable to load organisation units/i)).not.toBeInTheDocument();
});

test('applies saved repository defaults for dataset org-unit selection and scope', async () => {
  const updateState = jest.fn();

  fetchMock.get(repositoryDatabaseEndpoint, {
    result: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      repository_data_scope: 'all_levels',
      lowest_data_level_to_use: 2,
      repository_org_unit_config: {
        selected_org_units: ['1:region'],
        selected_org_unit_details: [
          {
            id: '1:region',
            selectionKey: '1:region',
            sourceOrgUnitId: '1:region',
            displayName: 'Central',
            sourceInstanceIds: [101],
          },
        ],
        enabled_dimensions: {
          levels: [
            {
              key: 'level:1',
              label: 'Region',
              repository_level: 1,
              source_refs: [{ instance_id: 101, source_level: 2 }],
            },
          ],
        },
      },
      repository_org_units: [
        {
          repository_key: '1:region',
          display_name: 'Central',
          level: 1,
          hierarchy_path: '1:region',
          parent_repository_key: null,
          source_lineage_label: 'A',
          lineage: [
            {
              instance_id: 101,
              source_instance_code: 'A',
              source_org_unit_uid: 'OU_REGION',
              source_org_unit_name: 'Central',
              source_parent_uid: null,
              source_path: '/OU_REGION',
              source_level: 2,
              provenance: { repositoryLevelName: 'Region' },
            },
          ],
        },
      ],
    },
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      metadataMode="repository"
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        selectedInstanceIds: [101, 102],
        orgUnitSourceMode: 'repository',
      }}
      forceSourceMode="repository"
      hideSourceModeSelector
      hideSourceModeConfiguration
      hideUserScopeOptions
      hideGroupFilter
      hideAutoDetect
    />,
    { useRedux: true },
  );

  await waitFor(() => {
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({
        orgUnits: ['1:region'],
        dataLevelScope: 'all_levels',
        includeChildren: true,
        maxOrgUnitLevel: 2,
        selectedOrgUnitDetails: [
          expect.objectContaining({
            selectionKey: '1:region',
            sourceOrgUnitId: '1:region',
          }),
        ],
      }),
    );
  });
});

test('preserves the saved primary instance while active connections are rehydrating', async () => {
  const updateState = jest.fn();

  fetchMock.get(primaryOrgUnitsEndpoint, {
    status: 'success',
    result: [
      {
        id: 'OU_ROOT',
        displayName: 'Uganda',
        level: 1,
      },
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
        selectedInstanceIds: [],
        primaryOrgUnitInstanceId: 101,
      }}
      forceSourceMode="primary"
      hideSourceModeSelector
      hideSourceModeConfiguration
      hideUserScopeOptions
      hideGroupFilter
      hideAutoDetect
    />,
    { useRedux: true },
  );

  await screen.findByText(/^Uganda$/i);

  expect(updateState).not.toHaveBeenCalledWith(
    expect.objectContaining({
      primaryOrgUnitInstanceId: null,
    }),
  );
  expect(screen.queryByText(/No configured connections are currently selected/i)).not.toBeInTheDocument();
});

test('returns repository defaults and enabled dimensions in the metadata callback', async () => {
  const updateState = jest.fn();
  const onMetadataLoaded = jest.fn();

  fetchMock.get(repositoryDatabaseEndpoint, {
    result: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      repository_reporting_unit_approach: 'map_merge',
      repository_data_scope: 'all_levels',
      lowest_data_level_to_use: 2,
      repository_org_unit_config: {
        enabled_dimensions: {
          levels: [
            {
              key: 'level:1',
              label: 'Region',
              repository_level: 1,
              source_refs: [{ instance_id: 101, source_level: 2 }],
            },
          ],
          groups: [
            {
              key: 'g_urban',
              label: 'Urban',
              source_refs: [{ instance_id: 101, source_id: 'g_urban' }],
            },
          ],
          group_sets: [
            {
              key: 'gs_ownership',
              label: 'Ownership',
              source_refs: [{ instance_id: 101, source_id: 'gs_ownership' }],
            },
          ],
        },
      },
      repository_org_units: [
        {
          repository_key: '1:region',
          display_name: 'Central',
          level: 1,
          hierarchy_path: '1:region',
          parent_repository_key: null,
          source_lineage_label: 'A',
          lineage: [
            {
              instance_id: 101,
              source_instance_code: 'A',
              source_org_unit_uid: 'OU_REGION',
              source_org_unit_name: 'Central',
              source_parent_uid: null,
              source_path: '/OU_REGION',
              source_level: 2,
              provenance: { repositoryLevelName: 'Region' },
            },
          ],
        },
      ],
    },
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      metadataMode="repository"
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        selectedInstanceIds: [101, 102],
        orgUnitSourceMode: 'repository',
      }}
      forceSourceMode="repository"
      hideSourceModeSelector
      hideSourceModeConfiguration
      hideUserScopeOptions
      hideGroupFilter
      hideAutoDetect
      onMetadataLoaded={onMetadataLoaded}
    />,
    { useRedux: true },
  );

  await waitFor(() => {
    expect(onMetadataLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryApproach: 'map_merge',
        repositoryDataScope: 'all_levels',
        repositoryLowestDataLevelToUse: 2,
        repositoryEnabledDimensions: expect.objectContaining({
          groups: [
            expect.objectContaining({
              key: 'g_urban',
              label: 'Urban',
            }),
          ],
          group_sets: [
            expect.objectContaining({
              key: 'gs_ownership',
              label: 'Ownership',
            }),
          ],
        }),
      }),
    );
  });
});

test('remaps saved legacy source org-unit selections to repository keys when editing', async () => {
  const updateState = jest.fn();

  fetchMock.get(repositoryDatabaseEndpoint, {
    result: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      repository_org_unit_config: {
        level_mapping: {
          enabled: true,
          rows: [
            { merged_level: 1, label: 'Region', instance_levels: { '101': 2 } },
          ],
        },
      },
      repository_org_units: [
        {
          repository_key: '1:region',
          display_name: 'Central',
          level: 1,
          hierarchy_path: '1:region',
          parent_repository_key: null,
          source_lineage_label: 'A',
          lineage: [
            {
              instance_id: 101,
              source_instance_code: 'A',
              source_org_unit_uid: 'OU_REGION',
              source_org_unit_name: 'Central',
              source_parent_uid: null,
              source_path: '/OU_REGION',
              source_level: 2,
              provenance: { repositoryLevelName: 'Region' },
            },
          ],
        },
      ],
    },
  });

  render(
    <WizardStepOrgUnits
      databaseId={9}
      errors={{}}
      instances={instances}
      metadataMode="repository"
      updateState={updateState}
      wizardState={{
        ...baseWizardState,
        orgUnits: ['OU_REGION'],
        selectedOrgUnitDetails: [
          {
            id: 'OU_REGION',
            selectionKey: 'OU_REGION',
            sourceOrgUnitId: 'OU_REGION',
            displayName: 'Central',
            level: 2,
            path: '/OU_REGION',
            sourceInstanceIds: [101],
          },
        ],
      }}
      forceSourceMode="repository"
      hideSourceModeSelector
      hideSourceModeConfiguration
      hideUserScopeOptions
      hideGroupFilter
      hideAutoDetect
    />,
    { useRedux: true },
  );

  await waitFor(() => {
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({
        orgUnits: ['1:region'],
        selectedOrgUnitDetails: [
          expect.objectContaining({
            selectionKey: '1:region',
            sourceOrgUnitId: '1:region',
            lineage: [
              expect.objectContaining({
                source_org_unit_uid: 'OU_REGION',
              }),
            ],
          }),
        ],
      }),
    );
  });
});
