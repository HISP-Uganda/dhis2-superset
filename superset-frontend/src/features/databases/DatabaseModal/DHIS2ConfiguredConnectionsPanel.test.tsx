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
import { render, screen, userEvent, waitFor } from 'spec/helpers/testing-library';

import DHIS2ConfiguredConnectionsPanel from './DHIS2ConfiguredConnectionsPanel';

const INSTANCES_ENDPOINT =
  'glob:*/api/v1/dhis2/instances/?database_id=10&include_inactive=true';
const METADATA_STATUS_ENDPOINT =
  'glob:*/api/v1/dhis2/diagnostics/metadata-status/10';
const METADATA_REFRESH_ENDPOINT =
  'glob:*/api/v1/dhis2/diagnostics/metadata-refresh/10';

beforeEach(() => {
  fetchMock.get(INSTANCES_ENDPOINT, {
    count: 1,
    result: [
      {
        id: 301,
        database_id: 10,
        name: 'National eHMIS',
        url: 'https://national.example.org',
        auth_type: 'basic',
        is_active: true,
        display_order: 0,
      },
    ],
  });
  fetchMock.get(METADATA_STATUS_ENDPOINT, {
    result: {
      database_id: 10,
      database_name: 'Malaria Repository',
      active_instance_count: 1,
      overall_status: 'ready',
      last_refreshed_at: '2026-03-13T11:15:00',
      variables: {
        status: 'ready',
        count: 120,
        last_refreshed_at: '2026-03-13T11:15:00',
        ready_instances: 1,
        pending_instances: 0,
        failed_instances: 0,
        partial_instances: 0,
        missing_instances: 0,
        instances: [
          {
            id: 301,
            name: 'National eHMIS',
            status: 'ready',
            count: 120,
          },
        ],
      },
      org_units: {
        status: 'partial',
        count: 44,
        last_refreshed_at: '2026-03-13T11:15:00',
        ready_instances: 0,
        pending_instances: 0,
        failed_instances: 0,
        partial_instances: 1,
        missing_instances: 0,
        instances: [
          {
            id: 301,
            name: 'National eHMIS',
            status: 'partial',
            count: 44,
          },
        ],
      },
    },
  });
  fetchMock.post(METADATA_REFRESH_ENDPOINT, {
    scheduled: true,
  });
});

afterEach(() => {
  fetchMock.reset();
});

test('shows local metadata staging status in the database UI', async () => {
  render(
    <DHIS2ConfiguredConnectionsPanel
      databaseId={10}
      databaseName="Malaria Repository"
    />,
    { useRedux: true },
  );

  expect(await screen.findByText(/Local metadata staging/i)).toBeVisible();
  expect(screen.getByText(/Status: Ready/i)).toBeVisible();
  expect(screen.getByText(/Variables: Ready/i)).toBeVisible();
  expect(screen.getByText(/Org units: Partially ready/i)).toBeVisible();
  expect(screen.getByText(/Last refreshed/i)).toBeVisible();
});

test('queues a staged metadata refresh from the database UI', async () => {
  render(
    <DHIS2ConfiguredConnectionsPanel
      databaseId={10}
      databaseName="Malaria Repository"
    />,
    { useRedux: true },
  );

  await screen.findByText(/Local metadata staging/i);
  await userEvent.click(
    screen.getByRole('button', { name: /Refresh staged metadata/i }),
  );

  await waitFor(() => {
    expect(fetchMock.called(METADATA_REFRESH_ENDPOINT)).toBe(true);
  });
});
