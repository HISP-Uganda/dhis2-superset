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

import { PublicPageLayoutConfig } from './config';

export type PortalLayoutSettings = {
  portalTitle?: string;
  portalSubtitle?: string;
  welcomeBadge?: string;
  accentColor?: string;
  secondaryColor?: string;
  surfaceColor?: string;
  pageMaxWidth?: number | string;
  showThemeToggle?: boolean;
  lightModeLabel?: string;
  darkModeLabel?: string;
  loginButtonText?: string;
  loginButtonUrl?: string;
  footerText?: string;
  emptyPageMessage?: string;
  noPublicPageMessage?: string;
  dashboardBadgeLabel?: string;
  dashboardEmbedSubtitle?: string;
  dashboardEmbedIntro?: string;
  dashboardBackLabel?: string;
  dashboardLoadingLabel?: string;
};

export type PortalUserRef = {
  id?: number | null;
  username?: string | null;
  name?: string | null;
};

export type PortalMediaAsset = {
  id: number;
  slug: string;
  title: string;
  description?: string | null;
  asset_type?: string;
  mime_type?: string | null;
  file_extension?: string | null;
  original_filename?: string | null;
  file_size?: number | null;
  visibility?: 'private' | 'authenticated' | 'public';
  is_public?: boolean;
  status?: string;
  alt_text?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  settings?: Record<string, any>;
  download_url?: string | null;
  storage_path?: string | null;
  checksum?: string | null;
  archived_on?: string | null;
  created_on?: string | null;
  changed_on?: string | null;
  created_by?: PortalUserRef | null;
  changed_by?: PortalUserRef | null;
  archived_by?: PortalUserRef | null;
};

export type PortalStyleBundle = {
  id: number;
  slug: string;
  title: string;
  description?: string | null;
  status?: string;
  is_active?: boolean;
  variables: Record<string, any>;
  settings: Record<string, any>;
  css_text?: string;
  archived_on?: string | null;
  created_on?: string | null;
  changed_on?: string | null;
  created_by?: PortalUserRef | null;
  changed_by?: PortalUserRef | null;
};

export type PortalTheme = {
  id: number;
  slug: string;
  title: string;
  description?: string | null;
  status?: string;
  is_active?: boolean;
  is_default?: boolean;
  preview_image_url?: string | null;
  style_bundle_id?: number | null;
  tokens: Record<string, any>;
  settings: Record<string, any>;
  style_bundle?: PortalStyleBundle | null;
  archived_on?: string | null;
  created_on?: string | null;
  changed_on?: string | null;
  created_by?: PortalUserRef | null;
  changed_by?: PortalUserRef | null;
};

export type PortalTemplate = {
  id: number;
  slug: string;
  title: string;
  description?: string | null;
  status?: string;
  is_active?: boolean;
  is_default?: boolean;
  theme_id?: number | null;
  style_bundle_id?: number | null;
  structure: Record<string, any>;
  settings: Record<string, any>;
  theme?: PortalTheme | null;
  style_bundle?: PortalStyleBundle | null;
  archived_on?: string | null;
  created_on?: string | null;
  changed_on?: string | null;
  created_by?: PortalUserRef | null;
  changed_by?: PortalUserRef | null;
};

export type PortalRendering = {
  scope_class: string;
  css_text: string;
  css_variables?: Record<string, string>;
  inline_style?: Record<string, any>;
  warnings?: string[];
  theme?: PortalTheme | null;
  template?: PortalTemplate | null;
  style_bundle?: PortalStyleBundle | null;
  template_structure?: Record<string, any>;
};

export type PortalDashboardSummary = {
  id: number;
  uuid?: string | null;
  dashboard_title: string;
  slug: string;
  url: string;
  display_order?: number | null;
};

export type PortalChartSummary = {
  id: number;
  slice_name: string;
  description?: string;
  viz_type?: string;
  url: string;
  is_public?: boolean;
  uses_serving_dataset?: boolean;
};

export type PortalHighlight = {
  indicator_name: string;
  canonical_metric_key?: string | null;
  dataset_name?: string | null;
  instance_name?: string | null;
  period?: string | null;
  value_raw?: number | null;
  value: string;
  ingested_at?: string | null;
};

export type PortalPageSummary = {
  id?: number;
  slug?: string;
  path?: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  excerpt?: string | null;
  is_published: boolean;
  is_homepage: boolean;
  display_order: number;
  parent_page_id?: number | null;
  navigation_label?: string | null;
  theme_id?: number | null;
  template_id?: number | null;
  style_bundle_id?: number | null;
  featured_image_asset_id?: number | null;
  og_image_asset_id?: number | null;
  settings: Record<string, any>;
  status?: string;
  visibility?: 'draft' | 'authenticated' | 'public';
  page_type?: string;
  template_key?: string;
  seo_title?: string | null;
  seo_description?: string | null;
  og_image_url?: string | null;
  featured_image_url?: string | null;
  scheduled_publish_at?: string | null;
  published_on?: string | null;
  archived_on?: string | null;
  created_on?: string | null;
  changed_on?: string | null;
  created_by?: PortalUserRef | null;
  changed_by?: PortalUserRef | null;
  published_by?: PortalUserRef | null;
  archived_by?: PortalUserRef | null;
  parent_page?: {
    id?: number | null;
    slug?: string | null;
    path?: string | null;
    title?: string | null;
    navigation_label?: string | null;
  } | null;
  featured_image_asset?: PortalMediaAsset | null;
  og_image_asset?: PortalMediaAsset | null;
  theme?: PortalTheme | null;
  template?: PortalTemplate | null;
  style_bundle?: PortalStyleBundle | null;
};

export type PortalPageComponent = {
  id?: number;
  component_key?: string;
  component_type: string;
  title?: string | null;
  body?: string | null;
  chart_id?: number | null;
  dashboard_id?: number | null;
  style_bundle_id?: number | null;
  display_order: number;
  is_visible: boolean;
  settings: Record<string, any>;
  chart?: PortalChartSummary | null;
  dashboard?: PortalDashboardSummary | null;
  style_bundle?: PortalStyleBundle | null;
  rendering?: PortalRendering;
};

export type PortalPageBlock = {
  id?: number;
  uid?: string;
  parent_block_id?: number | null;
  block_type: string;
  slot?: string | null;
  sort_order: number;
  tree_path?: string | null;
  depth?: number;
  is_container: boolean;
  visibility?: 'draft' | 'authenticated' | 'public';
  status?: string;
  schema_version?: number;
  style_bundle_id?: number | null;
  content: Record<string, any>;
  settings: Record<string, any>;
  styles: Record<string, any>;
  metadata: Record<string, any>;
  chart?: PortalChartSummary | null;
  dashboard?: PortalDashboardSummary | null;
  asset?: PortalMediaAsset | null;
  reusable_block?: PortalReusableBlock | null;
  children: PortalPageBlock[];
  style_bundle?: PortalStyleBundle | null;
  rendering?: PortalRendering;
};

export type PortalPageSection = {
  id?: number;
  section_key?: string;
  title?: string | null;
  subtitle?: string | null;
  section_type: string;
  style_bundle_id?: number | null;
  display_order: number;
  is_visible: boolean;
  settings: Record<string, any>;
  components: PortalPageComponent[];
  style_bundle?: PortalStyleBundle | null;
  rendering?: PortalRendering;
};

export type PortalPage = PortalPageSummary & {
  status?: string;
  blocks: PortalPageBlock[];
  sections: PortalPageSection[];
  breadcrumbs?: Array<{
    id?: number | null;
    title?: string | null;
    slug?: string | null;
    path?: string | null;
  }>;
  rendering?: PortalRendering;
};

export type PortalBlockDefinition = {
  type: string;
  label: string;
  category: string;
  description?: string;
  icon?: string;
  is_container?: boolean;
};

export type PortalReusableBlock = {
  id: number;
  slug: string;
  title: string;
  description?: string | null;
  category?: string | null;
  status?: string;
  is_active?: boolean;
  block_count?: number;
  settings: Record<string, any>;
  blocks: PortalPageBlock[];
  rendering?: {
    scope_class?: string;
    css_text?: string;
    warnings?: string[];
  };
  archived_on?: string | null;
  created_on?: string | null;
  changed_on?: string | null;
  created_by?: PortalUserRef | null;
  changed_by?: PortalUserRef | null;
  archived_by?: PortalUserRef | null;
};

export type PortalStarterPattern = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  category?: string;
  blocks: PortalPageBlock[];
  rendering?: {
    scope_class?: string;
    css_text?: string;
    warnings?: string[];
  };
};

export type PortalRevision = {
  id: number;
  page_id: number;
  revision_number: number;
  action: string;
  summary?: string | null;
  created_on?: string | null;
  created_by?: PortalUserRef | null;
  snapshot?: PortalPage | null;
};

export type PortalNavigationItem = {
  id: number | string;
  label: string;
  item_type: string;
  icon?: string | null;
  description?: string | null;
  path?: string | null;
  page_id?: number | null;
  dashboard_id?: number | null;
  display_order?: number;
  is_visible?: boolean;
  open_in_new_tab?: boolean;
  visibility?: 'draft' | 'authenticated' | 'public';
  settings?: Record<string, any>;
  children?: PortalNavigationItem[];
};

export type PortalNavigationMenu = {
  id: number;
  slug: string;
  title: string;
  description?: string | null;
  location: string;
  visibility?: 'draft' | 'authenticated' | 'public';
  display_order: number;
  is_enabled?: boolean;
  settings: Record<string, any>;
  items: PortalNavigationItem[];
};

export type PortalUserLayout = {
  id: number;
  page_id: number;
  user_id: number;
  layout: {
    section_order?: number[];
    hidden_section_ids?: number[];
    settings?: Record<string, any>;
  };
  changed_on?: string | null;
};

export type PortalPayload = {
  config: PublicPageLayoutConfig;
  portal_layout: {
    id: number;
    scope: string;
    title: string;
    config: PortalLayoutSettings;
  };
  navigation: {
    header: PortalNavigationMenu[];
    footer: PortalNavigationMenu[];
  };
  pages: PortalPageSummary[];
  current_page: PortalPage | null;
  user_layout?: PortalUserLayout | null;
  dashboards: PortalDashboardSummary[];
  available_charts: PortalChartSummary[];
  permissions: {
    can_customize_layout: boolean;
    can_manage_pages: boolean;
  };
  indicator_highlights: PortalHighlight[];
};

export type PortalAdminPayload = {
  config: PublicPageLayoutConfig;
  portal_layout: {
    id: number;
    scope: string;
    title: string;
    config: PortalLayoutSettings;
  };
  stats: {
    total_pages: number;
    published_pages: number;
    draft_pages: number;
    private_pages: number;
    menus: number;
    chart_enabled_pages: number;
    themes: number;
    templates: number;
    style_bundles: number;
    media_assets?: number;
    reusable_blocks?: number;
  };
  pages: PortalPageSummary[];
  current_page: PortalPage | null;
  menus: {
    header: PortalNavigationMenu[];
    footer: PortalNavigationMenu[];
  };
  dashboards: PortalDashboardSummary[];
  available_charts: PortalChartSummary[];
  media_assets?: PortalMediaAsset[];
  block_types?: PortalBlockDefinition[];
  reusable_blocks?: PortalReusableBlock[];
  starter_patterns?: PortalStarterPattern[];
  themes: PortalTheme[];
  templates: PortalTemplate[];
  style_bundles: PortalStyleBundle[];
  permissions: {
    can_view_pages: boolean;
    can_create_pages: boolean;
    can_edit_pages: boolean;
    can_delete_pages: boolean;
    can_publish_pages: boolean;
    can_manage_media?: boolean;
    can_manage_menus: boolean;
    can_embed_charts: boolean;
    can_manage_layout: boolean;
    can_manage_themes: boolean;
    can_manage_templates: boolean;
    can_manage_styles: boolean;
    can_manage_reusable_blocks?: boolean;
  };
  recent_edits: PortalRevision[];
  recently_published_pages: PortalPageSummary[];
  revisions: PortalRevision[];
};
