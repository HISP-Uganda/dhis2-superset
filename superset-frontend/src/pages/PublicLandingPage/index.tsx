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
/* eslint-disable no-restricted-imports, theme-colors/no-literal-colors, @typescript-eslint/no-use-before-define */

import { CSSProperties, DragEvent, useEffect, useMemo, useState } from 'react';
import { styled, SupersetClient, t } from '@superset-ui/core';
import {
  Alert,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Tooltip,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import { useHistory, useLocation } from 'react-router-dom';
import logoImage from 'src/assets/images/loog.jpg';
import {
  createDraftPage,
  createEmptyComponent,
  createEmptySection,
  moveArrayItem,
  normalizeDraftPage,
  resolveLandingPagePath,
  withDefaultWelcomeNavigationItems,
} from './portalUtils';
import { ensurePageBlocks } from './blockUtils';
import { groupBlocksBySlot, RenderBlockTree } from './BlockRenderer';
import PublicDashboardEmbed from './PublicDashboardEmbed';
import type {
  PortalDashboardSummary,
  PortalNavigationItem,
  PortalPage,
  PortalPageComponent,
  PortalPageSection,
  PortalPayload,
} from './types';
import usePublicPortal from './usePublicPortal';

type VisualMode = 'light' | 'dark';

const PAGE_QUERY_PARAM = 'page';
const DASHBOARD_QUERY_PARAM = 'dashboard';
const PORTAL_THEME_STORAGE_KEY = 'superset.public.portal.theme';

const PageShell = styled.div`
  min-height: 100vh;
  font-family: var(--portal-font-body, inherit);
  background: var(--portal-bg);
  color: var(--portal-text);

  a {
    color: var(--portal-link, var(--portal-accent));
    text-decoration: var(--portal-link-decoration, none);
  }

  a:hover {
    text-decoration: var(--portal-link-hover-decoration, underline);
  }
`;

const StickyHeader = styled.header`
  position: sticky;
  top: 0;
  z-index: 30;
  backdrop-filter: blur(18px);
  background: var(--portal-header-bg);
  border-bottom: 1px solid var(--portal-border);
`;

const HeaderInner = styled.div<{ $maxWidth: string }>`
  width: 100%;
  max-width: ${({ $maxWidth }) => $maxWidth};
  margin: 0 auto;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;

  @media (max-width: 960px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const Brand = styled.button`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
`;

const BrandImage = styled.img`
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: var(--portal-radius-md, 0);
  box-shadow: var(--portal-shadow-card, none);
`;

const BrandLabel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const BrandEyebrow = styled.span`
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--portal-muted);
`;

const BrandTitle = styled.span`
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
`;

const NavRow = styled.nav`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const NavButton = styled.button<{ $active?: boolean }>`
  border: 0;
  border-radius: var(--portal-radius-md, 0);
  padding: 10px 16px;
  background: ${({ $active }) =>
    $active ? 'var(--portal-nav-active-bg)' : 'transparent'};
  color: ${({ $active }) =>
    $active ? 'var(--portal-nav-active-text)' : 'var(--portal-muted-strong)'};
  font-weight: ${({ $active }) => ($active ? 700 : 600)};
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: var(--portal-nav-hover-bg);
    color: var(--portal-text);
  }
`;

const Main = styled.main<{ $maxWidth: string }>`
  width: 100%;
  max-width: ${({ $maxWidth }) => $maxWidth};
  margin: 0 auto;
  padding: 28px 24px 72px;
`;

const Section = styled.section`
  margin-top: 28px;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
  flex-wrap: wrap;
`;

const SectionTitleGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-size: 24px;
  line-height: 1.1;
  letter-spacing: -0.04em;
  color: var(--portal-text);
`;

const SectionSubtitle = styled.p`
  margin: 0;
  color: var(--portal-muted-strong);
  font-size: 15px;
  line-height: 1.7;
`;

const SectionNote = styled.span`
  color: var(--portal-muted);
  font-size: 13px;
`;

const SurfaceCard = styled.article`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px;
  border-radius: var(--portal-radius-lg, 0);
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  box-shadow: var(--portal-shadow-card, none);
`;

const CardTitle = styled.h3`
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
  letter-spacing: -0.03em;
  color: var(--portal-text);
`;

const CardBody = styled.div`
  color: var(--portal-muted-strong);
  font-size: 15px;
  line-height: 1.75;
`;

const Footer = styled.footer`
  border-top: 1px solid var(--portal-border);
  background: var(--portal-footer-bg);
`;

const FooterInner = styled.div<{ $maxWidth: string }>`
  width: 100%;
  max-width: ${({ $maxWidth }) => $maxWidth};
  margin: 0 auto;
  padding: 22px 24px 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  color: var(--portal-muted);
`;

const FooterLinks = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
`;

const FooterLink = styled.a`
  color: var(--portal-muted-strong);
  text-decoration: none;

  &:hover {
    color: var(--portal-text);
    text-decoration: none;
  }
`;

const DrawerStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const EditorSectionCard = styled.div<{ $dragging?: boolean }>`
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: ${({ $dragging }) =>
    $dragging ? 'rgba(15, 118, 110, 0.06)' : '#ffffff'};
`;

const EditorHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
`;

const EditorActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const FieldLabel = styled.div`
  margin-bottom: 6px;
  color: ${({ theme }) => theme.colorTextLabel};
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const ComponentDivider = styled.div`
  margin: 16px 0;
  height: 1px;
  background: rgba(148, 163, 184, 0.18);
`;

function getStoredTheme(): VisualMode {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const theme = window.localStorage.getItem(PORTAL_THEME_STORAGE_KEY);
  return theme === 'dark' ? 'dark' : 'light';
}

function persistTheme(theme: VisualMode) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(PORTAL_THEME_STORAGE_KEY, theme);
}

function buildPortalSearch({
  pageSlug,
  dashboardSlug,
}: {
  pageSlug?: string | null;
  dashboardSlug?: string | null;
}) {
  const normalizedPath = pageSlug
    ? `/superset/public/${pageSlug}/`
    : '/superset/public/';
  const params = new URLSearchParams();
  if (dashboardSlug) {
    params.set(DASHBOARD_QUERY_PARAM, dashboardSlug);
  }

  const query = params.toString();
  return query ? `${normalizedPath}?${query}` : normalizedPath;
}

function buildPageSearch(slug?: string | null) {
  return buildPortalSearch({ pageSlug: slug });
}

function readPageSlug(pathname: string, search: string) {
  const querySlug = new URLSearchParams(search).get(PAGE_QUERY_PARAM);
  if (querySlug) {
    return querySlug;
  }
  const match = pathname.match(/^\/superset\/public\/([^/]+)\/?$/);
  return match?.[1] || null;
}

function readDashboardSlug(search: string) {
  return new URLSearchParams(search).get(DASHBOARD_QUERY_PARAM);
}

function resolveCssLength(
  fallback: string,
  ...candidates: Array<string | number | null | undefined>
) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) {
      continue;
    }
    if (typeof candidate === 'number') {
      return candidate > 0 ? `${candidate}px` : '100%';
    }
    const text = candidate.trim();
    if (!text || text === '0' || text === '0px' || text === 'none') {
      continue;
    }
    return /^\d+$/.test(text) ? `${text}px` : text;
  }
  return fallback;
}

function resolveMaxWidth(
  ...candidates: Array<string | number | null | undefined>
) {
  return resolveCssLength('100%', ...candidates);
}

function resolveGapValue(
  ...candidates: Array<string | number | null | undefined>
) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) {
      continue;
    }
    if (typeof candidate === 'number') {
      return candidate >= 0 ? `${candidate}px` : '24px';
    }
    const text = candidate.trim();
    if (!text || text === 'none') {
      continue;
    }
    return /^\d+$/.test(text) ? `${text}px` : text;
  }
  return '24px';
}

function buildEditableSections(
  sections: PortalPageSection[],
  userLayout?: PortalPayload['user_layout'] | null,
) {
  const hiddenIds = new Set(userLayout?.layout?.hidden_section_ids || []);
  const preferredOrder = userLayout?.layout?.section_order || [];
  const preferredIndex = new Map(
    preferredOrder.map((sectionId, index) => [sectionId, index]),
  );

  return [...sections]
    .sort((left, right) => {
      const leftOrder =
        left.id !== undefined && preferredIndex.has(left.id)
          ? preferredIndex.get(left.id)!
          : Number.MAX_SAFE_INTEGER;
      const rightOrder =
        right.id !== undefined && preferredIndex.has(right.id)
          ? preferredIndex.get(right.id)!
          : Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.display_order - right.display_order;
    })
    .map(section => ({
      ...section,
      is_visible:
        section.id && hiddenIds.has(section.id) ? false : section.is_visible,
    }));
}

function joinClassNames(...values: Array<string | undefined | null | false>) {
  return values.filter(Boolean).join(' ');
}

function emptyDraftPage(displayOrder: number): PortalPage {
  return {
    title: t('New Page'),
    subtitle: '',
    description: '',
    slug: '',
    status: 'published',
    is_published: true,
    is_homepage: false,
    display_order: displayOrder,
    settings: {},
    blocks: [],
    sections: [createEmptySection('hero'), createEmptySection('content')],
  } as PortalPage;
}

export default function PublicLandingPage() {
  const history = useHistory();
  const location = useLocation();
  const pageSlug = readPageSlug(location.pathname, location.search);
  const selectedDashboardSlug = readDashboardSlug(location.search);
  const shouldOpenStudio = false;
  const shouldOpenLayout = false;
  const { data, error, loading, reloadPortal } = usePublicPortal(pageSlug);
  const [messageApi, contextHolder] = message.useMessage();
  const [visualMode, setVisualMode] = useState<VisualMode>(getStoredTheme());
  const [layoutDrawerOpen, setLayoutDrawerOpen] = useState(false);
  const [layoutSections, setLayoutSections] = useState<PortalPageSection[]>([]);
  const [draggedSectionId, setDraggedSectionId] = useState<number | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioLoading, setStudioLoading] = useState(false);
  const [savingPage, setSavingPage] = useState(false);
  const [draftPage, setDraftPage] = useState<PortalPage | null>(null);

  const currentPage = data?.current_page || null;
  const landingPagePath = resolveLandingPagePath(data?.pages || [], currentPage);
  const pageBlocks = ensurePageBlocks(currentPage);
  const themeTokens = currentPage?.rendering?.theme?.tokens || {};
  const themeColors = themeTokens.colors || {};
  const themeContainers = themeTokens.containers || {};
  const pageMaxWidth = resolveMaxWidth(
    currentPage?.settings?.pageMaxWidth,
    themeContainers.pageMaxWidth,
    data?.portal_layout.config.pageMaxWidth,
  );
  const contentShellGap = resolveGapValue(
    currentPage?.settings?.contentAreaGap,
  );
  const sidebarWidth = resolveCssLength(
    '320px',
    currentPage?.settings?.sidebarWidth,
    currentPage?.rendering?.template_structure?.settings?.sidebarWidth,
  );
  const selectedDashboard =
    data?.dashboards.find(
      dashboard =>
        dashboard.slug === selectedDashboardSlug ||
        String(dashboard.id) === selectedDashboardSlug,
    ) || null;
  const portalTitle =
    data?.portal_layout.config.portalTitle ||
    data?.config.navbar.title.text ||
    t('Public Analytics Portal');
  const accentColor =
    themeColors.accent || data?.portal_layout.config.accentColor || '#0f766e';
  const secondaryColor =
    themeColors.secondary ||
    data?.portal_layout.config.secondaryColor ||
    '#1d4ed8';
  const surfaceColor =
    themeColors.surface || data?.portal_layout.config.surfaceColor || '#ffffff';
  const logoSrc =
    visualMode === 'dark'
      ? data?.config.navbar.logo.darkSrc ||
        data?.config.navbar.logo.src ||
        logoImage
      : data?.config.navbar.logo.src || logoImage;
  const renderedRegions = useMemo(
    () => groupBlocksBySlot(pageBlocks),
    [pageBlocks],
  );

  useEffect(() => {
    if (!currentPage) {
      setLayoutSections([]);
      return;
    }
    setLayoutSections(
      buildEditableSections(currentPage.sections, data?.user_layout),
    );
  }, [currentPage, data?.user_layout]);

  useEffect(() => {
    if (!shouldOpenLayout || !data?.permissions.can_customize_layout) {
      return;
    }
    setLayoutDrawerOpen(true);
  }, [data?.permissions.can_customize_layout, shouldOpenLayout]);

  useEffect(() => {
    if (!shouldOpenStudio || !data?.permissions.can_manage_pages) {
      return undefined;
    }
    const nextSlug = pageSlug || currentPage?.slug;
    if (!nextSlug) {
      return undefined;
    }
    setStudioOpen(true);
    if (currentPage?.slug === nextSlug) {
      setDraftPage(createDraftPage(currentPage));
      return undefined;
    }
    let isCancelled = false;
    setStudioLoading(true);
    SupersetClient.get({
      endpoint: `/api/v1/public_page/pages?slug=${encodeURIComponent(nextSlug)}&include_unpublished=true`,
    })
      .then(response => {
        if (isCancelled) {
          return;
        }
        setDraftPage(createDraftPage(response.json?.result as PortalPage));
      })
      .catch(caughtError => {
        if (isCancelled) {
          return;
        }
        messageApi.error(
          caughtError instanceof Error
            ? caughtError.message
            : t('Failed to load the page studio draft.'),
        );
      })
      .finally(() => {
        if (!isCancelled) {
          setStudioLoading(false);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [
    currentPage,
    currentPage?.slug,
    data?.permissions.can_manage_pages,
    messageApi,
    pageSlug,
    shouldOpenStudio,
  ]);

  useEffect(() => {
    if (!currentPage) {
      return;
    }
    if (
      location.pathname === '/superset/public/' &&
      landingPagePath !== '/superset/public/'
    ) {
      history.replace(`${landingPagePath}${location.search}${location.hash}`);
    }
  }, [
    currentPage,
    history,
    landingPagePath,
    location.hash,
    location.pathname,
    location.search,
  ]);

  useEffect(() => {
    if (!currentPage) {
      return;
    }
    document.title =
      currentPage.seo_title ||
      currentPage.title ||
      t('Public Analytics Portal');
    const description =
      currentPage.seo_description ||
      currentPage.excerpt ||
      currentPage.description ||
      '';
    let meta = document.querySelector(
      'meta[name="description"]',
    ) as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [currentPage]);

  function setTheme(nextTheme: VisualMode) {
    setVisualMode(nextTheme);
    persistTheme(nextTheme);
  }

  function navigateToPath(path?: string | null, openInNewTab?: boolean) {
    if (!path) {
      return;
    }
    const target = new URL(path, window.location.origin);
    if (
      target.pathname === '/superset/public/' &&
      landingPagePath !== '/superset/public/'
    ) {
      target.pathname = new URL(landingPagePath, window.location.origin).pathname;
    }
    const targetPath = `${target.pathname}${target.search}${target.hash}`;

    if (openInNewTab) {
      window.open(target.toString(), '_blank', 'noopener,noreferrer');
      return;
    }

    if (
      target.pathname === '/superset/public/' ||
      target.pathname.startsWith('/superset/public/')
    ) {
      history.push(targetPath);
      return;
    }

    window.location.assign(targetPath);
  }

  function openHomepage() {
    history.push(landingPagePath);
  }

  function navigateToPublicDashboard(dashboard: PortalDashboardSummary) {
    history.push(
      buildPortalSearch({
        pageSlug: pageSlug || currentPage?.slug,
        dashboardSlug: dashboard.slug || String(dashboard.id),
      }),
    );
  }

  function clearSelectedDashboard() {
    history.push(
      buildPortalSearch({ pageSlug: pageSlug || currentPage?.slug }),
    );
  }

  function isNavItemActive(item: PortalNavigationItem) {
    if (item.page_id && item.page_id === currentPage?.id) {
      return true;
    }
    return Boolean(
      item.children?.some(
        child => child.page_id && child.page_id === currentPage?.id,
      ),
    );
  }

  function toMenuItems(items?: PortalNavigationItem[]): MenuProps['items'] {
    return (items || []).map(item => ({
      key: String(item.id),
      label: item.label,
      children: item.children?.length ? toMenuItems(item.children) : undefined,
      onClick: () => {
        const menuDashboard =
          item.dashboard_id != null
            ? data?.dashboards.find(
                dashboard => dashboard.id === item.dashboard_id,
              )
            : undefined;
        if (menuDashboard) {
          navigateToPublicDashboard(menuDashboard);
          return;
        }
        navigateToPath(item.path, item.open_in_new_tab);
      },
    }));
  }

  async function saveLayout() {
    if (!currentPage) {
      return;
    }
    setSavingLayout(true);
    try {
      await SupersetClient.post({
        endpoint: '/api/v1/public_page/page-layout',
        jsonPayload: {
          page_id: currentPage.id,
          section_order: layoutSections
            .map(section => section.id)
            .filter(
              (sectionId): sectionId is number => sectionId !== undefined,
            ),
          hidden_section_ids: layoutSections
            .filter(section => section.id && section.is_visible === false)
            .map(section => section.id) as number[],
        },
      });
      await reloadPortal(currentPage.slug);
      setLayoutDrawerOpen(false);
      messageApi.success(t('Layout preferences saved.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to save layout preferences.'),
      );
    } finally {
      setSavingLayout(false);
    }
  }

  function moveLayoutSection(sectionId: number, direction: -1 | 1) {
    const currentIndex = layoutSections.findIndex(
      section => section.id === sectionId,
    );
    if (currentIndex < 0) {
      return;
    }
    const nextIndex = currentIndex + direction;
    setLayoutSections(moveArrayItem(layoutSections, currentIndex, nextIndex));
  }

  function onSectionDrop(targetSectionId: number) {
    if (!draggedSectionId || draggedSectionId === targetSectionId) {
      return;
    }
    const sourceIndex = layoutSections.findIndex(
      section => section.id === draggedSectionId,
    );
    const targetIndex = layoutSections.findIndex(
      section => section.id === targetSectionId,
    );
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }
    setLayoutSections(moveArrayItem(layoutSections, sourceIndex, targetIndex));
  }

  async function loadDraftPage(nextSlug?: string, createNew = false) {
    if (createNew) {
      setDraftPage(emptyDraftPage(data?.pages.length || 0));
      return;
    }

    if (!nextSlug) {
      return;
    }

    if (currentPage?.slug === nextSlug) {
      setDraftPage(createDraftPage(currentPage));
      return;
    }

    setStudioLoading(true);
    try {
      const response = await SupersetClient.get({
        endpoint: `/api/v1/public_page/pages?slug=${encodeURIComponent(nextSlug)}&include_unpublished=true`,
      });
      setDraftPage(createDraftPage(response.json?.result as PortalPage));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to load the page studio draft.'),
      );
    } finally {
      setStudioLoading(false);
    }
  }

  function updateDraftPage(patch: Partial<PortalPage>) {
    setDraftPage(previous =>
      previous
        ? {
            ...previous,
            ...patch,
          }
        : previous,
    );
  }

  function updateSection(
    sectionIndex: number,
    patch: Partial<PortalPageSection>,
  ) {
    setDraftPage(previous => {
      if (!previous) {
        return previous;
      }
      const sections = [...previous.sections];
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        ...patch,
      };
      return {
        ...previous,
        sections,
      };
    });
  }

  function updateSectionSetting(
    sectionIndex: number,
    key: string,
    value: string | number | boolean | null,
  ) {
    setDraftPage(previous => {
      if (!previous) {
        return previous;
      }
      const sections = [...previous.sections];
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        settings: {
          ...(sections[sectionIndex].settings || {}),
          [key]: value,
        },
      };
      return {
        ...previous,
        sections,
      };
    });
  }

  function addSection(sectionType = 'content') {
    setDraftPage(previous => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        sections: [...previous.sections, createEmptySection(sectionType)],
      };
    });
  }

  function removeSection(sectionIndex: number) {
    setDraftPage(previous => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        sections: previous.sections.filter(
          (_, index) => index !== sectionIndex,
        ),
      };
    });
  }

  function moveDraftSection(sectionIndex: number, direction: -1 | 1) {
    setDraftPage(previous => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        sections: moveArrayItem(
          previous.sections,
          sectionIndex,
          sectionIndex + direction,
        ),
      };
    });
  }

  function addComponent(sectionIndex: number, componentType = 'markdown') {
    setDraftPage(previous => {
      if (!previous) {
        return previous;
      }
      const sections = [...previous.sections];
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        components: [
          ...(sections[sectionIndex].components || []),
          createEmptyComponent(componentType),
        ],
      };
      return {
        ...previous,
        sections,
      };
    });
  }

  function updateComponent(
    sectionIndex: number,
    componentIndex: number,
    patch: Partial<PortalPageComponent>,
  ) {
    setDraftPage(previous => {
      if (!previous) {
        return previous;
      }
      const sections = [...previous.sections];
      const components = [...sections[sectionIndex].components];
      components[componentIndex] = {
        ...components[componentIndex],
        ...patch,
      };
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        components,
      };
      return {
        ...previous,
        sections,
      };
    });
  }

  function updateComponentSetting(
    sectionIndex: number,
    componentIndex: number,
    key: string,
    value: string | number | boolean | null,
  ) {
    setDraftPage(previous => {
      if (!previous) {
        return previous;
      }
      const sections = [...previous.sections];
      const components = [...sections[sectionIndex].components];
      components[componentIndex] = {
        ...components[componentIndex],
        settings: {
          ...(components[componentIndex].settings || {}),
          [key]: value,
        },
      };
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        components,
      };
      return {
        ...previous,
        sections,
      };
    });
  }

  function removeComponent(sectionIndex: number, componentIndex: number) {
    setDraftPage(previous => {
      if (!previous) {
        return previous;
      }
      const sections = [...previous.sections];
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        components: sections[sectionIndex].components.filter(
          (_, index) => index !== componentIndex,
        ),
      };
      return {
        ...previous,
        sections,
      };
    });
  }

  async function saveDraftPage() {
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
        endpoint: '/api/v1/public_page/pages',
        jsonPayload: normalizeDraftPage(draftPage),
      });
      const savedPage = response.json?.result as PortalPage;
      setDraftPage(createDraftPage(savedPage));
      await reloadPortal(savedPage.slug);
      history.push(buildPageSearch(savedPage.slug));
      messageApi.success(t('Page saved.'));
    } catch (caughtError) {
      messageApi.error(
        caughtError instanceof Error
          ? caughtError.message
          : t('Failed to save page.'),
      );
    } finally {
      setSavingPage(false);
    }
  }

  function renderSelectedDashboardView(dashboard: PortalDashboardSummary) {
    return (
      <Section>
        <SectionHeader>
          <SectionTitleGroup>
            <SectionTitle>{dashboard.dashboard_title}</SectionTitle>
            <SectionSubtitle>
              {t(
                'Viewing this dashboard inside the public portal keeps the public navigation available.',
              )}
            </SectionSubtitle>
          </SectionTitleGroup>
          <Button onClick={clearSelectedDashboard}>{t('Back to page')}</Button>
        </SectionHeader>
        <SurfaceCard>
          <PublicDashboardEmbed
            title={dashboard.dashboard_title}
            dashboardId={dashboard.id}
            dashboardUuid={dashboard.uuid}
            height={920}
            loadingLabel={t('Loading dashboard...')}
          />
        </SurfaceCard>
      </Section>
    );
  }

  const themeStyle = {
    '--portal-accent': accentColor,
    '--portal-secondary': secondaryColor,
    '--portal-bg': visualMode === 'dark' ? '#08111f' : '#f3f7fb',
    '--portal-bg-elevated': visualMode === 'dark' ? '#101a2c' : '#eef3f9',
    '--portal-wash':
      visualMode === 'dark'
        ? 'rgba(45, 212, 191, 0.12)'
        : 'rgba(15, 118, 110, 0.12)',
    '--portal-surface': visualMode === 'dark' ? '#132033' : surfaceColor,
    '--portal-text': visualMode === 'dark' ? '#ecf5ff' : '#0f172a',
    '--portal-muted': visualMode === 'dark' ? '#94a3b8' : '#64748b',
    '--portal-muted-strong': visualMode === 'dark' ? '#cbd5e1' : '#475569',
    '--portal-border':
      visualMode === 'dark'
        ? 'rgba(148, 163, 184, 0.18)'
        : 'rgba(148, 163, 184, 0.22)',
    '--portal-border-strong':
      visualMode === 'dark'
        ? 'rgba(148, 163, 184, 0.26)'
        : 'rgba(148, 163, 184, 0.28)',
    '--portal-header-bg':
      visualMode === 'dark'
        ? 'rgba(8, 17, 31, 0.86)'
        : 'rgba(255, 255, 255, 0.84)',
    '--portal-footer-bg':
      visualMode === 'dark'
        ? 'rgba(8, 17, 31, 0.92)'
        : 'rgba(255, 255, 255, 0.62)',
    '--portal-nav-hover-bg':
      visualMode === 'dark'
        ? 'rgba(148, 163, 184, 0.12)'
        : 'rgba(15, 23, 42, 0.06)',
    '--portal-nav-active-bg':
      visualMode === 'dark'
        ? 'rgba(45, 212, 191, 0.18)'
        : 'rgba(15, 118, 110, 0.12)',
    '--portal-nav-active-text': accentColor,
    ...(currentPage?.rendering?.css_variables || {}),
  } as CSSProperties;

  const footerItems = [
    ...(data?.navigation.footer.flatMap(menu => menu.items) || []),
    ...(data?.config.footer.links.map(link => ({
      id: link.url,
      label: link.text,
      path: link.url,
      open_in_new_tab: link.external,
    })) || []),
  ];
  const hasSidebar =
    Boolean(
      currentPage?.rendering?.template_structure?.regions?.sidebar?.enabled,
    ) && renderedRegions.sidebar.length > 0;
  const headerItems = withDefaultWelcomeNavigationItems(
    data?.navigation.header || [],
    data?.pages || [],
    currentPage,
  );

  return (
    <PageShell
      className={joinClassNames(currentPage?.rendering?.scope_class)}
      style={themeStyle}
    >
      {currentPage?.rendering?.css_text ? (
        <style>{currentPage.rendering.css_text}</style>
      ) : null}
      {contextHolder}
      <StickyHeader>
        <HeaderInner $maxWidth={pageMaxWidth}>
          <Brand type="button" onClick={openHomepage}>
            {data?.config.navbar.logo.enabled !== false && (
              <BrandImage
                src={logoSrc}
                alt={data?.config.navbar.logo.alt || t('Portal logo')}
              />
            )}
            <BrandLabel>
              <BrandEyebrow>
                {data?.portal_layout.config.welcomeBadge}
              </BrandEyebrow>
              <BrandTitle>{portalTitle}</BrandTitle>
            </BrandLabel>
          </Brand>
          <HeaderActions>
            <NavRow>
              {headerItems.map(item =>
                item.children?.length ? (
                  <Dropdown
                    key={String(item.id)}
                    trigger={['click', 'hover']}
                    menu={{ items: toMenuItems(item.children) }}
                  >
                    <NavButton $active={isNavItemActive(item)} type="button">
                      {item.label}
                    </NavButton>
                  </Dropdown>
                ) : (
                  <NavButton
                    key={String(item.id)}
                    $active={isNavItemActive(item)}
                    type="button"
                    onClick={() =>
                      navigateToPath(item.path, item.open_in_new_tab)
                    }
                  >
                    {item.label}
                  </NavButton>
                ),
              )}
              {(data?.config.navbar.customLinks || []).map(link => (
                <NavButton
                  key={link.url}
                  type="button"
                  onClick={() => navigateToPath(link.url, link.external)}
                >
                  {link.text}
                </NavButton>
              ))}
            </NavRow>
            {data?.portal_layout.config.showThemeToggle && (
              <Button
                onClick={() =>
                  setTheme(visualMode === 'dark' ? 'light' : 'dark')
                }
              >
                {visualMode === 'dark' ? t('Light mode') : t('Dark mode')}
              </Button>
            )}
            {data?.config.navbar.loginButton.enabled !== false && (
              <Button
                type={data?.config.navbar.loginButton.type || 'primary'}
                onClick={() =>
                  navigateToPath(data?.config.navbar.loginButton.url)
                }
              >
                {data?.config.navbar.loginButton.text || t('Sign in')}
              </Button>
            )}
          </HeaderActions>
        </HeaderInner>
      </StickyHeader>

      <Main $maxWidth={pageMaxWidth}>
        {error && (
          <Alert
            style={{ marginBottom: 20 }}
            type="error"
            showIcon
            message={error}
            action={
              <Button size="small" onClick={() => reloadPortal(pageSlug)}>
                {t('Retry')}
              </Button>
            }
          />
        )}

        {loading && !data ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '96px 0',
            }}
          >
            <Spin size="large" />
          </div>
        ) : currentPage ? (
          selectedDashboard ? (
            renderSelectedDashboardView(selectedDashboard)
          ) : pageBlocks.length ? (
            <>
              <RenderBlockTree
                blocks={renderedRegions.header}
                charts={data?.available_charts || []}
                dashboards={data?.dashboards || []}
                page={currentPage}
                navigation={data?.navigation}
                highlights={data?.indicator_highlights || []}
                onNavigate={navigateToPath}
                onOpenDashboard={navigateToPublicDashboard}
              />
              <RenderBlockTree
                blocks={renderedRegions.hero}
                charts={data?.available_charts || []}
                dashboards={data?.dashboards || []}
                page={currentPage}
                navigation={data?.navigation}
                highlights={data?.indicator_highlights || []}
                onNavigate={navigateToPath}
                onOpenDashboard={navigateToPublicDashboard}
              />
              {renderedRegions.content.length ||
              renderedRegions.sidebar.length ? (
                <div
                  className="cms-template-content-shell"
                  style={
                    hasSidebar
                      ? {
                          display: 'grid',
                          gridTemplateColumns: `minmax(0, 1fr) ${sidebarWidth}`,
                          gap: contentShellGap,
                          alignItems: 'start',
                        }
                      : undefined
                  }
                >
                  <div>
                    <RenderBlockTree
                      blocks={renderedRegions.content}
                      charts={data?.available_charts || []}
                      dashboards={data?.dashboards || []}
                      page={currentPage}
                      navigation={data?.navigation}
                      highlights={data?.indicator_highlights || []}
                      onNavigate={navigateToPath}
                      onOpenDashboard={navigateToPublicDashboard}
                    />
                  </div>
                  {hasSidebar ? (
                    <aside>
                      <RenderBlockTree
                        blocks={renderedRegions.sidebar}
                        charts={data?.available_charts || []}
                        dashboards={data?.dashboards || []}
                        page={currentPage}
                        navigation={data?.navigation}
                        highlights={data?.indicator_highlights || []}
                        onNavigate={navigateToPath}
                        onOpenDashboard={navigateToPublicDashboard}
                      />
                    </aside>
                  ) : null}
                </div>
              ) : null}
              <RenderBlockTree
                blocks={renderedRegions.cta}
                charts={data?.available_charts || []}
                dashboards={data?.dashboards || []}
                page={currentPage}
                navigation={data?.navigation}
                highlights={data?.indicator_highlights || []}
                onNavigate={navigateToPath}
                onOpenDashboard={navigateToPublicDashboard}
              />
              <RenderBlockTree
                blocks={renderedRegions.footer}
                charts={data?.available_charts || []}
                dashboards={data?.dashboards || []}
                page={currentPage}
                navigation={data?.navigation}
                highlights={data?.indicator_highlights || []}
                onNavigate={navigateToPath}
                onOpenDashboard={navigateToPublicDashboard}
              />
            </>
          ) : (
            <SurfaceCard>
              <CardTitle>{currentPage.title}</CardTitle>
              <CardBody>
                {currentPage.description ||
                  t('This page does not have any visible blocks yet.')}
              </CardBody>
            </SurfaceCard>
          )
        ) : (
          <SurfaceCard>
            <Empty description={t('No public page is available.')} />
          </SurfaceCard>
        )}
      </Main>

      <Footer>
        <FooterInner $maxWidth={pageMaxWidth}>
          <div>{data?.config.footer.text || portalTitle}</div>
          <FooterLinks>
            {footerItems.map(item => (
              <FooterLink
                key={String(item.id)}
                href={item.path || '#'}
                onClick={event => {
                  event.preventDefault();
                  navigateToPath(item.path, item.open_in_new_tab);
                }}
              >
                {item.label}
              </FooterLink>
            ))}
          </FooterLinks>
        </FooterInner>
      </Footer>

      <Drawer
        title={t('Customize Page Layout')}
        placement="right"
        width={420}
        open={layoutDrawerOpen}
        onClose={() => setLayoutDrawerOpen(false)}
        extra={
          <Button type="primary" loading={savingLayout} onClick={saveLayout}>
            {t('Save')}
          </Button>
        }
      >
        <DrawerStack>
          <Alert
            type="info"
            showIcon
            message={t(
              'Drag or move sections to reorder your personal layout.',
            )}
          />
          {layoutSections.map((section, index) => (
            <EditorSectionCard
              key={section.id || section.section_key || index}
              $dragging={draggedSectionId === section.id}
              draggable={section.id !== undefined}
              onDragStart={() => setDraggedSectionId(section.id || null)}
              onDragEnd={() => setDraggedSectionId(null)}
              onDragOver={(event: DragEvent<HTMLDivElement>) =>
                event.preventDefault()
              }
              onDrop={() => {
                if (section.id) {
                  onSectionDrop(section.id);
                }
                setDraggedSectionId(null);
              }}
            >
              <EditorHeader>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {section.title || t('Untitled section')}
                  </div>
                  <SectionNote>{section.section_type}</SectionNote>
                </div>
                <EditorActions>
                  <Tooltip title={t('Move up')}>
                    <Button
                      size="small"
                      onClick={() =>
                        section.id && moveLayoutSection(section.id, -1)
                      }
                    >
                      ↑
                    </Button>
                  </Tooltip>
                  <Tooltip title={t('Move down')}>
                    <Button
                      size="small"
                      onClick={() =>
                        section.id && moveLayoutSection(section.id, 1)
                      }
                    >
                      ↓
                    </Button>
                  </Tooltip>
                  <Switch
                    checked={section.is_visible !== false}
                    onChange={checked =>
                      setLayoutSections(previous =>
                        previous.map(current =>
                          current.id === section.id
                            ? { ...current, is_visible: checked }
                            : current,
                        ),
                      )
                    }
                  />
                </EditorActions>
              </EditorHeader>
            </EditorSectionCard>
          ))}
        </DrawerStack>
      </Drawer>

      <Drawer
        title={t('Page Studio')}
        placement="right"
        width={560}
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        extra={
          <Space>
            <Button onClick={() => loadDraftPage(undefined, true)}>
              {t('New page')}
            </Button>
            <Button type="primary" loading={savingPage} onClick={saveDraftPage}>
              {t('Save page')}
            </Button>
          </Space>
        }
      >
        <DrawerStack>
          <Alert
            type="info"
            showIcon
            message={t(
              'Only public charts backed by serving tables are available here.',
            )}
          />

          <div>
            <FieldLabel>{t('Load Existing Page')}</FieldLabel>
            <Select
              style={{ width: '100%' }}
              value={draftPage?.slug}
              allowClear
              placeholder={t('Select a page')}
              onChange={value => loadDraftPage(value)}
              options={(data?.pages || []).map(page => ({
                label: page.title,
                value: page.slug,
              }))}
            />
          </div>

          {studioLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '48px 0',
              }}
            >
              <Spin />
            </div>
          ) : draftPage ? (
            <>
              <FieldRow>
                <div>
                  <FieldLabel>{t('Title')}</FieldLabel>
                  <Input
                    value={draftPage.title}
                    onChange={event =>
                      updateDraftPage({ title: event.target.value })
                    }
                  />
                </div>
                <div>
                  <FieldLabel>{t('Slug')}</FieldLabel>
                  <Input
                    value={draftPage.slug || ''}
                    onChange={event =>
                      updateDraftPage({ slug: event.target.value })
                    }
                  />
                </div>
              </FieldRow>

              <FieldRow>
                <div>
                  <FieldLabel>{t('Subtitle')}</FieldLabel>
                  <Input
                    value={draftPage.subtitle || ''}
                    onChange={event =>
                      updateDraftPage({ subtitle: event.target.value })
                    }
                  />
                </div>
                <div>
                  <FieldLabel>{t('Display Order')}</FieldLabel>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={draftPage.display_order}
                    onChange={value =>
                      updateDraftPage({ display_order: Number(value) || 0 })
                    }
                  />
                </div>
              </FieldRow>

              <div>
                <FieldLabel>{t('Description')}</FieldLabel>
                <Input.TextArea
                  rows={4}
                  value={draftPage.description || ''}
                  onChange={event =>
                    updateDraftPage({ description: event.target.value })
                  }
                />
              </div>

              <FieldRow>
                <div>
                  <FieldLabel>{t('Published')}</FieldLabel>
                  <Switch
                    checked={draftPage.is_published}
                    onChange={checked =>
                      updateDraftPage({ is_published: checked })
                    }
                  />
                </div>
                <div>
                  <FieldLabel>{t('Landing Page')}</FieldLabel>
                  <Switch
                    checked={draftPage.is_homepage}
                    onChange={checked =>
                      updateDraftPage({ is_homepage: checked })
                    }
                  />
                </div>
              </FieldRow>

              <EditorActions>
                <Button onClick={() => addSection('hero')}>
                  {t('Add hero')}
                </Button>
                <Button onClick={() => addSection('content')}>
                  {t('Add content')}
                </Button>
                <Button onClick={() => addSection('chart_grid')}>
                  {t('Add chart grid')}
                </Button>
                <Button onClick={() => addSection('dashboard_catalog')}>
                  {t('Add dashboard directory')}
                </Button>
              </EditorActions>

              {draftPage.sections.map((section, sectionIndex) => (
                <EditorSectionCard
                  key={`${section.section_key}-${sectionIndex}`}
                >
                  <EditorHeader>
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        {section.title || t('Untitled section')}
                      </div>
                      <SectionNote>{section.section_type}</SectionNote>
                    </div>
                    <EditorActions>
                      <Button
                        size="small"
                        onClick={() => moveDraftSection(sectionIndex, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="small"
                        onClick={() => moveDraftSection(sectionIndex, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        danger
                        size="small"
                        onClick={() => removeSection(sectionIndex)}
                      >
                        {t('Remove')}
                      </Button>
                    </EditorActions>
                  </EditorHeader>

                  <FieldRow>
                    <div>
                      <FieldLabel>{t('Section Title')}</FieldLabel>
                      <Input
                        value={section.title || ''}
                        onChange={event =>
                          updateSection(sectionIndex, {
                            title: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <FieldLabel>{t('Section Type')}</FieldLabel>
                      <Select
                        style={{ width: '100%' }}
                        value={section.section_type}
                        onChange={value =>
                          updateSection(sectionIndex, { section_type: value })
                        }
                        options={[
                          { label: t('Hero'), value: 'hero' },
                          { label: t('Content'), value: 'content' },
                          { label: t('Chart Grid'), value: 'chart_grid' },
                          { label: t('KPI Band'), value: 'kpi_band' },
                          {
                            label: t('Dashboard Catalog'),
                            value: 'dashboard_catalog',
                          },
                        ]}
                      />
                    </div>
                  </FieldRow>

                  <div style={{ marginTop: 12 }}>
                    <FieldLabel>{t('Section Subtitle')}</FieldLabel>
                    <Input
                      value={section.subtitle || ''}
                      onChange={event =>
                        updateSection(sectionIndex, {
                          subtitle: event.target.value,
                        })
                      }
                    />
                  </div>

                  <FieldRow style={{ marginTop: 12 }}>
                    <div>
                      <FieldLabel>{t('Visible')}</FieldLabel>
                      <Switch
                        checked={section.is_visible}
                        onChange={checked =>
                          updateSection(sectionIndex, { is_visible: checked })
                        }
                      />
                    </div>
                    <div>
                      <FieldLabel>{t('Columns')}</FieldLabel>
                      <InputNumber
                        style={{ width: '100%' }}
                        value={Number(section.settings?.columns) || 1}
                        onChange={value =>
                          updateSectionSetting(
                            sectionIndex,
                            'columns',
                            Number(value) || 1,
                          )
                        }
                      />
                    </div>
                  </FieldRow>

                  <EditorActions style={{ marginTop: 12 }}>
                    <Button
                      size="small"
                      onClick={() => addComponent(sectionIndex, 'markdown')}
                    >
                      {t('Add markdown')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => addComponent(sectionIndex, 'chart')}
                    >
                      {t('Add chart')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        addComponent(sectionIndex, 'indicator_highlights')
                      }
                    >
                      {t('Add highlights')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => addComponent(sectionIndex, 'dashboard')}
                    >
                      {t('Add dashboard')}
                    </Button>
                  </EditorActions>

                  {section.components.map((component, componentIndex) => (
                    <div key={`${component.component_key}-${componentIndex}`}>
                      <ComponentDivider />
                      <FieldRow>
                        <div>
                          <FieldLabel>{t('Component Type')}</FieldLabel>
                          <Select
                            style={{ width: '100%' }}
                            value={component.component_type}
                            onChange={value =>
                              updateComponent(
                                sectionIndex,
                                componentIndex,
                                createEmptyComponent(value),
                              )
                            }
                            options={[
                              { label: t('Markdown'), value: 'markdown' },
                              { label: t('Chart'), value: 'chart' },
                              {
                                label: t('Indicator Highlights'),
                                value: 'indicator_highlights',
                              },
                              {
                                label: t('Dashboard List'),
                                value: 'dashboard_list',
                              },
                              {
                                label: t('Dashboard Embed'),
                                value: 'dashboard',
                              },
                            ]}
                          />
                        </div>
                        <div>
                          <FieldLabel>{t('Title')}</FieldLabel>
                          <Input
                            value={component.title || ''}
                            onChange={event =>
                              updateComponent(sectionIndex, componentIndex, {
                                title: event.target.value,
                              })
                            }
                          />
                        </div>
                      </FieldRow>

                      <div style={{ marginTop: 12 }}>
                        <FieldLabel>{t('Body')}</FieldLabel>
                        <Input.TextArea
                          rows={component.component_type === 'markdown' ? 4 : 2}
                          value={component.body || ''}
                          onChange={event =>
                            updateComponent(sectionIndex, componentIndex, {
                              body: event.target.value,
                            })
                          }
                        />
                      </div>

                      {component.component_type === 'chart' && (
                        <div style={{ marginTop: 12 }}>
                          <FieldLabel>{t('Chart')}</FieldLabel>
                          <Select
                            style={{ width: '100%' }}
                            value={component.chart_id || undefined}
                            showSearch
                            optionFilterProp="label"
                            onChange={value =>
                              updateComponent(sectionIndex, componentIndex, {
                                chart_id: value,
                                chart:
                                  data?.available_charts.find(
                                    chart => chart.id === value,
                                  ) || null,
                              })
                            }
                            options={(data?.available_charts || []).map(
                              chart => ({
                                label: `${chart.slice_name} (${chart.viz_type || t('Chart')})`,
                                value: chart.id,
                              }),
                            )}
                          />
                        </div>
                      )}

                      {component.component_type === 'dashboard' && (
                        <div style={{ marginTop: 12 }}>
                          <FieldLabel>{t('Dashboard')}</FieldLabel>
                          <Select
                            style={{ width: '100%' }}
                            value={component.dashboard_id || undefined}
                            onChange={value =>
                              updateComponent(sectionIndex, componentIndex, {
                                dashboard_id: value,
                                dashboard:
                                  data?.dashboards.find(
                                    dashboard => dashboard.id === value,
                                  ) || null,
                              })
                            }
                            options={(data?.dashboards || []).map(
                              dashboard => ({
                                label: dashboard.dashboard_title,
                                value: dashboard.id,
                              }),
                            )}
                          />
                        </div>
                      )}

                      {(component.component_type === 'chart' ||
                        component.component_type === 'dashboard') && (
                        <div style={{ marginTop: 12 }}>
                          <FieldLabel>{t('Embed Height')}</FieldLabel>
                          <InputNumber
                            style={{ width: '100%' }}
                            value={Number(component.settings?.height) || 360}
                            onChange={value =>
                              updateComponentSetting(
                                sectionIndex,
                                componentIndex,
                                'height',
                                Number(value) || 360,
                              )
                            }
                          />
                        </div>
                      )}

                      {component.component_type === 'indicator_highlights' && (
                        <div style={{ marginTop: 12 }}>
                          <FieldLabel>{t('Highlight Limit')}</FieldLabel>
                          <InputNumber
                            style={{ width: '100%' }}
                            value={Number(component.settings?.limit) || 6}
                            onChange={value =>
                              updateComponentSetting(
                                sectionIndex,
                                componentIndex,
                                'limit',
                                Number(value) || 6,
                              )
                            }
                          />
                        </div>
                      )}

                      <div style={{ marginTop: 12 }}>
                        <FieldLabel>{t('Visible')}</FieldLabel>
                        <Switch
                          checked={component.is_visible}
                          onChange={checked =>
                            updateComponent(sectionIndex, componentIndex, {
                              is_visible: checked,
                            })
                          }
                        />
                      </div>

                      <Button
                        danger
                        size="small"
                        style={{ marginTop: 12 }}
                        onClick={() =>
                          removeComponent(sectionIndex, componentIndex)
                        }
                      >
                        {t('Remove component')}
                      </Button>
                    </div>
                  ))}
                </EditorSectionCard>
              ))}
            </>
          ) : (
            <Empty description={t('Choose a page or create a new one.')} />
          )}
        </DrawerStack>
      </Drawer>
    </PageShell>
  );
}
