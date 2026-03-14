import { useMemo } from 'react';
import { styled } from '@superset-ui/core';
import { Input, Tag, Alert, Tooltip } from 'antd';
import { Typography } from '@superset-ui/core/components';

const { Title, Paragraph, Text } = Typography;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VariableMapping {
  variableId: string;
  variableName: string;
  variableType: string;
  instanceId: number;
  instanceName: string;
  alias?: string;
}

export interface StepVariableMappingProps {
  variableMappings: VariableMapping[];
  onChange: (mappings: VariableMapping[]) => void;
}

// ─── Color cycling for instance badges ───────────────────────────────────────

const INSTANCE_COLORS = [
  'blue',
  'geekblue',
  'purple',
  'cyan',
  'teal',
  'magenta',
  'volcano',
  'orange',
] as const;

type TagColor = (typeof INSTANCE_COLORS)[number];

function getInstanceColor(instanceId: number, allIds: number[]): TagColor {
  const idx = allIds.indexOf(instanceId);
  return INSTANCE_COLORS[Math.abs(idx) % INSTANCE_COLORS.length];
}

// ─── Styled components ───────────────────────────────────────────────────────

const StepContainer = styled.div`
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const GroupSection = styled.div`
  ${({ theme }) => `
    background: ${theme.colorBgElevated};
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    overflow: hidden;
  `}
`;

const GroupHeader = styled.div`
  ${({ theme }) => `
    padding: 12px 16px;
    background: ${theme.colorBgContainer};
    border-bottom: 1px solid ${theme.colorBorder};
    display: flex;
    align-items: center;
    gap: 10px;
  `}
`;

const GroupTitle = styled.span`
  ${({ theme }) => `
    font-weight: 600;
    font-size: 13px;
    color: ${theme.colorText};
  `}
`;

const VariableTable = styled.div`
  display: flex;
  flex-direction: column;
`;

const VariableRow = styled.div<{ hasConflict: boolean }>`
  ${({ theme, hasConflict }) => `
    display: grid;
    grid-template-columns: 1fr 120px 180px 200px 40px;
    gap: 12px;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    background: ${hasConflict ? '#fffbe6' : 'transparent'};
    transition: background 0.15s ease;

    &:last-child {
      border-bottom: none;
    }

    &:hover {
      background: ${hasConflict ? '#fff7cc' : theme.colorBgContainer};
    }
  `}
`;

const TableHeader = styled.div`
  ${({ theme }) => `
    display: grid;
    grid-template-columns: 1fr 120px 180px 200px 40px;
    gap: 12px;
    padding: 8px 16px;
    font-size: 11px;
    font-weight: 600;
    color: ${theme.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid ${theme.colorBorder};
    background: ${theme.colorBgContainer};
  `}
`;

const VariableName = styled.div`
  ${({ theme }) => `
    font-size: 13px;
    font-weight: 500;
    color: ${theme.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `}
`;

const RemoveButton = styled.button`
  ${({ theme }) => `
    background: none;
    border: none;
    cursor: pointer;
    color: ${theme.colorTextSecondary};
    font-size: 16px;
    line-height: 1;
    padding: 4px;
    border-radius: 4px;
    transition: color 0.15s ease, background 0.15s ease;

    &:hover {
      color: #cf1322;
      background: #fff1f0;
    }
  `}
`;

const EmptyBox = styled.div`
  ${({ theme }) => `
    text-align: center;
    padding: 48px 24px;
    background: ${theme.colorBgElevated};
    border: 1px dashed ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    color: ${theme.colorTextSecondary};
  `}
`;

const VariableIdText = styled.span`
  ${({ theme }) => `
    font-size: 11px;
    color: ${theme.colorTextSecondary};
    font-family: monospace;
    display: block;
    margin-top: 2px;
  `}
`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function StepVariableMapping({
  variableMappings,
  onChange,
}: StepVariableMappingProps) {
  // Collect unique instance IDs for stable color assignment
  const uniqueInstanceIds = useMemo(
    () => [...new Set(variableMappings.map(m => m.instanceId))],
    [variableMappings],
  );

  // Find variable IDs that appear in more than one instance (conflicts)
  const conflictIds = useMemo(() => {
    const countByVarId: Record<string, Set<number>> = {};
    variableMappings.forEach(m => {
      if (!countByVarId[m.variableId]) countByVarId[m.variableId] = new Set();
      countByVarId[m.variableId].add(m.instanceId);
    });
    return new Set(
      Object.entries(countByVarId)
        .filter(([, instances]) => instances.size > 1)
        .map(([id]) => id),
    );
  }, [variableMappings]);

  // Group by instance
  const groupedByInstance = useMemo(() => {
    const groups: Record<
      number,
      { instanceName: string; mappings: VariableMapping[] }
    > = {};
    variableMappings.forEach(m => {
      if (!groups[m.instanceId]) {
        groups[m.instanceId] = {
          instanceName: m.instanceName,
          mappings: [],
        };
      }
      groups[m.instanceId].mappings.push(m);
    });
    return groups;
  }, [variableMappings]);

  const handleAliasChange = (
    instanceId: number,
    variableId: string,
    alias: string,
  ) => {
    const updated = variableMappings.map(m =>
      m.instanceId === instanceId && m.variableId === variableId
        ? { ...m, alias }
        : m,
    );
    onChange(updated);
  };

  const handleRemove = (instanceId: number, variableId: string) => {
    const updated = variableMappings.filter(
      m => !(m.instanceId === instanceId && m.variableId === variableId),
    );
    onChange(updated);
  };

  if (variableMappings.length === 0) {
    return (
      <StepContainer>
        <div>
          <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
            Variable Mapping
          </Title>
          <Paragraph style={{ margin: 0, color: '#666' }}>
            Review and configure variable aliases per source instance.
          </Paragraph>
        </div>
        <EmptyBox>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <Text strong>No variables selected</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 13 }}>
            Go back to the Data Elements step and select variables to map.
          </Text>
        </EmptyBox>
      </StepContainer>
    );
  }

  return (
    <StepContainer>
      <div>
        <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
          Variable Mapping
        </Title>
        <Paragraph style={{ margin: 0, color: '#666' }}>
          Review variables grouped by source instance. Set an alias for any
          variable to customize its column name in the dataset. Remove variables
          you no longer need.
        </Paragraph>
      </div>

      {conflictIds.size > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Duplicate variable IDs detected"
          description={`${conflictIds.size} variable ID${conflictIds.size !== 1 ? 's' : ''} appear in more than one instance. Rows with conflicts are highlighted. Consider setting unique aliases to avoid column name collisions.`}
        />
      )}

      {Object.entries(groupedByInstance).map(
        ([instanceIdStr, { instanceName, mappings }]) => {
          const instanceId = Number(instanceIdStr);
          const color = getInstanceColor(instanceId, uniqueInstanceIds);

          return (
            <GroupSection key={instanceId}>
              <GroupHeader>
                <GroupTitle>{instanceName}</GroupTitle>
                <Tag color={color}>Instance #{instanceId}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {mappings.length} variable{mappings.length !== 1 ? 's' : ''}
                </Text>
              </GroupHeader>

              <TableHeader>
                <div>Variable</div>
                <div>Type</div>
                <div>Source Instance</div>
                <div>Alias (optional)</div>
                <div />
              </TableHeader>

              <VariableTable>
                {mappings.map(m => {
                  const isConflict = conflictIds.has(m.variableId);
                  return (
                    <VariableRow
                      key={`${m.instanceId}-${m.variableId}`}
                      hasConflict={isConflict}
                    >
                      <div>
                        <VariableName>{m.variableName}</VariableName>
                        <VariableIdText>{m.variableId}</VariableIdText>
                        {isConflict && (
                          <Tooltip title="This variable ID exists in multiple instances. Set an alias to avoid conflicts.">
                            <Tag
                              color="warning"
                              style={{ fontSize: 10, marginTop: 4 }}
                            >
                              ⚠ Duplicate ID
                            </Tag>
                          </Tooltip>
                        )}
                      </div>

                      <div>
                        <Tag>{m.variableType}</Tag>
                      </div>

                      <div>
                        <Tag color={color}>{instanceName}</Tag>
                      </div>

                      <div>
                        <Input
                          size="small"
                          placeholder="e.g. anc_1st_visit"
                          value={m.alias || ''}
                          onChange={e =>
                            handleAliasChange(
                              m.instanceId,
                              m.variableId,
                              e.target.value,
                            )
                          }
                        />
                      </div>

                      <div style={{ textAlign: 'center' }}>
                        <Tooltip title="Remove variable">
                          <RemoveButton
                            onClick={() =>
                              handleRemove(m.instanceId, m.variableId)
                            }
                            aria-label="Remove variable"
                          >
                            ×
                          </RemoveButton>
                        </Tooltip>
                      </div>
                    </VariableRow>
                  );
                })}
              </VariableTable>
            </GroupSection>
          );
        },
      )}

      <Alert
        type="info"
        showIcon
        message="About aliases"
        description="Aliases become the column names in your Superset dataset. If left blank, the variable name is used. Use lowercase letters, numbers, and underscores for best compatibility."
      />
    </StepContainer>
  );
}
