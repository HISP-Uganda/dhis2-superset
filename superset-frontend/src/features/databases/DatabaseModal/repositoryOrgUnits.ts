import type {
  DatabaseRepositoryOrgUnitConfig,
  RepositoryDataScope,
  RepositoryLevelMappingConfig,
  RepositoryOrgUnitDetail,
  RepositoryOrgUnitLineage,
  RepositoryOrgUnitRecord,
  RepositoryReportingUnitApproach,
  RepositorySeparateInstanceConfig,
} from '../types';
import type { OrgUnit } from 'src/features/datasets/AddDataset/DHIS2DatasetWizard/steps/StepOrgUnits';

export type RepositoryMetadataMap = Record<number, OrgUnit[]>;

type ResolveRepositoryOrgUnitsParams = {
  approach: RepositoryReportingUnitApproach;
  dataScope: RepositoryDataScope;
  lowestDataLevelToUse?: number | null;
  primaryInstanceId?: number | null;
  sharedSelectedOrgUnits?: string[];
  sharedSelectedOrgUnitDetails?: RepositoryOrgUnitDetail[];
  sharedMetadata?: OrgUnit[];
  levelMapping?: RepositoryLevelMappingConfig | null;
  autoMerge?: DatabaseRepositoryOrgUnitConfig['auto_merge'];
  separateInstanceConfigs?: RepositorySeparateInstanceConfig[];
  separateMetadata?: RepositoryMetadataMap;
};

type CollapsedAncestor = {
  selectionKey: string;
  sourceOrgUnitId: string;
  displayName: string;
  level: number | null;
  path: string | null;
  mappedRepositoryLevel: number | null;
  sourceInstanceIds: number[];
};

function normalizeName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildLookup(units: OrgUnit[]): Map<string, OrgUnit> {
  return new Map(units.map(unit => [unit.selectionKey, unit] as const));
}

function buildChildrenMap(units: OrgUnit[]): Map<string, OrgUnit[]> {
  const children = new Map<string, OrgUnit[]>();
  units.forEach(unit => {
    if (!unit.parentId) {
      return;
    }
    const current = children.get(unit.parentId) || [];
    current.push(unit);
    children.set(unit.parentId, current);
  });
  return children;
}

function getScopeDepth(scope: RepositoryDataScope): number | null {
  switch (scope) {
    case 'children':
      return 1;
    case 'grandchildren':
      return 2;
    case 'all_levels':
      return null;
    default:
      return 0;
  }
}

function getAncestorKeys(selectionKey: string, lookup: Map<string, OrgUnit>): string[] {
  const keys: string[] = [];
  const visited = new Set<string>();
  let current = lookup.get(selectionKey);
  while (current?.parentId && !visited.has(current.parentId)) {
    keys.push(current.parentId);
    visited.add(current.parentId);
    current = lookup.get(current.parentId);
  }
  return keys;
}

export function pruneSelectedKeys(
  selectedKeys: string[],
  lookup: Map<string, OrgUnit>,
  scope: RepositoryDataScope,
): string[] {
  if (!['children', 'grandchildren', 'all_levels'].includes(scope)) {
    return Array.from(new Set(selectedKeys)).filter(key => lookup.has(key));
  }
  const maxDepth = getScopeDepth(scope);
  const uniqueKeys = Array.from(new Set(selectedKeys)).filter(key => lookup.has(key));
  const kept = new Set<string>();

  uniqueKeys
    .slice()
    .sort((left, right) => {
      const leftLevel = lookup.get(left)?.level ?? Number.MAX_SAFE_INTEGER;
      const rightLevel = lookup.get(right)?.level ?? Number.MAX_SAFE_INTEGER;
      return leftLevel - rightLevel;
    })
    .forEach(selectionKey => {
      const selectedAncestor = getAncestorKeys(selectionKey, lookup).find(key =>
        kept.has(key),
      );
      if (!selectedAncestor) {
        kept.add(selectionKey);
        return;
      }
      const unit = lookup.get(selectionKey);
      const ancestor = lookup.get(selectedAncestor);
      if (!unit || !ancestor) {
        return;
      }
      const depth =
        typeof ancestor.level === 'number' && typeof unit.level === 'number'
          ? unit.level - ancestor.level
          : null;
      if (maxDepth === null || depth === null || depth <= maxDepth) {
        return;
      }
    });

  return uniqueKeys.filter(key => kept.has(key));
}

function expandScopedUnits(
  units: OrgUnit[],
  selectedKeys: string[],
  scope: RepositoryDataScope,
  lowestDataLevelToUse?: number | null,
): OrgUnit[] {
  const lookup = buildLookup(units);
  const childrenMap = buildChildrenMap(units);
  const prunedSelectedKeys = pruneSelectedKeys(selectedKeys, lookup, scope);
  const seen = new Set<string>();
  const resolved: OrgUnit[] = [];

  const includeUnit = (unit: OrgUnit | undefined) => {
    if (!unit || seen.has(unit.selectionKey)) {
      return;
    }
    if (
      lowestDataLevelToUse != null &&
      typeof unit.level === 'number' &&
      unit.level > lowestDataLevelToUse
    ) {
      return;
    }
    seen.add(unit.selectionKey);
    resolved.push(unit);
  };

  prunedSelectedKeys.forEach(key => includeUnit(lookup.get(key)));

  if (scope === 'ancestors') {
    prunedSelectedKeys.forEach(key => {
      getAncestorKeys(key, lookup)
        .slice(0, 2)
        .forEach(ancestorKey => includeUnit(lookup.get(ancestorKey)));
    });
    return resolved.sort(
      (left, right) =>
        (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER),
    );
  }

  const maxDepth = getScopeDepth(scope);
  if (maxDepth === 0) {
    return resolved.sort(
      (left, right) =>
        (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER),
    );
  }

  const queue = prunedSelectedKeys.map(key => ({
    key,
    depth: 0,
  }));
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (maxDepth !== null && current.depth >= maxDepth) {
      continue;
    }
    (childrenMap.get(current.key) || []).forEach(child => {
      includeUnit(child);
      queue.push({ key: child.selectionKey, depth: current.depth + 1 });
    });
  }

  return resolved.sort(
    (left, right) =>
      (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER),
  );
}

function getRepositoryLevelForInstance(
  instanceId: number,
  sourceLevel: number | undefined,
  levelMapping?: RepositoryLevelMappingConfig | null,
): number | null | undefined {
  if (!levelMapping?.enabled || sourceLevel == null) {
    return sourceLevel;
  }
  const match = levelMapping.rows.find(
    row => row.instance_levels[String(instanceId)] === sourceLevel,
  );
  return match?.merged_level ?? null;
}

function buildInstanceCodes(instanceIds: number[]): Record<number, string> {
  return Object.fromEntries(
    Array.from(new Set(instanceIds))
      .sort((left, right) => left - right)
      .map((instanceId, index) => [
        instanceId,
        index < 26 ? String.fromCharCode('A'.charCodeAt(0) + index) : `I${instanceId}`,
      ]),
  );
}

function buildLineage(
  unit: OrgUnit,
  instanceCodes: Record<number, string>,
  sourceInstanceIds: number[],
  strategy: RepositoryReportingUnitApproach,
  collapseContext?: {
    collapsedAncestors?: CollapsedAncestor[];
    effectiveParentSelectionKey?: string | null;
    effectiveParentSourceOrgUnitUid?: string | null;
    repositoryLevel?: number | null;
    parentRepositoryKey?: string | null;
  },
): RepositoryOrgUnitLineage[] {
  return sourceInstanceIds.map(instanceId => ({
    instance_id: instanceId,
    source_instance_role: strategy === 'separate' ? 'separate' : undefined,
    source_instance_code: instanceCodes[instanceId],
    source_org_unit_uid: unit.sourceOrgUnitId,
    source_org_unit_name: unit.displayName,
    source_parent_uid: unit.parentId || null,
    source_path: unit.path || null,
    source_level: unit.level ?? null,
    provenance: {
      selectionKey: unit.selectionKey,
      repositoryLevel:
        collapseContext?.repositoryLevel ?? unit.repositoryLevel ?? null,
      repositoryLevelName: unit.repositoryLevelName ?? null,
      parentRepositoryKey: collapseContext?.parentRepositoryKey ?? null,
      effectiveParentSelectionKey:
        collapseContext?.effectiveParentSelectionKey ?? null,
      effectiveParentSourceOrgUnitUid:
        collapseContext?.effectiveParentSourceOrgUnitUid ?? null,
      collapsedAncestorKeys:
        collapseContext?.collapsedAncestors?.map(item => item.selectionKey) || [],
      collapsedAncestors: collapseContext?.collapsedAncestors || [],
    },
  }));
}

function buildRepositoryPathContext(
  unit: OrgUnit,
  lookup: Map<string, OrgUnit>,
  levelMapping?: RepositoryLevelMappingConfig | null,
): {
  isIncluded: boolean;
  canonicalPath: string[];
  parentRepositoryKey: string | null;
  repositoryLevel: number | null;
  effectiveParentSelectionKey: string | null;
  effectiveParentSourceOrgUnitUid: string | null;
  collapsedAncestors: CollapsedAncestor[];
} {
  const pathKeys = [...getAncestorKeys(unit.selectionKey, lookup).reverse(), unit.selectionKey];
  const collapsedAncestors: CollapsedAncestor[] = [];
  const includedPath = pathKeys
    .map(key => lookup.get(key))
    .filter((item): item is OrgUnit => !!item)
    .flatMap(item => {
      const sourceInstanceId = item.sourceInstanceIds[0];
      const mappedLevel =
        sourceInstanceId != null
          ? getRepositoryLevelForInstance(sourceInstanceId, item.level, levelMapping)
          : item.level;
      if (mappedLevel == null) {
        if (item.selectionKey !== unit.selectionKey) {
          collapsedAncestors.push({
            selectionKey: item.selectionKey,
            sourceOrgUnitId: item.sourceOrgUnitId,
            displayName: item.displayName,
            level: item.level ?? null,
            path: item.path || null,
            mappedRepositoryLevel: null,
            sourceInstanceIds: item.sourceInstanceIds || [],
          });
        }
        return [];
      }
      return [
        {
          unit: item,
          mappedLevel,
          key: `${mappedLevel}:${normalizeName(item.displayName)}`,
        },
      ];
    });

  const currentSegment = includedPath.find(
    item => item.unit.selectionKey === unit.selectionKey,
  );
  const parentSegment =
    currentSegment == null
      ? null
      : includedPath[includedPath.findIndex(item => item.unit.selectionKey === unit.selectionKey) - 1] ||
        null;

  return {
    isIncluded: currentSegment != null,
    canonicalPath: includedPath.map(item => item.key),
    parentRepositoryKey:
      currentSegment != null && parentSegment
        ? includedPath
            .slice(0, includedPath.findIndex(item => item.unit.selectionKey === unit.selectionKey))
            .map(item => item.key)
            .join('/')
        : null,
    repositoryLevel: currentSegment?.mappedLevel ?? null,
    effectiveParentSelectionKey: parentSegment?.unit.selectionKey ?? null,
    effectiveParentSourceOrgUnitUid: parentSegment?.unit.sourceOrgUnitId ?? null,
    collapsedAncestors,
  };
}

function mergeCollapsedAncestors(
  current: unknown,
  incoming: CollapsedAncestor[],
): CollapsedAncestor[] {
  const existing = Array.isArray(current)
    ? current.filter((item): item is CollapsedAncestor => !!item && typeof item === 'object')
    : [];
  const merged = new Map<string, CollapsedAncestor>();
  [...existing, ...incoming].forEach(item => {
    const key = `${item.selectionKey}:${item.sourceOrgUnitId}:${item.level ?? 'null'}`;
    if (!merged.has(key)) {
      merged.set(key, item);
    }
  });
  return Array.from(merged.values());
}

function buildMergedRecords(
  units: OrgUnit[],
  strategy: Extract<RepositoryReportingUnitApproach, 'map_merge' | 'auto_merge'>,
  levelMapping?: RepositoryLevelMappingConfig | null,
  autoMerge?: DatabaseRepositoryOrgUnitConfig['auto_merge'],
): RepositoryOrgUnitRecord[] {
  const lookup = buildLookup(units);
  const instanceCodes = buildInstanceCodes(
    units.flatMap(unit => unit.sourceInstanceIds || []),
  );
  const grouped = new Map<string, RepositoryOrgUnitRecord>();

  units.forEach(unit => {
    const pathContext = buildRepositoryPathContext(unit, lookup, levelMapping);
    if (!pathContext.isIncluded || pathContext.canonicalPath.length === 0) {
      return;
    }
    const repositoryKey = pathContext.canonicalPath.join('/');
    const sourceInstanceIds =
      unit.sourceInstanceIds && unit.sourceInstanceIds.length > 0
        ? unit.sourceInstanceIds
        : [0];
    const lineages = buildLineage(
      unit,
      instanceCodes,
      sourceInstanceIds,
      strategy,
      {
        collapsedAncestors: pathContext.collapsedAncestors,
        effectiveParentSelectionKey: pathContext.effectiveParentSelectionKey,
        effectiveParentSourceOrgUnitUid:
          pathContext.effectiveParentSourceOrgUnitUid,
        repositoryLevel: pathContext.repositoryLevel,
        parentRepositoryKey: pathContext.parentRepositoryKey,
      },
    );
    const current = grouped.get(repositoryKey);
    if (!current) {
      grouped.set(repositoryKey, {
        repository_key: repositoryKey,
        display_name: unit.displayName,
        parent_repository_key: pathContext.parentRepositoryKey,
        level: pathContext.repositoryLevel,
        hierarchy_path: repositoryKey,
        selection_key: unit.selectionKey,
        strategy,
        source_lineage_label: lineages
          .map(lineage => lineage.source_instance_code)
          .filter((value): value is string => !!value)
          .sort()
          .join(','),
        is_conflicted: false,
        is_unmatched: sourceInstanceIds.length === 1,
        provenance: {
          sourceSelectionKeys: [unit.selectionKey],
          autoMerged: strategy === 'auto_merge',
          hasCollapsedAncestors: pathContext.collapsedAncestors.length > 0,
          collapsedAncestorKeys: pathContext.collapsedAncestors.map(
            item => item.selectionKey,
          ),
          collapsedAncestors: pathContext.collapsedAncestors,
        },
        lineage: lineages,
      });
      return;
    }

    const existingSourceKeys = new Set(
      current.lineage.map(
        lineage => `${lineage.instance_id}:${lineage.source_org_unit_uid}`,
      ),
    );
    lineages.forEach(lineage => {
      const lineageKey = `${lineage.instance_id}:${lineage.source_org_unit_uid}`;
      if (!existingSourceKeys.has(lineageKey)) {
        current.lineage.push(lineage);
      }
    });
    const distinctNames = new Set([
      current.display_name,
      unit.displayName,
      ...current.lineage.map(lineage => lineage.source_org_unit_name || ''),
    ]);
    current.is_conflicted = distinctNames.size > 2;
    current.is_unmatched = new Set(current.lineage.map(lineage => lineage.instance_id)).size === 1;
    current.source_lineage_label = current.lineage
      .map(lineage => lineage.source_instance_code)
      .filter((value): value is string => !!value)
      .sort()
      .filter((value, index, array) => array.indexOf(value) === index)
      .join(',');
    current.provenance = {
      ...(current.provenance || {}),
      sourceSelectionKeys: [
        ...new Set([
          ...((current.provenance?.sourceSelectionKeys as string[] | undefined) || []),
          unit.selectionKey,
        ]),
      ],
      autoMerged: strategy === 'auto_merge',
      hasCollapsedAncestors:
        Boolean((current.provenance as Record<string, unknown> | undefined)?.hasCollapsedAncestors) ||
        pathContext.collapsedAncestors.length > 0,
      collapsedAncestors: mergeCollapsedAncestors(
        (current.provenance as Record<string, unknown> | undefined)?.collapsedAncestors,
        pathContext.collapsedAncestors,
      ),
      collapsedAncestorKeys: Array.from(
        new Set([
          ...(((current.provenance as Record<string, unknown> | undefined)?.collapsedAncestorKeys as
            | string[]
            | undefined) || []),
          ...pathContext.collapsedAncestors.map(item => item.selectionKey),
        ]),
      ),
    };
  });

  let records = Array.from(grouped.values()).sort(
    (left, right) =>
      (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER),
  );

  if (autoMerge?.fallback_behavior === 'drop_unmatched') {
    records = records.filter(record => !record.is_unmatched);
  }
  if (autoMerge?.unresolved_conflicts === 'drop') {
    records = records.filter(record => !record.is_conflicted);
  }

  return records;
}

function buildPrimaryOrSeparateRecords(
  units: OrgUnit[],
  strategy: Extract<RepositoryReportingUnitApproach, 'primary_instance' | 'separate'>,
  instancePrefix?: string,
): RepositoryOrgUnitRecord[] {
  const instanceCodes = buildInstanceCodes(
    units.flatMap(unit => unit.sourceInstanceIds || []),
  );
  const includedKeys = new Set(units.map(unit => unit.selectionKey));

  return units.map(unit => {
    const firstInstanceId = unit.sourceInstanceIds?.[0];
    const keyPrefix =
      strategy === 'separate'
        ? `${instancePrefix || instanceCodes[firstInstanceId || 0] || 'A'}::`
        : '';
    const repositoryKey = `${keyPrefix}${unit.sourceOrgUnitId}`;
    const parentRepositoryKey =
      unit.parentId && includedKeys.has(unit.parentId)
        ? `${keyPrefix}${units.find(candidate => candidate.selectionKey === unit.parentId)?.sourceOrgUnitId || unit.parentId}`
        : null;
    const lineages = buildLineage(
      unit,
      instanceCodes,
      unit.sourceInstanceIds && unit.sourceInstanceIds.length > 0
        ? unit.sourceInstanceIds
        : [0],
      strategy,
    );
    return {
      repository_key: repositoryKey,
      display_name: unit.displayName,
      parent_repository_key: parentRepositoryKey,
      level: unit.level ?? null,
      hierarchy_path: unit.path || repositoryKey,
      selection_key: unit.selectionKey,
      strategy,
      source_lineage_label: lineages
        .map(lineage => lineage.source_instance_code)
        .filter((value): value is string => !!value)
        .sort()
        .join(','),
      is_conflicted: false,
      is_unmatched: strategy === 'separate',
      provenance: {
        sourceSelectionKeys: [unit.selectionKey],
      },
      lineage: lineages,
    };
  });
}

export function resolveRepositoryOrgUnits({
  approach,
  dataScope,
  lowestDataLevelToUse,
  primaryInstanceId,
  sharedSelectedOrgUnits = [],
  sharedMetadata = [],
  levelMapping,
  autoMerge,
  separateInstanceConfigs = [],
  separateMetadata = {},
}: ResolveRepositoryOrgUnitsParams): RepositoryOrgUnitRecord[] {
  if (approach === 'separate') {
    return separateInstanceConfigs.flatMap(config => {
      const metadata = separateMetadata[config.instance_id] || [];
      const units = expandScopedUnits(
        metadata,
        config.selected_org_units,
        config.data_scope,
        config.lowest_data_level_to_use ?? lowestDataLevelToUse,
      );
      return buildPrimaryOrSeparateRecords(
        units,
        'separate',
        `I${config.instance_id}`,
      );
    });
  }

  if (approach === 'primary_instance') {
    const filteredMetadata =
      primaryInstanceId == null
        ? sharedMetadata
        : sharedMetadata.filter(unit =>
            (unit.sourceInstanceIds || []).includes(primaryInstanceId),
          );
    const units = expandScopedUnits(
      filteredMetadata,
      sharedSelectedOrgUnits,
      dataScope,
      lowestDataLevelToUse,
    );
    return buildPrimaryOrSeparateRecords(units, 'primary_instance');
  }

  const effectiveSharedScope =
    approach === 'map_merge' ? 'all_levels' : dataScope;
  const sharedUnits = expandScopedUnits(
    sharedMetadata,
    sharedSelectedOrgUnits,
    effectiveSharedScope,
    lowestDataLevelToUse,
  );
  return buildMergedRecords(
    sharedUnits,
    approach,
    levelMapping,
    autoMerge,
  );
}
