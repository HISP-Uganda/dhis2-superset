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
import { useMemo } from 'react';
import { Icons, Tooltip } from '@superset-ui/core/components';
import type { MenuItem } from '@superset-ui/core/components/Menu';
import { t, ThemeMode, ThemeAlgorithm } from '@superset-ui/core';
import {
  PRESETS_BY_CATEGORY,
  type PresetCategory,
  type ThemePreset,
} from 'src/theme/presets';

export interface ThemeSubMenuOption {
  key: ThemeMode;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export interface ThemeSubMenuProps {
  setThemeMode: (newMode: ThemeMode) => void;
  themeMode: ThemeMode;
  hasLocalOverride?: boolean;
  onClearLocalSettings?: () => void;
  allowOSPreference?: boolean;
  /** Apply a preset theme (uses setTemporaryTheme under the hood) */
  onApplyPreset?: (preset: ThemePreset) => void;
  /** Currently applied preset ID (for checkmark display) */
  appliedPresetId?: string | null;
}

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

const SwatchBar = ({ colors }: { colors: string[] }) => (
  <span
    style={{
      display: 'inline-flex',
      gap: 2,
      marginLeft: 8,
      verticalAlign: 'middle',
    }}
  >
    {colors.slice(0, 5).map((c, i) => (
      <span
        key={i}
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: c,
          border: '1px solid rgba(0,0,0,0.1)',
          display: 'inline-block',
        }}
      />
    ))}
  </span>
);

export const useThemeMenuItems = ({
  setThemeMode,
  themeMode,
  hasLocalOverride = false,
  onClearLocalSettings,
  allowOSPreference = true,
  onApplyPreset,
  appliedPresetId,
}: ThemeSubMenuProps): MenuItem => {
  const handleSelect = (mode: ThemeMode) => {
    setThemeMode(mode);
  };

  const themeIconMap: Record<ThemeAlgorithm | ThemeMode, React.ReactNode> =
    useMemo(
      () => ({
        [ThemeAlgorithm.DEFAULT]: <Icons.SunOutlined />,
        [ThemeAlgorithm.DARK]: <Icons.MoonOutlined />,
        [ThemeMode.SYSTEM]: <Icons.FormatPainterOutlined />,
        [ThemeAlgorithm.COMPACT]: <Icons.CompressOutlined />,
      }),
      [],
    );

  const selectedThemeModeIcon = useMemo(
    () =>
      hasLocalOverride ? (
        <Tooltip title={t('This theme is set locally')} placement="bottom">
          <Icons.ThunderboltOutlined />
        </Tooltip>
      ) : (
        themeIconMap[themeMode]
      ),
    [hasLocalOverride, themeIconMap, themeMode],
  );

  /* ── Mode options (Light / Dark / System) ──────────── */
  const themeOptions: MenuItem[] = [
    {
      key: ThemeMode.DEFAULT,
      label: (
        <>
          <Icons.SunOutlined /> {t('Light')}
        </>
      ),
      onClick: () => handleSelect(ThemeMode.DEFAULT),
    },
    {
      key: ThemeMode.DARK,
      label: (
        <>
          <Icons.MoonOutlined /> {t('Dark')}
        </>
      ),
      onClick: () => handleSelect(ThemeMode.DARK),
    },
    ...(allowOSPreference
      ? [
          {
            key: ThemeMode.SYSTEM,
            label: (
              <>
                <Icons.FormatPainterOutlined /> {t('Match system')}
              </>
            ),
            onClick: () => handleSelect(ThemeMode.SYSTEM),
          },
        ]
      : []),
  ];

  const themeGroupOptions = [...themeOptions];
  if (onClearLocalSettings && hasLocalOverride) {
    themeGroupOptions.push({
      type: 'divider' as const,
      key: 'theme-divider',
    });
    themeGroupOptions.push({
      key: 'clear-local',
      label: (
        <>
          <Icons.ClearOutlined /> {t('Clear local theme')}
        </>
      ),
      onClick: onClearLocalSettings,
    });
  }

  /* ── Preset options (categorized) ──────────────────── */
  const presetChildren: MenuItem[] = useMemo(() => {
    if (!onApplyPreset) return [];

    const categories = Object.keys(PRESETS_BY_CATEGORY) as PresetCategory[];
    const items: MenuItem[] = [];

    categories.forEach((cat, catIdx) => {
      const presets = PRESETS_BY_CATEGORY[cat];
      if (!presets?.length) return;

      if (catIdx > 0) {
        items.push({ type: 'divider', key: `preset-div-${cat}` });
      }

      items.push({
        type: 'group',
        label: CategoryLabel[cat],
        key: `preset-cat-${cat}`,
        children: presets.map(preset => ({
          key: `preset-${preset.id}`,
          label: (
            <span style={{ display: 'flex', alignItems: 'center' }}>
              {appliedPresetId === preset.id && (
                <Icons.CheckOutlined
                  iconSize="xs"
                  css={{ marginRight: 6, color: '#1976D2' }}
                />
              )}
              <span style={{ flex: 1 }}>{preset.name}</span>
              <SwatchBar colors={preset.chartPalette} />
            </span>
          ),
          onClick: () => onApplyPreset(preset),
        })),
      });
    });

    return items;
  }, [onApplyPreset, appliedPresetId]);

  /* ── Build final children ──────────────────────────── */
  const children: MenuItem[] = [
    {
      type: 'group' as const,
      label: t('Mode'),
      key: 'theme-group',
      children: themeGroupOptions,
    },
  ];

  if (presetChildren.length > 0) {
    children.push({ type: 'divider', key: 'mode-preset-divider' });
    children.push({
      key: 'pro-theme-presets',
      label: (
        <>
          <Icons.FormatPainterOutlined /> {t('Pro Theme Presets')}
        </>
      ),
      children: presetChildren,
    });
  }

  return {
    key: 'theme-sub-menu',
    label: selectedThemeModeIcon,
    icon: <Icons.CaretDownOutlined iconSize="xs" />,
    className: 'submenu-with-caret',
    children,
  };
};
