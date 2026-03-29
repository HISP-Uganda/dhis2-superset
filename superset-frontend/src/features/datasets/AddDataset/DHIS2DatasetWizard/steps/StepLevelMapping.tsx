/**
 * StepLevelMapping — repository org-unit level mapping table, embedded inside
 * the Organisation Units tab when source mode is "repository".
 *
 * Always shown (no toggle). The selected template instance defines the initial
 * repository rows and labels, so users start from a real source hierarchy and
 * then adjust or trim the mapping as needed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { styled, t } from '@superset-ui/core';
import {
  Button,
  Select,
  Typography,
  Input,
  Space,
} from '@superset-ui/core/components';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

import type { DHIS2WizardState, LevelMappingConfig, LevelMappingRow } from '../index';

const { Text } = Typography;

const SELECT_DROPDOWN_STYLE = {
  maxHeight: 320,
  overflow: 'auto' as const,
};

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface OrgUnitLevel {
  level: number;
  displayName: string;
  name?: string;
  sourceInstanceIds?: number[];
  /** Per-instance level name: instanceId → that instance's own name for this level */
  instanceLevelNames?: Record<number, string>;
}

// ── Styled shells ─────────────────────────────────────────────────────────────

const SectionContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const TableCard = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    overflow: hidden;
  `}
`;

const TableHeader = styled.div`
  ${({ theme }) => `
    display: flex;
    background: ${theme.colorBgLayout};
    border-bottom: 1px solid ${theme.colorBorder};
    padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 3}px;
    font-weight: 600;
    font-size: 12px;
    color: ${theme.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `}
`;

const TableRow = styled.div<{ $isOdd: boolean }>`
  ${({ theme, $isOdd }) => `
    display: flex;
    align-items: center;
    padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 3}px;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    background: ${$isOdd ? theme.colorBgContainer : theme.colorBgElevated};
    gap: ${theme.sizeUnit * 2}px;
    &:last-child {
      border-bottom: none;
    }
  `}
`;

const LevelNumCell = styled.div`
  width: 36px;
  flex-shrink: 0;
  text-align: center;
`;

const LabelCell = styled.div`
  width: 200px;
  flex-shrink: 0;
`;

const InstanceCell = styled.div`
  flex: 1;
  min-width: 140px;
`;

const DeleteCell = styled.div`
  width: 36px;
  flex-shrink: 0;
`;

const DefaultInstanceRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

// ── Legacy static defaults (kept only to auto-upgrade old generated rows) ───

const LEGACY_REPOSITORY_LEVEL_DEFAULTS: { level: number; label: string }[] = [
  { level: 1, label: 'National' },
  { level: 2, label: 'Region' },
  { level: 3, label: 'District/City' },
  { level: 4, label: 'DLG/Municipality/City Council' },
  { level: 5, label: 'Sub County/Town Council/Division' },
  { level: 6, label: 'Health Facility' },
  { level: 7, label: 'Ward/Department' },
  { level: 8, label: 'Schools' },
];

// ── Level option helpers ─────────────────────────────────────────────────────

function makeGenericLevelOptions() {
  return [
    { value: '', label: t('— none —') },
    ...Array.from({ length: 10 }, (_, i) => ({
      value: String(i + 1),
      label: t('Level %s', i + 1),
    })),
  ];
}

function sortOrgUnitLevelsAscending(levels: OrgUnitLevel[]): OrgUnitLevel[] {
  return levels.slice().sort((left, right) => left.level - right.level);
}

function getInstanceLevels(
  orgUnitLevels: OrgUnitLevel[],
  instanceId: number,
): OrgUnitLevel[] {
  if (orgUnitLevels.length === 0) return [];
  const hasPerInstanceTracking = orgUnitLevels.some(
    l => l.sourceInstanceIds && l.sourceInstanceIds.length > 0,
  );
  if (!hasPerInstanceTracking) return sortOrgUnitLevelsAscending(orgUnitLevels);
  return sortOrgUnitLevelsAscending(
    orgUnitLevels.filter(
      l =>
        !l.sourceInstanceIds ||
        l.sourceInstanceIds.length === 0 ||
        l.sourceInstanceIds.includes(instanceId),
    ),
  );
}

function makeInstanceLevelOptions(
  orgUnitLevels: OrgUnitLevel[],
  instanceId: number,
): { value: string; label: string }[] {
  const relevant = getInstanceLevels(orgUnitLevels, instanceId);
  if (relevant.length === 0) {
    return makeGenericLevelOptions();
  }
  return [
    { value: '', label: t('— none —') },
    ...relevant.map(l => {
      const name =
        (l.instanceLevelNames && l.instanceLevelNames[instanceId]) ||
        l.displayName;
      return {
        value: String(l.level),
        label: `${l.level}. ${name}`,
      };
    }),
  ];
}

function buildRowsFromTemplateInstance(
  templateInstanceId: number,
  orgUnitLevels: OrgUnitLevel[],
  instances: Array<{ id: number; name: string }>,
  instanceAvailableLevels: Map<number, Set<number>>,
): LevelMappingRow[] {
  return getInstanceLevels(orgUnitLevels, templateInstanceId)
    .slice()
    .sort((left, right) => left.level - right.level)
    .map(levelDef => ({
      merged_level: levelDef.level,
      label:
        (levelDef.instanceLevelNames &&
          levelDef.instanceLevelNames[templateInstanceId]) ||
        levelDef.displayName ||
        t('Level %s', levelDef.level),
      instance_levels: Object.fromEntries(
        instances.map(({ id }) => [
          String(id),
          instanceAvailableLevels.get(id)?.has(levelDef.level)
            ? levelDef.level
            : null,
        ]),
      ),
    }));
}

function buildLegacyDefaultRows(
  instances: Array<{ id: number; name: string }>,
  instanceAvailableLevels: Map<number, Set<number>>,
): LevelMappingRow[] {
  return LEGACY_REPOSITORY_LEVEL_DEFAULTS.map(({ level, label }) => ({
    merged_level: level,
    label,
    instance_levels: Object.fromEntries(
      instances.map(({ id }) => {
        const available = instanceAvailableLevels.get(id);
        const value =
          !available || available.size === 0 || available.has(level)
            ? level
            : null;
        return [String(id), value];
      }),
    ),
  }));
}

function areMappingRowsEqual(
  left: LevelMappingRow[],
  right: LevelMappingRow[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface StepLevelMappingProps {
  wizardState: DHIS2WizardState;
  updateState: (updates: Partial<DHIS2WizardState>) => void;
  orgUnitLevels?: OrgUnitLevel[];
  instances?: { id: number; name: string }[];
}

export default function StepLevelMapping({
  wizardState,
  updateState,
  orgUnitLevels = [],
  instances: instancesProp,
}: StepLevelMappingProps) {
  const { levelMapping, selectedInstanceIds, variableMappings } = wizardState;
  const [defaultInstanceId, setDefaultInstanceId] = useState<number | null>(null);
  const hasAutoInitializedRows = useRef(false);

  const instances = useMemo(() => {
    if (instancesProp && instancesProp.length > 0) return instancesProp;
    const seen = new Map<number, string>();
    for (const m of variableMappings) {
      if (m.instanceId && !seen.has(m.instanceId)) {
        seen.set(m.instanceId, m.instanceName || `Instance ${m.instanceId}`);
      }
    }
    for (const id of selectedInstanceIds) {
      if (!seen.has(id)) seen.set(id, `Instance ${id}`);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [instancesProp, variableMappings, selectedInstanceIds]);

  const rows: LevelMappingRow[] = levelMapping?.rows ?? [];

  const setMapping = useCallback(
    (next: LevelMappingConfig) => updateState({ levelMapping: next }),
    [updateState],
  );

  // Build per-instance available level sets for smart auto-population
  const instanceAvailableLevels = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const inst of instances) {
      const levels = getInstanceLevels(orgUnitLevels, inst.id);
      map.set(inst.id, new Set(levels.map(l => l.level)));
    }
    return map;
  }, [instances, orgUnitLevels]);

  const legacyDefaultRows = useMemo(
    () => buildLegacyDefaultRows(instances, instanceAvailableLevels),
    [instances, instanceAvailableLevels],
  );

  const effectiveTemplateInstanceId = useMemo(() => {
    if (defaultInstanceId != null) {
      return defaultInstanceId;
    }
    return rows.length === 0 && instances.length > 0 ? instances[0].id : null;
  }, [defaultInstanceId, instances, rows.length]);

  const templateRows = useMemo(
    () =>
      effectiveTemplateInstanceId == null
        ? []
        : buildRowsFromTemplateInstance(
            effectiveTemplateInstanceId,
            orgUnitLevels,
            instances,
            instanceAvailableLevels,
          ),
    [
      effectiveTemplateInstanceId,
      orgUnitLevels,
      instances,
      instanceAvailableLevels,
    ],
  );

  // Auto-initialise from the selected template instance once metadata is
  // available. Also upgrades the old static default rows when they are still
  // untouched generated placeholders.
  useEffect(() => {
    if (
      effectiveTemplateInstanceId == null ||
      instances.length === 0 ||
      templateRows.length === 0
    ) {
      return;
    }

    if (rows.length === 0 && !hasAutoInitializedRows.current) {
      hasAutoInitializedRows.current = true;
      setDefaultInstanceId(effectiveTemplateInstanceId);
      setMapping({ enabled: true, rows: templateRows });
      return;
    }

    if (
      !hasAutoInitializedRows.current &&
      areMappingRowsEqual(rows, legacyDefaultRows) &&
      !areMappingRowsEqual(rows, templateRows)
    ) {
      hasAutoInitializedRows.current = true;
      setDefaultInstanceId(effectiveTemplateInstanceId);
      setMapping({ enabled: true, rows: templateRows });
      return;
    }

    if (rows.length > 0) {
      hasAutoInitializedRows.current = true;
    }
  }, [
    effectiveTemplateInstanceId,
    instances.length,
    legacyDefaultRows,
    rows,
    setMapping,
    templateRows,
  ]);

  const handleAddRow = useCallback(() => {
    const nextLevel =
      rows.length > 0 ? Math.max(...rows.map(r => r.merged_level)) + 1 : 1;
    const newRow: LevelMappingRow = {
      merged_level: nextLevel,
      label: t('Level %s', nextLevel),
      instance_levels: Object.fromEntries(
        instances.map(({ id }) => [String(id), null]),
      ),
    };
    setMapping({ enabled: true, rows: [...rows, newRow] });
  }, [rows, instances, setMapping]);

  const handleRemoveRow = useCallback(
    (idx: number) => {
      setMapping({ enabled: true, rows: rows.filter((_, i) => i !== idx) });
    },
    [rows, setMapping],
  );

  const handleLabelChange = useCallback(
    (idx: number, label: string) => {
      setMapping({
        enabled: true,
        rows: rows.map((r, i) => (i === idx ? { ...r, label } : r)),
      });
    },
    [rows, setMapping],
  );

  const handleInstanceLevelChange = useCallback(
    (rowIdx: number, instanceId: number, rawLevel: string) => {
      setMapping({
        enabled: true,
        rows: rows.map((r, i) => {
          if (i !== rowIdx) return r;
          return {
            ...r,
            instance_levels: {
              ...r.instance_levels,
              [String(instanceId)]: rawLevel === '' ? null : Number(rawLevel),
            },
          };
        }),
      });
    },
    [rows, setMapping],
  );

  const handleApplyDefaultInstance = useCallback(
    (instanceId: number | null) => {
      setDefaultInstanceId(instanceId);
      if (instanceId == null) {
        return;
      }
      const nextRows = buildRowsFromTemplateInstance(
        instanceId,
        orgUnitLevels,
        instances,
        instanceAvailableLevels,
      );
      if (nextRows.length === 0) {
        return;
      }
      hasAutoInitializedRows.current = true;
      setMapping({
        enabled: true,
        rows: nextRows,
      });
    },
    [instanceAvailableLevels, instances, orgUnitLevels, setMapping],
  );

  const instanceOptions = useMemo(
    () => instances.map(inst => ({ value: inst.id, label: inst.name })),
    [instances],
  );

  return (
    <SectionContainer>
      {instances.length > 1 && (
        <DefaultInstanceRow data-test="dhis2-level-mapping-default-instance-row">
          <Text style={{ flexShrink: 0 }}>{t('Populate labels from:')}</Text>
          <Select
            virtual={false}
            allowClear
            data-test="dhis2-level-mapping-default-instance"
            placeholder={t('Select default instance')}
            value={defaultInstanceId ?? undefined}
            options={instanceOptions}
            onChange={(val: unknown) =>
              handleApplyDefaultInstance(val == null ? null : Number(val))
            }
            dropdownStyle={SELECT_DROPDOWN_STYLE}
            styles={{ root: { minWidth: 220 } }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              'Selecting an instance rebuilds the mapping table from that instance\'s org-unit levels and uses its level names as the default labels.',
            )}
          </Text>
        </DefaultInstanceRow>
      )}

      {defaultInstanceId != null && templateRows.length > 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t(
            'Loaded %s hierarchy level(s) from the selected instance. Remove any levels you do not need, then adjust mappings as required.',
            templateRows.length,
          )}
        </Text>
      ) : instances.length > 1 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t(
            'Choose a template instance above to generate the repository mapping table from its organisation-unit hierarchy.',
          )}
        </Text>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t(
            'Detected hierarchy levels will appear here once organisation-unit metadata finishes loading. You can still add rows manually if needed.',
          )}
        </Text>
      )}

      <TableCard data-test="dhis2-level-mapping">
        <TableHeader>
          <LevelNumCell>{t('#')}</LevelNumCell>
          <LabelCell>{t('Repo Level')}</LabelCell>
          {instances.map(inst => (
            <InstanceCell key={inst.id}>
              <span title={inst.name}>
                {inst.name.length > 22 ? `${inst.name.slice(0, 20)}…` : inst.name}
              </span>
              <div style={{ fontWeight: 400, opacity: 0.6, fontSize: 10 }}>
                {t('select level')}
              </div>
            </InstanceCell>
          ))}
          <DeleteCell />
        </TableHeader>

        {rows.map((row, idx) => (
          <TableRow key={row.merged_level} $isOdd={idx % 2 === 1}>
            <LevelNumCell>
              <Text strong>{row.merged_level}</Text>
            </LevelNumCell>

            <LabelCell>
              <Input
                size="small"
                value={row.label}
                onChange={e => handleLabelChange(idx, e.target.value)}
                placeholder={t('Label')}
              />
            </LabelCell>

            {instances.map(inst => {
              const raw = row.instance_levels[String(inst.id)];
              const options = makeInstanceLevelOptions(orgUnitLevels, inst.id);
              return (
                <InstanceCell key={inst.id}>
                  <Select
                    virtual={false}
                    css={{ width: '100%' }}
                    value={raw == null ? '' : String(raw)}
                    options={options}
                    onChange={(val: unknown) =>
                      handleInstanceLevelChange(idx, inst.id, String(val ?? ''))
                    }
                    dropdownStyle={SELECT_DROPDOWN_STYLE}
                  />
                </InstanceCell>
              );
            })}

            <DeleteCell>
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => handleRemoveRow(idx)}
                danger
              />
            </DeleteCell>
          </TableRow>
        ))}
      </TableCard>

      <Space>
        <Button icon={<PlusOutlined />} onClick={handleAddRow}>
          {t('Add Level')}
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('Set "— none —" to exclude an instance from a repository level.')}
        </Text>
      </Space>
    </SectionContainer>
  );
}
