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

import { useEffect, useMemo, useState } from 'react';
import { styled, t } from '@superset-ui/core';
import {
  Button,
  InputNumber,
  Select,
  Tooltip,
} from '@superset-ui/core/components';
import DndSelectLabel from 'src/explore/components/controls/DndColumnSelectControl/DndSelectLabel';
import {
  StagedLegendSet,
  readCachedLegendSets,
  syncDHIS2LegendSchemesForDatabase,
} from 'src/utils/dhis2LegendColorSchemes';
import { readCachedLegendSetEnvelope } from 'src/visualizations/DHIS2Map/controlPanel';
import ColorBreakpointOption from './ColorBreakpointOption';
import { ColorBreakpointType, ColorBreakpointsControlProps } from './types';
import ColorBreakpointPopoverTrigger from './ColorBreakpointPopoverTrigger';
import {
  generateEqualBreakpoints,
  importDHIS2Legend,
  getHealthPresetBreakpoints,
  GRADIENT_PRESETS,
  HEALTH_PRESETS,
  DEFAULT_GRADIENT,
  DHIS2LegendDefinition,
} from './colorBreakpointUtils';

const DEFAULT_COLOR_BREAKPOINTS: ColorBreakpointType[] = [];

const NewColorBreakpointFormatPlaceholder = styled('div')`
  position: relative;
  width: calc(100% - ${({ theme }) => theme.sizeUnit}px);
  bottom: ${({ theme }) => theme.sizeUnit * 4}px;
  left: 0;
`;

const AutoGenerateWrapper = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorSplit};
    border-radius: ${theme.borderRadius}px;
    padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 3}px;
    margin-top: ${theme.sizeUnit * 2}px;
    background: ${theme.colorBgLayout};
  `}
`;

const AutoGenerateRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
  flex-wrap: wrap;
  margin-top: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const SectionTitle = styled.div`
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  font-weight: ${({ theme }) => theme.fontWeightStrong};
  color: ${({ theme }) => theme.colorTextSecondary};
  margin-bottom: ${({ theme }) => theme.sizeUnit}px;
`;

const HintText = styled.div`
  font-size: 11px;
  color: #888;
  margin-top: 4px;
`;

const ErrorText = styled.div`
  color: ${({ theme }) => theme.colorError};
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  margin-top: ${({ theme }) => theme.sizeUnit}px;
`;

const LegendSetOptionLabel = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
  width: 100%;
  min-width: 0;
`;

const LegendSetOptionName = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const LegendSetPreview = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: ${({ theme }) => theme.borderRadiusSM}px;
  border: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  background: ${({ theme }) => theme.colorBgContainer};
`;

const LegendSetSwatch = styled.span<{ $color: string }>`
  width: ${({ theme }) => theme.sizeUnit * 2}px;
  height: ${({ theme }) => theme.sizeUnit * 2}px;
  background: ${({ $color }) => $color};
  border-right: 1px solid ${({ theme }) => theme.colorBorderSecondary};

  &:last-of-type {
    border-right: none;
  }
`;

type RawLegendItem = {
  startValue?: number;
  endValue?: number;
  color?: string;
  name?: string;
  displayName?: string;
};

const gradientOptions = Object.entries(GRADIENT_PRESETS).map(([key, val]) => ({
  value: key,
  label: val.label,
}));

const healthPresetOptions = Object.entries(HEALTH_PRESETS).map(([key, val]) => ({
  value: key,
  label: val.label,
}));

function getLegendSetValue(legendSet: StagedLegendSet): string {
  return String(
    legendSet.id || legendSet.displayName || legendSet.name || '',
  ).trim();
}

function getLegendSetLabel(legendSet: StagedLegendSet): string {
  return String(
    legendSet.legendDefinition?.setName ||
      legendSet.displayName ||
      legendSet.name ||
      legendSet.id ||
      t('(unnamed)'),
  ).trim();
}

function getLegendSetItems(legendSet: StagedLegendSet): RawLegendItem[] {
  const rawItems =
    (legendSet as any).legendDefinition?.items ??
    (legendSet as any).legends ??
    [];

  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .filter((item: unknown): item is RawLegendItem => Boolean(item))
    .slice()
    .sort(
      (left, right) =>
        Number(left.startValue ?? 0) - Number(right.startValue ?? 0),
    );
}

function buildLegendDefinition(
  legendSet: StagedLegendSet,
): DHIS2LegendDefinition {
  return {
    items: getLegendSetItems(legendSet).map(item => ({
      startValue: item.startValue,
      endValue: item.endValue,
      color: item.color,
      name: item.name ?? item.displayName,
    })),
    name: getLegendSetLabel(legendSet),
  };
}

const ColorBreakpointsControl = ({
  onChange,
  dhis2LegendDefinition,
  databaseId,
  ...props
}: ColorBreakpointsControlProps) => {
  const [popoverVisible, setPopoverVisible] = useState(false);
  const [colorBreakpoints, setColorBreakpoints] = useState<ColorBreakpointType[]>(
    props?.value ? (props.value as ColorBreakpointType[]) : DEFAULT_COLOR_BREAKPOINTS,
  );

  // Auto-generate state
  const [autoCount, setAutoCount] = useState<number>(5);
  const [autoMin, setAutoMin] = useState<number | undefined>(undefined);
  const [autoMax, setAutoMax] = useState<number | undefined>(undefined);
  const [autoGradient, setAutoGradient] = useState<string>(DEFAULT_GRADIENT);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showAutoGenerate, setShowAutoGenerate] = useState(false);

  // Health presets state
  const [showHealthPresets, setShowHealthPresets] = useState(false);

  // DHIS2 legend-set selector state
  const [dhis2LegendSets, setDhis2LegendSets] = useState<StagedLegendSet[]>([]);
  const [dhis2LoadError, setDhis2LoadError] = useState<string | null>(null);
  const [dhis2Loading, setDhis2Loading] = useState(false);
  const [selectedLegendSetId, setSelectedLegendSetId] = useState<string>();

  useEffect(() => {
    onChange?.(colorBreakpoints);
  }, [colorBreakpoints, onChange]);

  useEffect(() => {
    let cancelled = false;

    if (!databaseId) {
      setDhis2LegendSets([]);
      setDhis2LoadError(null);
      setDhis2Loading(false);
      setSelectedLegendSetId(undefined);
      return () => {
        cancelled = true;
      };
    }

    const loadLegendSets = async () => {
      setDhis2LoadError(null);
      setSelectedLegendSetId(undefined);

      const cached = readCachedLegendSets(databaseId);
      if (!cancelled) {
        setDhis2LegendSets(cached);
      }

      setDhis2Loading(true);
      try {
        let attempts = 0;
        const maxAttempts = 5;

        while (!cancelled && attempts < maxAttempts) {
          await syncDHIS2LegendSchemesForDatabase(databaseId);

          const envelope = readCachedLegendSetEnvelope(databaseId);
          const fresh = envelope?.data || [];

          if (fresh.length > 0) {
            if (!cancelled) {
              setDhis2LegendSets(fresh);
            }
            return;
          }

          if (envelope?.status !== 'pending') {
            break;
          }

          attempts += 1;
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        const final = readCachedLegendSets(databaseId);
        if (!cancelled) {
          setDhis2LegendSets(final);
          if (final.length === 0) {
            setDhis2LoadError(
              t('No DHIS2 legend sets found. Ensure the metadata has been synced.'),
            );
          }
        }
      } catch {
        if (!cancelled && cached.length === 0) {
          setDhis2LoadError(t('Failed to load DHIS2 legend sets.'));
        }
      } finally {
        if (!cancelled) {
          setDhis2Loading(false);
        }
      }
    };

    loadLegendSets();
    return () => {
      cancelled = true;
    };
  }, [databaseId]);

  const togglePopover = (visible: boolean) => {
    setPopoverVisible(visible);
  };

  const handleClickGhostButton = () => {
    togglePopover(true);
  };

  const saveColorBreakpoint = (breakpoint: ColorBreakpointType) => {
    setColorBreakpoints([
      ...colorBreakpoints,
      {
        ...breakpoint,
        id: colorBreakpoints.length,
      },
    ]);
    togglePopover(false);
  };

  const removeColorBreakpoint = (index: number) => {
    const newBreakpoints = [...colorBreakpoints];
    newBreakpoints.splice(index, 1);
    setColorBreakpoints(newBreakpoints);
  };

  const editColorBreakpoint = (breakpoint: ColorBreakpointType, index: number) => {
    const newBreakpoints = [...colorBreakpoints];
    newBreakpoints[index] = { ...breakpoint, id: index };
    setColorBreakpoints(newBreakpoints);
  };

  const handleAutoGenerate = () => {
    setAutoError(null);
    if (autoMin === undefined || autoMax === undefined) {
      setAutoError(t('Please enter both Min and Max values.'));
      return;
    }
    const result = generateEqualBreakpoints(autoCount, autoMin, autoMax, autoGradient);
    if (result.error) {
      setAutoError(result.error);
      return;
    }
    setColorBreakpoints(result.breakpoints!);
  };

  const handleImportDHIS2 = () => {
    setImportError(null);
    const result = importDHIS2Legend(dhis2LegendDefinition);
    if (result.error) {
      setImportError(result.error);
      return;
    }
    setColorBreakpoints(result.breakpoints!);
  };

  const handleApplyHealthPreset = (key: string) => {
    const bps = getHealthPresetBreakpoints(key);
    if (bps) setColorBreakpoints(bps);
    setShowHealthPresets(false);
  };

  const handleSelectDhis2LegendSet = (setId: string) => {
    const legendSet = dhis2LegendSets.find(
      s => getLegendSetValue(s) === setId,
    );
    if (!legendSet) return;

    setSelectedLegendSetId(setId);
    const result = importDHIS2Legend(buildLegendDefinition(legendSet));
    if (result.error) {
      setDhis2LoadError(result.error);
    } else {
      setColorBreakpoints(result.breakpoints!);
      setDhis2LoadError(null);
    }
  };

  const valuesRenderer = () =>
    colorBreakpoints.map((breakpoint, index) => (
      <ColorBreakpointOption
        key={index}
        saveColorBreakpoint={(newBreakpoint: ColorBreakpointType) =>
          editColorBreakpoint(newBreakpoint, index)
        }
        breakpoint={breakpoint}
        colorBreakpoints={colorBreakpoints}
        index={index}
        onClose={removeColorBreakpoint}
        onShift={() => {}}
      />
    ));

  const ghostButtonText = t('Click to add new breakpoint');

  const dhis2SelectOptions = useMemo(
    () =>
      dhis2LegendSets
        .map(legendSet => {
          const value = getLegendSetValue(legendSet);
          if (!value) {
            return null;
          }

          const previewItems = getLegendSetItems(legendSet).filter(
            item => typeof item.color === 'string' && item.color.trim().length > 0,
          );

          return {
            value,
            searchValue: getLegendSetLabel(legendSet).toLowerCase(),
            label: (
              <LegendSetOptionLabel data-test="dhis2-legendset-option">
                <LegendSetOptionName>
                  {getLegendSetLabel(legendSet)}
                </LegendSetOptionName>
                <LegendSetPreview data-test="dhis2-legendset-preview">
                  {previewItems.map((item, index) => (
                    <LegendSetSwatch
                      key={`${value}-${index}`}
                      $color={String(item.color)}
                      data-test="dhis2-legendset-swatch"
                    />
                  ))}
                </LegendSetPreview>
              </LegendSetOptionLabel>
            ),
          };
        })
        .filter(Boolean),
    [dhis2LegendSets],
  );

  return (
    <>
      <DndSelectLabel
        onDrop={() => {}}
        canDrop={() => false}
        valuesRenderer={valuesRenderer}
        accept={[]}
        ghostButtonText={ghostButtonText}
        onClickGhostButton={handleClickGhostButton}
        {...props}
      />
      <ColorBreakpointPopoverTrigger
        saveColorBreakpoint={saveColorBreakpoint}
        colorBreakpoints={colorBreakpoints}
        isControlled
        visible={popoverVisible}
        toggleVisibility={setPopoverVisible}
      >
        <NewColorBreakpointFormatPlaceholder />
      </ColorBreakpointPopoverTrigger>

      {/* ── Action buttons ─────────────────────────────────────────────────── */}
      <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Button
          buttonSize="xsmall"
          buttonStyle="tertiary"
          onClick={() => {
            setShowAutoGenerate(v => !v);
            setShowHealthPresets(false);
          }}
          data-test="toggle-auto-generate"
        >
          {showAutoGenerate ? t('Hide range generator') : t('Generate ranges…')}
        </Button>

        <Button
          buttonSize="xsmall"
          buttonStyle="tertiary"
          onClick={() => {
            setShowHealthPresets(v => !v);
            setShowAutoGenerate(false);
          }}
          data-test="toggle-health-presets"
        >
          {t('Health presets…')}
        </Button>

        {dhis2LegendDefinition && (
          <Tooltip title={t('Replace breakpoints with the DHIS2 legend set stored on this column')}>
            <Button
              buttonSize="xsmall"
              buttonStyle="tertiary"
              onClick={handleImportDHIS2}
              data-test="import-dhis2-legend"
            >
              {t('Import column legend')}
            </Button>
          </Tooltip>
        )}
      </div>
      {importError && <ErrorText>{importError}</ErrorText>}

      {/* ── Health presets panel ──────────────────────────────────────────── */}
      {showHealthPresets && (
        <AutoGenerateWrapper data-test="health-presets-panel">
          <SectionTitle>{t('WHO / Epidemiology standard thresholds')}</SectionTitle>
          <HintText>{t('Select a preset to replace existing breakpoints with evidence-based thresholds.')}</HintText>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {healthPresetOptions.map(opt => (
              <div key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Button
                  buttonSize="xsmall"
                  buttonStyle="secondary"
                  onClick={() => handleApplyHealthPreset(opt.value)}
                  style={{ flexShrink: 0 }}
                >
                  {t('Apply')}
                </Button>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>
                    {HEALTH_PRESETS[opt.value].description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </AutoGenerateWrapper>
      )}

      {/* ── DHIS2 legend-set selector ────────────────────────────────────── */}
      {databaseId && (
        <AutoGenerateWrapper data-test="dhis2-legendset-panel">
          <SectionTitle>{t('Load from DHIS2 legend set')}</SectionTitle>
          <HintText>
            {t('Select a staged DHIS2 legend set to replace existing breakpoints.')}
          </HintText>
          <div style={{ marginTop: 8 }} data-test="dhis2-legendset-select-wrap">
            <Select
              options={dhis2SelectOptions}
              value={selectedLegendSetId}
              placeholder={t('Select a legend set…')}
              onChange={(v: any) => handleSelectDhis2LegendSet(v as string)}
              css={{ width: '100%' }}
              ariaLabel={t('DHIS2 legend set')}
              data-test="dhis2-legendset-select"
              disabled={dhis2Loading && dhis2SelectOptions.length === 0}
              filterOption={(input: string, option: any) =>
                String(option?.searchValue || '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </div>
          {dhis2Loading && (
            <HintText data-test="dhis2-legendset-loading">
              {t('Loading legend sets…')}
            </HintText>
          )}
          {dhis2LoadError && (
            <ErrorText data-test="dhis2-legendset-error">
              {dhis2LoadError}
            </ErrorText>
          )}
        </AutoGenerateWrapper>
      )}

      {/* ── Auto-generate equal-width ranges panel ───────────────────────── */}
      {showAutoGenerate && (
        <AutoGenerateWrapper data-test="auto-generate-panel">
          <SectionTitle>{t('Auto-generate equal-width colour ranges')}</SectionTitle>
          <AutoGenerateRow>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{t('Ranges:')}</span>
              <InputNumber
                min={1}
                max={20}
                value={autoCount}
                onChange={(v: number) => setAutoCount(v || 1)}
                style={{ width: 60 }}
                data-test="auto-count"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{t('Min:')}</span>
              <InputNumber
                value={autoMin}
                onChange={(v: number) => setAutoMin(v)}
                style={{ width: 80 }}
                data-test="auto-min"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{t('Max:')}</span>
              <InputNumber
                value={autoMax}
                onChange={(v: number) => setAutoMax(v)}
                style={{ width: 80 }}
                data-test="auto-max"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 220 }}>
              <span style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{t('Gradient:')}</span>
              <Select
                options={gradientOptions}
                value={autoGradient}
                onChange={(v: any) => setAutoGradient(v as string)}
                css={{ width: 200 }}
                data-test="auto-gradient"
                ariaLabel={t('Gradient preset')}
              />
            </div>
            <Button
              buttonSize="small"
              buttonStyle="primary"
              onClick={handleAutoGenerate}
              data-test="auto-generate-btn"
            >
              {t('Generate')}
            </Button>
          </AutoGenerateRow>
          {autoError && <ErrorText data-test="auto-error">{autoError}</ErrorText>}
          <HintText>
            {t('Replaces existing breakpoints. You can edit individual ranges afterwards.')}
          </HintText>
        </AutoGenerateWrapper>
      )}
    </>
  );
};

export default ColorBreakpointsControl;
