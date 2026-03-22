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
/* eslint-disable no-restricted-imports, theme-colors/no-literal-colors, import/no-extraneous-dependencies */

import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import {
  getClientErrorObject,
  styled,
  SupersetClient,
  t,
} from '@superset-ui/core';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  BgColorsOutlined,
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileTextOutlined,
  FilterOutlined,
  FundProjectionScreenOutlined,
  GlobalOutlined,
  LayoutOutlined,
  MenuOutlined,
  PlusOutlined,
  RocketOutlined,
  SaveOutlined,
  SearchOutlined,
  SettingOutlined,
  SkinOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Badge,
  Button,
  Empty,
  Input,
  InputNumber,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  message,
} from 'antd';
import { useHistory, useLocation } from 'react-router-dom';
import getBootstrapData from 'src/utils/getBootstrapData';
import { userHasPermission } from 'src/dashboard/util/permissionUtils';
import {
  createDraftPage,
  createEmptySection,
  normalizeDraftPage,
  resolvePortalPagePath,
} from 'src/pages/PublicLandingPage/portalUtils';
import type {
  PortalAdminPayload,
  PortalBlockDefinition,
  PortalNavigationItem,
  PortalNavigationMenu,
  PortalPage,
  PortalPageSummary,
  PortalReusableBlock,
  PortalStarterPattern,
  PortalStyleBundle,
  PortalTemplate,
  PortalTheme,
} from 'src/pages/PublicLandingPage/types';
import BlockStudio from './BlockStudio';
import {
  buildPublishPagePayload,
  buildPublishStatePayload,
} from './publishPayload';

type AdminTab =
  | 'overview'
  | 'pages'
  | 'studio'
  | 'media'
  | 'menus'
  | 'portal'
  | 'themes'
  | 'templates'
  | 'styles';

const PAGE_QUERY_PARAM = 'page';
const TAB_QUERY_PARAM = 'tab';
const EMPTY_BLOCK_TYPES: PortalBlockDefinition[] = [];
const EMPTY_REUSABLE_BLOCKS: PortalReusableBlock[] = [];
const EMPTY_STARTER_PATTERNS: PortalStarterPattern[] = [];

const SHELL_STYLE: CSSProperties = {
  minHeight: '100vh',
  background: '#f0f2f5',
};

const AdminShell = styled.div`
  min-height: 100vh;
  color: #172b4d;
`;

const TopBar = styled.header`
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: #1e293b;
  color: #f8fafc;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
`;

const TopBarBrand = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
`;

const TopBarBrandIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #0f766e;
  color: #ffffff;
  font-size: 18px;
`;

const TopBarActions = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const ShellBody = styled.div`
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  min-height: calc(100vh - 65px);

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

const LeftRail = styled.aside`
  position: sticky;
  top: 65px;
  align-self: start;
  height: calc(100vh - 65px);
  overflow-y: auto;
  padding: 20px 16px 28px;
  background: #ffffff;
  border-right: 1px solid rgba(148, 163, 184, 0.24);

  @media (max-width: 1080px) {
    position: static;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.24);
  }
`;

const RailSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 22px;
`;

const RailLabel = styled.div`
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #64748b;
`;

const RailButton = styled.button<{ $active?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border: 0;
  border-radius: 12px;
  background: ${({ $active }) => ($active ? '#e2e8f0' : 'transparent')};
  color: ${({ $active }) => ($active ? '#0f172a' : '#334155')};
  font-weight: ${({ $active }) => ($active ? 700 : 600)};
  cursor: pointer;
  text-align: left;

  &:hover {
    background: ${({ $active }) => ($active ? '#e2e8f0' : '#f8fafc')};
  }
`;

const RailButtonContent = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const ShellMain = styled.main`
  padding: 24px;

  @media (max-width: 720px) {
    padding: 16px;
  }
`;

const ContentStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
`;

const TitleGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Eyebrow = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colorTextLabel};
`;

const Title = styled.h1`
  margin: 0;
  font-size: 30px;
  line-height: 1.1;
  letter-spacing: -0.04em;
`;

const Subtitle = styled.p`
  margin: 0;
  max-width: 72ch;
  color: ${({ theme }) => theme.colorTextSecondary};
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
`;

const StatCard = styled.div`
  padding: 18px;
  border-radius: 18px;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.05);
`;

const StatValue = styled.div`
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.04em;
`;

const StatLabel = styled.div`
  margin-top: 6px;
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: 13px;
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Panel = styled.div`
  padding: 18px;
  border-radius: 20px;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.05);
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
`;

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 700;
`;

const SectionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ComponentCard = styled.button<{ $active?: boolean; $depth?: number }>`
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  margin-left: ${({ $depth = 0 }) => $depth * 12}px;
  border-radius: 12px;
  border: 1px solid
    ${({ $active }) =>
      $active ? 'rgba(29, 78, 216, 0.34)' : 'rgba(148, 163, 184, 0.18)'};
  background: ${({ $active }) =>
    $active ? 'rgba(29, 78, 216, 0.07)' : '#ffffff'};
  cursor: pointer;
`;

const TinyMeta = styled.div`
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: 12px;
`;

const FieldLabel = styled.div`
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colorTextLabel};
`;

const FieldBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const PreviewTitle = styled.h3`
  margin: 0 0 8px;
  font-size: 18px;
  letter-spacing: -0.02em;
`;

const RevisionList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
`;

const RevisionCard = styled.div`
  padding: 16px;
  border-radius: 16px;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.22);
`;

const PagesToolbar = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const PagesToolbarFilters = styled.div`
  display: grid;
  grid-template-columns: minmax(220px, 1.3fr) repeat(2, minmax(160px, 0.8fr));
  gap: 12px;
  flex: 1;

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
    width: 100%;
  }
`;

const PagesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
`;

const PageCard = styled.div<{ $active?: boolean }>`
  width: 100%;
  text-align: left;
  padding: 18px;
  border-radius: 16px;
  border: 1px solid
    ${({ $active }) =>
      $active ? 'rgba(15, 118, 110, 0.34)' : 'rgba(148, 163, 184, 0.22)'};
  background: ${({ $active }) => ($active ? '#f0fdfa' : '#ffffff')};
  cursor: pointer;
`;

const PageCardMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const PageCardActions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
`;

const DesignLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr);
  gap: 16px;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
  }
`;

const DesignCard = styled.div<{ $active?: boolean }>`
  width: 100%;
  text-align: left;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid
    ${({ $active }) =>
      $active ? 'rgba(15, 118, 110, 0.34)' : 'rgba(148, 163, 184, 0.22)'};
  background: ${({ $active }) =>
    $active ? 'rgba(15, 118, 110, 0.08)' : '#ffffff'};
  cursor: pointer;
`;

const TokenPreview = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
`;

const TokenSwatch = styled.div`
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: #f8fafc;
`;

const bootstrapData = getBootstrapData();

const buildCmsSearch = ({
  pageSlug,
  tab,
}: {
  pageSlug?: string | null;
  tab?: AdminTab | null;
}) => {
  const params = new URLSearchParams();
  if (pageSlug) {
    params.set(PAGE_QUERY_PARAM, pageSlug);
  }
  if (tab) {
    params.set(TAB_QUERY_PARAM, tab);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
};

const readPageSlug = (search: string) =>
  new URLSearchParams(search).get(PAGE_QUERY_PARAM);

const readAdminTab = (search: string): AdminTab => {
  const value = new URLSearchParams(search).get(TAB_QUERY_PARAM);
  if (
    value === 'pages' ||
    value === 'studio' ||
    value === 'media' ||
    value === 'menus' ||
    value === 'portal' ||
    value === 'themes' ||
    value === 'templates' ||
    value === 'styles'
  ) {
    return value;
  }
  return 'overview';
};

const defaultMenuItem = (): PortalNavigationItem => ({
  id: `tmp-${Math.random().toString(36).slice(2)}`,
  label: 'New Item',
  item_type: 'page',
  path: '',
  display_order: 0,
  is_visible: true,
  visibility: 'public',
  settings: {},
  children: [],
});

const defaultMenu = (location: 'header' | 'footer'): PortalNavigationMenu => ({
  id: Number(`0${Math.floor(Math.random() * 100000)}`),
  slug: `${location}-${Math.random().toString(36).slice(2, 8)}`,
  title: location === 'header' ? 'Header Menu' : 'Footer Menu',
  description: '',
  location,
  visibility: 'public',
  display_order: 0,
  settings: {},
  items: [],
});

const defaultThemeDraft = (): PortalTheme => ({
  id: 0,
  slug: '',
  title: t('New Theme'),
  description: '',
  status: 'draft',
  is_active: false,
  is_default: false,
  preview_image_url: '',
  style_bundle_id: null,
  tokens: {},
  settings: {},
  style_bundle: null,
});

const defaultTemplateDraft = (): PortalTemplate => ({
  id: 0,
  slug: '',
  title: t('New Template'),
  description: '',
  status: 'draft',
  is_active: false,
  is_default: false,
  theme_id: null,
  style_bundle_id: null,
  structure: {},
  settings: {},
  theme: null,
  style_bundle: null,
});

const defaultStyleBundleDraft = (): PortalStyleBundle => ({
  id: 0,
  slug: '',
  title: t('New Style Bundle'),
  description: '',
  status: 'draft',
  is_active: false,
  variables: {},
  settings: {},
  css_text: '',
});

function stringifyJson(value: Record<string, any> | undefined | null) {
  return JSON.stringify(value || {}, null, 2);
}

function parseJsonInput(
  rawValue: string,
  fieldLabel: string,
): Record<string, any> {
  if (!rawValue.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch (error) {
    throw new Error(t('%s must be valid JSON.', fieldLabel));
  }
  throw new Error(t('%s must be a JSON object.', fieldLabel));
}

async function resolveApiErrorMessage(
  caughtError: unknown,
  fallbackMessage: string,
) {
  if (
    caughtError instanceof Error &&
    caughtError.message &&
    !/^Request failed with status \d+/i.test(caughtError.message)
  ) {
    return caughtError.message;
  }
  try {
    const parsed = (await getClientErrorObject(
      caughtError as Parameters<typeof getClientErrorObject>[0],
    )) as {
      error?: string;
      message?: string;
    };
    return (
      parsed.error ||
      parsed.message ||
      (caughtError instanceof Error ? caughtError.message : fallbackMessage)
    );
  } catch {
    return caughtError instanceof Error && caughtError.message
      ? caughtError.message
      : fallbackMessage;
  }
}

function updateItemAtPath(
  items: PortalNavigationItem[],
  path: number[],
  updater: (item: PortalNavigationItem) => PortalNavigationItem,
): PortalNavigationItem[] {
  if (!path.length) {
    return items;
  }
  const [head, ...tail] = path;
  return items.map((item, index) => {
    if (index !== head) {
      return item;
    }
    if (!tail.length) {
      return updater(item);
    }
    return {
      ...item,
      children: updateItemAtPath(item.children || [], tail, updater),
    };
  });
}

function removeItemAtPath(
  items: PortalNavigationItem[],
  path: number[],
): PortalNavigationItem[] {
  if (!path.length) {
    return items;
  }
  const [head, ...tail] = path;
  if (!tail.length) {
    return items.filter((_, index) => index !== head);
  }
  return items.map((item, index) =>
    index === head
      ? {
          ...item,
          children: removeItemAtPath(item.children || [], tail),
        }
      : item,
  );
}

function serializeMenuItems(
  items: PortalNavigationItem[],
): Record<string, any>[] {
  return items.map((item, index) => ({
    id: typeof item.id === 'number' ? item.id : undefined,
    label: item.label,
    item_type: item.item_type,
    href: item.path || '',
    icon: item.icon || null,
    description: item.description || null,
    visibility: item.visibility || 'public',
    page_id: item.page_id || null,
    dashboard_id: item.dashboard_id || null,
    display_order: item.display_order ?? index,
    is_visible: item.is_visible !== false,
    open_in_new_tab: item.open_in_new_tab === true,
    settings: item.settings || {},
    children: serializeMenuItems(item.children || []),
  }));
}

function appendChildAtPath(
  items: PortalNavigationItem[],
  path: number[],
): PortalNavigationItem[] {
  return updateItemAtPath(items, path, item => ({
    ...item,
    children: [...(item.children || []), defaultMenuItem()],
  }));
}

export default function CMSAdminPage() {
  const history = useHistory();
  const location = useLocation();
  const requestedPageSlug = readPageSlug(location.search);
  const requestedTab = readAdminTab(location.search);
  const canViewCms = userHasPermission(
    bootstrapData.user || {},
    'CMS',
    'cms.pages.view',
  );
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [savingPage, setSavingPage] = useState(false);
  const [savingMenus, setSavingMenus] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PortalAdminPayload | null>(null);
  const [draftPage, setDraftPage] = useState<PortalPage | null>(null);
  const [search, setSearch] = useState('');
  const [pagesSearch, setPagesSearch] = useState('');
  const [pagesStatusFilter, setPagesStatusFilter] = useState<
    'all' | 'published' | 'draft' | 'private' | 'archived'
  >('all');
  const [pagesSort, setPagesSort] = useState<
    'updated_desc' | 'updated_asc' | 'title_asc' | 'order_asc'
  >('updated_desc');
  const [menus, setMenus] = useState<{
    header: PortalNavigationMenu[];
    footer: PortalNavigationMenu[];
  }>({
    header: [],
    footer: [],
  });
  const [portalLayout, setPortalLayout] = useState<Record<string, any>>({});
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [selectedStyleBundleId, setSelectedStyleBundleId] = useState<
    number | null
  >(null);
  const [themeDraft, setThemeDraft] = useState<PortalTheme | null>(null);
  const [templateDraft, setTemplateDraft] = useState<PortalTemplate | null>(
    null,
  );
  const [styleBundleDraft, setStyleBundleDraft] =
    useState<PortalStyleBundle | null>(null);
  const [themeTokensText, setThemeTokensText] = useState('{}');
  const [themeSettingsText, setThemeSettingsText] = useState('{}');
  const [templateStructureText, setTemplateStructureText] = useState('{}');
  const [templateSettingsText, setTemplateSettingsText] = useState('{}');
  const [styleVariablesText, setStyleVariablesText] = useState('{}');
  const [styleSettingsText, setStyleSettingsText] = useState('{}');
  const [styleCssText, setStyleCssText] = useState('');
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingStyleBundle, setSavingStyleBundle] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const isMountedRef = useRef(true);
  const bootstrapAbortControllerRef = useRef<AbortController | null>(null);
  const [assetDraft, setAssetDraft] = useState<{
    file: File | null;
    title: string;
    description: string;
    visibility: 'private' | 'authenticated' | 'public';
    alt_text: string;
    caption: string;
  }>({
    file: null,
    title: '',
    description: '',
    visibility: 'private',
    alt_text: '',
    caption: '',
  });

  async function loadBootstrap(pageSlug = requestedPageSlug) {
    if (!canViewCms) {
      return null;
    }
    bootstrapAbortControllerRef.current?.abort();
    const controller = new AbortController();
    bootstrapAbortControllerRef.current = controller;
    if (isMountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const endpoint = pageSlug
        ? `/api/v1/public_page/admin/bootstrap?page=${encodeURIComponent(pageSlug)}`
        : '/api/v1/public_page/admin/bootstrap';
      const response = await SupersetClient.get({
        endpoint,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        bootstrapAbortControllerRef.current !== controller ||
        !isMountedRef.current
      ) {
        return null;
      }
      const payload = response.json?.result as PortalAdminPayload;
      setData(payload);
      setMenus(payload.menus);
      setPortalLayout({
        title: payload.portal_layout.title,
        ...(payload.portal_layout.config || {}),
      });
      setDraftPage(
        payload.current_page ? createDraftPage(payload.current_page) : null,
      );
      const nextTheme = payload.themes?.[0] || null;
      const nextTemplate = payload.templates?.[0] || null;
      const nextStyleBundle = payload.style_bundles?.[0] || null;
      setSelectedThemeId(nextTheme?.id || null);
      setSelectedTemplateId(nextTemplate?.id || null);
      setSelectedStyleBundleId(nextStyleBundle?.id || null);
      setThemeDraft(nextTheme ? { ...nextTheme } : null);
      setTemplateDraft(nextTemplate ? { ...nextTemplate } : null);
      setStyleBundleDraft(nextStyleBundle ? { ...nextStyleBundle } : null);
      setThemeTokensText(stringifyJson(nextTheme?.tokens));
      setThemeSettingsText(stringifyJson(nextTheme?.settings));
      setTemplateStructureText(stringifyJson(nextTemplate?.structure));
      setTemplateSettingsText(stringifyJson(nextTemplate?.settings));
      setStyleVariablesText(stringifyJson(nextStyleBundle?.variables));
      setStyleSettingsText(stringifyJson(nextStyleBundle?.settings));
      setStyleCssText(nextStyleBundle?.css_text || '');
      return payload;
    } catch (caughtError) {
      if (
        controller.signal.aborted ||
        bootstrapAbortControllerRef.current !== controller ||
        !isMountedRef.current
      ) {
        return null;
      }
      const messageText = await resolveApiErrorMessage(
        caughtError,
        t('Failed to load CMS Pages.'),
      );
      setError(messageText);
      return null;
    } finally {
      if (bootstrapAbortControllerRef.current === controller) {
        bootstrapAbortControllerRef.current = null;
      }
      if (!controller.signal.aborted && isMountedRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(
    () => () => {
      isMountedRef.current = false;
      bootstrapAbortControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    loadBootstrap();
  }, [requestedPageSlug, canViewCms]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTheme = useMemo(
    () =>
      (data?.themes || []).find(theme => theme.id === selectedThemeId) || null,
    [data?.themes, selectedThemeId],
  );
  const selectedTemplate = useMemo(
    () =>
      (data?.templates || []).find(
        template => template.id === selectedTemplateId,
      ) || null,
    [data?.templates, selectedTemplateId],
  );
  const selectedStyleBundle = useMemo(
    () =>
      (data?.style_bundles || []).find(
        bundle => bundle.id === selectedStyleBundleId,
      ) || null,
    [data?.style_bundles, selectedStyleBundleId],
  );
  const filteredPages = useMemo(() => {
    const normalizedQuery = pagesSearch.trim().toLowerCase();
    const pages = [...(data?.pages || [])].filter(page => {
      const matchesQuery = normalizedQuery
        ? `${page.title} ${page.slug || ''} ${page.path || ''}`
            .toLowerCase()
            .includes(normalizedQuery)
        : true;
      const pageStatus =
        page.status === 'archived'
          ? 'archived'
          : page.visibility === 'authenticated'
            ? 'private'
            : page.is_published
              ? 'published'
              : 'draft';
      const matchesStatus =
        pagesStatusFilter === 'all' ? true : pageStatus === pagesStatusFilter;
      return matchesQuery && matchesStatus;
    });

    pages.sort((left, right) => {
      if (pagesSort === 'title_asc') {
        return left.title.localeCompare(right.title);
      }
      if (pagesSort === 'order_asc') {
        return (left.display_order || 0) - (right.display_order || 0);
      }
      const leftChanged = left.changed_on || '';
      const rightChanged = right.changed_on || '';
      if (pagesSort === 'updated_asc') {
        return leftChanged.localeCompare(rightChanged);
      }
      return rightChanged.localeCompare(leftChanged);
    });
    return pages;
  }, [data?.pages, pagesSearch, pagesStatusFilter, pagesSort]);

  useEffect(() => {
    if (!selectedTheme) {
      return;
    }
    setThemeDraft({ ...selectedTheme });
    setThemeTokensText(stringifyJson(selectedTheme.tokens));
    setThemeSettingsText(stringifyJson(selectedTheme.settings));
  }, [selectedTheme]);

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }
    setTemplateDraft({ ...selectedTemplate });
    setTemplateStructureText(stringifyJson(selectedTemplate.structure));
    setTemplateSettingsText(stringifyJson(selectedTemplate.settings));
  }, [selectedTemplate]);

  useEffect(() => {
    if (!selectedStyleBundle) {
      return;
    }
    setStyleBundleDraft({ ...selectedStyleBundle });
    setStyleVariablesText(stringifyJson(selectedStyleBundle.variables));
    setStyleSettingsText(stringifyJson(selectedStyleBundle.settings));
    setStyleCssText(selectedStyleBundle.css_text || '');
  }, [selectedStyleBundle]);

  function setQueryState(next: {
    pageSlug?: string | null;
    tab?: AdminTab | null;
  }) {
    history.push(`/superset/cms/${buildCmsSearch(next)}`);
  }

  function pageStateLabel(page: PortalPageSummary | PortalPage | null) {
    if (!page) {
      return t('Draft');
    }
    if (page.status === 'archived') {
      return t('Archived');
    }
    if (page.visibility === 'authenticated') {
      return page.is_published ? t('Private') : t('Private Draft');
    }
    return page.is_published ? t('Published') : t('Draft');
  }

  function pageStateColor(page: PortalPageSummary | PortalPage | null) {
    if (!page) {
      return 'default';
    }
    if (page.status === 'archived') {
      return 'default';
    }
    if (page.visibility === 'authenticated') {
      return 'blue';
    }
    return page.is_published ? 'green' : 'gold';
  }

  function openStudioPage(pageSlug?: string | null) {
    setQueryState({
      pageSlug,
      tab: 'studio',
    });
  }

  function previewPage(page: PortalPageSummary | PortalPage | null) {
    if (!page) {
      return;
    }
    if (page.slug && page.visibility === 'public' && page.is_published) {
      window.open(resolvePortalPagePath(page), '_blank', 'noopener');
      return;
    }
    openStudioPage(page.slug || null);
  }

  function loadNewPage() {
    setDraftPage(
      createDraftPage({
        id: undefined,
        slug: '',
        title: t('New Page'),
        subtitle: '',
        description: '',
        excerpt: '',
        is_published: false,
        is_homepage: false,
        display_order: data?.pages.length || 0,
        parent_page_id: null,
        navigation_label: '',
        status: 'draft',
        visibility: 'draft',
        page_type: 'content',
        template_key:
          data?.templates.find(template => template.is_default)?.slug ||
          'default',
        theme_id: data?.themes.find(theme => theme.is_default)?.id || null,
        template_id:
          data?.templates.find(template => template.is_default)?.id || null,
        style_bundle_id: null,
        featured_image_asset_id: null,
        og_image_asset_id: null,
        settings: {},
        blocks: [],
        sections: [createEmptySection('hero'), createEmptySection('content')],
      } as PortalPage),
    );
    setQueryState({ pageSlug: null, tab: 'studio' });
  }

  async function savePage() {
    if (!draftPage) {
      return;
    }
    if (!draftPage.title.trim()) {
      messageApi.error(t('Page title is required.'));
      return;
    }
    setSavingPage(true);
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/public_page/admin/pages',
        jsonPayload: normalizeDraftPage(draftPage),
      });
      const savedPage = response.json?.result as PortalPage;
      if (isMountedRef.current) {
        setDraftPage(createDraftPage(savedPage));
      }
      await loadBootstrap(savedPage.slug);
      if (isMountedRef.current) {
        setQueryState({ pageSlug: savedPage.slug || null, tab: 'studio' });
        messageApi.success(t('Page saved.'));
      }
    } catch (caughtError) {
      messageApi.error(
        await resolveApiErrorMessage(caughtError, t('Failed to save page.')),
      );
    } finally {
      if (isMountedRef.current) {
        setSavingPage(false);
      }
    }
  }

  async function duplicatePage() {
    if (!draftPage?.id) {
      return;
    }
    setSavingPage(true);
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/pages/${draftPage.id}/duplicate`,
      });
      const duplicatedPage = response.json?.result as PortalPage;
      await loadBootstrap(duplicatedPage.slug);
      if (isMountedRef.current) {
        setQueryState({
          pageSlug: duplicatedPage.slug || null,
          tab: 'studio',
        });
        messageApi.success(t('Page duplicated.'));
      }
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to duplicate page.'),
      );
    } finally {
      setSavingPage(false);
    }
  }

  async function togglePublish(isPublished: boolean) {
    if (!draftPage?.id) {
      return;
    }
    setSavingPage(true);
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/pages/${draftPage.id}/publish`,
        jsonPayload: buildPublishPagePayload(draftPage, isPublished),
      });
      const savedPage = response.json?.result as PortalPage;
      await loadBootstrap(savedPage.slug);
      if (isMountedRef.current) {
        setQueryState({ pageSlug: savedPage.slug || null, tab: 'studio' });
        messageApi.success(
          isPublished ? t('Page published.') : t('Page unpublished.'),
        );
      }
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to update publish state.'),
      );
    } finally {
      setSavingPage(false);
    }
  }

  async function archivePage() {
    if (!draftPage?.id) {
      return;
    }
    setSavingPage(true);
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/pages/${draftPage.id}/archive`,
      });
      const archivedPage = response.json?.result as PortalPage;
      await loadBootstrap(archivedPage.slug);
      if (isMountedRef.current) {
        setQueryState({ pageSlug: archivedPage.slug || null, tab: 'studio' });
        messageApi.success(t('Page archived.'));
      }
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to archive page.'),
      );
    } finally {
      setSavingPage(false);
    }
  }

  async function deletePage(pageId: number, pageSlug?: string | null) {
    setSavingPage(true);
    try {
      await SupersetClient.delete({
        endpoint: `/api/v1/public_page/admin/pages/${pageId}`,
      });
      const fallbackSlug =
        draftPage?.id === pageId ? null : draftPage?.slug || undefined;
      await loadBootstrap(fallbackSlug);
      if (isMountedRef.current) {
        if (draftPage?.id === pageId || pageSlug === requestedPageSlug) {
          setQueryState({ pageSlug: null, tab: 'pages' });
        }
        messageApi.success(t('Page deleted.'));
      }
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to delete page.'),
      );
    } finally {
      setSavingPage(false);
    }
  }

  async function uploadAsset() {
    if (!assetDraft.file) {
      messageApi.error(t('Choose a file to upload.'));
      return;
    }
    setUploadingAsset(true);
    try {
      const csrfToken = await SupersetClient.getCSRFToken();
      const formData = new FormData();
      formData.append('file', assetDraft.file);
      formData.append('title', assetDraft.title || assetDraft.file.name);
      formData.append('description', assetDraft.description);
      formData.append('visibility', assetDraft.visibility);
      formData.append('alt_text', assetDraft.alt_text);
      formData.append('caption', assetDraft.caption);
      if (assetDraft.visibility === 'public') {
        formData.append('is_public', 'true');
      }
      const response = await fetch('/api/v1/public_page/admin/assets', {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfToken ? { 'X-CSRFToken': csrfToken } : undefined,
        body: formData,
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.message || t('Failed to upload asset.'));
      }
      setAssetDraft({
        file: null,
        title: '',
        description: '',
        visibility: 'private',
        alt_text: '',
        caption: '',
      });
      await loadBootstrap(draftPage?.slug);
      messageApi.success(t('Asset uploaded.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to upload asset.'),
      );
    } finally {
      setUploadingAsset(false);
    }
  }

  async function archiveAsset(assetId: number) {
    try {
      await SupersetClient.delete({
        endpoint: `/api/v1/public_page/admin/assets/${assetId}`,
      });
      await loadBootstrap(draftPage?.slug);
      messageApi.success(t('Asset archived.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to archive asset.'),
      );
    }
  }

  function updateMenu(
    location: 'header' | 'footer',
    menuIndex: number,
    patch: Partial<PortalNavigationMenu>,
  ) {
    setMenus(previous => ({
      ...previous,
      [location]: previous[location].map((menu, index) =>
        index === menuIndex ? { ...menu, ...patch } : menu,
      ),
    }));
  }

  function updateMenuItems(
    location: 'header' | 'footer',
    menuIndex: number,
    items: PortalNavigationItem[],
  ) {
    updateMenu(location, menuIndex, { items });
  }

  function saveMenuConfiguration() {
    setSavingMenus(true);
    SupersetClient.post({
      endpoint: '/api/v1/public_page/admin/menus',
      jsonPayload: {
        menus: [...menus.header, ...menus.footer].map((menu, index) => ({
          id: menu.id,
          slug: menu.slug,
          title: menu.title,
          description: menu.description || '',
          location: menu.location,
          visibility: menu.visibility || 'public',
          display_order: menu.display_order ?? index,
          is_enabled: menu.is_enabled !== false,
          settings: menu.settings || {},
          items: serializeMenuItems(menu.items || []),
        })),
      },
    })
      .then(async () => {
        await loadBootstrap(draftPage?.slug);
        messageApi.success(t('Menus saved.'));
      })
      .catch(caughtError =>
        messageApi.error(
          caughtError instanceof Error
            ? caughtError.message
            : t('Failed to save menus.'),
        ),
      )
      .finally(() => setSavingMenus(false));
  }

  function savePortalLayout() {
    setSavingLayout(true);
    SupersetClient.post({
      endpoint: '/api/v1/public_page/admin/layout',
      jsonPayload: {
        title: portalLayout.title || t('Public Portal'),
        config: {
          portalTitle: portalLayout.portalTitle || '',
          portalSubtitle: portalLayout.portalSubtitle || '',
          welcomeBadge: portalLayout.welcomeBadge || '',
          accentColor: portalLayout.accentColor || '',
          secondaryColor: portalLayout.secondaryColor || '',
          surfaceColor: portalLayout.surfaceColor || '',
          pageMaxWidth: Number(portalLayout.pageMaxWidth) || 1280,
          showThemeToggle: portalLayout.showThemeToggle !== false,
          lightModeLabel: portalLayout.lightModeLabel || '',
          darkModeLabel: portalLayout.darkModeLabel || '',
          loginButtonText: portalLayout.loginButtonText || '',
          loginButtonUrl: portalLayout.loginButtonUrl || '',
          footerText: portalLayout.footerText || '',
          emptyPageMessage: portalLayout.emptyPageMessage || '',
          noPublicPageMessage: portalLayout.noPublicPageMessage || '',
          dashboardBadgeLabel: portalLayout.dashboardBadgeLabel || '',
          dashboardEmbedSubtitle: portalLayout.dashboardEmbedSubtitle || '',
          dashboardEmbedIntro: portalLayout.dashboardEmbedIntro || '',
          dashboardBackLabel: portalLayout.dashboardBackLabel || '',
          dashboardLoadingLabel: portalLayout.dashboardLoadingLabel || '',
        },
      },
    })
      .then(async () => {
        await loadBootstrap(draftPage?.slug);
        messageApi.success(t('Portal layout saved.'));
      })
      .catch(caughtError =>
        messageApi.error(
          caughtError instanceof Error
            ? caughtError.message
            : t('Failed to save portal layout.'),
        ),
      )
      .finally(() => setSavingLayout(false));
  }

  function renderMenuItems(
    location: 'header' | 'footer',
    menuIndex: number,
    rootItems: PortalNavigationItem[],
    items: PortalNavigationItem[] = rootItems,
    parentPath: number[] = [],
  ): JSX.Element[] {
    return items.map((item, itemIndex) => {
      const path = [...parentPath, itemIndex];
      return (
        <Stack key={`${location}-${menuIndex}-${path.join('-')}`}>
          <ComponentCard
            as="div"
            $depth={parentPath.length}
            style={{ cursor: 'default' }}
          >
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Label')}</FieldLabel>
                <Input
                  value={item.label}
                  onChange={event =>
                    updateMenuItems(
                      location,
                      menuIndex,
                      updateItemAtPath(rootItems, path, current => ({
                        ...current,
                        label: event.target.value,
                      })),
                    )
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Type')}</FieldLabel>
                <Select
                  value={item.item_type}
                  onChange={value =>
                    updateMenuItems(
                      location,
                      menuIndex,
                      updateItemAtPath(rootItems, path, current => ({
                        ...current,
                        item_type: value,
                      })),
                    )
                  }
                  options={[
                    { value: 'page', label: t('Page') },
                    { value: 'page_collection', label: t('Page Collection') },
                    { value: 'dashboard', label: t('Dashboard') },
                    {
                      value: 'dashboard_collection',
                      label: t('Dashboard Collection'),
                    },
                    { value: 'external', label: t('External Link') },
                  ]}
                />
              </FieldBlock>
            </FieldGrid>
            <FieldGrid style={{ marginTop: 12 }}>
              <FieldBlock>
                <FieldLabel>{t('Page')}</FieldLabel>
                <Select
                  allowClear
                  value={item.page_id || undefined}
                  options={(data?.pages || []).map(page => ({
                    value: page.id,
                    label: page.title,
                  }))}
                  onChange={value =>
                    updateMenuItems(
                      location,
                      menuIndex,
                      updateItemAtPath(rootItems, path, current => ({
                        ...current,
                        page_id: value || null,
                      })),
                    )
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Dashboard')}</FieldLabel>
                <Select
                  allowClear
                  value={item.dashboard_id || undefined}
                  options={(data?.dashboards || []).map(dashboard => ({
                    value: dashboard.id,
                    label: dashboard.dashboard_title,
                  }))}
                  onChange={value =>
                    updateMenuItems(
                      location,
                      menuIndex,
                      updateItemAtPath(rootItems, path, current => ({
                        ...current,
                        dashboard_id: value || null,
                      })),
                    )
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldGrid style={{ marginTop: 12 }}>
              <FieldBlock>
                <FieldLabel>{t('URL')}</FieldLabel>
                <Input
                  value={item.path || ''}
                  onChange={event =>
                    updateMenuItems(
                      location,
                      menuIndex,
                      updateItemAtPath(rootItems, path, current => ({
                        ...current,
                        path: event.target.value,
                      })),
                    )
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Visibility')}</FieldLabel>
                <Select
                  value={item.visibility || 'public'}
                  onChange={value =>
                    updateMenuItems(
                      location,
                      menuIndex,
                      updateItemAtPath(rootItems, path, current => ({
                        ...current,
                        visibility: value,
                      })),
                    )
                  }
                  options={[
                    { value: 'public', label: t('Public') },
                    { value: 'authenticated', label: t('Authenticated') },
                    { value: 'draft', label: t('Draft') },
                  ]}
                />
              </FieldBlock>
            </FieldGrid>
            <Space style={{ marginTop: 12 }}>
              <Button
                size="small"
                onClick={() =>
                  updateMenuItems(
                    location,
                    menuIndex,
                    appendChildAtPath(rootItems, path),
                  )
                }
              >
                {t('Add Child')}
              </Button>
              <Button
                size="small"
                danger
                onClick={() =>
                  updateMenuItems(
                    location,
                    menuIndex,
                    removeItemAtPath(rootItems, path),
                  )
                }
              >
                {t('Remove')}
              </Button>
            </Space>
          </ComponentCard>
          {(item.children || []).length
            ? renderMenuItems(
                location,
                menuIndex,
                rootItems,
                item.children || [],
                path,
              )
            : null}
        </Stack>
      );
    });
  }

  function startNewTheme() {
    setSelectedThemeId(null);
    const nextDraft = defaultThemeDraft();
    setThemeDraft(nextDraft);
    setThemeTokensText(stringifyJson(nextDraft.tokens));
    setThemeSettingsText(stringifyJson(nextDraft.settings));
  }

  function startNewTemplate() {
    setSelectedTemplateId(null);
    const nextDraft = defaultTemplateDraft();
    setTemplateDraft(nextDraft);
    setTemplateStructureText(stringifyJson(nextDraft.structure));
    setTemplateSettingsText(stringifyJson(nextDraft.settings));
  }

  function startNewStyleBundle() {
    setSelectedStyleBundleId(null);
    const nextDraft = defaultStyleBundleDraft();
    setStyleBundleDraft(nextDraft);
    setStyleVariablesText(stringifyJson(nextDraft.variables));
    setStyleSettingsText(stringifyJson(nextDraft.settings));
    setStyleCssText(nextDraft.css_text || '');
  }

  async function saveThemeDefinition() {
    if (!themeDraft?.title.trim()) {
      messageApi.error(t('Theme title is required.'));
      return;
    }
    setSavingTheme(true);
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/public_page/admin/themes',
        jsonPayload: {
          id: themeDraft.id || undefined,
          slug: themeDraft.slug || undefined,
          title: themeDraft.title,
          description: themeDraft.description || '',
          status: themeDraft.status || 'draft',
          is_active: themeDraft.is_active !== false,
          is_default: themeDraft.is_default === true,
          preview_image_url: themeDraft.preview_image_url || '',
          style_bundle_id: themeDraft.style_bundle_id || null,
          tokens: parseJsonInput(themeTokensText, t('Theme tokens')),
          settings: parseJsonInput(themeSettingsText, t('Theme settings')),
        },
      });
      const savedTheme = response.json?.result as PortalTheme;
      await loadBootstrap(draftPage?.slug);
      setSelectedThemeId(savedTheme.id);
      messageApi.success(t('Theme saved.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to save theme.'),
      );
    } finally {
      setSavingTheme(false);
    }
  }

  async function duplicateThemeDefinition() {
    if (!selectedThemeId) {
      return;
    }
    setSavingTheme(true);
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/themes/${selectedThemeId}/duplicate`,
      });
      const clonedTheme = response.json?.result as PortalTheme;
      await loadBootstrap(draftPage?.slug);
      setSelectedThemeId(clonedTheme.id);
      messageApi.success(t('Theme duplicated.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to duplicate theme.'),
      );
    } finally {
      setSavingTheme(false);
    }
  }

  async function activateThemeDefinition() {
    if (!selectedThemeId) {
      return;
    }
    setSavingTheme(true);
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/themes/${selectedThemeId}/activate`,
        jsonPayload: { is_default: themeDraft?.is_default !== false },
      });
      await loadBootstrap(draftPage?.slug);
      setSelectedThemeId(selectedThemeId);
      messageApi.success(t('Theme activated.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to activate theme.'),
      );
    } finally {
      setSavingTheme(false);
    }
  }

  async function archiveThemeDefinition() {
    if (!selectedThemeId) {
      return;
    }
    setSavingTheme(true);
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/themes/${selectedThemeId}/archive`,
      });
      await loadBootstrap(draftPage?.slug);
      messageApi.success(t('Theme archived.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to archive theme.'),
      );
    } finally {
      setSavingTheme(false);
    }
  }

  async function saveTemplateDefinition() {
    if (!templateDraft?.title.trim()) {
      messageApi.error(t('Template title is required.'));
      return;
    }
    setSavingTemplate(true);
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/public_page/admin/templates',
        jsonPayload: {
          id: templateDraft.id || undefined,
          slug: templateDraft.slug || undefined,
          title: templateDraft.title,
          description: templateDraft.description || '',
          status: templateDraft.status || 'draft',
          is_active: templateDraft.is_active !== false,
          is_default: templateDraft.is_default === true,
          theme_id: templateDraft.theme_id || null,
          style_bundle_id: templateDraft.style_bundle_id || null,
          structure: parseJsonInput(
            templateStructureText,
            t('Template structure'),
          ),
          settings: parseJsonInput(
            templateSettingsText,
            t('Template settings'),
          ),
        },
      });
      const savedTemplate = response.json?.result as PortalTemplate;
      await loadBootstrap(draftPage?.slug);
      setSelectedTemplateId(savedTemplate.id);
      messageApi.success(t('Template saved.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to save template.'),
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  async function duplicateTemplateDefinition() {
    if (!selectedTemplateId) {
      return;
    }
    setSavingTemplate(true);
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/templates/${selectedTemplateId}/duplicate`,
      });
      const clonedTemplate = response.json?.result as PortalTemplate;
      await loadBootstrap(draftPage?.slug);
      setSelectedTemplateId(clonedTemplate.id);
      messageApi.success(t('Template duplicated.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to duplicate template.'),
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  async function activateTemplateDefinition() {
    if (!selectedTemplateId) {
      return;
    }
    setSavingTemplate(true);
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/templates/${selectedTemplateId}/activate`,
        jsonPayload: { is_default: templateDraft?.is_default !== false },
      });
      await loadBootstrap(draftPage?.slug);
      setSelectedTemplateId(selectedTemplateId);
      messageApi.success(t('Template activated.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to activate template.'),
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  async function archiveTemplateDefinition() {
    if (!selectedTemplateId) {
      return;
    }
    setSavingTemplate(true);
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/templates/${selectedTemplateId}/archive`,
      });
      await loadBootstrap(draftPage?.slug);
      messageApi.success(t('Template archived.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to archive template.'),
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  async function saveStyleBundleDefinition() {
    if (!styleBundleDraft?.title.trim()) {
      messageApi.error(t('Style bundle title is required.'));
      return;
    }
    setSavingStyleBundle(true);
    try {
      const response = await SupersetClient.post({
        endpoint: '/api/v1/public_page/admin/styles',
        jsonPayload: {
          id: styleBundleDraft.id || undefined,
          slug: styleBundleDraft.slug || undefined,
          title: styleBundleDraft.title,
          description: styleBundleDraft.description || '',
          status: styleBundleDraft.status || 'draft',
          is_active: styleBundleDraft.is_active !== false,
          variables: parseJsonInput(styleVariablesText, t('Style variables')),
          settings: parseJsonInput(styleSettingsText, t('Style settings')),
          css_text: styleCssText,
        },
      });
      const savedStyleBundle = response.json?.result as PortalStyleBundle;
      await loadBootstrap(draftPage?.slug);
      setSelectedStyleBundleId(savedStyleBundle.id);
      messageApi.success(t('Style bundle saved.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to save style bundle.'),
      );
    } finally {
      setSavingStyleBundle(false);
    }
  }

  async function duplicateStyleBundleDefinition() {
    if (!selectedStyleBundleId) {
      return;
    }
    setSavingStyleBundle(true);
    try {
      const response = await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/styles/${selectedStyleBundleId}/duplicate`,
      });
      const clonedStyleBundle = response.json?.result as PortalStyleBundle;
      await loadBootstrap(draftPage?.slug);
      setSelectedStyleBundleId(clonedStyleBundle.id);
      messageApi.success(t('Style bundle duplicated.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to duplicate style bundle.'),
      );
    } finally {
      setSavingStyleBundle(false);
    }
  }

  async function activateStyleBundleDefinition() {
    if (!selectedStyleBundleId) {
      return;
    }
    setSavingStyleBundle(true);
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/styles/${selectedStyleBundleId}/activate`,
      });
      await loadBootstrap(draftPage?.slug);
      setSelectedStyleBundleId(selectedStyleBundleId);
      messageApi.success(t('Style bundle activated.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to activate style bundle.'),
      );
    } finally {
      setSavingStyleBundle(false);
    }
  }

  async function archiveStyleBundleDefinition() {
    if (!selectedStyleBundleId) {
      return;
    }
    setSavingStyleBundle(true);
    try {
      await SupersetClient.post({
        endpoint: `/api/v1/public_page/admin/styles/${selectedStyleBundleId}/archive`,
      });
      await loadBootstrap(draftPage?.slug);
      messageApi.success(t('Style bundle archived.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to archive style bundle.'),
      );
    } finally {
      setSavingStyleBundle(false);
    }
  }

  function renderThemeManager() {
    return (
      <DesignLayout>
        <Panel>
          <PanelHeader>
            <PanelTitle>{t('Themes')}</PanelTitle>
            <Button
              size="small"
              onClick={startNewTheme}
              disabled={!data?.permissions.can_manage_themes}
            >
              {t('New Theme')}
            </Button>
          </PanelHeader>
          <SectionList>
            {(data?.themes || []).map(theme => (
              <DesignCard
                key={theme.id}
                $active={theme.id === selectedThemeId}
                onClick={() => setSelectedThemeId(theme.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedThemeId(theme.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <strong>{theme.title}</strong>
                  <Space size={4}>
                    {theme.is_default && <Tag color="gold">{t('Default')}</Tag>}
                    <Tag color={theme.is_active ? 'green' : 'default'}>
                      {theme.status || 'draft'}
                    </Tag>
                  </Space>
                </div>
                <TinyMeta>{theme.slug}</TinyMeta>
              </DesignCard>
            ))}
          </SectionList>
        </Panel>
        <Panel>
          <PanelHeader>
            <PanelTitle>{t('Theme Studio')}</PanelTitle>
            <Space>
              <Button
                onClick={duplicateThemeDefinition}
                disabled={
                  !selectedThemeId || !data?.permissions.can_manage_themes
                }
              >
                {t('Duplicate')}
              </Button>
              <Button
                onClick={activateThemeDefinition}
                disabled={
                  !selectedThemeId || !data?.permissions.can_manage_themes
                }
              >
                {t('Activate')}
              </Button>
              <Button
                danger
                onClick={archiveThemeDefinition}
                disabled={
                  !selectedThemeId || !data?.permissions.can_manage_themes
                }
              >
                {t('Archive')}
              </Button>
              <Button
                type="primary"
                loading={savingTheme}
                onClick={saveThemeDefinition}
                disabled={!data?.permissions.can_manage_themes}
              >
                {t('Save Theme')}
              </Button>
            </Space>
          </PanelHeader>
          {themeDraft ? (
            <Stack>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Title')}</FieldLabel>
                  <Input
                    value={themeDraft.title}
                    onChange={event =>
                      setThemeDraft(previous =>
                        previous
                          ? { ...previous, title: event.target.value }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Slug')}</FieldLabel>
                  <Input
                    value={themeDraft.slug || ''}
                    onChange={event =>
                      setThemeDraft(previous =>
                        previous
                          ? { ...previous, slug: event.target.value }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
              </FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Description')}</FieldLabel>
                <Input.TextArea
                  rows={2}
                  value={themeDraft.description || ''}
                  onChange={event =>
                    setThemeDraft(previous =>
                      previous
                        ? { ...previous, description: event.target.value }
                        : previous,
                    )
                  }
                />
              </FieldBlock>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Status')}</FieldLabel>
                  <Select
                    value={themeDraft.status || 'draft'}
                    onChange={value =>
                      setThemeDraft(previous =>
                        previous ? { ...previous, status: value } : previous,
                      )
                    }
                    options={[
                      { value: 'draft', label: t('Draft') },
                      { value: 'active', label: t('Active') },
                      { value: 'archived', label: t('Archived') },
                    ]}
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Style Bundle')}</FieldLabel>
                  <Select
                    allowClear
                    value={themeDraft.style_bundle_id || undefined}
                    options={(data?.style_bundles || []).map(bundle => ({
                      value: bundle.id,
                      label: bundle.title,
                    }))}
                    onChange={value =>
                      setThemeDraft(previous =>
                        previous
                          ? { ...previous, style_bundle_id: value || null }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
              </FieldGrid>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Active')}</FieldLabel>
                  <Switch
                    checked={themeDraft.is_active !== false}
                    onChange={checked =>
                      setThemeDraft(previous =>
                        previous
                          ? { ...previous, is_active: checked }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Default')}</FieldLabel>
                  <Switch
                    checked={themeDraft.is_default === true}
                    onChange={checked =>
                      setThemeDraft(previous =>
                        previous
                          ? { ...previous, is_default: checked }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
              </FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Preview Image URL')}</FieldLabel>
                <Input
                  value={themeDraft.preview_image_url || ''}
                  onChange={event =>
                    setThemeDraft(previous =>
                      previous
                        ? {
                            ...previous,
                            preview_image_url: event.target.value,
                          }
                        : previous,
                    )
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Theme Tokens JSON')}</FieldLabel>
                <Input.TextArea
                  rows={12}
                  value={themeTokensText}
                  onChange={event => setThemeTokensText(event.target.value)}
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Theme Settings JSON')}</FieldLabel>
                <Input.TextArea
                  rows={6}
                  value={themeSettingsText}
                  onChange={event => setThemeSettingsText(event.target.value)}
                />
              </FieldBlock>
              <TokenPreview>
                <TokenSwatch>
                  <TinyMeta>{t('Accent')}</TinyMeta>
                  <div style={{ fontWeight: 700 }}>
                    {themeDraft.tokens?.colors?.accent || '—'}
                  </div>
                </TokenSwatch>
                <TokenSwatch>
                  <TinyMeta>{t('Surface')}</TinyMeta>
                  <div style={{ fontWeight: 700 }}>
                    {themeDraft.tokens?.colors?.surface || '—'}
                  </div>
                </TokenSwatch>
                <TokenSwatch>
                  <TinyMeta>{t('Heading Font')}</TinyMeta>
                  <div style={{ fontWeight: 700 }}>
                    {themeDraft.tokens?.fonts?.heading || '—'}
                  </div>
                </TokenSwatch>
              </TokenPreview>
            </Stack>
          ) : (
            <Empty description={t('Select a theme or create a new one.')} />
          )}
        </Panel>
      </DesignLayout>
    );
  }

  function renderTemplateManager() {
    return (
      <DesignLayout>
        <Panel>
          <PanelHeader>
            <PanelTitle>{t('Templates')}</PanelTitle>
            <Button
              size="small"
              onClick={startNewTemplate}
              disabled={!data?.permissions.can_manage_templates}
            >
              {t('New Template')}
            </Button>
          </PanelHeader>
          <SectionList>
            {(data?.templates || []).map(template => (
              <DesignCard
                key={template.id}
                $active={template.id === selectedTemplateId}
                onClick={() => setSelectedTemplateId(template.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedTemplateId(template.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <strong>{template.title}</strong>
                  <Space size={4}>
                    {template.is_default && (
                      <Tag color="gold">{t('Default')}</Tag>
                    )}
                    <Tag color={template.is_active ? 'green' : 'default'}>
                      {template.status || 'draft'}
                    </Tag>
                  </Space>
                </div>
                <TinyMeta>{template.slug}</TinyMeta>
              </DesignCard>
            ))}
          </SectionList>
        </Panel>
        <Panel>
          <PanelHeader>
            <PanelTitle>{t('Template Studio')}</PanelTitle>
            <Space>
              <Button
                onClick={duplicateTemplateDefinition}
                disabled={
                  !selectedTemplateId || !data?.permissions.can_manage_templates
                }
              >
                {t('Duplicate')}
              </Button>
              <Button
                onClick={activateTemplateDefinition}
                disabled={
                  !selectedTemplateId || !data?.permissions.can_manage_templates
                }
              >
                {t('Activate')}
              </Button>
              <Button
                danger
                onClick={archiveTemplateDefinition}
                disabled={
                  !selectedTemplateId || !data?.permissions.can_manage_templates
                }
              >
                {t('Archive')}
              </Button>
              <Button
                type="primary"
                loading={savingTemplate}
                onClick={saveTemplateDefinition}
                disabled={!data?.permissions.can_manage_templates}
              >
                {t('Save Template')}
              </Button>
            </Space>
          </PanelHeader>
          {templateDraft ? (
            <Stack>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Title')}</FieldLabel>
                  <Input
                    value={templateDraft.title}
                    onChange={event =>
                      setTemplateDraft(previous =>
                        previous
                          ? { ...previous, title: event.target.value }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Slug')}</FieldLabel>
                  <Input
                    value={templateDraft.slug || ''}
                    onChange={event =>
                      setTemplateDraft(previous =>
                        previous
                          ? { ...previous, slug: event.target.value }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
              </FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Description')}</FieldLabel>
                <Input.TextArea
                  rows={2}
                  value={templateDraft.description || ''}
                  onChange={event =>
                    setTemplateDraft(previous =>
                      previous
                        ? { ...previous, description: event.target.value }
                        : previous,
                    )
                  }
                />
              </FieldBlock>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Status')}</FieldLabel>
                  <Select
                    value={templateDraft.status || 'draft'}
                    onChange={value =>
                      setTemplateDraft(previous =>
                        previous ? { ...previous, status: value } : previous,
                      )
                    }
                    options={[
                      { value: 'draft', label: t('Draft') },
                      { value: 'active', label: t('Active') },
                      { value: 'archived', label: t('Archived') },
                    ]}
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Theme')}</FieldLabel>
                  <Select
                    allowClear
                    value={templateDraft.theme_id || undefined}
                    options={(data?.themes || []).map(theme => ({
                      value: theme.id,
                      label: theme.title,
                    }))}
                    onChange={value =>
                      setTemplateDraft(previous =>
                        previous
                          ? { ...previous, theme_id: value || null }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
              </FieldGrid>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Style Bundle')}</FieldLabel>
                  <Select
                    allowClear
                    value={templateDraft.style_bundle_id || undefined}
                    options={(data?.style_bundles || []).map(bundle => ({
                      value: bundle.id,
                      label: bundle.title,
                    }))}
                    onChange={value =>
                      setTemplateDraft(previous =>
                        previous
                          ? { ...previous, style_bundle_id: value || null }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Default')}</FieldLabel>
                  <Switch
                    checked={templateDraft.is_default === true}
                    onChange={checked =>
                      setTemplateDraft(previous =>
                        previous
                          ? { ...previous, is_default: checked }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
              </FieldGrid>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Active')}</FieldLabel>
                  <Switch
                    checked={templateDraft.is_active !== false}
                    onChange={checked =>
                      setTemplateDraft(previous =>
                        previous
                          ? { ...previous, is_active: checked }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Regions')}</FieldLabel>
                  <TinyMeta>
                    {Object.keys(templateDraft.structure?.regions || {}).join(
                      ', ',
                    ) || '—'}
                  </TinyMeta>
                </FieldBlock>
              </FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Template Structure JSON')}</FieldLabel>
                <Input.TextArea
                  rows={12}
                  value={templateStructureText}
                  onChange={event =>
                    setTemplateStructureText(event.target.value)
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Template Settings JSON')}</FieldLabel>
                <Input.TextArea
                  rows={6}
                  value={templateSettingsText}
                  onChange={event =>
                    setTemplateSettingsText(event.target.value)
                  }
                />
              </FieldBlock>
            </Stack>
          ) : (
            <Empty description={t('Select a template or create a new one.')} />
          )}
        </Panel>
      </DesignLayout>
    );
  }

  function renderStyleManager() {
    return (
      <DesignLayout>
        <Panel>
          <PanelHeader>
            <PanelTitle>{t('Style Bundles')}</PanelTitle>
            <Button
              size="small"
              onClick={startNewStyleBundle}
              disabled={!data?.permissions.can_manage_styles}
            >
              {t('New Style')}
            </Button>
          </PanelHeader>
          <SectionList>
            {(data?.style_bundles || []).map(bundle => (
              <DesignCard
                key={bundle.id}
                $active={bundle.id === selectedStyleBundleId}
                onClick={() => setSelectedStyleBundleId(bundle.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedStyleBundleId(bundle.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <strong>{bundle.title}</strong>
                  <Tag color={bundle.is_active ? 'green' : 'default'}>
                    {bundle.status || 'draft'}
                  </Tag>
                </div>
                <TinyMeta>{bundle.slug}</TinyMeta>
              </DesignCard>
            ))}
          </SectionList>
        </Panel>
        <Panel>
          <PanelHeader>
            <PanelTitle>{t('Style Studio')}</PanelTitle>
            <Space>
              <Button
                onClick={duplicateStyleBundleDefinition}
                disabled={
                  !selectedStyleBundleId || !data?.permissions.can_manage_styles
                }
              >
                {t('Duplicate')}
              </Button>
              <Button
                onClick={activateStyleBundleDefinition}
                disabled={
                  !selectedStyleBundleId || !data?.permissions.can_manage_styles
                }
              >
                {t('Activate')}
              </Button>
              <Button
                danger
                onClick={archiveStyleBundleDefinition}
                disabled={
                  !selectedStyleBundleId || !data?.permissions.can_manage_styles
                }
              >
                {t('Archive')}
              </Button>
              <Button
                type="primary"
                loading={savingStyleBundle}
                onClick={saveStyleBundleDefinition}
                disabled={!data?.permissions.can_manage_styles}
              >
                {t('Save Style')}
              </Button>
            </Space>
          </PanelHeader>
          {styleBundleDraft ? (
            <Stack>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Title')}</FieldLabel>
                  <Input
                    value={styleBundleDraft.title}
                    onChange={event =>
                      setStyleBundleDraft(previous =>
                        previous
                          ? { ...previous, title: event.target.value }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Slug')}</FieldLabel>
                  <Input
                    value={styleBundleDraft.slug || ''}
                    onChange={event =>
                      setStyleBundleDraft(previous =>
                        previous
                          ? { ...previous, slug: event.target.value }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
              </FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Description')}</FieldLabel>
                <Input.TextArea
                  rows={2}
                  value={styleBundleDraft.description || ''}
                  onChange={event =>
                    setStyleBundleDraft(previous =>
                      previous
                        ? { ...previous, description: event.target.value }
                        : previous,
                    )
                  }
                />
              </FieldBlock>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Status')}</FieldLabel>
                  <Select
                    value={styleBundleDraft.status || 'draft'}
                    onChange={value =>
                      setStyleBundleDraft(previous =>
                        previous ? { ...previous, status: value } : previous,
                      )
                    }
                    options={[
                      { value: 'draft', label: t('Draft') },
                      { value: 'active', label: t('Active') },
                      { value: 'archived', label: t('Archived') },
                    ]}
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Active')}</FieldLabel>
                  <Switch
                    checked={styleBundleDraft.is_active !== false}
                    onChange={checked =>
                      setStyleBundleDraft(previous =>
                        previous
                          ? { ...previous, is_active: checked }
                          : previous,
                      )
                    }
                  />
                </FieldBlock>
              </FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Style Variables JSON')}</FieldLabel>
                <Input.TextArea
                  rows={8}
                  value={styleVariablesText}
                  onChange={event => setStyleVariablesText(event.target.value)}
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Scoped CSS')}</FieldLabel>
                <Input.TextArea
                  rows={8}
                  value={styleCssText}
                  onChange={event => setStyleCssText(event.target.value)}
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Style Settings JSON')}</FieldLabel>
                <Input.TextArea
                  rows={6}
                  value={styleSettingsText}
                  onChange={event => setStyleSettingsText(event.target.value)}
                />
              </FieldBlock>
            </Stack>
          ) : (
            <Empty
              description={t('Select a style bundle or create a new one.')}
            />
          )}
        </Panel>
      </DesignLayout>
    );
  }

  function renderPagesManager() {
    return (
      <Stack>
        <PagesToolbar>
          <PagesToolbarFilters>
            <FieldBlock>
              <FieldLabel>{t('Search Pages')}</FieldLabel>
              <Input
                value={pagesSearch}
                onChange={event => setPagesSearch(event.target.value)}
                prefix={<SearchOutlined />}
                placeholder={t('Search title, slug, or path')}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Status')}</FieldLabel>
              <Select
                value={pagesStatusFilter}
                onChange={value => setPagesStatusFilter(value)}
                suffixIcon={<FilterOutlined />}
                options={[
                  { value: 'all', label: t('All Pages') },
                  { value: 'published', label: t('Published') },
                  { value: 'draft', label: t('Drafts') },
                  { value: 'private', label: t('Private') },
                  { value: 'archived', label: t('Archived') },
                ]}
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Sort')}</FieldLabel>
              <Select
                value={pagesSort}
                onChange={value => setPagesSort(value)}
                options={[
                  { value: 'updated_desc', label: t('Recently Updated') },
                  { value: 'updated_asc', label: t('Oldest Updated') },
                  { value: 'title_asc', label: t('Title A-Z') },
                  { value: 'order_asc', label: t('Display Order') },
                ]}
              />
            </FieldBlock>
          </PagesToolbarFilters>
          <Button type="primary" icon={<PlusOutlined />} onClick={loadNewPage}>
            {t('Create Page')}
          </Button>
        </PagesToolbar>
        <PagesGrid>
          {filteredPages.length ? (
            filteredPages.map(page => (
              <PageCard
                key={page.id || page.slug}
                $active={page.slug === draftPage?.slug}
                onClick={() => openStudioPage(page.slug || null)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openStudioPage(page.slug || null);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <PageCardMeta>
                  <Space wrap>
                    <Tag color={pageStateColor(page)}>
                      {pageStateLabel(page)}
                    </Tag>
                    {page.is_homepage ? (
                      <Tag color="gold">{t('Landing Page')}</Tag>
                    ) : null}
                    {page.page_type ? <Tag>{page.page_type}</Tag> : null}
                  </Space>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {page.title}
                  </div>
                  <TinyMeta>
                    {page.path || page.slug || page.is_homepage
                      ? resolvePortalPagePath(page)
                      : '—'}
                  </TinyMeta>
                  <TinyMeta>
                    {page.changed_on
                      ? t('Updated %s', page.changed_on)
                      : t('Not yet published')}
                  </TinyMeta>
                </PageCardMeta>
                <PageCardActions onClick={event => event.stopPropagation()}>
                  <Button
                    size="small"
                    icon={<FileTextOutlined />}
                    onClick={() => openStudioPage(page.slug || null)}
                  >
                    {t('Edit')}
                  </Button>
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => previewPage(page)}
                  >
                    {t('Preview')}
                  </Button>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    disabled={!page.id || savingPage}
                    onClick={async () => {
                      if (!page.id) {
                        return;
                      }
                      setSavingPage(true);
                      try {
                        const response = await SupersetClient.post({
                          endpoint: `/api/v1/public_page/admin/pages/${page.id}/duplicate`,
                        });
                        const duplicatedPage = response.json
                          ?.result as PortalPage;
                        await loadBootstrap(duplicatedPage.slug);
                        openStudioPage(duplicatedPage.slug || null);
                        messageApi.success(t('Page duplicated.'));
                      } catch (caughtError) {
                        messageApi.error(
                          caughtError instanceof Error
                            ? caughtError.message
                            : t('Failed to duplicate page.'),
                        );
                      } finally {
                        setSavingPage(false);
                      }
                    }}
                  >
                    {t('Duplicate')}
                  </Button>
                  <Button
                    size="small"
                    icon={
                      page.is_published ? (
                        <GlobalOutlined />
                      ) : (
                        <RocketOutlined />
                      )
                    }
                    disabled={!page.id || savingPage}
                    onClick={() => {
                      if (!page.id) {
                        return;
                      }
                      (async () => {
                        setSavingPage(true);
                        try {
                          await SupersetClient.post({
                            endpoint: `/api/v1/public_page/admin/pages/${page.id}/publish`,
                            jsonPayload:
                              draftPage?.id === page.id
                                ? buildPublishPagePayload(
                                    draftPage,
                                    !page.is_published,
                                  )
                                : buildPublishStatePayload(
                                    {
                                      visibility: page.visibility,
                                      scheduled_publish_at:
                                        page.scheduled_publish_at,
                                    },
                                    !page.is_published,
                                  ),
                          });
                          await loadBootstrap(draftPage?.slug || undefined);
                          messageApi.success(
                            page.is_published
                              ? t('Page unpublished.')
                              : t('Page published.'),
                          );
                        } catch (caughtError) {
                          messageApi.error(
                            caughtError instanceof Error
                              ? caughtError.message
                              : t('Failed to update page status.'),
                          );
                        } finally {
                          setSavingPage(false);
                        }
                      })();
                    }}
                  >
                    {page.is_published ? t('Unpublish') : t('Publish')}
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={!page.id || savingPage}
                    onClick={() => {
                      if (!page.id) {
                        return;
                      }
                      deletePage(page.id, page.slug || null);
                    }}
                  >
                    {t('Delete')}
                  </Button>
                </PageCardActions>
              </PageCard>
            ))
          ) : (
            <Panel>
              <Empty description={t('No pages match the current filters.')} />
            </Panel>
          )}
        </PagesGrid>
      </Stack>
    );
  }

  const adminNavItems: Array<{
    key: AdminTab;
    label: string;
    icon: JSX.Element;
    hidden?: boolean;
  }> = [
    {
      key: 'overview' as const,
      label: t('Overview'),
      icon: <AppstoreOutlined />,
    },
    {
      key: 'pages' as const,
      label: t('Pages'),
      icon: <UnorderedListOutlined />,
    },
    {
      key: 'studio' as const,
      label: t('Page Studio'),
      icon: <LayoutOutlined />,
    },
    {
      key: 'media' as const,
      label: t('Media Library'),
      icon: <FileImageOutlined />,
      hidden: !data?.permissions.can_manage_media,
    },
    { key: 'menus' as const, label: t('Menus'), icon: <MenuOutlined /> },
    { key: 'portal' as const, label: t('Portal'), icon: <SettingOutlined /> },
    {
      key: 'themes' as const,
      label: t('Themes'),
      icon: <SkinOutlined />,
      hidden: !data?.permissions.can_manage_themes,
    },
    {
      key: 'templates' as const,
      label: t('Templates'),
      icon: <BgColorsOutlined />,
      hidden: !data?.permissions.can_manage_templates,
    },
    {
      key: 'styles' as const,
      label: t('Styles'),
      icon: <FundProjectionScreenOutlined />,
      hidden: !data?.permissions.can_manage_styles,
    },
  ].filter(item => !item.hidden);

  function renderActiveTab() {
    if (requestedTab === 'overview') {
      return (
        <Stack>
          <StatsGrid>
            <StatCard>
              <StatValue>{data?.stats.total_pages || 0}</StatValue>
              <StatLabel>{t('Total Pages')}</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{data?.stats.published_pages || 0}</StatValue>
              <StatLabel>{t('Published Pages')}</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{data?.stats.draft_pages || 0}</StatValue>
              <StatLabel>{t('Drafts')}</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{data?.stats.private_pages || 0}</StatValue>
              <StatLabel>{t('Private Pages')}</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{data?.stats.menus || 0}</StatValue>
              <StatLabel>{t('Menus')}</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{data?.stats.chart_enabled_pages || 0}</StatValue>
              <StatLabel>{t('Chart-enabled Pages')}</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{data?.stats.themes || 0}</StatValue>
              <StatLabel>{t('Themes')}</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{data?.stats.templates || 0}</StatValue>
              <StatLabel>{t('Templates')}</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{data?.stats.style_bundles || 0}</StatValue>
              <StatLabel>{t('Style Bundles')}</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue>{data?.stats.media_assets || 0}</StatValue>
              <StatLabel>{t('Media Assets')}</StatLabel>
            </StatCard>
          </StatsGrid>
          <RevisionList>
            {(data?.recent_edits || []).map(revision => (
              <RevisionCard key={revision.id}>
                <Badge
                  color={
                    revision.action === 'published' ? '#0f766e' : '#1d4ed8'
                  }
                  text={revision.action}
                />
                <PreviewTitle style={{ fontSize: 16, marginTop: 10 }}>
                  {revision.summary ||
                    t('Revision %s', revision.revision_number)}
                </PreviewTitle>
                <TinyMeta>
                  {revision.created_by?.name ||
                    revision.created_by?.username ||
                    t('System')}
                  {' · '}
                  {revision.created_on || '—'}
                </TinyMeta>
              </RevisionCard>
            ))}
          </RevisionList>
        </Stack>
      );
    }

    if (requestedTab === 'pages') {
      return renderPagesManager();
    }

    if (requestedTab === 'studio') {
      return (
        <ContentStack>
          <BlockStudio
            draftPage={draftPage}
            pages={data?.pages || []}
            charts={data?.available_charts || []}
            dashboards={data?.dashboards || []}
            mediaAssets={data?.media_assets || []}
            portalLayout={portalLayout}
            navigationMenus={menus}
            styleBundles={data?.style_bundles || []}
            blockTypes={data?.block_types || EMPTY_BLOCK_TYPES}
            reusableBlocks={data?.reusable_blocks || EMPTY_REUSABLE_BLOCKS}
            starterPatterns={data?.starter_patterns || EMPTY_STARTER_PATTERNS}
            themes={data?.themes || []}
            templates={data?.templates || []}
            search={search}
            onSearchChange={setSearch}
            onNewPage={loadNewPage}
            onSelectPage={pageSlug => openStudioPage(pageSlug)}
            onChangeDraftPage={nextPage => {
              setDraftPage(nextPage);
            }}
            onChangePortalLayout={setPortalLayout}
            onSavePortalLayout={savePortalLayout}
            onSaveDraft={savePage}
            savingDraft={savingPage}
            savingPortalLayout={savingLayout}
          />
        </ContentStack>
      );
    }

    if (requestedTab === 'media' && data?.permissions.can_manage_media) {
      return (
        <DesignLayout>
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('Upload Asset')}</PanelTitle>
            </PanelHeader>
            <Stack>
              <FieldBlock>
                <FieldLabel>{t('File')}</FieldLabel>
                <input
                  type="file"
                  onChange={event =>
                    setAssetDraft(previous => ({
                      ...previous,
                      file: event.target.files?.[0] || null,
                    }))
                  }
                />
              </FieldBlock>
              <FieldGrid>
                <FieldBlock>
                  <FieldLabel>{t('Title')}</FieldLabel>
                  <Input
                    value={assetDraft.title}
                    onChange={event =>
                      setAssetDraft(previous => ({
                        ...previous,
                        title: event.target.value,
                      }))
                    }
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Visibility')}</FieldLabel>
                  <Select
                    value={assetDraft.visibility}
                    onChange={value =>
                      setAssetDraft(previous => ({
                        ...previous,
                        visibility: value,
                      }))
                    }
                    options={[
                      { value: 'private', label: t('Private') },
                      {
                        value: 'authenticated',
                        label: t('Authenticated'),
                      },
                      { value: 'public', label: t('Public') },
                    ]}
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Alt Text')}</FieldLabel>
                  <Input
                    value={assetDraft.alt_text}
                    onChange={event =>
                      setAssetDraft(previous => ({
                        ...previous,
                        alt_text: event.target.value,
                      }))
                    }
                  />
                </FieldBlock>
                <FieldBlock>
                  <FieldLabel>{t('Caption')}</FieldLabel>
                  <Input
                    value={assetDraft.caption}
                    onChange={event =>
                      setAssetDraft(previous => ({
                        ...previous,
                        caption: event.target.value,
                      }))
                    }
                  />
                </FieldBlock>
              </FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Description')}</FieldLabel>
                <Input.TextArea
                  rows={4}
                  value={assetDraft.description}
                  onChange={event =>
                    setAssetDraft(previous => ({
                      ...previous,
                      description: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                loading={uploadingAsset}
                onClick={uploadAsset}
              >
                {t('Upload Asset')}
              </Button>
            </Stack>
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('Assets')}</PanelTitle>
              <Tag>{data?.stats.media_assets || 0}</Tag>
            </PanelHeader>
            <SectionList>
              {(data?.media_assets || []).length ? (
                (data?.media_assets || []).map(asset => (
                  <DesignCard key={asset.id}>
                    <Stack>
                      <div>
                        <strong>{asset.title}</strong>
                        <TinyMeta>
                          {asset.asset_type} ·{' '}
                          {asset.original_filename || asset.slug}
                        </TinyMeta>
                      </div>
                      <Space wrap>
                        <Tag>{asset.visibility}</Tag>
                        <Tag>{asset.status}</Tag>
                        {asset.file_extension ? (
                          <Tag>{asset.file_extension}</Tag>
                        ) : null}
                      </Space>
                      <Space wrap>
                        <Button
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() =>
                            window.open(
                              asset.download_url || '#',
                              '_blank',
                              'noopener',
                            )
                          }
                        >
                          {t('Preview')}
                        </Button>
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => archiveAsset(asset.id)}
                        >
                          {t('Archive')}
                        </Button>
                      </Space>
                    </Stack>
                  </DesignCard>
                ))
              ) : (
                <Empty description={t('No media assets yet.')} />
              )}
            </SectionList>
          </Panel>
        </DesignLayout>
      );
    }

    if (requestedTab === 'menus') {
      return (
        <Stack>
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('Header Menus')}</PanelTitle>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() =>
                  setMenus(previous => ({
                    ...previous,
                    header: [...previous.header, defaultMenu('header')],
                  }))
                }
              >
                {t('Add Header Menu')}
              </Button>
            </PanelHeader>
            {menus.header.map((menu, menuIndex) => (
              <Stack key={`${menu.slug}-${menuIndex}`}>
                <FieldGrid>
                  <FieldBlock>
                    <FieldLabel>{t('Menu Title')}</FieldLabel>
                    <Input
                      value={menu.title}
                      onChange={event =>
                        updateMenu('header', menuIndex, {
                          title: event.target.value,
                        })
                      }
                    />
                  </FieldBlock>
                  <FieldBlock>
                    <FieldLabel>{t('Slug')}</FieldLabel>
                    <Input
                      value={menu.slug}
                      onChange={event =>
                        updateMenu('header', menuIndex, {
                          slug: event.target.value,
                        })
                      }
                    />
                  </FieldBlock>
                </FieldGrid>
                <FieldGrid>
                  <FieldBlock>
                    <FieldLabel>{t('Description')}</FieldLabel>
                    <Input
                      value={menu.description || ''}
                      onChange={event =>
                        updateMenu('header', menuIndex, {
                          description: event.target.value,
                        })
                      }
                    />
                  </FieldBlock>
                  <FieldBlock>
                    <FieldLabel>{t('Visibility')}</FieldLabel>
                    <Select
                      value={menu.visibility || 'public'}
                      onChange={value =>
                        updateMenu('header', menuIndex, {
                          visibility: value,
                        })
                      }
                      options={[
                        { value: 'public', label: t('Public') },
                        { value: 'authenticated', label: t('Authenticated') },
                        { value: 'draft', label: t('Draft') },
                      ]}
                    />
                  </FieldBlock>
                </FieldGrid>
                <Space>
                  <Switch
                    checked={menu.is_enabled !== false}
                    onChange={checked =>
                      updateMenu('header', menuIndex, {
                        is_enabled: checked,
                      })
                    }
                  />
                  <Button
                    size="small"
                    onClick={() =>
                      updateMenu('header', menuIndex, {
                        items: [...menu.items, defaultMenuItem()],
                      })
                    }
                  >
                    {t('Add Item')}
                  </Button>
                </Space>
                {renderMenuItems('header', menuIndex, menu.items || [])}
              </Stack>
            ))}
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('Footer Menus')}</PanelTitle>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() =>
                  setMenus(previous => ({
                    ...previous,
                    footer: [...previous.footer, defaultMenu('footer')],
                  }))
                }
              >
                {t('Add Footer Menu')}
              </Button>
            </PanelHeader>
            {menus.footer.map((menu, menuIndex) => (
              <Stack key={`${menu.slug}-${menuIndex}`}>
                <FieldGrid>
                  <FieldBlock>
                    <FieldLabel>{t('Menu Title')}</FieldLabel>
                    <Input
                      value={menu.title}
                      onChange={event =>
                        updateMenu('footer', menuIndex, {
                          title: event.target.value,
                        })
                      }
                    />
                  </FieldBlock>
                  <FieldBlock>
                    <FieldLabel>{t('Slug')}</FieldLabel>
                    <Input
                      value={menu.slug}
                      onChange={event =>
                        updateMenu('footer', menuIndex, {
                          slug: event.target.value,
                        })
                      }
                    />
                  </FieldBlock>
                </FieldGrid>
                <Space>
                  <Switch
                    checked={menu.is_enabled !== false}
                    onChange={checked =>
                      updateMenu('footer', menuIndex, {
                        is_enabled: checked,
                      })
                    }
                  />
                  <Button
                    size="small"
                    onClick={() =>
                      updateMenu('footer', menuIndex, {
                        items: [...menu.items, defaultMenuItem()],
                      })
                    }
                  >
                    {t('Add Item')}
                  </Button>
                </Space>
                {renderMenuItems('footer', menuIndex, menu.items || [])}
              </Stack>
            ))}
          </Panel>
          <Button
            type="primary"
            loading={savingMenus}
            icon={<SaveOutlined />}
            onClick={saveMenuConfiguration}
          >
            {t('Save Menus')}
          </Button>
        </Stack>
      );
    }

    if (requestedTab === 'portal') {
      return (
        <Panel>
          <Stack>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Portal Layout Title')}</FieldLabel>
                <Input
                  value={portalLayout.title || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      title: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Portal Title')}</FieldLabel>
                <Input
                  value={portalLayout.portalTitle || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      portalTitle: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Portal Subtitle')}</FieldLabel>
              <Input
                value={portalLayout.portalSubtitle || ''}
                onChange={event =>
                  setPortalLayout(previous => ({
                    ...previous,
                    portalSubtitle: event.target.value,
                  }))
                }
              />
            </FieldBlock>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Welcome Badge')}</FieldLabel>
                <Input
                  value={portalLayout.welcomeBadge || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      welcomeBadge: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Page Max Width')}</FieldLabel>
                <InputNumber
                  style={{ width: '100%' }}
                  value={Number(portalLayout.pageMaxWidth) || 1280}
                  onChange={value =>
                    setPortalLayout(previous => ({
                      ...previous,
                      pageMaxWidth: Number(value) || 1280,
                    }))
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Login Button Text')}</FieldLabel>
                <Input
                  value={portalLayout.loginButtonText || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      loginButtonText: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Login Button URL')}</FieldLabel>
                <Input
                  value={portalLayout.loginButtonUrl || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      loginButtonUrl: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Accent Color')}</FieldLabel>
                <Input
                  value={portalLayout.accentColor || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      accentColor: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Secondary Color')}</FieldLabel>
                <Input
                  value={portalLayout.secondaryColor || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      secondaryColor: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Surface Color')}</FieldLabel>
                <Input
                  value={portalLayout.surfaceColor || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      surfaceColor: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Theme Toggle')}</FieldLabel>
                <Switch
                  checked={portalLayout.showThemeToggle !== false}
                  onChange={checked =>
                    setPortalLayout(previous => ({
                      ...previous,
                      showThemeToggle: checked,
                    }))
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Light Mode Label')}</FieldLabel>
                <Input
                  value={portalLayout.lightModeLabel || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      lightModeLabel: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Dark Mode Label')}</FieldLabel>
                <Input
                  value={portalLayout.darkModeLabel || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      darkModeLabel: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Footer Text')}</FieldLabel>
              <Input
                value={portalLayout.footerText || ''}
                onChange={event =>
                  setPortalLayout(previous => ({
                    ...previous,
                    footerText: event.target.value,
                  }))
                }
              />
            </FieldBlock>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Empty Page Message')}</FieldLabel>
                <Input
                  value={portalLayout.emptyPageMessage || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      emptyPageMessage: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('No Public Page Message')}</FieldLabel>
                <Input
                  value={portalLayout.noPublicPageMessage || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      noPublicPageMessage: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldGrid>
              <FieldBlock>
                <FieldLabel>{t('Dashboard Badge Label')}</FieldLabel>
                <Input
                  value={portalLayout.dashboardBadgeLabel || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      dashboardBadgeLabel: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
              <FieldBlock>
                <FieldLabel>{t('Dashboard Back Label')}</FieldLabel>
                <Input
                  value={portalLayout.dashboardBackLabel || ''}
                  onChange={event =>
                    setPortalLayout(previous => ({
                      ...previous,
                      dashboardBackLabel: event.target.value,
                    }))
                  }
                />
              </FieldBlock>
            </FieldGrid>
            <FieldBlock>
              <FieldLabel>{t('Dashboard Embed Subtitle')}</FieldLabel>
              <Input
                value={portalLayout.dashboardEmbedSubtitle || ''}
                onChange={event =>
                  setPortalLayout(previous => ({
                    ...previous,
                    dashboardEmbedSubtitle: event.target.value,
                  }))
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Dashboard Embed Intro')}</FieldLabel>
              <Input.TextArea
                rows={3}
                value={portalLayout.dashboardEmbedIntro || ''}
                onChange={event =>
                  setPortalLayout(previous => ({
                    ...previous,
                    dashboardEmbedIntro: event.target.value,
                  }))
                }
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t('Dashboard Loading Label')}</FieldLabel>
              <Input
                value={portalLayout.dashboardLoadingLabel || ''}
                onChange={event =>
                  setPortalLayout(previous => ({
                    ...previous,
                    dashboardLoadingLabel: event.target.value,
                  }))
                }
              />
            </FieldBlock>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={savingLayout}
              onClick={savePortalLayout}
            >
              {t('Save Portal Settings')}
            </Button>
          </Stack>
        </Panel>
      );
    }

    if (requestedTab === 'themes') {
      return renderThemeManager();
    }
    if (requestedTab === 'templates') {
      return renderTemplateManager();
    }
    if (requestedTab === 'styles') {
      return renderStyleManager();
    }

    return null;
  }

  if (!canViewCms) {
    return (
      <Result
        status="403"
        title={t('CMS access denied')}
        subTitle={t('You do not have permission to manage portal pages.')}
      />
    );
  }

  const currentStatus = draftPage?.status || 'draft';
  const currentPath =
    draftPage && (draftPage.is_homepage || draftPage.path || draftPage.slug)
      ? resolvePortalPagePath(draftPage)
      : null;
  const tabTitleMap: Record<AdminTab, string> = {
    overview: t('Portal Administration'),
    pages: t('Pages'),
    studio: t('Page Studio'),
    media: t('Media Library'),
    menus: t('Navigation Menus'),
    portal: t('Portal Settings'),
    themes: t('Themes'),
    templates: t('Templates'),
    styles: t('Styles'),
  };
  const tabSubtitleMap: Record<AdminTab, string> = {
    overview: t(
      'Track recent publishing activity, page volume, and CMS design-system coverage.',
    ),
    pages: t(
      'Search, filter, and manage CMS pages, routing, hierarchy, and publish state.',
    ),
    studio: t(
      'Compose pages with reusable blocks, responsive regions, and typed content settings.',
    ),
    media: t(
      'Upload and manage images, files, and downloadable resources for CMS-authored pages.',
    ),
    menus: t(
      'Configure header and footer navigation, nested menus, and page-linked items.',
    ),
    portal: t(
      'Manage shared branding, portal chrome, and public layout defaults.',
    ),
    themes: t(
      'Maintain active themes, token palettes, and portal-wide design settings.',
    ),
    templates: t(
      'Design layout templates, slots, and reusable structural rules for pages.',
    ),
    styles: t(
      'Control shared style bundles, CSS variables, and scoped presentation overrides.',
    ),
  };
  const adminActions =
    requestedTab === 'studio' ? (
      <Space wrap>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() =>
            setQueryState({
              pageSlug: draftPage?.slug || requestedPageSlug,
              tab: 'pages',
            })
          }
        >
          {t('Back to Pages')}
        </Button>
        <Button icon={<PlusOutlined />} onClick={loadNewPage}>
          {t('New Page')}
        </Button>
        <Button
          icon={<CopyOutlined />}
          onClick={duplicatePage}
          disabled={!draftPage?.id || savingPage}
        >
          {t('Duplicate')}
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={savingPage}
          onClick={savePage}
          disabled={!draftPage || draftPage.is_published}
        >
          {t('Save Draft')}
        </Button>
        <Button
          icon={
            draftPage?.is_published ? <GlobalOutlined /> : <RocketOutlined />
          }
          onClick={() => togglePublish(!draftPage?.is_published)}
          disabled={!draftPage?.id || savingPage}
        >
          {draftPage?.is_published ? t('Unpublish') : t('Publish')}
        </Button>
        <Button
          icon={<EyeOutlined />}
          disabled={!draftPage?.slug || draftPage.visibility !== 'public'}
          onClick={() => previewPage(draftPage)}
        >
          {t('Open Public Page')}
        </Button>
        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={archivePage}
          disabled={
            !draftPage?.id || currentStatus === 'archived' || savingPage
          }
        >
          {t('Archive')}
        </Button>
      </Space>
    ) : (
      <Space wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={loadNewPage}>
          {t('Create Page')}
        </Button>
        <Button
          icon={<LayoutOutlined />}
          disabled={!draftPage}
          onClick={() =>
            setQueryState({
              pageSlug: draftPage?.slug || requestedPageSlug,
              tab: 'studio',
            })
          }
        >
          {t('Open Studio')}
        </Button>
      </Space>
    );

  return (
    <AdminShell style={SHELL_STYLE}>
      {contextHolder}
      <TopBar>
        <TopBarBrand>
          <TopBarBrandIcon>
            <LayoutOutlined />
          </TopBarBrandIcon>
          <div>
            <Eyebrow style={{ color: '#93c5fd' }}>
              {t('Portal Administration')}
            </Eyebrow>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {t('CMS Pages')}
            </div>
          </div>
        </TopBarBrand>
        <TopBarActions>{adminActions}</TopBarActions>
      </TopBar>
      <ShellBody>
        <LeftRail>
          <RailSection>
            <RailLabel>{t('Workspace')}</RailLabel>
            {adminNavItems.map(item => (
              <RailButton
                key={item.key}
                $active={requestedTab === item.key}
                onClick={() =>
                  setQueryState({
                    pageSlug: draftPage?.slug || requestedPageSlug,
                    tab: item.key,
                  })
                }
              >
                <RailButtonContent>
                  {item.icon}
                  <span>{item.label}</span>
                </RailButtonContent>
              </RailButton>
            ))}
          </RailSection>
          <RailSection>
            <RailLabel>{t('Current Page')}</RailLabel>
            <Panel>
              {draftPage ? (
                <Stack>
                  <div>
                    <strong>{draftPage.title}</strong>
                    <TinyMeta>{currentPath || t('Unsaved draft')}</TinyMeta>
                  </div>
                  <Space wrap>
                    <Tag color={pageStateColor(draftPage)}>
                      {pageStateLabel(draftPage)}
                    </Tag>
                    {draftPage.is_homepage ? (
                      <Tag color="gold">{t('Landing Page')}</Tag>
                    ) : null}
                  </Space>
                </Stack>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('Select a page to start authoring.')}
                />
              )}
            </Panel>
          </RailSection>
        </LeftRail>
        <ShellMain>
          <ContentStack>
            <Header>
              <TitleGroup>
                <Eyebrow>{tabTitleMap[requestedTab]}</Eyebrow>
                <Title>
                  {requestedTab === 'studio'
                    ? draftPage?.title || t('Page Studio')
                    : tabTitleMap[requestedTab]}
                </Title>
                <Subtitle>{tabSubtitleMap[requestedTab]}</Subtitle>
              </TitleGroup>
              {requestedTab === 'pages' ? (
                <Tag color="blue">{t('%s pages', data?.pages.length || 0)}</Tag>
              ) : requestedTab === 'studio' && draftPage ? (
                <Space wrap>
                  <Tag color={pageStateColor(draftPage)}>
                    {pageStateLabel(draftPage)}
                  </Tag>
                  {currentPath ? <Tag>{currentPath}</Tag> : null}
                </Space>
              ) : null}
            </Header>

            {error ? (
              <Alert
                type="error"
                showIcon
                message={error}
                action={
                  <Button onClick={() => loadBootstrap()}>{t('Retry')}</Button>
                }
              />
            ) : null}

            {loading && !data ? <Spin size="large" /> : renderActiveTab()}
          </ContentStack>
        </ShellMain>
      </ShellBody>
    </AdminShell>
  );
}
