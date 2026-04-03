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
/* eslint-disable theme-colors/no-literal-colors */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { styled, getMetricLabel, t } from '@superset-ui/core';
import { ColorPicker } from 'antd';
import ControlHeader from '../ControlHeader';

/* ── Types ──────────────────────────────────────── */

export interface VariableConfig {
  label?: string;
  subtitle?: string;
  numberFormat?: string;
  prefix?: string;
  suffix?: string;
  nullText?: string;
  cardColor?: string;
  labelColor?: string;
  borderColor?: string;
  imageUrl?: string;
}

export type VariableConfigMap = Record<string, VariableConfig>;

interface VariableConfigControlProps {
  onChange?: (value: VariableConfigMap) => void;
  value?: VariableConfigMap | null;
  name?: string;
  label?: string;
  description?: string;
  renderTrigger?: boolean;
  hovered?: boolean;
  metrics?: any[];
}

/* ── Number format choices ──────────────────────── */

const NUMBER_FORMAT_OPTIONS = [
  { value: '', label: 'Default (Smart)' },
  { value: 'SMART_NUMBER', label: 'Smart Number' },
  { value: ',.0f', label: '12,345' },
  { value: ',.1f', label: '12,345.6' },
  { value: ',.2f', label: '12,345.68' },
  { value: '.0%', label: '85%' },
  { value: '.1%', label: '85.3%' },
  { value: '.2%', label: '85.32%' },
  { value: ',.0s', label: '12K / 1.2M' },
  { value: ',.2s', label: '12K / 1.23M' },
  { value: '$,.0f', label: '$12,345' },
  { value: '$,.2f', label: '$12,345.68' },
];

/* ── Styled Components ──────────────────────────── */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const VariableRow = styled.div`
  border: 1px solid var(--pro-border, #E5EAF0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--pro-surface, #FFFFFF);
`;

const VariableHeader = styled.div<{ $expanded: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  background: ${({ $expanded }) =>
    $expanded ? 'var(--pro-sub-surface, #F8FAFC)' : 'transparent'};
  transition: background 0.15s ease;

  &:hover {
    background: var(--pro-sub-surface, #F8FAFC);
  }
`;

const VariableName = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--pro-text, #1A1F2C);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ExpandIcon = styled.span<{ $expanded: boolean }>`
  font-size: 10px;
  color: var(--pro-text-muted, #9CA3AF);
  transform: ${({ $expanded }) => ($expanded ? 'rotate(90deg)' : 'none')};
  transition: transform 0.15s ease;
`;

const ConfigPanel = styled.div`
  padding: 8px 12px 12px;
  border-top: 1px solid var(--pro-border, #E5EAF0);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const FieldRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const FieldLabel = styled.label`
  font-size: 11px;
  font-weight: 600;
  color: var(--pro-text-secondary, #6B7280);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  min-width: 70px;
  flex-shrink: 0;
`;

const FieldInput = styled.input`
  flex: 1;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid var(--pro-border, #E5EAF0);
  border-radius: 6px;
  background: var(--pro-surface, #FFFFFF);
  color: var(--pro-text, #1A1F2C);
  outline: none;
  min-width: 0;

  &:focus {
    border-color: var(--pro-blue, #1976D2);
    box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.12);
  }

  &::placeholder {
    color: var(--pro-text-muted, #9CA3AF);
  }
`;

const FieldSelect = styled.select`
  flex: 1;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid var(--pro-border, #E5EAF0);
  border-radius: 6px;
  background: var(--pro-surface, #FFFFFF);
  color: var(--pro-text, #1A1F2C);
  outline: none;
  min-width: 0;

  &:focus {
    border-color: var(--pro-blue, #1976D2);
  }
`;

const ColorFieldRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const ColorSwatch = styled.div<{ $color?: string }>`
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid var(--pro-border, #E5EAF0);
  background: ${({ $color }) => $color || 'transparent'};
  cursor: pointer;
  flex-shrink: 0;
  position: relative;

  ${({ $color }) =>
    !$color
      ? `
    &::after {
      content: '';
      position: absolute;
      top: 50%; left: 50%;
      width: 1px; height: 16px;
      background: var(--pro-text-muted, #9CA3AF);
      transform: translate(-50%, -50%) rotate(45deg);
    }
  `
      : ''}
`;

const ClearButton = styled.button`
  font-size: 11px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--pro-text-muted, #9CA3AF);
  cursor: pointer;
  border-radius: 4px;

  &:hover {
    color: var(--pro-danger, #D32F2F);
    background: var(--pro-danger-bg, rgba(211, 47, 47, 0.08));
  }
`;

const SectionLabel = styled.div`
  font-size: 10px;
  font-weight: 700;
  color: var(--pro-text-muted, #9CA3AF);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--pro-border, #E5EAF0);
`;

const EmptyMessage = styled.div`
  font-size: 13px;
  color: var(--pro-text-muted, #9CA3AF);
  padding: 16px;
  text-align: center;
  border: 1px dashed var(--pro-border, #E5EAF0);
  border-radius: 8px;
`;

/* ── Inline Color Picker ────────────────────────── */

function InlineColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (color: string | undefined) => void;
}) {
  return (
    <ColorFieldRow>
      <FieldLabel>{label}</FieldLabel>
      <ColorPicker
        value={value || undefined}
        size="small"
        showText
        allowClear
        onChangeComplete={color => {
          onChange(color.toHexString());
        }}
        onClear={() => onChange(undefined)}
      />
      {value && (
        <ClearButton
          type="button"
          onClick={() => onChange(undefined)}
          title="Clear"
        >
          ×
        </ClearButton>
      )}
    </ColorFieldRow>
  );
}

/* ── Main Component ─────────────────────────────── */

export default function VariableConfigControl({
  onChange,
  value,
  metrics = [],
  ...headerProps
}: VariableConfigControlProps) {
  const config: VariableConfigMap = value || {};
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  /* Derive metric labels from current metrics */
  const metricLabels = useMemo(
    () => metrics.map((m: any) => getMetricLabel(m)),
    [metrics],
  );

  /* Auto-expand first metric on initial load */
  useEffect(() => {
    if (metricLabels.length > 0 && expandedKeys.size === 0) {
      setExpandedKeys(new Set([metricLabels[0]]));
    }
  }, [metricLabels.length]);

  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const updateField = useCallback(
    (metricKey: string, field: keyof VariableConfig, fieldValue: string | undefined) => {
      const current = config[metricKey] || {};
      const updated = { ...current, [field]: fieldValue || undefined };

      /* Clean empty entries */
      const cleaned: VariableConfig = {};
      for (const [k, v] of Object.entries(updated)) {
        if (v !== undefined && v !== '') {
          (cleaned as any)[k] = v;
        }
      }

      const next = { ...config };
      if (Object.keys(cleaned).length > 0) {
        next[metricKey] = cleaned;
      } else {
        delete next[metricKey];
      }

      onChange?.(next);
    },
    [config, onChange],
  );

  if (metricLabels.length === 0) {
    return (
      <div>
        <ControlHeader {...headerProps} />
        <EmptyMessage>
          {t('Add metrics above to configure per-variable styling')}
        </EmptyMessage>
      </div>
    );
  }

  return (
    <div>
      <ControlHeader {...headerProps} />
      <Container>
        {metricLabels.map((metricKey: string) => {
          const expanded = expandedKeys.has(metricKey);
          const cfg = config[metricKey] || {};
          const hasOverrides = Object.keys(cfg).length > 0;

          return (
            <VariableRow key={metricKey}>
              <VariableHeader
                $expanded={expanded}
                onClick={() => toggleExpanded(metricKey)}
              >
                <VariableName>
                  {cfg.label || metricKey}
                  {hasOverrides && ' ✱'}
                </VariableName>
                <ExpandIcon $expanded={expanded}>▶</ExpandIcon>
              </VariableHeader>

              {expanded && (
                <ConfigPanel>
                  {/* ── Labels ── */}
                  <SectionLabel>{t('Labels')}</SectionLabel>
                  <FieldRow>
                    <FieldLabel>{t('Label')}</FieldLabel>
                    <FieldInput
                      placeholder={metricKey}
                      value={cfg.label || ''}
                      onChange={e =>
                        updateField(metricKey, 'label', e.target.value)
                      }
                    />
                  </FieldRow>
                  <FieldRow>
                    <FieldLabel>{t('Subtitle')}</FieldLabel>
                    <FieldInput
                      placeholder={t('e.g. Last 30 days')}
                      value={cfg.subtitle || ''}
                      onChange={e =>
                        updateField(metricKey, 'subtitle', e.target.value)
                      }
                    />
                  </FieldRow>

                  {/* ── Formatting ── */}
                  <SectionLabel>{t('Formatting')}</SectionLabel>
                  <FieldRow>
                    <FieldLabel>{t('Format')}</FieldLabel>
                    <FieldSelect
                      value={cfg.numberFormat || ''}
                      onChange={e =>
                        updateField(metricKey, 'numberFormat', e.target.value)
                      }
                    >
                      {NUMBER_FORMAT_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </FieldSelect>
                  </FieldRow>
                  <FieldRow>
                    <FieldLabel>{t('Prefix')}</FieldLabel>
                    <FieldInput
                      placeholder={t('e.g. $, UGX')}
                      value={cfg.prefix || ''}
                      onChange={e =>
                        updateField(metricKey, 'prefix', e.target.value)
                      }
                    />
                  </FieldRow>
                  <FieldRow>
                    <FieldLabel>{t('Suffix')}</FieldLabel>
                    <FieldInput
                      placeholder={t('e.g. %, cases')}
                      value={cfg.suffix || ''}
                      onChange={e =>
                        updateField(metricKey, 'suffix', e.target.value)
                      }
                    />
                  </FieldRow>
                  <FieldRow>
                    <FieldLabel>{t('Null text')}</FieldLabel>
                    <FieldInput
                      placeholder="–"
                      value={cfg.nullText || ''}
                      onChange={e =>
                        updateField(metricKey, 'nullText', e.target.value)
                      }
                    />
                  </FieldRow>

                  {/* ── Colors ── */}
                  <SectionLabel>{t('Colors')}</SectionLabel>
                  <InlineColorField
                    label={t('Card BG')}
                    value={cfg.cardColor}
                    onChange={c => updateField(metricKey, 'cardColor', c)}
                  />
                  <InlineColorField
                    label={t('Label')}
                    value={cfg.labelColor}
                    onChange={c => updateField(metricKey, 'labelColor', c)}
                  />
                  <InlineColorField
                    label={t('Border')}
                    value={cfg.borderColor}
                    onChange={c => updateField(metricKey, 'borderColor', c)}
                  />

                  {/* ── Image ── */}
                  <SectionLabel>{t('Image / Icon')}</SectionLabel>
                  <FieldRow>
                    <FieldLabel>{t('URL')}</FieldLabel>
                    <FieldInput
                      placeholder={t('https://... .png / .svg')}
                      value={cfg.imageUrl || ''}
                      onChange={e =>
                        updateField(metricKey, 'imageUrl', e.target.value)
                      }
                    />
                  </FieldRow>
                </ConfigPanel>
              )}
            </VariableRow>
          );
        })}
      </Container>
    </div>
  );
}
