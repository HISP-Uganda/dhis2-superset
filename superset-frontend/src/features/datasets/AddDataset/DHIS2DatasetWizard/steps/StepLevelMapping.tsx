/**
 * StepLevelMapping — repository org-unit level mapping table, embedded inside
 * the Organisation Units tab when source mode is "repository".
 *
 * Always shown (no toggle). Auto-initialises with 8 Uganda hierarchy levels.
 * Each instance column shows only that instance's actual OU levels.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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

// ── Pre-defined Uganda repository levels ────────────────────────────────────

const REPOSITORY_LEVEL_DEFAULTS: { level: number; label: string }[] = [
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

function getInstanceLevels(
  orgUnitLevels: OrgUnitLevel[],
  instanceId: number,
): OrgUnitLevel[] {
  if (orgUnitLevels.length === 0) return [];
  const hasPerInstanceTracking = orgUnitLevels.some(
    l => l.sourceInstanceIds && l.sourceInstanceIds.length > 0,
  );
  if (!hasPerInstanceTracking) return orgUnitLevels;
  return orgUnitLevels.filter(
    l =>
      !l.sourceInstanceIds ||
      l.sourceInstanceIds.length === 0 ||
      l.sourceInstanceIds.includes(instanceId),
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

  const buildDefaultRows = useCallback(
    (): LevelMappingRow[] =>
      REPOSITORY_LEVEL_DEFAULTS.map(({ level, label }) => ({
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
      })),
    [instances, instanceAvailableLevels],
  );

  // Auto-initialise with 8 default rows whenever instances become available
  // and no rows have been configured yet.
  useEffect(() => {
    if (instances.length > 0 && rows.length === 0) {
      setMapping({ enabled: true, rows: buildDefaultRows() });
    }
  }, [instances.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (instanceId === null || orgUnitLevels.length === 0) return;
      const levelNameMap = new Map<number, string>();
      getInstanceLevels(orgUnitLevels, instanceId).forEach(l =>
        levelNameMap.set(
          l.level,
          (l.instanceLevelNames && l.instanceLevelNames[instanceId]) ||
            l.displayName,
        ),
      );
      if (levelNameMap.size === 0) return;
      setMapping({
        enabled: true,
        rows: rows.map(r => ({
          ...r,
          label: levelNameMap.get(r.merged_level) ?? r.label,
        })),
      });
    },
    [orgUnitLevels, rows, setMapping],
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
            allowClear
            data-test="dhis2-level-mapping-default-instance"
            placeholder={t('Select default instance')}
            value={defaultInstanceId ?? undefined}
            options={instanceOptions}
            onChange={(val: unknown) =>
              handleApplyDefaultInstance(val == null ? null : Number(val))
            }
            styles={{ root: { minWidth: 220 } }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('Auto-fills repository level labels from that instance\'s actual OU level names.')}
          </Text>
        </DefaultInstanceRow>
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
                    css={{ width: '100%' }}
                    value={raw == null ? '' : String(raw)}
                    options={options}
                    onChange={(val: unknown) =>
                      handleInstanceLevelChange(idx, inst.id, String(val ?? ''))
                    }
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
