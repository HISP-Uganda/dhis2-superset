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
import { act } from 'react-dom/test-utils';
import fetchMock from 'fetch-mock';
import { render, screen, userEvent, waitFor } from 'spec/helpers/testing-library';

import BranchingDatasetWizard, {
  buildEffectiveOrgUnitSelection,
  buildRepositoryLevelDimensionOptions,
  WORKFLOW_STEPS,
  initialWorkflowState,
  normalizeInstancesPayload,
  workflowReducer,
} from '.';
import WizardStepSchedule from '../DHIS2DatasetWizard/steps/StepSchedule';

const mockHistoryPush = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useHistory: () => ({
    push: mockHistoryPush,
  }),
}));

const databasesEndpoint = 'glob:*/api/v1/database/dataset_sources/';
const stagingEndpoint = (databaseId: number) =>
  `glob:*/api/v1/staging/sources/?database_id=${databaseId}&ensure=true`;
const instancesEndpoint = (databaseId: number) =>
  `glob:*/api/v1/dhis2/instances/?database_id=${databaseId}&include_inactive=true`;
const metadataStatusEndpoint = (databaseId: number) =>
  `glob:*/api/v1/dhis2/diagnostics/metadata-status/${databaseId}`;
const metadataRefreshEndpoint = (databaseId: number) =>
  `glob:*/api/v1/dhis2/diagnostics/metadata-refresh/${databaseId}`;
const dataElementsEndpoint = (databaseId: number) =>
  `glob:*/api/v1/database/${databaseId}/dhis2_metadata/?type=dataElements&federated=true&staged=true*`;
const dataElementGroupsEndpoint = (databaseId: number) =>
  `glob:*/api/v1/database/${databaseId}/dhis2_metadata/?type=dataElementGroups&federated=true&staged=true*`;
const dataElementGroupSetsEndpoint = (databaseId: number) =>
  `glob:*/api/v1/database/${databaseId}/dhis2_metadata/?type=dataElementGroupSets&federated=true&staged=true*`;
const schemasEndpoint = (databaseId: number) =>
  `glob:*/api/v1/database/${databaseId}/schemas/?q=*`;
const tablesEndpoint = (databaseId: number) =>
  `glob:*/api/v1/database/${databaseId}/tables/?q=*`;

beforeEach(() => {
  mockHistoryPush.mockReset();
  fetchMock.get(databasesEndpoint, {
    count: 2,
    result: [
      {
        id: 9,
        database_name: 'Malaria Repository Multiple Sources',
        backend: 'dhis2',
      },
      {
        id: 21,
        database_name: 'Analytics Warehouse',
        backend: 'postgresql',
      },
    ],
  });
  fetchMock.get(stagingEndpoint(21), {
    result: {
      source: { id: 210, source_name: 'Analytics Warehouse' },
      capabilities: {
        source_type: 'sql_database',
        staging_supported: true,
        background_refresh_forced: true,
      },
    },
  });
  fetchMock.get(metadataStatusEndpoint(9), {
    result: {
      database_id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      active_instance_count: 2,
      overall_status: 'ready',
      last_refreshed_at: '2026-03-13T09:30:00',
      variables: {
        status: 'ready',
        count: 42,
        last_refreshed_at: '2026-03-13T09:30:00',
        ready_instances: 2,
        pending_instances: 0,
        failed_instances: 0,
        partial_instances: 0,
        missing_instances: 0,
        instances: [
          { id: 101, name: 'National eHMIS DHIS2', status: 'ready', count: 21 },
          { id: 102, name: 'Non Routine DHIS2', status: 'ready', count: 21 },
        ],
      },
      org_units: {
        status: 'ready',
        count: 18,
        last_refreshed_at: '2026-03-13T09:30:00',
        ready_instances: 2,
        pending_instances: 0,
        failed_instances: 0,
        partial_instances: 0,
        missing_instances: 0,
        instances: [
          { id: 101, name: 'National eHMIS DHIS2', status: 'ready', count: 9 },
          { id: 102, name: 'Non Routine DHIS2', status: 'ready', count: 9 },
        ],
      },
    },
  });
  fetchMock.post(metadataRefreshEndpoint(9), {
    scheduled: true,
  });
  fetchMock.get(schemasEndpoint(21), {
    result: ['public'],
  });
  fetchMock.get(tablesEndpoint(21), {
    result: [{ value: 'fact_visits', label: 'fact_visits' }],
  });
});

afterEach(() => {
  fetchMock.reset();
});

test('renders database selection first and switches to stacked mode on narrow screens', async () => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 900,
    writable: true,
  });

  const { container } = render(<BranchingDatasetWizard />, { useRedux: true });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });

  expect(await screen.findByText(/Create a dataset/i)).toBeVisible();
  expect(
    screen.getByRole('button', { name: /Malaria Repository Multiple Sources/i }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: /Analytics Warehouse/i }),
  ).toBeVisible();

  await waitFor(() => {
    expect(container.querySelector('[data-layout="stacked"]')).toBeTruthy();
  });
});

test('uses database-first four-step flows after a database is selected', () => {
  expect(WORKFLOW_STEPS.dhis2).toHaveLength(4);
  expect(WORKFLOW_STEPS.database).toHaveLength(4);
  expect(WORKFLOW_STEPS.dhis2[0].title).toMatch(/Database/i);
  expect(WORKFLOW_STEPS.database[1].title).toMatch(/Table \/ Query Source/i);
});

test('normalizes the DHIS2 configured-connection API contract and keeps database identity', () => {
  expect(
    normalizeInstancesPayload({
      result: [
        {
          id: 2,
          database_id: 9,
          name: 'Inactive',
          url: 'https://inactive.example.org',
          is_active: false,
          auth_type: 'pat',
        },
        {
          id: 1,
          database_id: 9,
          name: 'Active',
          url: 'https://active.example.org',
          is_active: true,
          auth_type: 'basic',
        },
      ],
    }),
  ).toEqual([
    {
      id: 1,
      database_id: 9,
      name: 'Active',
      url: 'https://active.example.org',
      is_active: true,
      auth_type: 'basic',
      description: null,
      display_order: 0,
      last_test_status: null,
      last_test_message: null,
      last_test_response_time_ms: null,
      last_tested_on: null,
    },
    {
      id: 2,
      database_id: 9,
      name: 'Inactive',
      url: 'https://inactive.example.org',
      is_active: false,
      auth_type: 'pat',
      description: null,
      display_order: 0,
      last_test_status: null,
      last_test_message: null,
      last_test_response_time_ms: null,
      last_tested_on: null,
    },
  ]);
});

test('derives the workflow branch from the selected database backend', () => {
  const dhis2State = workflowReducer(initialWorkflowState, {
    type: 'SET_SOURCE',
    payload: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      backend: 'dhis2',
    },
  });
  expect(dhis2State.datasetType).toBe('dhis2');
  expect(dhis2State.databaseId).toBe(9);

  const sqlState = workflowReducer(initialWorkflowState, {
    type: 'SET_SOURCE',
    payload: {
      id: 21,
      database_name: 'Analytics Warehouse',
      backend: 'postgresql',
    },
  });
  expect(sqlState.datasetType).toBe('database');
  expect(sqlState.databaseId).toBe(21);
});

test('resets dependent DHIS2 selections when the selected database changes', () => {
  const populatedState = {
    ...workflowReducer(initialWorkflowState, {
      type: 'SET_SOURCE',
      payload: {
        id: 9,
        database_name: 'Malaria Repository Multiple Sources',
        backend: 'dhis2',
      },
    }),
    selectedInstanceIds: [101, 202],
    selectedVariables: [
      {
        variableId: 'anc',
        variableName: 'ANC Visits',
        variableType: 'dataElement',
        instanceId: 101,
        instanceName: 'National eHMIS DHIS2',
      },
    ],
    periods: ['202401'],
    orgUnits: ['OU_1'],
    includeChildren: true,
    dataLevelScope: 'children' as const,
    repositoryDimensionKeys: {
      levels: ['level:2'],
      groups: ['g_urban'],
      group_sets: ['gs_ownership'],
    },
    repositoryDimensionKeysConfigured: true,
    datasetSettings: {
      name: 'Existing dataset',
      description: '',
      nameTouched: true,
    },
  };

  const nextState = workflowReducer(populatedState, {
    type: 'SET_SOURCE',
    payload: {
      id: 10,
      database_name: 'Tuberculosis Repository',
      backend: 'dhis2',
    },
  });

  expect(nextState.datasetType).toBe('dhis2');
  expect(nextState.databaseId).toBe(10);
  expect(nextState.selectedInstanceIds).toEqual([]);
  expect(nextState.selectedVariables).toEqual([]);
  expect(nextState.periods).toEqual([]);
  expect(nextState.orgUnits).toEqual([]);
  expect(nextState.dataLevelScope).toBe('selected');
  expect(nextState.repositoryDimensionKeys).toEqual({
    levels: [],
    groups: [],
    group_sets: [],
  });
  expect(nextState.repositoryDimensionKeysConfigured).toBe(false);
  expect(nextState.datasetSettings.name).toBe('');
});

test('stores dataset-specific repository dimension keys from DHIS2 selection updates', () => {
  const baseState = workflowReducer(initialWorkflowState, {
    type: 'SET_SOURCE',
    payload: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      backend: 'dhis2',
    },
  });

  const nextState = workflowReducer(baseState, {
    type: 'PATCH_DHIS2_SELECTION',
    payload: {
      repositoryDimensionKeys: {
        levels: ['level:2'],
        groups: ['g_urban'],
        group_sets: ['gs_ownership'],
      },
    },
  });

  expect(nextState.repositoryDimensionKeys).toEqual({
    levels: ['level:2'],
    groups: ['g_urban'],
    group_sets: ['gs_ownership'],
  });
  expect(nextState.repositoryDimensionKeysConfigured).toBe(true);
});

test('falls back to saved repository org-unit defaults when dataset org units are left untouched', () => {
  const state = {
    ...initialWorkflowState,
    database: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      backend: 'dhis2',
      repository_data_scope: 'all_levels',
      lowest_data_level_to_use: 6,
      repository_org_unit_config: {
        selected_org_units: ['repo:ou-root'],
        selected_org_unit_details: [
          {
            id: 'ou_root',
            selectionKey: 'repo:ou-root',
            sourceOrgUnitId: 'ou_root',
            displayName: 'Uganda',
            lineage: [
              {
                instance_id: 101,
                source_org_unit_uid: 'ou_root',
              },
            ],
          },
        ],
      },
      primary_instance_id: 101,
    },
    databaseId: 9,
    orgUnitSourceMode: 'repository' as const,
  };

  expect(buildEffectiveOrgUnitSelection(state)).toEqual({
    orgUnits: ['repo:ou-root'],
    selectedOrgUnitDetails: [
      expect.objectContaining({
        id: 'ou_root',
        selectionKey: 'repo:ou-root',
      }),
    ],
    dataLevelScope: 'all_levels',
    maxOrgUnitLevel: 6,
    primaryOrgUnitInstanceId: null,
  });
});

test('falls back to repository hierarchy levels when configured level dimensions are empty', () => {
  expect(
    buildRepositoryLevelDimensionOptions(
      {
        levels: [],
        groups: [],
        group_sets: [],
      },
      {
        orgUnitLevels: [
          { level: 1, displayName: 'National' },
          { level: 2, displayName: 'District' },
          { level: 3, displayName: 'Health Facilities' },
        ],
        repositoryConfig: {
          enabled_dimensions: {
            levels: [],
          },
        },
      } as any,
    ),
  ).toEqual([
    { value: 'level:1', label: 'National' },
    { value: 'level:2', label: 'District' },
    { value: 'level:3', label: 'Health Facilities' },
  ]);
});

test('prunes invalid federated org-unit selections when configured connection scope changes', () => {
  const baseState = workflowReducer(initialWorkflowState, {
    type: 'SET_SOURCE',
    payload: {
      id: 9,
      database_name: 'Malaria Repository Multiple Sources',
      backend: 'dhis2',
    },
  });

  const nextState = workflowReducer(
    {
      ...baseState,
      selectedInstanceIds: [101, 102],
      orgUnitSourceMode: 'federated',
      orgUnits: ['OU_1', 'OU_2', 'USER_ORGUNIT'],
      selectedOrgUnitDetails: [
        {
          id: 'OU_1',
          displayName: 'Uganda',
          sourceInstanceIds: [101],
          sourceInstanceNames: ['National eHMIS DHIS2'],
        },
        {
          id: 'OU_2',
          displayName: 'Kampala',
          sourceInstanceIds: [102],
          sourceInstanceNames: ['Non Routine DHIS2'],
        },
      ],
    },
    {
      type: 'SET_SELECTED_INSTANCE_IDS',
      payload: { ids: [101], touched: true },
    },
  );

  expect(nextState.orgUnits).toEqual(['OU_1', 'USER_ORGUNIT']);
  expect(nextState.selectedOrgUnitDetails).toEqual([
    {
      id: 'OU_1',
      displayName: 'Uganda',
      sourceInstanceIds: [101],
      sourceInstanceNames: ['National eHMIS DHIS2'],
    },
  ]);
});

test('loads saved DHIS2 instances for the selected database and auto-includes active ones', async () => {
  fetchMock.get(stagingEndpoint(9), {
    result: {
      source: { id: 90, source_name: 'Malaria Repository Multiple Sources' },
      capabilities: {
        source_type: 'dhis2',
        staging_supported: true,
        background_refresh_forced: true,
      },
    },
  });
  fetchMock.get(instancesEndpoint(9), {
    count: 3,
    result: [
      {
        id: 101,
        database_id: 9,
        name: 'National eHMIS DHIS2',
        url: 'https://national.example.org',
        auth_type: 'basic',
        is_active: true,
        display_order: 0,
      },
      {
        id: 102,
        database_id: 9,
        name: 'Non Routine DHIS2',
        url: 'https://non-routine.example.org',
        auth_type: 'pat',
        is_active: true,
        display_order: 10,
      },
      {
        id: 103,
        database_id: 9,
        name: 'Dormant Source',
        url: 'https://dormant.example.org',
        auth_type: 'basic',
        is_active: false,
      },
    ],
  });

  render(<BranchingDatasetWizard />, { useRedux: true });

  await userEvent.click(
    await screen.findByRole('button', {
      name: /Malaria Repository Multiple Sources/i,
    }),
  );

  expect(
    await screen.findByText(
      /Active DHIS2 instances from this Database are included automatically/i,
    ),
  ).toBeVisible();
  expect(
    (await screen.findAllByText(/National eHMIS DHIS2/i)).length,
  ).toBeGreaterThan(0);
  expect(screen.getAllByText(/Non Routine DHIS2/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/^Included automatically$/i)).toHaveLength(2);
  expect(screen.getByText(/Not included/i)).toBeVisible();
  expect(
    screen.queryByRole('checkbox', { name: /Include/i }),
  ).not.toBeInTheDocument();
});

test('shows staged metadata status in the database step and allows manual refresh', async () => {
  fetchMock.get(stagingEndpoint(9), {
    result: {
      source: { id: 90, source_name: 'Malaria Repository Multiple Sources' },
      capabilities: {
        source_type: 'dhis2',
        staging_supported: true,
        background_refresh_forced: true,
      },
    },
  });
  fetchMock.get(instancesEndpoint(9), {
    count: 2,
    result: [
      {
        id: 101,
        database_id: 9,
        name: 'National eHMIS DHIS2',
        url: 'https://national.example.org',
        auth_type: 'basic',
        is_active: true,
      },
      {
        id: 102,
        database_id: 9,
        name: 'Non Routine DHIS2',
        url: 'https://non-routine.example.org',
        auth_type: 'pat',
        is_active: true,
      },
    ],
  });

  render(<BranchingDatasetWizard />, { useRedux: true });

  await userEvent.click(
    await screen.findByRole('button', {
      name: /Malaria Repository Multiple Sources/i,
    }),
  );

  expect(await screen.findByText(/Variables metadata/i)).toBeVisible();
  expect(screen.getByText(/Ready \(42\)/i)).toBeVisible();
  expect(screen.getByText(/Ready \(18\)/i)).toBeVisible();
  expect(screen.getByText(/Last metadata refresh/i)).toBeVisible();
  expect(fetchMock.called(metadataRefreshEndpoint(9))).toBe(false);

  await userEvent.click(
    screen.getAllByRole('button', { name: /Refresh staged metadata/i })[0],
  );

  await waitFor(() => {
    expect(fetchMock.called(metadataRefreshEndpoint(9))).toBe(true);
  });
});

test('shows staged metadata progress while background loading is in progress', async () => {
  fetchMock.get(
    metadataStatusEndpoint(9),
    {
      result: {
        database_id: 9,
        database_name: 'Malaria Repository Multiple Sources',
        active_instance_count: 2,
        overall_status: 'pending',
        variables: {
          status: 'pending',
          count: 252363,
          ready_instances: 0,
          pending_instances: 2,
          failed_instances: 0,
          partial_instances: 0,
          missing_instances: 0,
          instances: [
            {
              id: 101,
              name: 'National eHMIS DHIS2',
              status: 'pending',
              count: 152363,
            },
            {
              id: 102,
              name: 'Non Routine DHIS2',
              status: 'pending',
              count: 100000,
            },
          ],
        },
        org_units: {
          status: 'pending',
          count: 3200,
          ready_instances: 0,
          pending_instances: 2,
          failed_instances: 0,
          partial_instances: 0,
          missing_instances: 0,
          instances: [
            {
              id: 101,
              name: 'National eHMIS DHIS2',
              status: 'pending',
              count: 2200,
            },
            {
              id: 102,
              name: 'Non Routine DHIS2',
              status: 'pending',
              count: 1000,
            },
          ],
        },
        refresh_progress: {
          status: 'running',
          overall: {
            completed_units: 3,
            failed_units: 0,
            total_units: 10,
            percent_complete: 30,
          },
          variables: {
            status: 'running',
            loaded_count: 252363,
            total_count_estimate: 2836389,
            completed_units: 2,
            failed_units: 0,
            total_units: 6,
            percent_complete: 20,
            current_metadata_type: 'indicators',
            current_instance_id: 102,
            current_instance_name: 'Non Routine DHIS2',
            instances: [
              {
                id: 101,
                name: 'National eHMIS DHIS2',
                status: 'running',
                loaded_count: 152363,
                total_count_estimate: 1800000,
                completed_units: 1,
                failed_units: 0,
                total_units: 3,
                percent_complete: 18,
                current_metadata_type: 'dataElements',
              },
              {
                id: 102,
                name: 'Non Routine DHIS2',
                status: 'running',
                loaded_count: 100000,
                total_count_estimate: 1036389,
                completed_units: 1,
                failed_units: 0,
                total_units: 3,
                percent_complete: 22,
                current_metadata_type: 'indicators',
              },
            ],
          },
          org_units: {
            status: 'queued',
            loaded_count: 0,
            total_count_estimate: 4800,
            completed_units: 0,
            failed_units: 0,
            total_units: 4,
            percent_complete: 0,
            current_metadata_type: 'organisationUnits',
            current_instance_id: null,
            current_instance_name: null,
            instances: [],
          },
        },
      },
    },
    { overwriteRoutes: true },
  );
  fetchMock.get(stagingEndpoint(9), {
    result: {
      source: { id: 90, source_name: 'Malaria Repository Multiple Sources' },
      capabilities: {
        source_type: 'dhis2',
        staging_supported: true,
        background_refresh_forced: true,
      },
    },
  });
  fetchMock.get(instancesEndpoint(9), {
    count: 2,
    result: [
      {
        id: 101,
        database_id: 9,
        name: 'National eHMIS DHIS2',
        url: 'https://national.example.org',
        auth_type: 'basic',
        is_active: true,
      },
      {
        id: 102,
        database_id: 9,
        name: 'Non Routine DHIS2',
        url: 'https://non-routine.example.org',
        auth_type: 'pat',
        is_active: true,
      },
    ],
  });

  render(<BranchingDatasetWizard />, { useRedux: true });

  await userEvent.click(
    await screen.findByRole('button', {
      name: /Malaria Repository Multiple Sources/i,
    }),
  );

  expect(await screen.findByText(/Background metadata refresh/i)).toBeVisible();
  expect(screen.getByText(/252,363 of 2,836,389 loaded/i)).toBeVisible();
  expect(screen.getAllByText(/National eHMIS DHIS2/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Non Routine DHIS2/i).length).toBeGreaterThan(0);
});

test('can switch from a DHIS2 database to a non-DHIS2 database directly from the database step', async () => {
  fetchMock.get(stagingEndpoint(9), {
    result: {
      source: { id: 90, source_name: 'Malaria Repository Multiple Sources' },
      capabilities: {
        source_type: 'dhis2',
        staging_supported: true,
        background_refresh_forced: true,
      },
    },
  });
  fetchMock.get(instancesEndpoint(9), {
    count: 1,
    result: [
      {
        id: 101,
        database_id: 9,
        name: 'National eHMIS DHIS2',
        url: 'https://national.example.org',
        auth_type: 'basic',
        is_active: true,
      },
    ],
  });

  render(<BranchingDatasetWizard />, { useRedux: true });

  await userEvent.click(
    await screen.findByRole('button', {
      name: /Malaria Repository Multiple Sources/i,
    }),
  );
  expect(
    (await screen.findAllByText(/^Configured DHIS2 instances$/i)).length,
  ).toBeGreaterThan(0);

  await userEvent.click(
    screen.getByRole('button', { name: /Analytics Warehouse/i }),
  );

  expect(
    await screen.findByRole('heading', { name: /^Database$/i }),
  ).toBeVisible();
  expect(screen.queryByText(/Configured DHIS2 instances/i)).toBeNull();
});

test('shows inline retry diagnostics when configured connection loading fails', async () => {
  fetchMock.get(stagingEndpoint(9), {
    result: {
      source: { id: 90, source_name: 'Malaria Repository Multiple Sources' },
      capabilities: {
        source_type: 'dhis2',
        staging_supported: true,
        background_refresh_forced: true,
      },
    },
  });
  fetchMock.get(instancesEndpoint(9), 500);

  render(<BranchingDatasetWizard />, { useRedux: true });

  await userEvent.click(
    await screen.findByRole('button', {
      name: /Malaria Repository Multiple Sources/i,
    }),
  );

  expect(
    await screen.findByText(/Unable to load configured DHIS2 instances/i),
  ).toBeVisible();

  fetchMock.get(
    instancesEndpoint(9),
    {
      count: 1,
      result: [
        {
          id: 101,
          database_id: 9,
          name: 'National eHMIS DHIS2',
          url: 'https://national.example.org',
          auth_type: 'basic',
          is_active: true,
        },
      ],
    },
    { overwriteRoutes: true },
  );

  await userEvent.click(screen.getByRole('button', { name: /^Retry$/i }));

  expect((await screen.findAllByText(/National eHMIS DHIS2/i)).length).toBeGreaterThan(0);
});

test('continues through the normal database flow for non-DHIS2 databases', async () => {
  fetchMock.get(instancesEndpoint(9), {
    count: 0,
    result: [],
  });
  render(<BranchingDatasetWizard />, { useRedux: true });

  await userEvent.click(
    await screen.findByRole('button', { name: /Analytics Warehouse/i }),
  );
  await userEvent.click(screen.getByRole('button', { name: /Next/i }));

  expect(
    await screen.findByRole('heading', { name: /Table \/ Query Source/i }),
  ).toBeVisible();
});

test('shows data-selection guidance as info instead of an error state', async () => {
  fetchMock.get(stagingEndpoint(9), {
    result: {
      source: { id: 90, source_name: 'Malaria Repository Multiple Sources' },
      capabilities: {
        source_type: 'dhis2',
        staging_supported: true,
        background_refresh_forced: true,
      },
    },
  });
  fetchMock.get(instancesEndpoint(9), {
    count: 1,
    result: [
      {
        id: 101,
        database_id: 9,
        name: 'National eHMIS DHIS2',
        url: 'https://national.example.org',
        auth_type: 'basic',
        is_active: true,
      },
    ],
  });
  fetchMock.get(
    'glob:*/api/v1/database/9/dhis2_metadata/?type=dataElements&federated=true&staged=true*',
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
        {
          id: 101,
          name: 'National eHMIS DHIS2',
          status: 'success',
          count: 1,
        },
      ],
    },
  );

  render(<BranchingDatasetWizard />, { useRedux: true });

  await userEvent.click(
    await screen.findByRole('button', {
      name: /Malaria Repository Multiple Sources/i,
    }),
  );
  expect(
    await screen.findByText(
      /Active DHIS2 instances from this Database are included automatically/i,
    ),
  ).toBeVisible();
  expect(await screen.findByText(/Variables metadata/i)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /Next/i }));
  await screen.findByRole('heading', { name: /Data Selection/i });

  await userEvent.click(screen.getByRole('button', { name: /Next/i }));

  expect(await screen.findByText(/Complete this step/i)).toBeVisible();
  const guidance = await screen.findByText(
    /Choose at least one DHIS2 variable to continue/i,
  );
  expect(guidance.closest('.ant-alert-info')).toBeTruthy();
  expect(guidance.closest('.ant-alert-error')).toBeFalsy();
});

test('surfaces the managed schedule behavior in the settings step', async () => {
  render(
    <WizardStepSchedule
      onChange={() => undefined}
      scheduleConfig={{
        preset: 'daily',
        cron: '0 5 * * *',
        timezone: 'UTC',
      }}
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/Sync Schedule/i)).toBeVisible();
  expect(
    screen.getByText(/Background processing is automatically enabled/i),
  ).toBeVisible();
});

test('creates a DHIS2 dataset through staged datasets only and opens the local-data monitor', async () => {
  fetchMock.get(stagingEndpoint(9), {
    result: {
      source: { id: 90, source_name: 'Malaria Repository Multiple Sources' },
      capabilities: {
        source_type: 'dhis2',
        staging_supported: true,
        background_refresh_forced: true,
      },
    },
  });
  fetchMock.get(instancesEndpoint(9), {
    count: 1,
    result: [
      {
        id: 101,
        database_id: 9,
        name: 'National eHMIS DHIS2',
        url: 'https://national.example.org',
        auth_type: 'basic',
        is_active: true,
      },
    ],
  });
  fetchMock.get(dataElementsEndpoint(9), {
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
      {
        id: 101,
        name: 'National eHMIS DHIS2',
        status: 'success',
        count: 1,
      },
    ],
  });
  fetchMock.get(dataElementGroupsEndpoint(9), {
    status: 'success',
    result: [],
  });
  fetchMock.get(dataElementGroupSetsEndpoint(9), {
    status: 'success',
    result: [],
  });
  fetchMock.post('glob:*/api/v1/dhis2/staged-datasets/', {
    result: {
      id: 11,
      serving_superset_dataset_id: 19,
      serving_table_ref: '`dhis2_serving`.`sv_11_anc_visits_mart`',
    },
  });

  render(<BranchingDatasetWizard />, { useRedux: true });

  await userEvent.click(
    await screen.findByRole('button', {
      name: /Malaria Repository Multiple Sources/i,
    }),
  );
  expect(
    await screen.findByText(
      /Active DHIS2 instances from this Database are included automatically/i,
    ),
  ).toBeVisible();

  await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
  await waitFor(() => {
    expect(fetchMock.called(dataElementsEndpoint(9))).toBe(true);
  });
  expect((await screen.findAllByText(/Select Variables/i)).length).toBeGreaterThan(0);

  await userEvent.click(
    await screen.findByRole('button', { name: /ANC Visits/i }),
  );

  await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
  expect((await screen.findAllByText(/Dataset Settings/i)).length).toBeGreaterThan(0);

  const datasetNameInput = screen.getByRole('textbox', {
    name: /Dataset Name/i,
  });
  await userEvent.clear(datasetNameInput);
  await userEvent.type(datasetNameInput, 'ANC Coverage');

  await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
  expect((await screen.findAllByText(/Review & Create/i)).length).toBeGreaterThan(0);

  expect(
    screen.getAllByRole('button', { name: /^Create Dataset$/i }),
  ).toHaveLength(1);
  expect(
    screen.queryByRole('button', { name: /Create and Explore/i }),
  ).not.toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', { name: /^Create Dataset$/i }),
  );

  await waitFor(() => {
    expect(fetchMock.called('glob:*/api/v1/dhis2/staged-datasets/')).toBe(true);
  });

  expect(fetchMock.called('glob:*/api/v1/dataset/')).toBe(false);
  expect(mockHistoryPush).toHaveBeenCalledWith(
    '/superset/dhis2/local-data/?database=9&dataset=11',
  );
});
