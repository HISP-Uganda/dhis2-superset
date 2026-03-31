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
import { useState, useEffect } from 'react';
import { styled } from '@superset-ui/core';
import { debounce } from 'lodash';
import { getUrlParam } from 'src/utils/urlUtils';
import {
  MainNav,
  MenuMode,
  type MenuItem,
} from '@superset-ui/core/components/Menu';
import { Tooltip, Grid, Row, Col } from '@superset-ui/core/components';
import { NavLink, useLocation } from 'react-router-dom';
import { Icons } from '@superset-ui/core/components/Icons';
import { Typography } from '@superset-ui/core/components/Typography';
import { useUiConfig } from 'src/components/UiConfigContext';
import { URL_PARAMS } from 'src/constants';
import getBootstrapData from 'src/utils/getBootstrapData';
import { userHasPermission } from 'src/dashboard/util/permissionUtils';
import {
  MenuObjectChildProps,
  MenuObjectProps,
  MenuData,
} from 'src/types/bootstrapTypes';
import RightMenu from './RightMenu';

interface MenuProps {
  data: MenuData;
  isFrontendRoute?: (path?: string) => boolean;
}

const StyledHeader = styled.header`
  ${({ theme }) => `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #0D3B66 0%, #164E8A 100%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      z-index: 1000;

      &:nth-last-of-type(2) nav {
        margin-bottom: 2px;
      }
      .caret {
        display: none;
      }
      & .ant-image{
        display: contents;
        height: 100%;
        padding: ${theme.sizeUnit}px
          ${theme.sizeUnit * 2}px
          ${theme.sizeUnit}px
          ${theme.sizeUnit * 4}px;
      }
      .navbar-brand {
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-height: 48px;
        padding: ${theme.sizeUnit}px
          ${theme.sizeUnit * 2}px
          ${theme.sizeUnit}px
          ${theme.sizeUnit * 4}px;
        max-width: ${theme.sizeUnit * theme.brandIconMaxWidth}px;
        img {
          height: 100%;
          object-fit: contain;
        }
        &:focus {
          border-color: transparent;
        }
        &:focus-visible {
          border-color: ${theme.colorPrimaryText};
        }
      }
      .navbar-brand-text {
        height: 100%;
        color: #ffffff;
        padding-left: ${theme.sizeUnit * 4}px;
        padding-right: ${theme.sizeUnit * 4}px;
        margin-right: ${theme.sizeUnit * 4}px;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: -0.3px;
        float: left;
        display: flex;
        flex-direction: column;
        justify-content: center;

        span {
          white-space: nowrap;
        }
        @media (max-width: 1127px) {
          font-size: 15px;
          padding-left: ${theme.sizeUnit * 3}px;
          padding-right: ${theme.sizeUnit * 3}px;
        }
      }
      @media (max-width: 767px) {
        .navbar-brand {
          float: none;
        }
      }
      .main-nav {
        background: transparent;
        border-bottom: none;

        .ant-menu-item {
          color: rgba(255, 255, 255, 0.92);
          font-weight: 500;
          font-size: 13px;

          a {
            color: rgba(255, 255, 255, 0.92);
          }

          &:hover {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.08);

            a {
              color: #ffffff;
            }
          }

          &.ant-menu-item-selected {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.06);
            border-bottom: 2px solid #4DA3FF;
            border-radius: 0;

            a {
              color: #ffffff;
            }
          }
        }

        .ant-menu-submenu {
          padding: ${theme.sizeUnit * 1.5}px ${theme.sizeUnit * 4}px;
          display: flex;
          align-items: center;
          height: 100%;
          margin: 0;

          .ant-menu-title-content {
            color: rgba(255, 255, 255, 0.95);
            font-weight: 500;
          }

          &:hover .ant-menu-title-content,
          &.ant-menu-submenu-active .ant-menu-title-content,
          &.ant-menu-submenu-open .ant-menu-title-content,
          &.ant-menu-submenu-selected .ant-menu-title-content {
            color: #ffffff;
          }

          .ant-menu-submenu-title {
            display: flex;
            flex-direction: row-reverse;

            &:after {
              content: '';
              position: absolute;
              bottom: -3px;
              left: 50%;
              width: 0;
              height: 3px;
              opacity: 0;
              transform: translateX(-50%);
              transition: all ${theme.motionDurationMid};
            }
          }

          &.ant-menu-submenu-open .ant-menu-submenu-title:after,
          &.ant-menu-submenu-active .ant-menu-submenu-title:after {
            opacity: 1;
            width: calc(100% - 1px);
          }

          [data-icon='caret-down'] {
            color: rgba(255, 255, 255, 0.8);
            font-size: ${theme.fontSizeXS}px;
            margin-left: ${theme.sizeUnit}px;
          }
        }
      }

      /* ── Right-side menu: ensure white text on dark navbar ── */
      .ant-menu-horizontal.ant-menu > .ant-menu-item,
      .ant-menu-horizontal.ant-menu > .ant-menu-submenu {
        color: rgba(255, 255, 255, 0.9);
      }

      /* User/settings icons and text in right menu */
      .ant-menu-item .anticon,
      .ant-menu-item svg,
      .ant-menu-submenu .anticon,
      .ant-menu-submenu svg {
        color: rgba(255, 255, 255, 0.85);
      }

      /* Any stray anchor tags (Settings link, etc.) */
      .ant-menu-item a,
      .ant-menu-submenu a,
      header a:not([class*="ant-btn"]) {
        color: rgba(255, 255, 255, 0.9) !important;
        &:hover { color: #ffffff !important; }
      }

      @media (max-width: 767px) {
        .ant-menu-item {
          padding: 0 ${theme.sizeUnit * 6}px 0
            ${theme.sizeUnit * 3}px !important;
        }
        .ant-menu > .ant-menu-item > span > a {
          padding: 0px;
        }
        .main-nav .ant-menu-submenu-title > svg:nth-of-type(1) {
          display: none;
        }
      }
  `}
`;
const { useBreakpoint } = Grid;

export function Menu({
  data: {
    menu,
    brand,
    navbar_right: navbarRight,
    settings,
    environment_tag: environmentTag,
  },
  isFrontendRoute = () => false,
}: MenuProps) {
  const [showMenu, setMenu] = useState<MenuMode>('horizontal');
  const screens = useBreakpoint();
  const uiConfig = useUiConfig();

  useEffect(() => {
    function handleResize() {
      const nextMenuMode = window.innerWidth <= 767 ? 'inline' : 'horizontal';
      setMenu(currentMenu =>
        currentMenu === nextMenuMode ? currentMenu : nextMenuMode,
      );
    }
    handleResize();
    const windowResize = debounce(() => handleResize(), 10);
    window.addEventListener('resize', windowResize);
    return () => {
      window.removeEventListener('resize', windowResize);
      windowResize.cancel();
    };
  }, []);

  enum Paths {
    Home = '/superset/welcome',
    Explore = '/explore',
    Dashboard = '/dashboard',
    Chart = '/chart',
    Datasets = '/tablemodelview',
    SqlLab = '/sqllab',
    DHIS2 = '/superset/dhis2',
  }

  const defaultTabSelection: string[] = [];
  const [activeTabs, setActiveTabs] = useState(defaultTabSelection);
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname;
    switch (true) {
      case path.startsWith(Paths.Home):
        setActiveTabs(['Home']);
        break;
      case path.startsWith(Paths.Dashboard):
        setActiveTabs(['Dashboards']);
        break;
      case path.startsWith(Paths.Chart) || path.startsWith(Paths.Explore):
        setActiveTabs(['Charts']);
        break;
      case path.startsWith(Paths.DHIS2) ||
        path.startsWith(Paths.SqlLab) ||
        path.startsWith('/superset/local-staging/'):
        setActiveTabs(['Data']);
        break;
      case path.startsWith(Paths.Datasets):
        setActiveTabs(['Datasets']);
        break;
      default:
        setActiveTabs(defaultTabSelection);
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const standalone = getUrlParam(URL_PARAMS.standalone);
  if (standalone || uiConfig.hideNav) return <></>;

  const renderMenuItem = ({
    label,
    childs,
    url,
    index,
    isFrontendRoute,
  }: MenuObjectProps): MenuItem => {
    if (url && isFrontendRoute) {
      return {
        key: label,
        label: (
          <NavLink role="button" to={url} activeClassName="is-active">
            {label}
          </NavLink>
        ),
      };
    }
    if (url) {
      return {
        key: label,
        label: <Typography.Link href={url}>{label}</Typography.Link>,
      };
    }
    return {
      key: String(index ?? label),
      label,
      icon:
        showMenu === 'inline' ? undefined : (
          <Icons.CaretDownOutlined iconSize="xs" />
        ),
      children: childs
        ?.map((child: MenuObjectChildProps | string, index1: number) => {
          if (typeof child === 'string' && child === '-') {
            return { type: 'divider' as const };
          }
          if (typeof child !== 'string') {
            return {
              key: `${label}-${child.label}-${index1}`,
              label: child.isFrontendRoute ? (
                <NavLink to={child.url || ''} exact activeClassName="is-active">
                  {child.label}
                </NavLink>
              ) : (
                <Typography.Link href={child.url}>
                  {child.label}
                </Typography.Link>
              ),
            };
          }
          return null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    };
  };
  const renderBrand = () =>
    // Hide logo - only show text title
    null;
  const mainNavItems = menu.map((item, index) => {
    const props = {
      index,
      ...item,
      isFrontendRoute: isFrontendRoute(item.url),
      childs: item.childs?.map(c => {
        if (typeof c === 'string') {
          return c;
        }

        return {
          ...c,
          isFrontendRoute: isFrontendRoute(c.url),
        };
      }),
    };

    return renderMenuItem(props);
  });
  return (
    <StyledHeader className="top" id="main-menu" role="navigation">
      <Row>
        <Col md={16} xs={24} style={{ display: 'flex' }}>
          <Tooltip
            id="brand-tooltip"
            placement="bottomLeft"
            title={brand.tooltip}
            arrow={{ pointAtCenter: true }}
          >
            {renderBrand()}
          </Tooltip>
          {brand.text && (
            <div className="navbar-brand-text">
              <span>{brand.text}</span>
            </div>
          )}
          <MainNav
            mode={showMenu}
            data-test="navbar-top"
            className="main-nav"
            selectedKeys={activeTabs}
            disabledOverflow
            items={mainNavItems}
          />
        </Col>
        <Col md={8} xs={24}>
          <RightMenu
            align={screens.md ? 'flex-end' : 'flex-start'}
            settings={settings}
            navbarRight={navbarRight}
            isFrontendRoute={isFrontendRoute}
            environmentTag={environmentTag}
          />
        </Col>
      </Row>
    </StyledHeader>
  );
}

// transform the menu data to reorganize components
export default function MenuWrapper({ data, ...rest }: MenuProps) {
  const sqlLabSeparator = '-' as const;
  const CMS_PAGES_MENU_LABEL = 'CMS Pages';
  const bootstrapData = getBootstrapData();
  const canViewCms = userHasPermission(
    bootstrapData.user || {},
    'CMS',
    'cms.pages.view',
  );

  const dataWorkspaceChildren: MenuObjectChildProps[] = [
    {
      name: 'DHIS2 Health',
      label: 'DHIS2 Health',
      url: '/superset/dhis2/health/',
    },
    {
      name: 'Staged Datasets',
      label: 'Staged Datasets',
      url: '/superset/dhis2/local-data/',
    },
    {
      name: 'Download Datasets',
      label: 'Download Datasets',
      url: '/superset/dhis2/downloads/',
    },
    {
      name: 'Local Metadata',
      label: 'Local Metadata',
      url: '/superset/dhis2/local-metadata/',
    },
    {
      name: 'Sync History',
      label: 'Sync History',
      url: '/superset/dhis2/sync-history/',
    },
    {
      name: 'DHIS2 Instances',
      label: 'DHIS2 Instances',
      url: '/superset/dhis2/instances/',
    },
    {
      name: 'Staging Engine',
      label: 'Staging Engine',
      url: '/superset/local-staging/',
    },
    // SQL Lab is appended after the separator (see normalizedDataMenu.childs below)
  ];

  const newMenuData = {
    ...data,
    brand: {
      ...data.brand,
      text: 'Uganda Malaria Data Repository',
    },
  };

  // Menu items that should go into settings dropdown (removed from main nav)
  const settingsMenus: Record<string, boolean> = {
    Security: true,
    Manage: true,
    Settings: true,
  };

  const isDataMenu = (item: MenuObjectProps) =>
    item.name === 'Data' || item.label === 'Data';
  const isCmsPagesMenu = (item: MenuObjectProps) =>
    item.name === CMS_PAGES_MENU_LABEL || item.label === CMS_PAGES_MENU_LABEL;

  const isSqlMenu = (item: MenuObjectProps) =>
    item.url?.startsWith('/sqllab') ||
    item.name === 'SQL' ||
    item.label === 'SQL' ||
    item.name === 'SQL Lab' ||
    item.label === 'SQL Lab';

  const normalizeDHIS2MenuUrl = (url?: string) => {
    if (!url) {
      return url;
    }

    if (url.includes('/dhis2admin/list/')) {
      return '/superset/dhis2/instances/';
    }
    if (url.includes('/dhis2admin/health/')) {
      return '/superset/dhis2/health/';
    }
    if (url.includes('/dhis2admin/sync-history/')) {
      return '/superset/dhis2/sync-history/';
    }
    if (url.includes('/dhis2admin/local-metadata/')) {
      return '/superset/dhis2/local-metadata/';
    }
    if (url.includes('/dhis2admin/local-data/')) {
      return '/superset/dhis2/local-data/';
    }
    if (url.includes('/dhis2admin/downloads/')) {
      return '/superset/dhis2/downloads/';
    }

    return url;
  };

  const normalizeDHIS2MenuLabel = (label?: string) => {
    switch (label) {
      case 'DHIS2 Local Data':
        return 'Staged Datasets';
      case 'DHIS2 Local Metadata':
        return 'Local Metadata';
      case 'DHIS2 Sync History':
        return 'Sync History';
      case 'DHIS2 Download Datasets':
        return 'Download Datasets';
      default:
        return label;
    }
  };

  const isDHIS2Url = (url?: string) =>
    Boolean(url) &&
    (url?.includes('/superset/dhis2/') ||
      url?.includes('/dhis2admin/') ||
      url?.includes('/superset/local-staging/'));

  const normalizeDHIS2Child = (
    child: MenuObjectChildProps,
  ): MenuObjectChildProps => ({
    ...child,
    label: normalizeDHIS2MenuLabel(child.label) || child.label,
    url: normalizeDHIS2MenuUrl(child.url),
  });

  const isDHIS2Menu = (item: MenuObjectProps) =>
    isDHIS2Url(item.url) ||
    item.name === 'DHIS2' ||
    item.label === 'DHIS2' ||
    item.name === 'DHIS2 Federation' ||
    item.label === 'DHIS2 Federation' ||
    item.name?.startsWith('DHIS2 ') ||
    item.label?.startsWith('DHIS2 ') ||
    item.childs?.some(
      child =>
        typeof child !== 'string' &&
        (isDHIS2Url(child.url) ||
          child.name?.startsWith('DHIS2 ') ||
          child.label?.startsWith('DHIS2 ')),
    );

  const dedupeChildren = (children: (MenuObjectChildProps | string)[]) =>
    children.filter((child, index, array) => {
      if (typeof child === 'string') {
        const previous = array[index - 1];
        const next = array[index + 1];
        if (child !== '-') {
          return true;
        }
        return previous !== '-' && next !== undefined;
      }

      return (
        array.findIndex(entry => {
          if (typeof entry === 'string') {
            return false;
          }
          return (
            entry.label === child.label &&
            (entry.url || '') === (child.url || '')
          );
        }) === index
      );
    });

  const cmsPagesMenu: MenuObjectProps | null =
    data.navbar_right.user_is_anonymous || !canViewCms
      ? null
      : {
          name: CMS_PAGES_MENU_LABEL,
          label: CMS_PAGES_MENU_LABEL,
          childs: [
            {
              name: 'CMS Dashboard',
              label: 'CMS Dashboard',
              url: '/superset/cms/',
            },
            {
              name: 'Page Studio',
              label: 'Page Studio',
              url: '/superset/cms/?tab=studio',
            },
            {
              name: 'Menu Manager',
              label: 'Menu Manager',
              url: '/superset/cms/?tab=menus',
            },
            {
              name: 'Portal Settings',
              label: 'Portal Settings',
              url: '/superset/cms/?tab=portal',
            },
            {
              name: 'Public Portal',
              label: 'Public Portal',
              url: '/superset/public/',
            },
          ],
        };

  const toDataChild = (item: MenuObjectChildProps): MenuObjectChildProps =>
    item;

  // Cycle through menu.menu to build out cleanedMenu and settings
  const cleanedMenu: MenuObjectProps[] = [];
  const settings: MenuObjectProps[] = [];
  const movedDataChildren: MenuObjectChildProps[] = [];
  newMenuData.menu.forEach((item: any) => {
    if (!item) {
      return;
    }

    const children: (MenuObjectProps | string)[] = [];
    const newItem = {
      ...item,
    };

    // Filter childs
    if (item.childs) {
      item.childs.forEach((child: MenuObjectChildProps | string) => {
        if (typeof child === 'string') {
          children.push(child);
        } else if ((child as MenuObjectChildProps).label) {
          children.push(child);
        }
      });

      newItem.childs = children;
    }

    if (isSqlMenu(newItem)) {
      movedDataChildren.push(
        toDataChild({
          name: newItem.name,
          label: newItem.label,
          url: newItem.url,
        }),
      );
      return;
    }

    if (isDHIS2Menu(newItem) && !isDataMenu(newItem)) {
      if (newItem.url) {
        movedDataChildren.push({
          name: newItem.name,
          label: normalizeDHIS2MenuLabel(newItem.label) || newItem.label,
          url: normalizeDHIS2MenuUrl(newItem.url),
        });
      }
      if (newItem.childs) {
        newItem.childs.forEach((child: MenuObjectChildProps | string) => {
          if (typeof child !== 'string' && isDHIS2Url(child.url)) {
            movedDataChildren.push(normalizeDHIS2Child(child));
          }
        });
      }
      return;
    }

    const normalizedItem = isDataMenu(item)
      ? {
          ...newItem,
          childs: dedupeChildren([
            ...dataWorkspaceChildren,
            '-',
            ...(newItem.childs || []),
          ]),
        }
      : newItem;

    if (!settingsMenus.hasOwnProperty(item.name)) {
      cleanedMenu.push(normalizedItem);
    } else {
      settings.push(normalizedItem);
    }
  });

  // URLs that belong in the Data menu rather than Settings
  const dataRelatedUrls = [
    '/databaseview',
    '/tablemodelview',
    '/rowlevelsecurity',
    '/dataset',
  ];
  const isDataRelatedChild = (child: MenuObjectChildProps) =>
    dataRelatedUrls.some(prefix => child.url?.startsWith(prefix));

  settings.forEach(item => {
    // Move DHIS2 children to Data
    if (isDHIS2Menu(item)) {
      if (item.url) {
        movedDataChildren.push({
          name: item.name,
          label: normalizeDHIS2MenuLabel(item.label) || item.label,
          url: normalizeDHIS2MenuUrl(item.url),
        });
      }
      item.childs?.forEach(child => {
        if (typeof child !== 'string' && isDHIS2Url(child.url)) {
          movedDataChildren.push(normalizeDHIS2Child(child));
        }
      });
    }

    // Move any data-related children (Databases, Datasets) from Settings → Data
    item.childs?.forEach(child => {
      if (typeof child !== 'string' && isDataRelatedChild(child)) {
        movedDataChildren.push(child);
      }
    });
  });

  const filteredSettings = settings
    .filter(item => !isDHIS2Menu(item))
    .map(item => ({
      ...item,
      // Strip data- and DHIS2-related children from settings dropdown.
      childs: item.childs?.filter(
        child =>
          typeof child === 'string' ||
          (!isDataRelatedChild(child as MenuObjectChildProps) &&
            !isDHIS2Menu(child as MenuObjectProps)),
      ),
    }))
    .filter(item => item.childs?.some(child => typeof child !== 'string'));
  const existingDataMenu = cleanedMenu.find(isDataMenu);
  const cleanedMenuWithoutData = cleanedMenu.filter(
    item => !isDataMenu(item) && !isCmsPagesMenu(item),
  );

  const normalizedDataMenu = existingDataMenu || {
    name: 'Data',
    label: 'Data',
    childs: [],
  };
  // SQL Lab entry hardcoded to the frontend SPA route so it renders as a
  // React Router NavLink rather than an <a href> full-page reload.  The server
  // may provide a different URL (e.g. /superset/sqllab/) that doesn't match the
  // SPA route and would navigate away from the React app.
  const sqlLabChild: MenuObjectChildProps = {
    name: 'SQL Lab',
    label: 'SQL Lab',
    url: '/sqllab/',
  };

  normalizedDataMenu.childs = dedupeChildren([
    ...dataWorkspaceChildren,
    '-',
    ...movedDataChildren.map(toDataChild),
    ...(normalizedDataMenu.childs || []),
    sqlLabSeparator,
    sqlLabChild,
  ]);

  const datasetsIndex = cleanedMenuWithoutData.findIndex(
    item => item.name === 'Datasets' || item.label === 'Datasets',
  );
  const sqlIndex = cleanedMenuWithoutData.findIndex(isSqlMenu);
  const sourcesIndex = cleanedMenuWithoutData.findIndex(
    item => item.name === 'Sources' || item.label === 'Sources',
  );

  const insertIndex =
    datasetsIndex >= 0
      ? datasetsIndex + 1
      : sqlIndex >= 0
        ? sqlIndex
        : sourcesIndex >= 0
          ? sourcesIndex + 1
          : cleanedMenuWithoutData.length;

  cleanedMenuWithoutData.splice(insertIndex, 0, normalizedDataMenu);
  if (cmsPagesMenu) {
    cleanedMenuWithoutData.splice(insertIndex + 1, 0, cmsPagesMenu);
  }

  newMenuData.menu = cleanedMenuWithoutData;
  newMenuData.settings = filteredSettings;

  return <Menu data={newMenuData} {...rest} />;
}
