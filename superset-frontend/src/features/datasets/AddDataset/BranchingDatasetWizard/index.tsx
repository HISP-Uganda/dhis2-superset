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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { styled, SupersetClient, logging, t } from '@superset-ui/core';
import { Typography, Loading } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Card,
  Divider,
  Empty,
  Input,
  Progress,
  Radio,
  Select,
  Space,
  Steps,
  Tabs,
  Tag,
} from 'antd';

import { useToasts } from 'src/components/MessageToasts/withToasts';
import type { DatabaseObject } from 'src/components';
import type {
  DatabaseRepositoryEnabledDimensions,
  RepositoryEnabledGroupDimension,
  RepositoryEnabledGroupSetDimension,
  RepositoryEnabledLevelDimension,
  RepositoryOrgUnitLineage,
} from 'src/features/databases/types';
import type {
  DHIS2MetadataRefreshFamilyProgress,
  DHIS2MetadataRefreshInstanceProgress,
  DHIS2MetadataStatus,
} from 'src/features/dhis2/types';
import {
  formatCount,
  formatDateTime,
  getErrorMessage,
  getStatusColor,
} from 'src/features/dhis2/utils';
import TableSelector from 'src/components/TableSelector';
import WizardStepDataElements from '../DHIS2DatasetWizard/steps/StepDataElements';
import WizardStepPeriods from '../DHIS2DatasetWizard/steps/StepPeriods';
import WizardStepOrgUnits, {
  type StepOrgUnitsMetadataPayload,
} from '../DHIS2DatasetWizard/steps/StepOrgUnits';
import WizardStepSchedule, {
  type ScheduleConfig,
} from '../DHIS2DatasetWizard/steps/StepSchedule';
import type {
  LevelMappingConfig,
} from '../DHIS2DatasetWizard/index';
import buildStagedDhIS2DatasetPayload from '../buildStagedDhIS2DatasetPayload';
import refreshDatasetMetadata from '../refreshDatasetMetadata';

const { Title, Paragraph, Text } = Typography;

type DatasetType = 'dhis2' | 'database';
type DatabaseSourceMode = 'table' | 'sql';
type DataLevelScope = 'selected' | 'children' | 'grandchildren' | 'all_levels';
type OrgUnitSourceMode = 'primary' | 'repository' | 'per_instance' | 'federated';
type RepositoryDimensionKeys = {
  levels: string[];
  groups: string[];
  group_sets: string[];
};
type RepositoryDimensionOption = {
  value: string;
  label: string;
};

interface SelectedOrgUnitDetail {
  id: string;
  selectionKey?: string;
  sourceOrgUnitId?: string;
  displayName: string;
  parentId?: string;
  level?: number;
  path?: string;
  sourceInstanceIds?: number[];
  sourceInstanceNames?: string[];
  repositoryLevel?: number;
  repositoryLevelName?: string;
  repositoryKey?: string;
  sourceLineageLabel?: string | null;
  strategy?: string | null;
  lineage?: RepositoryOrgUnitLineage[];
  provenance?: Record<string, unknown> | null;
}

interface StagingCapabilities {
  source_type?: string;
  builder_mode?: string;
  staging_supported?: boolean;
  background_refresh_forced?: boolean;
  requires_instance_selection?: boolean;
  supports_connection_scoping?: boolean;
  database_name?: string;
}

interface StagedSourceResult {
  source?: {
    id: number;
    source_name: string;
  } | null;
  capabilities?: StagingCapabilities;
}

interface DHIS2InstanceInfo {
  id: number;
  database_id: number;
  database_name?: string | null;
  name: string;
  url: string;
  auth_type: 'basic' | 'pat';
  is_active: boolean;
  description?: string | null;
  display_order?: number;
  last_test_status?: 'success' | 'failed' | null;
  last_test_message?: string | null;
  last_test_response_time_ms?: number | null;
  last_tested_on?: string | null;
}

interface VariableMapping {
  variableId: string;
  variableName: string;
  variableType: string;
  instanceId: number;
  instanceName: string;
  alias?: string;
}

interface WorkflowState {
  datasetType: DatasetType | null;
  sourceKind: 'dhis2' | 'database' | 'table' | 'sql' | null;
  database: DatabaseObject | null;
  databaseId: number | null;
  dhis2SourceId: number | null;
  stagingCapabilities: StagingCapabilities | null;
  databaseSourceMode: DatabaseSourceMode;
  catalog: string | null;
  schema: string | null;
  tableName: string | null;
  sql: string;
  selectedInstanceIds: number[];
  configuredConnectionsTouched: boolean;
  orgUnitSourceMode: OrgUnitSourceMode;
  primaryOrgUnitInstanceId: number | null;
  selectedVariables: VariableMapping[];
  periods: string[];
  periodsAutoDetect: boolean;
  /** 'relative' = single DHIS2 relative period; 'fixed_range' = start–end date range */
  defaultPeriodRangeType?: 'relative' | 'fixed_range';
  /** DHIS2 relative period identifier used as default when auto-detect is on */
  defaultRelativePeriod?: string;
  /** ISO date strings for fixed date-range default (inclusive) */
  defaultPeriodStart?: string | null;
  defaultPeriodEnd?: string | null;
  orgUnits: string[];
  orgUnitsAutoDetect: boolean;
  selectedOrgUnitDetails: SelectedOrgUnitDetail[];
  includeChildren: boolean;
  dataLevelScope: DataLevelScope;
  levelMapping?: LevelMappingConfig;
  /** Lowest hierarchy level to include (1=national, N=facility). */
  maxOrgUnitLevel?: number | null;
  repositoryDimensionKeys: RepositoryDimensionKeys;
  repositoryDimensionKeysConfigured: boolean;
  /** When true, co_uid/co_name disaggregation columns are promoted to first-class dimensions. */
  includeDisaggregationDimension?: boolean;
  datasetSettings: {
    name: string;
    description: string;
    nameTouched: boolean;
  };
  scheduleConfig: ScheduleConfig;
  reviewState: {
    createChart: boolean;
  };
}

type WorkflowAction =
  | { type: 'SET_DATASET_TYPE'; payload: DatasetType | null }
  | { type: 'SET_SOURCE'; payload: DatabaseObject | null }
  | {
      type: 'SET_SOURCE_METADATA';
      payload: {
        dhis2SourceId?: number | null;
        stagingCapabilities?: StagingCapabilities | null;
      };
    }
  | {
      type: 'SET_DATABASE_SOURCE_MODE';
      payload: DatabaseSourceMode;
    }
  | {
      type: 'SET_DATABASE_SOURCE_SELECTION';
      payload: {
        catalog?: string | null;
        schema?: string | null;
        tableName?: string | null;
      };
    }
  | { type: 'SET_SQL'; payload: string }
  | {
      type: 'SET_SELECTED_INSTANCE_IDS';
      payload: {
        ids: number[];
        touched?: boolean;
      };
    }
  | { type: 'PATCH_DHIS2_SELECTION'; payload: Record<string, unknown> }
  | {
      type: 'PATCH_DATASET_SETTINGS';
      payload: Partial<WorkflowState['datasetSettings']>;
    }
  | {
      type: 'SET_SCHEDULE_CONFIG';
      payload: ScheduleConfig;
    };

const DEFAULT_SCHEDULE: ScheduleConfig = {
  preset: 'daily',
  cron: '0 5 * * *',
  timezone: 'UTC',
};

const PREV_URL =
  '/tablemodelview/list/?pageIndex=0&sortColumn=changed_on_delta_humanized&sortOrder=desc';

const SHELL_BREAKPOINT = 1100;
const METADATA_POLL_INTERVAL_MS = 4000;

function isStagedLocalDatasetPayload(payload: Record<string, unknown>): boolean {
  const { extra } = payload;
  if (typeof extra !== 'string') {
    return false;
  }

  try {
    return JSON.parse(extra).dhis2_staged_local === true;
  } catch {
    return false;
  }
}

export const WORKFLOW_STEPS: Record<
  DatasetType,
  Array<{ key: string; title: string; description: string }>
> = {
  dhis2: [
    {
      key: 'database_selection',
      title: t('Database'),
      description: t('Choose the DHIS2 database'),
    },
    {
      key: 'data_selection',
      title: t('Data Selection'),
      description: t('Select variables, periods, and org units'),
    },
    {
      key: 'dataset_settings',
      title: t('Dataset Settings'),
      description: t('Name, description, and schedule'),
    },
    {
      key: 'review',
      title: t('Review & Create'),
      description: t('Confirm the staging setup'),
    },
  ],
  database: [
    {
      key: 'database_selection',
      title: t('Database'),
      description: t('Choose the database connection'),
    },
    {
      key: 'source_selection',
      title: t('Table / Query Source'),
      description: t('Pick a table or provide SQL'),
    },
    {
      key: 'dataset_settings',
      title: t('Dataset Settings'),
      description: t('Name, description, and schedule'),
    },
    {
      key: 'review',
      title: t('Review & Create'),
      description: t('Confirm the serving configuration'),
    },
  ],
};

export const initialWorkflowState: WorkflowState = {
  datasetType: null,
  sourceKind: null,
  database: null,
  databaseId: null,
  dhis2SourceId: null,
  stagingCapabilities: null,
  databaseSourceMode: 'table',
  catalog: null,
  schema: null,
  tableName: null,
  sql: '',
  selectedInstanceIds: [],
  configuredConnectionsTouched: false,
  orgUnitSourceMode: 'repository',
  primaryOrgUnitInstanceId: null,
  selectedVariables: [],
  periods: [],
  periodsAutoDetect: false,
  defaultPeriodRangeType: 'relative',
  defaultRelativePeriod: 'LAST_12_MONTHS',
  defaultPeriodStart: null,
  defaultPeriodEnd: null,
  orgUnits: [],
  orgUnitsAutoDetect: false,
  selectedOrgUnitDetails: [],
  includeChildren: false,
  dataLevelScope: 'selected',
  levelMapping: undefined,
  maxOrgUnitLevel: null,
  repositoryDimensionKeys: {
    levels: [],
    groups: [],
    group_sets: [],
  },
  repositoryDimensionKeysConfigured: false,
  includeDisaggregationDimension: false,
  datasetSettings: {
    name: '',
    description: '',
    nameTouched: false,
  },
  scheduleConfig: DEFAULT_SCHEDULE,
  reviewState: {
    createChart: true,
  },
};

const USER_SCOPE_IDS = new Set([
  'USER_ORGUNIT',
  'USER_ORGUNIT_CHILDREN',
  'USER_ORGUNIT_GRANDCHILDREN',
]);

function buildFallbackCapabilities(database: DatabaseObject | null): StagingCapabilities {
  const sourceType = database?.backend === 'dhis2' ? 'dhis2' : 'sql_database';
  return {
    source_type: sourceType,
    builder_mode: sourceType === 'dhis2' ? 'dhis2_federated' : 'sql_table',
    staging_supported: true,
    background_refresh_forced: true,
    requires_instance_selection: false,
    supports_connection_scoping: sourceType === 'dhis2',
    database_name: database?.database_name,
  };
}

function normalizeRepositoryDimensionKeys(
  payload: unknown,
): RepositoryDimensionKeys {
  const candidate =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const normalizeList = (value: unknown) =>
    Array.isArray(value)
      ? value.filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0,
        )
      : [];
  return {
    levels: normalizeList(candidate.levels),
    groups: normalizeList(candidate.groups),
    group_sets: normalizeList(candidate.group_sets),
  };
}

function buildRepositoryLevelDimensionOptions(
  enabledDimensions: DatabaseRepositoryEnabledDimensions | null | undefined,
  metadata: StepOrgUnitsMetadataPayload | null,
): RepositoryDimensionOption[] {
  const enabledDimensionsConfigured =
    metadata?.repositoryConfig?.enabled_dimensions &&
    Object.prototype.hasOwnProperty.call(
      metadata.repositoryConfig.enabled_dimensions,
      'levels',
    );
  const configuredLevels = Array.isArray(enabledDimensions?.levels)
    ? enabledDimensions.levels
    : [];
  if (enabledDimensionsConfigured) {
    return configuredLevels.map((item: RepositoryEnabledLevelDimension) => ({
      value: item.key,
      label: item.label,
    }));
  }
  return (metadata?.orgUnitLevels || []).map(level => ({
    value: `level:${level.level}`,
    label: level.displayName,
  }));
}

function buildRepositoryNamedDimensionOptions(
  items:
    | RepositoryEnabledGroupDimension[]
    | RepositoryEnabledGroupSetDimension[]
    | null
    | undefined,
): RepositoryDimensionOption[] {
  return Array.isArray(items)
    ? items.map(item => ({
        value: item.key,
        label: item.label,
      }))
    : [];
}

function mergeRepositoryDimensionOptions(
  options: RepositoryDimensionOption[],
  selectedKeys: string[],
): RepositoryDimensionOption[] {
  const merged = new Map(options.map(option => [option.value, option] as const));
  selectedKeys.forEach(key => {
    if (!merged.has(key)) {
      merged.set(key, { value: key, label: key });
    }
  });
  return Array.from(merged.values());
}

export function resetForDatasetType(datasetType: DatasetType | null): WorkflowState {
  return {
    ...initialWorkflowState,
    datasetType,
    sourceKind: datasetType === 'dhis2' ? 'dhis2' : datasetType,
  };
}

export function workflowReducer(
  state: WorkflowState,
  action: WorkflowAction,
): WorkflowState {
  switch (action.type) {
    case 'SET_DATASET_TYPE':
      return resetForDatasetType(action.payload);
    case 'SET_SOURCE':
      return {
        ...resetForDatasetType(
          action.payload ? (action.payload.backend === 'dhis2' ? 'dhis2' : 'database') : null,
        ),
        database: action.payload,
        databaseId: action.payload?.id ?? null,
        dhis2SourceId: null,
        stagingCapabilities: action.payload
          ? buildFallbackCapabilities(action.payload)
          : null,
        catalog: null,
        schema: null,
        tableName: null,
        sql: '',
        selectedInstanceIds: [],
        configuredConnectionsTouched: false,
        orgUnitSourceMode: 'repository',
        primaryOrgUnitInstanceId: null,
        selectedVariables: [],
        periods: [],
        periodsAutoDetect: false,
        orgUnits: [],
        orgUnitsAutoDetect: false,
        selectedOrgUnitDetails: [],
        includeChildren: false,
        dataLevelScope: 'selected',
        levelMapping: undefined,
        datasetSettings: {
          ...state.datasetSettings,
          name: '',
          nameTouched: false,
        },
      };
    case 'SET_SOURCE_METADATA':
      return {
        ...state,
        dhis2SourceId:
          action.payload.dhis2SourceId ?? state.dhis2SourceId ?? null,
        stagingCapabilities:
          action.payload.stagingCapabilities ?? state.stagingCapabilities,
      };
    case 'SET_DATABASE_SOURCE_MODE':
      return {
        ...state,
        databaseSourceMode: action.payload,
        sourceKind: action.payload,
        tableName: action.payload === 'sql' ? null : state.tableName,
        sql: action.payload === 'table' ? '' : state.sql,
        datasetSettings:
          action.payload === 'table'
            ? {
                ...state.datasetSettings,
                nameTouched: false,
              }
            : state.datasetSettings,
      };
    case 'SET_DATABASE_SOURCE_SELECTION': {
      const nextTableName =
        action.payload.tableName === undefined
          ? state.tableName
          : action.payload.tableName;
      const nextDatasetName =
        !state.datasetSettings.nameTouched && nextTableName
          ? nextTableName
          : state.datasetSettings.name;
      return {
        ...state,
        catalog:
          action.payload.catalog === undefined ? state.catalog : action.payload.catalog,
        schema:
          action.payload.schema === undefined ? state.schema : action.payload.schema,
        tableName: nextTableName,
        datasetSettings: {
          ...state.datasetSettings,
          name: nextDatasetName,
        },
      };
    }
    case 'SET_SQL':
      return {
        ...state,
        sql: action.payload,
      };
    case 'SET_SELECTED_INSTANCE_IDS': {
      const validIds = new Set(action.payload.ids);
      const filteredVariables = state.selectedVariables.filter(variable =>
        validIds.has(variable.instanceId),
      );
      const nextPrimaryOrgUnitInstanceId =
        action.payload.ids.length === 1
          ? action.payload.ids[0]
          : state.primaryOrgUnitInstanceId;
      let filteredOrgUnitDetails = state.selectedOrgUnitDetails;
      let filteredOrgUnits = state.orgUnits;
      let resolvedPrimaryOrgUnitInstanceId = nextPrimaryOrgUnitInstanceId;

      if (
        state.orgUnitSourceMode === 'federated' ||
        state.orgUnitSourceMode === 'repository' ||
        state.orgUnitSourceMode === 'per_instance'
      ) {
        if (state.selectedOrgUnitDetails.length > 0) {
          filteredOrgUnitDetails = state.selectedOrgUnitDetails.filter(detail => {
            const lineage = detail.sourceInstanceIds || [];
            return lineage.length === 0 || lineage.some(id => validIds.has(id));
          });
          const validOrgUnitIds = new Set(
            filteredOrgUnitDetails.map(detail => detail.id),
          );
          filteredOrgUnits = state.orgUnits.filter(
            orgUnitId => USER_SCOPE_IDS.has(orgUnitId) || validOrgUnitIds.has(orgUnitId),
          );
        }
      } else if (
        resolvedPrimaryOrgUnitInstanceId !== null &&
        !validIds.has(resolvedPrimaryOrgUnitInstanceId)
      ) {
        resolvedPrimaryOrgUnitInstanceId = action.payload.ids[0] ?? null;
        filteredOrgUnitDetails = [];
        filteredOrgUnits = state.orgUnits.filter(orgUnitId =>
          USER_SCOPE_IDS.has(orgUnitId),
        );
      }

      return {
        ...state,
        selectedInstanceIds: action.payload.ids,
        configuredConnectionsTouched:
          action.payload.touched ?? state.configuredConnectionsTouched,
        primaryOrgUnitInstanceId: resolvedPrimaryOrgUnitInstanceId,
        selectedVariables: filteredVariables,
        orgUnits: filteredOrgUnits,
        selectedOrgUnitDetails: filteredOrgUnitDetails,
      };
    }
    case 'PATCH_DHIS2_SELECTION':
      return {
        ...state,
        selectedVariables:
          (action.payload.selectedVariables as VariableMapping[] | undefined) ??
          state.selectedVariables,
        periods:
          (action.payload.periods as string[] | undefined) ?? state.periods,
        periodsAutoDetect:
          (action.payload.periodsAutoDetect as boolean | undefined) ??
          state.periodsAutoDetect,
        defaultPeriodRangeType:
          action.payload.defaultPeriodRangeType !== undefined
            ? (action.payload.defaultPeriodRangeType as 'relative' | 'fixed_range')
            : state.defaultPeriodRangeType,
        defaultRelativePeriod:
          action.payload.defaultRelativePeriod !== undefined
            ? (action.payload.defaultRelativePeriod as string)
            : state.defaultRelativePeriod,
        defaultPeriodStart:
          action.payload.defaultPeriodStart !== undefined
            ? (action.payload.defaultPeriodStart as string | null)
            : state.defaultPeriodStart,
        defaultPeriodEnd:
          action.payload.defaultPeriodEnd !== undefined
            ? (action.payload.defaultPeriodEnd as string | null)
            : state.defaultPeriodEnd,
        orgUnits:
          (action.payload.orgUnits as string[] | undefined) ?? state.orgUnits,
        orgUnitsAutoDetect:
          (action.payload.orgUnitsAutoDetect as boolean | undefined) ??
          state.orgUnitsAutoDetect,
        selectedOrgUnitDetails:
          (action.payload.selectedOrgUnitDetails as SelectedOrgUnitDetail[] | undefined) ??
          state.selectedOrgUnitDetails,
        includeChildren:
          (action.payload.includeChildren as boolean | undefined) ??
          state.includeChildren,
        dataLevelScope:
          (action.payload.dataLevelScope as DataLevelScope | undefined) ??
          state.dataLevelScope,
        orgUnitSourceMode:
          (action.payload.orgUnitSourceMode as OrgUnitSourceMode | undefined) ??
          state.orgUnitSourceMode,
        primaryOrgUnitInstanceId:
          (action.payload.primaryOrgUnitInstanceId as number | null | undefined) ??
          state.primaryOrgUnitInstanceId,
        levelMapping:
          action.payload.levelMapping !== undefined
            ? (action.payload.levelMapping as LevelMappingConfig | undefined)
            : state.levelMapping,
        maxOrgUnitLevel:
          action.payload.maxOrgUnitLevel !== undefined
            ? (action.payload.maxOrgUnitLevel as number | null)
            : state.maxOrgUnitLevel,
        repositoryDimensionKeys:
          action.payload.repositoryDimensionKeys !== undefined
            ? normalizeRepositoryDimensionKeys(action.payload.repositoryDimensionKeys)
            : state.repositoryDimensionKeys,
        repositoryDimensionKeysConfigured:
          action.payload.repositoryDimensionKeys !== undefined
            ? (action.payload.repositoryDimensionKeysConfigured as boolean | undefined) ??
              true
            : action.payload.repositoryDimensionKeysConfigured !== undefined
              ? (action.payload.repositoryDimensionKeysConfigured as boolean)
              : state.repositoryDimensionKeysConfigured,
        includeDisaggregationDimension:
          (action.payload.includeDisaggregationDimension as boolean | undefined) ??
          state.includeDisaggregationDimension,
      };
    case 'PATCH_DATASET_SETTINGS':
      return {
        ...state,
        datasetSettings: {
          ...state.datasetSettings,
          ...action.payload,
        },
      };
    case 'SET_SCHEDULE_CONFIG':
      return {
        ...state,
        scheduleConfig: action.payload,
      };
    default:
      return state;
  }
}

export function normalizeInstancesPayload(payload: unknown): DHIS2InstanceInfo[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { result?: unknown[] } | undefined)?.result)
      ? ((payload as { result?: unknown[] }).result as unknown[])
      : [];

  const normalized: DHIS2InstanceInfo[] = [];
  raw.forEach(item => {
    const instance = item as Record<string, unknown>;
    if (
      typeof instance.id !== 'number' ||
      typeof instance.name !== 'string' ||
      typeof instance.url !== 'string'
    ) {
      return;
    }

    normalized.push({
      id: instance.id,
      database_id:
        typeof instance.database_id === 'number' ? instance.database_id : 0,
      name: instance.name,
      url: instance.url,
      auth_type: instance.auth_type === 'pat' ? 'pat' : 'basic',
      is_active:
        typeof instance.is_active === 'boolean' ? instance.is_active : true,
      description:
        typeof instance.description === 'string' ? instance.description : null,
      display_order:
        typeof instance.display_order === 'number' ? instance.display_order : 0,
      last_test_status:
        instance.last_test_status === 'success' || instance.last_test_status === 'failed'
          ? instance.last_test_status
          : null,
      last_test_message:
        typeof instance.last_test_message === 'string'
          ? instance.last_test_message
          : null,
      last_test_response_time_ms:
        typeof instance.last_test_response_time_ms === 'number'
          ? instance.last_test_response_time_ms
          : null,
      last_tested_on:
        typeof instance.last_tested_on === 'string' ? instance.last_tested_on : null,
    });
  });

  return normalized.sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return left.is_active ? -1 : 1;
    }
    if ((left.display_order ?? 0) !== (right.display_order ?? 0)) {
      return (left.display_order ?? 0) - (right.display_order ?? 0);
    }
    return left.name.localeCompare(right.name);
  });
}

export function deriveNextInstanceSelection(
  nextInstances: DHIS2InstanceInfo[],
  currentSelection: number[],
  touched = false,
): number[] {
  const nextActiveIds = nextInstances
    .filter(instance => instance.is_active)
    .map(instance => instance.id);
  if (!touched) {
    return nextActiveIds;
  }
  return currentSelection.filter(id => nextActiveIds.includes(id));
}

function metadataNeedsAttention(status?: string | null): boolean {
  return status !== 'ready';
}

function formatMetadataStatus(status?: string | null): string {
  switch (status) {
    case 'ready':
      return t('Ready');
    case 'partial':
      return t('Partially ready');
    case 'pending':
      return t('Loading');
    case 'failed':
      return t('Failed');
    case 'missing':
      return t('Not staged yet');
    default:
      return t('Unknown');
  }
}

function formatRefreshProgressStatus(status?: string | null): string {
  switch (status) {
    case 'queued':
      return t('Queued');
    case 'running':
      return t('Loading');
    case 'partial':
      return t('Loading with some failures');
    case 'complete':
      return t('Completed');
    case 'failed':
      return t('Failed');
    default:
      return t('Unknown');
  }
}

function getProgressStatus(
  status?: string | null,
): 'normal' | 'success' | 'exception' | 'active' {
  switch (status) {
    case 'queued':
    case 'running':
      return 'active';
    case 'complete':
      return 'success';
    case 'failed':
      return 'exception';
    default:
      return 'normal';
  }
}

function formatRefreshProgressCounter(
  progress?:
    | DHIS2MetadataRefreshFamilyProgress
    | DHIS2MetadataRefreshInstanceProgress
    | null,
): string {
  if (!progress) {
    return t('Waiting for staged metadata');
  }
  if (
    progress.total_count_estimate !== null &&
    progress.total_count_estimate !== undefined &&
    progress.total_count_estimate > 0
  ) {
    return t(
      '%s of %s loaded',
      formatCount(progress.loaded_count),
      formatCount(progress.total_count_estimate),
    );
  }
  return t('%s loaded', formatCount(progress.loaded_count));
}

function formatScheduleSummary(schedule: ScheduleConfig): string {
  const presetLabels: Record<ScheduleConfig['preset'], string> = {
    hourly: t('Hourly'),
    every6h: t('Every 6 hours'),
    daily: t('Daily at 5 AM'),
    weekly: t('Weekly'),
    monthly: t('Monthly'),
    custom: t('Custom cron'),
  };

  return schedule.preset === 'custom'
    ? `${presetLabels.custom}: ${schedule.cron} (${schedule.timezone})`
    : `${presetLabels[schedule.preset]} (${schedule.timezone})`;
}

function useResponsiveShell(breakpoint = SHELL_BREAKPOINT): boolean {
  const [isCompact, setIsCompact] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsCompact(window.innerWidth < breakpoint);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [breakpoint]);

  return isCompact;
}

function useAvailableDatabases() {
  const [databases, setDatabases] = useState<DatabaseObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      requestIdRef.current += 1;
    },
    [],
  );

  const loadDatabases = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!isMountedRef.current) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const endpoint = '/api/v1/database/dataset_sources/';
      const response = await SupersetClient.get({ endpoint });
      if (requestId !== requestIdRef.current) {
        return;
      }

      const nextDatabases = (
        (response.json as { result?: DatabaseObject[] })?.result || []
      )
        .map(database => ({
          id: database.id,
          database_name: database.database_name,
          backend: database.backend,
          allow_multi_catalog: database.allow_multi_catalog,
        }));
      if (!isMountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      setDatabases(nextDatabases);
    } catch (error) {
      if (!isMountedRef.current || requestId !== requestIdRef.current) {
        return;
      }

      const message =
        error instanceof Error ? error.message : t('Failed to load databases.');
      setError(message);
    } finally {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  return {
    databases,
    loading,
    error,
    retry: loadDatabases,
  };
}

const WizardShell = styled.div<{ compact: boolean }>`
  ${({ theme, compact }) => `
    padding: ${theme.sizeUnit * 6}px;
    background:
      radial-gradient(circle at top left, ${theme.colorPrimaryBg} 0%, transparent 38%),
      linear-gradient(180deg, ${theme.colorBgLayout} 0%, ${theme.colorBgBase} 100%);
    min-height: 100%;

    .wizard-frame {
      max-width: 1440px;
      margin: 0 auto;
      background: ${theme.colorBgBase};
      border: 1px solid ${theme.colorBorderSecondary};
      border-radius: ${theme.borderRadiusLG}px;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.06);
    }

    .wizard-header {
      padding: ${theme.sizeUnit * 5}px;
      border-bottom: 1px solid ${theme.colorBorderSecondary};
      background: linear-gradient(180deg, ${theme.colorBgElevated}, ${theme.colorBgBase});
    }

    .wizard-header-top {
      display: flex;
      justify-content: space-between;
      gap: ${theme.sizeUnit * 4}px;
      align-items: flex-start;
      margin-bottom: ${theme.sizeUnit * 4}px;
      flex-wrap: wrap;
    }

    .wizard-body {
      display: grid;
      grid-template-columns: ${compact ? '1fr' : 'minmax(0, 1.75fr) 340px'};
      gap: ${theme.sizeUnit * 5}px;
      padding: ${theme.sizeUnit * 5}px;
      align-items: start;
    }

    .wizard-main {
      min-width: 0;
    }

    .wizard-sidebar {
      position: ${compact ? 'static' : 'sticky'};
      top: ${theme.sizeUnit * 5}px;
    }

    .wizard-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: ${theme.sizeUnit * 3}px;
      border-top: 1px solid ${theme.colorBorderSecondary};
      padding: ${theme.sizeUnit * 4}px ${theme.sizeUnit * 5}px;
      flex-wrap: wrap;
      background: ${theme.colorBgElevated};
    }

    .section-card {
      border-radius: ${theme.borderRadiusLG}px;
      border-color: ${theme.colorBorderSecondary};
    }

    .section-subtitle {
      color: ${theme.colorTextSecondary};
      margin-bottom: ${theme.sizeUnit * 4}px;
    }
  `}
`;

const SourceCard = styled(Card)`
  ${({ theme }) => `
    border-radius: ${theme.borderRadiusLG}px;
    border-color: ${theme.colorBorderSecondary};
  `}
`;

const SourceStatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
`;

const SourceMetric = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadius}px;
    padding: ${theme.sizeUnit * 3}px;
    background: ${theme.colorBgContainer};

    .metric-label {
      color: ${theme.colorTextSecondary};
      font-size: 12px;
      margin-bottom: ${theme.sizeUnit}px;
    }

    .metric-value {
      font-size: 16px;
      font-weight: ${theme.fontWeightStrong};
      color: ${theme.colorText};
      word-break: break-word;
    }
  `}
`;

const ProgressStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
`;

const ProgressCard = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadiusLG}px;
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
    background: ${theme.colorBgContainer};
  `}
`;

const ProgressInstanceList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
`;

const InstanceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
`;

const InstanceCard = styled.div<{ inactive: boolean; selected: boolean }>`
  ${({ theme, inactive, selected }) => `
    text-align: left;
    border: 1px solid ${selected ? theme.colorPrimary : theme.colorBorderSecondary};
    background: ${selected ? theme.colorPrimaryBg : theme.colorBgElevated};
    border-radius: ${theme.borderRadiusLG}px;
    padding: ${theme.sizeUnit * 4}px;
    opacity: ${inactive ? 0.7 : 1};
    transition: border-color 0.2s ease, background 0.2s ease;

    .instance-name {
      font-size: 16px;
      font-weight: ${theme.fontWeightStrong};
      margin-bottom: ${theme.sizeUnit}px;
      color: ${theme.colorText};
    }

    .instance-url {
      color: ${theme.colorTextSecondary};
      font-size: 12px;
      margin-bottom: ${theme.sizeUnit * 2}px;
      word-break: break-word;
    }

    .instance-description {
      color: ${theme.colorTextSecondary};
      font-size: 12px;
      line-height: 1.6;
      margin-top: ${theme.sizeUnit * 2}px;
      min-height: 38px;
    }
  `}
`;

const SummaryCard = styled(Card)`
  ${({ theme }) => `
    border-radius: ${theme.borderRadiusLG}px;
    border-color: ${theme.colorBorderSecondary};

    .summary-section + .summary-section {
      margin-top: ${theme.sizeUnit * 4}px;
      padding-top: ${theme.sizeUnit * 4}px;
      border-top: 1px solid ${theme.colorBorderSecondary};
    }

    .summary-label {
      color: ${theme.colorTextSecondary};
      font-size: 12px;
      margin-bottom: ${theme.sizeUnit}px;
    }

    .summary-value {
      font-size: 14px;
      font-weight: ${theme.fontWeightStrong};
      color: ${theme.colorText};
      word-break: break-word;
    }

    .summary-list {
      display: flex;
      flex-wrap: wrap;
      gap: ${theme.sizeUnit * 1.5}px;
    }
  `}
`;

const VariablePreviewList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const VariablePreviewItem = styled.div`
  ${({ theme }) => `
    display: flex;
    justify-content: space-between;
    gap: ${theme.sizeUnit * 3}px;
    padding: ${theme.sizeUnit * 2.5}px ${theme.sizeUnit * 3}px;
    background: ${theme.colorBgContainer};
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadius}px;
    align-items: center;
  `}
`;

const SourceSelectionStep = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const SourceOptionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
`;

const SourceOptionCard = styled.button<{ selected: boolean }>`
  ${({ theme, selected }) => `
    width: 100%;
    text-align: left;
    border: 1px solid ${selected ? theme.colorPrimary : theme.colorBorderSecondary};
    background: ${selected ? theme.colorPrimaryBg : theme.colorBgElevated};
    border-radius: ${theme.borderRadiusLG}px;
    padding: ${theme.sizeUnit * 4}px;
    cursor: pointer;
    transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;

    &:hover {
      border-color: ${theme.colorPrimary};
      transform: translateY(-1px);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.05);
    }

    .source-name {
      font-size: 15px;
      font-weight: ${theme.fontWeightStrong};
      margin-bottom: ${theme.sizeUnit}px;
      color: ${theme.colorText};
    }

    .source-backend {
      color: ${theme.colorTextSecondary};
      font-size: 12px;
      margin-bottom: ${theme.sizeUnit * 2}px;
    }
  `}
`;

const SettingsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
`;

const HelpNote = styled.div`
  ${({ theme }) => `
    color: ${theme.colorTextSecondary};
    font-size: 12px;
    line-height: 1.6;
  `}
`;

const ReviewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
`;

function getFlowTitle(datasetType: DatasetType | null): string {
  if (datasetType === 'dhis2') {
    return t('Create a staged DHIS2 dataset');
  }
  if (datasetType === 'database') {
    return t('Create a database dataset');
  }
  return t('Create a dataset');
}

function getFlowDescription(datasetType: DatasetType | null): string {
  if (datasetType === 'dhis2') {
    return t(
      'Choose a DHIS2 Database once, review its saved DHIS2 instances, and create a staged analytical dataset served locally in Superset.',
    );
  }
  if (datasetType === 'database') {
    return t(
      'Choose a database connection, select a table or SQL source, and create a clean dataset with a shorter, clearer setup flow.',
    );
  }
  return t(
    'Start by choosing a Database. The remaining workflow adapts automatically to that Database type.',
  );
}

function getStepErrorsForCurrentState(
  state: WorkflowState,
  instances: DHIS2InstanceInfo[],
  options: {
    instancesLoading?: boolean;
    instancesError?: string | null;
  } = {},
): Record<string, string> {
  if (!state.datasetType) {
    return {
      source: t('Select a Database to continue.'),
    };
  }

  const steps = WORKFLOW_STEPS[state.datasetType];
  const errors: Record<string, string> = {};

  if (state.datasetType === 'dhis2') {
    if (!state.databaseId) {
      errors.source = t('Select a DHIS2 database to continue.');
      return errors;
    }
    if (options.instancesLoading) {
      errors.instances = t(
        'Configured DHIS2 connections are still loading for the selected Database.',
      );
      return errors;
    }
    if (options.instancesError) {
      errors.instances = t(
        'Configured DHIS2 connections could not be loaded from the selected Database. Retry or review the Database configuration before continuing.',
      );
      return errors;
    }
    const activeConfiguredConnections = instances.filter(instance => instance.is_active);
    if (activeConfiguredConnections.length === 0) {
      errors.instances = t(
        'The selected DHIS2 Database does not have any active configured DHIS2 connections yet.',
      );
      return errors;
    }
    if (steps[1]) {
      if (
        state.orgUnitSourceMode === 'primary' &&
        state.selectedInstanceIds.length > 1 &&
        !state.primaryOrgUnitInstanceId
      ) {
        errors.dataSelection = t(
          'Choose the primary configured connection for organisation-unit browsing.',
        );
      }
      if (state.selectedVariables.length === 0) {
        errors.dataSelection =
          errors.dataSelection ||
          t('Choose at least one DHIS2 variable to continue.');
      }
      // Period and org-unit are warehouse dimensions exposed for Superset
      // filtering — they are NOT required at dataset creation time.
    }
  } else {
    if (!state.databaseId) {
      errors.source = t('Select a database source to continue.');
      return errors;
    }
    if (state.databaseSourceMode === 'table') {
      if (!state.schema || !state.tableName) {
        errors.sourceSelection = t('Choose both a schema and a table.');
      }
    }
    if (state.databaseSourceMode === 'sql') {
      if (!state.sql.trim()) {
        errors.sourceSelection = t('Provide a SQL query to continue.');
      }
    }
  }

  if (!state.datasetSettings.name.trim()) {
    errors.settings = t('Dataset name is required.');
  }

  if (state.datasetType === 'dhis2') {
    const activeIds = new Set(instances.filter(instance => instance.is_active).map(instance => instance.id));
    if (state.selectedInstanceIds.some(id => !activeIds.has(id))) {
      errors.instances = t(
        'One or more saved DHIS2 instances are no longer active for this Database.',
      );
    }
  }

  return errors;
}

interface BranchingDatasetWizardProps {
  /** When provided, the wizard loads an existing DHIS2 staged dataset for editing. */
  editDatasetId?: number;
}

export default function BranchingDatasetWizard({ editDatasetId }: BranchingDatasetWizardProps = {}) {
  const history = useHistory();
  const { addDangerToast, addSuccessToast } = useToasts();
  const [state, dispatch] = useReducer(workflowReducer, initialWorkflowState);
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [sourceMetadataLoading, setSourceMetadataLoading] = useState(false);
  const [sourceMetadataError, setSourceMetadataError] = useState<string | null>(null);
  const [metadataStatus, setMetadataStatus] = useState<DHIS2MetadataStatus | null>(null);
  const [metadataStatusLoading, setMetadataStatusLoading] = useState(false);
  const [metadataStatusError, setMetadataStatusError] = useState<string | null>(null);
  const [metadataRefreshLoading, setMetadataRefreshLoading] = useState(false);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [instancesError, setInstancesError] = useState<string | null>(null);
  const [instances, setInstances] = useState<DHIS2InstanceInfo[]>([]);
  const [repositoryOrgUnitMetadata, setRepositoryOrgUnitMetadata] =
    useState<StepOrgUnitsMetadataPayload | null>(null);
  const [instanceTestStatus, setInstanceTestStatus] = useState<
    Record<number, 'idle' | 'testing' | 'success' | 'failed'>
  >({});
  const [instanceTestMessage, setInstanceTestMessage] = useState<Record<number, string>>(
    {},
  );
  const [selectedDataTab, setSelectedDataTab] = useState('variables');
  const [sourceSearch, setSourceSearch] = useState('');
  // Edit mode: track the staged dataset id and loading state
  const [editStagedDatasetId, setEditStagedDatasetId] = useState<number | null>(null);
  const [editLoading, setEditLoading] = useState(!!editDatasetId);
  const isEditMode = !!editDatasetId;
  const isCompact = useResponsiveShell();
  const sourceRequestIdRef = useRef(0);
  const metadataStatusRequestIdRef = useRef(0);
  const instancesRequestIdRef = useRef(0);
  const repositoryDimensionDefaultsAppliedRef = useRef<string | null>(null);
  const selectedInstanceIdsRef = useRef(state.selectedInstanceIds);
  const configuredConnectionsTouchedRef = useRef(
    state.configuredConnectionsTouched,
  );
  const isMountedRef = useRef(true);
  const { databases, loading: databasesLoading, error: databasesError, retry } =
    useAvailableDatabases();

  useEffect(() => {
    selectedInstanceIdsRef.current = state.selectedInstanceIds;
    configuredConnectionsTouchedRef.current = state.configuredConnectionsTouched;
  }, [state.configuredConnectionsTouched, state.selectedInstanceIds]);

  useEffect(() => {
    setRepositoryOrgUnitMetadata(null);
    repositoryDimensionDefaultsAppliedRef.current = null;
  }, [state.databaseId]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      sourceRequestIdRef.current += 1;
      metadataStatusRequestIdRef.current += 1;
      instancesRequestIdRef.current += 1;
    },
    [],
  );

  // Load existing dataset when editing — fires when databases list is ready
  useEffect(() => {
    if (!editDatasetId || databasesLoading || databases.length === 0) return;

    setEditLoading(true);
    (async () => {
      try {
        // 1. Fetch the Superset dataset to get the staged dataset id from extra
        const dsRes = await SupersetClient.get({ endpoint: `/api/v1/dataset/${editDatasetId}` });
        const dsResult = dsRes.json?.result as Record<string, unknown> | undefined;
        let stagedId: number | null = null;
        try {
          const extra = JSON.parse((dsResult?.extra as string) || '{}');
          stagedId = extra?.dhis2_staged_dataset_id ?? null;
        } catch { /* ignore */ }

        if (stagedId === null) {
          // Not a DHIS2 staged dataset — cannot pre-fill
          if (isMountedRef.current) setEditLoading(false);
          return;
        }

        // 2. Fetch the staged dataset configuration
        const sdRes = await SupersetClient.get({
          endpoint: `/api/v1/dhis2/staged-datasets/${stagedId}`,
        });
        const sd = sdRes.json?.result as Record<string, unknown> | null;
        if (!sd || !isMountedRef.current) {
          if (isMountedRef.current) setEditLoading(false);
          return;
        }

        setEditStagedDatasetId(stagedId);

        // 3. Find the matching database object from already-loaded databases
        const dbId = sd.database_id as number;
        const dbObj = databases.find(db => db.id === dbId) ?? null;
        if (dbObj) {
          // SET_SOURCE resets most state so dispatch it first
          dispatch({ type: 'SET_SOURCE', payload: dbObj });
        }

        // 4. Pre-fill DHIS2 selection from dataset_config
        const cfg = (sd.dataset_config as Record<string, unknown>) || {};
        const rawVars = Array.isArray(sd.variables) ? sd.variables as Array<Record<string, unknown>> : [];
        const selectedVariables: VariableMapping[] = rawVars.map(v => ({
          instanceId: v.instance_id as number,
          instanceName: (v.instance_name as string) || '',
          variableId: v.variable_id as string,
          variableName: (v.variable_name as string) || '',
          variableType: (v.variable_type as string) || '',
          alias: (v.alias as string | undefined) || undefined,
        }));

        dispatch({
          type: 'SET_SELECTED_INSTANCE_IDS',
          payload: {
            ids: Array.isArray(cfg.configured_connection_ids)
              ? (cfg.configured_connection_ids as number[])
              : [],
            touched: true,
          },
        });

        dispatch({
          type: 'PATCH_DHIS2_SELECTION',
          payload: {
            selectedVariables,
            periods: Array.isArray(cfg.periods) ? cfg.periods : [],
            periodsAutoDetect: cfg.periods_auto_detect === true,
            defaultPeriodRangeType:
              cfg.default_period_range_type === 'fixed_range' ? 'fixed_range' : 'relative',
            defaultRelativePeriod:
              typeof cfg.default_relative_period === 'string'
                ? cfg.default_relative_period
                : 'LAST_12_MONTHS',
            defaultPeriodStart:
              typeof cfg.default_period_start === 'string' ? cfg.default_period_start : null,
            defaultPeriodEnd:
              typeof cfg.default_period_end === 'string' ? cfg.default_period_end : null,
            orgUnits: Array.isArray(cfg.org_units) ? cfg.org_units : [],
            orgUnitsAutoDetect: cfg.org_units_auto_detect === true,
            selectedOrgUnitDetails: Array.isArray(cfg.org_unit_details)
              ? cfg.org_unit_details
              : [],
            dataLevelScope: (cfg.org_unit_scope as DataLevelScope) || 'selected',
            orgUnitSourceMode: (cfg.org_unit_source_mode as OrgUnitSourceMode) || 'repository',
            primaryOrgUnitInstanceId:
              typeof cfg.primary_org_unit_instance_id === 'number'
                ? cfg.primary_org_unit_instance_id
                : null,
            levelMapping:
              cfg.level_mapping && typeof cfg.level_mapping === 'object'
                ? (cfg.level_mapping as LevelMappingConfig)
                : undefined,
            maxOrgUnitLevel:
              typeof sd.max_orgunit_level === 'number' ? sd.max_orgunit_level : null,
            repositoryDimensionKeys: normalizeRepositoryDimensionKeys(
              cfg.repository_enabled_dimensions,
            ),
            repositoryDimensionKeysConfigured: Object.prototype.hasOwnProperty.call(
              cfg,
              'repository_enabled_dimensions',
            ),
            includeDisaggregationDimension:
              cfg.include_disaggregation_dimension === true,
          },
        });

        dispatch({
          type: 'PATCH_DATASET_SETTINGS',
          payload: {
            name: (sd.name as string) || '',
            description: (sd.description as string) || '',
            nameTouched: true,
          },
        });

        if (sd.schedule_cron) {
          dispatch({
            type: 'SET_SCHEDULE_CONFIG',
            payload: {
              preset: 'custom',
              cron: (sd.schedule_cron as string) || '0 5 * * *',
              timezone: (sd.schedule_timezone as string) || 'UTC',
            },
          });
        }

        // Start on step 1 (data selection) since step 0 (database) is already filled
        setCurrentStep(1);
      } catch (err) {
        addDangerToast(t('Failed to load dataset configuration for editing'));
      } finally {
        if (isMountedRef.current) setEditLoading(false);
      }
    })();
    // Run once when databases become available — editDatasetId is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDatasetId, databasesLoading, databases]);

  const filteredDatabases = useMemo(() => {
    const needle = sourceSearch.trim().toLowerCase();
    if (!needle) {
      return databases;
    }
    return databases.filter(database =>
      `${database.database_name} ${database.backend || ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [databases, sourceSearch]);

  const databasesById = useMemo(
    () =>
      new Map(
        databases.map(database => [database.id, database] as const),
      ),
    [databases],
  );

  const currentSteps = state.datasetType ? WORKFLOW_STEPS[state.datasetType] : [];

  const activeInstances = useMemo(
    () => instances.filter(instance => instance.is_active),
    [instances],
  );

  const selectedInstances = useMemo(
    () =>
      instances.filter(instance => state.selectedInstanceIds.includes(instance.id)),
    [instances, state.selectedInstanceIds],
  );
  const instanceNameById = useMemo(
    () => new Map(instances.map(instance => [instance.id, instance.name] as const)),
    [instances],
  );
  const metadataInstanceStatus = useMemo(() => {
    const statusMap = new Map<
      number,
      {
        variablesStatus: string;
        variablesCount: number;
        orgUnitsStatus: string;
        orgUnitsCount: number;
      }
    >();

    metadataStatus?.variables.instances.forEach(instance => {
      statusMap.set(instance.id, {
        variablesStatus: instance.status,
        variablesCount: instance.count,
        orgUnitsStatus: 'missing',
        orgUnitsCount: 0,
      });
    });
    metadataStatus?.org_units.instances.forEach(instance => {
      const current = statusMap.get(instance.id);
      statusMap.set(instance.id, {
        variablesStatus: current?.variablesStatus || 'missing',
        variablesCount: current?.variablesCount || 0,
        orgUnitsStatus: instance.status,
        orgUnitsCount: instance.count,
      });
    });

    return statusMap;
  }, [metadataStatus]);
  const primaryOrgUnitInstance = useMemo(
    () =>
      instances.find(instance => instance.id === state.primaryOrgUnitInstanceId) || null,
    [instances, state.primaryOrgUnitInstanceId],
  );

  const summaryVariables = useMemo(() => state.selectedVariables.slice(0, 6), [
    state.selectedVariables,
  ]);

  const refreshSourceMetadata = useCallback(async () => {
    if (!state.database) {
      return;
    }

    const requestId = sourceRequestIdRef.current + 1;
    sourceRequestIdRef.current = requestId;
    if (!isMountedRef.current) {
      return;
    }
    setSourceMetadataLoading(true);
    setSourceMetadataError(null);

    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/staging/sources/?database_id=${state.database.id}&ensure=true`,
      });
      if (!isMountedRef.current || requestId !== sourceRequestIdRef.current) {
        return;
      }
      const result = (response.json as { result?: StagedSourceResult })?.result || {};
      dispatch({
        type: 'SET_SOURCE_METADATA',
        payload: {
          dhis2SourceId: result.source?.id ?? null,
          stagingCapabilities:
            result.capabilities ?? buildFallbackCapabilities(state.database),
        },
      });
    } catch (error) {
      if (!isMountedRef.current || requestId !== sourceRequestIdRef.current) {
        return;
      }

      logging.warn('[DatasetCreation] Failed to load staged-source metadata', error);
      dispatch({
        type: 'SET_SOURCE_METADATA',
        payload: {
          dhis2SourceId: null,
          stagingCapabilities: buildFallbackCapabilities(state.database),
        },
      });
      setSourceMetadataError(
        error instanceof Error
          ? error.message
          : t('Unable to load source diagnostics.'),
      );
    } finally {
      if (isMountedRef.current && requestId === sourceRequestIdRef.current) {
        setSourceMetadataLoading(false);
      }
    }
  }, [state.database]);

  const refreshMetadataStatus = useCallback(async () => {
    if (!state.databaseId || state.datasetType !== 'dhis2') {
      setMetadataStatus(null);
      setMetadataStatusError(null);
      return;
    }

    const requestId = metadataStatusRequestIdRef.current + 1;
    metadataStatusRequestIdRef.current = requestId;
    if (!isMountedRef.current) {
      return;
    }
    setMetadataStatusLoading(true);
    setMetadataStatusError(null);

    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/diagnostics/metadata-status/${state.databaseId}`,
      });
      if (!isMountedRef.current || requestId !== metadataStatusRequestIdRef.current) {
        return;
      }
      setMetadataStatus(
        ((response.json as { result?: DHIS2MetadataStatus })?.result || null) as
          | DHIS2MetadataStatus
          | null,
      );
    } catch (error) {
      if (!isMountedRef.current || requestId !== metadataStatusRequestIdRef.current) {
        return;
      }
      setMetadataStatus(null);
      setMetadataStatusError(
        error instanceof Error
          ? error.message
          : t('Unable to load metadata staging status.'),
      );
    } finally {
      if (isMountedRef.current && requestId === metadataStatusRequestIdRef.current) {
        setMetadataStatusLoading(false);
      }
    }
  }, [state.databaseId, state.datasetType]);

  const requestMetadataRefresh = useCallback(
    async (silent = false) => {
      if (!state.databaseId || state.datasetType !== 'dhis2') {
        return;
      }
      if (!isMountedRef.current) {
        return;
      }
      setMetadataRefreshLoading(true);
      setMetadataStatusError(null);
      try {
        await SupersetClient.post({
          endpoint: `/api/v1/dhis2/diagnostics/metadata-refresh/${state.databaseId}`,
        });
        if (isMountedRef.current && !silent) {
          addSuccessToast(
            t('Queued a staged metadata refresh for this DHIS2 Database.'),
          );
        }
        await refreshMetadataStatus();
      } catch (error) {
        const message = getErrorMessage(
          error,
          t('Failed to queue a metadata refresh.'),
        );
        logging.warn('[DatasetCreation] Failed to queue metadata refresh', error);
        if (!isMountedRef.current) {
          return;
        }
        setMetadataStatusError(message);
        if (!silent) {
          addDangerToast(message);
        }
      } finally {
        if (isMountedRef.current) {
          setMetadataRefreshLoading(false);
        }
      }
    },
    [
      addDangerToast,
      addSuccessToast,
      refreshMetadataStatus,
      state.databaseId,
      state.datasetType,
    ],
  );

  const refreshInstances = useCallback(async () => {
    if (!state.databaseId || state.datasetType !== 'dhis2') {
      setInstances([]);
      setInstancesError(null);
      return;
    }

    const requestId = instancesRequestIdRef.current + 1;
    instancesRequestIdRef.current = requestId;
    if (!isMountedRef.current) {
      return;
    }
    setInstancesLoading(true);
    setInstancesError(null);

    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/instances/?database_id=${state.databaseId}&include_inactive=true`,
      });
      if (!isMountedRef.current || requestId !== instancesRequestIdRef.current) {
        return;
      }

      const sourceDatabase = databasesById.get(state.databaseId) || null;
      const nextInstances = normalizeInstancesPayload(response.json).map(instance => ({
        ...instance,
        database_id: instance.database_id || state.databaseId || 0,
        database_name: sourceDatabase?.database_name || null,
      }));
      setInstances(nextInstances);
      dispatch({
        type: 'SET_SELECTED_INSTANCE_IDS',
        payload: {
          ids: deriveNextInstanceSelection(
            nextInstances,
            selectedInstanceIdsRef.current,
            configuredConnectionsTouchedRef.current,
          ),
          touched: configuredConnectionsTouchedRef.current,
        },
      });
    } catch (error) {
      if (!isMountedRef.current || requestId !== instancesRequestIdRef.current) {
        return;
      }
      setInstances([]);
      setInstancesError(
        error instanceof Error
          ? error.message
          : t('Failed to load DHIS2 instances.'),
      );
    } finally {
      if (isMountedRef.current && requestId === instancesRequestIdRef.current) {
        setInstancesLoading(false);
      }
    }
  }, [databasesById, state.databaseId, state.datasetType]);

  useEffect(() => {
    if (!state.database) {
      return;
    }
    void refreshSourceMetadata();
  }, [refreshSourceMetadata, state.database]);

  useEffect(() => {
    if (state.datasetType !== 'dhis2' || !state.databaseId) {
      setMetadataStatus(null);
      setMetadataStatusError(null);
      return;
    }
    void refreshMetadataStatus();
  }, [refreshMetadataStatus, state.databaseId, state.datasetType]);

  useEffect(() => {
    if (
      state.datasetType !== 'dhis2' ||
      !state.databaseId ||
      !metadataStatus ||
      !(
        metadataStatus.overall_status === 'pending' ||
        metadataStatus.overall_status === 'partial' ||
        metadataStatus.overall_status === 'missing' ||
        metadataStatus.refresh_progress?.status === 'queued' ||
        metadataStatus.refresh_progress?.status === 'running' ||
        metadataStatus.refresh_progress?.status === 'partial'
      )
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshMetadataStatus();
    }, METADATA_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [metadataStatus, refreshMetadataStatus, state.databaseId, state.datasetType]);

  useEffect(() => {
    if (state.datasetType !== 'dhis2') {
      setInstances([]);
      setInstancesError(null);
      return;
    }
    if (!state.databaseId) {
      setInstances([]);
      setInstancesError(null);
      return;
    }
    void refreshInstances();
  }, [refreshInstances, state.databaseId, state.datasetType]);

  const handleRetryInstances = () => {
    void refreshInstances();
  };

  const handleSourceSelect = (databaseId: number) => {
    const database = filteredDatabases.find(item => item.id === databaseId) || null;
    dispatch({ type: 'SET_SOURCE', payload: database });
    setErrors({});
  };

  const handleTestInstanceConnection = async (
    event: React.MouseEvent<HTMLElement>,
    instance: DHIS2InstanceInfo,
  ) => {
    event.stopPropagation();
    setInstanceTestStatus(prev => ({
      ...prev,
      [instance.id]: 'testing',
    }));
    setInstanceTestMessage(prev => ({
      ...prev,
      [instance.id]: '',
    }));

    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/dhis2/instances/${instance.id}/test`,
      });
      const result = (
        response.json as {
          result?: {
            success?: boolean;
            message?: string;
            response_time_ms?: number | null;
          };
        }
      )?.result || {};
      const succeeded = !!result.success;
      setInstanceTestStatus(prev => ({
        ...prev,
        [instance.id]: succeeded ? 'success' : 'failed',
      }));
      setInstanceTestMessage(prev => ({
        ...prev,
        [instance.id]: result.message || '',
      }));
      setInstances(current =>
        current.map(candidate =>
          candidate.id === instance.id
            ? {
                ...candidate,
                last_test_status: succeeded ? 'success' : 'failed',
                last_test_message: result.message || null,
                last_test_response_time_ms:
                  typeof result.response_time_ms === 'number'
                    ? result.response_time_ms
                    : null,
                last_tested_on: new Date().toISOString(),
              }
            : candidate,
        ),
      );
    } catch (error) {
      setInstanceTestStatus(prev => ({
        ...prev,
        [instance.id]: 'failed',
      }));
      setInstanceTestMessage(prev => ({
        ...prev,
        [instance.id]:
          error instanceof Error ? error.message : t('Connection test failed.'),
      }));
    }
  };

  const updateDhIS2State = useCallback((updates: Record<string, unknown>) => {
    const nextPayload: Record<string, unknown> = {};
    if (updates.variableMappings) {
      nextPayload.selectedVariables = updates.variableMappings;
    }
    if (updates.periods) {
      nextPayload.periods = updates.periods;
    }
    if (updates.orgUnits) {
      nextPayload.orgUnits = updates.orgUnits;
    }
    if (updates.selectedOrgUnitDetails) {
      nextPayload.selectedOrgUnitDetails = updates.selectedOrgUnitDetails;
    }
    if (updates.includeChildren !== undefined) {
      nextPayload.includeChildren = updates.includeChildren;
    }
    if (updates.dataLevelScope) {
      nextPayload.dataLevelScope = updates.dataLevelScope;
    }
    if (updates.orgUnitSourceMode) {
      nextPayload.orgUnitSourceMode = updates.orgUnitSourceMode;
    }
    if (updates.primaryOrgUnitInstanceId !== undefined) {
      nextPayload.primaryOrgUnitInstanceId = updates.primaryOrgUnitInstanceId;
    }
    if (updates.periodsAutoDetect !== undefined) {
      nextPayload.periodsAutoDetect = updates.periodsAutoDetect;
    }
    if (updates.defaultPeriodRangeType !== undefined) {
      nextPayload.defaultPeriodRangeType = updates.defaultPeriodRangeType;
    }
    if (updates.defaultRelativePeriod !== undefined) {
      nextPayload.defaultRelativePeriod = updates.defaultRelativePeriod;
    }
    if (updates.defaultPeriodStart !== undefined) {
      nextPayload.defaultPeriodStart = updates.defaultPeriodStart;
    }
    if (updates.defaultPeriodEnd !== undefined) {
      nextPayload.defaultPeriodEnd = updates.defaultPeriodEnd;
    }
    if (updates.orgUnitsAutoDetect !== undefined) {
      nextPayload.orgUnitsAutoDetect = updates.orgUnitsAutoDetect;
    }
    if (updates.levelMapping !== undefined) {
      nextPayload.levelMapping = updates.levelMapping;
    }
    if (updates.maxOrgUnitLevel !== undefined) {
      nextPayload.maxOrgUnitLevel = updates.maxOrgUnitLevel;
    }
    if (updates.repositoryDimensionKeys !== undefined) {
      nextPayload.repositoryDimensionKeys = updates.repositoryDimensionKeys;
    }
    if (updates.includeDisaggregationDimension !== undefined) {
      nextPayload.includeDisaggregationDimension = updates.includeDisaggregationDimension;
    }
      const normalizedMode =
        updates.orgUnitSourceMode === 'federated'
          ? 'repository'
          : updates.orgUnitSourceMode;
      dispatch({
        type: 'PATCH_DHIS2_SELECTION',
        payload: normalizedMode
          ? { ...nextPayload, orgUnitSourceMode: normalizedMode }
          : nextPayload,
      });
    }, []);

  const dhis2WizardAdapterState = useMemo(
    () => ({
      datasetName: state.datasetSettings.name,
      description: state.datasetSettings.description,
      selectedInstanceIds: state.selectedInstanceIds,
      orgUnitSourceMode: state.orgUnitSourceMode,
      primaryOrgUnitInstanceId: state.primaryOrgUnitInstanceId,
      variableMappings: state.selectedVariables,
      dataElements: state.selectedVariables.map(variable => variable.variableId),
      periods: state.periods,
      periodsAutoDetect: state.periodsAutoDetect,
      defaultPeriodRangeType: state.defaultPeriodRangeType,
      defaultRelativePeriod: state.defaultRelativePeriod,
      defaultPeriodStart: state.defaultPeriodStart,
      defaultPeriodEnd: state.defaultPeriodEnd,
      orgUnits: state.orgUnits,
      orgUnitsAutoDetect: state.orgUnitsAutoDetect,
      selectedOrgUnitDetails: state.selectedOrgUnitDetails,
      includeChildren: state.includeChildren,
      dataLevelScope: state.dataLevelScope,
      levelMapping: state.levelMapping,
      maxOrgUnitLevel: state.maxOrgUnitLevel,
      repositoryDimensionKeys: state.repositoryDimensionKeys,
      includeDisaggregationDimension: state.includeDisaggregationDimension,
      columns: [],
      previewData: [],
      scheduleConfig: state.scheduleConfig,
    }),
    [state],
  );

  const repositoryEnabledDimensions = useMemo(
    () => repositoryOrgUnitMetadata?.repositoryEnabledDimensions || null,
    [repositoryOrgUnitMetadata],
  );
  const repositoryLevelDimensionOptions = useMemo(
    () =>
      mergeRepositoryDimensionOptions(
        buildRepositoryLevelDimensionOptions(
          repositoryEnabledDimensions,
          repositoryOrgUnitMetadata,
        ),
        state.repositoryDimensionKeys.levels,
      ),
    [
      repositoryEnabledDimensions,
      repositoryOrgUnitMetadata,
      state.repositoryDimensionKeys.levels,
    ],
  );
  const repositoryGroupDimensionOptions = useMemo(
    () =>
      mergeRepositoryDimensionOptions(
        buildRepositoryNamedDimensionOptions(
          repositoryEnabledDimensions?.groups,
        ),
        state.repositoryDimensionKeys.groups,
      ),
    [
      repositoryEnabledDimensions?.groups,
      state.repositoryDimensionKeys.groups,
    ],
  );
  const repositoryGroupSetDimensionOptions = useMemo(
    () =>
      mergeRepositoryDimensionOptions(
        buildRepositoryNamedDimensionOptions(
          repositoryEnabledDimensions?.group_sets,
        ),
        state.repositoryDimensionKeys.group_sets,
      ),
    [
      repositoryEnabledDimensions?.group_sets,
      state.repositoryDimensionKeys.group_sets,
    ],
  );

  useEffect(() => {
    if (!repositoryOrgUnitMetadata) {
      return;
    }

    const defaultsKey = String(state.databaseId || '');
    if (
      defaultsKey &&
      repositoryDimensionDefaultsAppliedRef.current === defaultsKey
    ) {
      return;
    }

    if (state.repositoryDimensionKeysConfigured) {
      repositoryDimensionDefaultsAppliedRef.current = defaultsKey;
      return;
    }

    const nextKeys = {
      levels: buildRepositoryLevelDimensionOptions(
        repositoryEnabledDimensions,
        repositoryOrgUnitMetadata,
      ).map(option => option.value),
      groups: buildRepositoryNamedDimensionOptions(
        repositoryEnabledDimensions?.groups,
      ).map(option => option.value),
      group_sets: buildRepositoryNamedDimensionOptions(
        repositoryEnabledDimensions?.group_sets,
      ).map(option => option.value),
    };

    if (
      nextKeys.levels.length === 0 &&
      nextKeys.groups.length === 0 &&
      nextKeys.group_sets.length === 0
    ) {
      repositoryDimensionDefaultsAppliedRef.current = defaultsKey;
      return;
    }

    repositoryDimensionDefaultsAppliedRef.current = defaultsKey;
    dispatch({
      type: 'PATCH_DHIS2_SELECTION',
      payload: {
        repositoryDimensionKeys: nextKeys,
      },
    });
  }, [
    repositoryEnabledDimensions,
    repositoryOrgUnitMetadata,
    state.databaseId,
    state.repositoryDimensionKeysConfigured,
  ]);

  const nextStep = () => {
    const nextErrors = getStepErrorsForCurrentState(state, instances, {
      instancesError,
      instancesLoading,
    });
    const activeStepKey = currentSteps[currentStep]?.key;
    let stepError: string | undefined;

    if (!state.datasetType) {
      stepError = nextErrors.source || nextErrors.datasetType;
    } else if (activeStepKey === 'database_selection') {
      stepError = nextErrors.source || nextErrors.instances;
    } else if (activeStepKey === 'data_selection' || activeStepKey === 'source_selection') {
      stepError = nextErrors.dataSelection || nextErrors.sourceSelection;
    } else if (activeStepKey === 'dataset_settings') {
      stepError = nextErrors.settings;
    }

    setErrors(nextErrors);

    if (stepError) {
      return;
    }

    setCurrentStep(step => step + 1);
  };

  const previousStep = () => {
    setErrors({});
    setCurrentStep(step => Math.max(step - 1, 0));
  };

  const resetDatasetType = () => {
    setCurrentStep(0);
    setErrors({});
    dispatch({ type: 'SET_DATASET_TYPE', payload: null });
  };

  const createDatasetRecord = async (
    payload: Record<string, unknown>,
    createChart: boolean,
    columns?: Array<{
      column_name: string;
      verbose_name?: string;
      type?: string;
      is_dttm?: boolean;
      filterable?: boolean;
      groupby?: boolean;
      is_active?: boolean;
    }>,
  ) => {
    const response = await SupersetClient.post({
      endpoint: '/api/v1/dataset/',
      jsonPayload: payload,
    });
    const result = response.json as { id?: number };
    if (!result?.id) {
      throw new Error(t('Dataset creation did not return an id.'));
    }

    if (Array.isArray(columns) && columns.length > 0) {
      try {
        await SupersetClient.put({
          // override_columns=true skips the uniqueness check so that
          // columns can be (re-)applied even if the dataset was previously
          // seeded by the staged-dataset pipeline.
          endpoint: `/api/v1/dataset/${result.id}?override_columns=true`,
          jsonPayload: {
            columns,
          },
        });
      } catch (error) {
        logging.warn(
          '[DatasetCreation] Failed to persist analytical dataset columns',
          error,
        );
      }
    }

    if (!isStagedLocalDatasetPayload(payload)) {
      try {
        await refreshDatasetMetadata(result.id);
      } catch (error) {
        logging.warn('[DatasetCreation] Failed to refresh dataset metadata', error);
      }
    }

    addSuccessToast(t('Dataset created successfully.'));
    history.push(createChart ? `/chart/add/?dataset=${result.id}` : PREV_URL);
  };

  const createDhIS2Dataset = async (createChart: boolean) => {
    if (!state.databaseId) {
      throw new Error(t('Select a DHIS2 Database before creating a dataset.'));
    }

    const stagedPayload = {
      database_id: state.databaseId,
      name: state.datasetSettings.name.trim(),
      description: state.datasetSettings.description.trim() || undefined,
      schedule_cron: state.scheduleConfig.cron,
      schedule_timezone: state.scheduleConfig.timezone,
      ...(state.maxOrgUnitLevel != null ? { max_orgunit_level: state.maxOrgUnitLevel } : {}),
      dataset_config: {
        configured_connection_ids: state.selectedInstanceIds,
        periods: state.periods,
        periods_auto_detect: state.periodsAutoDetect,
        default_period_range_type: state.defaultPeriodRangeType ?? 'relative',
        default_relative_period: state.defaultRelativePeriod ?? 'LAST_12_MONTHS',
        default_period_start: state.defaultPeriodStart ?? null,
        default_period_end: state.defaultPeriodEnd ?? null,
        org_units: state.orgUnits,
        org_units_auto_detect: state.orgUnitsAutoDetect,
        org_unit_details: state.selectedOrgUnitDetails,
        org_unit_scope: state.dataLevelScope,
        repository_enabled_dimensions: state.repositoryDimensionKeys,
        include_disaggregation_dimension: state.includeDisaggregationDimension ?? false,
        org_unit_source_mode:
          state.orgUnitSourceMode === 'federated'
            ? 'repository'
            : state.orgUnitSourceMode,
        primary_org_unit_instance_id:
          state.orgUnitSourceMode === 'primary'
            ? state.primaryOrgUnitInstanceId
            : null,
        level_mapping: state.levelMapping ?? null,
      },
      variables:
        state.selectedVariables.length > 0
          ? state.selectedVariables.map(variable => ({
              instance_id: variable.instanceId,
              variable_id: variable.variableId,
              variable_type: variable.variableType,
              variable_name: variable.variableName,
              alias: variable.alias || undefined,
            }))
          : undefined,
    };

    const stagedResponse = await SupersetClient.post({
      endpoint: '/api/v1/dhis2/staged-datasets/',
      jsonPayload: stagedPayload,
    });
    const stagedResult = (
      stagedResponse.json as { result?: Record<string, unknown> }
    )?.result;
    const servingColumns = Array.isArray(stagedResult?.serving_columns)
      ? (stagedResult?.serving_columns as Array<{
          column_name: string;
          verbose_name?: string;
          type?: string;
          is_dttm?: boolean;
          filterable?: boolean;
          groupby?: boolean;
          is_active?: boolean;
        }>)
      : [];
    const servingTableRef =
      (stagedResult?.serving_table_ref as string | undefined) || null;
    const stagingTableRef =
      (stagedResult?.staging_table_ref as string | undefined) ||
      (typeof stagedResult?.staging_table_name === 'string'
        ? `dhis2_staging.${stagedResult.staging_table_name}`
        : null);

    if (!stagingTableRef) {
      throw new Error(t('The staged dataset did not return a serving table.'));
    }

    // The backend already registered a Superset virtual dataset during staged
    // dataset creation (via ensure_serving_table → register_serving_table_as_superset_dataset).
    // Re-use that record to avoid a duplicate and the UNIQUE constraint 500 error.
    if (typeof stagedResult?.serving_superset_dataset_id === 'number') {
      const existingId = stagedResult.serving_superset_dataset_id as number;
      addSuccessToast(t('Dataset created successfully.'));
      history.push(createChart ? `/chart/add/?dataset=${existingId}` : PREV_URL);
      return;
    }

    await createDatasetRecord(
      buildStagedDhIS2DatasetPayload({
        datasetName: state.datasetSettings.name.trim(),
        stagingTableRef,
        servingTableRef,
        sourceDatabaseId: state.databaseId,
        sourceDatabaseName: state.database?.database_name,
        servingDatabaseId:
          typeof stagedResult?.serving_database_id === 'number'
            ? stagedResult.serving_database_id
            : null,
        servingDatabaseName:
          typeof stagedResult?.serving_database_name === 'string'
            ? stagedResult.serving_database_name
            : null,
        stagedDatasetId:
          typeof stagedResult?.id === 'number' ? stagedResult.id : null,
        selectedInstanceIds: state.selectedInstanceIds,
        selectedInstanceNames: selectedInstances.map(instance => instance.name),
      }),
      createChart,
      servingColumns,
    );
  };

  const createDatabaseDataset = async (createChart: boolean) => {
    if (!state.databaseId) {
      throw new Error(t('Select a database source before creating a dataset.'));
    }

    if (state.databaseSourceMode === 'table') {
      await createDatasetRecord(
        {
          database: state.databaseId,
          catalog: state.catalog,
          schema: state.schema,
          table_name: state.tableName,
        },
        createChart,
      );
      return;
    }

    await createDatasetRecord(
      {
        database: state.databaseId,
        catalog: state.catalog,
        schema: state.schema,
        table_name: state.datasetSettings.name.trim(),
        sql: state.sql,
      },
      createChart,
    );
  };

  const updateDhIS2Dataset = async () => {
    if (!editStagedDatasetId) {
      throw new Error(t('No staged dataset ID found for update.'));
    }
    const updatePayload = {
      name: state.datasetSettings.name.trim(),
      description: state.datasetSettings.description.trim() || undefined,
      schedule_cron: state.scheduleConfig.cron,
      schedule_timezone: state.scheduleConfig.timezone,
      ...(state.maxOrgUnitLevel != null ? { max_orgunit_level: state.maxOrgUnitLevel } : {}),
      dataset_config: {
        configured_connection_ids: state.selectedInstanceIds,
        periods: state.periods,
        periods_auto_detect: state.periodsAutoDetect,
        default_period_range_type: state.defaultPeriodRangeType ?? 'relative',
        default_relative_period: state.defaultRelativePeriod ?? 'LAST_12_MONTHS',
        default_period_start: state.defaultPeriodStart ?? null,
        default_period_end: state.defaultPeriodEnd ?? null,
        org_units: state.orgUnits,
        org_units_auto_detect: state.orgUnitsAutoDetect,
        org_unit_details: state.selectedOrgUnitDetails,
        org_unit_scope: state.dataLevelScope,
        repository_enabled_dimensions: state.repositoryDimensionKeys,
        include_disaggregation_dimension: state.includeDisaggregationDimension ?? false,
        org_unit_source_mode:
          state.orgUnitSourceMode === 'federated'
            ? 'repository'
            : state.orgUnitSourceMode,
        primary_org_unit_instance_id:
          state.orgUnitSourceMode === 'primary'
            ? state.primaryOrgUnitInstanceId
            : null,
        level_mapping: state.levelMapping ?? null,
      },
      variables:
        state.selectedVariables.length > 0
          ? state.selectedVariables.map(variable => ({
              instance_id: variable.instanceId,
              variable_id: variable.variableId,
              variable_type: variable.variableType,
              variable_name: variable.variableName,
              alias: variable.alias || undefined,
            }))
          : [],
    };

    await SupersetClient.put({
      endpoint: `/api/v1/dhis2/staged-datasets/${editStagedDatasetId}`,
      jsonPayload: updatePayload,
    });

    // Also update the Superset dataset name/description if changed
    if (editDatasetId) {
      await SupersetClient.put({
        endpoint: `/api/v1/dataset/${editDatasetId}`,
        jsonPayload: {
          table_name: state.datasetSettings.name.trim(),
          description: state.datasetSettings.description.trim() || undefined,
        },
      });
    }

    addSuccessToast(t('Dataset updated successfully.'));
    history.push(PREV_URL);
  };

  const handleCreate = async (createChart: boolean) => {
    const nextErrors = getStepErrorsForCurrentState(state, instances, {
      instancesError,
      instancesLoading,
    });
    if (isMountedRef.current) {
      setErrors(nextErrors);
    }
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    if (isMountedRef.current) {
      setSaving(true);
    }
    try {
      if (isEditMode && state.datasetType === 'dhis2') {
        await updateDhIS2Dataset();
      } else if (state.datasetType === 'dhis2') {
        await createDhIS2Dataset(createChart);
      } else if (state.datasetType === 'database') {
        await createDatabaseDataset(createChart);
      }
    } catch (error) {
      addDangerToast(
        error instanceof Error
          ? error.message
          : isEditMode
            ? t('Failed to update dataset.')
            : t('Failed to create dataset.'),
      );
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  const renderDatasetTypeChooser = () => (
    renderSourceSelector(
      t('Database'),
      t(
        'Choose a Database to start. The workflow branches automatically from the selected Database type, so you never have to pick the same DHIS2 concept twice.',
      ),
    )
  );

  const renderSourceSelector = (title: string, description: string) => (
    <Card className="section-card">
      <Title level={4}>{title}</Title>
      <Paragraph className="section-subtitle">{description}</Paragraph>
      {databasesLoading ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <Loading />
        </div>
      ) : databasesError ? (
        <Alert
          message={t('Unable to load Databases')}
          description={databasesError}
          type="error"
          showIcon
          action={
            <Button type="link" onClick={() => void retry()}>
              {t('Retry')}
            </Button>
          }
        />
      ) : filteredDatabases.length === 0 ? (
        <Empty
          description={
            sourceSearch
              ? t('No Databases match that search.')
              : t('No Databases are available yet.')
          }
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Input.Search
            aria-label={title}
            data-test="dataset-source-search"
            onChange={event => setSourceSearch(event.target.value)}
            placeholder={t('Search Databases')}
            value={sourceSearch}
          />
          <SourceOptionGrid>
            {filteredDatabases.map(database => (
              <SourceOptionCard
                key={database.id}
                data-test="dataset-source-card"
                data-backend={database.backend || 'unknown'}
                data-database-id={database.id}
                onClick={() => handleSourceSelect(database.id)}
                selected={state.databaseId === database.id}
                type="button"
              >
                <div className="source-name">{database.database_name}</div>
                <div className="source-backend">
                  {database.backend || t('unknown')}
                </div>
                <Space wrap>
                  <Tag color={database.backend === 'dhis2' ? 'blue' : 'green'}>
                    {database.backend === 'dhis2'
                      ? t('DHIS2 Database')
                      : t('Database Source')}
                  </Tag>
                  {state.databaseId === database.id && (
                    <Tag color="geekblue">{t('Selected')}</Tag>
                  )}
                </Space>
              </SourceOptionCard>
            ))}
          </SourceOptionGrid>
        </Space>
      )}
      {errors.source && (
        <Alert
          style={{ marginTop: 16 }}
          type="error"
          message={errors.source}
          showIcon
        />
      )}
    </Card>
  );

  const renderDhIS2SourceAndInstances = () => (
    <SourceSelectionStep>
      {renderSourceSelector(
        t('Database'),
        t(
          'Select the Database once. If it is a DHIS2 Database, Superset loads the saved DHIS2 instances that were configured under that Database and uses them automatically.',
        ),
      )}

      {state.database ? (
        <SourceCard className="section-card" title={t('Selected Database')}>
          {sourceMetadataError && (
            <Alert
              style={{ marginBottom: 16 }}
              type="warning"
              showIcon
              message={t('Source diagnostics unavailable')}
              description={sourceMetadataError}
            />
          )}
          {metadataStatusError && (
            <Alert
              style={{ marginBottom: 16 }}
              type="warning"
              showIcon
              message={t('Metadata staging status unavailable')}
              description={metadataStatusError}
            />
          )}
          <SourceStatusGrid>
            <SourceMetric>
              <div className="metric-label">{t('Database')}</div>
              <div className="metric-value">{state.database.database_name}</div>
            </SourceMetric>
            <SourceMetric>
              <div className="metric-label">{t('Database type')}</div>
              <div className="metric-value">{state.database.backend || 'unknown'}</div>
            </SourceMetric>
            <SourceMetric>
              <div className="metric-label">{t('Configured DHIS2 instances')}</div>
              <div className="metric-value">
                {instancesLoading ? t('Loading...') : instances.length}
              </div>
            </SourceMetric>
            <SourceMetric>
              <div className="metric-label">{t('Included in dataset')}</div>
              <div className="metric-value">
                {instancesLoading ? t('Loading...') : activeInstances.length}
              </div>
            </SourceMetric>
            <SourceMetric>
              <div className="metric-label">{t('Variables metadata')}</div>
              <div className="metric-value">
                {metadataStatusLoading
                  ? t('Loading...')
                  : metadataStatus
                    ? `${formatMetadataStatus(metadataStatus.variables.status)} (${metadataStatus.variables.count})`
                    : t('Not available')}
              </div>
            </SourceMetric>
            <SourceMetric>
              <div className="metric-label">{t('Org units metadata')}</div>
              <div className="metric-value">
                {metadataStatusLoading
                  ? t('Loading...')
                  : metadataStatus
                    ? `${formatMetadataStatus(metadataStatus.org_units.status)} (${metadataStatus.org_units.count})`
                    : t('Not available')}
              </div>
            </SourceMetric>
            <SourceMetric>
              <div className="metric-label">{t('Background refresh')}</div>
              <div className="metric-value">
                {state.stagingCapabilities?.background_refresh_forced
                  ? t('System-managed')
                  : t('Not configured')}
              </div>
            </SourceMetric>
            <SourceMetric>
              <div className="metric-label">{t('Last metadata refresh')}</div>
              <div className="metric-value">
                {metadataStatus?.last_refreshed_at
                  ? formatDateTime(metadataStatus.last_refreshed_at)
                  : t('Never')}
              </div>
            </SourceMetric>
          </SourceStatusGrid>
          {metadataStatus?.refresh_progress &&
          ['queued', 'running', 'partial'].includes(
            metadataStatus.refresh_progress.status,
          ) ? (
            <ProgressStack>
              <ProgressCard>
                <Space
                  align="center"
                  style={{ justifyContent: 'space-between', width: '100%' }}
                  wrap
                >
                  <Text strong>{t('Background metadata refresh')}</Text>
                  <Tag color={getStatusColor(metadataStatus.refresh_progress.status)}>
                    {formatRefreshProgressStatus(
                      metadataStatus.refresh_progress.status,
                    )}
                  </Tag>
                </Space>
                <Progress
                  percent={metadataStatus.refresh_progress.overall.percent_complete}
                  status={getProgressStatus(metadataStatus.refresh_progress.status)}
                  strokeColor="#1677ff"
                  style={{ marginTop: 12, marginBottom: 8 }}
                />
                <Text type="secondary">
                  {t(
                    '%s of %s staging steps completed.',
                    formatCount(
                      metadataStatus.refresh_progress.overall.completed_units,
                    ),
                    formatCount(metadataStatus.refresh_progress.overall.total_units),
                  )}
                </Text>
              </ProgressCard>
              {(
                [
                  {
                    key: 'variables',
                    label: t('Variables metadata'),
                    progress: metadataStatus.refresh_progress.variables,
                  },
                  {
                    key: 'org_units',
                    label: t('Organisation units metadata'),
                    progress: metadataStatus.refresh_progress.org_units,
                  },
                ] as Array<{
                  key: string;
                  label: string;
                  progress: DHIS2MetadataRefreshFamilyProgress;
                }>
              ).map(section => (
                <ProgressCard key={section.key}>
                  <Space
                    align="center"
                    style={{ justifyContent: 'space-between', width: '100%' }}
                    wrap
                  >
                    <div>
                      <Text strong>{section.label}</Text>
                      <div>
                        <Text type="secondary">
                          {formatRefreshProgressCounter(section.progress)}
                        </Text>
                      </div>
                    </div>
                    <Tag color={getStatusColor(section.progress.status)}>
                      {formatRefreshProgressStatus(section.progress.status)}
                    </Tag>
                  </Space>
                  <Progress
                    percent={section.progress.percent_complete}
                    status={getProgressStatus(section.progress.status)}
                    strokeColor={section.key === 'variables' ? '#1677ff' : '#13a8a8'}
                    style={{ marginTop: 12, marginBottom: 8 }}
                  />
                  {section.progress.current_instance_name ||
                  section.progress.current_metadata_type ? (
                    <Text type="secondary">
                      {t(
                        'Current stage: %s%s',
                        section.progress.current_instance_name || t('Database'),
                        section.progress.current_metadata_type
                          ? ` • ${section.progress.current_metadata_type}`
                          : '',
                      )}
                    </Text>
                  ) : null}
                  {section.progress.instances.length > 0 ? (
                    <ProgressInstanceList>
                      {section.progress.instances.map(instance => (
                        <div key={`${section.key}-${instance.id}`}>
                          <Space
                            align="center"
                            style={{
                              justifyContent: 'space-between',
                              width: '100%',
                              marginBottom: 4,
                            }}
                            wrap
                          >
                            <Text>{instance.name}</Text>
                            <Text type="secondary">
                              {instance.percent_complete}% •{' '}
                              {formatRefreshProgressCounter(instance)}
                            </Text>
                          </Space>
                          <Progress
                            percent={instance.percent_complete}
                            showInfo={false}
                            size="small"
                            status={getProgressStatus(instance.status)}
                            strokeColor={section.key === 'variables' ? '#1677ff' : '#13a8a8'}
                          />
                        </div>
                      ))}
                    </ProgressInstanceList>
                  ) : null}
                </ProgressCard>
              ))}
            </ProgressStack>
          ) : null}
          {metadataStatus && metadataNeedsAttention(metadataStatus.overall_status) ? (
            <Alert
              style={{ marginTop: 16 }}
              type={
                metadataStatus.overall_status === 'failed' ? 'error' : 'info'
              }
              showIcon
              message={
                metadataStatus.overall_status === 'failed'
                  ? t('Local staged metadata needs attention')
                  : t('Local staged metadata is still loading')
              }
              description={
                metadataStatus.overall_status === 'failed'
                  ? t(
                      'Variables or organisation units are not fully available from local staging yet. Refresh the staged metadata from here or review the DHIS2 Database configuration.',
                    )
                  : t(
                      'Superset is preparing variables and organisation units in local staging. Dataset steps read from that staged storage for speed and will update automatically as snapshots become ready.',
                    )
              }
              action={
                <Button
                  loading={metadataRefreshLoading}
                  onClick={() => void requestMetadataRefresh()}
                  size="small"
                >
                  {t('Refresh staged metadata')}
                </Button>
              }
            />
          ) : null}
          {!metadataStatusLoading &&
          metadataStatus &&
          !metadataNeedsAttention(metadataStatus.overall_status) ? (
            <Alert
              style={{ marginTop: 16 }}
              type="success"
              showIcon
              message={t('Variables and organisation units are ready locally')}
              description={t(
                'Dataset creation will read variables and organisation units from the local staged metadata store instead of querying DHIS2 live.',
              )}
            />
          ) : null}
          <Space style={{ marginTop: 16 }} wrap>
            <Button
              loading={metadataRefreshLoading}
              onClick={() => void requestMetadataRefresh()}
            >
              {t('Refresh staged metadata')}
            </Button>
            <Button onClick={() => void refreshMetadataStatus()}>
              {t('Refresh status')}
            </Button>
          </Space>
          {sourceMetadataLoading && (
            <div style={{ marginTop: 16 }}>
              <Loading />
            </div>
          )}
        </SourceCard>
      ) : null}

      {state.databaseId ? (
        <Card className="section-card" title={t('Configured DHIS2 instances')}>
          {instancesLoading ? (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <Loading />
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">
                  {t(
                    'Loading the configured DHIS2 instances saved under the selected Database...',
                  )}
                </Text>
              </div>
            </div>
          ) : instancesError ? (
            <Alert
              type="error"
              showIcon
              message={t('Unable to load configured DHIS2 instances')}
              description={
                <Space direction="vertical" size={8}>
                  <span>{instancesError}</span>
                  <span>
                    {t(
                      'These instances should come from the earlier Database configuration. You can retry here or inspect the DHIS2 admin pages for more diagnostics.',
                    )}
                  </span>
                </Space>
              }
              action={
                <Space wrap>
                  <Button onClick={handleRetryInstances}>{t('Retry')}</Button>
                  <Button href="/superset/dhis2/instances/" target="_blank">
                    {t('Open diagnostics')}
                  </Button>
                </Space>
              }
            />
          ) : activeInstances.length === 0 ? (
            <Empty
              description={t(
                'No active configured DHIS2 instances are available for this Database.',
              )}
            />
          ) : (
            <>
              <Alert
                style={{ marginBottom: 16 }}
                type="info"
                showIcon
                message={t(
                  'Active DHIS2 instances from this Database are included automatically',
                )}
                description={t(
                  'Dataset creation does not ask you to choose a second DHIS2 source. All active instances already saved under this Database are used automatically, and metadata browsing comes from local staging for speed.',
                )}
              />
              {errors.instances && (
                <Alert
                  style={{ marginBottom: 16 }}
                  type="error"
                  showIcon
                  message={errors.instances}
                />
              )}
              <InstanceGrid>
                {instances.map(instance => {
                  const sessionStatus = instanceTestStatus[instance.id];
                  const status =
                    sessionStatus && sessionStatus !== 'idle'
                      ? sessionStatus
                      : instance.last_test_status || 'idle';
                  const statusMessage =
                    instanceTestMessage[instance.id] ||
                    instance.last_test_message ||
                    instance.description ||
                    t('No additional notes.');
                  const selected = state.selectedInstanceIds.includes(instance.id);
                  return (
                    <InstanceCard
                      key={instance.id}
                      inactive={!instance.is_active}
                      selected={selected}
                    >
                      <Space
                        align="start"
                        style={{ justifyContent: 'space-between', width: '100%' }}
                      >
                        <div className="instance-name">{instance.name}</div>
                        <Tag color={selected ? 'geekblue' : 'default'}>
                          {selected ? t('Included automatically') : t('Not included')}
                        </Tag>
                      </Space>
                      <div className="instance-url">{instance.url}</div>
                      <Space wrap style={{ marginBottom: 8 }}>
                        <Tag color={instance.is_active ? 'green' : 'default'}>
                          {instance.is_active ? t('Active') : t('Inactive')}
                        </Tag>
                        {instance.database_name && (
                          <Tag color="cyan">{instance.database_name}</Tag>
                        )}
                        <Tag color="blue">{instance.auth_type.toUpperCase()}</Tag>
                        {selected && instance.is_active ? (
                          <Tag
                            color={getStatusColor(
                              metadataInstanceStatus.get(instance.id)?.variablesStatus,
                            )}
                          >
                            {t(
                              'Variables: %s',
                              formatMetadataStatus(
                                metadataInstanceStatus.get(instance.id)
                                  ?.variablesStatus,
                              ),
                            )}
                          </Tag>
                        ) : null}
                        {selected && instance.is_active ? (
                          <Tag
                            color={getStatusColor(
                              metadataInstanceStatus.get(instance.id)?.orgUnitsStatus,
                            )}
                          >
                            {t(
                              'Org units: %s',
                              formatMetadataStatus(
                                metadataInstanceStatus.get(instance.id)
                                  ?.orgUnitsStatus,
                              ),
                            )}
                          </Tag>
                        ) : null}
                        {status === 'success' && (
                          <Tag color="success">{t('Healthy')}</Tag>
                        )}
                        {status === 'failed' && (
                          <Tag color="error">{t('Test failed')}</Tag>
                        )}
                        {status === 'testing' && (
                          <Tag color="processing">{t('Testing')}</Tag>
                        )}
                      </Space>
                      <Space wrap>
                        <Button
                          disabled={!instance.is_active}
                          onClick={event => handleTestInstanceConnection(event, instance)}
                          size="small"
                        >
                          {t('Test connection')}
                        </Button>
                      </Space>
                      <div className="instance-description">
                        {statusMessage}
                        {selected && metadataInstanceStatus.get(instance.id) ? (
                          <div style={{ marginTop: 8 }}>
                            <Text type="secondary">
                              {t(
                                'Staged variables: %s, org units: %s',
                                metadataInstanceStatus.get(instance.id)?.variablesCount || 0,
                                metadataInstanceStatus.get(instance.id)?.orgUnitsCount || 0,
                              )}
                            </Text>
                          </div>
                        ) : null}
                        {instance.last_tested_on ? (
                          <div style={{ marginTop: 8 }}>
                            <Text type="secondary">
                              {t('Last tested')}: {instance.last_tested_on}
                            </Text>
                          </div>
                        ) : null}
                      </div>
                    </InstanceCard>
                  );
                })}
              </InstanceGrid>
            </>
          )}
        </Card>
      ) : null}
    </SourceSelectionStep>
  );

  const renderDatabaseSource = () =>
    renderSourceSelector(
      t('Database'),
      t(
        'Choose the Database first. The next step focuses only on the table or SQL source inside that selected Database.',
      ),
    );

  const renderDatabaseSourceSelection = () => (
    <SourceSelectionStep>
      <Card className="section-card">
        <Title level={4}>{t('Table / Query Source')}</Title>
        <Paragraph className="section-subtitle">
          {t(
            'Choose either a physical table or a SQL query. The selected database stays fixed so you do not have to reselect it.',
          )}
        </Paragraph>
        <Radio.Group
          buttonStyle="solid"
          onChange={event =>
            dispatch({
              type: 'SET_DATABASE_SOURCE_MODE',
              payload: event.target.value as DatabaseSourceMode,
            })
          }
          optionType="button"
          value={state.databaseSourceMode}
        >
          <Radio.Button value="table">{t('Table')}</Radio.Button>
          <Radio.Button value="sql">{t('SQL Query')}</Radio.Button>
        </Radio.Group>
      </Card>

      {state.databaseSourceMode === 'table' ? (
        <Card className="section-card">
          <TableSelector
            database={state.database ?? undefined}
            handleError={addDangerToast}
            isDatabaseSelectEnabled={false}
            onCatalogChange={catalog =>
              dispatch({
                type: 'SET_DATABASE_SOURCE_SELECTION',
                payload: { catalog: catalog ?? null },
              })
            }
            onSchemaChange={schema =>
              dispatch({
                type: 'SET_DATABASE_SOURCE_SELECTION',
                payload: { schema: schema ?? null, tableName: null },
              })
            }
            onTableSelectChange={(tableName, catalog, schema) =>
              dispatch({
                type: 'SET_DATABASE_SOURCE_SELECTION',
                payload: {
                  catalog: catalog ?? null,
                  schema: schema ?? null,
                  tableName: typeof tableName === 'string' ? tableName : null,
                },
              })
            }
            sqlLabMode={false}
            {...(state.catalog ? { catalog: state.catalog } : {})}
            {...(state.schema ? { schema: state.schema } : {})}
            {...(state.tableName ? { tableValue: state.tableName } : {})}
          />
          <HelpNote style={{ marginTop: 12 }}>
            {t(
              'Physical-table datasets keep the source table identity. If you need a custom dataset name or SQL transformation, switch to SQL Query.',
            )}
          </HelpNote>
        </Card>
      ) : (
        <Card className="section-card">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Text strong>{t('Optional schema')}</Text>
              <Input
                aria-label={t('Optional schema')}
                onChange={event =>
                  dispatch({
                    type: 'SET_DATABASE_SOURCE_SELECTION',
                    payload: { schema: event.target.value || null },
                  })
                }
                placeholder={t('public')}
                value={state.schema ?? ''}
              />
            </div>
            <div>
              <Text strong>{t('SQL Query')}</Text>
              <Input.TextArea
                aria-label={t('SQL Query')}
                autoSize={{ minRows: 8, maxRows: 16 }}
                onChange={event =>
                  dispatch({
                    type: 'SET_SQL',
                    payload: event.target.value,
                  })
                }
                placeholder={t('SELECT * FROM analytics.fact_visits')}
                value={state.sql}
              />
            </div>
          </Space>
        </Card>
      )}
      {errors.sourceSelection && (
        <Alert type="error" message={errors.sourceSelection} showIcon />
      )}
    </SourceSelectionStep>
  );

  const renderDataSelection = () => (
    <Card className="section-card">
      <Title level={4}>{t('Data Selection')}</Title>
      <Paragraph className="section-subtitle">
        {t(
          'Work through variables, periods, and organisation units without leaving the selection step. The summary stays visible so the scope is always obvious.',
        )}
      </Paragraph>
      {errors.dataSelection && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={t('Complete this step')}
          description={errors.dataSelection}
        />
      )}
      <Tabs
        activeKey={selectedDataTab}
        items={[
          {
            key: 'variables',
            label: t('Variables'),
            children: (
              <WizardStepDataElements
                databaseId={state.databaseId ?? undefined}
                errors={errors}
                instances={activeInstances}
                updateState={updateDhIS2State}
                wizardState={dhis2WizardAdapterState}
              />
            ),
          },
          {
            key: 'periods',
            label: t('Periods'),
            children: (
              <WizardStepPeriods
                databaseId={state.databaseId ?? undefined}
                errors={errors}
                updateState={updateDhIS2State}
                wizardState={dhis2WizardAdapterState}
              />
            ),
          },
          {
            key: 'org_units',
            label: t('Organisation Units'),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <WizardStepOrgUnits
                  databaseId={state.databaseId ?? undefined}
                  errors={errors}
                  instances={activeInstances}
                  metadataMode="repository"
                  updateState={updateDhIS2State}
                  wizardState={dhis2WizardAdapterState}
                  forceSourceMode="repository"
                  hideSourceModeSelector
                  hideSourceModeConfiguration
                  hideUserScopeOptions
                  hideGroupFilter
                  hideAutoDetect
                  onMetadataLoaded={setRepositoryOrgUnitMetadata}
                  labels={{
                    title: t('Repository organisation units'),
                    description: t(
                      'Choose the saved repository organisation units for this Database. Repository lineage routes extraction back to the correct DHIS2 source instances automatically.',
                    ),
                    dataScopeDescription: t(
                      'Choose how far below the selected repository organisation units the staged sync should load data.',
                    ),
                  }}
                />
                <Card className="section-card">
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div>
                      <Text strong>{t('Dataset org-unit dimensions')}</Text>
                      <Paragraph className="section-subtitle" style={{ marginBottom: 0 }}>
                        {t(
                          'Start from the Database repository dimensions, then keep only the hierarchy levels, org unit groups, and group sets needed for this dataset.',
                        )}
                      </Paragraph>
                    </div>
                    {repositoryLevelDimensionOptions.length === 0 &&
                    repositoryGroupDimensionOptions.length === 0 &&
                    repositoryGroupSetDimensionOptions.length === 0 ? (
                      <Alert
                        type="info"
                        showIcon
                        message={t('No repository dimensions are available yet')}
                        description={t(
                          'Save repository reporting units and enabled dimensions on the Database first, then reopen this step to tailor dataset-specific org-unit dimensions.',
                        )}
                      />
                    ) : (
                      <SettingsGrid>
                        <div>
                          <Text strong>{t('Hierarchy levels')}</Text>
                          <Select
                            mode="multiple"
                            value={state.repositoryDimensionKeys.levels}
                            onChange={value =>
                              updateDhIS2State({
                                repositoryDimensionKeys: {
                                  ...state.repositoryDimensionKeys,
                                  levels: value as string[],
                                },
                              })
                            }
                            placeholder={t('Select hierarchy levels')}
                            options={repositoryLevelDimensionOptions}
                            optionFilterProp="label"
                            style={{ width: '100%', marginTop: 8 }}
                          />
                        </div>
                        <div>
                          <Text strong>{t('Org unit groups')}</Text>
                          <Select
                            mode="multiple"
                            value={state.repositoryDimensionKeys.groups}
                            onChange={value =>
                              updateDhIS2State({
                                repositoryDimensionKeys: {
                                  ...state.repositoryDimensionKeys,
                                  groups: value as string[],
                                },
                              })
                            }
                            placeholder={t('Select org unit groups')}
                            options={repositoryGroupDimensionOptions}
                            optionFilterProp="label"
                            style={{ width: '100%', marginTop: 8 }}
                          />
                        </div>
                        <div>
                          <Text strong>{t('Org unit group sets')}</Text>
                          <Select
                            mode="multiple"
                            value={state.repositoryDimensionKeys.group_sets}
                            onChange={value =>
                              updateDhIS2State({
                                repositoryDimensionKeys: {
                                  ...state.repositoryDimensionKeys,
                                  group_sets: value as string[],
                                },
                              })
                            }
                            placeholder={t('Select org unit group sets')}
                            options={repositoryGroupSetDimensionOptions}
                            optionFilterProp="label"
                            style={{ width: '100%', marginTop: 8 }}
                          />
                        </div>
                      </SettingsGrid>
                    )}
                    {state.repositoryDimensionKeys.levels.length > 0 ||
                    state.repositoryDimensionKeys.groups.length > 0 ||
                    state.repositoryDimensionKeys.group_sets.length > 0 ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {state.repositoryDimensionKeys.levels.map(key => (
                          <Tag key={`level-${key}`} color="blue">
                            {repositoryLevelDimensionOptions.find(
                              option => option.value === key,
                            )?.label || key}
                          </Tag>
                        ))}
                        {state.repositoryDimensionKeys.groups.map(key => (
                          <Tag key={`group-${key}`} color="green">
                            {repositoryGroupDimensionOptions.find(
                              option => option.value === key,
                            )?.label || key}
                          </Tag>
                        ))}
                        {state.repositoryDimensionKeys.group_sets.map(key => (
                          <Tag key={`group-set-${key}`} color="gold">
                            {repositoryGroupSetDimensionOptions.find(
                              option => option.value === key,
                            )?.label || key}
                          </Tag>
                        ))}
                      </div>
                    ) : null}
                  </Space>
                </Card>
              </Space>
            ),
          },
        ]}
        onChange={setSelectedDataTab}
      />
    </Card>
  );

  const renderSettings = () => {
    const datasetNameLocked =
      state.datasetType === 'database' && state.databaseSourceMode === 'table';

    return (
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Card className="section-card">
          <Title level={4}>{t('Dataset Settings')}</Title>
          <Paragraph className="section-subtitle">
            {t(
              'Set the dataset name, add context for other users, and review the managed refresh schedule for staged serving.',
            )}
          </Paragraph>
          {errors.settings && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              message={errors.settings}
            />
          )}
          <SettingsGrid>
            <div>
              <Text strong>{t('Dataset Name')}</Text>
              <Input
                aria-label={t('Dataset Name')}
                disabled={datasetNameLocked}
                onChange={event =>
                  dispatch({
                    type: 'PATCH_DATASET_SETTINGS',
                    payload: {
                      name: event.target.value,
                      nameTouched: true,
                    },
                  })
                }
                placeholder={t('Enter a dataset name')}
                value={
                  datasetNameLocked ? state.tableName ?? '' : state.datasetSettings.name
                }
              />
              <HelpNote style={{ marginTop: 8 }}>
                {datasetNameLocked
                  ? t(
                      'Physical-table datasets use the selected table name so Superset keeps the source table identity intact.',
                    )
                  : t(
                      'Use a clear analytical name. This is what users will see in charts and dashboards.',
                    )}
              </HelpNote>
            </div>
            <div>
              <Text strong>{t('Description')}</Text>
              <Input.TextArea
                aria-label={t('Description')}
                autoSize={{ minRows: 4, maxRows: 6 }}
                onChange={event =>
                  dispatch({
                    type: 'PATCH_DATASET_SETTINGS',
                    payload: {
                      description: event.target.value,
                    },
                  })
                }
                placeholder={t('Describe the purpose and intended use of this dataset')}
                value={state.datasetSettings.description}
              />
            </div>
          </SettingsGrid>
        </Card>
        <WizardStepSchedule
          onChange={schedule =>
            dispatch({
              type: 'SET_SCHEDULE_CONFIG',
              payload: schedule,
            })
          }
          scheduleConfig={state.scheduleConfig}
        />
      </Space>
    );
  };

  const renderReview = () => (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Card className="section-card">
        <Title level={4}>{t('Review & Create')}</Title>
        <Paragraph className="section-subtitle">
          {t(
            'Review the selected source, data scope, schedule, and staging behavior before creating the dataset.',
          )}
        </Paragraph>
        <ReviewGrid>
          <SourceMetric>
            <div className="metric-label">{t('Dataset type')}</div>
            <div className="metric-value">
              {state.datasetType === 'dhis2' ? t('DHIS2 Dataset') : t('Database Dataset')}
            </div>
          </SourceMetric>
          <SourceMetric>
            <div className="metric-label">{t('Database')}</div>
            <div className="metric-value">
              {state.database?.database_name || t('Not selected')}
            </div>
          </SourceMetric>
          <SourceMetric>
            <div className="metric-label">{t('Schedule')}</div>
            <div className="metric-value">{formatScheduleSummary(state.scheduleConfig)}</div>
          </SourceMetric>
          <SourceMetric>
            <div className="metric-label">{t('Background processing')}</div>
            <div className="metric-value">{t('System-managed')}</div>
          </SourceMetric>
        </ReviewGrid>
      </Card>

      {state.datasetType === 'dhis2' ? (
        <Card className="section-card" title={t('DHIS2 scope')}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text>
              {t('Configured connections')}: {selectedInstances.length}
            </Text>
            <div>
              <Space wrap>
                {selectedInstances.map(instance => (
                  <Tag key={instance.id} color="blue">
                    {instance.name}
                  </Tag>
                ))}
              </Space>
            </div>
            <Text>
              {t('Variables')}: {state.selectedVariables.length}
            </Text>
            <VariablePreviewList>
              {summaryVariables.map(variable => (
                <VariablePreviewItem key={`${variable.instanceId}-${variable.variableId}`}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{variable.alias || variable.variableName}</div>
                    <Text type="secondary">{variable.variableType}</Text>
                  </div>
                  <Tag color="geekblue">
                    {instanceNameById.get(variable.instanceId) || variable.instanceName}
                  </Tag>
                </VariablePreviewItem>
              ))}
            </VariablePreviewList>
            {state.selectedVariables.length > summaryVariables.length && (
              <HelpNote>
                {t(
                  'Plus %s more variables selected across the chosen instances.',
                  state.selectedVariables.length - summaryVariables.length,
                )}
              </HelpNote>
            )}
            <Divider />
            <Text>
              {t('Periods')}: {state.periods.length}
            </Text>
            <Text>
              {t('Organisation units')}: {state.orgUnits.length}
            </Text>
            <Text>
              {t('Organisation-unit source policy')}:{' '}
              {state.orgUnitSourceMode === 'primary'
                ? t('Primary configured connection')
                : state.orgUnitSourceMode === 'per_instance'
                  ? t('Keep each configured connection separate')
                  : t('Repository merge across selected connections')}
            </Text>
            {state.orgUnitSourceMode === 'primary' && primaryOrgUnitInstance ? (
              <Text>
                {t('Primary configured connection')}: {primaryOrgUnitInstance.name}
              </Text>
            ) : null}
            <Text>
              {t('Scope')}: {state.dataLevelScope}
            </Text>
            <Text>
              {t('Dataset org-unit dimensions')}: {t(
                '%s levels, %s groups, %s group sets',
                state.repositoryDimensionKeys.levels.length,
                state.repositoryDimensionKeys.groups.length,
                state.repositoryDimensionKeys.group_sets.length,
              )}
            </Text>
          </Space>
        </Card>
      ) : (
        <Card className="section-card" title={t('Database source details')}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text>
              {t('Source mode')}: {state.databaseSourceMode === 'table' ? t('Table') : t('SQL Query')}
            </Text>
            {state.databaseSourceMode === 'table' ? (
              <>
                <Text>
                  {t('Schema')}: {state.schema || t('Not selected')}
                </Text>
                <Text>
                  {t('Table')}: {state.tableName || t('Not selected')}
                </Text>
              </>
            ) : (
              <>
                <Text>{t('Optional schema')}: {state.schema || t('None')}</Text>
                <Input.TextArea
                  autoSize={{ minRows: 6, maxRows: 10 }}
                  readOnly
                  value={state.sql}
                />
              </>
            )}
          </Space>
        </Card>
      )}

      <Alert
        type="info"
        showIcon
        message={t('Managed staging and refresh')}
        description={t(
          'Background processing is automatically enabled for staged datasets and is managed by the system. Users cannot disable it from the creation workflow.',
        )}
      />
    </Space>
  );

  const renderSummary = () => (
    <SummaryCard title={t('Live Summary')}>
      <div className="summary-section">
        <div className="summary-label">{t('Database Type')}</div>
        <div className="summary-value">
          {state.datasetType === 'dhis2'
            ? t('DHIS2 Dataset')
            : state.datasetType === 'database'
              ? t('Database Dataset')
              : t('Not selected')}
        </div>
      </div>
      <div className="summary-section">
        <div className="summary-label">{t('Database')}</div>
        <div className="summary-value">
          {state.database?.database_name || t('Choose a Database')}
        </div>
      </div>
      {state.datasetType === 'dhis2' ? (
        <>
          <div className="summary-section">
            <div className="summary-label">{t('Included DHIS2 instances')}</div>
            <div className="summary-value">{state.selectedInstanceIds.length}</div>
            {selectedInstances.length > 0 && (
              <div className="summary-list" style={{ marginTop: 10 }}>
                {selectedInstances.slice(0, 4).map(instance => (
                  <Tag key={instance.id} color="blue">
                    {instance.name}
                  </Tag>
                ))}
              </div>
            )}
          </div>
          <div className="summary-section">
            <div className="summary-label">{t('Variables')}</div>
            <div className="summary-value">{state.selectedVariables.length}</div>
          </div>
          <div className="summary-section">
            <div className="summary-label">{t('Periods')}</div>
            <div className="summary-value">{state.periods.length}</div>
          </div>
          <div className="summary-section">
            <div className="summary-label">{t('Organisation Units')}</div>
            <div className="summary-value">{state.orgUnits.length}</div>
            <HelpNote style={{ marginTop: 8 }}>
              {state.orgUnitSourceMode === 'primary'
                ? primaryOrgUnitInstance
                  ? t('Using %s as the primary org-unit source.', primaryOrgUnitInstance.name)
                  : t('Primary org-unit source will be resolved from the selected connections.')
                : state.orgUnitSourceMode === 'per_instance'
                  ? t('Keeping each configured connection hierarchy separate in local staging.')
                  : t('Merging selected configured connections into the repository org-unit structure.')}
            </HelpNote>
          </div>
          <div className="summary-section">
            <div className="summary-label">{t('Org-unit dimensions')}</div>
            <div className="summary-value">
              {state.repositoryDimensionKeys.levels.length +
                state.repositoryDimensionKeys.groups.length +
                state.repositoryDimensionKeys.group_sets.length}
            </div>
            <HelpNote style={{ marginTop: 8 }}>
              {t(
                '%s hierarchy levels, %s groups, %s group sets',
                state.repositoryDimensionKeys.levels.length,
                state.repositoryDimensionKeys.groups.length,
                state.repositoryDimensionKeys.group_sets.length,
              )}
            </HelpNote>
          </div>
        </>
      ) : (
        <div className="summary-section">
          <div className="summary-label">{t('Source mode')}</div>
          <div className="summary-value">
            {state.databaseSourceMode === 'table' ? t('Table') : t('SQL Query')}
          </div>
          <HelpNote style={{ marginTop: 8 }}>
            {state.databaseSourceMode === 'table'
              ? `${state.schema || t('Schema')} / ${state.tableName || t('Table')}`
              : t('Custom SQL source configured')}
          </HelpNote>
        </div>
      )}
      <div className="summary-section">
        <div className="summary-label">{t('Dataset Name')}</div>
        <div className="summary-value">
          {state.datasetSettings.name || state.tableName || t('Not set')}
        </div>
      </div>
      <div className="summary-section">
        <div className="summary-label">{t('Schedule')}</div>
        <div className="summary-value">{formatScheduleSummary(state.scheduleConfig)}</div>
      </div>
      <div className="summary-section">
        <div className="summary-label">{t('Serving mode')}</div>
        <div className="summary-value">
          {state.stagingCapabilities?.staging_supported
            ? t('Local staged serving')
            : t('Standard dataset serving')}
        </div>
        <HelpNote style={{ marginTop: 8 }}>
          {t('Background refresh remains system-managed for staged datasets.')}
        </HelpNote>
      </div>
    </SummaryCard>
  );

  const renderCurrentStep = () => {
    if (!state.datasetType) {
      return renderDatasetTypeChooser();
    }

    const key = currentSteps[currentStep]?.key;
    if (key === 'database_selection') {
      return state.datasetType === 'dhis2'
        ? renderDhIS2SourceAndInstances()
        : renderDatabaseSource();
    }
    if (key === 'data_selection') {
      return renderDataSelection();
    }
    if (key === 'source_selection') {
      return renderDatabaseSourceSelection();
    }
    if (key === 'dataset_settings') {
      return renderSettings();
    }
    return renderReview();
  };

  if (editLoading) {
    return (
      <div style={{ padding: '64px 0', textAlign: 'center' }}>
        <Loading />
      </div>
    );
  }

  return (
    <WizardShell compact={isCompact} data-test="branching-dataset-wizard">
      <div className="wizard-frame" data-layout={isCompact ? 'stacked' : 'split'}>
        <div className="wizard-header">
          <div className="wizard-header-top">
            <div>
              <Title level={3} style={{ marginBottom: 8 }}>
                {getFlowTitle(state.datasetType)}
              </Title>
              <Paragraph style={{ margin: 0, maxWidth: 820 }}>
                {getFlowDescription(state.datasetType)}
              </Paragraph>
            </div>
            <Space wrap>
              {state.datasetType && (
                <Button onClick={resetDatasetType}>{t('Change database')}</Button>
              )}
              <Button onClick={() => history.push(PREV_URL)}>{t('Cancel')}</Button>
            </Space>
          </div>
          {state.datasetType ? (
            <Steps
              current={currentStep}
              items={currentSteps.map(step => ({
                title: step.title,
                description: step.description,
              }))}
              size="small"
            />
          ) : null}
        </div>

        <div className="wizard-body">
          <div className="wizard-main">{renderCurrentStep()}</div>
          <div className="wizard-sidebar">{renderSummary()}</div>
        </div>

        <div className="wizard-footer">
          <Space wrap>
            {state.datasetType ? (
              <Button onClick={previousStep} disabled={currentStep === 0}>
                {t('Back')}
              </Button>
            ) : null}
          </Space>
          <Space wrap>
            {state.datasetType && currentStep < currentSteps.length - 1 ? (
              <Button type="primary" onClick={nextStep}>
                {t('Next')}
              </Button>
            ) : null}
            {state.datasetType && currentStep === currentSteps.length - 1 ? (
              <>
                {isEditMode ? (
                  <Button
                    loading={saving}
                    type="primary"
                    onClick={() => void handleCreate(false)}
                  >
                    {t('Update Dataset')}
                  </Button>
                ) : (
                  <>
                    <Button loading={saving} onClick={() => void handleCreate(false)}>
                      {t('Create Dataset')}
                    </Button>
                    <Button
                      loading={saving}
                      onClick={() => void handleCreate(true)}
                      type="primary"
                    >
                      {t('Create and Explore')}
                    </Button>
                  </>
                )}
              </>
            ) : null}
          </Space>
        </div>
      </div>
    </WizardShell>
  );
}
