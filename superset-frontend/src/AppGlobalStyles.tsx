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
 * Sentinel Design System — Uganda Malaria Elimination & Response Analytics
 *
 * Visual philosophy:
 *   Flat surface hierarchy — depth communicated by background tones, not shadows.
 *   No box-shadow on cards, panels, or containers. Border-only separation.
 *   Compact, dense, operationally efficient analytics layout.
 *   Authoritative, trustworthy, data-first visual language.
 *
 * Surface tiers (light mode):
 *   Canvas:      #F4F6F9  page background
 *   Card/panel:  #FFFFFF  elevated surface
 *   Sub-panel:   #F8FAFC  nested section
 *   Navigation:  #1E2D45  dark navy sidebar/topbar
 *
 * Primary brand palette:
 *   Navy:  #1E2D45   headings, navigation
 *   Teal:  #2B6A6A   primary interactive, success
 *   Slate: #64748B   secondary text, labels
 */

import { Global, css } from '@emotion/react';
import { useTheme } from '@superset-ui/core';

export function AppGlobalStyles() {
  const theme = useTheme();
  return (
    <Global
      styles={css`
        /* ============================================================
           SENTINEL DESIGN TOKENS — CSS custom properties
           ============================================================ */
        :root {
          --sentinel-navy: #1e2d45;
          --sentinel-navy-lt: #2e4a6f;
          --sentinel-teal: #2b6a6a;
          --sentinel-teal-hover: #245858;
          --sentinel-teal-bg: #edf6f6;
          --sentinel-canvas: #f4f6f9;
          --sentinel-surface: #ffffff;
          --sentinel-sub-surface: #f8fafc;
          --sentinel-border: #e2e8f0;
          --sentinel-border-strong: #cbd5e0;
          --sentinel-text: #1e2d45;
          --sentinel-text-body: #374151;
          --sentinel-text-secondary: #64748b;
          --sentinel-text-muted: #94a3b0;
          --sentinel-critical: #a83232;
          --sentinel-critical-bg: #fbeded;
          --sentinel-warning: #b07d1a;
          --sentinel-warning-bg: #fbf5e6;
          --sentinel-info: #2e5fa3;
          --sentinel-info-bg: #ebf2fc;
          --sentinel-success: #2b6a6a;
          --sentinel-success-bg: #edf6f6;
        }

        /* ============================================================
           GLOBAL RESET — Sentinel baseline
           ============================================================ */
        *,
        *::before,
        *::after {
          box-sizing: border-box;
        }

        body {
          background: var(--sentinel-canvas);
          color: var(--sentinel-text-body);
          font-size: 14px;
          line-height: 1.5;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* ============================================================
           TYPOGRAPHY — Sentinel heading hierarchy
           ============================================================ */
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          color: var(--sentinel-text);
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
          background: var(--sentinel-canvas);
        }

        .ant-layout-content {
          background: var(--sentinel-canvas);
        }

        /* Consistent page content padding */
        .page-content-inner {
          padding: ${theme.sizeUnit * 5}px;
          background: var(--sentinel-canvas);
        }

        /* ============================================================
           CARDS — Flat, no shadow, border-only elevation
           ============================================================ */
        .ant-card {
          box-shadow: none;
          border: 1px solid var(--sentinel-border);
          border-radius: 6px;
          background: var(--sentinel-surface);
        }

        .ant-card:hover {
          border-color: var(--sentinel-border-strong);
          background: #fafcff;
        }

        .ant-card-head {
          border-bottom: 1px solid var(--sentinel-border);
          font-size: 13px;
          font-weight: 600;
          color: var(--sentinel-text);
          min-height: 40px;
          padding: 0 16px;
        }

        .ant-card-body {
          padding: 16px;
        }

        /* ============================================================
           DASHBOARD CHART CONTAINERS — Flat, compact
           ============================================================ */
        .dragdroppable-chart,
        .dashboard-chart-container,
        .chart-slice,
        .slice_container {
          box-shadow: none !important;
          border: 1px solid var(--sentinel-border) !important;
          border-radius: 6px !important;
          background: var(--sentinel-surface);
        }

        /* Chart header / title area */
        .chart-header,
        .slice-header {
          padding: 10px 16px 8px !important;
          border-bottom: 1px solid ${theme.colorBorderSecondary};
        }

        .chart-label,
        .chart-title {
          font-size: 13px !important;
          font-weight: 600 !important;
          color: var(--sentinel-text) !important;
          letter-spacing: 0;
        }

        /* ============================================================
           TABLES — Compact, flat, professional
           ============================================================ */

        /* Table header — uppercase compact */
        .ant-table-thead > tr > th {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: ${theme.colorTextSecondary};
          background: var(--sentinel-canvas) !important;
          border-bottom: 1px solid var(--sentinel-border) !important;
          padding: 8px 12px;
        }

        /* Table body rows */
        .ant-table-tbody > tr > td {
          padding: 8px 12px;
          font-size: 13px;
          border-bottom: 1px solid ${theme.colorBorderSecondary};
          color: var(--sentinel-text-body);
        }

        /* Alternating row background */
        .ant-table-tbody > tr:nth-child(even) > td {
          background: var(--sentinel-sub-surface);
        }

        /* Row hover */
        .ant-table-tbody > tr:hover > td {
          background: var(--sentinel-teal-bg) !important;
        }

        /* No border on last row */
        .ant-table-tbody > tr:last-child > td {
          border-bottom: none;
        }

        /* Table wrapper — no shadow */
        .ant-table-wrapper,
        .ant-table-container {
          box-shadow: none;
        }

        .ant-table {
          border: 1px solid var(--sentinel-border);
          border-radius: 6px;
          overflow: hidden;
        }

        /* Fixed height for all table rows */
        .ant-table-row {
          height: 36px;
        }

        /* ============================================================
           PAGINATION — Compact 28px, solid active page
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
          border-radius: ${theme.borderRadius}px;
          font-size: 13px;
          border-color: var(--sentinel-border);
        }

        .ant-pagination .ant-pagination-item-active {
          background: var(--sentinel-teal);
          border-color: var(--sentinel-teal);
        }

        .ant-pagination .ant-pagination-item-active a {
          color: #ffffff;
        }

        .ant-pagination .ant-pagination-options .ant-select-selector {
          height: 28px !important;
          font-size: 13px;
        }

        /* ============================================================
           TAGS — Compact, Sentinel palette
           ============================================================ */
        .ant-tag {
          font-size: 11px;
          line-height: 18px;
          padding: 0 6px;
          border-radius: 3px;
          font-weight: 500;
          letter-spacing: 0.1px;
          box-shadow: none;
        }

        /* ============================================================
           EMPTY STATES — Recessive
           ============================================================ */
        .ant-empty-description {
          font-size: 13px;
          color: ${theme.colorTextTertiary};
        }

        .ant-empty-image {
          opacity: 0.45;
        }

        /* ============================================================
           FORM ELEMENTS — Sentinel compact
           ============================================================ */

        /* Form labels — uppercase compact */
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

        /* Inputs and selects */
        .ant-input,
        .ant-input-affix-wrapper,
        .ant-select-selector,
        .ant-picker {
          font-size: 13px !important;
          border-radius: ${theme.borderRadius}px !important;
          border-color: var(--sentinel-border-strong) !important;
          box-shadow: none !important;
        }

        .ant-input:hover,
        .ant-input-affix-wrapper:hover,
        .ant-select:hover .ant-select-selector {
          border-color: var(--sentinel-teal) !important;
        }

        .ant-input:focus,
        .ant-input-affix-wrapper-focused,
        .ant-select-focused .ant-select-selector,
        .ant-picker-focused {
          border-color: var(--sentinel-teal) !important;
          box-shadow: 0 0 0 2px rgba(43, 106, 106, 0.12) !important;
        }

        /* Search inputs */
        .ant-input-search .ant-input-search-button {
          border-color: var(--sentinel-border-strong);
        }

        /* ============================================================
           BUTTONS — Sentinel hierarchy
           ============================================================ */

        /* Primary — teal */
        .ant-btn-primary {
          background: var(--sentinel-teal) !important;
          border-color: var(--sentinel-teal) !important;
          box-shadow: none !important;
          font-weight: 500;
        }

        .ant-btn-primary:hover,
        .ant-btn-primary:focus {
          background: var(--sentinel-teal-hover) !important;
          border-color: var(--sentinel-teal-hover) !important;
        }

        /* All buttons — no shadow */
        .ant-btn {
          box-shadow: none !important;
          font-size: 13px;
          border-radius: ${theme.borderRadius}px;
        }

        /* Secondary / default button */
        .ant-btn-default {
          border-color: var(--sentinel-border-strong);
          color: var(--sentinel-text-body);
        }

        .ant-btn-default:hover {
          border-color: var(--sentinel-teal);
          color: var(--sentinel-teal);
          background: var(--sentinel-teal-bg);
        }

        /* Danger button */
        .ant-btn-dangerous {
          color: var(--sentinel-critical);
          border-color: var(--sentinel-critical);
          background: transparent;
        }

        .ant-btn-dangerous:hover {
          background: var(--sentinel-critical-bg);
        }

        /* ============================================================
           MODALS — Flat, professional
           ============================================================ */
        .ant-modal-content {
          border-radius: ${theme.borderRadiusLG}px;
          box-shadow: none;
          border: 1px solid var(--sentinel-border);
        }

        .ant-modal-header {
          border-bottom: 1px solid ${theme.colorBorderSecondary};
          padding-bottom: 12px;
          margin-bottom: 0;
          border-radius: ${theme.borderRadiusLG}px ${theme.borderRadiusLG}px 0 0;
        }

        .ant-modal-title {
          font-size: 15px;
          font-weight: 700;
          letter-spacing: -0.2px;
          color: var(--sentinel-text);
        }

        .ant-modal-footer {
          border-top: 1px solid var(--sentinel-border);
          padding: 12px 16px;
        }

        .ant-modal-mask {
          background: rgba(14, 22, 40, 0.5);
        }

        /* ============================================================
           DRAWERS — Flat, compact
           ============================================================ */
        .ant-drawer-content {
          box-shadow: none;
        }

        .ant-drawer-header {
          border-bottom: 1px solid ${theme.colorBorderSecondary};
          padding: 12px 16px;
        }

        .ant-drawer-title {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: -0.1px;
          color: var(--sentinel-text);
        }

        .ant-drawer-body {
          padding: 16px;
        }

        /* ============================================================
           DROPDOWNS AND SELECT PANELS — Flat, no shadow
           ============================================================ */
        .ant-select-dropdown,
        .ant-dropdown-menu,
        .ant-picker-dropdown {
          box-shadow: none;
          border: 1px solid var(--sentinel-border);
          border-radius: ${theme.borderRadius}px;
        }

        .ant-select-item-option-selected:not(.ant-select-item-option-disabled) {
          background: var(--sentinel-teal-bg);
          color: var(--sentinel-teal);
          font-weight: 500;
        }

        .ant-select-item-option-active:not(.ant-select-item-option-disabled) {
          background: var(--sentinel-sub-surface);
        }

        .ant-dropdown-menu-item:hover,
        .ant-dropdown-menu-submenu-title:hover {
          background: var(--sentinel-sub-surface);
        }

        /* ============================================================
           TOOLTIPS — Dark navy
           ============================================================ */
        .ant-tooltip-inner {
          background: var(--sentinel-navy);
          border-radius: 4px;
          font-size: 12px;
          padding: 6px 10px;
          box-shadow: none;
        }

        .ant-tooltip-arrow-content::before {
          background: var(--sentinel-navy);
        }

        /* ============================================================
           POPOVER — Flat panel
           ============================================================ */
        .ant-popover-inner {
          box-shadow: none;
          border: 1px solid var(--sentinel-border);
          border-radius: ${theme.borderRadius}px;
        }

        /* ============================================================
           TABS — Sentinel underline style
           ============================================================ */
        .ant-tabs-tab {
          font-size: 13px;
          color: var(--sentinel-text-secondary);
          padding: 8px 0;
        }

        .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn {
          color: var(--sentinel-text);
          font-weight: 600;
        }

        .ant-tabs-ink-bar {
          background: var(--sentinel-teal) !important;
          height: 2px !important;
        }

        .ant-tabs-nav::before {
          border-bottom-color: var(--sentinel-border) !important;
        }

        /* ============================================================
           COLLAPSE / ACCORDION — Sentinel compact
           ============================================================ */
        .ant-collapse-header {
          font-weight: 600 !important;
          font-size: 13px !important;
          color: var(--sentinel-text) !important;
          padding: 10px 16px !important;
        }

        .ant-collapse {
          border-color: var(--sentinel-border);
          border-radius: 6px;
        }

        .ant-collapse-content {
          border-top-color: var(--sentinel-border);
        }

        .ant-collapse > .ant-collapse-item {
          border-bottom-color: var(--sentinel-border);
        }

        /* ============================================================
           MENU ITEMS — Navigation active indicators
           ============================================================ */

        /* SubMenu active tab indicator */
        .ant-menu-horizontal > .ant-menu-item-selected::after,
        .ant-menu-horizontal > .ant-menu-item-active::after {
          border-bottom: 2px solid ${theme.colorPrimary} !important;
        }

        /* Submenu popup panels — no shadow */
        .ant-menu-submenu-popup > .ant-menu {
          box-shadow: none;
          border: 1px solid var(--sentinel-border);
          border-radius: ${theme.borderRadius}px;
        }

        /* ============================================================
           ALERTS AND NOTIFICATIONS
           ============================================================ */

        /* Bulk-select alert bar */
        .ant-alert.ant-alert-info {
          border-radius: 0;
          font-size: 13px;
        }

        /* Alert types — left-border severity convention */
        .ant-alert {
          border-radius: 6px;
          font-size: 13px;
          box-shadow: none;
        }

        .ant-alert-success {
          background: var(--sentinel-success-bg);
          border-color: var(--sentinel-teal);
          border-left: 3px solid var(--sentinel-teal);
        }

        .ant-alert-warning {
          background: var(--sentinel-warning-bg);
          border-color: var(--sentinel-warning);
          border-left: 3px solid var(--sentinel-warning);
        }

        .ant-alert-error {
          background: var(--sentinel-critical-bg);
          border-color: var(--sentinel-critical);
          border-left: 3px solid var(--sentinel-critical);
        }

        .ant-alert-info {
          background: var(--sentinel-info-bg);
          border-color: var(--sentinel-info);
        }

        /* Notification messages */
        .ant-message-notice-content {
          background: var(--sentinel-navy);
          color: rgba(255, 255, 255, 0.92);
          font-size: 13px;
          border-radius: 6px;
          box-shadow: none;
          border: none;
        }

        /* ============================================================
           BADGES AND STATUS CHIPS — Role badge system
           ============================================================ */
        .sentinel-badge {
          display: inline-flex;
          align-items: center;
          height: 20px;
          padding: 0 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.2px;
          white-space: nowrap;
        }

        .sentinel-badge-navy {
          background: var(--sentinel-navy);
          color: #ffffff;
        }
        .sentinel-badge-teal {
          background: var(--sentinel-teal);
          color: #ffffff;
        }
        .sentinel-badge-info {
          background: var(--sentinel-info);
          color: #ffffff;
        }
        .sentinel-badge-warning {
          background: var(--sentinel-warning);
          color: #ffffff;
        }
        .sentinel-badge-critical {
          background: var(--sentinel-critical);
          color: #ffffff;
        }
        .sentinel-badge-neutral {
          background: var(--sentinel-sub-surface);
          color: var(--sentinel-text-secondary);
          border: 1px solid var(--sentinel-border);
        }

        /* ============================================================
           FILTER CHIPS — Applied filter state
           ============================================================ */
        .sentinel-filter-chip {
          display: inline-flex;
          align-items: center;
          height: 24px;
          padding: 0 8px;
          background: var(--sentinel-teal-bg);
          border: 1px solid rgba(43, 106, 106, 0.35);
          border-radius: 4px;
          font-size: 12px;
          color: var(--sentinel-teal);
          font-weight: 500;
          gap: 4px;
          cursor: pointer;
        }

        .sentinel-filter-chip:hover {
          background: rgba(43, 106, 106, 0.15);
        }

        /* Active Superset filter chips */
        .filter-value,
        .ant-tag.filter-tag {
          background: var(--sentinel-teal-bg);
          border-color: rgba(43, 106, 106, 0.35);
          color: var(--sentinel-teal);
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
          color: var(--sentinel-text-secondary);
        }

        .ant-breadcrumb-link:last-child {
          color: var(--sentinel-text);
          font-weight: 500;
        }

        .ant-breadcrumb-separator {
          color: var(--sentinel-border-strong);
        }

        /* ============================================================
           LOADING SKELETONS — Sentinel pulse
           ============================================================ */
        .ant-skeleton-element .ant-skeleton-button,
        .ant-skeleton-element .ant-skeleton-input,
        .ant-skeleton-element .ant-skeleton-image {
          background: linear-gradient(
            90deg,
            var(--sentinel-sub-surface) 25%,
            #edf0f5 50%,
            var(--sentinel-sub-surface) 75%
          );
          background-size: 400% 100%;
          animation: sentinel-skeleton-pulse 1.4s ease-in-out infinite;
        }

        .ant-skeleton-content .ant-skeleton-title,
        .ant-skeleton-content .ant-skeleton-paragraph > li {
          background: linear-gradient(
            90deg,
            var(--sentinel-sub-surface) 25%,
            #edf0f5 50%,
            var(--sentinel-sub-surface) 75%
          );
          background-size: 400% 100%;
          animation: sentinel-skeleton-pulse 1.4s ease-in-out infinite;
          border-radius: 2px;
        }

        @keyframes sentinel-skeleton-pulse {
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
          border-right: 1px solid var(--sentinel-border);
          background: var(--sentinel-surface);
          box-shadow: none;
        }

        /* Dashboard toolbar */
        .dashboard-header-container {
          border-bottom: 1px solid var(--sentinel-border);
          background: var(--sentinel-surface);
          box-shadow: none;
        }

        /* Chart loading state */
        .chart-container .loading {
          background: var(--sentinel-sub-surface);
        }

        /* Explore page config panel */
        .explore-column {
          border-right: 1px solid var(--sentinel-border);
          background: var(--sentinel-surface);
          box-shadow: none;
        }

        /* List view cards (dashboard list, chart list) */
        .ListViewCard,
        [class*='ListViewCard'] {
          border: 1px solid var(--sentinel-border) !important;
          border-radius: 6px !important;
          box-shadow: none !important;
          background: var(--sentinel-surface);
          transition: border-color 0.15s ease;
        }

        [class*='ListViewCard']:hover {
          border-color: var(--sentinel-border-strong) !important;
          background: #fafcff;
        }

        /* List view card title */
        [class*='CardTitle'],
        [class*='card-title'] {
          font-size: 14px;
          font-weight: 600;
          color: var(--sentinel-text);
          letter-spacing: -0.1px;
        }

        /* List view card meta text */
        [class*='CardDescription'],
        [class*='card-description'] {
          font-size: 13px;
          color: var(--sentinel-text-secondary);
          line-height: 1.5;
        }

        /* List view header search / filter bar */
        [class*='ListView'] .ant-input-affix-wrapper,
        [class*='ListView'] .ant-select-selector {
          height: 32px !important;
          font-size: 13px;
        }

        /* Table sorting arrows */
        .ant-table-column-sorter {
          color: var(--sentinel-text-muted);
        }

        .ant-table-column-sorter-up.active,
        .ant-table-column-sorter-down.active {
          color: var(--sentinel-teal);
        }

        /* ============================================================
           ACCESSIBLE FOCUS RINGS
           ============================================================ */
        *:focus-visible {
          outline: 2px solid var(--sentinel-teal);
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
          background: var(--sentinel-border-strong);
          border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: var(--sentinel-text-muted);
        }

        * {
          scrollbar-width: thin;
          scrollbar-color: var(--sentinel-border-strong) transparent;
        }

        /* ============================================================
           SUPERSET SPECIFIC — Home page and welcome screen
           ============================================================ */

        /* Welcome page activity feed */
        .home-content {
          background: var(--sentinel-canvas);
        }

        /* Dashboard list / chart list page background */
        [class*='styled__Styles'],
        .dashboard-list,
        .chart-list {
          background: var(--sentinel-canvas);
        }

        /* Action buttons in list views */
        [class*='Actions'] .ant-btn,
        [class*='action-button'] .ant-btn {
          border-color: var(--sentinel-border);
          height: 28px;
          padding: 0 8px;
          font-size: 12px;
        }

        /* Starred icon */
        [class*='FaveStar'] svg,
        [class*='fave-star'] svg {
          color: var(--sentinel-warning);
        }

        /* ============================================================
           SENTINEL ALERT CARDS — Severity system (utility classes)
           ============================================================ */
        .sentinel-alert-card {
          border: 1px solid var(--sentinel-border);
          border-radius: 8px;
          background: var(--sentinel-surface);
          padding: 14px 16px;
          position: relative;
          overflow: hidden;
        }

        .sentinel-alert-card::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
        }

        .sentinel-alert-card.critical::before {
          background: var(--sentinel-critical);
        }
        .sentinel-alert-card.warning::before {
          background: var(--sentinel-warning);
        }
        .sentinel-alert-card.info::before {
          background: var(--sentinel-info);
        }
        .sentinel-alert-card.resolved::before {
          background: var(--sentinel-border-strong);
        }

        /* ============================================================
           SENTINEL KPI TILES — Utility classes
           ============================================================ */
        .sentinel-kpi-tile {
          background: var(--sentinel-surface);
          border: 1px solid var(--sentinel-border);
          border-radius: 6px;
          padding: 12px 16px;
          min-height: 92px;
        }

        .sentinel-kpi-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--sentinel-text-secondary);
          margin-bottom: 4px;
        }

        .sentinel-kpi-value {
          font-size: 28px;
          font-weight: 700;
          color: var(--sentinel-text);
          letter-spacing: -0.5px;
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }

        .sentinel-kpi-delta {
          font-size: 12px;
          font-weight: 500;
          margin-top: 4px;
        }

        .sentinel-kpi-delta.up {
          color: var(--sentinel-critical);
        }
        .sentinel-kpi-delta.down {
          color: var(--sentinel-teal);
        }
        .sentinel-kpi-delta.neutral {
          color: var(--sentinel-text-secondary);
        }

        .sentinel-kpi-meta {
          font-size: 11px;
          color: var(--sentinel-text-muted);
          margin-top: 2px;
        }

        /* ============================================================
           INPUT/SELECT HEIGHT NORMALIZATION
           ============================================================ */
        .ant-input,
        .ant-input-number,
        .ant-picker {
          height: 32px;
        }

        .ant-select-single:not(.ant-select-customize-input) .ant-select-selector {
          height: 32px !important;
          padding: 0 11px;
        }

        .ant-select-single:not(.ant-select-customize-input)
          .ant-select-selector
          .ant-select-selection-item,
        .ant-select-single:not(.ant-select-customize-input)
          .ant-select-selector
          .ant-select-selection-placeholder {
          line-height: 30px;
        }

        /* ============================================================
           STATUS DOTS — Inline status indicators
           ============================================================ */
        .sentinel-status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
          vertical-align: middle;
        }

        .sentinel-status-dot.critical {
          background: var(--sentinel-critical);
        }
        .sentinel-status-dot.warning {
          background: var(--sentinel-warning);
        }
        .sentinel-status-dot.success {
          background: var(--sentinel-teal);
        }
        .sentinel-status-dot.info {
          background: var(--sentinel-info);
        }
        .sentinel-status-dot.neutral {
          background: var(--sentinel-border-strong);
        }

        /* Outbreak pulse animation — reserved for confirmed outbreak only */
        .sentinel-outbreak-pulse {
          animation: sentinel-pulse 1.5s ease-in-out infinite;
        }

        @keyframes sentinel-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(168, 50, 50, 0.4);
          }
          50% {
            box-shadow: 0 0 0 6px rgba(168, 50, 50, 0);
          }
        }
      `}
    />
  );
}
