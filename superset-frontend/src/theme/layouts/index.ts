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
 * Superset Pro Theme — 10 Reusable Layout Templates
 *
 * Layout templates control shell/navigation behavior without altering
 * dashboard creation logic. Each template sets CSS variables and a root
 * class that global styles consume.
 */

import type { DensityTier } from '../density';

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  /** CSS class applied to the app root container */
  rootClass: string;
  /** Navbar height in pixels */
  navbarHeight: number;
  /** Filter bar default position */
  filterBarPosition: 'horizontal' | 'vertical' | 'collapsible';
  /** Whether to show a sidebar (navigation or dashboard list) */
  sidebarEnabled: boolean;
  /** Sidebar width (px) — only used if sidebarEnabled */
  sidebarWidth: number;
  /** Content area padding (px) */
  contentPadding: number;
  /** Default density tier for this layout */
  densityTier: DensityTier;
  /** Whether this layout is intended for public/presentation use */
  publicMode: boolean;
  /** Whether navigation should auto-hide on scroll */
  navAutoHide: boolean;
  /** Whether chart cards should be borderless (full-bleed) */
  borderlessCards: boolean;
}

export const ALL_LAYOUTS: LayoutTemplate[] = [
  {
    id: 'horizontal-executive',
    name: 'Horizontal Executive',
    description: 'Top bar with horizontal filter bar and full-width grid',
    rootClass: 'pro-layout-horizontal-executive',
    navbarHeight: 48,
    filterBarPosition: 'horizontal',
    sidebarEnabled: false,
    sidebarWidth: 0,
    contentPadding: 16,
    densityTier: 'compact',
    publicMode: false,
    navAutoHide: false,
    borderlessCards: false,
  },
  {
    id: 'horizontal-operations',
    name: 'Horizontal Operations',
    description: 'Compact horizontal filters with dense grid for operational dashboards',
    rootClass: 'pro-layout-horizontal-operations',
    navbarHeight: 44,
    filterBarPosition: 'horizontal',
    sidebarEnabled: false,
    sidebarWidth: 0,
    contentPadding: 8,
    densityTier: 'micro',
    publicMode: false,
    navAutoHide: false,
    borderlessCards: false,
  },
  {
    id: 'topbar-sidebar',
    name: 'Topbar + Sidebar',
    description: 'Top bar with collapsible left sidebar for navigation',
    rootClass: 'pro-layout-topbar-sidebar',
    navbarHeight: 48,
    filterBarPosition: 'vertical',
    sidebarEnabled: true,
    sidebarWidth: 240,
    contentPadding: 16,
    densityTier: 'compact',
    publicMode: false,
    navAutoHide: false,
    borderlessCards: false,
  },
  {
    id: 'topbar-mega',
    name: 'Topbar + Mega Menu',
    description: 'Top bar with expandable mega-menu for programme navigation',
    rootClass: 'pro-layout-topbar-mega',
    navbarHeight: 48,
    filterBarPosition: 'horizontal',
    sidebarEnabled: false,
    sidebarWidth: 0,
    contentPadding: 16,
    densityTier: 'compact',
    publicMode: false,
    navAutoHide: false,
    borderlessCards: false,
  },
  {
    id: 'public-minimal',
    name: 'Public Minimal',
    description: 'Minimal chrome for public/presentation dashboards',
    rootClass: 'pro-layout-public-minimal',
    navbarHeight: 52,
    filterBarPosition: 'horizontal',
    sidebarEnabled: false,
    sidebarWidth: 0,
    contentPadding: 20,
    densityTier: 'standard',
    publicMode: true,
    navAutoHide: false,
    borderlessCards: false,
  },
  {
    id: 'map-first',
    name: 'Map First',
    description: 'Maximized map panel with compact side strip for KPIs/tables',
    rootClass: 'pro-layout-map-first',
    navbarHeight: 44,
    filterBarPosition: 'collapsible',
    sidebarEnabled: false,
    sidebarWidth: 0,
    contentPadding: 4,
    densityTier: 'map-focused',
    publicMode: false,
    navAutoHide: true,
    borderlessCards: true,
  },
  {
    id: 'kpi-first',
    name: 'KPI First',
    description: 'Sticky top KPI row with scrollable chart grid below',
    rootClass: 'pro-layout-kpi-first',
    navbarHeight: 48,
    filterBarPosition: 'horizontal',
    sidebarEnabled: false,
    sidebarWidth: 0,
    contentPadding: 12,
    densityTier: 'compact',
    publicMode: false,
    navAutoHide: false,
    borderlessCards: false,
  },
  {
    id: 'analyst-workspace',
    name: 'Analyst Workspace',
    description: 'Dense layout for SQL Lab and data exploration',
    rootClass: 'pro-layout-analyst-workspace',
    navbarHeight: 40,
    filterBarPosition: 'collapsible',
    sidebarEnabled: false,
    sidebarWidth: 0,
    contentPadding: 8,
    densityTier: 'micro',
    publicMode: false,
    navAutoHide: false,
    borderlessCards: false,
  },
  {
    id: 'tabbed-program',
    name: 'Tabbed Program View',
    description: 'Top bar with tab strip for program sections (Overview/Trends/Maps)',
    rootClass: 'pro-layout-tabbed-program',
    navbarHeight: 48,
    filterBarPosition: 'horizontal',
    sidebarEnabled: false,
    sidebarWidth: 0,
    contentPadding: 16,
    densityTier: 'compact',
    publicMode: false,
    navAutoHide: false,
    borderlessCards: false,
  },
  {
    id: 'presentation',
    name: 'Presentation Mode',
    description: 'Full-bleed cards with no chrome — auto-scroll ready',
    rootClass: 'pro-layout-presentation',
    navbarHeight: 0,
    filterBarPosition: 'collapsible',
    sidebarEnabled: false,
    sidebarWidth: 0,
    contentPadding: 0,
    densityTier: 'standard',
    publicMode: true,
    navAutoHide: true,
    borderlessCards: true,
  },
];

export const LAYOUTS_BY_ID: Record<string, LayoutTemplate> = {};
ALL_LAYOUTS.forEach(layout => {
  LAYOUTS_BY_ID[layout.id] = layout;
});

export const DEFAULT_LAYOUT_ID = 'horizontal-executive';

export function getLayout(id: string): LayoutTemplate | undefined {
  return LAYOUTS_BY_ID[id];
}

/**
 * Generate CSS custom property declarations for a layout template.
 */
export function layoutCssVars(layout: LayoutTemplate): string {
  return `
    --pro-layout-navbar-height: ${layout.navbarHeight}px;
    --pro-layout-sidebar-width: ${layout.sidebarEnabled ? layout.sidebarWidth : 0}px;
    --pro-layout-content-padding: ${layout.contentPadding}px;
  `;
}
