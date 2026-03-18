/**
 * DHIS2 semantic column tag — replaces the generic `?` icon in the Explore
 * sidebar for columns that carry DHIS2-specific metadata in their `extra` field.
 *
 * Detects:
 *  dhis2_is_ou_hierarchy + dhis2_ou_level  → "L1"–"L6"  (org-unit hierarchy level)
 *  dhis2_is_period                         → "PE"       (period dimension)
 *  dhis2_is_ou_level                       → "OL"       (numeric OU-level helper)
 *  dhis2_variable_type = "dataElements"    → "DE"       (data element)
 *  dhis2_variable_type = "indicators"      → "IN"       (indicator)
 *  dhis2_variable_type = "programIndicators" → "PI"     (program indicator)
 *  dhis2_variable_type = "eventDataItems"  → "EV"       (event data item)
 *  dhis2_variable_type = "dataSets"        → "DS"       (DHIS2 dataset)
 */

import { css, styled, t } from '@superset-ui/core';
import { Tooltip } from '@superset-ui/core/components';

// ── Tag descriptor ────────────────────────────────────────────────────────────

export type DHIS2ColKind = {
  /** 2-3 character badge label */
  label: string;
  /** Full tooltip text */
  tooltip: string;
  /** Badge background colour (CSS string) */
  bg: string;
  /** Badge text colour (CSS string) */
  fg: string;
};

// ── Detection ─────────────────────────────────────────────────────────────────

function parseExtra(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  return null;
}

export function detectDHIS2Kind(rawExtra: unknown): DHIS2ColKind | null {
  const extra = parseExtra(rawExtra);
  if (!extra) return null;

  // Org-unit hierarchy column (national, region, district, …)
  if (extra.dhis2_is_ou_hierarchy) {
    const level = Number(extra.dhis2_ou_level);
    const lbl = Number.isFinite(level) && level > 0 ? `L${level}` : 'OU';
    const tip = Number.isFinite(level) && level > 0
      ? t('Org Unit — hierarchy level %s', level)
      : t('Organisation Unit hierarchy column');
    return { label: lbl, tooltip: tip, bg: '#0d9aaa', fg: '#fff' };
  }

  // Period dimension
  if (extra.dhis2_is_period) {
    return {
      label: 'PE',
      tooltip: t('DHIS2 Period dimension'),
      bg: '#e67e22',
      fg: '#fff',
    };
  }

  // Numeric OU-level helper column
  if (extra.dhis2_is_ou_level) {
    return {
      label: 'OL',
      tooltip: t('Org Unit Level (numeric)'),
      bg: '#6c757d',
      fg: '#fff',
    };
  }

  // Category Option Combo dimension (disaggregation)
  if (extra.dhis2_is_coc) {
    return {
      label: 'CO',
      tooltip: t('DHIS2 Disaggregation (Category Option Combo)'),
      bg: '#20c997',
      fg: '#fff',
    };
  }

  // Category Option Combo UID reference column
  if (extra.dhis2_is_coc_uid) {
    return {
      label: 'CU',
      tooltip: t('Category Option Combo UID'),
      bg: '#6c757d',
      fg: '#fff',
    };
  }

  // Data-variable columns — differentiate by dhis2_variable_type
  const varType = String(extra.dhis2_variable_type || '').toLowerCase();
  if (varType) {
    if (varType.includes('program') && varType.includes('indicator')) {
      return { label: 'PI', tooltip: t('DHIS2 Program Indicator'), bg: '#6610f2', fg: '#fff' };
    }
    if (varType.includes('indicator')) {
      return { label: 'IN', tooltip: t('DHIS2 Indicator'), bg: '#7952b3', fg: '#fff' };
    }
    if (varType.includes('dataelement') || varType.includes('data_element')) {
      return { label: 'DE', tooltip: t('DHIS2 Data Element'), bg: '#1a6ebd', fg: '#fff' };
    }
    if (varType.includes('dataset') || varType.includes('data_set')) {
      return { label: 'DS', tooltip: t('DHIS2 Dataset'), bg: '#13795b', fg: '#fff' };
    }
    if (varType.includes('event')) {
      return { label: 'EV', tooltip: t('DHIS2 Event Data Item'), bg: '#217a3c', fg: '#fff' };
    }
  }

  return null;
}

// ── Styled badge ──────────────────────────────────────────────────────────────

const BadgeWrapper = styled.div`
  ${({ theme }) => css`
    display: flex;
    justify-content: center;
    align-items: center;
    width: ${theme.sizeUnit * 6}px;
    height: ${theme.sizeUnit * 6}px;
    margin-right: ${theme.sizeUnit}px;
    flex-shrink: 0;
  `}
`;

const Badge = styled.span<{ $bg: string; $fg: string }>`
  ${({ $bg, $fg, theme }) => css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: ${theme.sizeUnit * 5.5}px;
    height: ${theme.sizeUnit * 4}px;
    border-radius: 3px;
    background: ${$bg};
    color: ${$fg};
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1;
    font-family: ${theme.fontFamilyCode ?? 'monospace'};
    user-select: none;
    cursor: default;
  `}
`;

// ── Component ─────────────────────────────────────────────────────────────────

export type DHIS2ColumnTagProps = {
  kind: DHIS2ColKind;
};

export function DHIS2ColumnTag({ kind }: DHIS2ColumnTagProps) {
  return (
    <BadgeWrapper>
      <Tooltip title={kind.tooltip} placement="bottomRight">
        <Badge $bg={kind.bg} $fg={kind.fg} aria-label={kind.tooltip}>
          {kind.label}
        </Badge>
      </Tooltip>
    </BadgeWrapper>
  );
}

export default DHIS2ColumnTag;
