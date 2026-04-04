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
/* eslint-env browser */
import PropTypes from 'prop-types';
import { Global, css } from '@emotion/react';
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import {
  styled,
  isFeatureEnabled,
  FeatureFlag,
  t,
  getExtensionsRegistry,
} from '@superset-ui/core';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import { bindActionCreators } from 'redux';
import {
  LOG_ACTIONS_PERIODIC_RENDER_DASHBOARD,
  LOG_ACTIONS_FORCE_REFRESH_DASHBOARD,
  LOG_ACTIONS_TOGGLE_EDIT_DASHBOARD,
} from 'src/logger/LogUtils';
import { Icons } from '@superset-ui/core/components/Icons';
import {
  Button,
  Tooltip,
  DeleteModal,
  UnsavedChangesModal,
} from '@superset-ui/core/components';
import { findPermission } from 'src/utils/findPermission';
import { safeStringify } from 'src/utils/safeStringify';
import PublishedStatus from 'src/dashboard/components/PublishedStatus';
import UndoRedoKeyListeners from 'src/dashboard/components/UndoRedoKeyListeners';
import PropertiesModal from 'src/dashboard/components/PropertiesModal';
import RefreshIntervalModal from 'src/dashboard/components/RefreshIntervalModal';
import {
  UNDO_LIMIT,
  SAVE_TYPE_OVERWRITE,
  DASHBOARD_POSITION_DATA_LIMIT,
  DASHBOARD_HEADER_ID,
} from 'src/dashboard/util/constants';
import { TagTypeEnum } from 'src/components/Tag/TagType';
import setPeriodicRunner, {
  stopPeriodicRender,
} from 'src/dashboard/util/setPeriodicRunner';
import ReportModal from 'src/features/reports/ReportModal';
import { deleteActiveReport } from 'src/features/reports/ReportModal/actions';
import { PageHeaderWithActions } from '@superset-ui/core/components/PageHeaderWithActions';
import { useUnsavedChangesPrompt } from 'src/hooks/useUnsavedChangesPrompt';
import { Drawer } from 'antd';
import FilterBar from 'src/dashboard/components/nativeFilters/FilterBar';
import { FilterBarOrientation } from 'src/dashboard/types';
import DashboardEmbedModal from '../EmbeddedModal';
import OverwriteConfirm from '../OverwriteConfirm';
import {
  addDangerToast,
  addSuccessToast,
  addWarningToast,
} from '../../../components/MessageToasts/actions';
import {
  dashboardTitleChanged,
  redoLayoutAction,
  undoLayoutAction,
  updateDashboardTitle,
  clearDashboardHistory,
} from '../../actions/dashboardLayout';
import {
  fetchCharts,
  fetchFaveStar,
  maxUndoHistoryToast,
  onChange,
  onRefresh,
  saveDashboardRequest,
  saveFaveStar,
  savePublished,
  setEditMode,
  setMaxUndoHistoryExceeded,
  setRefreshFrequency,
  setUnsavedChanges,
} from '../../actions/dashboardState';
import { logEvent } from '../../../logger/actions';
import { dashboardInfoChanged } from '../../actions/dashboardInfo';
import isDashboardLoading from '../../util/isDashboardLoading';
import { useChartIds } from '../../util/charts/useChartIds';
import { useDashboardMetadataBar } from './useDashboardMetadataBar';
import { useHeaderActionsMenu } from './useHeaderActionsDropdownMenu';

const extensionsRegistry = getExtensionsRegistry();

/**
 * Extracts a human-readable "OrgUnit · Period" context line from the active
 * native dashboard filters.  Looks for filters whose target column name
 * contains typical OU/period identifiers and returns the first applied
 * value for each.
 */
function useActiveFilterContext(dataMask, nativeFilters) {
  return useMemo(() => {
    if (!nativeFilters || !dataMask) return null;

    const ouKeywords = [
      'national', 'region', 'district', 'county', 'province',
      'org_unit', 'orgunit', 'ou_', 'facility',
    ];
    const periodKeywords = ['period', 'quarter', 'month', 'year', 'date', 'time'];

    let ouLabel = null;
    let periodLabel = null;

    const filters = Object.values(nativeFilters);
    for (const filter of filters) {
      if (filter.type !== 'NATIVE_FILTER') continue;

      const filterState = dataMask[filter.id]?.filterState;
      if (!filterState) continue;

      const label =
        filterState.label && !filterState.label.includes('undefined')
          ? filterState.label
          : Array.isArray(filterState.value)
            ? filterState.value.join(', ')
            : filterState.value || null;

      if (!label) continue;

      const columnName = (
        filter.targets?.[0]?.column?.name || filter.name || ''
      ).toLowerCase();

      if (!ouLabel && ouKeywords.some(k => columnName.includes(k))) {
        ouLabel = label;
      }
      if (!periodLabel && periodKeywords.some(k => columnName.includes(k))) {
        periodLabel = label;
      }
      if (ouLabel && periodLabel) break;
    }

    if (!ouLabel && !periodLabel) return null;
    const parts = [ouLabel, periodLabel].filter(Boolean);
    return parts.join('  ·  ');
  }, [dataMask, nativeFilters]);
}

const headerContainerStyle = theme => css`
  border-bottom: 1px solid ${theme.colorBorder};

  .header-with-actions {
    height: ${theme.sizeUnit * 10}px;
    padding: 0 ${theme.sizeUnit * 2}px;
  }

  .title-panel {
    margin-right: ${theme.sizeUnit * 2}px;
  }

  .header-with-actions .title-panel > div {
    padding-left: ${theme.sizeUnit}px;
  }
`;

const publicHeaderStyle = theme => css`
  border-bottom: 2px solid var(--pro-blue, ${theme.colorPrimary});
  background: ${theme.colorBgBase};
  width: 100%;
  /* Eliminate all gaps — sit flush against the portal header / topbar */
  margin: 0;
  padding: 0;

  .header-with-actions {
    height: 48px;
    padding: 0 24px;
    background: ${theme.colorBgBase};
    max-width: 100%;
    margin: 0;
    display: flex;
    align-items: center;
  }

  .title-panel {
    margin-right: ${theme.sizeUnit}px;
    margin-left: 0;
    flex: 1 1 0%;
    min-width: 0;
    max-width: 85%;
    overflow: hidden;
    display: flex;
    align-items: center;
  }

  /* Force the editable-title wrapper to fill its parent */
  .title-panel .editable-title {
    display: block !important;
    width: 100% !important;
  }

  /* Override the dynamically-calculated pixel width so the input/textarea
     stretches to fill the title-panel instead of being sized to text width */
  .header-with-actions .editable-title input,
  .header-with-actions .editable-title textarea,
  .header-with-actions .editable-title span[data-test="span-title"],
  .header-with-actions .editable-title [data-test="editable-title"],
  .header-with-actions .dynamic-title-input {
    font-size: 18px !important;
    font-weight: 700 !important;
    letter-spacing: -0.025em;
    color: var(--pro-navy, ${theme.colorText}) !important;
    background-color: transparent !important;
    font-family: var(--pro-font-family, ${theme.fontFamily});
    line-height: 1.3;
    width: 100% !important;
    max-width: 100% !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    resize: none;
  }

  .header-with-actions .title-panel > div {
    padding-left: 0;
    margin-left: 0;
    width: 100%;
  }

  .right-button-panel {
    gap: 8px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  /* ── Tablet ──────────────────────────────────────────────────────── */
  @media (max-width: 1024px) {
    .header-with-actions {
      height: 44px;
      padding: 0 16px;
    }
    .header-with-actions .editable-title input,
    .header-with-actions .editable-title textarea,
    .header-with-actions .editable-title span[data-test="span-title"],
    .header-with-actions .editable-title [data-test="editable-title"],
    .header-with-actions .dynamic-title-input {
      font-size: 16px !important;
    }
  }

  /* ── Mobile ──────────────────────────────────────────────────────── */
  @media (max-width: 767px) {
    .header-with-actions {
      height: auto;
      min-height: 40px;
      padding: 6px 12px;
      flex-wrap: wrap;
      gap: 4px;
    }
    .title-panel {
      flex: 1 1 100%;
      max-width: 100%;
      margin-right: 0;
    }
    .header-with-actions .editable-title input,
    .header-with-actions .editable-title textarea,
    .header-with-actions .editable-title span[data-test="span-title"],
    .header-with-actions .editable-title [data-test="editable-title"],
    .header-with-actions .dynamic-title-input {
      font-size: 14px !important;
    }
    .right-button-panel {
      flex: 1 1 100%;
      justify-content: flex-end;
    }
  }
`;

const filterDrawerBtnStyle = theme => css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
  border-radius: 4px;
  border: 1px solid var(--pro-border, ${theme.colorBorder});
  background: var(--pro-\1);
  color: var(--pro-\1);

  &:hover, &:focus {
    background: var(--pro-\1);
    border-color: var(--pro-\1);
    color: var(--pro-\1);
  }

  @media (max-width: 767px) {
    font-size: 11px;
    padding: 4px 8px;
    gap: 4px;
  }
`;

/* Pro-themed filter drawer overrides — ensures cascading filters,
   selects, and action buttons look polished inside the drawer. */
const filterDrawerGlobalStyles = theme => css`
  /* Ensure the drawer root sits above everything including map controls */
  .pro-filter-drawer.ant-drawer {
    z-index: 1100 !important;
  }

  .pro-filter-drawer {
    .ant-drawer-header {
      background: var(--pro-surface, ${theme.colorBgContainer});
      border-bottom: 1px solid var(--pro-border, ${theme.colorBorder});
      padding: 16px 20px;
    }

    .ant-drawer-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--pro-text, ${theme.colorText});
    }

    .ant-drawer-close {
      color: var(--pro-text-secondary, ${theme.colorTextSecondary});
    }

    .ant-drawer-body {
      background: var(--pro-canvas, ${theme.colorBgLayout});
      padding: 0;
    }

    /* FilterBar wrapper — make it fill the drawer cleanly */
    .ant-drawer-body > div {
      position: relative !important;
      width: 100% !important;
      height: 100% !important;
      min-height: 100% !important;
    }

    /* Override position: absolute on the Bar so it flows in the drawer */
    .ant-drawer-body [class*="Bar-"] {
      position: relative !important;
      display: flex !important;
      flex-direction: column;
      width: 100% !important;
      min-height: 100% !important;
      border-right: none !important;
    }

    /* BarWrapper — fill drawer */
    .ant-drawer-body [class*="BarWrapper"] {
      width: 100% !important;
    }

    /* Filter controls wrapper — better spacing */
    .ant-drawer-body [class*="FilterControlsWrapper"],
    .ant-drawer-body [class*="filter-controls-wrapper"] {
      padding: 16px 20px 100px;
      gap: 16px;
    }

    /* Individual filter items */
    .ant-drawer-body [class*="FilterValue"],
    .ant-drawer-body [class*="filter-item-wrapper"] {
      background: var(--pro-surface, ${theme.colorBgContainer});
      border: 1px solid var(--pro-border, ${theme.colorBorder});
      border-radius: 0;
      padding: 14px 16px;
    }

    /* Filter labels */
    .ant-drawer-body .filter-item-wrapper label,
    .ant-drawer-body [class*="StyledFilterTitle"],
    .ant-drawer-body [class*="FilterName"] {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--pro-text-secondary, ${theme.colorTextSecondary});
      margin-bottom: 6px;
    }

    /* Select inputs inside filters */
    .ant-drawer-body .ant-select-selector {
      border-radius: 0 !important;
      border-color: var(--pro-border, ${theme.colorBorder}) !important;
      background: var(--pro-surface, ${theme.colorBgContainer}) !important;
    }

    .ant-drawer-body .ant-select-focused .ant-select-selector {
      border-color: var(--pro-accent, ${theme.colorPrimary}) !important;
      box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.12) !important;
    }

    /* Input fields */
    .ant-drawer-body .ant-input,
    .ant-drawer-body .ant-input-number {
      border-radius: 0;
      border-color: var(--pro-border, ${theme.colorBorder});
    }

    .ant-drawer-body .ant-input:focus,
    .ant-drawer-body .ant-input-number:focus {
      border-color: var(--pro-accent, ${theme.colorPrimary});
      box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.12);
    }

    /* Date pickers */
    .ant-drawer-body .ant-picker {
      border-radius: 0;
      border-color: var(--pro-border, ${theme.colorBorder});
    }

    /* Action buttons at the bottom */
    .ant-drawer-body [class*="ActionButtons"],
    .ant-drawer-body [class*="action-buttons"] {
      background: var(--pro-surface, ${theme.colorBgContainer});
      border-top: 1px solid var(--pro-border, ${theme.colorBorder});
      padding: 12px 20px;
    }

    .ant-drawer-body .ant-btn {
      border-radius: 0;
    }

    .ant-drawer-body .ant-btn-primary {
      background: var(--pro-accent, ${theme.colorPrimary});
      border-color: var(--pro-accent, ${theme.colorPrimary});
    }

    /* FilterBar header (Apply / Clear buttons row) */
    .ant-drawer-body [class*="Header"] > div {
      padding: 12px 20px;
    }

    /* Hide collapse toggle inside drawer — not needed */
    .ant-drawer-body [class*="CollapsedBar"],
    .ant-drawer-body [data-test="filter-bar-collapse-button"] {
      display: none !important;
    }

    /* Tab navigation (Filters / Cross Filters) */
    .ant-drawer-body .ant-tabs-nav {
      padding: 0 20px;
      margin-bottom: 0;
    }

    .ant-drawer-body .ant-tabs-tab {
      font-weight: 600;
      font-size: 13px;
    }

    /* Scrollable area */
    .ant-drawer-body [class*="StyledScrollContainer"] {
      overflow-y: auto;
    }

    /* ── Responsive drawer — full width on mobile ── */
    @media (max-width: 767px) {
      .ant-drawer-content-wrapper {
        width: 100% !important;
        max-width: 100vw !important;
      }

      .ant-drawer-header {
        padding: 12px 16px;
      }

      .ant-drawer-title {
        font-size: 14px;
      }

      .ant-drawer-body [class*="FilterControlsWrapper"],
      .ant-drawer-body [class*="filter-controls-wrapper"] {
        padding: 12px 16px 80px;
        gap: 12px;
      }

      .ant-drawer-body [class*="FilterValue"],
      .ant-drawer-body [class*="filter-item-wrapper"] {
        padding: 10px 12px;
      }
    }

    @media (max-width: 1024px) {
      .ant-drawer-content-wrapper {
        width: 360px !important;
      }
    }
  }
`;

/* Pro theme — public dashboard overrides.
   Overrides density vars for larger titles, tighter chart headers,
   visible card separation, and subtle color accent areas. */
const proPublicPageStyles = theme => css`
  /* ── Override density vars for public view ────────────────────────── */
  :root {
    --pro-density-chart-title: 14px;
    --pro-density-header-v: 4px;
    --pro-density-header-h: 12px;
    --pro-density-body-font: 13px;
    --pro-density-kpi-value: 32px;
    --pro-density-kpi-label: 12px;
  }

  /* ── Page canvas ──────────────────────────────────────────────────── */
  .dashboard-content {
    background-color: #EFF3F8 !important;
  }

  /* Grid rows — transparent so canvas shows between cards */
  .grid-row,
  .dragdroppable-row {
    background: transparent !important;
  }

  /* ── Chart cards — clean surface, no shadow, no radius ─────────────── */
  .dashboard-component-chart-holder,
  .dashboard-content .dashboard-component-chart-holder,
  .dashboard-content .resizable-container .dashboard-component-chart-holder {
    border-radius: 0 !important;
    border: 1px solid var(--pro-border, ${theme.colorBorderSecondary}) !important;
    background-color: #fff;
    box-shadow: none !important;
    overflow: hidden !important;
    padding: 0 !important;
  }

  .dashboard-component-chart-holder:hover {
    border-color: var(--pro-\1) !important;
    box-shadow: none !important;
  }

  /* ── Chart header — compact bar with accent left-edge ────────────── */
  .chart-header,
  .slice-header,
  [class*="ChartHeaderStyles"] {
    padding: 4px 12px !important;
    margin-bottom: 0 !important;
    border-bottom: 1px solid var(--pro-border, ${theme.colorBorderSecondary}) !important;
    border-top: none !important;
    border-left: 3px solid var(--pro-\1) !important;
    background: var(--pro-\1) !important;
    min-height: 0 !important;
  }

  /* ── Chart title text — no truncation, wrap long titles ──────────── */
  .header-title,
  .slice_container .header-title,
  [data-test="slice-header-title"],
  .chart-header .header-title span,
  .chart-label,
  .chart-title {
    font-family: var(--pro-font-family, ${theme.fontFamily}) !important;
    font-size: var(--pro-density-chart-title, 14px) !important;
    font-weight: 700 !important;
    color: var(--pro-\1) !important;
    letter-spacing: -0.01em;
    white-space: normal !important;
    overflow: visible !important;
    text-overflow: unset !important;
    -webkit-line-clamp: unset !important;
    word-break: break-word;
    line-height: 1.3;
  }

  /* ── EditableTitle inner element — allow wrapping ─────────────────── */
  .dynamic-title-input,
  [data-test="editable-title-input"] {
    white-space: normal !important;
    overflow: visible !important;
    text-overflow: unset !important;
    word-break: break-word;
    display: block !important;
  }

  /* ── Filter context subtitle under chart titles ──────────────────── */
  .chart-filter-context {
    font-family: var(--pro-font-family, ${theme.fontFamily});
    font-size: 12px;
    font-weight: 500;
    color: var(--pro-\1);
    letter-spacing: 0;
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 6px;

    .context-separator {
      color: var(--pro-\1);
    }
  }

  /* ── Dashboard section headers (row headers) ──────────────────────── */
  .dashboard-component-header [class*="HeaderStyles"] {
    font-family: var(--pro-font-family, ${theme.fontFamily}) !important;
    color: var(--pro-\1) !important;
    font-weight: 700 !important;
    font-size: 18px !important;
  }

  /* ── Chart content area — white fallback, no !important so charts
     with their own background colors (KPI, summary cards) are preserved ── */
  .slice_container,
  .chart-container {
    background-color: #fff;
  }

  /* ── Tab components ───────────────────────────────────────────────── */
  .dashboard-component-tabs .ant-tabs-tab {
    font-family: var(--pro-font-family, ${theme.fontFamily});
    font-size: 14px;
    font-weight: 600;
  }

  .dashboard-component-tabs .ant-tabs-tab-active .ant-tabs-tab-btn {
    color: var(--pro-\1) !important;
  }

  .dashboard-component-tabs .ant-tabs-ink-bar {
    background: var(--pro-\1) !important;
  }

  /* ── Markdown / text components ───────────────────────────────────── */
  .dashboard-markdown .markdown-container,
  .dashboard-component-header {
    font-family: var(--pro-font-family, ${theme.fontFamily});
    font-size: 14px;
    color: var(--pro-text, ${theme.colorText});
  }

  /* ── ECharts & SVG text ───────────────────────────────────────────── */
  .echarts-for-react text,
  .superset-legacy-chart text,
  .chart-container text {
    font-family: var(--pro-font-family, ${theme.fontFamily}) !important;
  }

  /* ── Table charts ─────────────────────────────────────────────────── */
  .superset-legacy-chart-table td,
  .superset-legacy-chart-table th,
  table.table td,
  table.table th {
    font-family: var(--pro-font-family, ${theme.fontFamily});
    font-size: 13px;
  }

  /* ── KPI / Big Number charts ──────────────────────────────────────── */
  [class*="BigNumber"] [class*="kpi-value"],
  [class*="kpi_value"],
  .big-number-vis .header-line {
    font-size: var(--pro-density-kpi-value, 32px) !important;
    font-weight: 700 !important;
    color: var(--pro-\1) !important;
  }

  [class*="BigNumber"] [class*="kpi-label"],
  [class*="kpi_label"],
  .big-number-vis .subheader-line {
    font-size: var(--pro-density-kpi-label, 12px) !important;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--pro-text-secondary, ${theme.colorTextSecondary}) !important;
  }

  /* ══════════════════════════════════════════════════════════════════
     RESPONSIVE — Tablet (≤ 1024px)
     ══════════════════════════════════════════════════════════════════ */
  @media (max-width: 1024px) {
    :root {
      --pro-density-chart-title: 14px;
      --pro-density-kpi-value: 28px;
      --pro-density-kpi-label: 12px;
    }

    .dashboard-component-chart-holder {
      padding: ${theme.sizeUnit * 2}px !important;
    }

    .chart-header,
    .slice-header,
    [class*="ChartHeaderStyles"] {
      padding: 3px 10px !important;
    }

    .header-title,
    .chart-label,
    .chart-title {
      font-size: 14px !important;
    }

    [class*="BigNumber"] [class*="kpi-value"],
    [class*="kpi_value"],
    .big-number-vis .header-line {
      font-size: 28px !important;
    }

    .chart-filter-context {
      font-size: 11px;
    }

    .dashboard-component-header [class*="HeaderStyles"] {
      font-size: 16px !important;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     RESPONSIVE — Mobile (≤ 767px)
     ══════════════════════════════════════════════════════════════════ */
  @media (max-width: 767px) {
    :root {
      --pro-density-chart-title: 13px;
      --pro-density-kpi-value: 22px;
      --pro-density-kpi-label: 11px;
    }

    .dashboard-component-chart-holder {
      padding: ${theme.sizeUnit}px !important;
    }

    .chart-header,
    .slice-header,
    [class*="ChartHeaderStyles"] {
      padding: 2px 8px !important;
      border-left-width: 2px !important;
    }

    .header-title,
    .chart-label,
    .chart-title {
      font-size: 13px !important;
    }

    [class*="BigNumber"] [class*="kpi-value"],
    [class*="kpi_value"],
    .big-number-vis .header-line {
      font-size: 22px !important;
    }

    [class*="BigNumber"] [class*="kpi-label"],
    [class*="kpi_label"],
    .big-number-vis .subheader-line {
      font-size: 11px !important;
    }

    .chart-filter-context {
      font-size: 10px;
      gap: 4px;
    }

    .dashboard-component-header [class*="HeaderStyles"] {
      font-size: 14px !important;
    }

    /* Tabs — smaller on mobile */
    .dashboard-component-tabs .ant-tabs-tab {
      font-size: 12px;
      padding: 6px 10px;
    }

    /* Table charts — tighter on mobile */
    .superset-legacy-chart-table td,
    .superset-legacy-chart-table th,
    table.table td,
    table.table th {
      font-size: 11px;
      padding: 4px 6px;
    }
  }
`;

const editButtonStyle = theme => css`
  color: ${theme.colorPrimary};
`;

const actionButtonsStyle = theme => css`
  display: flex;
  align-items: center;

  .action-schedule-report {
    margin-left: ${theme.sizeUnit * 2}px;
  }

  .undoRedo {
    display: flex;
    margin-right: ${theme.sizeUnit * 2}px;
  }
`;

const StyledUndoRedoButton = styled(Button)`
  // TODO: check if we need this
  padding: 0;
  &:hover {
    background: transparent;
  }
`;

const undoRedoStyle = theme => css`
  color: ${theme.colorIcon};
  &:hover {
    color: ${theme.colorIconHover};
  }
`;

const undoRedoEmphasized = theme => css`
  color: ${theme.colorIcon};
`;

const undoRedoDisabled = theme => css`
  color: ${theme.colorTextDisabled};
`;

const saveBtnStyle = theme => css`
  min-width: ${theme.sizeUnit * 17}px;
  height: ${theme.sizeUnit * 8}px;
  span > :first-of-type {
    margin-right: 0;
  }
`;

const discardBtnStyle = theme => css`
  min-width: ${theme.sizeUnit * 22}px;
  height: ${theme.sizeUnit * 8}px;
`;

const discardChanges = () => {
  const url = new URL(window.location.href);

  url.searchParams.delete('edit');
  window.location.assign(url);
};

const Header = ({ isPublicView, onBack, backLabel, badge, subtitle }) => {
  const dispatch = useDispatch();
  const [didNotifyMaxUndoHistoryToast, setDidNotifyMaxUndoHistoryToast] =
    useState(false);
  const [emphasizeUndo, setEmphasizeUndo] = useState(false);
  const [emphasizeRedo, setEmphasizeRedo] = useState(false);
  const [showingPropertiesModal, setShowingPropertiesModal] = useState(false);
  const [showingRefreshModal, setShowingRefreshModal] = useState(false);
  const [showingEmbedModal, setShowingEmbedModal] = useState(false);
  const [showingReportModal, setShowingReportModal] = useState(false);
  const [currentReportDeleting, setCurrentReportDeleting] = useState(null);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const dashboardInfo = useSelector(state => state.dashboardInfo);
  const layout = useSelector(state => state.dashboardLayout.present);
  const undoLength = useSelector(state => state.dashboardLayout.past.length);
  const redoLength = useSelector(state => state.dashboardLayout.future.length);
  const dataMask = useSelector(state => state.dataMask);
  const nativeFilters = useSelector(state => state.nativeFilters?.filters);
  const activeFilterContext = useActiveFilterContext(dataMask, nativeFilters);
  const user = useSelector(state => state.user);
  const chartIds = useChartIds();

  const {
    expandedSlices,
    refreshFrequency,
    shouldPersistRefreshFrequency,
    customCss,
    colorNamespace,
    colorScheme,
    isStarred,
    isPublished,
    hasUnsavedChanges,
    maxUndoHistoryExceeded,
    editMode,
    lastModifiedTime,
  } = useSelector(
    state => ({
      expandedSlices: state.dashboardState.expandedSlices,
      refreshFrequency: state.dashboardState.refreshFrequency,
      shouldPersistRefreshFrequency:
        !!state.dashboardState.shouldPersistRefreshFrequency,
      customCss: state.dashboardInfo.css,
      colorNamespace: state.dashboardState.colorNamespace,
      colorScheme: state.dashboardState.colorScheme,
      isStarred: !!state.dashboardState.isStarred,
      isPublished: !!state.dashboardState.isPublished,
      hasUnsavedChanges: !!state.dashboardState.hasUnsavedChanges,
      maxUndoHistoryExceeded: !!state.dashboardState.maxUndoHistoryExceeded,
      editMode: !!state.dashboardState.editMode,
      lastModifiedTime: state.lastModifiedTime,
    }),
    shallowEqual,
  );
  const isLoading = useSelector(state => isDashboardLoading(state.charts));

  const refreshTimer = useRef(0);
  const ctrlYTimeout = useRef(0);
  const ctrlZTimeout = useRef(0);

  const dashboardTitle = layout[DASHBOARD_HEADER_ID]?.meta?.text;
  const { slug } = dashboardInfo;
  const actualLastModifiedTime = Math.max(
    lastModifiedTime,
    dashboardInfo.last_modified_time,
  );
  const boundActionCreators = useMemo(
    () =>
      bindActionCreators(
        {
          addSuccessToast,
          addDangerToast,
          addWarningToast,
          onUndo: undoLayoutAction,
          onRedo: redoLayoutAction,
          clearDashboardHistory,
          setEditMode,
          setUnsavedChanges,
          fetchFaveStar,
          saveFaveStar,
          savePublished,
          fetchCharts,
          updateDashboardTitle,
          onChange,
          onSave: saveDashboardRequest,
          setMaxUndoHistoryExceeded,
          maxUndoHistoryToast,
          logEvent,
          setRefreshFrequency,
          onRefresh,
          dashboardInfoChanged,
          dashboardTitleChanged,
        },
        dispatch,
      ),
    [dispatch],
  );

  // Use refs to avoid recreating the periodic callback when Redux state
  // changes. Without refs, dashboardInfo/chartIds cause startPeriodicRender
  // to be recreated on every Redux update, which restarts the timer in an
  // infinite loop (timer fires → fetchCharts → state change → callback
  // recreated → useEffect restarts timer → repeat).
  const dashboardInfoRef = useRef(dashboardInfo);
  dashboardInfoRef.current = dashboardInfo;
  const chartIdsRef = useRef(chartIds);
  chartIdsRef.current = chartIds;
  const isPublicViewRef = useRef(isPublicView);
  isPublicViewRef.current = isPublicView;

  const startPeriodicRender = useCallback(
    interval => {
      let intervalMessage;

      if (interval) {
        const periodicRefreshOptions =
          dashboardInfoRef.current.common?.conf
            ?.DASHBOARD_AUTO_REFRESH_INTERVALS;
        const predefinedValue = periodicRefreshOptions?.find(
          option => Number(option[0]) === interval / 1000,
        );

        if (predefinedValue) {
          intervalMessage = t(predefinedValue[1]);
        } else {
          intervalMessage = extendedDayjs
            .duration(interval, 'millisecond')
            .humanize();
        }
      }

      const periodicRender = () => {
        const info = dashboardInfoRef.current;
        const currentChartIds = chartIdsRef.current;
        const { metadata } = info;
        const immune = metadata.timed_refresh_immune_slices || [];
        const affectedCharts = currentChartIds.filter(
          chartId => immune.indexOf(chartId) === -1,
        );

        boundActionCreators.logEvent(LOG_ACTIONS_PERIODIC_RENDER_DASHBOARD, {
          interval,
          chartCount: affectedCharts.length,
        });

        // In public view, refresh silently without toast notifications
        if (!isPublicViewRef.current) {
          boundActionCreators.addWarningToast(
            t(
              `This dashboard is currently auto refreshing; the next auto refresh will be in %s.`,
              intervalMessage,
            ),
          );
        }

        // In public view, always use soft fetch (force=false) to avoid
        // visible loading spinners. In authenticated view, respect the
        // DASHBOARD_AUTO_REFRESH_MODE config.
        const forceRefresh = isPublicViewRef.current
          ? false
          : info.common?.conf?.DASHBOARD_AUTO_REFRESH_MODE !== 'fetch';

        // Pass silent=true for public views so charts refresh in the
        // background without showing loading spinners.
        const silent = !!isPublicViewRef.current;
        return boundActionCreators.fetchCharts(
          affectedCharts,
          forceRefresh,
          interval * 0.2,
          info.id,
          { silent },
        );
      };

      refreshTimer.current = setPeriodicRunner({
        interval,
        periodicRender,
        refreshTimer: refreshTimer.current,
      });
    },
    // boundActionCreators is stable (memoized with [dispatch])
    [boundActionCreators],
  );

  useEffect(() => {
    startPeriodicRender(refreshFrequency * 1000);
  }, [refreshFrequency, startPeriodicRender]);

  // Ensure theme changes are tracked as unsaved changes
  useEffect(() => {
    if (editMode && dashboardInfo.theme !== undefined) {
      boundActionCreators.setUnsavedChanges(true);
    }
  }, [dashboardInfo.theme, editMode, boundActionCreators]);

  useEffect(() => {
    if (UNDO_LIMIT - undoLength <= 0 && !didNotifyMaxUndoHistoryToast) {
      setDidNotifyMaxUndoHistoryToast(true);
      boundActionCreators.maxUndoHistoryToast();
    }
    if (undoLength > UNDO_LIMIT && !maxUndoHistoryExceeded) {
      boundActionCreators.setMaxUndoHistoryExceeded();
    }
  }, [
    boundActionCreators,
    didNotifyMaxUndoHistoryToast,
    maxUndoHistoryExceeded,
    undoLength,
  ]);

  useEffect(
    () => () => {
      stopPeriodicRender(refreshTimer.current);
      boundActionCreators.setRefreshFrequency(0);
      clearTimeout(ctrlYTimeout.current);
      clearTimeout(ctrlZTimeout.current);
    },
    [boundActionCreators],
  );

  const handleChangeText = useCallback(
    nextText => {
      if (nextText && dashboardTitle !== nextText) {
        boundActionCreators.updateDashboardTitle(nextText);
        boundActionCreators.onChange();
      }
    },
    [boundActionCreators, dashboardTitle],
  );

  const handleCtrlY = useCallback(() => {
    boundActionCreators.onRedo();
    setEmphasizeRedo(true);
    if (ctrlYTimeout.current) {
      clearTimeout(ctrlYTimeout.current);
    }
    ctrlYTimeout.current = setTimeout(() => {
      setEmphasizeRedo(false);
    }, 100);
  }, [boundActionCreators]);

  const handleCtrlZ = useCallback(() => {
    boundActionCreators.onUndo();
    setEmphasizeUndo(true);
    if (ctrlZTimeout.current) {
      clearTimeout(ctrlZTimeout.current);
    }
    ctrlZTimeout.current = setTimeout(() => {
      setEmphasizeUndo(false);
    }, 100);
  }, [boundActionCreators]);

  const forceRefresh = useCallback(() => {
    if (!isLoading) {
      boundActionCreators.logEvent(LOG_ACTIONS_FORCE_REFRESH_DASHBOARD, {
        force: true,
        interval: 0,
        chartCount: chartIds.length,
      });
      return boundActionCreators.onRefresh(chartIds, true, 0, dashboardInfo.id);
    }
    return false;
  }, [boundActionCreators, chartIds, dashboardInfo.id, isLoading]);

  const toggleEditMode = useCallback(() => {
    boundActionCreators.logEvent(LOG_ACTIONS_TOGGLE_EDIT_DASHBOARD, {
      edit_mode: !editMode,
    });
    boundActionCreators.setEditMode(!editMode);
  }, [boundActionCreators, editMode]);

  const overwriteDashboard = useCallback(() => {
    const currentColorNamespace =
      dashboardInfo?.metadata?.color_namespace || colorNamespace;
    const currentColorScheme =
      dashboardInfo?.metadata?.color_scheme || colorScheme;

    const data = {
      certified_by: dashboardInfo.certified_by,
      certification_details: dashboardInfo.certification_details,
      css: customCss,
      dashboard_title: dashboardTitle,
      last_modified_time: actualLastModifiedTime,
      owners: dashboardInfo.owners,
      roles: dashboardInfo.roles,
      slug,
      tags: (dashboardInfo.tags || []).filter(
        item => item.type === TagTypeEnum.Custom || !item.type,
      ),
      theme_id: dashboardInfo.theme ? dashboardInfo.theme.id : null,
      metadata: {
        ...dashboardInfo?.metadata,
        color_namespace: currentColorNamespace,
        color_scheme: currentColorScheme,
        positions: layout,
        refresh_frequency: shouldPersistRefreshFrequency
          ? refreshFrequency
          : dashboardInfo.metadata?.refresh_frequency,
      },
    };

    // make sure positions data less than DB storage limitation:
    const positionJSONLength = safeStringify(layout).length;
    const limit =
      dashboardInfo.common?.conf?.SUPERSET_DASHBOARD_POSITION_DATA_LIMIT ||
      DASHBOARD_POSITION_DATA_LIMIT;
    if (positionJSONLength >= limit) {
      boundActionCreators.addDangerToast(
        t(
          'Your dashboard is too large. Please reduce its size before saving it.',
        ),
      );
    } else {
      if (positionJSONLength >= limit * 0.9) {
        boundActionCreators.addWarningToast(
          t('Your dashboard is near the size limit.'),
        );
      }

      boundActionCreators.onSave(data, dashboardInfo.id, SAVE_TYPE_OVERWRITE);
    }
  }, [
    actualLastModifiedTime,
    boundActionCreators,
    colorNamespace,
    colorScheme,
    customCss,
    dashboardInfo.certification_details,
    dashboardInfo.certified_by,
    dashboardInfo.common?.conf?.SUPERSET_DASHBOARD_POSITION_DATA_LIMIT,
    dashboardInfo.id,
    dashboardInfo.metadata,
    dashboardInfo.owners,
    dashboardInfo.roles,
    dashboardInfo.tags,
    dashboardTitle,
    layout,
    refreshFrequency,
    shouldPersistRefreshFrequency,
    slug,
  ]);

  const {
    showModal: showUnsavedChangesModal,
    setShowModal: setShowUnsavedChangesModal,
    handleConfirmNavigation,
    handleSaveAndCloseModal,
  } = useUnsavedChangesPrompt({
    hasUnsavedChanges,
    onSave: overwriteDashboard,
  });

  const showPropertiesModal = useCallback(() => {
    setShowingPropertiesModal(true);
  }, []);

  const hidePropertiesModal = useCallback(() => {
    setShowingPropertiesModal(false);
  }, []);
  const showRefreshModal = useCallback(() => {
    setShowingRefreshModal(true);
  }, []);
  const hideRefreshModal = useCallback(() => {
    setShowingRefreshModal(false);
  }, []);

  const showEmbedModal = useCallback(() => {
    setShowingEmbedModal(true);
  }, []);

  const hideEmbedModal = useCallback(() => {
    setShowingEmbedModal(false);
  }, []);

  const showReportModal = useCallback(() => {
    setShowingReportModal(true);
  }, []);

  const hideReportModal = useCallback(() => {
    setShowingReportModal(false);
  }, []);

  const metadataBar = useDashboardMetadataBar(dashboardInfo);

  const userCanEdit =
    dashboardInfo.dash_edit_perm && !dashboardInfo.is_managed_externally;
  const userCanShare = dashboardInfo.dash_share_perm;
  const userCanSaveAs = dashboardInfo.dash_save_perm;
  const userCanCurate =
    isFeatureEnabled(FeatureFlag.EmbeddedSuperset) &&
    findPermission('can_set_embedded', 'Dashboard', user.roles);
  const isEmbedded = !dashboardInfo?.userId;

  const handleOnPropertiesChange = useCallback(
    updates => {
      boundActionCreators.dashboardInfoChanged({
        slug: updates.slug,
        metadata: JSON.parse(updates.jsonMetadata || '{}'),
        certified_by: updates.certifiedBy,
        certification_details: updates.certificationDetails,
        owners: updates.owners,
        roles: updates.roles,
        tags: updates.tags,
        theme_id: updates.themeId,
        css: updates.css,
      });
      boundActionCreators.setUnsavedChanges(true);

      if (updates.title && dashboardTitle !== updates.title) {
        boundActionCreators.updateDashboardTitle(updates.title);
        boundActionCreators.onChange();
      }
    },
    [boundActionCreators, dashboardTitle],
  );

  const handleRefreshChange = useCallback(
    (refreshFrequency, editMode) => {
      boundActionCreators.setRefreshFrequency(refreshFrequency, !!editMode);
    },
    [boundActionCreators],
  );

  const NavExtension = extensionsRegistry.get('dashboard.nav.right');

  const editableTitleProps = useMemo(
    () => ({
      title: dashboardTitle,
      canEdit: !isPublicView && userCanEdit && editMode,
      onSave: handleChangeText,
      placeholder: t('Add the name of the dashboard'),
      label: t('Dashboard title'),
      showTooltip: false,
    }),
    [dashboardTitle, editMode, handleChangeText, userCanEdit, isPublicView],
  );

  const certifiedBadgeProps = useMemo(
    () => ({
      certifiedBy: dashboardInfo.certified_by,
      details: dashboardInfo.certification_details,
    }),
    [dashboardInfo.certification_details, dashboardInfo.certified_by],
  );

  const faveStarProps = useMemo(
    () => ({
      itemId: dashboardInfo.id,
      fetchFaveStar: boundActionCreators.fetchFaveStar,
      saveFaveStar: boundActionCreators.saveFaveStar,
      isStarred,
      showTooltip: true,
    }),
    [
      boundActionCreators.fetchFaveStar,
      boundActionCreators.saveFaveStar,
      dashboardInfo.id,
      isStarred,
    ],
  );

  const titlePanelAdditionalItems = useMemo(
    () => {
      const items = [];

      if (isPublicView) {
        // Show active OU/Period filter context (or explicit subtitle) as
        // a compact line next to the dashboard title.
        const contextText = activeFilterContext || subtitle;
        if (contextText) {
          items.push(
            <span
              key="public-subtitle"
              css={() => css`
                margin-left: 12px;
                font-size: 12px;
                font-weight: 500;
                color: var(--pro-\1);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 50%;

                @media (max-width: 767px) {
                  margin-left: 0;
                  font-size: 11px;
                  max-width: 100%;
                  display: block;
                }
              `}
            >
              {contextText}
            </span>
          );
        }
        return items;
      }

      if (!editMode) {
        items.push(
          <PublishedStatus
            key="published-status"
            dashboardId={dashboardInfo.id}
            isPublished={isPublished}
            savePublished={boundActionCreators.savePublished}
            userCanEdit={userCanEdit}
            userCanSave={userCanSaveAs}
            visible={!editMode}
          />,
        );
      }

      if (!editMode && !isEmbedded && metadataBar) {
        items.push(<Fragment key="metadata-bar">{metadataBar}</Fragment>);
      }

      return items;
    },
    [
      boundActionCreators.savePublished,
      dashboardInfo.id,
      editMode,
      metadataBar,
      isEmbedded,
      isPublished,
      userCanEdit,
      userCanSaveAs,
      isPublicView,
      badge,
      subtitle,
      activeFilterContext,
    ],
  );

  const rightPanelAdditionalItems = useMemo(
    () => {
      if (isPublicView) {
        return (
          <div className="button-container">
            <Button
              buttonStyle="secondary"
              buttonSize="small"
              css={filterDrawerBtnStyle}
              onClick={() => setFilterDrawerOpen(true)}
              aria-label={t('Filters')}
            >
              <Icons.FilterOutlined iconSize="m" />
              {t('Filters')}
            </Button>
          </div>
        );
      }
      return (
      <div className="button-container">
        {userCanSaveAs && (
          <div className="button-container" data-test="dashboard-edit-actions">
            {editMode && (
              <div css={actionButtonsStyle}>
                <div className="undoRedo">
                  <Tooltip
                    id="dashboard-undo-tooltip"
                    title={t('Undo the action')}
                  >
                    <StyledUndoRedoButton
                      buttonStyle="link"
                      disabled={undoLength < 1}
                      onClick={
                        undoLength > 0 ? boundActionCreators.onUndo : undefined
                      }
                    >
                      <Icons.Undo
                        css={[
                          undoRedoStyle,
                          emphasizeUndo && undoRedoEmphasized,
                          undoLength < 1 && undoRedoDisabled,
                        ]}
                        data-test="undo-action"
                        iconSize="xl"
                      />
                    </StyledUndoRedoButton>
                  </Tooltip>
                  <Tooltip
                    id="dashboard-redo-tooltip"
                    title={t('Redo the action')}
                  >
                    <StyledUndoRedoButton
                      buttonStyle="link"
                      disabled={redoLength < 1}
                      onClick={
                        redoLength > 0 ? boundActionCreators.onRedo : undefined
                      }
                    >
                      <Icons.Redo
                        css={[
                          undoRedoStyle,
                          emphasizeRedo && undoRedoEmphasized,
                          redoLength < 1 && undoRedoDisabled,
                        ]}
                        data-test="redo-action"
                        iconSize="xl"
                      />
                    </StyledUndoRedoButton>
                  </Tooltip>
                </div>
                <Button
                  css={discardBtnStyle}
                  buttonSize="small"
                  onClick={discardChanges}
                  buttonStyle="secondary"
                  data-test="discard-changes-button"
                  aria-label={t('Discard')}
                >
                  {t('Discard')}
                </Button>
                <Button
                  css={saveBtnStyle}
                  buttonSize="small"
                  disabled={!hasUnsavedChanges}
                  buttonStyle="primary"
                  onClick={overwriteDashboard}
                  data-test="header-save-button"
                  aria-label={t('Save')}
                >
                  <Icons.SaveOutlined iconSize="m" />
                  {t('Save')}
                </Button>
              </div>
            )}
          </div>
        )}
        {editMode ? (
          <UndoRedoKeyListeners onUndo={handleCtrlZ} onRedo={handleCtrlY} />
        ) : (
          <div css={actionButtonsStyle}>
            {NavExtension && <NavExtension />}
            {userCanEdit && (
              <Button
                buttonStyle="secondary"
                onClick={() => {
                  toggleEditMode();
                  boundActionCreators.clearDashboardHistory?.(); // Resets the `past` as an empty array
                }}
                data-test="edit-dashboard-button"
                className="action-button"
                css={editButtonStyle}
                aria-label={t('Edit dashboard')}
              >
                {t('Edit dashboard')}
              </Button>
            )}
          </div>
        )}
      </div>
      );
    },
    [
      NavExtension,
      boundActionCreators.onRedo,
      boundActionCreators.onUndo,
      boundActionCreators.clearDashboardHistory,
      editMode,
      emphasizeRedo,
      emphasizeUndo,
      handleCtrlY,
      handleCtrlZ,
      hasUnsavedChanges,
      overwriteDashboard,
      redoLength,
      toggleEditMode,
      undoLength,
      userCanEdit,
      userCanSaveAs,
      isPublicView,
      setFilterDrawerOpen,
    ],
  );

  const handleReportDelete = async report => {
    await dispatch(deleteActiveReport(report));
    setCurrentReportDeleting(null);
  };

  const [menu, isDropdownVisible, setIsDropdownVisible] = useHeaderActionsMenu({
    addSuccessToast: boundActionCreators.addSuccessToast,
    addDangerToast: boundActionCreators.addDangerToast,
    dashboardInfo,
    dashboardId: dashboardInfo.id,
    dashboardTitle,
    dataMask,
    layout,
    expandedSlices,
    customCss,
    colorNamespace,
    colorScheme,
    onSave: boundActionCreators.onSave,
    forceRefreshAllCharts: forceRefresh,
    refreshFrequency,
    shouldPersistRefreshFrequency,
    editMode,
    hasUnsavedChanges,
    userCanEdit,
    userCanShare,
    userCanSave: userCanSaveAs,
    userCanCurate,
    isLoading,
    showReportModal,
    showPropertiesModal,
    showRefreshModal,
    setCurrentReportDeleting,
    manageEmbedded: showEmbedModal,
    lastModifiedTime: actualLastModifiedTime,
    logEvent: boundActionCreators.logEvent,
  });
  return (
    <div
      css={publicHeaderStyle}
      data-test="dashboard-header-container"
      data-test-id={dashboardInfo.id}
      className="dashboard-header-container"
    >
      <PageHeaderWithActions
        editableTitleProps={editableTitleProps}
        certificatiedBadgeProps={certifiedBadgeProps}
        faveStarProps={faveStarProps}
        titlePanelAdditionalItems={titlePanelAdditionalItems}
        rightPanelAdditionalItems={rightPanelAdditionalItems}
        menuDropdownProps={{
          open: isDropdownVisible,
          onOpenChange: setIsDropdownVisible,
        }}
        additionalActionsMenu={menu}
        showMenuDropdown={!isPublicView}
        showFaveStar={!isPublicView && user?.userId && dashboardInfo?.id}
        showTitlePanelItems
      />
      {isPublicView && (
        <Drawer
          rootClassName="pro-filter-drawer"
          title={t('Dashboard Filters')}
          placement="right"
          width={380}
          open={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          styles={{
            body: {
              padding: 0,
            },
          }}
        >
          <FilterBar
            orientation={FilterBarOrientation.Vertical}
            verticalConfig={{
              filtersOpen: true,
              toggleFiltersBar: () => setFilterDrawerOpen(false),
              width: 360,
              height: 'calc(100vh - 64px)',
              offset: 0,
            }}
          />
        </Drawer>
      )}
      {showingPropertiesModal && (
        <PropertiesModal
          dashboardId={dashboardInfo.id}
          dashboardInfo={dashboardInfo}
          dashboardTitle={dashboardTitle}
          show={showingPropertiesModal}
          onHide={hidePropertiesModal}
          colorScheme={colorScheme}
          onSubmit={handleOnPropertiesChange}
          onlyApply
        />
      )}
      {showingRefreshModal && (
        <RefreshIntervalModal
          show={showingRefreshModal}
          onHide={hideRefreshModal}
          refreshFrequency={refreshFrequency}
          onChange={handleRefreshChange}
          editMode={editMode}
          refreshLimit={
            dashboardInfo.common?.conf
              ?.SUPERSET_DASHBOARD_PERIODICAL_REFRESH_LIMIT
          }
          refreshWarning={
            dashboardInfo.common?.conf?.DASHBOARD_AUTO_REFRESH_WARNING_MESSAGE
          }
          addSuccessToast={boundActionCreators.addSuccessToast}
        />
      )}

      <ReportModal
        userId={user.userId}
        show={showingReportModal}
        onHide={hideReportModal}
        userEmail={user.email}
        dashboardId={dashboardInfo.id}
        creationMethod="dashboards"
      />

      {currentReportDeleting && (
        <DeleteModal
          description={t(
            'This action will permanently delete %s.',
            currentReportDeleting?.name,
          )}
          onConfirm={() => {
            if (currentReportDeleting) {
              handleReportDelete(currentReportDeleting);
            }
          }}
          onHide={() => setCurrentReportDeleting(null)}
          open
          title={t('Delete Report?')}
        />
      )}

      <OverwriteConfirm />

      {userCanCurate && (
        <DashboardEmbedModal
          show={showingEmbedModal}
          onHide={hideEmbedModal}
          dashboardId={dashboardInfo.id}
        />
      )}
      <Global
        styles={css`
          .ant-menu-vertical {
            border-right: none;
          }
        `}
      />
      {isPublicView && <Global styles={filterDrawerGlobalStyles} />}
      <Global styles={proPublicPageStyles} />

      <UnsavedChangesModal
        title={t('Save changes to your dashboard?')}
        body={t("If you don't save, changes will be lost.")}
        showModal={showUnsavedChangesModal}
        onHide={() => setShowUnsavedChangesModal(false)}
        onConfirmNavigation={handleConfirmNavigation}
        handleSave={handleSaveAndCloseModal}
      />
    </div>
  );
};

Header.propTypes = {
  isPublicView: PropTypes.bool,
  onBack: PropTypes.func,
  backLabel: PropTypes.string,
  badge: PropTypes.string,
  subtitle: PropTypes.string,
};

Header.defaultProps = {
  isPublicView: false,
  onBack: undefined,
  backLabel: undefined,
  badge: undefined,
  subtitle: undefined,
};

export default Header;
