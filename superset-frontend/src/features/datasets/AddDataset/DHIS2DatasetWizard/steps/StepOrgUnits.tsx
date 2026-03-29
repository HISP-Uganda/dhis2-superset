import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { styled, SupersetClient, t, useTheme } from '@superset-ui/core';
import Tree from '@superset-ui/core/components/Tree';
import { Alert } from 'antd';
import {
  Input,
  Empty,
  Tag,
  Button,
  Badge,
  Row,
  Col,
  Select,
  Radio,
  Checkbox,
  Typography,
  Loading,
} from '@superset-ui/core/components';

import { DHIS2WizardState } from '../index';
import StepLevelMapping from './StepLevelMapping';
import type {
  DatabaseRepositoryEnabledDimensions,
  DatabaseRepositoryOrgUnitConfig,
  DatabaseObject,
  RepositoryLevelMappingConfig,
  RepositoryOrgUnitLineage,
  RepositoryOrgUnitRecord,
  RepositoryReportingUnitApproach,
} from 'src/features/databases/types';

const { Title, Paragraph, Text } = Typography;

const USER_SCOPE_IDS = new Set([
  'USER_ORGUNIT',
  'USER_ORGUNIT_CHILDREN',
  'USER_ORGUNIT_GRANDCHILDREN',
]);

const SELECT_DROPDOWN_STYLE = {
  maxHeight: 320,
  overflow: 'auto' as const,
};

const StepContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1120px;
  width: 100%;
  margin: 0 auto;
`;

const ContentSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const OptionsContainer = styled.div<{ $flat?: boolean }>`
  ${({ theme, $flat }) => `
    background: ${$flat ? 'transparent' : theme.colorBgContainer};
    border: ${$flat ? 'none' : `1px solid ${theme.colorBorder}`};
    border-radius: ${$flat ? 0 : theme.borderRadius * 2}px;
    padding: ${$flat ? 0 : `${theme.sizeUnit * 4}px ${theme.sizeUnit * 5}px`};
  `}
`;

const CheckboxGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const TreeContainer = styled.div<{ $flat?: boolean }>`
  ${({ theme, $flat }) => `
    background: ${$flat ? 'transparent' : theme.colorBgContainer};
    border: 1px solid ${$flat ? theme.colorBorderSecondary : theme.colorBorder};
    border-radius: ${$flat ? theme.borderRadius : theme.borderRadius * 2}px;
    max-height: 500px;
    overflow-y: auto;
    padding: ${$flat ? theme.sizeUnit * 3 : theme.sizeUnit * 2}px;
  `}
`;

const FiltersRow = styled(Row)`
  margin-bottom: 16px;
`;

const SectionTitle = styled.h4`
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colorTextBase};
`;

const SelectedSummary = styled.div<{ $flat?: boolean }>`
  ${({ theme, $flat }) => `
    background: ${$flat ? 'transparent' : theme.colorBgContainer};
    border: ${$flat ? 'none' : `1px solid ${theme.colorBorder}`};
    border-top: ${
      $flat ? `1px solid ${theme.colorBorderSecondary}` : `1px solid ${theme.colorBorder}`
    };
    border-radius: ${$flat ? 0 : theme.borderRadius * 2}px;
    padding: ${$flat ? `${theme.sizeUnit * 3}px 0 0` : `${theme.sizeUnit * 4}px`};
    margin-top: ${theme.sizeUnit * 2}px;
  `}
`;

const ErrorText = styled.div`
  ${({ theme }) => `
    color: ${theme.colorErrorText};
    font-size: 12px;
    margin-bottom: 12px;
    padding: 8px 12px;
    background: ${theme.colorErrorBg};
    border-radius: 4px;
  `}
`;

const DataScopeOptions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const DataScopeOption = styled.div<{ $flat?: boolean }>`
  ${({ theme, $flat }) => `
    padding: ${$flat ? `0 0 ${theme.sizeUnit * 3}px` : '12px'};
    background: ${$flat ? 'transparent' : theme.colorBgContainer};
    border-radius: ${$flat ? 0 : theme.borderRadius}px;
    border-bottom: ${
      $flat ? `1px solid ${theme.colorBorderSecondary}` : 'none'
    };

    &:last-child {
      padding-bottom: ${$flat ? 0 : '12px'};
      border-bottom: none;
    }
  `}
`;

interface StepOrgUnitsProps {
  wizardState: DHIS2WizardState;
  updateState: (updates: Partial<DHIS2WizardState>) => void;
  errors: Record<string, string>;
  databaseId?: number;
  instances?: InstanceOption[];
  metadataMode?: 'dhis2' | 'repository';
  hideSourceModeSelector?: boolean;
  hideSourceModeConfiguration?: boolean;
  forceSourceMode?: OrgUnitSourceMode;
  hideAutoDetect?: boolean;
  hideUserScopeOptions?: boolean;
  hideGroupFilter?: boolean;
  includeAncestorsScope?: boolean;
  lockedDataScope?: DataLevelScope | null;
  dataScopeLockedMessage?: string | null;
  lowestDataLevelOptions?: Array<{
    value: string;
    label: string;
  }>;
  flatSections?: boolean;
  labels?: StepOrgUnitsLabels;
  onMetadataLoaded?: (metadata: StepOrgUnitsMetadataPayload) => void;
}

interface InstanceOption {
  id: number;
  name: string;
  is_active: boolean;
}

export type OrgUnitSourceMode =
  | 'primary'
  | 'repository'
  | 'per_instance'
  | 'federated';

export interface OrgUnit {
  id: string;
  selectionKey: string;
  sourceOrgUnitId: string;
  displayName: string;
  parentId?: string;
  level?: number;
  path?: string;
  sourceInstanceIds: number[];
  sourceInstanceNames: string[];
  repositoryLevel?: number;
  repositoryLevelName?: string;
  repositoryKey?: string;
  sourceLineageLabel?: string | null;
  strategy?: RepositoryReportingUnitApproach | string | null;
  lineage?: RepositoryOrgUnitLineage[];
  provenance?: Record<string, unknown> | null;
}

export interface OrgUnitLevel {
  level: number;
  displayName: string;
  name?: string;
  aliases?: string[];
  sourceInstanceIds?: number[];
  sourceInstanceNames?: string[];
  /** Per-instance level name: instanceId → that instance's own name for this level */
  instanceLevelNames?: Record<number, string>;
}

export interface OrgUnitGroup {
  id: string;
  displayName: string;
  organisationUnits?: OrgUnit[];
}

export interface OrgUnitGroupSetMember {
  id: string;
  displayName: string;
}

export interface OrgUnitGroupSet {
  id: string;
  displayName: string;
  organisationUnitGroups?: OrgUnitGroupSetMember[];
  sourceInstanceIds?: number[];
  sourceInstanceNames?: string[];
}

interface FederatedInstanceResult {
  id: number;
  name: string;
  status: 'success' | 'failed' | 'pending';
  count?: number;
  error?: string | null;
}

export type DataLevelScope =
  | 'selected'
  | 'children'
  | 'grandchildren'
  | 'ancestors'
  | 'all_levels';

export interface StepOrgUnitsLabels {
  title?: string;
  description?: string;
  sourcePolicyTitle?: string;
  sourcePolicyDescription?: string;
  userOptionsTitle?: string;
  dataScopeTitle?: string;
  dataScopeDescription?: string;
  lowestDataLevelTitle?: string;
  lowestDataLevelDescription?: string;
}

export interface StepOrgUnitsMetadataPayload {
  orgUnits: OrgUnit[];
  orgUnitLevels: OrgUnitLevel[];
  orgUnitGroups: OrgUnitGroup[];
  orgUnitGroupSets: OrgUnitGroupSet[];
  instances: InstanceOption[];
  repositoryConfig?: DatabaseRepositoryOrgUnitConfig | null;
  repositoryEnabledDimensions?: DatabaseRepositoryEnabledDimensions | null;
  repositoryApproach?: RepositoryReportingUnitApproach | null;
  repositoryDataScope?: DataLevelScope | null;
  repositoryLowestDataLevelToUse?: number | null;
}

interface ScopedSelectionPruneResult {
  validKeys: string[];
  pruned: Array<{
    selectionKey: string;
    ancestorKey: string;
    reason: 'covered_by_scope' | 'beyond_scope';
  }>;
}

function buildMetadataEndpoint(
  databaseId: number,
  metadataType: string,
  instanceIds: number[],
  options?: {
    federated?: boolean;
    orgUnitSourceMode?: OrgUnitSourceMode;
    primaryInstanceId?: number | null;
  },
): string {
  const params = new URLSearchParams({
    type: metadataType,
  });
  if (options?.federated) {
    params.set('federated', 'true');
  }
  if (options?.orgUnitSourceMode) {
    params.set('org_unit_source_mode', options.orgUnitSourceMode);
  }
  if (
    options?.orgUnitSourceMode === 'primary' &&
    options?.primaryInstanceId
  ) {
    params.set('primary_instance_id', String(options.primaryInstanceId));
  }
  params.set('staged', 'true');
  instanceIds.forEach(instanceId => {
    params.append('instance_ids', String(instanceId));
  });
  return `/api/v1/database/${databaseId}/dhis2_metadata/?${params.toString()}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function normalizeOrgUnitSourceMode(mode?: OrgUnitSourceMode): Exclude<
  OrgUnitSourceMode,
  'federated'
> {
  if (mode === 'primary' || mode === 'per_instance') {
    return mode;
  }
  return 'repository';
}

function buildOrgUnitSelectionKey(
  orgUnitId: string,
  sourceInstanceId: number | null,
  sourceMode: Exclude<OrgUnitSourceMode, 'federated'>,
): string {
  if (sourceMode === 'per_instance' && sourceInstanceId !== null) {
    return `${sourceInstanceId}::${orgUnitId}`;
  }
  return orgUnitId;
}

function getInstanceTaggedLabel(label: string, instanceName: string | null): string {
  if (!instanceName) {
    return label;
  }
  return `${label} (${instanceName})`;
}

function buildRepositoryLevelNameMap(levels: OrgUnitLevel[]): Map<number, string> {
  return new Map(levels.map(level => [level.level, level.displayName] as const));
}

function sortOrgUnitLevelsAscending(levels: OrgUnitLevel[]): OrgUnitLevel[] {
  return levels.slice().sort((left, right) => left.level - right.level);
}

function sortLevelSelectOptionsAscending<T extends { value: string; label: unknown }>(
  options: T[],
): T[] {
  return options.slice().sort((left, right) => {
    const leftLevel = Number.parseInt(left.value, 10);
    const rightLevel = Number.parseInt(right.value, 10);
    const leftIsNumeric = Number.isFinite(leftLevel);
    const rightIsNumeric = Number.isFinite(rightLevel);

    if (leftIsNumeric && rightIsNumeric && leftLevel !== rightLevel) {
      return leftLevel - rightLevel;
    }
    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }
    return String(left.label || '').localeCompare(String(right.label || ''));
  });
}

function isGenericRepositoryLevelLabel(
  label: string | null | undefined,
  level?: number | null,
): boolean {
  if (typeof label !== 'string' || !label.trim()) {
    return true;
  }
  const normalized = label.trim();
  const numericSuffix =
    typeof level === 'number' && Number.isFinite(level) ? `\\s*${level}` : '\\s*\\d+';
  return new RegExp(`^(?:Repository\\s+level|Level)${numericSuffix}$`, 'i').test(
    normalized,
  );
}

function getOrgUnitLevelName(
  orgUnitLevels: OrgUnitLevel[],
  level: number | null | undefined,
  instanceId?: number | null,
): string | null {
  if (typeof level !== 'number' || !Number.isFinite(level)) {
    return null;
  }
  const matchingLevel = orgUnitLevels.find(item => item.level === level);
  if (!matchingLevel) {
    return null;
  }
  const instanceSpecificName =
    typeof instanceId === 'number'
      ? matchingLevel.instanceLevelNames?.[instanceId]
      : null;
  const resolvedName =
    instanceSpecificName ||
    matchingLevel.displayName ||
    matchingLevel.name ||
    matchingLevel.aliases?.find(
      alias => typeof alias === 'string' && !isGenericRepositoryLevelLabel(alias),
    );
  if (!resolvedName || isGenericRepositoryLevelLabel(resolvedName, level)) {
    return null;
  }
  return resolvedName.trim();
}

function resolveRepositoryLevelLabel(params: {
  mergedLevel: number;
  savedLabel?: string | null;
  instanceLevels?: Record<string, number | null>;
  orgUnitLevels?: OrgUnitLevel[];
  repositoryRecords?: RepositoryOrgUnitRecord[];
}): string {
  const {
    mergedLevel,
    savedLabel,
    instanceLevels = {},
    orgUnitLevels = [],
    repositoryRecords = [],
  } = params;

  if (
    typeof savedLabel === 'string' &&
    savedLabel.trim() &&
    !isGenericRepositoryLevelLabel(savedLabel, mergedLevel)
  ) {
    return savedLabel.trim();
  }

  const candidateLabels = Object.entries(instanceLevels)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([instanceId, sourceLevel]) =>
      getOrgUnitLevelName(
        orgUnitLevels,
        sourceLevel,
        Number.isFinite(Number(instanceId)) ? Number(instanceId) : null,
      ),
    )
    .filter((value): value is string => !!value);

  if (candidateLabels.length > 0) {
    return candidateLabels[0];
  }

  const repositoryProvenanceLabel = repositoryRecords.find(
    record =>
      record.level === mergedLevel &&
      typeof record.provenance?.repositoryLevelName === 'string' &&
      record.provenance.repositoryLevelName.trim().length > 0,
  )?.provenance?.repositoryLevelName;
  if (
    typeof repositoryProvenanceLabel === 'string' &&
    repositoryProvenanceLabel.trim() &&
    !isGenericRepositoryLevelLabel(repositoryProvenanceLabel, mergedLevel)
  ) {
    return repositoryProvenanceLabel.trim();
  }

  const lineageProvenanceLabel = repositoryRecords
    .filter(record => record.level === mergedLevel)
    .flatMap(record => record.lineage || [])
    .find(
      lineage =>
        typeof lineage?.provenance?.repositoryLevelName === 'string' &&
        String(lineage.provenance.repositoryLevelName).trim().length > 0,
    )?.provenance?.repositoryLevelName;
  if (
    typeof lineageProvenanceLabel === 'string' &&
    lineageProvenanceLabel.trim() &&
    !isGenericRepositoryLevelLabel(lineageProvenanceLabel, mergedLevel)
  ) {
    return lineageProvenanceLabel.trim();
  }

  const directLevelName = getOrgUnitLevelName(orgUnitLevels, mergedLevel);
  if (directLevelName) {
    return directLevelName;
  }

  return t('Repository level %s', mergedLevel);
}

function normalizeRepositoryLevelMapping(
  payload: unknown,
): RepositoryLevelMappingConfig | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  if (candidate.enabled !== true || !Array.isArray(candidate.rows)) {
    return null;
  }

  const rows = candidate.rows
    .map(item => {
      const row = item as Record<string, unknown>;
      const mergedLevel =
        typeof row.merged_level === 'number'
          ? row.merged_level
          : typeof row.merged_level === 'string'
            ? Number(row.merged_level)
            : NaN;
      if (!Number.isFinite(mergedLevel)) {
        return null;
      }
      return {
        merged_level: mergedLevel,
        label:
          typeof row.label === 'string' && row.label.trim()
            ? row.label.trim()
            : `Repository level ${mergedLevel}`,
        instance_levels:
          row.instance_levels && typeof row.instance_levels === 'object'
            ? (row.instance_levels as Record<string, number | null>)
            : {},
      };
    })
    .filter(
      (
        row,
      ): row is NonNullable<RepositoryLevelMappingConfig>['rows'][number] => row !== null,
    );

  if (rows.length === 0) {
    return null;
  }

  return {
    enabled: true,
    rows,
  };
}

function normalizeRepositoryOrgUnitLevels(
  records: RepositoryOrgUnitRecord[],
  levelMapping: RepositoryLevelMappingConfig | null,
  sourceOrgUnitLevels: OrgUnitLevel[] = [],
): OrgUnitLevel[] {
  if (levelMapping?.enabled) {
    return levelMapping.rows
      .slice()
      .sort((left, right) => left.merged_level - right.merged_level)
      .map(row => ({
        level: row.merged_level,
        displayName: resolveRepositoryLevelLabel({
          mergedLevel: row.merged_level,
          savedLabel: row.label,
          instanceLevels: row.instance_levels,
          orgUnitLevels: sourceOrgUnitLevels,
          repositoryRecords: records,
        }),
      }));
  }

  const levels = new Map<number, string>();
  records.forEach(record => {
    if (typeof record.level !== 'number') {
      return;
    }
    const lineageEntries = Array.isArray(record.lineage) ? record.lineage : [];
    const lineageLevelLabel = lineageEntries.find(
      lineage =>
        typeof lineage?.provenance?.repositoryLevelName === 'string' &&
        String(lineage.provenance.repositoryLevelName).trim().length > 0,
    )?.provenance?.repositoryLevelName;
    const label =
      typeof lineageLevelLabel === 'string' && lineageLevelLabel.trim()
        ? lineageLevelLabel.trim()
        : resolveRepositoryLevelLabel({
            mergedLevel: record.level,
            savedLabel: `Repository level ${record.level}`,
            orgUnitLevels: sourceOrgUnitLevels,
            repositoryRecords: records,
          });
    if (!levels.has(record.level)) {
      levels.set(record.level, label);
    }
  });

  return Array.from(levels.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([level, displayName]) => ({
      level,
      displayName,
    }));
}

function normalizeRepositoryOrgUnits(
  payload: unknown,
  repositoryLevelNames: Map<number, string>,
  instanceNames: Map<number, string>,
): OrgUnit[] {
  const records = Array.isArray(payload)
    ? payload.filter(
        (item): item is RepositoryOrgUnitRecord =>
          !!item && typeof item === 'object' && typeof (item as RepositoryOrgUnitRecord).repository_key === 'string',
      )
    : [];

  return records
    .map(record => {
      const sourceInstanceIds = Array.from(
        new Set(
          (record.lineage || [])
            .map(lineage =>
              typeof lineage.instance_id === 'number' ? lineage.instance_id : NaN,
            )
            .filter(value => Number.isFinite(value)),
        ),
      );
      return {
        id: record.repository_key,
        repositoryKey: record.repository_key,
        selectionKey: record.repository_key,
        sourceOrgUnitId: record.repository_key,
        displayName: record.display_name,
        parentId: record.parent_repository_key || undefined,
        level:
          typeof record.level === 'number'
            ? record.level
            : undefined,
        path: record.hierarchy_path || undefined,
        sourceInstanceIds,
        sourceInstanceNames: sourceInstanceIds
          .map(instanceId => instanceNames.get(instanceId))
          .filter((value): value is string => !!value),
        repositoryLevel:
          typeof record.level === 'number'
            ? record.level
            : undefined,
        repositoryLevelName:
          typeof record.level === 'number'
            ? repositoryLevelNames.get(record.level)
            : undefined,
        sourceLineageLabel: record.source_lineage_label || null,
        strategy: record.strategy || null,
        lineage: Array.isArray(record.lineage) ? record.lineage : [],
        provenance:
          record.provenance && typeof record.provenance === 'object'
            ? record.provenance
            : null,
      } satisfies OrgUnit;
    })
    .sort((left, right) => {
      if ((left.level ?? Number.MAX_SAFE_INTEGER) !== (right.level ?? Number.MAX_SAFE_INTEGER)) {
        return (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER);
      }
      return left.displayName.localeCompare(right.displayName);
    });
}

function normalizeOrgUnits(
  payload: unknown,
  sourceMode: OrgUnitSourceMode = 'repository',
  repositoryLevelNames: Map<number, string> = new Map(),
): OrgUnit[] {
  const normalizedMode = normalizeOrgUnitSourceMode(sourceMode);
  const merged = new Map<string, OrgUnit>();

  (Array.isArray(payload) ? payload : []).forEach(item => {
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id : null;
    if (!id) {
      return;
    }

    const displayName =
      typeof candidate.displayName === 'string'
        ? candidate.displayName
        : typeof candidate.name === 'string'
          ? candidate.name
          : id;

    const parent = candidate.parent as Record<string, unknown> | undefined;
    const parentId =
      typeof candidate.parentId === 'string'
        ? candidate.parentId
        : typeof parent?.id === 'string'
          ? parent.id
          : undefined;

    const level =
      typeof candidate.level === 'number'
        ? candidate.level
        : typeof candidate.level === 'string'
          ? Number(candidate.level)
          : undefined;
    const path =
      typeof candidate.path === 'string' ? candidate.path : undefined;
    const sourceInstanceId =
      typeof candidate.source_instance_id === 'number'
        ? candidate.source_instance_id
        : null;
    const sourceInstanceName =
      typeof candidate.source_instance_name === 'string'
        ? candidate.source_instance_name
        : null;
    const selectionKey = buildOrgUnitSelectionKey(
      id,
      sourceInstanceId,
      normalizedMode,
    );
    const selectionParentId = parentId
      ? buildOrgUnitSelectionKey(parentId, sourceInstanceId, normalizedMode)
      : undefined;
    const repositoryLevel =
      Number.isFinite(level) && typeof level === 'number' ? level : undefined;
    const repositoryLevelName =
      repositoryLevel !== undefined
        ? repositoryLevelNames.get(repositoryLevel)
        : undefined;
    const resolvedDisplayName =
      normalizedMode === 'per_instance'
        ? getInstanceTaggedLabel(displayName, sourceInstanceName)
        : displayName;

    const current = merged.get(selectionKey);
    if (!current) {
      merged.set(selectionKey, {
        id,
        selectionKey,
        sourceOrgUnitId: id,
        displayName: resolvedDisplayName,
        parentId: selectionParentId,
        level: Number.isFinite(level) ? level : undefined,
        path,
        sourceInstanceIds: sourceInstanceId ? [sourceInstanceId] : [],
        sourceInstanceNames: sourceInstanceName ? [sourceInstanceName] : [],
        repositoryLevel,
        repositoryLevelName,
      });
      return;
    }

    if (!current.displayName && resolvedDisplayName) {
      current.displayName = resolvedDisplayName;
    }
    if (!current.parentId && selectionParentId) {
      current.parentId = selectionParentId;
    }
    if (current.level === undefined && Number.isFinite(level)) {
      current.level = level;
    }
    if (!current.path && path) {
      current.path = path;
    }
    if (sourceInstanceId && !current.sourceInstanceIds.includes(sourceInstanceId)) {
      current.sourceInstanceIds = [...current.sourceInstanceIds, sourceInstanceId];
    }
    if (
      sourceInstanceName &&
      !current.sourceInstanceNames.includes(sourceInstanceName)
    ) {
      current.sourceInstanceNames = [
        ...current.sourceInstanceNames,
        sourceInstanceName,
      ];
    }
    if (current.repositoryLevel === undefined && repositoryLevel !== undefined) {
      current.repositoryLevel = repositoryLevel;
    }
    if (!current.repositoryLevelName && repositoryLevelName) {
      current.repositoryLevelName = repositoryLevelName;
    }
  });

  return Array.from(merged.values()).sort((left, right) => {
    if ((left.level ?? Number.MAX_SAFE_INTEGER) !== (right.level ?? Number.MAX_SAFE_INTEGER)) {
      return (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER);
    }
    return left.displayName.localeCompare(right.displayName);
  });
}

function normalizeOrgUnitLevels(payload: unknown): OrgUnitLevel[] {
  const merged = new Map<number, OrgUnitLevel>();

  (Array.isArray(payload) ? payload : []).forEach(item => {
    const candidate = item as Record<string, unknown>;
    const level =
      typeof candidate.level === 'number'
        ? candidate.level
        : typeof candidate.level === 'string'
          ? Number(candidate.level)
          : NaN;
    if (!Number.isFinite(level)) {
      return;
    }

    const current = merged.get(level);
    const displayName =
      typeof candidate.displayName === 'string'
        ? candidate.displayName
        : typeof candidate.name === 'string'
          ? candidate.name
          : String(level);
    const sourceInstanceId =
      typeof candidate.source_instance_id === 'number'
        ? candidate.source_instance_id
        : undefined;
    const sourceInstanceName =
      typeof candidate.source_instance_name === 'string'
        ? candidate.source_instance_name
        : undefined;
    const sourceInstanceIds = Array.isArray(candidate.source_instance_ids)
      ? candidate.source_instance_ids
          .map(value =>
            typeof value === 'number'
              ? value
              : typeof value === 'string'
                ? Number(value)
                : NaN,
          )
          .filter(value => Number.isFinite(value))
      : [];
    const sourceInstanceNames = Array.isArray(candidate.source_instance_names)
      ? candidate.source_instance_names.filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        )
      : [];
    const rawInstanceLevelNames =
      candidate.instance_level_names && typeof candidate.instance_level_names === 'object'
        ? (candidate.instance_level_names as Record<string, unknown>)
        : {};
    const instanceLevelNames = Object.fromEntries(
      Object.entries(rawInstanceLevelNames)
        .map(([key, value]) => {
          const instanceId = Number(key);
          if (!Number.isFinite(instanceId) || typeof value !== 'string' || !value) {
            return null;
          }
          return [instanceId, value] as const;
        })
        .filter((entry): entry is readonly [number, string] => entry !== null),
    );

    if (!current) {
      merged.set(level, {
        level,
        displayName,
        name: typeof candidate.name === 'string' ? candidate.name : undefined,
        aliases: [displayName],
        sourceInstanceIds: Array.from(
          new Set([
            ...sourceInstanceIds,
            ...(sourceInstanceId ? [sourceInstanceId] : []),
          ]),
        ),
        sourceInstanceNames: Array.from(
          new Set([
            ...sourceInstanceNames,
            ...(sourceInstanceName ? [sourceInstanceName] : []),
          ]),
        ),
        instanceLevelNames: {
          ...instanceLevelNames,
          ...(sourceInstanceId ? { [sourceInstanceId]: displayName } : {}),
        },
      });
      return;
    }

    if (!current.displayName && displayName) {
      current.displayName = displayName;
    }
    if (!current.name && typeof candidate.name === 'string') {
      current.name = candidate.name;
    }
    if (displayName) {
      current.aliases = Array.from(
        new Set([...(current.aliases || []), displayName]),
      );
    }
    if (
      sourceInstanceId &&
      !(current.sourceInstanceIds || []).includes(sourceInstanceId)
    ) {
      current.sourceInstanceIds = [
        ...(current.sourceInstanceIds || []),
        sourceInstanceId,
      ];
    }
    if (
      sourceInstanceName &&
      !(current.sourceInstanceNames || []).includes(sourceInstanceName)
    ) {
      current.sourceInstanceNames = [
        ...(current.sourceInstanceNames || []),
        sourceInstanceName,
      ];
    }
    sourceInstanceIds.forEach(instanceId => {
      if (!(current.sourceInstanceIds || []).includes(instanceId)) {
        current.sourceInstanceIds = [...(current.sourceInstanceIds || []), instanceId];
      }
    });
    sourceInstanceNames.forEach(name => {
      if (!(current.sourceInstanceNames || []).includes(name)) {
        current.sourceInstanceNames = [...(current.sourceInstanceNames || []), name];
      }
    });
    if (Object.keys(instanceLevelNames).length > 0) {
      current.instanceLevelNames = {
        ...(current.instanceLevelNames || {}),
        ...instanceLevelNames,
      };
    }
    // Track each instance's own name for this level
    if (sourceInstanceId && displayName) {
      current.instanceLevelNames = {
        ...(current.instanceLevelNames || {}),
        [sourceInstanceId]: displayName,
      };
    }
  });

  return Array.from(merged.values()).sort((left, right) => left.level - right.level);
}

function normalizeOrgUnitGroups(
  payload: unknown,
  sourceMode: OrgUnitSourceMode = 'repository',
  repositoryLevelNames: Map<number, string> = new Map(),
): OrgUnitGroup[] {
  const normalizedMode = normalizeOrgUnitSourceMode(sourceMode);
  const merged = new Map<string, OrgUnitGroup>();

  (Array.isArray(payload) ? payload : []).forEach(item => {
    const candidate = item as Record<string, unknown>;
    const id =
      typeof candidate.id === 'string'
        ? candidate.id
        : typeof candidate.displayName === 'string'
          ? candidate.displayName
          : null;
    if (!id) {
      return;
    }

    const displayName =
      typeof candidate.displayName === 'string'
        ? candidate.displayName
        : typeof candidate.name === 'string'
          ? candidate.name
          : id;
    const sourceInstanceId =
      typeof candidate.source_instance_id === 'number'
        ? candidate.source_instance_id
        : null;
    const sourceInstanceName =
      typeof candidate.source_instance_name === 'string'
        ? candidate.source_instance_name
        : null;
    const groupKey =
      normalizedMode === 'per_instance' && sourceInstanceId !== null
        ? `${sourceInstanceId}::${id}`
        : id;
    const membersPayload = Array.isArray(candidate.organisationUnits)
      ? candidate.organisationUnits.map(member =>
          typeof member === 'object' && member !== null
            ? {
                ...(member as Record<string, unknown>),
                source_instance_id:
                  (member as Record<string, unknown>).source_instance_id ??
                  sourceInstanceId,
                source_instance_name:
                  (member as Record<string, unknown>).source_instance_name ??
                  sourceInstanceName,
              }
            : member,
        )
      : candidate.organisationUnits;
    const members = normalizeOrgUnits(
      membersPayload,
      normalizedMode,
      repositoryLevelNames,
    );
    const current = merged.get(groupKey);
    if (!current) {
      merged.set(groupKey, {
        id: groupKey,
        displayName:
          normalizedMode === 'per_instance'
            ? getInstanceTaggedLabel(displayName, sourceInstanceName)
            : displayName,
        organisationUnits: members,
      });
      return;
    }

    if (!current.displayName && displayName) {
      current.displayName = displayName;
    }
    current.organisationUnits = normalizeOrgUnits([
      ...(current.organisationUnits || []),
      ...members,
    ]);
  });

  return Array.from(merged.values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function normalizeOrgUnitGroupSets(
  payload: unknown,
  sourceMode: OrgUnitSourceMode = 'repository',
): OrgUnitGroupSet[] {
  const normalizedMode = normalizeOrgUnitSourceMode(sourceMode);
  const merged = new Map<string, OrgUnitGroupSet>();

  (Array.isArray(payload) ? payload : []).forEach(item => {
    const candidate = item as Record<string, unknown>;
    const id =
      typeof candidate.id === 'string'
        ? candidate.id
        : typeof candidate.displayName === 'string'
          ? candidate.displayName
          : null;
    if (!id) {
      return;
    }

    const displayName =
      typeof candidate.displayName === 'string'
        ? candidate.displayName
        : typeof candidate.name === 'string'
          ? candidate.name
          : id;
    const sourceInstanceId =
      typeof candidate.source_instance_id === 'number'
        ? candidate.source_instance_id
        : null;
    const sourceInstanceName =
      typeof candidate.source_instance_name === 'string'
        ? candidate.source_instance_name
        : null;
    const groupSetKey =
      normalizedMode === 'per_instance' && sourceInstanceId !== null
        ? `${sourceInstanceId}::${id}`
        : id;
    const members = Array.isArray(candidate.organisationUnitGroups)
      ? candidate.organisationUnitGroups
          .map(member => {
            const memberCandidate = member as Record<string, unknown>;
            const memberId =
              typeof memberCandidate.id === 'string'
                ? memberCandidate.id
                : null;
            if (!memberId) {
              return null;
            }
            return {
              id: memberId,
              displayName:
                typeof memberCandidate.displayName === 'string'
                  ? memberCandidate.displayName
                  : typeof memberCandidate.name === 'string'
                    ? memberCandidate.name
                    : memberId,
            } satisfies OrgUnitGroupSetMember;
          })
          .filter(
            (member): member is OrgUnitGroupSetMember => member !== null,
          )
      : [];

    const current = merged.get(groupSetKey);
    if (!current) {
      merged.set(groupSetKey, {
        id: groupSetKey,
        displayName:
          normalizedMode === 'per_instance'
            ? getInstanceTaggedLabel(displayName, sourceInstanceName)
            : displayName,
        organisationUnitGroups: members,
        sourceInstanceIds: sourceInstanceId ? [sourceInstanceId] : [],
        sourceInstanceNames: sourceInstanceName ? [sourceInstanceName] : [],
      });
      return;
    }

    current.organisationUnitGroups = Array.from(
      new Map(
        [...(current.organisationUnitGroups || []), ...members].map(member => [
          member.id,
          member,
        ]),
      ).values(),
    ).sort((left, right) => left.displayName.localeCompare(right.displayName));
    if (
      sourceInstanceId &&
      !(current.sourceInstanceIds || []).includes(sourceInstanceId)
    ) {
      current.sourceInstanceIds = [
        ...(current.sourceInstanceIds || []),
        sourceInstanceId,
      ];
    }
    if (
      sourceInstanceName &&
      !(current.sourceInstanceNames || []).includes(sourceInstanceName)
    ) {
      current.sourceInstanceNames = [
        ...(current.sourceInstanceNames || []),
        sourceInstanceName,
      ];
    }
  });

  return Array.from(merged.values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function buildRepositoryLineageLookup(
  repositoryOrgUnits: OrgUnit[],
): Map<string, OrgUnit[]> {
  const lookup = new Map<string, OrgUnit[]>();

  repositoryOrgUnits.forEach(orgUnit => {
    (orgUnit.lineage || []).forEach(lineage => {
      if (
        typeof lineage.instance_id !== 'number' ||
        typeof lineage.source_org_unit_uid !== 'string' ||
        !lineage.source_org_unit_uid
      ) {
        return;
      }
      const key = `${lineage.instance_id}::${lineage.source_org_unit_uid}`;
      const current = lookup.get(key) || [];
      current.push(orgUnit);
      lookup.set(key, current);
    });
  });

  return lookup;
}

function buildRepositoryLevelDimensions(
  orgUnitLevels: OrgUnitLevel[],
  enabledDimensions: DatabaseRepositoryEnabledDimensions | null,
): OrgUnitLevel[] {
  const enabledLevels = enabledDimensions?.levels;
  if (!Array.isArray(enabledLevels)) {
    return orgUnitLevels;
  }
  if (enabledLevels.length === 0) {
    return [];
  }

  const levelLookup = new Map(orgUnitLevels.map(level => [level.level, level] as const));

  return enabledLevels
    .map(item => {
      const current = levelLookup.get(item.repository_level);
      const sourceInstanceIds = Array.from(
        new Set([
          ...(current?.sourceInstanceIds || []),
          ...((item.source_refs || [])
            .map(ref => ref.instance_id)
            .filter((value): value is number => typeof value === 'number')),
        ]),
      );
      const sourceInstanceNames = Array.from(
        new Set([
          ...(current?.sourceInstanceNames || []),
          ...((item.source_refs || [])
            .map(ref => ref.source_instance_name || '')
            .filter(Boolean)),
        ]),
      );
      const resolvedLabel = resolveRepositoryLevelLabel({
        mergedLevel: item.repository_level,
        savedLabel: item.label,
        orgUnitLevels,
      });
      return {
        level: item.repository_level,
        displayName: resolvedLabel,
        name: current?.name,
        aliases: Array.from(
          new Set(
            [resolvedLabel, current?.displayName, ...(current?.aliases || [])].filter(
              Boolean,
            ),
          ),
        ),
        sourceInstanceIds,
        sourceInstanceNames,
        instanceLevelNames: current?.instanceLevelNames,
      } satisfies OrgUnitLevel;
    })
    .sort((left, right) => left.level - right.level);
}

function buildRepositoryGroupsFromSourceMetadata(
  payload: unknown,
  repositoryOrgUnits: OrgUnit[],
  enabledDimensions: DatabaseRepositoryEnabledDimensions | null,
): OrgUnitGroup[] {
  const enabledGroups = enabledDimensions?.groups;
  const enabledGroupMap = new Map(
    (enabledGroups || []).map(item => [item.key, item] as const),
  );
  const filterToEnabledGroups = Array.isArray(enabledGroups);
  const lineageLookup = buildRepositoryLineageLookup(repositoryOrgUnits);
  const groups = new Map<string, OrgUnitGroup>();

  (Array.isArray(payload) ? payload : []).forEach(item => {
    const candidate = item as Record<string, unknown>;
    const groupId =
      typeof candidate.id === 'string'
        ? candidate.id
        : typeof candidate.displayName === 'string'
          ? candidate.displayName
          : null;
    if (!groupId) {
      return;
    }
    if (filterToEnabledGroups && !enabledGroupMap.has(groupId)) {
      return;
    }

    const configuredGroup = enabledGroupMap.get(groupId);
    const groupDisplayName =
      configuredGroup?.label ||
      (typeof candidate.displayName === 'string'
        ? candidate.displayName
        : typeof candidate.name === 'string'
          ? candidate.name
          : groupId);
    const sourceInstanceId =
      typeof candidate.source_instance_id === 'number'
        ? candidate.source_instance_id
        : null;

    const repositoryMembers = new Map<string, OrgUnit>();
    (Array.isArray(candidate.organisationUnits)
      ? (candidate.organisationUnits as Array<Record<string, unknown>>)
      : []
    ).forEach(member => {
      const sourceOrgUnitId =
        typeof member.id === 'string' ? member.id : null;
      const memberInstanceId =
        typeof member.source_instance_id === 'number'
          ? member.source_instance_id
          : sourceInstanceId;
      if (!sourceOrgUnitId || memberInstanceId == null) {
        return;
      }
      (lineageLookup.get(`${memberInstanceId}::${sourceOrgUnitId}`) || []).forEach(
        repositoryUnit => {
          repositoryMembers.set(repositoryUnit.selectionKey, repositoryUnit);
        },
      );
    });

    const current = groups.get(groupId);
    if (!current) {
      groups.set(groupId, {
        id: groupId,
        displayName: groupDisplayName,
        organisationUnits: Array.from(repositoryMembers.values()).sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        ),
      });
      return;
    }

    current.displayName = current.displayName || groupDisplayName;
    current.organisationUnits = Array.from(
      new Map(
        [...(current.organisationUnits || []), ...Array.from(repositoryMembers.values())].map(
          orgUnit => [orgUnit.selectionKey, orgUnit] as const,
        ),
      ).values(),
    ).sort((left, right) => left.displayName.localeCompare(right.displayName));
  });

  if (filterToEnabledGroups) {
    enabledGroupMap.forEach((group, groupId) => {
      if (groups.has(groupId)) {
        return;
      }
      groups.set(groupId, {
        id: groupId,
        displayName: group.label,
        organisationUnits: [],
      });
    });
  }

  return Array.from(groups.values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function buildRepositoryGroupSetsFromSourceMetadata(
  payload: unknown,
  enabledDimensions: DatabaseRepositoryEnabledDimensions | null,
): OrgUnitGroupSet[] {
  const enabledGroupSets = enabledDimensions?.group_sets;
  const enabledGroupSetMap = new Map(
    (enabledGroupSets || []).map(item => [item.key, item] as const),
  );
  const filterToEnabledGroupSets = Array.isArray(enabledGroupSets);
  const normalized = normalizeOrgUnitGroupSets(payload, 'repository');
  const groupSets = new Map(
    normalized.map(item => [item.id, item] as const),
  );

  if (!filterToEnabledGroupSets) {
    return normalized;
  }

  enabledGroupSetMap.forEach((groupSet, groupSetId) => {
    const current = groupSets.get(groupSetId);
    if (current) {
      current.displayName = groupSet.label || current.displayName;
      if ((!current.organisationUnitGroups || current.organisationUnitGroups.length === 0) &&
        Array.isArray(groupSet.member_group_keys)
      ) {
        current.organisationUnitGroups = (groupSet.member_group_keys || []).map(
          (memberId, index) => ({
            id: memberId,
            displayName: groupSet.member_group_labels?.[index] || memberId,
          }),
        );
      }
      return;
    }
    groupSets.set(groupSetId, {
      id: groupSetId,
      displayName: groupSet.label,
      organisationUnitGroups: (groupSet.member_group_keys || []).map(
        (memberId, index) => ({
          id: memberId,
          displayName: groupSet.member_group_labels?.[index] || memberId,
        }),
      ),
      sourceInstanceIds: (groupSet.source_refs || [])
        .map(ref => ref.instance_id)
        .filter((value): value is number => typeof value === 'number'),
      sourceInstanceNames: (groupSet.source_refs || [])
        .map(ref => ref.source_instance_name || '')
        .filter(Boolean),
    });
  });

  return Array.from(groupSets.values())
    .filter(groupSet => enabledGroupSetMap.has(groupSet.id))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function mergeInstanceResults(payloads: unknown[]): FederatedInstanceResult[] {
  const merged = new Map<number, FederatedInstanceResult>();

  payloads.forEach(payload => {
    const instanceResults = (payload as { instance_results?: unknown[] } | null)
      ?.instance_results;
    (Array.isArray(instanceResults) ? instanceResults : []).forEach(item => {
      const candidate = item as Record<string, unknown>;
      const id = typeof candidate.id === 'number' ? candidate.id : null;
      if (id === null) {
        return;
      }

      const nextResult: FederatedInstanceResult = {
        id,
        name:
          typeof candidate.name === 'string'
            ? candidate.name
            : t('Configured connection %s', id),
        status: candidate.status === 'failed' ? 'failed' : 'success',
        count: typeof candidate.count === 'number' ? candidate.count : undefined,
        error:
          typeof candidate.error === 'string' ? candidate.error : undefined,
      };

      const current = merged.get(id);
      if (!current) {
        merged.set(id, nextResult);
        return;
      }

      if (nextResult.status === 'failed') {
        current.status = 'failed';
        current.error = nextResult.error || current.error;
      }
      current.count = Math.max(current.count || 0, nextResult.count || 0);
      if (!current.name && nextResult.name) {
        current.name = nextResult.name;
      }
    });
  });

  return Array.from(merged.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function collectWarningMessages(payloads: unknown[], rejectedMessages: string[]): string[] {
  const messages = new Set<string>();

  payloads.forEach(payload => {
    const candidate = payload as { status?: string; message?: string } | null;
    if (
      (candidate?.status === 'partial' || candidate?.status === 'failed') &&
      candidate.message
    ) {
      messages.add(candidate.message);
    }
  });

  rejectedMessages.forEach(message => {
    if (message) {
      messages.add(message);
    }
  });

  return Array.from(messages);
}

function getScopeDepth(scope: DataLevelScope): number | null {
  switch (scope) {
    case 'children':
      return 1;
    case 'grandchildren':
      return 2;
    case 'all_levels':
      return null;
    case 'selected':
    default:
      return 0;
  }
}

function buildOrgUnitLookup(units: OrgUnit[]): Map<string, OrgUnit> {
  return new Map(units.map(unit => [unit.selectionKey, unit] as const));
}

function getOrgUnitRelativeDepth(
  ancestor: OrgUnit,
  descendant: OrgUnit,
): number | null {
  if (ancestor.selectionKey === descendant.selectionKey) {
    return 0;
  }

  if (
    typeof ancestor.level === 'number' &&
    typeof descendant.level === 'number'
  ) {
    return descendant.level - ancestor.level;
  }

  if (descendant.path && ancestor.sourceOrgUnitId) {
    const pathSegments = descendant.path
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean);
    const ancestorIndex = pathSegments.lastIndexOf(ancestor.sourceOrgUnitId);
    if (ancestorIndex >= 0) {
      return pathSegments.length - ancestorIndex - 1;
    }
  }

  return null;
}

function getAncestorSelectionKeys(
  selectionKey: string,
  lookup: Map<string, OrgUnit>,
): string[] {
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = lookup.get(selectionKey);

  while (current?.parentId && !visited.has(current.parentId)) {
    ancestors.push(current.parentId);
    visited.add(current.parentId);
    current = lookup.get(current.parentId);
  }

  return ancestors;
}

function pruneScopedOrgUnitSelections(
  selectedKeys: string[],
  lookup: Map<string, OrgUnit>,
  scope: DataLevelScope,
): ScopedSelectionPruneResult {
  const uniqueKeys = Array.from(new Set(selectedKeys)).filter(key =>
    lookup.has(key),
  );
  if (!['children', 'grandchildren', 'all_levels'].includes(scope)) {
    return { validKeys: uniqueKeys, pruned: [] };
  }
  if (uniqueKeys.length <= 1) {
    return { validKeys: uniqueKeys, pruned: [] };
  }

  const originalOrder = new Map(uniqueKeys.map((key, index) => [key, index]));
  const orderedKeys = [...uniqueKeys].sort((left, right) => {
    const leftUnit = lookup.get(left);
    const rightUnit = lookup.get(right);
    const leftLevel = leftUnit?.level ?? Number.MAX_SAFE_INTEGER;
    const rightLevel = rightUnit?.level ?? Number.MAX_SAFE_INTEGER;
    if (leftLevel !== rightLevel) {
      return leftLevel - rightLevel;
    }
    return (originalOrder.get(left) ?? 0) - (originalOrder.get(right) ?? 0);
  });

  const maxDepth = getScopeDepth(scope);
  const kept = new Set<string>();
  const pruned: ScopedSelectionPruneResult['pruned'] = [];

  orderedKeys.forEach(selectionKey => {
    const node = lookup.get(selectionKey);
    if (!node) {
      return;
    }

    const selectedAncestorKey = getAncestorSelectionKeys(selectionKey, lookup).find(
      ancestorKey => kept.has(ancestorKey),
    );

    if (!selectedAncestorKey) {
      kept.add(selectionKey);
      return;
    }

    const ancestorNode = lookup.get(selectedAncestorKey);
    const relativeDepth =
      ancestorNode && node
        ? getOrgUnitRelativeDepth(ancestorNode, node)
        : null;

    pruned.push({
      selectionKey,
      ancestorKey: selectedAncestorKey,
      reason:
        maxDepth !== null &&
        relativeDepth !== null &&
        relativeDepth > maxDepth
          ? 'beyond_scope'
          : 'covered_by_scope',
    });
  });

  return {
    validKeys: uniqueKeys.filter(key => kept.has(key)),
    pruned,
  };
}

function buildBlockedOrgUnitSelectionKeys(
  units: OrgUnit[],
  selectedKeys: string[],
  lookup: Map<string, OrgUnit>,
  scope: DataLevelScope,
): Set<string> {
  if (!['children', 'grandchildren', 'all_levels'].includes(scope)) {
    return new Set<string>();
  }
  const selectedSet = new Set(selectedKeys);
  const blocked = new Set<string>();

  units.forEach(unit => {
    if (selectedSet.has(unit.selectionKey)) {
      return;
    }

    const hasSelectedAncestor = getAncestorSelectionKeys(
      unit.selectionKey,
      lookup,
    ).some(ancestorKey => selectedSet.has(ancestorKey));

    if (hasSelectedAncestor) {
      blocked.add(unit.selectionKey);
    }
  });

  return blocked;
}

function simplifyLowestLevelLabel(label: string): string {
  return label.replace(
    /\s+\((?:Level|Repository level)\s+\d+\)\s*$/i,
    '',
  );
}

function deriveRepositorySelectionKeys(
  selectedDetails: DHIS2WizardState['selectedOrgUnitDetails'],
  repositoryOrgUnits: OrgUnit[],
): string[] {
  if (!Array.isArray(selectedDetails) || selectedDetails.length === 0) {
    return [];
  }

  const repositoryLookup = new Map(
    repositoryOrgUnits.map(unit => [unit.selectionKey, unit] as const),
  );
  const resolved = new Set<string>();

  selectedDetails.forEach(detail => {
    if (!detail || typeof detail !== 'object') {
      return;
    }

    const directKey =
      typeof detail.selectionKey === 'string' && detail.selectionKey.trim()
        ? detail.selectionKey.trim()
        : typeof detail.id === 'string' && detail.id.trim()
          ? detail.id.trim()
          : null;
    if (directKey && repositoryLookup.has(directKey)) {
      resolved.add(directKey);
      return;
    }

    const candidateSourceOrgUnitId =
      typeof detail.sourceOrgUnitId === 'string' && detail.sourceOrgUnitId.trim()
        ? detail.sourceOrgUnitId.trim()
        : typeof detail.id === 'string' && detail.id.trim()
          ? detail.id.trim()
          : null;
    const candidateInstanceIds = Array.isArray(detail.sourceInstanceIds)
      ? detail.sourceInstanceIds
      : [];

    repositoryOrgUnits.some(unit => {
      const matchesLineage = (unit.lineage || []).some(lineage => {
        const sameInstance =
          candidateInstanceIds.length === 0 ||
          candidateInstanceIds.includes(lineage.instance_id);
        return sameInstance && lineage.source_org_unit_uid === candidateSourceOrgUnitId;
      });
      if (!matchesLineage) {
        return false;
      }
      resolved.add(unit.selectionKey);
      return true;
    });
  });

  return Array.from(resolved);
}

export default function WizardStepOrgUnits({
  wizardState,
  updateState,
  errors,
  databaseId,
  instances: providedInstances = [],
  metadataMode = 'dhis2',
  hideSourceModeSelector = false,
  hideSourceModeConfiguration = false,
  forceSourceMode,
  hideAutoDetect = false,
  hideUserScopeOptions = false,
  hideGroupFilter = false,
  includeAncestorsScope = false,
  lockedDataScope = null,
  dataScopeLockedMessage = null,
  lowestDataLevelOptions,
  flatSections = false,
  labels,
  onMetadataLoaded,
}: StepOrgUnitsProps) {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState<
    'idle' | 'loading' | 'success' | 'partial' | 'pending' | 'failed'
  >('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessages, setWarningMessages] = useState<string[]>([]);
  const [instanceResults, setInstanceResults] = useState<FederatedInstanceResult[]>(
    [],
  );
  const [loadedInstances, setLoadedInstances] = useState<InstanceOption[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [orgUnitLevels, setOrgUnitLevels] = useState<OrgUnitLevel[]>([]);
  const [orgUnitGroups, setOrgUnitGroups] = useState<OrgUnitGroup[]>([]);
  const [orgUnitGroupSets, setOrgUnitGroupSets] = useState<OrgUnitGroupSet[]>([]);
  const [repositoryConfig, setRepositoryConfig] =
    useState<DatabaseRepositoryOrgUnitConfig | null>(null);
  const [repositoryEnabledDimensions, setRepositoryEnabledDimensions] =
    useState<DatabaseRepositoryEnabledDimensions | null>(null);
  const [repositoryApproach, setRepositoryApproach] =
    useState<RepositoryReportingUnitApproach | null>(null);
  const [repositoryDataScope, setRepositoryDataScope] =
    useState<DataLevelScope | null>(null);
  const [repositoryLowestDataLevelToUse, setRepositoryLowestDataLevelToUse] =
    useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedGroupSet, setSelectedGroupSet] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [userOrgUnit, setUserOrgUnit] = useState(false);
  const [userSubUnits, setUserSubUnits] = useState(false);
  const [userSubX2Units, setUserSubX2Units] = useState(false);
  const requestIdRef = useRef(0);
  const instancesRequestIdRef = useRef(0);
  const repositoryDefaultsAppliedRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      requestIdRef.current += 1;
      instancesRequestIdRef.current += 1;
    },
    [],
  );

  const activeInstances = useMemo(
    () =>
      providedInstances.length > 0
        ? providedInstances.filter(instance => instance.is_active)
        : loadedInstances.filter(instance => instance.is_active),
    [loadedInstances, providedInstances],
  );

  useEffect(() => {
    repositoryDefaultsAppliedRef.current = null;
  }, [databaseId, metadataMode]);

  const instanceNameMap = useMemo(
    () =>
      new Map(
        activeInstances.map(instance => [instance.id, instance.name] as const),
      ),
    [activeInstances],
  );

  useEffect(() => {
    if (providedInstances.length > 0) {
      setLoadedInstances([]);
      return;
    }
    if (!databaseId) {
      setLoadedInstances([]);
      return;
    }

    const requestId = instancesRequestIdRef.current + 1;
    instancesRequestIdRef.current = requestId;

    SupersetClient.get({
      endpoint: `/api/v1/dhis2/instances/?database_id=${databaseId}&include_inactive=true`,
    })
      .then(({ json }) => {
        if (!isMountedRef.current || requestId !== instancesRequestIdRef.current) {
          return;
        }
        const rawInstances = Array.isArray((json as { result?: unknown[] })?.result)
          ? ((json as { result?: unknown[] }).result as unknown[])
          : [];
        setLoadedInstances(
          rawInstances
            .map(item => {
              const instance = item as Record<string, unknown>;
              if (
                typeof instance.id !== 'number' ||
                typeof instance.name !== 'string'
              ) {
                return null;
              }
              return {
                id: instance.id,
                name: instance.name,
                is_active:
                  typeof instance.is_active === 'boolean'
                    ? instance.is_active
                    : true,
              };
            })
            .filter((instance): instance is InstanceOption => instance !== null),
        );
      })
      .catch(() => {
        if (isMountedRef.current && requestId === instancesRequestIdRef.current) {
          setLoadedInstances([]);
        }
      });
  }, [databaseId, providedInstances]);

  const selectedConnectionIds = useMemo(() => {
    if (activeInstances.length === 0) {
      return wizardState.selectedInstanceIds;
    }
    const activeIds = activeInstances.map(instance => instance.id);
    const activeIdSet = new Set(activeIds);
    const filteredSelectedIds = wizardState.selectedInstanceIds.filter(id =>
      activeIdSet.has(id),
    );

    if (filteredSelectedIds.length > 0) {
      return filteredSelectedIds;
    }

    return activeIds;
  }, [activeInstances, wizardState.selectedInstanceIds]);

  const selectedConnectionCount = selectedConnectionIds.length;
  const inferredOrgUnitSourceMode = normalizeOrgUnitSourceMode(
    selectedConnectionCount > 1
      ? wizardState.orgUnitSourceMode || 'repository'
      : 'primary',
  );
  const effectiveOrgUnitSourceMode =
    forceSourceMode && forceSourceMode !== 'federated'
      ? forceSourceMode
      : inferredOrgUnitSourceMode;
  const primaryInstanceId = useMemo(() => {
    if (selectedConnectionCount === 0) {
      if (
        wizardState.primaryOrgUnitInstanceId &&
        activeInstances.some(
          instance => instance.id === wizardState.primaryOrgUnitInstanceId,
        )
      ) {
        return wizardState.primaryOrgUnitInstanceId;
      }
      return activeInstances[0]?.id || null;
    }
    if (selectedConnectionCount === 1) {
      return selectedConnectionIds[0];
    }
    if (
      wizardState.primaryOrgUnitInstanceId &&
      selectedConnectionIds.includes(wizardState.primaryOrgUnitInstanceId)
    ) {
      return wizardState.primaryOrgUnitInstanceId;
    }
    return selectedConnectionIds[0] || null;
  }, [
    selectedConnectionCount,
    selectedConnectionIds,
    wizardState.primaryOrgUnitInstanceId,
  ]);
  const userScopeSelections = useMemo(
    () => wizardState.orgUnits.filter(id => USER_SCOPE_IDS.has(id)),
    [wizardState.orgUnits],
  );
  const effectiveDataLevelScope =
    lockedDataScope || wizardState.dataLevelScope || 'selected';
  const concreteSelectedOrgUnitKeys = useMemo(
    () => wizardState.orgUnits.filter(id => !USER_SCOPE_IDS.has(id)),
    [wizardState.orgUnits],
  );
  const orgUnitLookup = useMemo(() => buildOrgUnitLookup(orgUnits), [orgUnits]);

  useEffect(() => {
    if (wizardState.primaryOrgUnitInstanceId !== primaryInstanceId) {
      updateState({ primaryOrgUnitInstanceId: primaryInstanceId });
    }
  }, [primaryInstanceId, updateState, wizardState.primaryOrgUnitInstanceId]);

  useEffect(() => {
    if (!lockedDataScope) {
      return;
    }
    const includeChildren = !['selected', 'ancestors'].includes(lockedDataScope);
    if (
      wizardState.dataLevelScope !== lockedDataScope ||
      wizardState.includeChildren !== includeChildren
    ) {
      updateState({
        dataLevelScope: lockedDataScope,
        includeChildren,
      });
    }
  }, [
    lockedDataScope,
    updateState,
    wizardState.dataLevelScope,
    wizardState.includeChildren,
  ]);

  useEffect(() => {
    if (!onMetadataLoaded) {
      return;
    }
    onMetadataLoaded({
      orgUnits,
      orgUnitLevels,
      orgUnitGroups,
      orgUnitGroupSets,
      instances: activeInstances,
      repositoryConfig,
      repositoryEnabledDimensions,
      repositoryApproach,
      repositoryDataScope,
      repositoryLowestDataLevelToUse,
    });
  }, [
    activeInstances,
    onMetadataLoaded,
    orgUnitGroups,
    orgUnitGroupSets,
    orgUnitLevels,
    orgUnits,
    repositoryApproach,
    repositoryConfig,
    repositoryDataScope,
    repositoryEnabledDimensions,
    repositoryLowestDataLevelToUse,
  ]);

  const syncSelectedOrgUnits = useCallback((
    concreteOrgUnitIds: string[],
    nextUserScopeSelections = userScopeSelections,
  ) => {
    const selectedDetails = orgUnits
      .filter(unit => concreteOrgUnitIds.includes(unit.selectionKey))
      .map(unit => ({
        id: unit.id,
        selectionKey: unit.selectionKey,
        sourceOrgUnitId: unit.sourceOrgUnitId,
        displayName: unit.displayName,
        parentId: unit.parentId,
        level: unit.level,
        path: unit.path,
        sourceInstanceIds: unit.sourceInstanceIds,
        sourceInstanceNames: unit.sourceInstanceNames,
        repositoryLevel: unit.repositoryLevel,
        repositoryLevelName: unit.repositoryLevelName,
        repositoryKey: unit.repositoryKey,
        sourceLineageLabel: unit.sourceLineageLabel,
        strategy: unit.strategy,
        lineage: unit.lineage,
        provenance: unit.provenance,
      }));

    updateState({
      orgUnits: [...concreteOrgUnitIds, ...nextUserScopeSelections],
      selectedOrgUnitDetails: selectedDetails,
    });
  }, [orgUnits, updateState, userScopeSelections]);

  const refreshOrgUnitMetadata = async () => {
    if (metadataMode === 'repository') {
      if (!databaseId) {
        setOrgUnits([]);
        setOrgUnitLevels([]);
        setOrgUnitGroups([]);
        setOrgUnitGroupSets([]);
        setRepositoryConfig(null);
        setRepositoryEnabledDimensions(null);
        setRepositoryApproach(null);
        setRepositoryDataScope(null);
        setRepositoryLowestDataLevelToUse(null);
        setWarningMessages([]);
        setInstanceResults([]);
        setLoadError(null);
        setStatusMessage(null);
        setLoadStatus('idle');
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (!isMountedRef.current) {
        return;
      }
      setLoading(true);
      setLoadError(null);
      setStatusMessage(null);
      setLoadStatus('loading');

      try {
        const response = await SupersetClient.get({
          endpoint: `/api/v1/database/${databaseId}`,
        });
        if (!isMountedRef.current || requestId !== requestIdRef.current) {
          return;
        }

        const database = (response.json as { result?: DatabaseObject })?.result;
        const repositoryRecords = Array.isArray(database?.repository_org_units)
          ? database.repository_org_units
          : [];
        const repositoryConfig =
          database?.repository_org_unit_config &&
          typeof database.repository_org_unit_config === 'object'
            ? database.repository_org_unit_config
            : null;
        let sourceOrgUnitLevels: OrgUnitLevel[] = [];
        let sourceOrgUnitGroupsPayload: unknown[] = [];
        let sourceOrgUnitGroupSetsPayload: unknown[] = [];
        const repositoryInstanceIds = activeInstances.map(instance => instance.id);
        if (repositoryInstanceIds.length > 0) {
          try {
            const [
              sourceLevelsResponse,
              sourceGroupsResponse,
              sourceGroupSetsResponse,
            ] = await Promise.allSettled([
              SupersetClient.get({
                endpoint: buildMetadataEndpoint(
                  databaseId,
                  'organisationUnitLevels',
                  repositoryInstanceIds,
                  { orgUnitSourceMode: 'per_instance' },
                ),
              }),
              SupersetClient.get({
                endpoint: buildMetadataEndpoint(
                  databaseId,
                  'organisationUnitGroups',
                  repositoryInstanceIds,
                  { orgUnitSourceMode: 'per_instance' },
                ),
              }),
              SupersetClient.get({
                endpoint: buildMetadataEndpoint(
                  databaseId,
                  'organisationUnitGroupSets',
                  repositoryInstanceIds,
                  { orgUnitSourceMode: 'per_instance' },
                ),
              }),
            ]);
            if (!isMountedRef.current || requestId !== requestIdRef.current) {
              return;
            }
            if (sourceLevelsResponse.status === 'fulfilled') {
              sourceOrgUnitLevels = normalizeOrgUnitLevels(
                (sourceLevelsResponse.value.json as { result?: unknown[] })?.result,
              );
            }
            if (sourceGroupsResponse.status === 'fulfilled') {
              sourceOrgUnitGroupsPayload =
                (sourceGroupsResponse.value.json as { result?: unknown[] })?.result ||
                [];
            }
            if (sourceGroupSetsResponse.status === 'fulfilled') {
              sourceOrgUnitGroupSetsPayload =
                (sourceGroupSetsResponse.value.json as { result?: unknown[] })?.result ||
                [];
            }
          } catch {
            sourceOrgUnitLevels = [];
            sourceOrgUnitGroupsPayload = [];
            sourceOrgUnitGroupSetsPayload = [];
          }
        }
        const repositoryLevelMapping = normalizeRepositoryLevelMapping(
          repositoryConfig?.level_mapping,
        );
        const rawRepositoryLevels = normalizeRepositoryOrgUnitLevels(
          repositoryRecords,
          repositoryLevelMapping,
          sourceOrgUnitLevels,
        );
        const nextLevels = buildRepositoryLevelDimensions(
          rawRepositoryLevels,
          repositoryConfig?.enabled_dimensions || null,
        );
        const repositoryLevelNames = buildRepositoryLevelNameMap(nextLevels);
        const nextOrgUnits = normalizeRepositoryOrgUnits(
          repositoryRecords,
          repositoryLevelNames,
          instanceNameMap,
        );
        const nextGroups = buildRepositoryGroupsFromSourceMetadata(
          sourceOrgUnitGroupsPayload,
          nextOrgUnits,
          repositoryConfig?.enabled_dimensions || null,
        );
        const nextGroupSets = buildRepositoryGroupSetsFromSourceMetadata(
          sourceOrgUnitGroupSetsPayload,
          repositoryConfig?.enabled_dimensions || null,
        );

        setOrgUnitLevels(nextLevels);
        setOrgUnits(nextOrgUnits);
        setOrgUnitGroups(nextGroups);
        setOrgUnitGroupSets(nextGroupSets);
        setRepositoryConfig(repositoryConfig);
        setRepositoryEnabledDimensions(
          repositoryConfig?.enabled_dimensions || null,
        );
        setRepositoryApproach(
          database?.repository_reporting_unit_approach || null,
        );
        setRepositoryDataScope(
          (database?.repository_data_scope as DataLevelScope | null) || null,
        );
        setRepositoryLowestDataLevelToUse(
          typeof database?.lowest_data_level_to_use === 'number'
            ? database.lowest_data_level_to_use
            : null,
        );
        setWarningMessages([]);
        setInstanceResults(
          activeInstances.map(instance => ({
            id: instance.id,
            name: instance.name,
            status: 'success',
            count: nextOrgUnits.filter(unit =>
              unit.sourceInstanceIds.includes(instance.id),
            ).length,
          })),
        );
        setLoadStatus('success');
        setStatusMessage(
          nextOrgUnits.length === 0
            ? t(
                'No repository organisation units have been saved for this Database yet.',
              )
            : null,
        );
      } catch (error) {
        if (!isMountedRef.current || requestId !== requestIdRef.current) {
          return;
        }
        setOrgUnits([]);
        setOrgUnitLevels([]);
        setOrgUnitGroups([]);
        setOrgUnitGroupSets([]);
        setRepositoryConfig(null);
        setRepositoryEnabledDimensions(null);
        setRepositoryApproach(null);
        setRepositoryDataScope(null);
        setRepositoryLowestDataLevelToUse(null);
        setWarningMessages([]);
        setInstanceResults([]);
        setStatusMessage(null);
        setLoadStatus('failed');
        setLoadError(
          getErrorMessage(
            error,
            t(
              'Failed to load repository organisation units from the selected Database.',
            ),
          ),
        );
      } finally {
        if (isMountedRef.current && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
      return;
    }

    const metadataInstanceIds =
      effectiveOrgUnitSourceMode === 'primary' && primaryInstanceId
        ? [primaryInstanceId]
        : selectedConnectionIds;
    const useFederatedMode =
      effectiveOrgUnitSourceMode !== 'primary' && metadataInstanceIds.length > 1;

    if (!databaseId || metadataInstanceIds.length === 0) {
      setOrgUnits([]);
      setOrgUnitLevels([]);
      setOrgUnitGroups([]);
      setOrgUnitGroupSets([]);
      setRepositoryConfig(null);
      setRepositoryEnabledDimensions(null);
      setRepositoryApproach(null);
      setRepositoryDataScope(null);
      setRepositoryLowestDataLevelToUse(null);
      setWarningMessages([]);
      setInstanceResults([]);
      setLoadError(null);
      setStatusMessage(null);
      setLoadStatus('idle');
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!isMountedRef.current) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    setStatusMessage(null);
    setLoadStatus('loading');

    const orgUnitsEndpoint = buildMetadataEndpoint(
      databaseId,
      'organisationUnits',
      metadataInstanceIds,
      {
        federated: useFederatedMode,
        orgUnitSourceMode: effectiveOrgUnitSourceMode,
        primaryInstanceId,
      },
    );
    const orgUnitLevelsEndpoint = buildMetadataEndpoint(
      databaseId,
      'organisationUnitLevels',
      metadataInstanceIds,
      {
        federated: useFederatedMode,
        orgUnitSourceMode: effectiveOrgUnitSourceMode,
        primaryInstanceId,
      },
    );
    const orgUnitGroupsEndpoint = buildMetadataEndpoint(
      databaseId,
      'organisationUnitGroups',
      metadataInstanceIds,
      {
        federated: useFederatedMode,
        orgUnitSourceMode: effectiveOrgUnitSourceMode,
        primaryInstanceId,
      },
    );
    const orgUnitGroupSetsEndpoint = buildMetadataEndpoint(
      databaseId,
      'organisationUnitGroupSets',
      metadataInstanceIds,
      {
        federated: useFederatedMode,
        orgUnitSourceMode: effectiveOrgUnitSourceMode,
        primaryInstanceId,
      },
    );

    try {
      const [orgUnitsResult, levelsResult, groupsResult, groupSetsResult] =
        await Promise.allSettled([
        SupersetClient.get({ endpoint: orgUnitsEndpoint }),
        SupersetClient.get({ endpoint: orgUnitLevelsEndpoint }),
        SupersetClient.get({ endpoint: orgUnitGroupsEndpoint }),
        SupersetClient.get({ endpoint: orgUnitGroupSetsEndpoint }),
      ]);

      if (!isMountedRef.current || requestId !== requestIdRef.current) {
        return;
      }

      const payloads: unknown[] = [];
      const rejectedMessages: string[] = [];
      let nextLoadError: string | null = null;
      let nextLevels: OrgUnitLevel[] = [];
      let repositoryLevelNames = new Map<number, string>();

      if (levelsResult.status === 'fulfilled') {
        const payload = levelsResult.value.json as { result?: unknown[] };
        payloads.push(payload);
        nextLevels = normalizeOrgUnitLevels(payload.result);
        repositoryLevelNames = buildRepositoryLevelNameMap(nextLevels);
        setOrgUnitLevels(nextLevels);
      } else {
        setOrgUnitLevels([]);
        rejectedMessages.push(
          t('Organisation unit levels are unavailable right now.'),
        );
      }

      if (orgUnitsResult.status === 'fulfilled') {
        const payload = orgUnitsResult.value.json as {
          result?: unknown[];
          status?: string;
          message?: string;
        };
        payloads.push(payload);
        setOrgUnits(
          normalizeOrgUnits(
            payload.result,
            effectiveOrgUnitSourceMode,
            repositoryLevelNames,
          ),
        );
        setStatusMessage(payload.message || null);
        setLoadStatus(
          payload.status === 'failed'
            ? 'failed'
            : payload.status === 'partial'
              ? 'partial'
              : payload.status === 'pending'
                ? 'pending'
                : 'success',
        );
        if (payload.status === 'failed') {
          nextLoadError =
            payload.message || t('Failed to load organisation units from the selected connections.');
        }
      } else {
        setOrgUnits([]);
        setStatusMessage(null);
        setLoadStatus('failed');
        nextLoadError = getErrorMessage(
          orgUnitsResult.reason,
          t('Failed to load organisation units from the selected connections.'),
        );
      }

      if (groupsResult.status === 'fulfilled') {
        const payload = groupsResult.value.json as { result?: unknown[] };
        payloads.push(payload);
        setOrgUnitGroups(
          normalizeOrgUnitGroups(
            payload.result,
            effectiveOrgUnitSourceMode,
            repositoryLevelNames,
          ),
        );
      } else {
        setOrgUnitGroups([]);
        rejectedMessages.push(
          t('Organisation unit groups are unavailable right now.'),
        );
      }

      if (groupSetsResult.status === 'fulfilled') {
        const payload = groupSetsResult.value.json as { result?: unknown[] };
        payloads.push(payload);
        setOrgUnitGroupSets(
          normalizeOrgUnitGroupSets(payload.result, effectiveOrgUnitSourceMode),
        );
      } else {
        setOrgUnitGroupSets([]);
        rejectedMessages.push(
          t('Organisation unit group sets are unavailable right now.'),
        );
      }

      setRepositoryConfig(null);
      setRepositoryEnabledDimensions(null);
      setRepositoryApproach(null);
      setRepositoryDataScope(null);
      setRepositoryLowestDataLevelToUse(null);

      const normalizedResults = mergeInstanceResults(payloads);
      setInstanceResults(normalizedResults);
      setWarningMessages(collectWarningMessages(payloads, rejectedMessages));
      setLoadError(nextLoadError);
    } finally {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void refreshOrgUnitMetadata();
  }, [
    databaseId,
    metadataMode,
    effectiveOrgUnitSourceMode,
    primaryInstanceId,
    selectedConnectionIds.join(','),
  ]);

  const failedConnections = useMemo(
    () => instanceResults.filter(result => result.status === 'failed'),
    [instanceResults],
  );
  const pendingConnections = useMemo(
    () => instanceResults.filter(result => result.status === 'pending'),
    [instanceResults],
  );

  useEffect(() => {
    if (
      metadataMode === 'repository' ||
      !databaseId ||
      selectedConnectionIds.length === 0 ||
      !(
        loadStatus === 'pending' ||
        (loadStatus === 'partial' && pendingConnections.length > 0)
      )
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshOrgUnitMetadata();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [
    databaseId,
    loadStatus,
    pendingConnections.length,
    refreshOrgUnitMetadata,
    selectedConnectionIds.length,
    metadataMode,
  ]);

  useEffect(() => {
    if (orgUnits.length > 0) {
      setExpandedKeys(current =>
        current.length > 0 ? current : [orgUnits[0].selectionKey],
      );
    } else {
      setExpandedKeys([]);
    }
  }, [orgUnits]);

  useEffect(() => {
    setUserOrgUnit(wizardState.orgUnits.includes('USER_ORGUNIT'));
    setUserSubUnits(wizardState.orgUnits.includes('USER_ORGUNIT_CHILDREN'));
    setUserSubX2Units(
      wizardState.orgUnits.includes('USER_ORGUNIT_GRANDCHILDREN'),
    );
  }, [wizardState.orgUnits]);

  const scopedSelectionState = useMemo(
    () =>
      pruneScopedOrgUnitSelections(
        concreteSelectedOrgUnitKeys,
        orgUnitLookup,
        effectiveDataLevelScope,
      ),
    [concreteSelectedOrgUnitKeys, effectiveDataLevelScope, orgUnitLookup],
  );

  const blockedSelectionKeys = useMemo(
    () =>
      buildBlockedOrgUnitSelectionKeys(
        orgUnits,
        scopedSelectionState.validKeys,
        orgUnitLookup,
        effectiveDataLevelScope,
      ),
    [
      effectiveDataLevelScope,
      orgUnits,
      orgUnitLookup,
      scopedSelectionState.validKeys,
    ],
  );

  useEffect(() => {
    if (
      metadataMode !== 'repository' ||
      orgUnits.length === 0 ||
      concreteSelectedOrgUnitKeys.length === 0
    ) {
      return;
    }

    const currentValidKeys = concreteSelectedOrgUnitKeys.filter(key =>
      orgUnitLookup.has(key),
    );
    if (currentValidKeys.length === concreteSelectedOrgUnitKeys.length) {
      return;
    }

    const resolvedRepositoryKeys = deriveRepositorySelectionKeys(
      wizardState.selectedOrgUnitDetails,
      orgUnits,
    );
    if (resolvedRepositoryKeys.length === 0) {
      return;
    }

    const nextKeys = Array.from(
      new Set([...currentValidKeys, ...resolvedRepositoryKeys]),
    );
    if (
      nextKeys.length === concreteSelectedOrgUnitKeys.length &&
      nextKeys.every(key => concreteSelectedOrgUnitKeys.includes(key))
    ) {
      return;
    }

    syncSelectedOrgUnits(nextKeys);
  }, [
    concreteSelectedOrgUnitKeys,
    metadataMode,
    orgUnitLookup,
    orgUnits,
    syncSelectedOrgUnits,
    wizardState.selectedOrgUnitDetails,
  ]);

  useEffect(() => {
    if (
      metadataMode !== 'repository' ||
      !databaseId ||
      loadStatus !== 'success'
    ) {
      return;
    }

    const defaultsKey = `${databaseId}`;
    if (repositoryDefaultsAppliedRef.current === defaultsKey) {
      return;
    }

    const nextUpdates: Partial<DHIS2WizardState> = {};
    if (!wizardState.orgUnitsAutoDetect && wizardState.orgUnits.length === 0) {
      const configuredSelectionKeys = Array.isArray(
        repositoryConfig?.selected_org_units,
      )
        ? repositoryConfig.selected_org_units.filter(
            (value): value is string =>
              typeof value === 'string' && orgUnitLookup.has(value),
          )
        : [];
      const derivedSelectionKeys = deriveRepositorySelectionKeys(
        (repositoryConfig?.selected_org_unit_details as
          | DHIS2WizardState['selectedOrgUnitDetails']
          | undefined) || [],
        orgUnits,
      );
      const nextSelectionKeys = Array.from(
        new Set([...configuredSelectionKeys, ...derivedSelectionKeys]),
      );

      if (nextSelectionKeys.length > 0) {
        nextUpdates.orgUnits = nextSelectionKeys;
        nextUpdates.selectedOrgUnitDetails = orgUnits
          .filter(unit => nextSelectionKeys.includes(unit.selectionKey))
          .map(unit => ({
            id: unit.id,
            selectionKey: unit.selectionKey,
            sourceOrgUnitId: unit.sourceOrgUnitId,
            displayName: unit.displayName,
            parentId: unit.parentId,
            level: unit.level,
            path: unit.path,
            sourceInstanceIds: unit.sourceInstanceIds,
            sourceInstanceNames: unit.sourceInstanceNames,
            repositoryLevel: unit.repositoryLevel,
            repositoryLevelName: unit.repositoryLevelName,
            repositoryKey: unit.repositoryKey,
            sourceLineageLabel: unit.sourceLineageLabel,
            strategy: unit.strategy,
            lineage: unit.lineage,
            provenance: unit.provenance,
          }));
      }
    }

    if (
      !lockedDataScope &&
      repositoryDataScope &&
      wizardState.dataLevelScope === 'selected' &&
      wizardState.includeChildren === false
    ) {
      nextUpdates.dataLevelScope = repositoryDataScope;
      nextUpdates.includeChildren = !['selected', 'ancestors'].includes(
        repositoryDataScope,
      );
    }

    if (
      wizardState.maxOrgUnitLevel == null &&
      repositoryLowestDataLevelToUse != null
    ) {
      nextUpdates.maxOrgUnitLevel = repositoryLowestDataLevelToUse;
    }

    repositoryDefaultsAppliedRef.current = defaultsKey;
    if (Object.keys(nextUpdates).length > 0) {
      updateState(nextUpdates);
    }
  }, [
    databaseId,
    loadStatus,
    lockedDataScope,
    metadataMode,
    orgUnitLookup,
    orgUnits,
    repositoryConfig,
    repositoryDataScope,
    repositoryLowestDataLevelToUse,
    updateState,
    wizardState.dataLevelScope,
    wizardState.includeChildren,
    wizardState.maxOrgUnitLevel,
    wizardState.orgUnits,
    wizardState.orgUnitsAutoDetect,
  ]);

  useEffect(() => {
    if (orgUnits.length === 0) {
      return;
    }

    if (
      scopedSelectionState.pruned.length === 0 &&
      scopedSelectionState.validKeys.length === concreteSelectedOrgUnitKeys.length
    ) {
      return;
    }

    syncSelectedOrgUnits(scopedSelectionState.validKeys);
  }, [
    concreteSelectedOrgUnitKeys.length,
    orgUnits.length,
    scopedSelectionState.pruned.length,
    scopedSelectionState.validKeys,
    syncSelectedOrgUnits,
  ]);

  const scopeSelectionMessage = useMemo(() => {
    if (scopedSelectionState.pruned.length === 0) {
      if (blockedSelectionKeys.size > 0 && scopedSelectionState.validKeys.length > 0) {
        return t(
          'Descendants of a selected organisation unit are disabled. The chosen data scope already determines how far down the hierarchy staged data will be loaded.',
        );
      }
      return null;
    }

    const beyondScopeCount = scopedSelectionState.pruned.filter(
      item => item.reason === 'beyond_scope',
    ).length;
    const coveredCount = scopedSelectionState.pruned.length - beyondScopeCount;

    if (beyondScopeCount > 0 && coveredCount > 0) {
      return t(
        '%s descendant selection(s) were removed because a higher-level selection already controls the dataset scope, and %s were beyond the chosen stopping level.',
        coveredCount,
        beyondScopeCount,
      );
    }

    if (beyondScopeCount > 0) {
      return t(
        '%s descendant selection(s) were removed because they are deeper than the chosen data scope. Select a higher-level organisation unit or use a broader scope instead.',
        beyondScopeCount,
      );
    }

    return t(
      '%s descendant selection(s) were removed because a higher-level organisation unit already covers them for the chosen data scope.',
      coveredCount,
    );
  }, [
    blockedSelectionKeys.size,
    scopedSelectionState.pruned,
    scopedSelectionState.validKeys.length,
  ]);

  const buildTreeData = (units: OrgUnit[]) => {
    const map = new Map<
      string,
      {
        title: string;
        key: string;
        data: OrgUnit;
        disableCheckbox?: boolean;
        children: any[];
      }
    >();
    const roots: Array<{
      title: string;
      key: string;
      data: OrgUnit;
      disableCheckbox?: boolean;
      children: any[];
    }> = [];

    units.forEach(unit => {
      map.set(unit.selectionKey, {
        title: unit.displayName,
        key: unit.selectionKey,
        data: unit,
        disableCheckbox:
          blockedSelectionKeys.has(unit.selectionKey) &&
          !concreteSelectedOrgUnitKeys.includes(unit.selectionKey),
        children: [],
      });
    });

    units.forEach(unit => {
      const node = map.get(unit.selectionKey);
      if (!node) {
        return;
      }
      if (unit.parentId) {
        const parent = map.get(unit.parentId);
        if (parent) {
          parent.children.push(node);
          return;
        }
      }
      roots.push(node);
    });

    return roots;
  };

  const filteredUnits = useMemo(() => {
    let filtered = orgUnits;

    const selectedGroupSetDefinition = selectedGroupSet
      ? orgUnitGroupSets.find(item => item.id === selectedGroupSet)
      : null;
    const selectedGroupSetMemberIds = new Set(
      (selectedGroupSetDefinition?.organisationUnitGroups || []).map(
        member => member.id,
      ),
    );

    if (!hideGroupFilter && selectedGroupSetMemberIds.size > 0 && !selectedGroup) {
      const memberSelectionKeys = new Set(
        orgUnitGroups
          .filter(group => selectedGroupSetMemberIds.has(group.id))
          .flatMap(group =>
            (group.organisationUnits || []).map(unit => unit.selectionKey),
          ),
      );
      if (memberSelectionKeys.size > 0) {
        filtered = filtered.filter(unit =>
          memberSelectionKeys.has(unit.selectionKey),
        );
      }
    }

    if (!hideGroupFilter && selectedGroup) {
      const group = orgUnitGroups.find(item => item.id === selectedGroup);
      const memberIds = new Set(
        (group?.organisationUnits || []).map(unit => unit.selectionKey),
      );
      if (memberIds.size > 0) {
        filtered = filtered.filter(unit => memberIds.has(unit.selectionKey));
      }
    }

    if (searchText) {
      filtered = filtered.filter(unit =>
        unit.displayName.toLowerCase().includes(searchText.toLowerCase()),
      );
    }

    if (selectedLevel) {
      filtered = filtered.filter(
        unit => unit.level?.toString() === selectedLevel,
      );
    }

    return filtered;
  }, [
    hideGroupFilter,
    orgUnitGroups,
    orgUnitGroupSets,
    orgUnits,
    searchText,
    selectedGroupSet,
    selectedGroup,
    selectedLevel,
  ]);

  const treeData = useMemo(
    () => buildTreeData(filteredUnits),
    [blockedSelectionKeys, concreteSelectedOrgUnitKeys, filteredUnits],
  );

  const levelOptions = useMemo(
    () =>
      sortOrgUnitLevelsAscending(orgUnitLevels).map(level => ({
        value: level.level.toString(),
        label: resolveRepositoryLevelLabel({
          mergedLevel: level.level,
          savedLabel: level.displayName,
          orgUnitLevels,
        }),
      })),
    [orgUnitLevels],
  );

  const groupSetOptions = useMemo(
    () =>
      orgUnitGroupSets.map(groupSet => ({
        value: groupSet.id,
        label: groupSet.displayName,
      })),
    [orgUnitGroupSets],
  );

  const visibleGroupOptions = useMemo(() => {
    if (!selectedGroupSet) {
      return orgUnitGroups;
    }
    const groupSet = orgUnitGroupSets.find(item => item.id === selectedGroupSet);
    if (!groupSet || !Array.isArray(groupSet.organisationUnitGroups)) {
      return orgUnitGroups;
    }
    const memberGroupIds = new Set(
      groupSet.organisationUnitGroups.map(member => member.id),
    );
    return orgUnitGroups.filter(group => memberGroupIds.has(group.id));
  }, [orgUnitGroupSets, orgUnitGroups, selectedGroupSet]);

  const effectiveLowestDataLevelOptions = useMemo(
    () =>
      sortLevelSelectOptionsAscending(
        lowestDataLevelOptions
          ? lowestDataLevelOptions.map(option => {
              const level = Number.parseInt(String(option.value), 10);
              const resolvedLabel = Number.isFinite(level)
                ? resolveRepositoryLevelLabel({
                    mergedLevel: level,
                    savedLabel: String(option.label || ''),
                    orgUnitLevels,
                  })
                : String(option.label || '');
              return {
                ...option,
                label: Number.isFinite(level)
                  ? `${resolvedLabel} (Level ${level})`
                  : resolvedLabel,
              };
            })
          : sortOrgUnitLevelsAscending(orgUnitLevels).map(level => ({
              value: level.level.toString(),
              label: `${resolveRepositoryLevelLabel({
                mergedLevel: level.level,
                savedLabel: level.displayName,
                orgUnitLevels,
              })} (Level ${level.level})`,
            })),
      ),
    [lowestDataLevelOptions, orgUnitLevels],
  );
  const selectedLowestDataLevelLabel = useMemo(() => {
    if (wizardState.maxOrgUnitLevel == null) {
      return null;
    }
    const selectedOption = effectiveLowestDataLevelOptions.find(
      option => option.value === String(wizardState.maxOrgUnitLevel),
    );
    return selectedOption
      ? simplifyLowestLevelLabel(String(selectedOption.label))
      : null;
  }, [effectiveLowestDataLevelOptions, wizardState.maxOrgUnitLevel]);
  const allLevelsScopeLabel = selectedLowestDataLevelLabel
    ? t('All levels (down to %s)', selectedLowestDataLevelLabel)
    : t('All levels (down to the lowest level available)');
  const allLevelsScopeDescription = selectedLowestDataLevelLabel
    ? t(
        'Includes all descendants down to %s. Org units below that selected lowest data level are excluded.',
        selectedLowestDataLevelLabel,
      )
    : t(
        'Includes all descendants down to the lowest level available in the hierarchy.',
      );

  const groupOptions = useMemo(
    () =>
      visibleGroupOptions.map(group => ({
        value: group.id,
        label: group.displayName,
      })),
    [visibleGroupOptions],
  );

  useEffect(() => {
    if (!selectedGroup) {
      return;
    }
    if (!visibleGroupOptions.some(group => group.id === selectedGroup)) {
      setSelectedGroup(null);
    }
  }, [selectedGroup, visibleGroupOptions]);

  const showSourceModeConfiguration =
    !hideSourceModeConfiguration &&
    selectedConnectionCount > 1 && (!hideSourceModeSelector || !!forceSourceMode);
  const showSourceModeSelector =
    showSourceModeConfiguration && !hideSourceModeSelector;

  return (
    <StepContainer>
      <div>
        <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
          {labels?.title || t('Organisation Units')}
        </Title>
        <Paragraph style={{ margin: 0 }}>
          {labels?.description ||
            t(
              'Choose which organisation units to sync. Leaving the selection empty uses the current user\'s assigned org units. Organisation units and periods are optional — users can filter by any org unit or period directly in charts.',
            )}
        </Paragraph>
        {selectedConnectionCount > 0 ? (
          <Text type="secondary">
            {effectiveOrgUnitSourceMode === 'primary' && primaryInstanceId
              ? t(
                  'Currently loading organisation units from the primary configured connection.',
                )
              : effectiveOrgUnitSourceMode === 'per_instance'
                ? t(
                    'Currently loading separate organisation hierarchies for %s configured connection(s).',
                    selectedConnectionCount,
                  )
              : t(
                  'Currently loading from %s configured connection(s).',
                  selectedConnectionCount,
                )}
          </Text>
        ) : null}
      </div>

      {/* Auto-detect / no restriction option */}
      {!hideAutoDetect && (
        <div>
        <Checkbox
          checked={!!wizardState.orgUnitsAutoDetect}
          onChange={e => {
            const checked = e.target.checked;
            updateState({
              orgUnitsAutoDetect: checked,
              ...(checked
                ? { orgUnits: [], selectedOrgUnitDetails: [] }
                : {}),
            });
          }}
        >
          <span style={{ fontWeight: 600 }}>
            {t('Auto-detect and stage all applicable org units')}
          </span>
          <span
            style={{ marginLeft: 8, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}
          >
            {t('(skip manual selection — use current user\'s assigned org units)')}
          </span>
        </Checkbox>

        {wizardState.orgUnitsAutoDetect && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              background: '#fffbe6',
              border: '1px solid #ffe58f',
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <strong>
              {t('⚠ Data Loading may take some time to complete for unrestricted datasets.')}
            </strong>
            <br />
            {t(
              'Without an org unit restriction the sync will fetch data for all organisation units assigned to your DHIS2 user account. For large org unit hierarchies this can significantly increase sync time and dataset size.',
            )}
          </div>
        )}
        </div>
      )}

      <div
        style={
          wizardState.orgUnitsAutoDetect
            ? { opacity: 0.45, pointerEvents: 'none' }
            : undefined
        }
      >
      {activeInstances.length > 0 && selectedConnectionCount === 0 ? (
        <Alert
          type="warning"
          showIcon
          message={t('No configured connections are currently selected')}
          description={t(
            'Return to the Database step and select at least one configured DHIS2 connection before choosing organisation units.',
          )}
        />
      ) : null}

      {loadError ? (
        <Alert
          type="error"
          showIcon
          message={t('Unable to load organisation units')}
          description={loadError}
          action={
            <Button onClick={() => void refreshOrgUnitMetadata()} size="small">
              {t('Retry')}
            </Button>
          }
        />
      ) : null}

      {loadStatus === 'pending' && !loadError ? (
        <Alert
          type="info"
          showIcon
          message={t('Local metadata staging is still running')}
          description={
            statusMessage ||
            t(
              'DHIS2 metadata is being prepared in local staging. Retry shortly or inspect the DHIS2 admin pages for connection diagnostics.',
            )
          }
          action={
            <Button onClick={() => void refreshOrgUnitMetadata()} size="small">
              {t('Retry')}
            </Button>
          }
        />
      ) : null}

      {(warningMessages.length > 0 ||
        failedConnections.length > 0 ||
        pendingConnections.length > 0) &&
      !loadError &&
      loadStatus !== 'pending' ? (
        <Alert
          type={failedConnections.length > 0 ? 'warning' : 'info'}
          showIcon
          message={
            failedConnections.length > 0
              ? t('Some configured connections could not be fully loaded')
              : t('Some configured connections are still being staged locally')
          }
          description={
            <div>
              {statusMessage ? <div>{statusMessage}</div> : null}
              {warningMessages.map(message => (
                <div key={message}>{message}</div>
              ))}
              {failedConnections.map(connection => (
                <div key={connection.id}>
                  {connection.error
                    ? `${connection.name}: ${connection.error}`
                    : connection.name}
                </div>
              ))}
              {pendingConnections.map(connection => (
                <div key={connection.id}>{connection.name}</div>
              ))}
            </div>
          }
          action={
            <Button onClick={() => void refreshOrgUnitMetadata()} size="small">
              {t('Retry')}
            </Button>
          }
        />
      ) : null}

      {showSourceModeConfiguration ? (
        <OptionsContainer $flat={flatSections}>
          <SectionTitle>
            {labels?.sourcePolicyTitle || t('Organisation-unit source policy')}
          </SectionTitle>
          <Paragraph style={{ margin: '0 0 12px 0' }}>
            {labels?.sourcePolicyDescription ||
              t(
                'Use a single primary configured connection when one hierarchy is authoritative, merge selected connections into a repository org-unit structure, or keep each connection hierarchy separate in local staging.',
              )}
          </Paragraph>
          {showSourceModeSelector ? (
            <Radio.Group
              value={effectiveOrgUnitSourceMode}
              onChange={event => {
                const nextMode = event.target.value as
                  | 'primary'
                  | 'repository'
                  | 'per_instance';
                updateState({
                  orgUnitSourceMode: nextMode,
                  primaryOrgUnitInstanceId:
                    nextMode === 'primary' ? primaryInstanceId : null,
                  orgUnits: userScopeSelections,
                  selectedOrgUnitDetails: [],
                });
                setSelectedGroup(null);
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Radio value="primary">
                  <Text strong>{t('Use a primary configured connection')}</Text>
                </Radio>
                <Radio value="repository">
                  <Text strong>{t('Build a repository org-unit structure')}</Text>
                </Radio>
                <Radio value="per_instance">
                  <Text strong>{t('Keep each configured connection separate')}</Text>
                </Radio>
              </div>
            </Radio.Group>
          ) : null}
          {effectiveOrgUnitSourceMode === 'primary' ? (
            <div style={{ marginTop: 16 }}>
              <SectionTitle>{t('Primary configured connection')}</SectionTitle>
              <Select
                virtual={false}
                value={primaryInstanceId ?? undefined}
                onChange={value =>
                  updateState({
                    primaryOrgUnitInstanceId: value as number,
                    orgUnits: userScopeSelections,
                    selectedOrgUnitDetails: [],
                  })
                }
                options={activeInstances
                  .filter(instance => selectedConnectionIds.includes(instance.id))
                  .map(instance => ({
                    value: instance.id,
                    label: instance.name,
                  }))}
                dropdownStyle={SELECT_DROPDOWN_STYLE}
                styles={{ root: { width: '100%' } }}
              />
            </div>
          ) : effectiveOrgUnitSourceMode === 'repository' ? (
            <div style={{ marginTop: 16 }}>
              <StepLevelMapping
                wizardState={wizardState}
                updateState={updateState}
                orgUnitLevels={orgUnitLevels}
                instances={activeInstances
                  .filter(inst => selectedConnectionIds.includes(inst.id))
                  .map(inst => ({ id: inst.id, name: inst.name }))}
              />
            </div>
          ) : (
            <Alert
              style={{ marginTop: 16 }}
              type="info"
              showIcon
              message={t('Per-connection org-unit browsing is enabled')}
              description={t(
                'Each configured connection keeps its own organisation-unit hierarchy in local staging. Units with the same DHIS2 id remain selectable separately and keep their connection-specific lineage.',
              )}
            />
          )}
        </OptionsContainer>
      ) : null}

      {!hideUserScopeOptions && (
        <OptionsContainer $flat={flatSections}>
          <SectionTitle>
            {labels?.userOptionsTitle || t('User organisation unit options')}
          </SectionTitle>
        <CheckboxGroup>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Checkbox
              checked={userOrgUnit}
              onChange={event => {
                setUserOrgUnit(event.target.checked);
                if (event.target.checked) {
                  const nextUserSelections = [...userScopeSelections];
                  if (!nextUserSelections.includes('USER_ORGUNIT')) {
                    nextUserSelections.push('USER_ORGUNIT');
                  }
                  syncSelectedOrgUnits(
                    wizardState.orgUnits.filter(id => !USER_SCOPE_IDS.has(id)),
                    nextUserSelections,
                  );
                } else {
                  syncSelectedOrgUnits(
                    wizardState.orgUnits.filter(id => !USER_SCOPE_IDS.has(id)),
                    userScopeSelections.filter(id => id !== 'USER_ORGUNIT'),
                  );
                }
              }}
            />
            <Text>{t('User organisation unit')}</Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Checkbox
              checked={userSubUnits}
              onChange={event => {
                setUserSubUnits(event.target.checked);
                if (event.target.checked) {
                  const nextUserSelections = [...userScopeSelections];
                  if (!nextUserSelections.includes('USER_ORGUNIT_CHILDREN')) {
                    nextUserSelections.push('USER_ORGUNIT_CHILDREN');
                  }
                  syncSelectedOrgUnits(
                    wizardState.orgUnits.filter(id => !USER_SCOPE_IDS.has(id)),
                    nextUserSelections,
                  );
                } else {
                  syncSelectedOrgUnits(
                    wizardState.orgUnits.filter(id => !USER_SCOPE_IDS.has(id)),
                    userScopeSelections.filter(id => id !== 'USER_ORGUNIT_CHILDREN'),
                  );
                }
              }}
            />
            <Text>{t('User sub-units')}</Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Checkbox
              checked={userSubX2Units}
              onChange={event => {
                setUserSubX2Units(event.target.checked);
                if (event.target.checked) {
                  const nextUserSelections = [...userScopeSelections];
                  if (!nextUserSelections.includes('USER_ORGUNIT_GRANDCHILDREN')) {
                    nextUserSelections.push('USER_ORGUNIT_GRANDCHILDREN');
                  }
                  syncSelectedOrgUnits(
                    wizardState.orgUnits.filter(id => !USER_SCOPE_IDS.has(id)),
                    nextUserSelections,
                  );
                } else {
                  syncSelectedOrgUnits(
                    wizardState.orgUnits.filter(id => !USER_SCOPE_IDS.has(id)),
                    userScopeSelections.filter(
                      id => id !== 'USER_ORGUNIT_GRANDCHILDREN',
                    ),
                  );
                }
              }}
            />
            <Text>{t('User sub-x2-units')}</Text>
          </div>
        </CheckboxGroup>
        </OptionsContainer>
      )}

      {(orgUnitLevels.length > 0 || lowestDataLevelOptions !== undefined) && (
        <OptionsContainer $flat={flatSections}>
          <SectionTitle>
            {labels?.lowestDataLevelTitle || t('Lowest data level to use')}
          </SectionTitle>
          <Paragraph style={{ margin: '0 0 12px 0' }}>
            {labels?.lowestDataLevelDescription ||
              t(
                'Set the deepest hierarchy level to include in extraction. ' +
                  'Org units below this level are excluded. ' +
                  'Leave empty to include all descendants (down to the lowest level in the hierarchy).',
              )}
          </Paragraph>
          <Select
            virtual={false}
            allowClear
            disabled={effectiveLowestDataLevelOptions.length === 0}
            placeholder={
              lowestDataLevelOptions !== undefined
                ? t('Include all mapped levels (no lower limit)')
                : t('Include all levels (no lower limit)')
            }
            value={
              wizardState.maxOrgUnitLevel != null
                ? String(wizardState.maxOrgUnitLevel)
                : undefined
            }
            onChange={value => {
              updateState({
                maxOrgUnitLevel:
                  value != null ? parseInt(String(value), 10) : null,
              });
            }}
            options={effectiveLowestDataLevelOptions}
            showSearch
            filterOption={(input, option) =>
              String(option?.label || '')
                .toLowerCase()
                .includes(input.toLowerCase())
            }
            dropdownStyle={SELECT_DROPDOWN_STYLE}
            styles={{ root: { width: '100%', maxWidth: 400 } }}
          />
          {lowestDataLevelOptions !== undefined &&
          effectiveLowestDataLevelOptions.length === 0 ? (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message={t('Complete the repository level mapping first')}
              description={t(
                'Map repository levels before choosing the lowest data level to use for the merged hierarchy.',
              )}
            />
          ) : null}
          {wizardState.maxOrgUnitLevel != null &&
            effectiveDataLevelScope === 'selected' && (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message={t(
                  'Lower level limit is most effective when "Data Level Scope" is set to include descendants (children, grandchildren, or all levels).',
                )}
              />
            )}
        </OptionsContainer>
      )}

      <OptionsContainer $flat={flatSections}>
        <SectionTitle>{labels?.dataScopeTitle || t('Data scope')}</SectionTitle>
        <Paragraph
          style={{
            margin: '0 0 12px 0',
            fontSize: 12,
            color: theme.colorTextSecondary,
          }}
        >
          {labels?.dataScopeDescription ||
            t(
              'Choose which organisation unit levels to include in the staged data refresh.',
            )}
        </Paragraph>
        <Radio.Group
          value={effectiveDataLevelScope}
          disabled={!!lockedDataScope}
          onChange={event => {
            const scope = event.target.value as
              | 'selected'
              | 'children'
              | 'grandchildren'
              | 'ancestors'
              | 'all_levels';
            updateState({
              dataLevelScope: scope,
              includeChildren: !['selected', 'ancestors'].includes(scope),
            });
          }}
        >
          <DataScopeOptions>
            <DataScopeOption $flat={flatSections}>
            <Radio value="selected">
              <Text style={{ fontWeight: 500 }}>
                {t('Selected units only (current level only)')}
              </Text>
            </Radio>
            <div
              style={{
                marginLeft: 24,
                marginTop: 8,
                fontSize: 12,
                color: theme.colorTextSecondary,
              }}
            >
              {t('Shows data for the exact organisation units you select.')}
            </div>
            </DataScopeOption>

            {includeAncestorsScope && (
              <DataScopeOption $flat={flatSections}>
              <Radio value="ancestors">
                <Text style={{ fontWeight: 500 }}>
                  {t('Include ancestors (parents and grandparents)')}
                </Text>
              </Radio>
              <div
                style={{
                  marginLeft: 24,
                  marginTop: 8,
                  fontSize: 12,
                  color: theme.colorTextSecondary,
                }}
                >
                  {t(
                    'Includes higher reporting units above the selected organisation units where they exist.',
                  )}
                </div>
              </DataScopeOption>
            )}

            <DataScopeOption $flat={flatSections}>
            <Radio value="children">
              <Text style={{ fontWeight: 500 }}>
                {t('Include children (one level down)')}
              </Text>
            </Radio>
            <div
              style={{
                marginLeft: 24,
                marginTop: 8,
                fontSize: 12,
                color: theme.colorTextSecondary,
              }}
            >
                {t(
                  'Includes all direct children of selected units, for example Districts when you select a Region.',
                )}
              </div>
            </DataScopeOption>

            <DataScopeOption $flat={flatSections}>
            <Radio value="grandchildren">
              <Text style={{ fontWeight: 500 }}>
                {t('Include grandchildren (two levels down)')}
              </Text>
            </Radio>
            <div
              style={{
                marginLeft: 24,
                marginTop: 8,
                fontSize: 12,
                color: theme.colorTextSecondary,
              }}
              >
                {t(
                  'Includes descendants up to two levels below the selected units.',
                )}
              </div>
            </DataScopeOption>

            <DataScopeOption $flat={flatSections}>
            <Radio value="all_levels">
              <Text style={{ fontWeight: 500 }}>{allLevelsScopeLabel}</Text>
            </Radio>
            <div
              style={{
                marginLeft: 24,
                marginTop: 8,
                fontSize: 12,
                color: theme.colorTextSecondary,
              }}
            >
              {allLevelsScopeDescription}
            </div>
            </DataScopeOption>
          </DataScopeOptions>
        </Radio.Group>
        {dataScopeLockedMessage || scopeSelectionMessage ? (
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            message={
              lockedDataScope
                ? t('Data scope is managed automatically')
                : t('Selection scope is enforced')
            }
            description={[dataScopeLockedMessage, scopeSelectionMessage]
              .filter(Boolean)
              .join(' ')}
          />
        ) : null}
      </OptionsContainer>

      <ContentSection>
        <div>
          <SectionTitle style={{ marginBottom: 12 }}>
            {t('Select organisation units')}
          </SectionTitle>
          <Input.Search
            placeholder={t('Search organisation units')}
            value={searchText}
            onChange={event => setSearchText(event.target.value)}
            size="large"
          />
        </div>

        <FiltersRow gutter={[16, 16]}>
          <Col xs={24} sm={!hideGroupFilter ? 8 : 12}>
            <div>
              <SectionTitle>{t('Filter by level')}</SectionTitle>
              <Select
                virtual={false}
                allowClear
                placeholder={t('Select a level')}
                value={selectedLevel}
                onChange={value => setSelectedLevel(value as string | null)}
                options={levelOptions}
                showSearch
                filterOption={(input, option) =>
                  String(option?.label || '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                dropdownStyle={SELECT_DROPDOWN_STYLE}
                styles={{ root: { width: '100%' } }}
              />
            </div>
          </Col>
          {!hideGroupFilter && (
            <Col xs={24} sm={8}>
              <div>
                <SectionTitle>{t('Filter by group set')}</SectionTitle>
                <Select
                  virtual={false}
                  allowClear
                  placeholder={t('Select a group set')}
                  value={selectedGroupSet}
                  onChange={value => setSelectedGroupSet(value as string | null)}
                  options={groupSetOptions}
                  showSearch
                  filterOption={(input, option) =>
                    String(option?.label || '')
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  dropdownStyle={SELECT_DROPDOWN_STYLE}
                  styles={{ root: { width: '100%' } }}
                />
              </div>
            </Col>
          )}
          {!hideGroupFilter && (
            <Col xs={24} sm={8}>
              <div>
                <SectionTitle>{t('Filter by group')}</SectionTitle>
                <Select
                  virtual={false}
                  allowClear
                  placeholder={
                    selectedGroupSet
                      ? t('Select a group from this group set')
                      : t('Select a group')
                  }
                  value={selectedGroup}
                  onChange={value => setSelectedGroup(value as string | null)}
                  options={groupOptions}
                  showSearch
                  filterOption={(input, option) =>
                    String(option?.label || '')
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  dropdownStyle={SELECT_DROPDOWN_STYLE}
                  styles={{ root: { width: '100%' } }}
                />
              </div>
            </Col>
          )}
        </FiltersRow>

        {errors.orgUnits && <ErrorText>{errors.orgUnits}</ErrorText>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <Loading />
          </div>
        ) : treeData.length === 0 ? (
          <Empty
            description={
              selectedConnectionCount === 0
                ? t('Select at least one configured connection to browse organisation units.')
                : loadStatus === 'pending'
                  ? t(
                      'Metadata is still being prepared in local staging. Retry in a moment to browse organisation units.',
                    )
                  : searchText || selectedGroup || selectedLevel
                    ? t('No organisation units match the current filters.')
                    : t(
                        'No organisation units are available from the selected connections.',
                      )
            }
            style={{ marginTop: 40 }}
          />
        ) : (
          <TreeContainer $flat={flatSections}>
            <Tree
              treeData={treeData}
              expandedKeys={expandedKeys}
              onExpand={keys => setExpandedKeys(keys as string[])}
              checkedKeys={scopedSelectionState.validKeys}
              checkStrictly
              onCheck={keys => {
                const checkedKeys = Array.isArray(keys)
                  ? (keys as string[])
                  : ((keys as { checked: string[] }).checked as string[]);
                syncSelectedOrgUnits(checkedKeys);
              }}
              checkable
              showIcon
            />
          </TreeContainer>
        )}
      </ContentSection>

      {wizardState.orgUnits.length > 0 && (
        <SelectedSummary $flat={flatSections}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <Text strong>
                <Badge
                  count={wizardState.orgUnits.length}
                  style={{ backgroundColor: theme.colorPrimary }}
                />
                <span style={{ marginLeft: 8 }}>{t('Selected Units')}</span>
              </Text>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {wizardState.orgUnits.map(id => {
                const displayName =
                  id === 'USER_ORGUNIT'
                    ? t('User organisation unit')
                    : id === 'USER_ORGUNIT_CHILDREN'
                      ? t('User sub-units')
                      : id === 'USER_ORGUNIT_GRANDCHILDREN'
                        ? t('User sub-x2-units')
                        : orgUnits.find(ou => ou.selectionKey === id)?.displayName || id;
                return (
                  <Tag
                    key={id}
                    closable
                    onClose={() => {
                      if (USER_SCOPE_IDS.has(id)) {
                        syncSelectedOrgUnits(
                          wizardState.orgUnits.filter(unitId => !USER_SCOPE_IDS.has(unitId)),
                          userScopeSelections.filter(unitId => unitId !== id),
                        );
                      } else {
                        syncSelectedOrgUnits(
                          wizardState.orgUnits.filter(
                            unitId => !USER_SCOPE_IDS.has(unitId) && unitId !== id,
                          ),
                        );
                      }
                      if (id === 'USER_ORGUNIT') {
                        setUserOrgUnit(false);
                      }
                      if (id === 'USER_ORGUNIT_CHILDREN') {
                        setUserSubUnits(false);
                      }
                      if (id === 'USER_ORGUNIT_GRANDCHILDREN') {
                        setUserSubX2Units(false);
                      }
                    }}
                    color={USER_SCOPE_IDS.has(id) ? 'blue' : 'green'}
                  >
                    {displayName}
                  </Tag>
                );
              })}
            </div>
          </div>
          <div
            style={{
              paddingTop: 12,
              borderTop: `1px solid ${theme.colorBorder}`,
            }}
          >
            <Text>
              <strong>{t('Org-unit source')}:</strong>{' '}
              {effectiveOrgUnitSourceMode === 'primary'
                ? primaryInstanceId
                  ? activeInstances.find(instance => instance.id === primaryInstanceId)?.name ||
                    t('Primary configured connection')
                  : t('Primary configured connection')
                : effectiveOrgUnitSourceMode === 'per_instance'
                  ? t('Separate per configured connection')
                  : t('Repository merge across selected configured connections')}
            </Text>
          </div>
          <div
            style={{
              paddingTop: 12,
              borderTop: `1px solid ${theme.colorBorder}`,
            }}
          >
            <Text>
              <strong>{t('Data scope')}:</strong>{' '}
              {lockedDataScope
                ? t('Automatic from mapped hierarchy')
                : effectiveDataLevelScope === 'children'
                ? t('Include children (one level down)')
                : effectiveDataLevelScope === 'grandchildren'
                  ? t('Include grandchildren (two levels down)')
                  : effectiveDataLevelScope === 'ancestors'
                    ? t('Include ancestors (parents and grandparents)')
                    : effectiveDataLevelScope === 'all_levels'
                    ? allLevelsScopeLabel
                    : t('Selected units only')}
            </Text>
          </div>
        </SelectedSummary>
      )}

      {wizardState.orgUnits.length > 0 && (
        <Button
          type="primary"
          danger
          block
          onClick={() => {
            setUserOrgUnit(false);
            setUserSubUnits(false);
            setUserSubX2Units(false);
            updateState({ orgUnits: [], selectedOrgUnitDetails: [] });
          }}
        >
          {t('Clear All')}
        </Button>
      )}
      </div>{/* end auto-detect wrapper */}
    </StepContainer>
  );
}
