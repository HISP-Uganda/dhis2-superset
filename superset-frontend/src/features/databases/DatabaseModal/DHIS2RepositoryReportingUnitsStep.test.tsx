/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance
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
import { render, waitFor } from 'spec/helpers/testing-library';

import DHIS2RepositoryReportingUnitsStep from './DHIS2RepositoryReportingUnitsStep';

const DHIS2_ORG_UNITS_ENDPOINT =
  'glob:*/api/v1/database/10/dhis2_metadata/?type=organisationUnits*&staged=true*';
const DHIS2_ORG_UNIT_LEVELS_ENDPOINT =
  'glob:*/api/v1/database/10/dhis2_metadata/?type=organisationUnitLevels*&staged=true*';
const DHIS2_ORG_UNIT_GROUPS_ENDPOINT =
  'glob:*/api/v1/database/10/dhis2_metadata/?type=organisationUnitGroups*&staged=true*';
const DHIS2_ORG_UNIT_GROUPSETS_ENDPOINT =
  'glob:*/api/v1/database/10/dhis2_metadata/?type=organisationUnitGroupSets*&staged=true*';

describe('DHIS2RepositoryReportingUnitsStep', () => {
  beforeEach(() => {
    fetchMock.get(DHIS2_ORG_UNITS_ENDPOINT, {
      status: 'success',
      result: [
        {
          id: 'OU_ROOT',
          displayName: 'Uganda',
          level: 1,
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
    fetchMock.get(DHIS2_ORG_UNIT_LEVELS_ENDPOINT, {
      status: 'success',
      result: [
        { level: 1, displayName: 'National' },
      ],
    });
    fetchMock.get(DHIS2_ORG_UNIT_GROUPS_ENDPOINT, {
      status: 'success',
      result: [
        {
          id: 'g_urban',
          displayName: 'Urban',
          source_instance_id: 101,
          source_instance_name: 'National eHMIS DHIS2',
          organisationUnits: [{ id: 'OU_ROOT' }],
        },
        {
          id: 'g_public',
          displayName: 'Public',
          source_instance_id: 101,
          source_instance_name: 'National eHMIS DHIS2',
          organisationUnits: [{ id: 'OU_ROOT' }],
        },
      ],
    });
    fetchMock.get(DHIS2_ORG_UNIT_GROUPSETS_ENDPOINT, {
      status: 'success',
      result: [
        {
          id: 'gs_ownership',
          displayName: 'Ownership',
          source_instance_id: 101,
          source_instance_name: 'National eHMIS DHIS2',
          organisationUnitGroups: [
            { id: 'g_public', displayName: 'Public' },
          ],
        },
        {
          id: 'gs_settlement',
          displayName: 'Settlement',
          source_instance_id: 101,
          source_instance_name: 'National eHMIS DHIS2',
          organisationUnitGroups: [
            { id: 'g_urban', displayName: 'Urban' },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    fetchMock.restore();
    jest.clearAllMocks();
  });

  test('defaults all org unit groups and group sets to enabled when no saved selection exists', async () => {
    const onChange = jest.fn();

    render(
      <DHIS2RepositoryReportingUnitsStep
        databaseId={10}
        instances={[
          {
            id: 101,
            database_id: 10,
            name: 'National eHMIS DHIS2',
            url: 'https://example.org',
            auth_type: 'basic',
            is_active: true,
            display_order: 1,
          },
        ]}
        initialValue={{
          repository_reporting_unit_approach: 'primary_instance',
        }}
        onChange={onChange}
      />,
      {
        useRedux: true,
      },
    );

    await waitFor(() => {
      const latestValue = onChange.mock.calls.at(-1)?.[0];
      expect(
        latestValue?.repository_org_unit_config?.enabled_dimensions?.groups,
      ).toHaveLength(2);
      expect(
        latestValue?.repository_org_unit_config?.enabled_dimensions?.group_sets,
      ).toHaveLength(2);
    });

    const latestValue = onChange.mock.calls.at(-1)?.[0];
    expect(
      latestValue.repository_org_unit_config.enabled_dimensions.groups.map(
        (item: { key: string }) => item.key,
      ),
    ).toEqual(['g_public', 'g_urban']);
    expect(
      latestValue.repository_org_unit_config.enabled_dimensions.group_sets.map(
        (item: { key: string }) => item.key,
      ),
    ).toEqual(['gs_ownership', 'gs_settlement']);
  });

  test('keeps the persisted repository configuration while configured instances are still loading in edit mode', async () => {
    const onChange = jest.fn();
    const initialValue = {
      repository_reporting_unit_approach: 'primary_instance' as const,
      lowest_data_level_to_use: 1,
      primary_instance_id: 101,
      repository_data_scope: 'all_levels' as const,
      repository_org_unit_config: {
        selected_org_units: ['OU_ROOT'],
        selected_org_unit_details: [
          {
            id: 'OU_ROOT',
            selectionKey: 'OU_ROOT',
            sourceOrgUnitId: 'OU_ROOT',
            displayName: 'Uganda',
            level: 1,
            sourceInstanceIds: [101],
            sourceInstanceNames: ['National eHMIS DHIS2'],
          },
        ],
        repository_org_units: [
          {
            repository_key: 'OU_ROOT',
            display_name: 'Uganda',
            level: 1,
            selection_key: 'OU_ROOT',
            lineage: [
              {
                instance_id: 101,
                source_org_unit_uid: 'OU_ROOT',
                source_instance_code: 'A',
              },
            ],
          },
        ],
      },
    };

    const { rerender } = render(
      <DHIS2RepositoryReportingUnitsStep
        databaseId={10}
        instances={[]}
        initialValue={initialValue}
        onChange={onChange}
      />,
      {
        useRedux: true,
      },
    );

    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled();
    });

    rerender(
      <DHIS2RepositoryReportingUnitsStep
        databaseId={10}
        instances={[
          {
            id: 101,
            database_id: 10,
            name: 'National eHMIS DHIS2',
            url: 'https://example.org',
            auth_type: 'basic',
            is_active: true,
            display_order: 1,
          },
        ]}
        initialValue={initialValue}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      const latestValue = onChange.mock.calls.at(-1)?.[0];
      expect(latestValue?.primary_instance_id).toBe(101);
      expect(latestValue?.repository_reporting_unit_approach).toBe(
        'primary_instance',
      );
      expect(latestValue?.validationError).toBeNull();
    });
  });
});
