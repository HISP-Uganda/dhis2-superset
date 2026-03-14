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
      background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
      border-bottom: 1px solid ${theme.colorBorderSecondary};
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
        /* must be exactly the height of the Antd navbar */
        min-height: 50px;
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
        padding-left: ${theme.sizeUnit * 6}px;
        padding-right: ${theme.sizeUnit * 8}px;
        margin-right: ${theme.sizeUnit * 4}px;
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 0.3px;
        float: left;
        display: flex;
        flex-direction: column;
        justify-content: center;

        span {
          white-space: nowrap;
        }
        @media (max-width: 1127px) {
          font-size: 16px;
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
          color: rgba(255, 255, 255, 0.95);
          font-weight: 500;

          a {
            color: rgba(255, 255, 255, 0.95);
          }

          &:hover {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.1);

            a {
              color: #ffffff;
            }
          }

          &.ant-menu-item-selected {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.15);

            a {
              color: #ffffff;
            }
          }
        }

        .ant-menu-submenu {
          padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 4}px;
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
      if (window.innerWidth <= 767) {
        setMenu('inline');
      } else setMenu('horizontal');
    }
    handleResize();
    const windowResize = debounce(() => handleResize(), 10);
    window.addEventListener('resize', windowResize);
    return () => window.removeEventListener('resize', windowResize);
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
      case path.startsWith(Paths.DHIS2) || path.startsWith(Paths.SqlLab):
        setActiveTabs(['Data']);
        break;
      case path.startsWith(Paths.Datasets):
        setActiveTabs(['Datasets']);
        break;
      default:
        setActiveTabs(defaultTabSelection);
    }
  }, [location.pathname]);

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
                <Typography.Link href={child.url}>{child.label}</Typography.Link>
              ),
            };
          }
          return null;
        })
        .filter(
          (item): item is NonNullable<typeof item> => item !== null,
        ),
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
  const dataWorkspaceChildren: MenuObjectChildProps[] = [
    {
      name: 'DHIS2',
      label: 'DHIS2',
      url: '/superset/dhis2/instances/',
    },
    {
      name: 'Data Workspace',
      label: 'Data Workspace',
      url: '/superset/dhis2/local-data/',
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
      name: 'SQL',
      label: 'SQL',
      url: '/sqllab/',
    },
  ];

  const newMenuData = {
    ...data,
    brand: {
      ...data.brand,
      text: 'Uganda Malaria Data Repository',
    },
  };

  // Menu items that should go into settings dropdown
  const settingsMenus = {
    Security: true,
    Manage: true,
  };

  const isDataMenu = (item: MenuObjectProps) =>
    item.name === 'Data' || item.label === 'Data';

  const isSqlMenu = (item: MenuObjectProps) =>
    item.url?.startsWith('/sqllab') ||
    item.name === 'SQL' ||
    item.label === 'SQL' ||
    item.name === 'SQL Lab' ||
    item.label === 'SQL Lab';

  const isDHIS2Menu = (item: MenuObjectProps) =>
    item.url?.startsWith('/superset/dhis2/') ||
    item.name === 'DHIS2' ||
    item.label === 'DHIS2' ||
    item.name === 'DHIS2 Federation' ||
    item.label === 'DHIS2 Federation' ||
    item.childs?.some(
      child =>
        typeof child !== 'string' &&
        child.url?.startsWith('/superset/dhis2/'),
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

  const toDataChild = (item: MenuObjectChildProps): MenuObjectChildProps => ({
    ...item,
    name:
      item.name === 'SQL Lab' || item.label === 'SQL Lab'
        ? 'SQL'
        : item.name,
    label:
      item.label === 'SQL Lab'
        ? 'SQL'
        : item.label,
  });

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
          name: 'DHIS2',
          label: 'DHIS2',
          url: newItem.url,
        });
      }
      if (newItem.childs) {
        newItem.childs.forEach((child: MenuObjectChildProps | string) => {
          if (
            typeof child !== 'string' &&
            child.url?.startsWith('/superset/dhis2/')
          ) {
            movedDataChildren.push(child);
          }
        });
      }
      return;
    }

    const normalizedItem =
      isDataMenu(item)
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

  settings.forEach(item => {
    if (!isDHIS2Menu(item)) {
      return;
    }

    if (item.url) {
      movedDataChildren.push({
        name: 'DHIS2',
        label: 'DHIS2',
        url: item.url,
      });
    }
    item.childs?.forEach(child => {
      if (
        typeof child !== 'string' &&
        child.url?.startsWith('/superset/dhis2/')
      ) {
        movedDataChildren.push(child);
      }
    });
  });

  const filteredSettings = settings.filter(item => !isDHIS2Menu(item));
  const existingDataMenu = cleanedMenu.find(isDataMenu);
  const cleanedMenuWithoutData = cleanedMenu.filter(item => !isDataMenu(item));

  const normalizedDataMenu = existingDataMenu || {
    name: 'Data',
    label: 'Data',
    childs: [],
  };
  normalizedDataMenu.childs = dedupeChildren([
    ...dataWorkspaceChildren,
    '-',
    ...movedDataChildren.map(toDataChild),
    ...(normalizedDataMenu.childs || []),
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

  newMenuData.menu = cleanedMenuWithoutData;
  newMenuData.settings = filteredSettings;

  return <Menu data={newMenuData} {...rest} />;
}
