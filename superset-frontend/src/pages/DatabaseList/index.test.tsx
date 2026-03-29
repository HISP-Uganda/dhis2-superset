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

import fetchMock from 'fetch-mock';
import { render, screen, waitFor } from 'spec/helpers/testing-library';
import userEvent from '@testing-library/user-event';

import * as hooks from 'src/views/CRUD/hooks';
import DatabaseList from './index';

jest.mock('src/views/CRUD/hooks', () => ({
  ...jest.requireActual('src/views/CRUD/hooks'),
  useListViewResource: jest.fn(),
}));

const databaseDetailEndpoint = 'glob:*/api/v1/database/5';
const dhis2InstancesEndpoint =
  'glob:*/api/v1/dhis2/instances/?database_id=5&include_inactive=true';
const fileUploadEnabledEndpoint = 'glob:*/api/v1/database/?q=*';

const mockUser = {
  userId: 1,
  firstName: 'Test',
  lastName: 'User',
};

beforeEach(() => {
  (hooks.useListViewResource as jest.Mock).mockReturnValue({
    state: {
      loading: false,
      resourceCollection: [
        {
          id: 5,
          database_name: 'DHIS2 Repo',
          backend: 'dhis2',
          expose_in_sqllab: true,
          allow_run_async: false,
          allow_dml: false,
          allow_file_upload: false,
          changed_on_delta_humanized: '1 day ago',
          changed_by: { first_name: 'Admin', last_name: 'User' },
        },
      ],
      resourceCount: 1,
    },
    hasPerm: jest.fn().mockReturnValue(true),
    fetchData: jest.fn(),
    refreshData: jest.fn(),
  });

  fetchMock.get(databaseDetailEndpoint, {
    result: {
      id: 5,
      database_name: 'DHIS2 Repo',
      backend: 'dhis2',
      repository_org_unit_config: {
        filters: {
          active_instance_ids: [101, 102],
        },
        selected_org_units: ['OU_ROOT'],
        selected_org_unit_details: [
          {
            id: 'OU_ROOT',
            displayName: 'Uganda',
          },
        ],
        level_mapping: {
          enabled: true,
          rows: [
            {
              merged_level: 1,
              label: 'Country',
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
        enabled_dimensions: {
          levels: [
            {
              key: 'level:1',
              label: 'Country',
              repository_level: 1,
              source_refs: [{ instance_id: 101, source_level: 1 }],
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
              member_group_labels: ['Public', 'Private'],
              source_refs: [{ instance_id: 101, source_id: 'gs_ownership' }],
            },
          ],
        },
      },
      repository_org_units: [
        {
          repository_key: 'OU_ROOT',
          display_name: 'Uganda',
          parent_repository_key: null,
          level: 1,
          hierarchy_path: 'OU_ROOT',
          source_lineage_label: 'A',
          lineage: [],
        },
        {
          repository_key: 'OU_ROOT/OU_DISTRICT',
          display_name: 'Kampala',
          parent_repository_key: 'OU_ROOT',
          level: 2,
          hierarchy_path: 'OU_ROOT/OU_DISTRICT',
          source_lineage_label: 'A,B',
          lineage: [],
        },
      ],
      repository_org_unit_summary: {
        approach: 'map_merge',
        total_repository_org_units: 2,
        lowest_data_level_to_use: 2,
        data_scope: 'all_levels',
        status: 'ready',
        status_message: 'Ready',
        last_finalized_at: '2026-03-28T12:30:00',
      },
    },
  });
  fetchMock.get(dhis2InstancesEndpoint, {
    result: [
      {
        id: 101,
        database_id: 5,
        name: 'National eHMIS DHIS2',
        url: 'https://national.example.org',
        auth_type: 'basic',
        is_active: true,
      },
      {
        id: 102,
        database_id: 5,
        name: 'Regional DHIS2',
        url: 'https://regional.example.org',
        auth_type: 'basic',
        is_active: true,
      },
    ],
  });
  fetchMock.get(fileUploadEnabledEndpoint, {
    result: [],
  });
});

afterEach(() => {
  fetchMock.restore();
  jest.clearAllMocks();
});

test('opens a repository org unit viewer from the database list', async () => {
  const { container } = render(
    <DatabaseList
      addDangerToast={jest.fn()}
      addSuccessToast={jest.fn()}
      addInfoToast={jest.fn()}
      user={mockUser}
    />,
    {
      useRedux: true,
      useRouter: true,
      useQueryParams: true,
    },
  );

  await screen.findByText('DHIS2 Repo');

  const action = container.querySelector(
    '[data-test="database-view-repository"]',
  ) as HTMLElement | null;
  expect(action).not.toBeNull();
  if (!action) {
    throw new Error('Repository viewer action not rendered');
  }

  await userEvent.click(action);

  await screen.findByText(/Repository Organisation Units/i);
  await waitFor(() => {
    expect(
      screen.getByText('Map and merge reporting units'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Automatic from mapped hierarchy'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('District (Repository level 2)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('National eHMIS DHIS2'),
    ).toBeInTheDocument();
    expect(screen.getByText('Regional DHIS2')).toBeInTheDocument();
    expect(screen.getByText('Mapped repository levels')).toBeInTheDocument();
    expect(screen.getByText('Step 4 configuration applied')).toBeInTheDocument();
    expect(screen.getByText(/Member groups:/i)).toBeInTheDocument();
    expect(screen.getAllByText('Country').length).toBeGreaterThan(0);
    expect(screen.getByText('Ownership')).toBeInTheDocument();
    expect(screen.getByText('Urban')).toBeInTheDocument();
    expect(screen.getAllByText('Uganda').length).toBeGreaterThan(0);
    expect(screen.getByText('Kampala')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });
});
