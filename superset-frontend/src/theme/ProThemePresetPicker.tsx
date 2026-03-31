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

import { useMemo, useCallback } from 'react';
import { t, styled } from '@superset-ui/core';
import {
  ALL_PRESETS,
  PRESETS_BY_CATEGORY,
  type PresetCategory,
} from './presets';
import { ALL_LAYOUTS } from './layouts';

/* ── Styled ─────────────────────────────────────────────────────────── */

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Label = styled.label`
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.2px;
  color: ${({ theme }) => theme.colorTextSecondary};
  margin-bottom: 4px;
  display: block;
`;

const StyledSelect = styled.select`
  width: 100%;
  height: 32px;
  padding: 0 8px;
  font-size: 13px;
  border: 1px solid ${({ theme }) => theme.colorBorder};
  border-radius: 8px;
  background: ${({ theme }) => theme.colorBgContainer};
  color: ${({ theme }) => theme.colorText};
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: var(--pro-blue, #1976D2);
    box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.15);
  }
`;

const SwatchRow = styled.div`
  display: flex;
  gap: 3px;
  margin-top: 6px;
`;

const Swatch = styled.div<{ color: string }>`
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: ${({ color }) => color};
  border: 1px solid rgba(0, 0, 0, 0.1);
`;

const CategoryLabel: Record<PresetCategory, string> = {
  clinical: 'Clinical / Health',
  earth: 'Earth / Natural',
  corporate: 'Corporate / Formal',
  vibrant: 'Vibrant / Modern',
  monochrome: 'Monochrome',
  'high-contrast': 'High Contrast',
  dark: 'Dark Variants',
  regional: 'Regional / Cultural',
};

/* ── Component ──────────────────────────────────────────────────────── */

interface ProThemePresetPickerProps {
  selectedPresetId: string | null;
  selectedLayoutId: string | null;
  onPresetChange: (presetId: string) => void;
  onLayoutChange: (layoutId: string) => void;
}

export default function ProThemePresetPicker({
  selectedPresetId,
  selectedLayoutId,
  onPresetChange,
  onLayoutChange,
}: ProThemePresetPickerProps) {
  const categories = useMemo(
    () => Object.keys(PRESETS_BY_CATEGORY) as PresetCategory[],
    [],
  );

  const handlePresetChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onPresetChange(e.target.value);
    },
    [onPresetChange],
  );

  const handleLayoutChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onLayoutChange(e.target.value);
    },
    [onLayoutChange],
  );

  const selectedPreset = selectedPresetId
    ? ALL_PRESETS.find(p => p.id === selectedPresetId)
    : null;

  return (
    <Wrapper>
      <div>
        <Label>{t('Theme Preset')}</Label>
        <StyledSelect
          value={selectedPresetId || ''}
          onChange={handlePresetChange}
        >
          <option value="">{t('Select a theme preset...')}</option>
          {categories.map(cat => (
            <optgroup key={cat} label={CategoryLabel[cat]}>
              {PRESETS_BY_CATEGORY[cat].map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
          ))}
        </StyledSelect>
        {selectedPreset && (
          <SwatchRow>
            {selectedPreset.chartPalette.map((c, i) => (
              <Swatch key={i} color={c} />
            ))}
          </SwatchRow>
        )}
      </div>

      <div>
        <Label>{t('Layout Template')}</Label>
        <StyledSelect
          value={selectedLayoutId || ''}
          onChange={handleLayoutChange}
        >
          <option value="">{t('Select a layout...')}</option>
          {ALL_LAYOUTS.map(layout => (
            <option key={layout.id} value={layout.id}>
              {layout.name} — {layout.description}
            </option>
          ))}
        </StyledSelect>
      </div>
    </Wrapper>
  );
}
