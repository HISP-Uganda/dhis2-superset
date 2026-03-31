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
 * Superset Pro Theme — Professional Public-Health Command Center
 *
 * Visual philosophy:
 *   Information-dense, compact, professional analytics UI.
 *   Soft card shadows for depth hierarchy — not flat, not heavy.
 *   Navy/blue brand identity with clinical precision.
 *   Consistent density-driven spacing via CSS custom properties.
 *
 * Surface tiers (light mode):
 *   Canvas:      #F5F7FA  page background
 *   Card/panel:  #FFFFFF  elevated surface (subtle shadow)
 *   Sub-panel:   #F8FAFC  nested section
 *   Navigation:  #0D3B66  deep navy topbar
 *
 * Primary brand palette:
 *   Navy:    #0D3B66   navigation, headings
 *   Blue:    #1976D2   primary interactive
 *   Accent:  #4DA3FF   highlights, links
 */

import { Global, css } from '@emotion/react';
import { useTheme } from '@superset-ui/core';
import { PRO_PALETTE, PRO_SHADOWS, PRO_RADII } from './theme/proTheme';
import { densityCssVars, DEFAULT_DENSITY } from './theme/density';

export function AppGlobalStyles() {
  const theme = useTheme();
  return (
    <Global
      styles={css`
        /* ============================================================
           PRO THEME DESIGN TOKENS — CSS custom properties
           Brand colors are fixed; surface/text/border tokens auto-adapt
           when the user switches dark/light mode via Ant Design theme.
           ============================================================ */
        :root {
          /* ── Brand colors — fixed regardless of mode ────────────── */
          --pro-navy: ${PRO_PALETTE.primaryNavy};
          --pro-navy-light: ${PRO_PALETTE.navyLight};
          --pro-blue: ${PRO_PALETTE.primaryBlue};
          --pro-blue-hover: ${PRO_PALETTE.blueHover};
          --pro-accent: ${PRO_PALETTE.accentBlue};
          --pro-success: ${PRO_PALETTE.success};
          --pro-warning: ${PRO_PALETTE.warning};
          --pro-danger: ${PRO_PALETTE.danger};

          /* ── Surface tokens — auto-adapt to active theme ────────── */
          --pro-canvas: ${theme.colorBgLayout};
          --pro-surface: ${theme.colorBgContainer};
          --pro-sub-surface: ${theme.colorBgElevated};

          /* ── Border tokens ──────────────────────────────────────── */
          --pro-border: ${theme.colorBorderSecondary};
          --pro-border-strong: ${theme.colorBorder};

          /* ── Text tokens ────────────────────────────────────────── */
          --pro-text: ${theme.colorText};
          --pro-text-body: ${theme.colorText};
          --pro-text-secondary: ${theme.colorTextSecondary};
          --pro-text-muted: ${theme.colorTextTertiary};

          /* ── Status backgrounds ─────────────────────────────────── */
          --pro-success-bg: ${theme.colorSuccessBg};
          --pro-danger-bg: ${theme.colorErrorBg};
          --pro-warning-bg: ${theme.colorWarningBg};
          --pro-info-bg: ${theme.colorInfoBg};

          /* ── Shadows ────────────────────────────────────────────── */
          --pro-shadow-card: ${PRO_SHADOWS.card};
          --pro-shadow-card-hover: ${PRO_SHADOWS.cardHover};
          --pro-shadow-dropdown: ${PRO_SHADOWS.dropdown};
          --pro-shadow-modal: ${PRO_SHADOWS.modal};

          /* ── Shape ──────────────────────────────────────────────── */
          --pro-radius-input: ${PRO_RADII.input}px;
          --pro-radius-button: ${PRO_RADII.button}px;
          --pro-radius-card: ${PRO_RADII.card}px;
          --pro-radius-chip: ${PRO_RADII.chip}px;

          /* ── Density (default: compact) ─────────────────────────── */
          ${densityCssVars(DEFAULT_DENSITY)}

          /* ── Layout defaults ────────────────────────────────────── */
          --pro-layout-navbar-height: 48px;
          --pro-layout-sidebar-width: 0px;
          --pro-layout-content-padding: 16px;

          /* ── Backward compatibility aliases ─────────────────────── */
          --sentinel-navy: var(--pro-navy);
          --sentinel-navy-lt: var(--pro-navy-light);
          --sentinel-teal: var(--pro-blue);
          --sentinel-teal-hover: var(--pro-blue-hover);
          --sentinel-critical: var(--pro-danger);
          --sentinel-warning: var(--pro-warning);
          --sentinel-info: var(--pro-accent);
          --sentinel-success: var(--pro-success);
          --sentinel-canvas: var(--pro-canvas);
          --sentinel-surface: var(--pro-surface);
          --sentinel-sub-surface: var(--pro-sub-surface);
          --sentinel-border: var(--pro-border);
          --sentinel-border-strong: var(--pro-border-strong);
          --sentinel-text: var(--pro-text);
          --sentinel-text-body: var(--pro-text-body);
          --sentinel-text-secondary: var(--pro-text-secondary);
          --sentinel-text-muted: var(--pro-text-muted);
          --sentinel-teal-bg: var(--pro-success-bg);
          --sentinel-critical-bg: var(--pro-danger-bg);
          --sentinel-warning-bg: var(--pro-warning-bg);
          --sentinel-info-bg: var(--pro-info-bg);
          --sentinel-success-bg: var(--pro-success-bg);
        }

        /* ============================================================
           GLOBAL RESET
           ============================================================ */
        *,
        *::before,
        *::after {
          box-sizing: border-box;
        }

        body {
          background: var(--pro-canvas);
          color: var(--pro-text-body);
          font-size: var(--pro-density-body-font);
          line-height: 1.5;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* ============================================================
           TYPOGRAPHY — Pro heading hierarchy
           ============================================================ */
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          color: var(--pro-text);
          letter-spacing: -0.2px;
          line-height: 1.25;
          font-weight: 600;
        }

        h1 {
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.4px;
        }
        h2 {
          font-size: 20px;
          letter-spacing: -0.3px;
        }
        h3 {
          font-size: 16px;
          letter-spacing: -0.2px;
        }
        h4 {
          font-size: 14px;
          letter-spacing: -0.1px;
        }

        /* ============================================================
           LAYOUT — Page canvas and content areas
           ============================================================ */
        .ant-layout {
          background: var(--pro-canvas);
        }

        .ant-layout-content {
          background: var(--pro-canvas);
        }

        .page-content-inner {
          padding: var(--pro-layout-content-padding);
          background: var(--pro-canvas);
        }

        /* ============================================================
           CARDS — Subtle shadow, rounded, information-dense
           ============================================================ */
        .ant-card {
          box-shadow: var(--pro-shadow-card);
          border: 1px solid var(--pro-border);
          border-radius: var(--pro-radius-card);
          background: var(--pro-surface);
          transition: box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .ant-card:hover {
          border-color: var(--pro-border-strong);
          box-shadow: var(--pro-shadow-card-hover);
        }

        .ant-card-head {
          border-bottom: 1px solid var(--pro-border);
          font-size: var(--pro-density-chart-title);
          font-weight: 600;
          color: var(--pro-text);
          min-height: 40px;
          padding: 0 var(--pro-density-header-h);
        }

        .ant-card-body {
          padding: var(--pro-density-card-padding);
        }

        /* ============================================================
           DASHBOARD CHART CONTAINERS — Soft shadow, compact
           ============================================================ */
        .dragdroppable-chart,
        .dashboard-chart-container,
        .chart-slice,
        .slice_container {
          box-shadow: var(--pro-shadow-card) !important;
          border: 1px solid var(--pro-border) !important;
          border-radius: var(--pro-radius-card) !important;
          background: var(--pro-surface);
          transition: box-shadow 0.2s ease;
        }

        .dragdroppable-chart:hover,
        .dashboard-chart-container:hover {
          box-shadow: var(--pro-shadow-card-hover) !important;
        }

        /* Chart header / title area */
        .chart-header,
        .slice-header {
          padding: var(--pro-density-header-v) var(--pro-density-header-h) !important;
          border-bottom: 1px solid ${theme.colorBorderSecondary};
        }

        .chart-label,
        .chart-title {
          font-size: var(--pro-density-chart-title) !important;
          font-weight: 600 !important;
          color: var(--pro-text) !important;
          letter-spacing: 0;
        }

        /* ============================================================
           TABLES — Compact, dense, professional
           ============================================================ */
        .ant-table-thead > tr > th {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: ${theme.colorTextSecondary};
          background: var(--pro-canvas) !important;
          border-bottom: 1px solid var(--pro-border) !important;
          padding: 8px 12px;
        }

        .ant-table-tbody > tr > td {
          padding: 8px 12px;
          font-size: 13px;
          border-bottom: 1px solid ${theme.colorBorderSecondary};
          color: var(--pro-text-body);
        }

        .ant-table-tbody > tr:nth-of-type(even) > td {
          background: var(--pro-sub-surface);
        }

        .ant-table-tbody > tr:hover > td {
          background: var(--pro-info-bg) !important;
        }

        .ant-table-tbody > tr:last-child > td {
          border-bottom: none;
        }

        .ant-table-wrapper,
        .ant-table-container {
          box-shadow: none;
        }

        .ant-table {
          border: 1px solid var(--pro-border);
          border-radius: var(--pro-radius-input);
          overflow: hidden;
        }

        .ant-table-row {
          height: var(--pro-density-row-height);
        }

        /* Numeric columns right-aligned */
        .ant-table-cell.ant-table-column-align-right {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        /* Sticky header support */
        .ant-table-sticky-holder {
          z-index: 2;
        }

        /* ============================================================
           PAGINATION — Compact
           ============================================================ */
        .ant-pagination {
          font-size: 13px;
        }

        .ant-pagination .ant-pagination-item,
        .ant-pagination .ant-pagination-prev,
        .ant-pagination .ant-pagination-next {
          min-width: 28px;
          height: 28px;
          line-height: 26px;
          border-radius: var(--pro-radius-input);
          font-size: 13px;
          border-color: var(--pro-border);
        }

        .ant-pagination .ant-pagination-item-active {
          background: var(--pro-blue);
          border-color: var(--pro-blue);
        }

        .ant-pagination .ant-pagination-item-active a {
          color: #ffffff;
        }

        .ant-pagination .ant-pagination-options .ant-select-selector {
          height: 28px !important;
          font-size: 13px;
        }

        /* ============================================================
           TAGS — Compact, pill radius
           ============================================================ */
        .ant-tag {
          font-size: 11px;
          line-height: 18px;
          padding: 0 8px;
          border-radius: var(--pro-radius-chip);
          font-weight: 500;
          letter-spacing: 0.1px;
          box-shadow: none;
        }

        /* ============================================================
           EMPTY STATES
           ============================================================ */
        .ant-empty-description {
          font-size: 13px;
          color: ${theme.colorTextTertiary};
        }

        .ant-empty-image {
          opacity: 0.45;
        }

        /* ============================================================
           FORM ELEMENTS — Compact, 8px radius
           ============================================================ */
        .ant-form-item-label > label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.2px;
          color: ${theme.colorTextSecondary};
          text-transform: uppercase;
        }

        .ant-form-item {
          margin-bottom: 16px;
        }

        .ant-input,
        .ant-input-affix-wrapper,
        .ant-select-selector,
        .ant-picker {
          font-size: 13px !important;
          border-radius: var(--pro-radius-input) !important;
          border-color: var(--pro-border-strong) !important;
          box-shadow: none !important;
        }

        .ant-input:hover,
        .ant-input-affix-wrapper:hover,
        .ant-select:hover .ant-select-selector {
          border-color: var(--pro-blue) !important;
        }

        .ant-input:focus,
        .ant-input-affix-wrapper-focused,
        .ant-select-focused .ant-select-selector,
        .ant-picker-focused {
          border-color: var(--pro-blue) !important;
          box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.15) !important;
        }

        .ant-input-search .ant-input-search-button {
          border-color: var(--pro-border-strong);
        }

        /* ============================================================
           BUTTONS — Blue primary, 8px radius
           ============================================================ */
        .ant-btn-primary {
          background: var(--pro-blue) !important;
          border-color: var(--pro-blue) !important;
          box-shadow: none !important;
          font-weight: 500;
          border-radius: var(--pro-radius-button);
        }

        .ant-btn-primary:hover,
        .ant-btn-primary:focus {
          background: var(--pro-blue-hover) !important;
          border-color: var(--pro-blue-hover) !important;
        }

        .ant-btn {
          box-shadow: none !important;
          font-size: 13px;
          border-radius: var(--pro-radius-button);
        }

        .ant-btn-default {
          border-color: var(--pro-border-strong);
          color: var(--pro-text-body);
        }

        .ant-btn-default:hover {
          border-color: var(--pro-blue);
          color: var(--pro-blue);
          background: var(--pro-info-bg);
        }

        .ant-btn-dangerous {
          color: var(--pro-danger);
          border-color: var(--pro-danger);
          background: transparent;
        }

        .ant-btn-dangerous:hover {
          background: var(--pro-danger-bg);
        }

        /* ============================================================
           MODALS — Professional, subtle shadow
           ============================================================ */
        .ant-modal-content {
          border-radius: var(--pro-radius-card);
          box-shadow: var(--pro-shadow-modal);
          border: 1px solid var(--pro-border);
        }

        .ant-modal-header {
          border-bottom: 1px solid ${theme.colorBorderSecondary};
          padding-bottom: 12px;
          margin-bottom: 0;
          border-radius: var(--pro-radius-card) var(--pro-radius-card) 0 0;
        }

        .ant-modal-title {
          font-size: 15px;
          font-weight: 700;
          letter-spacing: -0.2px;
          color: var(--pro-text);
        }

        .ant-modal-footer {
          border-top: 1px solid var(--pro-border);
          padding: 12px 16px;
        }

        .ant-modal-mask {
          background: rgba(13, 59, 102, 0.45);
        }

        /* ============================================================
           DRAWERS — Compact, professional
           ============================================================ */
        .ant-drawer-content {
          box-shadow: var(--pro-shadow-modal);
        }

        .ant-drawer-header {
          border-bottom: 1px solid ${theme.colorBorderSecondary};
          padding: 12px 16px;
        }

        .ant-drawer-title {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: -0.1px;
          color: var(--pro-text);
        }

        .ant-drawer-body {
          padding: 16px;
        }

        /* ============================================================
           DROPDOWNS AND SELECT PANELS
           ============================================================ */
        .ant-select-dropdown,
        .ant-dropdown-menu,
        .ant-picker-dropdown {
          box-shadow: var(--pro-shadow-dropdown);
          border: 1px solid var(--pro-border);
          border-radius: var(--pro-radius-input);
        }

        .ant-select-item-option-selected:not(.ant-select-item-option-disabled) {
          background: var(--pro-info-bg);
          color: var(--pro-blue);
          font-weight: 500;
        }

        .ant-select-item-option-active:not(.ant-select-item-option-disabled) {
          background: var(--pro-sub-surface);
        }

        .ant-dropdown-menu-item:hover,
        .ant-dropdown-menu-submenu-title:hover {
          background: var(--pro-sub-surface);
        }

        /* ============================================================
           TOOLTIPS
           ============================================================ */
        .ant-tooltip-inner {
          background: var(--pro-navy);
          border-radius: 6px;
          font-size: 12px;
          padding: 6px 10px;
          box-shadow: var(--pro-shadow-dropdown);
        }

        .ant-tooltip-arrow-content::before {
          background: var(--pro-navy);
        }

        /* ============================================================
           POPOVER
           ============================================================ */
        .ant-popover-inner {
          box-shadow: var(--pro-shadow-dropdown);
          border: 1px solid var(--pro-border);
          border-radius: var(--pro-radius-input);
        }

        /* ============================================================
           TABS — Blue underline style
           ============================================================ */
        .ant-tabs-tab {
          font-size: 13px;
          color: var(--pro-text-secondary);
          padding: 8px 0;
        }

        .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn {
          color: var(--pro-text);
          font-weight: 600;
        }

        .ant-tabs-ink-bar {
          background: var(--pro-blue) !important;
          height: 2px !important;
        }

        .ant-tabs-nav::before {
          border-bottom-color: var(--pro-border) !important;
        }

        /* ============================================================
           COLLAPSE / ACCORDION
           ============================================================ */
        .ant-collapse-header {
          font-weight: 600 !important;
          font-size: 13px !important;
          color: var(--pro-text) !important;
          padding: 10px 16px !important;
        }

        .ant-collapse {
          border-color: var(--pro-border);
          border-radius: var(--pro-radius-input);
        }

        .ant-collapse-content {
          border-top-color: var(--pro-border);
        }

        .ant-collapse > .ant-collapse-item {
          border-bottom-color: var(--pro-border);
        }

        /* ============================================================
           MENU ITEMS — Navigation active indicators
           ============================================================ */
        .ant-menu-horizontal > .ant-menu-item-selected::after,
        .ant-menu-horizontal > .ant-menu-item-active::after {
          border-bottom: 2px solid ${theme.colorPrimary} !important;
        }

        .ant-menu-submenu-popup > .ant-menu {
          box-shadow: var(--pro-shadow-dropdown);
          border: 1px solid var(--pro-border);
          border-radius: var(--pro-radius-input);
        }

        /* ============================================================
           ALERTS AND NOTIFICATIONS
           ============================================================ */
        .ant-alert.ant-alert-info {
          border-radius: 0;
          font-size: 13px;
        }

        .ant-alert {
          border-radius: var(--pro-radius-input);
          font-size: 13px;
          box-shadow: none;
        }

        .ant-alert-success {
          background: var(--pro-success-bg);
          border-color: var(--pro-success);
          border-left: 3px solid var(--pro-success);
        }

        .ant-alert-warning {
          background: var(--pro-warning-bg);
          border-color: var(--pro-warning);
          border-left: 3px solid var(--pro-warning);
        }

        .ant-alert-error {
          background: var(--pro-danger-bg);
          border-color: var(--pro-danger);
          border-left: 3px solid var(--pro-danger);
        }

        .ant-alert-info {
          background: var(--pro-info-bg);
          border-color: var(--pro-accent);
        }

        .ant-message-notice-content {
          background: var(--pro-navy);
          color: rgba(255, 255, 255, 0.92);
          font-size: 13px;
          border-radius: var(--pro-radius-input);
          box-shadow: var(--pro-shadow-dropdown);
          border: none;
        }

        /* ============================================================
           BADGES AND STATUS CHIPS — Pro badge system
           ============================================================ */
        .sentinel-badge,
        .pro-badge {
          display: inline-flex;
          align-items: center;
          height: 20px;
          padding: 0 8px;
          border-radius: var(--pro-radius-chip);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.2px;
          white-space: nowrap;
        }

        .sentinel-badge-navy,
        .pro-badge-navy {
          background: var(--pro-navy);
          color: #ffffff;
        }
        .sentinel-badge-teal,
        .pro-badge-primary {
          background: var(--pro-blue);
          color: #ffffff;
        }
        .sentinel-badge-info,
        .pro-badge-info {
          background: var(--pro-accent);
          color: #ffffff;
        }
        .sentinel-badge-warning,
        .pro-badge-warning {
          background: var(--pro-warning);
          color: #ffffff;
        }
        .sentinel-badge-critical,
        .pro-badge-danger {
          background: var(--pro-danger);
          color: #ffffff;
        }
        .sentinel-badge-neutral,
        .pro-badge-neutral {
          background: var(--pro-sub-surface);
          color: var(--pro-text-secondary);
          border: 1px solid var(--pro-border);
        }

        /* ============================================================
           FILTER CHIPS — Applied filter state
           ============================================================ */
        .sentinel-filter-chip,
        .pro-filter-chip {
          display: inline-flex;
          align-items: center;
          height: 24px;
          padding: 0 10px;
          background: var(--pro-info-bg);
          border: 1px solid rgba(25, 118, 210, 0.25);
          border-radius: var(--pro-radius-chip);
          font-size: 12px;
          color: var(--pro-blue);
          font-weight: 500;
          gap: 4px;
          cursor: pointer;
        }

        .sentinel-filter-chip:hover,
        .pro-filter-chip:hover {
          background: rgba(25, 118, 210, 0.12);
        }

        /* Active Superset filter chips */
        .filter-value,
        .ant-tag.filter-tag {
          background: var(--pro-info-bg);
          border-color: rgba(25, 118, 210, 0.25);
          color: var(--pro-blue);
          font-size: 12px;
          font-weight: 500;
        }

        /* ============================================================
           BREADCRUMBS
           ============================================================ */
        .ant-breadcrumb {
          font-size: 12px;
        }

        .ant-breadcrumb-link {
          color: var(--pro-text-secondary);
        }

        .ant-breadcrumb-link:last-child {
          color: var(--pro-text);
          font-weight: 500;
        }

        .ant-breadcrumb-separator {
          color: var(--pro-border-strong);
        }

        /* ============================================================
           LOADING SKELETONS
           ============================================================ */
        .ant-skeleton-element .ant-skeleton-button,
        .ant-skeleton-element .ant-skeleton-input,
        .ant-skeleton-element .ant-skeleton-image {
          background: linear-gradient(
            90deg,
            var(--pro-sub-surface) 25%,
            #edf0f5 50%,
            var(--pro-sub-surface) 75%
          );
          background-size: 400% 100%;
          animation: pro-skeleton-pulse 1.4s ease-in-out infinite;
        }

        .ant-skeleton-content .ant-skeleton-title,
        .ant-skeleton-content .ant-skeleton-paragraph > li {
          background: linear-gradient(
            90deg,
            var(--pro-sub-surface) 25%,
            #edf0f5 50%,
            var(--pro-sub-surface) 75%
          );
          background-size: 400% 100%;
          animation: pro-skeleton-pulse 1.4s ease-in-out infinite;
          border-radius: 2px;
        }

        @keyframes pro-skeleton-pulse {
          0% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }

        /* ============================================================
           SUPERSET-SPECIFIC COMPONENTS
           ============================================================ */

        /* Dashboard filter bar */
        .filter-bar {
          border-right: 1px solid var(--pro-border);
          background: var(--pro-surface);
          box-shadow: none;
        }

        /* Dashboard toolbar */
        .dashboard-header-container {
          border-bottom: 1px solid var(--pro-border);
          background: var(--pro-surface);
          box-shadow: none;
        }

        /* Chart loading state */
        .chart-container .loading {
          background: var(--pro-sub-surface);
        }

        /* Explore page config panel */
        .explore-column {
          border-right: 1px solid var(--pro-border);
          background: var(--pro-surface);
          box-shadow: none;
        }

        /* List view cards */
        .ListViewCard,
        [class*='ListViewCard'] {
          border: 1px solid var(--pro-border) !important;
          border-radius: var(--pro-radius-card) !important;
          box-shadow: var(--pro-shadow-card) !important;
          background: var(--pro-surface);
          transition: box-shadow 0.2s ease, border-color 0.2s ease;
        }

        [class*='ListViewCard']:hover {
          border-color: var(--pro-border-strong) !important;
          box-shadow: var(--pro-shadow-card-hover) !important;
        }

        [class*='CardTitle'],
        [class*='card-title'] {
          font-size: 14px;
          font-weight: 600;
          color: var(--pro-text);
          letter-spacing: -0.1px;
        }

        [class*='CardDescription'],
        [class*='card-description'] {
          font-size: 13px;
          color: var(--pro-text-secondary);
          line-height: 1.5;
        }

        [class*='ListView'] .ant-input-affix-wrapper,
        [class*='ListView'] .ant-select-selector {
          height: var(--pro-density-control-height) !important;
          font-size: 13px;
        }

        /* Table sorting arrows */
        .ant-table-column-sorter {
          color: var(--pro-text-muted);
        }

        .ant-table-column-sorter-up.active,
        .ant-table-column-sorter-down.active {
          color: var(--pro-blue);
        }

        /* ============================================================
           ACCESSIBLE FOCUS RINGS
           ============================================================ */
        *:focus-visible {
          outline: 2px solid var(--pro-blue);
          outline-offset: 2px;
          border-radius: 2px;
        }

        *:focus:not(:focus-visible) {
          outline: none;
        }

        /* ============================================================
           SCROLLBARS — Thin, neutral
           ============================================================ */
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        ::-webkit-scrollbar-track {
          background: transparent;
        }

        ::-webkit-scrollbar-thumb {
          background: var(--pro-border-strong);
          border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: var(--pro-text-muted);
        }

        * {
          scrollbar-width: thin;
          scrollbar-color: var(--pro-border-strong) transparent;
        }

        /* ============================================================
           HOME / LIST PAGES
           ============================================================ */
        .home-content {
          background: var(--pro-canvas);
        }

        [class*='styled__Styles'],
        .dashboard-list,
        .chart-list {
          background: var(--pro-canvas);
        }

        [class*='Actions'] .ant-btn,
        [class*='action-button'] .ant-btn {
          border-color: var(--pro-border);
          height: 28px;
          padding: 0 8px;
          font-size: 12px;
        }

        [class*='FaveStar'] svg,
        [class*='fave-star'] svg {
          color: var(--pro-warning);
        }

        /* ============================================================
           PRO ALERT CARDS — Severity system (utility classes)
           ============================================================ */
        .sentinel-alert-card,
        .pro-alert-card {
          border: 1px solid var(--pro-border);
          border-radius: var(--pro-radius-card);
          background: var(--pro-surface);
          padding: 14px 16px;
          position: relative;
          overflow: hidden;
          box-shadow: var(--pro-shadow-card);
        }

        .sentinel-alert-card::before,
        .pro-alert-card::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
        }

        .sentinel-alert-card.critical::before,
        .pro-alert-card.critical::before {
          background: var(--pro-danger);
        }
        .sentinel-alert-card.warning::before,
        .pro-alert-card.warning::before {
          background: var(--pro-warning);
        }
        .sentinel-alert-card.info::before,
        .pro-alert-card.info::before {
          background: var(--pro-accent);
        }
        .sentinel-alert-card.resolved::before,
        .pro-alert-card.resolved::before {
          background: var(--pro-border-strong);
        }

        /* ============================================================
           PRO KPI TILES — Multi-metric compact cards
           ============================================================ */
        .sentinel-kpi-tile,
        .pro-kpi-tile {
          background: var(--pro-surface);
          border: 1px solid var(--pro-border);
          border-radius: var(--pro-radius-card);
          padding: var(--pro-density-card-padding);
          box-shadow: var(--pro-shadow-card);
        }

        .sentinel-kpi-label,
        .pro-kpi-label {
          font-size: var(--pro-density-kpi-label);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--pro-text-secondary);
          margin-bottom: 4px;
        }

        .sentinel-kpi-value,
        .pro-kpi-value {
          font-size: var(--pro-density-kpi-value);
          font-weight: 700;
          color: var(--pro-text);
          letter-spacing: -0.5px;
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }

        .sentinel-kpi-delta,
        .pro-kpi-delta {
          font-size: 12px;
          font-weight: 500;
          margin-top: 4px;
        }

        .sentinel-kpi-delta.up,
        .pro-kpi-delta.up {
          color: var(--pro-danger);
        }
        .sentinel-kpi-delta.down,
        .pro-kpi-delta.down {
          color: var(--pro-success);
        }
        .sentinel-kpi-delta.neutral,
        .pro-kpi-delta.neutral {
          color: var(--pro-text-secondary);
        }

        .sentinel-kpi-meta,
        .pro-kpi-meta {
          font-size: 11px;
          color: var(--pro-text-muted);
          margin-top: 2px;
        }

        /* Multi-KPI row layout */
        .pro-kpi-row {
          display: flex;
          gap: var(--pro-density-gutter);
          flex-wrap: wrap;
        }

        .pro-kpi-row > .pro-kpi-tile {
          flex: 1;
          min-width: 140px;
        }

        /* ============================================================
           INPUT/SELECT HEIGHT NORMALIZATION
           ============================================================ */
        .ant-input,
        .ant-input-number,
        .ant-picker {
          height: var(--pro-density-control-height);
        }

        .ant-select-single:not(.ant-select-customize-input) .ant-select-selector {
          height: var(--pro-density-control-height) !important;
          padding: 0 11px;
        }

        .ant-select-single:not(.ant-select-customize-input)
          .ant-select-selector
          .ant-select-selection-item,
        .ant-select-single:not(.ant-select-customize-input)
          .ant-select-selector
          .ant-select-selection-placeholder {
          line-height: calc(var(--pro-density-control-height) - 2px);
        }

        /* ============================================================
           STATUS DOTS — Inline status indicators
           ============================================================ */
        .sentinel-status-dot,
        .pro-status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
          vertical-align: middle;
        }

        .sentinel-status-dot.critical,
        .pro-status-dot.critical {
          background: var(--pro-danger);
        }
        .sentinel-status-dot.warning,
        .pro-status-dot.warning {
          background: var(--pro-warning);
        }
        .sentinel-status-dot.success,
        .pro-status-dot.success {
          background: var(--pro-success);
        }
        .sentinel-status-dot.info,
        .pro-status-dot.info {
          background: var(--pro-accent);
        }
        .sentinel-status-dot.neutral,
        .pro-status-dot.neutral {
          background: var(--pro-border-strong);
        }

        /* Outbreak pulse animation */
        .sentinel-outbreak-pulse,
        .pro-outbreak-pulse {
          animation: pro-pulse 1.5s ease-in-out infinite;
        }

        @keyframes pro-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(211, 47, 47, 0.4);
          }
          50% {
            box-shadow: 0 0 0 6px rgba(211, 47, 47, 0);
          }
        }

        /* ============================================================
           LAYOUT TEMPLATE OVERRIDES
           Applied via root class set by the active layout template.
           ============================================================ */

        /* Presentation mode — no chrome, full-bleed */
        .pro-layout-presentation {
          .ant-layout-content {
            padding-top: 0 !important;
          }
          .dashboard-header-container {
            display: none;
          }
          .dragdroppable-chart,
          .dashboard-chart-container {
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
          }
        }

        /* Map-first — maximize map canvas */
        .pro-layout-map-first {
          .dragdroppable-chart,
          .dashboard-chart-container {
            border: none !important;
            box-shadow: none !important;
          }
          .chart-header,
          .slice-header {
            padding: 4px 8px !important;
          }
        }

        /* Analyst workspace — micro density */
        .pro-layout-analyst-workspace {
          .ant-card-body {
            padding: 8px;
          }
          .ant-table-tbody > tr > td {
            padding: 4px 8px;
          }
        }

        /* Operations — micro density */
        .pro-layout-horizontal-operations {
          .ant-card-body {
            padding: 8px;
          }
        }

        /* Public minimal — slightly more breathing room */
        .pro-layout-public-minimal {
          .chart-label,
          .chart-title {
            font-size: 14px !important;
          }
        }
      `}
    />
  );
}
