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
import { useState, useEffect, useCallback, FC, PureComponent, useMemo } from 'react';
import rison from 'rison';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { useQueryParams, BooleanParam } from 'use-query-params';
import { isEmpty } from 'lodash';
import {
  t,
  styled,
  css,
  SupersetTheme,
  SupersetClient,
  getExtensionsRegistry,
  useTheme,
} from '@superset-ui/core';
import {
  Tag,
  Tooltip,
  Menu,
  Icons,
  Typography,
  TelemetryPixel,
} from '@superset-ui/core/components';
import type { ItemType, MenuItem } from '@superset-ui/core/components/Menu';
import { ensureAppRoot } from 'src/utils/pathUtils';
import { findPermission } from 'src/utils/findPermission';
import { isUserAdmin } from 'src/dashboard/util/permissionUtils';
import {
  MenuObjectProps,
  UserWithPermissionsAndRoles,
  MenuObjectChildProps,
} from 'src/types/bootstrapTypes';
import { RootState } from 'src/dashboard/types';
import DatabaseModal from 'src/features/databases/DatabaseModal';
import UploadDataModal from 'src/features/databases/UploadDataModel';
import { uploadUserPerms } from 'src/views/CRUD/utils';
import { useThemeContext } from 'src/theme/ThemeProvider';
import { useThemeMenuItems } from 'src/hooks/useThemeMenuItems';
import type { ThemePreset } from 'src/theme/presets';
import { useLanguageMenuItems } from './LanguagePicker';
import {
  ExtensionConfigs,
  GlobalMenuDataOptions,
  RightMenuProps,
} from './types';

const extensionsRegistry = getExtensionsRegistry();

const StyledDiv = styled.div<{ align: string }>`
  display: flex;
  height: 100%;
  flex-direction: row;
  justify-content: ${({ align }) => align};
  align-items: center;
  margin-right: ${({ theme }) => theme.sizeUnit}px;
`;

const StyledMenuItemWithIcon = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const StyledAnchor = styled.a`
  padding-right: ${({ theme }) => theme.sizeUnit}px;
  padding-left: ${({ theme }) => theme.sizeUnit}px;
  color: ${({ theme }) => theme.colorTextLightSolid};

  &:hover,
  &:focus {
    color: ${({ theme }) => theme.colorTextLightSolid};
  }
`;

const StyledMenuItem = styled.div<{ disabled?: boolean }>`
  ${({ theme, disabled }) => css`
    &&:hover {
      color: ${!disabled && theme.colorPrimary};
      cursor: ${!disabled ? 'pointer' : 'not-allowed'};
    }
    ${disabled &&
    css`
      color: ${theme.colorTextDisabled};
    `}
  `}
`;

const RightMenu = ({
  align,
  settings,
  navbarRight,
  isFrontendRoute,
  environmentTag,
  setQuery,
}: RightMenuProps & {
  setQuery: ({
    databaseAdded,
    datasetAdded,
  }: {
    databaseAdded?: boolean;
    datasetAdded?: boolean;
  }) => void;
}) => {
  const theme = useTheme();
  const user = useSelector<any, UserWithPermissionsAndRoles>(
    state => state.user,
  );
  const dashboardId = useSelector<RootState, number | undefined>(
    state => state.dashboardInfo?.id,
  );
  const userValues = user || {};
  const { roles } = userValues;
  const {
    CSV_EXTENSIONS,
    COLUMNAR_EXTENSIONS,
    EXCEL_EXTENSIONS,
    ALLOWED_EXTENSIONS,
    HAS_GSHEETS_INSTALLED,
  } = useSelector<any, ExtensionConfigs>(state => state.common.conf);
  const [showDatabaseModal, setShowDatabaseModal] = useState<boolean>(false);
  const [showCSVUploadModal, setShowCSVUploadModal] = useState<boolean>(false);
  const [showExcelUploadModal, setShowExcelUploadModal] =
    useState<boolean>(false);
  const [showColumnarUploadModal, setShowColumnarUploadModal] =
    useState<boolean>(false);
  const [engine, setEngine] = useState<string>('');

  /* ── Public dashboards for anonymous select ──────── */
  const [publicDashboards, setPublicDashboards] = useState<
    { id: number; dashboard_title: string; slug: string | null; url: string }[]
  >([]);
  useEffect(() => {
    if (!navbarRight.user_is_anonymous) return;
    SupersetClient.get({ endpoint: '/api/v1/dashboard/public/' })
      .then(({ json }: any) => {
        setPublicDashboards(
          (json?.result || []).map((d: any) => ({
            id: d.id,
            dashboard_title: d.dashboard_title,
            slug: d.slug,
            url: d.url || `/superset/dashboard/${d.slug || d.id}/`,
          })),
        );
      })
      .catch(() => {});
  }, [navbarRight.user_is_anonymous]);

  const canSql = findPermission('can_sqllab', 'Superset', roles);
  const canDashboard = findPermission('can_write', 'Dashboard', roles);
  const canChart = findPermission('can_write', 'Chart', roles);
  const canDatabase = findPermission('can_write', 'Database', roles);
  const canDataset = findPermission('can_write', 'Dataset', roles);

  const { canUploadData, canUploadCSV, canUploadColumnar, canUploadExcel } =
    uploadUserPerms(
      roles,
      CSV_EXTENSIONS,
      COLUMNAR_EXTENSIONS,
      EXCEL_EXTENSIONS,
      ALLOWED_EXTENSIONS,
    );

  const showActionDropdown = canSql || canChart || canDashboard;
  const [allowUploads, setAllowUploads] = useState<boolean>(false);
  const [nonExamplesDBConnected, setNonExamplesDBConnected] =
    useState<boolean>(false);
  const isAdmin = isUserAdmin(user);
  const showUploads = allowUploads || isAdmin;
  const {
    setThemeMode,
    themeMode,
    setTemporaryTheme,
    clearLocalOverrides,
    hasDevOverride,
    canDetectOSPreference,
  } = useThemeContext();
  const dropdownItems: MenuObjectProps[] = [
    {
      label: t('Data'),
      icon: <Icons.DatabaseOutlined data-test={`menu-item-${t('Data')}`} />,
      childs: [
        {
          label: t('Connect database'),
          name: GlobalMenuDataOptions.DbConnection,
          perm: canDatabase && !nonExamplesDBConnected,
        },
        {
          label: t('Create dataset'),
          name: GlobalMenuDataOptions.DatasetCreation,
          url: '/dataset/add/',
          perm: canDataset && nonExamplesDBConnected,
        },
        {
          label: t('Connect Google Sheet'),
          name: GlobalMenuDataOptions.GoogleSheets,
          perm: canDatabase && HAS_GSHEETS_INSTALLED,
        },
        {
          label: t('Upload CSV to database'),
          name: GlobalMenuDataOptions.CSVUpload,
          perm: canUploadCSV && showUploads,
          disable: isAdmin && !allowUploads,
        },
        {
          label: t('Upload Excel to database'),
          name: GlobalMenuDataOptions.ExcelUpload,
          perm: canUploadExcel && showUploads,
          disable: isAdmin && !allowUploads,
        },
        {
          label: t('Upload Columnar file to database'),
          name: GlobalMenuDataOptions.ColumnarUpload,
          perm: canUploadColumnar && showUploads,
          disable: isAdmin && !allowUploads,
        },
      ],
    },
    {
      label: t('SQL query'),
      url: '/sqllab?new=true',
      icon: <Icons.SearchOutlined data-test={`menu-item-${t('SQL query')}`} />,
      perm: 'can_sqllab',
      view: 'Superset',
    },
    {
      label: t('Chart'),
      url: Number.isInteger(dashboardId)
        ? `/chart/add?dashboard_id=${dashboardId}`
        : '/chart/add',
      icon: <Icons.BarChartOutlined data-test={`menu-item-${t('Chart')}`} />,
      perm: 'can_write',
      view: 'Chart',
    },
    {
      label: t('Dashboard'),
      url: '/dashboard/new',
      icon: (
        <Icons.DashboardOutlined data-test={`menu-item-${t('Dashboard')}`} />
      ),
      perm: 'can_write',
      view: 'Dashboard',
    },
  ];

  const checkAllowUploads = () => {
    const payload = {
      filters: [
        { col: 'allow_file_upload', opr: 'upload_is_enabled', value: true },
      ],
    };
    SupersetClient.get({
      endpoint: `/api/v1/database/?q=${rison.encode(payload)}`,
    }).then(({ json }: Record<string, any>) => {
      // There might be some existing Gsheets and Clickhouse DBs
      // with allow_file_upload set as True which is not possible from now on
      const allowedDatabasesWithFileUpload =
        json?.result?.filter(
          (database: any) => database?.engine_information?.supports_file_upload,
        ) || [];
      setAllowUploads(allowedDatabasesWithFileUpload?.length >= 1);
    });
  };

  const existsNonExamplesDatabases = () => {
    const payload = {
      filters: [{ col: 'database_name', opr: 'neq', value: 'examples' }],
    };
    SupersetClient.get({
      endpoint: `/api/v1/database/?q=${rison.encode(payload)}`,
    }).then(({ json }: Record<string, any>) => {
      setNonExamplesDBConnected(json.count >= 1);
    });
  };

  useEffect(() => {
    if (canUploadData) {
      checkAllowUploads();
    }
  }, [canUploadData]);

  useEffect(() => {
    if (canDatabase || canDataset) {
      existsNonExamplesDatabases();
    }
  }, [canDatabase, canDataset]);

  const handleMenuSelection = (itemChose: any) => {
    if (itemChose.key === GlobalMenuDataOptions.DbConnection) {
      setShowDatabaseModal(true);
    } else if (itemChose.key === GlobalMenuDataOptions.GoogleSheets) {
      setShowDatabaseModal(true);
      setEngine('Google Sheets');
    } else if (itemChose.key === GlobalMenuDataOptions.CSVUpload) {
      setShowCSVUploadModal(true);
    } else if (itemChose.key === GlobalMenuDataOptions.ExcelUpload) {
      setShowExcelUploadModal(true);
    } else if (itemChose.key === GlobalMenuDataOptions.ColumnarUpload) {
      setShowColumnarUploadModal(true);
    }
  };

  const handleOnHideModal = () => {
    setEngine('');
    setShowDatabaseModal(false);
  };

  const tooltipText = t(
    "Enable 'Allow file uploads to database' in any database's settings",
  );

  const buildMenuItem = (item: MenuObjectChildProps): MenuItem => ({
    key: item.name || item.label,
    label: item.disable ? (
      <StyledMenuItem disabled>
        <Tooltip placement="top" title={tooltipText}>
          {item.label}
        </Tooltip>
      </StyledMenuItem>
    ) : item.url ? (
      <Typography.Link href={ensureAppRoot(item.url)}>
        {item.label}
      </Typography.Link>
    ) : (
      item.label
    ),
    disabled: item.disable,
  });

  const onMenuOpen = (openKeys: string[]) => {
    // We should query the API only if opening Data submenus
    // because the rest don't need this information. Not using
    // "Data" directly since we might change the label later on?
    if (
      openKeys.length > 1 &&
      !isEmpty(
        openKeys?.filter((key: string) =>
          key.includes(`sub2_${dropdownItems?.[0]?.label}`),
        ),
      )
    ) {
      if (canUploadData) checkAllowUploads();
      if (canDatabase || canDataset) existsNonExamplesDatabases();
    }
    return null;
  };
  const RightMenuExtension = extensionsRegistry.get('navbar.right');
  const RightMenuItemIconExtension = extensionsRegistry.get(
    'navbar.right-menu.item.icon',
  );

  const handleDatabaseAdd = () => setQuery({ databaseAdded: true });

  const handleLogout = () => {
    localStorage.removeItem('redux');
  };

  // Apply a pro theme preset via the theme controller
  const handleApplyPreset = useCallback(
    (preset: ThemePreset) => {
      const config: Record<string, any> = {
        token: { ...preset.tokens },
      };
      if (preset.isDark) {
        config.algorithm = 'dark';
      }
      setTemporaryTheme(config);

      // Apply CSS variable overrides to document root
      const root = document.documentElement;
      Object.entries(preset.cssVars).forEach(([key, value]) => {
        root.style.setProperty(key, value);
      });

      // Apply chart palette as CSS variable for downstream consumers
      root.style.setProperty(
        '--pro-chart-palette',
        preset.chartPalette.join(','),
      );

      // Persist which preset ID was applied (for checkmark in menu)
      try {
        localStorage.setItem('superset-applied-preset-id', preset.id);
      } catch {
        // ignore
      }

      // Sync preset colors to the default public page theme so public
      // dashboards and dynamic pages inherit the selected colour scheme.
      SupersetClient.post({
        endpoint: '/api/v1/public-page/admin/themes/sync-preset',
        jsonPayload: {
          preset_id: preset.id,
          css_vars: preset.cssVars,
          tokens: preset.tokens,
          is_dark: preset.isDark || false,
        },
      }).catch(() => {
        // Non-critical — admin preset still applied locally
      });
    },
    [setTemporaryTheme],
  );

  const appliedPresetId = useMemo(() => {
    if (!hasDevOverride()) return null;
    try {
      return localStorage.getItem('superset-applied-preset-id');
    } catch {
      return null;
    }
  }, [hasDevOverride]);

  // Use the theme menu hook
  const themeMenuItem = useThemeMenuItems({
    setThemeMode,
    themeMode,
    hasLocalOverride: hasDevOverride(),
    onClearLocalSettings: clearLocalOverrides,
    allowOSPreference: canDetectOSPreference(),
    onApplyPreset: handleApplyPreset,
    appliedPresetId,
  });

  const languageMenuItem = useLanguageMenuItems({
    locale: navbarRight.locale || 'en',
    languages: navbarRight.languages || {},
  });

  // Build main menu items
  const menuItems = useMemo(() => {
    // Build menu items for the new dropdown
    const buildNewDropdownItems = (): MenuItem[] => {
      const items: MenuItem[] = [];

      dropdownItems?.forEach(menu => {
        const canShowChild = menu.childs?.some(
          item => typeof item === 'object' && !!item.perm,
        );

        if (menu.childs) {
          if (canShowChild) {
            const childItems: MenuItem[] = [];
            menu.childs.forEach((item, idx) => {
              if (typeof item !== 'string' && item.name && item.perm) {
                if (idx === 3) {
                  childItems.push({ type: 'divider', key: `divider-${idx}` });
                }
                childItems.push(buildMenuItem(item));
              }
            });

            items.push({
              key: `sub2_${menu.label}`,
              label: menu.label,
              icon: menu.icon,
              children: childItems,
            });
          } else if (menu.url) {
            if (
              findPermission(menu.perm as string, menu.view as string, roles)
            ) {
              items.push({
                key: menu.label,
                label: isFrontendRoute(menu.url) ? (
                  <Link to={menu.url || ''}>
                    {menu.icon} {menu.label}
                  </Link>
                ) : (
                  <Typography.Link href={ensureAppRoot(menu.url || '')}>
                    {menu.icon} {menu.label}
                  </Typography.Link>
                ),
              });
            }
          }
        } else if (
          findPermission(menu.perm as string, menu.view as string, roles)
        ) {
          items.push({
            key: menu.label,
            label: isFrontendRoute(menu.url) ? (
              <Link to={menu.url || ''}>
                {menu.icon} {menu.label}
              </Link>
            ) : (
              <Typography.Link href={ensureAppRoot(menu.url || '')}>
                {menu.icon} {menu.label}
              </Typography.Link>
            ),
          });
        }
      });

      return items;
    };

    // Build settings menu items
    const buildSettingsMenuItems = (): MenuItem[] => {
      const items: MenuItem[] = [];

      settings?.forEach((section, index) => {
        const sectionItems: MenuItem[] = [];

        section.childs?.forEach(child => {
          if (typeof child !== 'string') {
            const menuItemDisplay = RightMenuItemIconExtension ? (
              <StyledMenuItemWithIcon>
                {child.label}
                <RightMenuItemIconExtension menuChild={child} />
              </StyledMenuItemWithIcon>
            ) : (
              child.label
            );

            sectionItems.push({
              key: child.label,
              label: isFrontendRoute(child.url) ? (
                <Link to={child.url || ''}>{menuItemDisplay}</Link>
              ) : (
                <Typography.Link
                  href={child.url || ''}
                  css={css`
                    display: flex;
                    align-items: center;
                    line-height: ${theme.sizeUnit * 10}px;
                  `}
                >
                  {menuItemDisplay}
                </Typography.Link>
              ),
            });
          }
        });

        items.push({
          type: 'group',
          label: section.label,
          key: section.label,
          children: sectionItems,
        });

        if (index < settings.length - 1) {
          items.push({ type: 'divider', key: `divider_${index}` });
        }
      });

      if (!navbarRight.user_is_anonymous) {
        items.push({ type: 'divider', key: 'user-divider' });

        const userItems: MenuItem[] = [];
        if (navbarRight.user_info_url) {
          userItems.push({
            key: 'info',
            label: (
              <Typography.Link href={navbarRight.user_info_url}>
                {t('Info')}
              </Typography.Link>
            ),
          });
        }
        userItems.push({
          key: 'logout',
          label: (
            <Typography.Link href={navbarRight.user_logout_url}>
              {t('Logout')}
            </Typography.Link>
          ),
          onClick: handleLogout,
        });

        items.push({
          type: 'group',
          label: t('User'),
          key: 'user-section',
          children: userItems,
        });
      }

      if (navbarRight.version_string || navbarRight.version_sha) {
        items.push({ type: 'divider', key: 'version-info-divider' });

        const aboutItem: ItemType = {
          type: 'group',
          label: t('About'),
          key: 'about-section',
          children: [
            {
              key: 'about-info',
              style: { height: 'auto', minHeight: 'auto' },
              label: (
                <div
                  css={(theme: SupersetTheme) => css`
                    font-size: ${theme.fontSizeSM}px;
                    color: ${theme.colorTextSecondary || theme.colorText};
                    white-space: pre-wrap;
                    padding: ${theme.sizeUnit}px ${theme.sizeUnit * 2}px;
                  `}
                >
                  {[
                    navbarRight.show_watermark &&
                      t('Powered by Apache Superset'),
                    navbarRight.version_string &&
                      `${t('Version')}: ${navbarRight.version_string}`,
                    navbarRight.version_sha &&
                      `${t('SHA')}: ${navbarRight.version_sha}`,
                    navbarRight.build_number &&
                      `${t('Build')}: ${navbarRight.build_number}`,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                </div>
              ),
            },
          ],
        };
        items.push(aboutItem);
      }
      return items;
    };

    const items: MenuItem[] = [];

    if (RightMenuExtension) {
      items.push({
        key: 'extension',
        label: <RightMenuExtension />,
      });
    }

    if (!navbarRight.user_is_anonymous && showActionDropdown) {
      items.push({
        key: 'new-dropdown',
        label: <Icons.PlusOutlined data-test="new-dropdown-icon" />,
        className: 'submenu-with-caret',
        icon: <Icons.CaretDownOutlined iconSize="xs" />,
        children: buildNewDropdownItems(),
        ...{ 'data-test': 'new-dropdown' },
      });
    }

    // Always show theme menu — presets work regardless of dark mode availability
    items.push(themeMenuItem);

    if (navbarRight.show_language_picker && languageMenuItem) {
      items.push(languageMenuItem);
    }

    items.push({
      key: 'settings',
      label: t('Settings'),
      icon: <Icons.CaretDownOutlined iconSize="xs" />,
      children: buildSettingsMenuItems(),
      className: 'submenu-with-caret',
    });

    return items;
  }, [
    RightMenuExtension,
    navbarRight,
    showActionDropdown,
    theme.colorPrimary,
    themeMenuItem,
    languageMenuItem,
    dropdownItems,
    roles,
    settings,
    RightMenuItemIconExtension,
    buildMenuItem,
    handleLogout,
  ]);

  return (
    <StyledDiv align={align}>
      {canDatabase && (
        <DatabaseModal
          onHide={handleOnHideModal}
          show={showDatabaseModal}
          dbEngine={engine}
          onDatabaseAdd={handleDatabaseAdd}
        />
      )}
      {canUploadCSV && (
        <UploadDataModal
          onHide={() => setShowCSVUploadModal(false)}
          show={showCSVUploadModal}
          allowedExtensions={CSV_EXTENSIONS}
          type="csv"
        />
      )}
      {canUploadExcel && (
        <UploadDataModal
          onHide={() => setShowExcelUploadModal(false)}
          show={showExcelUploadModal}
          allowedExtensions={EXCEL_EXTENSIONS}
          type="excel"
        />
      )}
      {canUploadColumnar && (
        <UploadDataModal
          onHide={() => setShowColumnarUploadModal(false)}
          show={showColumnarUploadModal}
          allowedExtensions={COLUMNAR_EXTENSIONS}
          type="columnar"
        />
      )}
      {environmentTag?.text &&
        (() => {
          // Map color values to Ant Design semantic colors
          const validAntDesignColors = [
            'error',
            'warning',
            'success',
            'processing',
            'default',
          ];

          const tagColor = validAntDesignColors.includes(environmentTag.color)
            ? environmentTag.color
            : 'default';

          return (
            <Tag
              color={tagColor}
              css={css`
                border-radius: ${theme.sizeUnit * 125}px;
              `}
            >
              {environmentTag.text}
            </Tag>
          );
        })()}
      <Menu
        css={css`
          display: flex;
          flex-direction: row;
          align-items: center;
          background: transparent;
          border-bottom: none;
          color: ${theme.colorTextLightSolid};

          /* Remove the underline from menu items */
          .ant-menu-item:after,
          .ant-menu-submenu:after {
            content: none !important;
          }

          &&& > .ant-menu-item,
          &&& > .ant-menu-submenu,
          &&& > .ant-menu-overflow-item {
            color: ${theme.colorTextLightSolid};
          }

          &&& > .ant-menu-item .ant-menu-title-content,
          &&& > .ant-menu-submenu .ant-menu-title-content,
          &&& > .ant-menu-submenu .ant-menu-submenu-title,
          &&& .ant-typography,
          &&& a {
            color: ${theme.colorTextLightSolid};
          }

          &&& > .ant-menu-item:hover,
          &&& > .ant-menu-submenu:hover,
          &&& > .ant-menu-submenu.ant-menu-submenu-open,
          &&& > .ant-menu-item:hover .ant-menu-title-content,
          &&& > .ant-menu-submenu:hover .ant-menu-title-content,
          &&& > .ant-menu-submenu.ant-menu-submenu-open .ant-menu-title-content,
          &&& > .ant-menu-item:hover a,
          &&& > .ant-menu-submenu:hover a,
          &&& a:hover {
            color: ${theme.colorTextLightSolid};
          }

          &&& .ant-menu-item .anticon,
          &&& .ant-menu-submenu .anticon,
          &&& .ant-menu-item svg,
          &&& .ant-menu-submenu svg {
            color: ${theme.colorTextLightSolid};
          }

          .submenu-with-caret {
            padding: 0 ${theme.sizeUnit}px;
            .ant-menu-submenu-title {
              display: flex;
              gap: ${theme.sizeUnit * 2}px;
              flex-direction: row-reverse;
            }
            &.ant-menu-submenu::after {
              inset-inline: ${theme.sizeUnit}px;
            }
          }
        `}
        selectable={false}
        mode="horizontal"
        onClick={handleMenuSelection}
        onOpenChange={onMenuOpen}
        disabledOverflow
        items={menuItems}
      />
      {navbarRight.documentation_url && (
        <>
          <StyledAnchor
            href={navbarRight.documentation_url}
            target="_blank"
            rel="noreferrer"
            title={navbarRight.documentation_text || t('Documentation')}
          >
            {navbarRight.documentation_icon ? (
              <Icons.BookOutlined />
            ) : (
              <Icons.QuestionCircleOutlined />
            )}
          </StyledAnchor>
          <span>&nbsp;</span>
        </>
      )}
      {navbarRight.bug_report_url && (
        <>
          <StyledAnchor
            href={navbarRight.bug_report_url}
            target="_blank"
            rel="noreferrer"
            title={navbarRight.bug_report_text || t('Report a bug')}
          >
            {navbarRight.bug_report_icon ? (
              <i className={navbarRight.bug_report_icon} />
            ) : (
              <Icons.BugOutlined />
            )}
          </StyledAnchor>
          <span>&nbsp;</span>
        </>
      )}
      {navbarRight.user_is_anonymous && publicDashboards.length > 0 && (
        <div
          css={css`
            display: flex;
            align-items: center;
            gap: 8px;
            margin-right: 12px;
          `}
        >
          <span
            css={css`
              font-size: 13px;
              font-weight: 600;
              color: rgba(255, 255, 255, 0.8);
              white-space: nowrap;
            `}
          >
            {t('Select a Dashboard')}
          </span>
          <select
            aria-label={t('Public Dashboards')}
            onChange={e => {
              if (e.target.value) {
                window.location.href = e.target.value;
              }
            }}
            defaultValue=""
            css={css`
              height: 34px;
              min-width: 260px;
              max-width: 400px;
              padding: 0 28px 0 10px;
              font-size: 13px;
              font-weight: 500;
              color: rgba(255, 255, 255, 0.95);
              background: rgba(255, 255, 255, 0.12);
              border: 1px solid rgba(255, 255, 255, 0.25);
              border-radius: 0;
              cursor: pointer;
              appearance: none;
              background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' fill='none' stroke='rgba(255,255,255,0.8)' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
              background-repeat: no-repeat;
              background-position: right 8px center;

              &:hover {
                background-color: rgba(255, 255, 255, 0.18);
                border-color: rgba(255, 255, 255, 0.4);
              }
              &:focus {
                outline: none;
                border-color: var(--pro-accent, #4da3ff);
                box-shadow: 0 0 0 2px rgba(77, 163, 255, 0.25);
              }
              option {
                background: #1a3c5e;
                color: #ffffff;
              }
            `}
          >
            <option value="">{t('Search dashboards...')}</option>
            {publicDashboards.map(d => (
              <option key={d.id} value={d.url}>
                {d.dashboard_title}
              </option>
            ))}
          </select>
        </div>
      )}
      {navbarRight.user_is_anonymous && (
        <StyledAnchor href={navbarRight.user_login_url}>
          <Icons.LoginOutlined /> {t('Login')}
        </StyledAnchor>
      )}
      <TelemetryPixel
        version={navbarRight.version_string}
        sha={navbarRight.version_sha}
        build={navbarRight.build_number}
      />
    </StyledDiv>
  );
};

const RightMenuWithQueryWrapper: FC<RightMenuProps> = props => {
  const [, setQuery] = useQueryParams({
    databaseAdded: BooleanParam,
    datasetAdded: BooleanParam,
  });

  return <RightMenu setQuery={setQuery} {...props} />;
};

// Query param manipulation requires that, during the setup, the
// QueryParamProvider is present and configured.
// Superset still has multiple entry points, and not all of them have
// the same setup, and critically, not all of them have the QueryParamProvider.
// This wrapper ensures the RightMenu renders regardless of the provider being present.
class RightMenuErrorWrapper extends PureComponent<RightMenuProps> {
  state = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  noop = () => {};

  render() {
    if (this.state.hasError) {
      return <RightMenu setQuery={this.noop} {...this.props} />;
    }

    return this.props.children;
  }
}

const RightMenuWrapper: FC<RightMenuProps> = props => (
  <RightMenuErrorWrapper {...props}>
    <RightMenuWithQueryWrapper {...props} />
  </RightMenuErrorWrapper>
);

export default RightMenuWrapper;
