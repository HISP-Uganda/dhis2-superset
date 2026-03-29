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

import type { OrgUnit } from 'src/features/datasets/AddDataset/DHIS2DatasetWizard/steps/StepOrgUnits';

import { resolveRepositoryOrgUnits } from './repositoryOrgUnits';

const sharedMetadata: OrgUnit[] = [
  {
    id: 'OU_A_ROOT',
    selectionKey: 'OU_A_ROOT',
    sourceOrgUnitId: 'OU_A_ROOT',
    displayName: 'Uganda',
    level: 1,
    path: '/OU_A_ROOT',
    sourceInstanceIds: [101],
    sourceInstanceNames: ['National eHMIS'],
  },
  {
    id: 'OU_A_DISTRICT',
    selectionKey: 'OU_A_DISTRICT',
    sourceOrgUnitId: 'OU_A_DISTRICT',
    displayName: 'Kampala',
    parentId: 'OU_A_ROOT',
    level: 2,
    path: '/OU_A_ROOT/OU_A_DISTRICT',
    sourceInstanceIds: [101],
    sourceInstanceNames: ['National eHMIS'],
  },
  {
    id: 'OU_A_FACILITY',
    selectionKey: 'OU_A_FACILITY',
    sourceOrgUnitId: 'OU_A_FACILITY',
    displayName: 'Mulago',
    parentId: 'OU_A_DISTRICT',
    level: 3,
    path: '/OU_A_ROOT/OU_A_DISTRICT/OU_A_FACILITY',
    sourceInstanceIds: [101],
    sourceInstanceNames: ['National eHMIS'],
  },
  {
    id: 'OU_A_GULU',
    selectionKey: 'OU_A_GULU',
    sourceOrgUnitId: 'OU_A_GULU',
    displayName: 'Gulu',
    parentId: 'OU_A_ROOT',
    level: 2,
    path: '/OU_A_ROOT/OU_A_GULU',
    sourceInstanceIds: [101],
    sourceInstanceNames: ['National eHMIS'],
  },
  {
    id: 'OU_B_ROOT',
    selectionKey: 'OU_B_ROOT',
    sourceOrgUnitId: 'OU_B_ROOT',
    displayName: 'Uganda',
    level: 1,
    path: '/OU_B_ROOT',
    sourceInstanceIds: [102],
    sourceInstanceNames: ['Non Routine'],
  },
  {
    id: 'OU_B_DISTRICT',
    selectionKey: 'OU_B_DISTRICT',
    sourceOrgUnitId: 'OU_B_DISTRICT',
    displayName: 'Kampala',
    parentId: 'OU_B_ROOT',
    level: 2,
    path: '/OU_B_ROOT/OU_B_DISTRICT',
    sourceInstanceIds: [102],
    sourceInstanceNames: ['Non Routine'],
  },
  {
    id: 'OU_B_FACILITY',
    selectionKey: 'OU_B_FACILITY',
    sourceOrgUnitId: 'OU_B_FACILITY',
    displayName: 'Mulago',
    parentId: 'OU_B_DISTRICT',
    level: 3,
    path: '/OU_B_ROOT/OU_B_DISTRICT/OU_B_FACILITY',
    sourceInstanceIds: [102],
    sourceInstanceNames: ['Non Routine'],
  },
];

describe('resolveRepositoryOrgUnits', () => {
  it('uses the selected primary instance and includes ancestors when requested', () => {
    const result = resolveRepositoryOrgUnits({
      approach: 'primary_instance',
      dataScope: 'ancestors',
      primaryInstanceId: 101,
      sharedSelectedOrgUnits: ['OU_A_FACILITY'],
      sharedMetadata,
    });

    expect(result.map(record => record.repository_key)).toEqual([
      'OU_A_ROOT',
      'OU_A_DISTRICT',
      'OU_A_FACILITY',
    ]);
    expect(new Set(result.flatMap(record => record.lineage.map(lineage => lineage.instance_id)))).toEqual(
      new Set([101]),
    );
  });

  it('merges mapped repository units and retains A/B lineage labels', () => {
    const result = resolveRepositoryOrgUnits({
      approach: 'map_merge',
      dataScope: 'children',
      lowestDataLevelToUse: 2,
      sharedSelectedOrgUnits: ['OU_A_ROOT', 'OU_B_ROOT'],
      sharedMetadata,
      levelMapping: {
        enabled: true,
        rows: [
          {
            merged_level: 1,
            label: 'Country',
            instance_levels: { '101': 1, '102': 1 },
          },
          {
            merged_level: 2,
            label: 'District',
            instance_levels: { '101': 2, '102': 2 },
          },
        ],
      },
    });

    expect(result).toHaveLength(3);
    expect(result[0].repository_key).toBe('1:uganda');
    expect(result[0].source_lineage_label).toBe('A,B');
    expect(result[1].repository_key).toBe('1:uganda/2:kampala');
    expect(result[1].source_lineage_label).toBe('A,B');
    expect(result[2].repository_key).toBe('1:uganda/2:gulu');
    expect(result[2].source_lineage_label).toBe('A');
    expect(result[2].is_unmatched).toBe(true);
  });

  it('forces map-and-merge to follow the mapped hierarchy automatically', () => {
    const result = resolveRepositoryOrgUnits({
      approach: 'map_merge',
      dataScope: 'selected',
      lowestDataLevelToUse: 3,
      sharedSelectedOrgUnits: ['OU_A_ROOT', 'OU_B_ROOT'],
      sharedMetadata,
      levelMapping: {
        enabled: true,
        rows: [
          {
            merged_level: 1,
            label: 'Country',
            instance_levels: { '101': 1, '102': 1 },
          },
          {
            merged_level: 2,
            label: 'District',
            instance_levels: { '101': 2, '102': 2 },
          },
          {
            merged_level: 3,
            label: 'Facility',
            instance_levels: { '101': 3, '102': 3 },
          },
        ],
      },
    });

    expect(result.map(record => record.repository_key)).toEqual([
      '1:uganda',
      '1:uganda/2:kampala',
      '1:uganda/2:gulu',
      '1:uganda/2:kampala/3:mulago',
    ]);
    expect(
      result.find(record => record.repository_key === '1:uganda/2:kampala/3:mulago')
        ?.source_lineage_label,
    ).toBe('A,B');
  });

  it('collapses excluded mapped levels and reparents lower levels to the nearest included ancestor', () => {
    const result = resolveRepositoryOrgUnits({
      approach: 'map_merge',
      dataScope: 'selected',
      lowestDataLevelToUse: 3,
      sharedSelectedOrgUnits: ['OU_A_ROOT', 'OU_B_ROOT'],
      sharedMetadata,
      levelMapping: {
        enabled: true,
        rows: [
          {
            merged_level: 1,
            label: 'Country',
            instance_levels: { '101': 1, '102': 1 },
          },
          {
            merged_level: 3,
            label: 'Facility',
            instance_levels: { '101': 3, '102': 3 },
          },
        ],
      },
    });

    expect(result.map(record => record.repository_key)).toEqual([
      '1:uganda',
      '1:uganda/3:mulago',
    ]);

    const facilityRecord = result.find(
      record => record.repository_key === '1:uganda/3:mulago',
    );
    expect(facilityRecord?.parent_repository_key).toBe('1:uganda');
    expect(facilityRecord?.source_lineage_label).toBe('A,B');
    expect(facilityRecord?.provenance?.hasCollapsedAncestors).toBe(true);
    expect(facilityRecord?.provenance?.collapsedAncestorKeys).toEqual([
      'OU_A_DISTRICT',
      'OU_B_DISTRICT',
    ]);
    expect(
      facilityRecord?.lineage.every(
        lineage =>
          Array.isArray(lineage.provenance?.collapsedAncestors) &&
          lineage.provenance?.collapsedAncestors.length === 1,
      ),
    ).toBe(true);
    expect(
      facilityRecord?.lineage.map(lineage => ({
        source: lineage.source_org_unit_uid,
        effectiveParent:
          lineage.provenance?.effectiveParentSourceOrgUnitUid,
        collapsed:
          lineage.provenance?.collapsedAncestorKeys,
      })),
    ).toEqual([
      {
        source: 'OU_A_FACILITY',
        effectiveParent: 'OU_A_ROOT',
        collapsed: ['OU_A_DISTRICT'],
      },
      {
        source: 'OU_B_FACILITY',
        effectiveParent: 'OU_B_ROOT',
        collapsed: ['OU_B_DISTRICT'],
      },
    ]);
  });

  it('drops unmatched auto-merge records when configured', () => {
    const result = resolveRepositoryOrgUnits({
      approach: 'auto_merge',
      dataScope: 'children',
      lowestDataLevelToUse: 2,
      sharedSelectedOrgUnits: ['OU_A_ROOT', 'OU_B_ROOT'],
      sharedMetadata,
      levelMapping: {
        enabled: true,
        rows: [
          {
            merged_level: 1,
            label: 'Country',
            instance_levels: { '101': 1, '102': 1 },
          },
          {
            merged_level: 2,
            label: 'District',
            instance_levels: { '101': 2, '102': 2 },
          },
        ],
      },
      autoMerge: {
        fallback_behavior: 'drop_unmatched',
        unresolved_conflicts: 'preserve_for_review',
      },
    });

    expect(result.map(record => record.repository_key)).toEqual([
      '1:uganda',
      '1:uganda/2:kampala',
    ]);
  });

  it('keeps reporting units separate per instance with source-specific keys', () => {
    const result = resolveRepositoryOrgUnits({
      approach: 'separate',
      dataScope: 'selected',
      separateInstanceConfigs: [
        {
          instance_id: 101,
          data_scope: 'selected',
          lowest_data_level_to_use: 2,
          selected_org_units: ['OU_A_DISTRICT'],
          selected_org_unit_details: [],
        },
        {
          instance_id: 102,
          data_scope: 'selected',
          lowest_data_level_to_use: 2,
          selected_org_units: ['OU_B_DISTRICT'],
          selected_org_unit_details: [],
        },
      ],
      separateMetadata: {
        101: sharedMetadata.filter(unit => unit.sourceInstanceIds.includes(101)),
        102: sharedMetadata.filter(unit => unit.sourceInstanceIds.includes(102)),
      },
    });

    expect(result.map(record => record.repository_key)).toEqual([
      'I101::OU_A_DISTRICT',
      'I102::OU_B_DISTRICT',
    ]);
    expect(result[0].lineage[0].instance_id).toBe(101);
    expect(result[1].lineage[0].instance_id).toBe(102);
  });

  it('enforces the lowest data level to use when expanding descendants', () => {
    const result = resolveRepositoryOrgUnits({
      approach: 'primary_instance',
      dataScope: 'all_levels',
      lowestDataLevelToUse: 2,
      primaryInstanceId: 101,
      sharedSelectedOrgUnits: ['OU_A_ROOT'],
      sharedMetadata,
    });

    expect(result.map(record => record.repository_key)).toEqual([
      'OU_A_ROOT',
      'OU_A_DISTRICT',
      'OU_A_GULU',
    ]);
    expect(result.find(record => record.repository_key === 'OU_A_FACILITY')).toBeUndefined();
  });
});
