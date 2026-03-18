/**
 * StepLevelMapping — wizard step for configuring org-unit hierarchy level
 * mappings across multiple DHIS2 instances.
 *
 * When enabled, the user defines how raw hierarchy levels from each DHIS2
 * instance map to a set of "merged" levels in the serving dataset.  Only
 * mapped levels are included in the final column list; levels whose
 * instance_levels entry is null/empty for a given instance are simply
 * omitted for that instance during query building.
 */

import { useCallback, useMemo } from 'react';
import { styled, t } from '@superset-ui/core';
import {
  Button,
  Select,
  Switch,
  Typography,
  Input,
  Space,
  Alert,
} from '@superset-ui/core/components';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

import type { DHIS2WizardState, LevelMappingConfig, LevelMappingRow } from '../index';

const { Title, Paragraph, Text } = Typography;

// ── Styled shells ─────────────────────────────────────────────────────────────

const StepContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 1100px;
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
  width: 48px;
  flex-shrink: 0;
  text-align: center;
`;

const LabelCell = styled.div`
  width: 160px;
  flex-shrink: 0;
`;

const InstanceCell = styled.div`
  flex: 1;
  min-width: 120px;
`;

const DeleteCell = styled.div`
  width: 36px;
  flex-shrink: 0;
`;

const EmptyState = styled.div`
  ${({ theme }) => `
    text-align: center;
    padding: ${theme.sizeUnit * 8}px;
    color: ${theme.colorTextTertiary};
  `}
`;

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

// ── Level options (1-10 + none) ───────────────────────────────────────────────

function makeLevelOptions() {
  return [
    { value: '', label: t('— none —') },
    ...Array.from({ length: 10 }, (_, i) => ({
      value: String(i + 1),
      label: t('Level %s', i + 1),
    })),
  ];
}

const LEVEL_OPTIONS = makeLevelOptions();

// ── Component ─────────────────────────────────────────────────────────────────

export interface StepLevelMappingProps {
  wizardState: DHIS2WizardState;
  updateState: (updates: Partial<DHIS2WizardState>) => void;
}

export default function StepLevelMapping({
  wizardState,
  updateState,
}: StepLevelMappingProps) {
  const { levelMapping, selectedInstanceIds, variableMappings } = wizardState;

  // Build (id → name) map for display
  const instances = useMemo(() => {
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
  }, [variableMappings, selectedInstanceIds]);

  const enabled = levelMapping?.enabled ?? false;
  const rows: LevelMappingRow[] = levelMapping?.rows ?? [];

  const setMapping = useCallback(
    (next: LevelMappingConfig) => updateState({ levelMapping: next }),
    [updateState],
  );

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (checked && rows.length === 0) {
        // Auto-generate 3 default rows
        const defaultRows: LevelMappingRow[] = [1, 2, 3].map(n => ({
          merged_level: n,
          label: t('Level %s', n),
          instance_levels: Object.fromEntries(
            instances.map(({ id }) => [String(id), n]),
          ),
        }));
        setMapping({ enabled: true, rows: defaultRows });
      } else {
        setMapping({ enabled: checked, rows });
      }
    },
    [rows, instances, setMapping],
  );

  const handleAddRow = useCallback(() => {
    const nextLevel = rows.length > 0
      ? Math.max(...rows.map(r => r.merged_level)) + 1
      : 1;
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
      const next = rows.filter((_, i) => i !== idx);
      setMapping({ enabled: true, rows: next });
    },
    [rows, setMapping],
  );

  const handleLabelChange = useCallback(
    (idx: number, label: string) => {
      const next = rows.map((r, i) => (i === idx ? { ...r, label } : r));
      setMapping({ enabled: true, rows: next });
    },
    [rows, setMapping],
  );

  const handleInstanceLevelChange = useCallback(
    (rowIdx: number, instanceId: number, rawLevel: string) => {
      const next = rows.map((r, i) => {
        if (i !== rowIdx) return r;
        return {
          ...r,
          instance_levels: {
            ...r.instance_levels,
            [String(instanceId)]: rawLevel === '' ? null : Number(rawLevel),
          },
        };
      });
      setMapping({ enabled: true, rows: next });
    },
    [rows, setMapping],
  );

  return (
    <StepContainer>
      <div>
        <Title level={4}>{t('Org Unit Hierarchy Level Mapping')}</Title>
        <Paragraph style={{ marginBottom: 8 }}>
          {t(
            'By default, hierarchy levels are merged automatically across instances ' +
              '(the highest level present in any instance is used). ' +
              'Enable custom mapping to explicitly match levels across instances ' +
              'and to rename merged level columns.',
          )}
        </Paragraph>
        {instances.length < 2 && (
          <Alert
            type="info"
            style={{ marginBottom: 16 }}
            message={t(
              'Level mapping is most useful when multiple DHIS2 instances with ' +
                'different hierarchy depths are combined. You have only one instance ' +
                'selected — auto-merge is sufficient in most cases.',
            )}
            showIcon
          />
        )}
      </div>

      <ToggleRow>
        <Switch checked={enabled} onChange={handleToggle} />
        <Text strong>{t('Enable custom level mapping')}</Text>
        {enabled && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              'Only levels defined in this table will appear as hierarchy columns.',
            )}
          </Text>
        )}
      </ToggleRow>

      {enabled && (
        <TableCard>
          {/* Header */}
          <TableHeader>
            <LevelNumCell>{t('#')}</LevelNumCell>
            <LabelCell>{t('Column Label')}</LabelCell>
            {instances.map(inst => (
              <InstanceCell key={inst.id}>
                <span title={inst.name}>
                  {inst.name.length > 18
                    ? `${inst.name.slice(0, 16)}…`
                    : inst.name}
                </span>
                <div style={{ fontWeight: 400, opacity: 0.6, fontSize: 10 }}>
                  {t('raw level')}
                </div>
              </InstanceCell>
            ))}
            <DeleteCell />
          </TableHeader>

          {/* Rows */}
          {rows.length === 0 ? (
            <EmptyState>
              {t('No levels defined — click "Add Level" to start.')}
            </EmptyState>
          ) : (
            rows.map((row, idx) => (
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
                  return (
                    <InstanceCell key={inst.id}>
                      <Select
                        css={{ width: '100%' }}
                        value={raw == null ? '' : String(raw)}
                        options={LEVEL_OPTIONS}
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
            ))
          )}
        </TableCard>
      )}

      {enabled && (
        <Space>
          <Button icon={<PlusOutlined />} onClick={handleAddRow}>
            {t('Add Level')}
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              'Set a raw level to "— none —" to exclude that instance from a merged level.',
            )}
          </Text>
        </Space>
      )}
    </StepContainer>
  );
}
