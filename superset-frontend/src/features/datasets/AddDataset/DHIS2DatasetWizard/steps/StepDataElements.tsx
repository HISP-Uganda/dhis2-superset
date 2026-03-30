import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { styled, SupersetClient, t } from '@superset-ui/core';
import { Typography, Loading } from '@superset-ui/core/components';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Empty,
  Input,
  Pagination,
  Progress,
  Select,
  Space,
  Switch,
  Tag,
} from 'antd';

import { DHIS2WizardState } from '../index';
import type { DHIS2DisaggregationMode } from 'src/features/dhis2/types';

const { Title, Paragraph, Text } = Typography;

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = ['25', '50', '100'];

const StepContainer = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) 320px;
  gap: 24px;
  align-items: start;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

const ContentSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const FilterBar = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  align-items: end;
`;

const FilterField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const InstanceSummaryStrip = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
`;

const InstanceSummaryCard = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadiusLG}px;
    background: ${theme.colorBgElevated};
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
  `}
`;

const LoadProgressCard = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadiusLG}px;
    background: ${theme.colorBgContainer};
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
  `}
`;

const VariableListCard = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadiusLG}px;
    background: ${theme.colorBgElevated};
    overflow: hidden;
  `}
`;

const VariableListHeader = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    background: ${theme.colorBgContainer};
    display: flex;
    justify-content: space-between;
    gap: ${theme.sizeUnit * 2}px;
    align-items: center;
    flex-wrap: wrap;
  `}
`;

const VariableList = styled.div`
  display: flex;
  flex-direction: column;
`;

const VariableRow = styled.button<{ selected: boolean }>`
  ${({ theme, selected }) => `
    width: 100%;
    text-align: left;
    border: 0;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    background: ${selected ? theme.colorPrimaryBg : 'transparent'};
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
    cursor: pointer;
    transition: background 0.2s ease;

    &:hover {
      background: ${selected ? theme.colorPrimaryBgHover : theme.colorBgContainer};
    }

    &:last-child {
      border-bottom: 0;
    }

    .variable-row-main {
      display: flex;
      justify-content: space-between;
      gap: ${theme.sizeUnit * 3}px;
      align-items: flex-start;
    }

    .variable-row-name {
      font-weight: ${theme.fontWeightStrong};
      color: ${theme.colorText};
      margin-bottom: ${theme.sizeUnit}px;
    }

    .variable-row-meta {
      display: flex;
      gap: ${theme.sizeUnit * 1.5}px;
      flex-wrap: wrap;
    }
  `}
`;

const PaginationRow = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
    border-top: 1px solid ${theme.colorBorderSecondary};
    background: ${theme.colorBgContainer};
    display: flex;
    justify-content: space-between;
    gap: ${theme.sizeUnit * 2}px;
    align-items: center;
    flex-wrap: wrap;
  `}
`;

const SidePanel = styled.div`
  ${({ theme }) => `
    background: ${theme.colorBgElevated};
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadiusLG}px;
    padding: ${theme.sizeUnit * 4}px;
    position: sticky;
    top: ${theme.sizeUnit * 2}px;

    @media (max-width: 1080px) {
      position: static;
    }
  `}
`;

const SelectionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
`;

const SelectionCard = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadius}px;
    background: ${theme.colorBgContainer};
    padding: ${theme.sizeUnit * 3}px;
  `}
`;

interface StepDataElementsProps {
  wizardState: DHIS2WizardState;
  updateState: (updates: Partial<DHIS2WizardState>) => void;
  errors: Record<string, string>;
  databaseId?: number;
  instances?: InstanceOption[];
}

interface InstanceOption {
  id: number;
  name: string;
  is_active: boolean;
  database_id?: number;
  database_name?: string | null;
}

/** A single disaggregation category from a DHIS2 category combo. */
export interface VariableDimensionItem {
  dimension_key: string;
  dimension_label: string;
  dimension_scope: 'groupby' | 'filter_only';
  is_groupable: boolean;
  is_filterable: boolean;
  category_id: string;
  category_name: string;
  category_combo_id: string | null;
  category_combo_name: string | null;
  data_dimension_type: string;
  display_order: number;
  options: Array<{
    id: string;
    displayName: string;
    name?: string;
    code?: string;
  }>;
}

/** Dimension availability summary returned by the backend. */
export interface VariableDimensionAvailability {
  variable_id: string;
  variable_type: string;
  supports_total: boolean;
  supports_details: boolean;
  supports_disaggregation: boolean;
  disaggregation_dimensions: VariableDimensionItem[];
}

interface FederatedVariableItem {
  id: string;
  displayName: string;
  category?: string;
  aggregationType?: string;
  valueType?: string;
  domainType?: string;
  typeInfo?: string;
  analyticsType?: string;
  categoryCombo?: {
    id?: string;
    displayName?: string;
    name?: string;
  };
  indicatorType?: {
    id?: string;
    displayName?: string;
    name?: string;
  };
  indicatorTypeId?: string;
  formType?: string;
  groupLabels?: string[];
  groups?: Array<{
    id?: string;
    displayName?: string;
    name?: string;
  }>;
  program?: {
    id?: string;
    displayName?: string;
    name?: string;
  };
  programId?: string;
  programStage?: {
    id?: string;
    displayName?: string;
    name?: string;
    program?: {
      id?: string;
      displayName?: string;
      name?: string;
    };
  };
  programStageId?: string;
  dataElement?: {
    id?: string;
    displayName?: string;
    name?: string;
    valueType?: string;
    domainType?: string;
    aggregationType?: string;
    groups?: Array<{
      id?: string;
      displayName?: string;
      name?: string;
    }>;
  };
  source_instance_id: number;
  source_instance_name: string;
  source_database_id?: number;
  source_database_name?: string | null;
}

interface FederatedInstanceResult {
  id: number;
  name: string;
  status: 'success' | 'failed' | 'pending';
  count?: number;
  error?: string | null;
}

interface MetadataCatalogItem {
  id: string;
  displayName?: string;
  name?: string;
  source_instance_id?: number;
  source_instance_name?: string;
  program?: {
    id?: string;
    displayName?: string;
    name?: string;
  };
  dataElementGroups?: Array<{
    id?: string;
    displayName?: string;
    name?: string;
  }>;
  indicatorGroups?: Array<{
    id?: string;
    displayName?: string;
    name?: string;
  }>;
}

interface CatalogOption {
  id: string;
  label: string;
  sourceNames: string[];
  programId?: string;
}

interface GroupSetCatalogOption extends CatalogOption {
  memberIds: string[];
}

interface FilterCatalogState {
  dataElementGroups: CatalogOption[];
  dataElementGroupSets: GroupSetCatalogOption[];
  indicatorGroups: CatalogOption[];
  indicatorGroupSets: GroupSetCatalogOption[];
  indicatorTypes: CatalogOption[];
  programs: CatalogOption[];
  programStages: CatalogOption[];
}

interface MetadataFilters {
  searchText: string;
  groupSearchText: string;
  connectionFilterIds: number[];
  domainType?: string;
  valueType?: string;
  aggregationType?: string;
  formType?: string;
  programId?: string;
  programStageId?: string;
  indicatorTypeId?: string;
  analyticsType?: string;
  groupId?: string;
  groupSetId?: string;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface MetadataLoadProgressInstance {
  id: number | null;
  name: string;
  status?: string;
  loaded_count: number;
  total_count_estimate?: number | null;
  percent_complete: number;
}

interface MetadataLoadProgress {
  status?: string;
  loaded_count: number;
  total_count_estimate?: number | null;
  percent_complete: number;
  current_metadata_type?: string | null;
  current_instance_name?: string | null;
  instances: MetadataLoadProgressInstance[];
}

const DX_TYPES = [
  { label: t('Data elements'), value: 'dataElements' },
  { label: t('Indicators'), value: 'indicators' },
  { label: t('Data sets'), value: 'dataSets' },
  { label: t('Program indicators'), value: 'programIndicators' },
  { label: t('Event data items'), value: 'eventDataItems' },
];

const DX_TYPE_TO_VARIABLE_TYPE: Record<string, string> = {
  dataElements: 'dataElement',
  indicators: 'indicator',
  dataSets: 'dataSet',
  programIndicators: 'programIndicator',
  eventDataItems: 'eventDataItem',
};

const VALUE_TYPE_OPTIONS = [
  'NUMBER',
  'INTEGER',
  'INTEGER_POSITIVE',
  'INTEGER_NEGATIVE',
  'INTEGER_ZERO_OR_POSITIVE',
  'PERCENTAGE',
  'UNIT_INTERVAL',
  'BOOLEAN',
  'TRUE_ONLY',
  'TEXT',
  'LONG_TEXT',
  'LETTER',
  'PHONE_NUMBER',
  'EMAIL',
  'DATE',
  'DATETIME',
  'TIME',
  'COORDINATE',
  'ORGANISATION_UNIT',
  'REFERENCE',
].map(value => ({ label: value, value }));

const DOMAIN_TYPE_OPTIONS = [
  { label: 'AGGREGATE', value: 'AGGREGATE' },
  { label: 'TRACKER', value: 'TRACKER' },
];

const AGGREGATION_TYPE_OPTIONS = [
  'SUM',
  'AVERAGE',
  'AVERAGE_SUM_ORG_UNIT',
  'LAST',
  'LAST_AVERAGE_ORG_UNIT',
  'LAST_IN_PERIOD',
  'LAST_IN_PERIOD_AVERAGE_ORG_UNIT',
  'COUNT',
  'STDDEV',
  'VARIANCE',
  'CUSTOM',
  'NONE',
].map(value => ({ label: value, value }));

const FORM_TYPE_OPTIONS = ['DEFAULT', 'CUSTOM', 'SECTION'].map(value => ({
  label: value,
  value,
}));

const ANALYTICS_TYPE_OPTIONS = ['AGGREGATE', 'ENROLLMENT', 'EVENT'].map(
  value => ({
    label: value,
    value,
  }),
);

const EMPTY_FILTER_CATALOG: FilterCatalogState = {
  dataElementGroups: [],
  dataElementGroupSets: [],
  indicatorGroups: [],
  indicatorGroupSets: [],
  indicatorTypes: [],
  programs: [],
  programStages: [],
};

const DEFAULT_FILTERS: MetadataFilters = {
  searchText: '',
  groupSearchText: '',
  connectionFilterIds: [],
};

function normalizeLabels(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(values.map(value => (value || '').trim()).filter(Boolean)),
  );
}

function getGroupLabels(item: FederatedVariableItem): string[] {
  if (Array.isArray(item.groupLabels) && item.groupLabels.length > 0) {
    return normalizeLabels(item.groupLabels);
  }

  if (item.programStage) {
    return normalizeLabels([
      item.programStage.displayName,
      item.programStage.name,
      item.programStage.program?.displayName,
      item.programStage.program?.name,
      ...(item.dataElement?.groups || []).flatMap(group => [
        group.displayName,
        group.name,
      ]),
    ]);
  }

  if (item.program) {
    return normalizeLabels([item.program.displayName, item.program.name]);
  }

  return normalizeLabels(
    (item.groups || []).flatMap(group => [group.displayName, group.name]),
  );
}

function getGroupSearchLabel(dxType: string): string {
  if (dxType === 'programIndicators') {
    return t('Program Search');
  }
  if (dxType === 'eventDataItems') {
    return t('Program / Stage Search');
  }
  return t('Group Search');
}

function getGroupSearchPlaceholder(dxType: string): string {
  if (dxType === 'programIndicators') {
    return t('Search programs');
  }
  if (dxType === 'eventDataItems') {
    return t('Search programs, stages, or groups');
  }
  return t('Search groups');
}

function getDisplayName(item: Partial<MetadataCatalogItem>): string {
  return item.displayName || item.name || item.id || t('Unnamed metadata');
}

function buildCatalogOptions(items: MetadataCatalogItem[]): CatalogOption[] {
  const merged = new Map<string, { label: string; sourceNames: Set<string>; programId?: string }>();

  items.forEach(item => {
    const id = String(item.id || '').trim();
    if (!id) {
      return;
    }
    const current =
      merged.get(id) ||
      {
        label: getDisplayName(item),
        sourceNames: new Set<string>(),
        programId: item.program?.id,
      };
    if (item.source_instance_name) {
      current.sourceNames.add(item.source_instance_name);
    }
    if (!current.programId && item.program?.id) {
      current.programId = item.program.id;
    }
    merged.set(id, current);
  });

  return Array.from(merged.entries())
    .map(([id, value]) => {
      const sourceNames = Array.from(value.sourceNames).sort((left, right) =>
        left.localeCompare(right),
      );
      return {
        id,
        label:
          sourceNames.length > 0
            ? `${value.label} • ${sourceNames.join(', ')}`
            : value.label,
        sourceNames,
        programId: value.programId,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildGroupSetOptions(
  items: MetadataCatalogItem[],
  membersKey: 'dataElementGroups' | 'indicatorGroups',
): GroupSetCatalogOption[] {
  const merged = new Map<
    string,
    { label: string; sourceNames: Set<string>; memberIds: Set<string> }
  >();

  items.forEach(item => {
    const id = String(item.id || '').trim();
    if (!id) {
      return;
    }
    const current =
      merged.get(id) ||
      {
        label: getDisplayName(item),
        sourceNames: new Set<string>(),
        memberIds: new Set<string>(),
      };
    if (item.source_instance_name) {
      current.sourceNames.add(item.source_instance_name);
    }
    (item[membersKey] || []).forEach(group => {
      const groupId = String(group.id || '').trim();
      if (groupId) {
        current.memberIds.add(groupId);
      }
    });
    merged.set(id, current);
  });

  return Array.from(merged.entries())
    .map(([id, value]) => {
      const sourceNames = Array.from(value.sourceNames).sort((left, right) =>
        left.localeCompare(right),
      );
      return {
        id,
        label:
          sourceNames.length > 0
            ? `${value.label} • ${sourceNames.join(', ')}`
            : value.label,
        sourceNames,
        memberIds: Array.from(value.memberIds),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function getSupplementalMetadataTypes(dxType: string): string[] {
  if (dxType === 'dataElements') {
    return ['dataElementGroups', 'dataElementGroupSets'];
  }
  if (dxType === 'indicators') {
    return ['indicatorGroups', 'indicatorGroupSets', 'indicatorTypes'];
  }
  if (dxType === 'programIndicators') {
    return ['programs'];
  }
  if (dxType === 'eventDataItems') {
    return ['dataElementGroups', 'dataElementGroupSets', 'programs', 'programStages'];
  }
  return [];
}

function getStatusTagColor(status: FederatedInstanceResult['status']): string {
  if (status === 'success') {
    return 'green';
  }
  if (status === 'failed') {
    return 'volcano';
  }
  return 'gold';
}

function getMappingDisaggregationMode(
  mapping: DHIS2WizardState['variableMappings'][number],
): 'total' | 'details' {
  const mode = String(mapping.extraParams?.disaggregation || '').trim().toLowerCase();
  return mode === 'all' || mode === 'selected' ? 'details' : 'total';
}

export function applyVariableDisaggregationMode(
  mappings: DHIS2WizardState['variableMappings'],
  instanceId: number,
  variableId: string,
  mode: 'total' | 'details',
): DHIS2WizardState['variableMappings'] {
  return mappings.map(mapping => {
    if (
      mapping.instanceId !== instanceId ||
      mapping.variableId !== variableId
    ) {
      return mapping;
    }

    const nextExtraParams = {
      ...(mapping.extraParams || {}),
      disaggregation: (mode === 'details' ? 'all' : 'total') as DHIS2DisaggregationMode,
    } as Record<string, unknown>;

    if (mode === 'total') {
      delete nextExtraParams.selected_coc_uids;
    }
    if (mode === 'details') {
      // Clear disaggregate_by when switching to Details — detailed COC
      // expansion handles the same semantics, so both would conflict.
      delete nextExtraParams.disaggregate_by;
    }

    return {
      ...mapping,
      extraParams: nextExtraParams,
    };
  });
}

/** Update the disaggregate_by dimension keys on a variable mapping. */
export function applyVariableDisaggregateBy(
  mappings: DHIS2WizardState['variableMappings'],
  instanceId: number,
  variableId: string,
  dimensionKeys: string[],
): DHIS2WizardState['variableMappings'] {
  return mappings.map(mapping => {
    if (
      mapping.instanceId !== instanceId ||
      mapping.variableId !== variableId
    ) {
      return mapping;
    }
    const nextExtraParams = {
      ...(mapping.extraParams || {}),
    } as Record<string, unknown>;

    if (dimensionKeys.length > 0) {
      nextExtraParams.disaggregate_by = dimensionKeys;
    } else {
      delete nextExtraParams.disaggregate_by;
    }

    return { ...mapping, extraParams: nextExtraParams };
  });
}

function buildDynamicFilterParams(
  params: URLSearchParams,
  filters: MetadataFilters,
): void {
  if (filters.domainType) {
    params.set('domainType', filters.domainType);
  }
  if (filters.valueType) {
    params.set('valueType', filters.valueType);
  }
  if (filters.aggregationType) {
    params.set('aggregationType', filters.aggregationType);
  }
  if (filters.formType) {
    params.set('formType', filters.formType);
  }
  if (filters.programId) {
    params.set('programId', filters.programId);
  }
  if (filters.programStageId) {
    params.set('programStageId', filters.programStageId);
  }
  if (filters.indicatorTypeId) {
    params.set('indicatorTypeId', filters.indicatorTypeId);
  }
  if (filters.analyticsType) {
    params.set('analyticsType', filters.analyticsType);
  }
  if (filters.groupId) {
    params.set('groupId', filters.groupId);
  }
  if (filters.groupSetId) {
    params.set('groupSetId', filters.groupSetId);
  }
}

function formatCount(value?: number | null): string {
  if (value === null || value === undefined) {
    return '0';
  }
  return new Intl.NumberFormat().format(value);
}

function formatProgressStatus(status?: string): string {
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
      return t('Loading');
  }
}

function getProgressStatus(status?: string): 'normal' | 'success' | 'exception' | 'active' {
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

function formatProgressCounter(progress?: MetadataLoadProgress | MetadataLoadProgressInstance | null): string {
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

export default function WizardStepDataElements({
  wizardState,
  updateState,
  errors,
  databaseId,
  instances: providedInstances,
}: StepDataElementsProps) {
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState<
    'idle' | 'loading' | 'success' | 'partial' | 'pending' | 'failed'
  >('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<MetadataLoadProgress | null>(
    null,
  );
  const [loadedInstances, setLoadedInstances] = useState<InstanceOption[]>([]);
  const [instanceResults, setInstanceResults] = useState<FederatedInstanceResult[]>(
    [],
  );
  const [variables, setVariables] = useState<FederatedVariableItem[]>([]);
  const [dxType, setDxType] = useState<string>('dataElements');
  const [filters, setFilters] = useState<MetadataFilters>(DEFAULT_FILTERS);
  const [filterCatalog, setFilterCatalog] =
    useState<FilterCatalogState>(EMPTY_FILTER_CATALOG);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });
  const metadataRequestIdRef = useRef(0);
  const instancesRequestIdRef = useRef(0);
  const filterCatalogRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      metadataRequestIdRef.current += 1;
      instancesRequestIdRef.current += 1;
      filterCatalogRequestIdRef.current += 1;
    },
    [],
  );

  // ─── Dimension availability cache for disaggregation selectors ───────────
  // Keyed by "instanceId:variableId", populated lazily when a variable card
  // is expanded in Total mode.
  const [dimensionCache, setDimensionCache] = useState<
    Record<string, VariableDimensionAvailability | 'loading' | 'error'>
  >({});

  const fetchDimensionAvailability = useCallback(
    async (instanceId: number, variableId: string, variableType: string) => {
      if (!databaseId) return;
      const cacheKey = `${instanceId}:${variableId}`;
      setDimensionCache(prev => {
        if (prev[cacheKey] && prev[cacheKey] !== 'error') return prev;
        return { ...prev, [cacheKey]: 'loading' };
      });
      try {
        const params = new URLSearchParams({
          instance_id: String(instanceId),
          variable_id: variableId,
          variable_type: variableType,
        });
        const response = await SupersetClient.get({
          endpoint: `/api/v1/database/${databaseId}/dhis2_variable_dimensions/?${params}`,
        });
        const result = (response.json as any)?.result as
          | VariableDimensionAvailability
          | undefined;
        if (result && isMountedRef.current) {
          setDimensionCache(prev => ({ ...prev, [cacheKey]: result }));
        }
      } catch {
        if (isMountedRef.current) {
          setDimensionCache(prev => ({ ...prev, [cacheKey]: 'error' }));
        }
      }
    },
    [databaseId],
  );

  const deferredSearchText = filters.searchText.trim();
  const deferredGroupSearchText = filters.groupSearchText.trim();

  const availableInstances = useMemo(
    () =>
      providedInstances && providedInstances.length > 0
        ? providedInstances.filter(instance => instance.is_active)
        : loadedInstances.filter(instance => instance.is_active),
    [loadedInstances, providedInstances],
  );

  const instanceNameById = useMemo(
    () =>
      new Map(
        availableInstances.map(instance => [instance.id, instance.name] as const),
      ),
    [availableInstances],
  );

  const resolveInstanceName = useCallback(
    (instanceId?: number, fallback?: string | null): string =>
      (typeof instanceId === 'number'
        ? instanceNameById.get(instanceId)
        : undefined) ||
      fallback ||
      t('Unknown configured connection'),
    [instanceNameById],
  );

  const availableInstanceIds = useMemo(
    () => new Set(availableInstances.map(instance => instance.id)),
    [availableInstances],
  );

  const effectiveInstanceIds = useMemo(
    () =>
      filters.connectionFilterIds.length > 0
        ? filters.connectionFilterIds
        : wizardState.selectedInstanceIds,
    [filters.connectionFilterIds, wizardState.selectedInstanceIds],
  );

  const groupOptions = useMemo(() => {
    if (dxType === 'dataElements' || dxType === 'eventDataItems') {
      return filterCatalog.dataElementGroups;
    }
    if (dxType === 'indicators') {
      return filterCatalog.indicatorGroups;
    }
    return [];
  }, [
    dxType,
    filterCatalog.dataElementGroups,
    filterCatalog.indicatorGroups,
  ]);

  const groupSetOptions = useMemo(() => {
    if (dxType === 'dataElements' || dxType === 'eventDataItems') {
      return filterCatalog.dataElementGroupSets;
    }
    if (dxType === 'indicators') {
      return filterCatalog.indicatorGroupSets;
    }
    return [];
  }, [
    dxType,
    filterCatalog.dataElementGroupSets,
    filterCatalog.indicatorGroupSets,
  ]);

  const selectedGroupSetMemberIds = useMemo(() => {
    if (!filters.groupSetId) {
      return null;
    }
    const selectedGroupSet = groupSetOptions.find(
      option => option.id === filters.groupSetId,
    );
    if (!selectedGroupSet) {
      return null;
    }
    return new Set(selectedGroupSet.memberIds);
  }, [filters.groupSetId, groupSetOptions]);

  const visibleGroupOptions = useMemo(() => {
    if (!selectedGroupSetMemberIds) {
      return groupOptions;
    }
    return groupOptions.filter(option => selectedGroupSetMemberIds.has(option.id));
  }, [groupOptions, selectedGroupSetMemberIds]);

  const visibleProgramStageOptions = useMemo(() => {
    if (!filters.programId) {
      return filterCatalog.programStages;
    }
    return filterCatalog.programStages.filter(
      option => option.programId === filters.programId,
    );
  }, [filterCatalog.programStages, filters.programId]);

  const selectedMappings = wizardState.variableMappings;

  const selectedMappingsByInstance = useMemo(() => {
    const grouped = new Map<
      number,
      { instanceName: string; mappings: typeof selectedMappings }
    >();

    selectedMappings.forEach(mapping => {
      const current = grouped.get(mapping.instanceId);
      if (current) {
        current.mappings.push(mapping);
        return;
      }
      grouped.set(mapping.instanceId, {
        instanceName: resolveInstanceName(mapping.instanceId, mapping.instanceName),
        mappings: [mapping],
      });
    });

    return Array.from(grouped.entries()).map(([instanceId, value]) => ({
      instanceId,
      instanceName: value.instanceName,
      mappings: value.mappings,
    }));
  }, [resolveInstanceName, selectedMappings]);

  const isSelected = (item: FederatedVariableItem) =>
    selectedMappings.some(
      mapping =>
        mapping.instanceId === item.source_instance_id &&
        mapping.variableId === item.id,
    );

  const applyFilterUpdates = (updates: Partial<MetadataFilters>) => {
    setFilters(current => ({ ...current, ...updates }));
    setPagination(current => ({ ...current, page: 1 }));
  };

  useEffect(() => {
    setFilters(current => ({
      ...current,
      connectionFilterIds: current.connectionFilterIds.filter(connectionId =>
        availableInstanceIds.has(connectionId),
      ),
    }));
  }, [availableInstanceIds]);

  useEffect(() => {
    if (!filters.groupId) {
      return;
    }
    if (visibleGroupOptions.some(option => option.id === filters.groupId)) {
      return;
    }
    applyFilterUpdates({ groupId: undefined });
  }, [filters.groupId, visibleGroupOptions]);

  useEffect(() => {
    if (!filters.groupSetId) {
      return;
    }
    if (groupSetOptions.some(option => option.id === filters.groupSetId)) {
      return;
    }
    applyFilterUpdates({ groupSetId: undefined, groupId: undefined });
  }, [filters.groupSetId, groupSetOptions]);

  useEffect(() => {
    if (!filters.programStageId) {
      return;
    }
    if (
      visibleProgramStageOptions.some(
        option => option.id === filters.programStageId,
      )
    ) {
      return;
    }
    applyFilterUpdates({ programStageId: undefined });
  }, [filters.programStageId, visibleProgramStageOptions]);

  useEffect(() => {
    if (providedInstances) {
      setLoadedInstances([]);
      return;
    }
    if (!databaseId) {
      setLoadedInstances([]);
      return;
    }

    const requestId = instancesRequestIdRef.current + 1;
    instancesRequestIdRef.current = requestId;

    const fetchInstances = async () => {
      try {
        const response = await SupersetClient.get({
          endpoint: `/api/v1/dhis2/instances/?database_id=${databaseId}&include_inactive=true`,
        });
        if (!isMountedRef.current || requestId !== instancesRequestIdRef.current) {
          return;
        }
        const result: InstanceOption[] = (response.json as any)?.result || [];
        setLoadedInstances(result);
      } catch {
        if (!isMountedRef.current || requestId !== instancesRequestIdRef.current) {
          return;
        }
        setLoadedInstances([]);
      }
    };

    void fetchInstances();
  }, [databaseId, providedInstances]);

  useEffect(() => {
    const metadataTypes = getSupplementalMetadataTypes(dxType);
    if (!databaseId || effectiveInstanceIds.length === 0 || metadataTypes.length === 0) {
      setFilterCatalog(EMPTY_FILTER_CATALOG);
      setCatalogLoading(false);
      return;
    }

    const requestId = filterCatalogRequestIdRef.current + 1;
    filterCatalogRequestIdRef.current = requestId;
    setCatalogLoading(true);

    const loadFilterCatalog = async () => {
      try {
        const results = await Promise.all(
          metadataTypes.map(async metadataType => {
            const params = new URLSearchParams();
            params.set('type', metadataType);
            params.set('federated', 'true');
            params.set('staged', 'true');
            effectiveInstanceIds.forEach(instanceId => {
              params.append('instance_ids', String(instanceId));
            });
            const response = await SupersetClient.get({
              endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?${params.toString()}`,
            }).catch(() => ({ json: { result: [] } }));
            return {
              metadataType,
              result: (((response.json as any)?.result || []) as MetadataCatalogItem[]).map(
                item => ({
                  ...item,
                  source_instance_name: resolveInstanceName(
                    item.source_instance_id,
                    item.source_instance_name,
                  ),
                }),
              ),
            };
          }),
        );
        if (
          !isMountedRef.current ||
          requestId !== filterCatalogRequestIdRef.current
        ) {
          return;
        }

        const nextCatalog: FilterCatalogState = { ...EMPTY_FILTER_CATALOG };
        results.forEach(({ metadataType, result }) => {
          if (metadataType === 'dataElementGroups') {
            nextCatalog.dataElementGroups = buildCatalogOptions(result);
          } else if (metadataType === 'dataElementGroupSets') {
            nextCatalog.dataElementGroupSets = buildGroupSetOptions(
              result,
              'dataElementGroups',
            );
          } else if (metadataType === 'indicatorGroups') {
            nextCatalog.indicatorGroups = buildCatalogOptions(result);
          } else if (metadataType === 'indicatorGroupSets') {
            nextCatalog.indicatorGroupSets = buildGroupSetOptions(
              result,
              'indicatorGroups',
            );
          } else if (metadataType === 'indicatorTypes') {
            nextCatalog.indicatorTypes = buildCatalogOptions(result);
          } else if (metadataType === 'programs') {
            nextCatalog.programs = buildCatalogOptions(result);
          } else if (metadataType === 'programStages') {
            nextCatalog.programStages = buildCatalogOptions(result);
          }
        });
        setFilterCatalog(nextCatalog);
      } catch {
        if (
          !isMountedRef.current ||
          requestId !== filterCatalogRequestIdRef.current
        ) {
          return;
        }
        setFilterCatalog(EMPTY_FILTER_CATALOG);
      } finally {
        if (
          isMountedRef.current &&
          requestId === filterCatalogRequestIdRef.current
        ) {
          setCatalogLoading(false);
        }
      }
    };

    void loadFilterCatalog();
  }, [databaseId, dxType, effectiveInstanceIds, resolveInstanceName]);

  const refreshVariables = async () => {
    if (!databaseId || effectiveInstanceIds.length === 0) {
      setVariables([]);
      setInstanceResults([]);
      setLoadError(null);
      setStatusMessage(null);
      setLoadProgress(null);
      setLoadStatus('idle');
      setPagination(current => ({
        ...current,
        page: 1,
        total: 0,
        totalPages: 1,
      }));
      return;
    }

    const requestId = metadataRequestIdRef.current + 1;
    metadataRequestIdRef.current = requestId;
    setLoading(true);
    setLoadError(null);
    setStatusMessage(null);
    setLoadProgress(null);
    setLoadStatus('loading');

    try {
      const params = new URLSearchParams();
      params.set('type', dxType);
      params.set('federated', 'true');
      params.set('staged', 'true');
      params.set('page', String(pagination.page));
      params.set('page_size', String(pagination.pageSize));
      effectiveInstanceIds.forEach(instanceId => {
        params.append('instance_ids', String(instanceId));
      });
      if (deferredSearchText) {
        params.set('search', deferredSearchText);
      }
      if (deferredGroupSearchText) {
        params.set('group_search', deferredGroupSearchText);
      }
      buildDynamicFilterParams(params, filters);

      const response = await SupersetClient.get({
        endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?${params.toString()}`,
      });
      if (!isMountedRef.current || requestId !== metadataRequestIdRef.current) {
        return;
      }

      const responseJson = response.json as any;
      const result = ((responseJson?.result || []) as FederatedVariableItem[]).map(
        item => ({
          ...item,
          source_instance_name: resolveInstanceName(
            item.source_instance_id,
            item.source_instance_name,
          ),
        }),
      );
      const status = (responseJson?.status || 'success') as string;
      const message = (responseJson?.message as string) || null;
      const diagnostics = (responseJson?.instance_results ||
        []) as FederatedInstanceResult[];
      const responsePagination = responseJson?.pagination;
      const responseProgress =
        (responseJson?.progress as MetadataLoadProgress | null | undefined) || null;

      setInstanceResults(
        diagnostics.map(resultItem => ({
          ...resultItem,
          name: resolveInstanceName(resultItem.id, resultItem.name),
        })),
      );
      setVariables(result);
      setStatusMessage(message);
      setLoadProgress(responseProgress);
      setLoadStatus(
        status === 'failed'
          ? 'failed'
          : status === 'partial'
            ? 'partial'
            : status === 'pending'
              ? 'pending'
              : 'success',
      );
      setLoadError(
        status === 'failed'
          ? message || t('Failed to load variables for this DHIS2 database.')
          : null,
      );
      setPagination(current => ({
        page: responsePagination?.page ?? current.page,
        pageSize: responsePagination?.page_size ?? current.pageSize,
        total: responsePagination?.total ?? result.length,
        totalPages: responsePagination?.total_pages ?? 1,
      }));
    } catch (error) {
      if (!isMountedRef.current || requestId !== metadataRequestIdRef.current) {
        return;
      }
      setVariables([]);
      setInstanceResults([]);
      setStatusMessage(null);
      setLoadProgress(null);
      setLoadStatus('failed');
      setLoadError(
        error instanceof Error
          ? error.message
          : t('Failed to load variables for this DHIS2 database.'),
      );
      setPagination(current => ({
        ...current,
        total: 0,
        totalPages: 1,
      }));
    } finally {
      if (isMountedRef.current && requestId === metadataRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void refreshVariables();
  }, [
    databaseId,
    deferredGroupSearchText,
    deferredSearchText,
    dxType,
    effectiveInstanceIds,
    filters.aggregationType,
    filters.analyticsType,
    filters.domainType,
    filters.formType,
    filters.groupId,
    filters.groupSetId,
    filters.indicatorTypeId,
    filters.programId,
    filters.programStageId,
    filters.valueType,
    pagination.page,
    pagination.pageSize,
  ]);

  const failedInstances = useMemo(
    () => instanceResults.filter(result => result.status === 'failed'),
    [instanceResults],
  );
  const pendingInstances = useMemo(
    () => instanceResults.filter(result => result.status === 'pending'),
    [instanceResults],
  );

  useEffect(() => {
    if (
      !databaseId ||
      effectiveInstanceIds.length === 0 ||
      !(
        loadStatus === 'pending' ||
        (loadStatus === 'partial' && pendingInstances.length > 0)
      )
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshVariables();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [databaseId, effectiveInstanceIds, loadStatus, pendingInstances.length]);

  const handleDxTypeChange = (nextDxType: string) => {
    setDxType(nextDxType);
    setFilterCatalog(EMPTY_FILTER_CATALOG);
    setFilters(current => ({
      ...current,
      searchText: '',
      groupSearchText: '',
      domainType: undefined,
      valueType: undefined,
      aggregationType: undefined,
      formType: undefined,
      programId: undefined,
      programStageId: undefined,
      indicatorTypeId: undefined,
      analyticsType: undefined,
      groupId: undefined,
      groupSetId: undefined,
    }));
    setPagination(current => ({
      ...current,
      page: 1,
      total: 0,
      totalPages: 1,
    }));
  };

  const handleToggleElement = (item: FederatedVariableItem) => {
    const existing = selectedMappings.find(
      mapping =>
        mapping.instanceId === item.source_instance_id &&
        mapping.variableId === item.id,
    );

    const varType = DX_TYPE_TO_VARIABLE_TYPE[dxType] || dxType;
    const normalizedVarType = varType.toLowerCase();
    const isDataElement =
      normalizedVarType === 'dataelement' || normalizedVarType === 'dataelements';

    // Determine category combo metadata from the DHIS2 item.
    // A data element with categoryCombo named "default" (or missing) has no
    // meaningful disaggregation.
    const ccName =
      item.categoryCombo?.displayName || item.categoryCombo?.name || null;
    const ccIsDefault =
      !ccName ||
      ['default', 'default category', 'default total'].includes(
        ccName.trim().toLowerCase(),
      );

    const variableMappings = existing
      ? selectedMappings.filter(
          mapping =>
            !(
              mapping.instanceId === item.source_instance_id &&
              mapping.variableId === item.id
            ),
        )
      : [
          ...selectedMappings,
          {
            variableId: item.id,
            variableName: item.displayName,
            variableType: varType,
            instanceId: item.source_instance_id,
            instanceName: resolveInstanceName(
              item.source_instance_id,
              item.source_instance_name,
            ),
            categoryComboName: isDataElement && !ccIsDefault ? ccName : null,
            supportsDisaggregation: isDataElement && !ccIsDefault,
            supportsDetails: isDataElement,
            extraParams: {
              disaggregation: 'total' as DHIS2DisaggregationMode,
            },
          },
        ];

    updateState({
      variableMappings,
      dataElements: [...new Set(variableMappings.map(mapping => mapping.variableId))],
    });
  };

  const updateVariableAlias = (
    instanceId: number,
    variableId: string,
    alias: string,
  ) => {
    const variableMappings = selectedMappings.map(mapping =>
      mapping.instanceId === instanceId && mapping.variableId === variableId
        ? {
            ...mapping,
            alias,
          }
        : mapping,
    );

    updateState({
      variableMappings,
      dataElements: [...new Set(variableMappings.map(mapping => mapping.variableId))],
    });
  };

  const updateVariableDisaggregation = (
    instanceId: number,
    variableId: string,
    mode: 'total' | 'details',
  ) => {
    const variableMappings = applyVariableDisaggregationMode(
      selectedMappings,
      instanceId,
      variableId,
      mode,
    );

    updateState({
      variableMappings,
      dataElements: [...new Set(variableMappings.map(mapping => mapping.variableId))],
    });
  };

  const updateVariableDisaggregateBy = (
    instanceId: number,
    variableId: string,
    dimensionKeys: string[],
  ) => {
    const variableMappings = applyVariableDisaggregateBy(
      selectedMappings,
      instanceId,
      variableId,
      dimensionKeys,
    );
    updateState({
      variableMappings,
      dataElements: [...new Set(variableMappings.map(mapping => mapping.variableId))],
    });
  };

  const clearInstanceSelections = (instanceId: number) => {
    const variableMappings = selectedMappings.filter(
      mapping => mapping.instanceId !== instanceId,
    );
    updateState({
      variableMappings,
      dataElements: [...new Set(variableMappings.map(mapping => mapping.variableId))],
    });
  };

  const clearAllSelections = () => {
    updateState({
      variableMappings: [],
      dataElements: [],
    });
  };

  const rangeStart =
    pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd =
    pagination.total === 0
      ? 0
      : Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <StepContainer>
      <ContentSection>
        <div>
          <Title level={4}>{t('Select Variables')}</Title>
          <Paragraph>
            {t(
              'Variables are loaded from local staging for the selected configured DHIS2 connections. Each variable remains tagged with its originating connection so dataset lineage stays explicit and fast to browse.',
            )}
          </Paragraph>
        </div>

        {availableInstances.length === 0 ? (
          <Empty
            description={t(
              'No active configured DHIS2 connections are available for this Database.',
            )}
          />
        ) : null}

        {availableInstances.length > 0 &&
        wizardState.selectedInstanceIds.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message={t('No configured connections are currently selected')}
            description={t(
              'Return to the Database step and select at least one configured DHIS2 connection to load variables.',
            )}
          />
        ) : null}

        {loadError ? (
          <Alert
            type="error"
            showIcon
            message={t('Unable to load DHIS2 variables')}
            description={loadError}
            action={
              <Button onClick={() => void refreshVariables()} size="small">
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
              <Button onClick={() => void refreshVariables()} size="small">
                {t('Retry')}
              </Button>
            }
          />
        ) : null}

        {(failedInstances.length > 0 || pendingInstances.length > 0) &&
        !loadError &&
        loadStatus !== 'pending' ? (
          <Alert
            type={failedInstances.length > 0 ? 'warning' : 'info'}
            showIcon
            message={
              failedInstances.length > 0
                ? t('Some configured connections could not be loaded locally')
                : t('Some configured connections are still being staged locally')
            }
            description={[
              statusMessage,
              ...failedInstances.map(instance =>
                instance.error ? `${instance.name}: ${instance.error}` : instance.name,
              ),
              ...pendingInstances.map(instance => instance.name),
            ]
              .filter(Boolean)
              .join(' | ')}
            action={
              <Button onClick={() => void refreshVariables()} size="small">
                {t('Retry')}
              </Button>
            }
          />
        ) : null}

        {loadProgress &&
        ['queued', 'running', 'partial'].includes(loadProgress.status || '') ? (
          <LoadProgressCard>
            <Space
              align="center"
              style={{ justifyContent: 'space-between', width: '100%' }}
              wrap
            >
              <Text strong>{t('Variable staging progress')}</Text>
              <Tag color="blue">{formatProgressStatus(loadProgress.status)}</Tag>
            </Space>
            <Progress
              percent={loadProgress.percent_complete}
              status={getProgressStatus(loadProgress.status)}
              strokeColor="#1677ff"
              style={{ marginTop: 12, marginBottom: 8 }}
            />
            <Text type="secondary">{formatProgressCounter(loadProgress)}</Text>
            {loadProgress.current_instance_name || loadProgress.current_metadata_type ? (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">
                  {t(
                    'Current stage: %s%s',
                    loadProgress.current_instance_name || t('Database'),
                    loadProgress.current_metadata_type
                      ? ` • ${loadProgress.current_metadata_type}`
                      : '',
                  )}
                </Text>
              </div>
            ) : null}
          </LoadProgressCard>
        ) : null}

        <FilterBar>
          <FilterField>
            <Text strong>{t('Variable Type')}</Text>
            <Select
              aria-label={t('Variable Type')}
              onChange={handleDxTypeChange}
              options={DX_TYPES}
              value={dxType}
            />
          </FilterField>
          <FilterField>
            <Text strong>{t('Configured Connection')}</Text>
            <Select
              aria-label={t('Configured Connection')}
              mode="multiple"
              allowClear
              maxTagCount={2}
              onChange={value =>
                applyFilterUpdates({ connectionFilterIds: value as number[] })
              }
              options={availableInstances.map(instance => ({
                label: instance.name,
                value: instance.id,
              }))}
              placeholder={t('All configured connections')}
              value={filters.connectionFilterIds}
            />
          </FilterField>
          <FilterField>
            <Text strong>{t('Search')}</Text>
            <Input.Search
              allowClear
              aria-label={t('Search')}
              onChange={event =>
                applyFilterUpdates({ searchText: event.target.value })
              }
              placeholder={t('Search variables by name or UID')}
              value={filters.searchText}
            />
          </FilterField>
          <FilterField>
            <Text strong>{getGroupSearchLabel(dxType)}</Text>
            <Input.Search
              allowClear
              aria-label={getGroupSearchLabel(dxType)}
              onChange={event =>
                applyFilterUpdates({ groupSearchText: event.target.value })
              }
              placeholder={getGroupSearchPlaceholder(dxType)}
              value={filters.groupSearchText}
            />
          </FilterField>
        </FilterBar>

        <FilterBar>
          {(dxType === 'dataElements' ||
            dxType === 'eventDataItems' ||
            dxType === 'indicators') && (
            <>
              <FilterField>
                <Text strong>{t('Group Set')}</Text>
                <Select
                  allowClear
                  aria-label={t('Group Set')}
                  optionFilterProp="label"
                  options={groupSetOptions.map(option => ({
                    label: option.label,
                    value: option.id,
                  }))}
                  onChange={value =>
                    applyFilterUpdates({
                      groupSetId: value as string | undefined,
                      groupId: undefined,
                    })
                  }
                  placeholder={t('All group sets')}
                  showSearch
                  value={filters.groupSetId}
                />
              </FilterField>
              <FilterField>
                <Text strong>{t('Group')}</Text>
                <Select
                  allowClear
                  aria-label={t('Group')}
                  loading={catalogLoading}
                  optionFilterProp="label"
                  options={visibleGroupOptions.map(option => ({
                    label: option.label,
                    value: option.id,
                  }))}
                  onChange={value =>
                    applyFilterUpdates({ groupId: value as string | undefined })
                  }
                  placeholder={t('All groups')}
                  showSearch
                  value={filters.groupId}
                />
              </FilterField>
            </>
          )}

          {(dxType === 'dataElements' || dxType === 'eventDataItems') && (
            <>
              <FilterField>
                <Text strong>{t('Value Type')}</Text>
                <Select
                  allowClear
                  aria-label={t('Value Type')}
                  options={VALUE_TYPE_OPTIONS}
                  onChange={value =>
                    applyFilterUpdates({ valueType: value as string | undefined })
                  }
                  placeholder={t('All value types')}
                  showSearch
                  value={filters.valueType}
                />
              </FilterField>
              <FilterField>
                <Text strong>{t('Domain')}</Text>
                <Select
                  allowClear
                  aria-label={t('Domain')}
                  options={DOMAIN_TYPE_OPTIONS}
                  onChange={value =>
                    applyFilterUpdates({ domainType: value as string | undefined })
                  }
                  placeholder={t('All domains')}
                  value={filters.domainType}
                />
              </FilterField>
            </>
          )}

          {dxType === 'dataElements' && (
            <FilterField>
              <Text strong>{t('Aggregation')}</Text>
              <Select
                allowClear
                aria-label={t('Aggregation')}
                options={AGGREGATION_TYPE_OPTIONS}
                onChange={value =>
                  applyFilterUpdates({
                    aggregationType: value as string | undefined,
                  })
                }
                placeholder={t('All aggregation types')}
                showSearch
                value={filters.aggregationType}
              />
            </FilterField>
          )}

          {dxType === 'indicators' && (
            <>
              <FilterField>
                <Text strong>{t('Value Type')}</Text>
                <Select
                  allowClear
                  aria-label={t('Value Type')}
                  options={VALUE_TYPE_OPTIONS}
                  onChange={value =>
                    applyFilterUpdates({ valueType: value as string | undefined })
                  }
                  placeholder={t('All value types')}
                  showSearch
                  value={filters.valueType}
                />
              </FilterField>
              <FilterField>
                <Text strong>{t('Indicator Type')}</Text>
                <Select
                  allowClear
                  aria-label={t('Indicator Type')}
                  loading={catalogLoading}
                  optionFilterProp="label"
                  options={filterCatalog.indicatorTypes.map(option => ({
                    label: option.label,
                    value: option.id,
                  }))}
                  onChange={value =>
                    applyFilterUpdates({
                      indicatorTypeId: value as string | undefined,
                    })
                  }
                  placeholder={t('All indicator types')}
                  showSearch
                  value={filters.indicatorTypeId}
                />
              </FilterField>
            </>
          )}

          {dxType === 'dataSets' && (
            <FilterField>
              <Text strong>{t('Form Type')}</Text>
              <Select
                allowClear
                aria-label={t('Form Type')}
                options={FORM_TYPE_OPTIONS}
                onChange={value =>
                  applyFilterUpdates({ formType: value as string | undefined })
                }
                placeholder={t('All form types')}
                value={filters.formType}
              />
            </FilterField>
          )}

          {dxType === 'programIndicators' && (
            <>
              <FilterField>
                <Text strong>{t('Program')}</Text>
                <Select
                  allowClear
                  aria-label={t('Program')}
                  loading={catalogLoading}
                  optionFilterProp="label"
                  options={filterCatalog.programs.map(option => ({
                    label: option.label,
                    value: option.id,
                  }))}
                  onChange={value =>
                    applyFilterUpdates({ programId: value as string | undefined })
                  }
                  placeholder={t('All programs')}
                  showSearch
                  value={filters.programId}
                />
              </FilterField>
              <FilterField>
                <Text strong>{t('Analytics Type')}</Text>
                <Select
                  allowClear
                  aria-label={t('Analytics Type')}
                  options={ANALYTICS_TYPE_OPTIONS}
                  onChange={value =>
                    applyFilterUpdates({
                      analyticsType: value as string | undefined,
                    })
                  }
                  placeholder={t('All analytics types')}
                  value={filters.analyticsType}
                />
              </FilterField>
            </>
          )}

          {dxType === 'eventDataItems' && (
            <>
              <FilterField>
                <Text strong>{t('Program')}</Text>
                <Select
                  allowClear
                  aria-label={t('Program')}
                  loading={catalogLoading}
                  optionFilterProp="label"
                  options={filterCatalog.programs.map(option => ({
                    label: option.label,
                    value: option.id,
                  }))}
                  onChange={value =>
                    applyFilterUpdates({
                      programId: value as string | undefined,
                      programStageId: undefined,
                    })
                  }
                  placeholder={t('All programs')}
                  showSearch
                  value={filters.programId}
                />
              </FilterField>
              <FilterField>
                <Text strong>{t('Program Stage')}</Text>
                <Select
                  allowClear
                  aria-label={t('Program Stage')}
                  loading={catalogLoading}
                  optionFilterProp="label"
                  options={visibleProgramStageOptions.map(option => ({
                    label: option.label,
                    value: option.id,
                  }))}
                  onChange={value =>
                    applyFilterUpdates({
                      programStageId: value as string | undefined,
                    })
                  }
                  placeholder={t('All program stages')}
                  showSearch
                  value={filters.programStageId}
                />
              </FilterField>
            </>
          )}
        </FilterBar>

        {errors.dataElements ? (
          <Alert type="error" showIcon message={errors.dataElements} />
        ) : null}

        {instanceResults.length > 0 ? (
          <InstanceSummaryStrip>
            {instanceResults.map(instance => (
              <InstanceSummaryCard key={instance.id}>
                <Space
                  direction="vertical"
                  size={6}
                  style={{ width: '100%' }}
                >
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Text strong>{instance.name}</Text>
                    <Tag color={getStatusTagColor(instance.status)}>
                      {instance.status}
                    </Tag>
                  </Space>
                  <Text type="secondary">
                    {t('%s matching variables', instance.count || 0)}
                  </Text>
                  {instance.error ? (
                    <Text type="secondary">{instance.error}</Text>
                  ) : null}
                </Space>
              </InstanceSummaryCard>
            ))}
          </InstanceSummaryStrip>
        ) : null}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '56px 20px' }}>
            <Loading />
          </div>
        ) : variables.length === 0 ? (
          <Empty
            description={
              effectiveInstanceIds.length === 0
                ? t(
                    'Select at least one configured connection in the previous step to browse variables.',
                  )
                : loadStatus === 'pending'
                  ? t(
                      'Metadata is still being prepared in local staging. Retry in a moment to browse variables.',
                    )
                  : filters.searchText ||
                      filters.groupSearchText ||
                      filters.connectionFilterIds.length > 0 ||
                      filters.domainType ||
                      filters.valueType ||
                      filters.aggregationType ||
                      filters.formType ||
                      filters.programId ||
                      filters.programStageId ||
                      filters.indicatorTypeId ||
                      filters.analyticsType ||
                      filters.groupId ||
                      filters.groupSetId
                    ? t('No variables match the current filters.')
                    : t(
                        'No variables are available from the active configured connections.',
                      )
            }
          />
        ) : (
          <VariableListCard>
            <VariableListHeader>
              <Space direction="vertical" size={2}>
                <Text strong>{t('Staged Variables')}</Text>
                <Text type="secondary">
                  {t(
                    'Showing %s-%s of %s variables from local staging.',
                    rangeStart,
                    rangeEnd,
                    pagination.total,
                  )}
                </Text>
              </Space>
              <Space wrap>
                <Tag color="blue">{t('Staged locally')}</Tag>
                <Tag color="geekblue">
                  {selectedMappings.length} {t('selected')}
                </Tag>
              </Space>
            </VariableListHeader>
            <VariableList>
              {variables.map(item => {
                const selected = isSelected(item);
                const groupLabels = getGroupLabels(item);
                const programLabel =
                  item.program?.displayName || item.program?.name || undefined;
                const programStageLabel =
                  item.programStage?.displayName ||
                  item.programStage?.name ||
                  undefined;
                const indicatorTypeLabel =
                  item.indicatorType?.displayName ||
                  item.indicatorType?.name ||
                  undefined;
                return (
                  <VariableRow
                    key={`${item.source_instance_id}-${item.id}`}
                    onClick={() => handleToggleElement(item)}
                    selected={selected}
                    type="button"
                  >
                    <div className="variable-row-main">
                      <Space align="start" size={12}>
                        <Checkbox checked={selected} />
                        <div>
                          <div className="variable-row-name">{item.displayName}</div>
                          <div className="variable-row-meta">
                            <Tag color="blue">{item.source_instance_name}</Tag>
                            <Tag>{DX_TYPE_TO_VARIABLE_TYPE[dxType] || dxType}</Tag>
                            {item.valueType ? <Tag>{item.valueType}</Tag> : null}
                            {item.aggregationType ? (
                              <Tag>{item.aggregationType}</Tag>
                            ) : null}
                            {item.domainType ? <Tag>{item.domainType}</Tag> : null}
                            {item.formType ? <Tag>{item.formType}</Tag> : null}
                            {item.analyticsType ? (
                              <Tag color="purple">{item.analyticsType}</Tag>
                            ) : null}
                            {indicatorTypeLabel ? (
                              <Tag color="magenta">{indicatorTypeLabel}</Tag>
                            ) : null}
                            {programLabel ? (
                              <Tag color="gold">{programLabel}</Tag>
                            ) : null}
                            {programStageLabel ? (
                              <Tag color="gold">{programStageLabel}</Tag>
                            ) : null}
                            {groupLabels.slice(0, 3).map(label => (
                              <Tag color="cyan" key={label}>
                                {label}
                              </Tag>
                            ))}
                            {groupLabels.length > 3 ? (
                              <Tag color="cyan">
                                {t('+%s more', groupLabels.length - 3)}
                              </Tag>
                            ) : null}
                          </div>
                        </div>
                      </Space>
                      <Text type="secondary">{item.id}</Text>
                    </div>
                  </VariableRow>
                );
              })}
            </VariableList>
            <PaginationRow>
              <Text type="secondary">
                {t(
                  'Page %s of %s',
                  pagination.page,
                  Math.max(1, pagination.totalPages),
                )}
              </Text>
              <Pagination
                current={pagination.page}
                onChange={(page, pageSize) =>
                  setPagination(current => ({
                    ...current,
                    page,
                    pageSize,
                  }))
                }
                pageSize={pagination.pageSize}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                showSizeChanger
                size="small"
                total={pagination.total}
              />
            </PaginationRow>
          </VariableListCard>
        )}
      </ContentSection>

      <SidePanel>
        <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
          {t('Selected Variables')}
        </Title>
        <Text type="secondary">
          {t(
            '%s variables selected across %s configured connections.',
            selectedMappings.length,
            selectedMappingsByInstance.length,
          )}
        </Text>

        {selectedMappings.length > 0 ? (
          <Button
            block
            danger
            style={{ marginTop: 16 }}
            onClick={clearAllSelections}
          >
            {t('Clear All')}
          </Button>
        ) : null}

        {selectedMappingsByInstance.length === 0 ? (
          <Empty
            description={t('No variables selected yet.')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 24 }}
          />
        ) : (
          <SelectionList>
            {selectedMappingsByInstance.map(group => (
              <SelectionCard key={group.instanceId}>
                <Space
                  align="start"
                  direction="vertical"
                  size={10}
                  style={{ width: '100%' }}
                >
                  <div style={{ width: '100%' }}>
                    <Space
                      align="center"
                      style={{ justifyContent: 'space-between', width: '100%' }}
                    >
                      <Text strong>{group.instanceName}</Text>
                      <Tag color="blue">{group.mappings.length}</Tag>
                    </Space>
                  </div>
                  {group.mappings.slice(0, 6).map(mapping => {
                    const mode = getMappingDisaggregationMode(mapping);
                    const cacheKey = `${mapping.instanceId}:${mapping.variableId}`;
                    const cachedDims = dimensionCache[cacheKey];
                    const isDataElementVar =
                      mapping.supportsDetails !== false &&
                      ['dataelement', 'dataelements'].includes(
                        (mapping.variableType || '').toLowerCase(),
                      );
                    const showDetailsOption = isDataElementVar;
                    const canDisaggregate = mapping.supportsDisaggregation === true;

                    // Lazily fetch dimension availability when a variable
                    // that supports disaggregation is shown in Total mode.
                    if (
                      canDisaggregate &&
                      mode === 'total' &&
                      !cachedDims
                    ) {
                      fetchDimensionAvailability(
                        mapping.instanceId,
                        mapping.variableId,
                        mapping.variableType,
                      );
                    }

                    const dimensions =
                      cachedDims &&
                      cachedDims !== 'loading' &&
                      cachedDims !== 'error'
                        ? cachedDims.disaggregation_dimensions
                        : [];

                    const currentDisaggregateBy = (
                      (mapping.extraParams?.disaggregate_by as string[]) || []
                    );

                    return (
                      <div
                        key={`${mapping.instanceId}-${mapping.variableId}`}
                        style={{
                          width: '100%',
                          borderBottom: '1px solid var(--color-border-secondary, #f0f0f0)',
                          paddingBottom: 10,
                          marginBottom: 4,
                        }}
                      >
                        {/* Header: name + type + remove */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            marginBottom: 6,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>
                              {mapping.variableName}
                            </div>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {mapping.variableType}
                              {mapping.categoryComboName
                                ? ` · ${mapping.categoryComboName}`
                                : ''}
                            </Text>
                          </div>
                          <Button
                            danger
                            size="small"
                            onClick={() =>
                              handleToggleElement({
                                id: mapping.variableId,
                                displayName: mapping.variableName,
                                source_instance_id: mapping.instanceId,
                                source_instance_name: mapping.instanceName,
                              })
                            }
                          >
                            {t('Remove')}
                          </Button>
                        </div>

                        {/* Alias */}
                        <Input
                          aria-label={t('Alias for %s', mapping.variableName)}
                          onChange={event =>
                            updateVariableAlias(
                              mapping.instanceId,
                              mapping.variableId,
                              event.target.value,
                            )
                          }
                          placeholder={t('Optional alias')}
                          size="small"
                          value={mapping.alias || ''}
                        />

                        {/* Value mode: Total / Details */}
                        <div style={{ marginTop: 8 }}>
                          <Text
                            type="secondary"
                            style={{ display: 'block', fontSize: 12, marginBottom: 4 }}
                          >
                            {t('Value mode')}
                          </Text>
                          <Select
                            aria-label={t('Value mode for %s', mapping.variableName)}
                            options={
                              showDetailsOption
                                ? [
                                    { value: 'total', label: t('Total') },
                                    { value: 'details', label: t('Details (Category Option Combos)') },
                                  ]
                                : [{ value: 'total', label: t('Total') }]
                            }
                            size="small"
                            style={{ width: '100%' }}
                            value={mode}
                            onChange={value =>
                              updateVariableDisaggregation(
                                mapping.instanceId,
                                mapping.variableId,
                                value as 'total' | 'details',
                              )
                            }
                          />
                          {!showDetailsOption && (
                            <Text
                              type="secondary"
                              style={{ display: 'block', fontSize: 11, marginTop: 2 }}
                            >
                              {t(
                                'Only Total is available for %s variables.',
                                mapping.variableType,
                              )}
                            </Text>
                          )}
                        </div>

                        {/* Disaggregate by — only in Total mode for variables
                            with non-default category combos */}
                        {mode === 'total' && canDisaggregate && (
                          <div style={{ marginTop: 8 }}>
                            <Text
                              type="secondary"
                              style={{ display: 'block', fontSize: 12, marginBottom: 4 }}
                            >
                              {t('Disaggregate by')}
                            </Text>
                            {cachedDims === 'loading' ? (
                              <Text
                                type="secondary"
                                style={{ fontSize: 11, fontStyle: 'italic' }}
                              >
                                {t('Loading dimensions…')}
                              </Text>
                            ) : cachedDims === 'error' ? (
                              <Text
                                type="warning"
                                style={{ fontSize: 11 }}
                              >
                                {t('Could not load disaggregation dimensions.')}
                              </Text>
                            ) : dimensions.length > 0 ? (
                              <Select
                                aria-label={t(
                                  'Disaggregate by for %s',
                                  mapping.variableName,
                                )}
                                mode="multiple"
                                options={dimensions.map(dim => ({
                                  value: dim.dimension_key,
                                  label: dim.dimension_label,
                                  disabled: !dim.is_groupable,
                                }))}
                                placeholder={t('Select categories…')}
                                size="small"
                                style={{ width: '100%' }}
                                value={currentDisaggregateBy}
                                onChange={(keys: string[]) =>
                                  updateVariableDisaggregateBy(
                                    mapping.instanceId,
                                    mapping.variableId,
                                    keys,
                                  )
                                }
                              />
                            ) : (
                              <Text
                                type="secondary"
                                style={{ fontSize: 11 }}
                              >
                                {t('No disaggregation categories available.')}
                              </Text>
                            )}
                          </div>
                        )}

                        {/* Details mode info */}
                        {mode === 'details' && (
                          <Text
                            type="secondary"
                            style={{
                              display: 'block',
                              fontSize: 11,
                              marginTop: 6,
                              fontStyle: 'italic',
                            }}
                          >
                            {t(
                              'Each Category Option Combo will be expanded as a separate column. Disaggregation selector is disabled in this mode.',
                            )}
                          </Text>
                        )}

                        {/* Total mode without disaggregation support info */}
                        {mode === 'total' && !canDisaggregate && isDataElementVar && (
                          <Text
                            type="secondary"
                            style={{
                              display: 'block',
                              fontSize: 11,
                              marginTop: 6,
                            }}
                          >
                            {t(
                              'This data element uses the default category combo — no disaggregation is available.',
                            )}
                          </Text>
                        )}
                      </div>
                    );
                  })}
                  {group.mappings.length > 6 ? (
                    <Text type="secondary">
                      {t('+%s more selected for this connection', group.mappings.length - 6)}
                    </Text>
                  ) : null}
                  <Button
                    block
                    size="small"
                    onClick={() => clearInstanceSelections(group.instanceId)}
                  >
                    {t('Clear %s', group.instanceName)}
                  </Button>
                </Space>
              </SelectionCard>
            ))}
          </SelectionList>
        )}

        <Divider style={{ margin: '16px 0 12px' }} />
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <Switch
              size="small"
              checked={wizardState.includeDisaggregationDimension ?? false}
              onChange={checked =>
                updateState({ includeDisaggregationDimension: checked })
              }
            />
            <span style={{ fontWeight: 500, fontSize: 13 }}>
              {t('Include disaggregation dimension')}
            </span>
          </div>
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-color-secondary, #888)',
              display: 'block',
            }}
          >
            {t(
              'Exposes a "Disaggregation" column (Category Option Combo) so charts can group and filter by sex, age group, or any other DHIS2 disaggregation.',
            )}
          </span>
        </div>
      </SidePanel>
    </StepContainer>
  );
}
