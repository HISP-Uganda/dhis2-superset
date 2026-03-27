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

/**
 * MetricColorControl
 *
 * Assigns a fixed colour to each metric/column in a multi-series chart.
 * The mapping is stored as `metric_colors: { [seriesLabel: string]: string }`
 * (hex strings) in the chart's form data.  Before the chart re-renders the
 * control calls `CategoricalColorNamespace.setColor()` so that every echarts
 * plugin that uses `CategoricalColorNamespace.getScale()` picks up the override
 * automatically.
 */

import { useEffect, useCallback } from 'react';
import { styled, t, getMetricLabel, CategoricalColorNamespace } from '@superset-ui/core';
import { ColorPicker, type ColorValue } from '@superset-ui/core/components';
import { getCategoricalSchemeRegistry } from '@superset-ui/core';
import ControlHeader from 'src/explore/components/ControlHeader';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Value stored in form data: label → hex colour string. */
export type MetricColorMap = Record<string, string>;

export interface MetricColorControlProps {
  onChange?: (value: MetricColorMap) => void;
  value?: MetricColorMap;
  /** Injected via mapStateToProps — the current metrics control value. */
  metrics?: any[];
  /**
   * Injected via mapStateToProps — the current color_breakpoints value.
   * Used only when `colorMode` is not set (legacy implicit behaviour): if
   * breakpoints exist, metric colours are stored but NOT applied to the
   * CategoricalColorNamespace.
   */
  colorBreakpoints?: any[];
  /**
   * Injected via mapStateToProps — the explicit color_mode selector value.
   * When `'breakpoints'`, metric colours are stored but NOT applied to the
   * namespace (breakpoints take priority).
   * When `'default'`, neither metric colours nor breakpoints are applied.
   * When `'metric'` or undefined, metric colours are applied to the namespace.
   */
  colorMode?: string;
  label?: string;
  description?: string;
  renderTrigger?: boolean;
}

// ── Styled components ──────────────────────────────────────────────────────────

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
  margin-bottom: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const MetricLabel = styled.span`
  flex: 1;
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ClearButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 ${({ theme }) => theme.sizeUnit}px;
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: 14px;
  line-height: 1;
  opacity: ${({ disabled }) => (disabled ? 0.3 : 0.7)};
  &:hover:not(:disabled) {
    color: ${({ theme }) => theme.colorError};
    opacity: 1;
  }
`;

const FooterRow = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: ${({ theme }) => theme.sizeUnit}px;
`;

const ClearAllLink = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  color: ${({ theme }) => theme.colorTextSecondary};
  text-decoration: underline;
  &:hover {
    color: ${({ theme }) => theme.colorError};
  }
`;

const EmptyHint = styled.div`
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  color: ${({ theme }) => theme.colorTextDisabled};
  padding: ${({ theme }) => theme.sizeUnit}px 0;
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function colorToHex(color: ColorValue): string {
  const rgb = color.toRgb();
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MetricColorControl({
  onChange,
  value = {},
  metrics = [],
  colorBreakpoints = [],
  colorMode,
  ...headerProps
}: MetricColorControlProps) {
  // Metric colours are suppressed (not applied to the namespace) when:
  //  - colorMode is explicitly 'breakpoints' or 'default', OR
  //  - colorMode is not set (legacy) AND breakpoints exist (implicit priority).
  const breakpointsActive =
    colorMode === 'breakpoints' ||
    colorMode === 'default' ||
    (colorMode == null && Array.isArray(colorBreakpoints) && colorBreakpoints.length > 0);
  const categoricalScheme = getCategoricalSchemeRegistry().get();
  const presetColors = categoricalScheme?.colors.slice(0, 9) || [];

  // Derive the display label for each metric (same key used by echarts).
  const metricLabels: string[] = metrics
    .map((m: any) => {
      try {
        return getMetricLabel(m);
      } catch {
        return String(m);
      }
    })
    .filter(Boolean);

  // Apply stored colour overrides to the global CategoricalColorNamespace
  // whenever the value changes — but only when no data-range breakpoints are
  // active.  Breakpoints are value-based and take priority over fixed metric
  // colours, so we clear any previously forced colours when they are present.
  useEffect(() => {
    const ns = CategoricalColorNamespace.getNamespace();
    if (breakpointsActive) {
      // Remove any forced colours set by this control so breakpoints can govern.
      Object.keys(value).forEach(label => ns.resetColorsForLabels([label]));
    } else {
      Object.entries(value).forEach(([label, hex]) => {
        if (hex) ns.setColor(label, hex);
      });
    }
  }, [value, breakpointsActive]);

  const handleColorChange = useCallback(
    (label: string, color: ColorValue) => {
      const hex = colorToHex(color);
      // Store the choice; the useEffect above decides whether to apply it.
      if (!breakpointsActive) {
        CategoricalColorNamespace.getNamespace().setColor(label, hex);
      }
      onChange?.({ ...value, [label]: hex });
    },
    [onChange, value, breakpointsActive],
  );

  const handleClearOne = useCallback(
    (label: string) => {
      // Remove the forced colour from the namespace.
      CategoricalColorNamespace.getNamespace().resetColorsForLabels([label]);
      const next = { ...value };
      delete next[label];
      onChange?.(next);
    },
    [onChange, value],
  );

  const handleClearAll = useCallback(() => {
    const ns = CategoricalColorNamespace.getNamespace();
    Object.keys(value).forEach(label => ns.resetColorsForLabels([label]));
    onChange?.({});
  }, [onChange, value]);

  const hasAnyColor = Object.values(value).some(Boolean);

  if (!metricLabels.length) {
    return (
      <>
        <ControlHeader {...headerProps} />
        <EmptyHint>{t('Add metrics to the chart to assign colours.')}</EmptyHint>
      </>
    );
  }

  return (
    <>
      <ControlHeader {...headerProps} />
      {metricLabels.map(label => (
        <Row key={label}>
          <ColorPicker
            value={value[label]}
            onChangeComplete={color => handleColorChange(label, color)}
            presets={[{ label: t('Theme colors'), colors: presetColors }]}
          />
          <MetricLabel title={label}>{label}</MetricLabel>
          <ClearButton
            title={t('Remove colour for this metric')}
            disabled={!value[label]}
            onClick={() => handleClearOne(label)}
            aria-label={t('Clear colour for %s', label)}
          >
            ×
          </ClearButton>
        </Row>
      ))}
      {hasAnyColor && (
        <FooterRow>
          <ClearAllLink onClick={handleClearAll}>
            {t('Clear all colours')}
          </ClearAllLink>
        </FooterRow>
      )}
    </>
  );
}
