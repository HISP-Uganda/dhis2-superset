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
import {
  ReactNode,
  useState,
  useEffect,
  useMemo,
  FunctionComponent,
} from 'react';

import { Link, useHistory } from 'react-router-dom';
import { styled, t } from '@superset-ui/core';
import cx from 'classnames';
import { debounce } from 'lodash';
import {
  Button,
  Dropdown,
  Tooltip,
  Row,
  type OnClickHandler,
} from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { IconType } from '@superset-ui/core/components/Icons/types';
import { MenuObjectProps } from 'src/types/bootstrapTypes';
import { Typography } from '@superset-ui/core/components/Typography';

/* eslint-disable-next-line theme-colors/no-literal-colors */
const StyledHeader = styled.div<{ backgroundColor?: string }>`
  background-color: ${({ backgroundColor, theme }) =>
    backgroundColor || theme.colorBgElevated};
  border-bottom: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  align-items: center;
  position: relative;
  padding: 0 ${({ theme }) => theme.sizeUnit * 5}px;
  margin-top: 0;
  margin-bottom: 0;
  .header {
    font-weight: ${({ theme }) => theme.fontWeightStrong};
    margin-right: ${({ theme }) => theme.sizeUnit * 3}px;
    text-align: left;
    font-size: 16px;
    color: ${({ theme }) => theme.colorTextHeading};
    display: inline-block;
    line-height: ${({ theme }) => theme.sizeUnit * 9}px;
  }
  .nav-right {
    display: flex;
    align-items: center;
    margin-right: ${({ theme }) => theme.sizeUnit * 2}px;
    float: right;
    position: absolute;
    right: 0;
    ul.ant-menu-root {
      padding: 0px;
    }
    .ant-row {
      align-items: center;
    }
    li[role='menuitem'] {
      border: 0;
      border-bottom: none;
      &:hover {
        border-bottom: transparent;
      }
    }
  }
  .nav-right-collapse {
    display: flex;
    align-items: center;
    padding: 14px 0;
    margin-right: 0;
    float: left;
    padding-left: 10px;
  }
  .menu {
    align-items: center;
  }

  .tab-list {
    display: flex;
    align-items: center;
    padding-left: ${({ theme }) => theme.sizeUnit * 5}px;
    line-height: ${({ theme }) => theme.sizeUnit * 5}px;
    min-width: 0;
  }

  .tab-list-inline {
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
    padding-top: ${({ theme }) => theme.sizeUnit * 2}px;
  }

  .tab-item {
    display: inline-flex;
    align-items: center;
    margin-right: ${({ theme }) => theme.sizeUnit}px;
  }

  .tab-list-inline .tab-item {
    margin-right: 0;
    width: 100%;
  }

  .tab-link {
    display: inline-flex;
    align-items: center;
    border-radius: 0;
    font-size: ${({ theme }) => theme.fontSizeSM}px;
    padding: ${({ theme }) => theme.sizeUnit * 2}px
      ${({ theme }) => theme.sizeUnit * 3}px;
    color: ${({ theme }) => theme.colorText};
    text-decoration: none;
    border-bottom: 2px solid transparent;
  }

  .tab-list-inline .tab-link {
    width: 100%;
  }

  .tab-link:hover,
  .tab-link.active {
    background-color: transparent;
    color: ${({ theme }) => theme.colorPrimary};
    border-bottom-color: ${({ theme }) => theme.colorPrimary};
  }

  .dropdown-trigger {
    display: inline-flex;
    align-items: center;
    gap: ${({ theme }) => theme.sizeUnit}px;
  }

  .btn-link {
    padding: 10px 0;
  }
  @media (max-width: 767px) {
    .header,
    .nav-right {
      position: relative;
      margin-left: ${({ theme }) => theme.sizeUnit * 2}px;
    }
  }
`;

type MenuChild = {
  label: string;
  name: string;
  url?: string;
  usesRouter?: boolean;
  onClick?: () => void;
  'data-test'?: string;
  id?: string;
  'aria-controls'?: string;
};

export interface ButtonProps {
  name: ReactNode;
  onClick?: OnClickHandler;
  'data-test'?: string;
  buttonStyle: 'primary' | 'secondary' | 'dashed' | 'link' | 'tertiary';
  loading?: boolean;
  icon?: IconType;
}

export interface SubMenuProps {
  buttons?: Array<ButtonProps>;
  name?: string | ReactNode;
  tabs?: MenuChild[];
  activeChild?: MenuChild['name'];
  /* If usesRouter is true, a react-router <Link> component will be used instead of href.
   *  ONLY set usesRouter to true if SubMenu is wrapped in a react-router <Router>;
   *  otherwise, a 'You should not use <Link> outside a <Router>' error will be thrown */
  usesRouter?: boolean;
  color?: string;
  dropDownLinks?: Array<MenuObjectProps>;
  backgroundColor?: string;
}

type ResponsiveMenuMode = 'horizontal' | 'inline';

const getMenuMode = (): ResponsiveMenuMode =>
  typeof window !== 'undefined' && window.innerWidth <= 767
    ? 'inline'
    : 'horizontal';

const getNavRightStyle = (buttonCount: number): string =>
  typeof window !== 'undefined' && buttonCount >= 3 && window.innerWidth <= 795
    ? 'nav-right-collapse'
    : 'nav-right';

const SubMenuComponent: FunctionComponent<SubMenuProps> = props => {
  const buttonCount = props.buttons?.length ?? 0;
  const hasDropdownLinks = (props.dropDownLinks?.length ?? 0) > 0;
  const hasActions = hasDropdownLinks || buttonCount > 0;
  const [showMenu, setMenu] = useState<ResponsiveMenuMode>(() => getMenuMode());
  const [navRightStyle, setNavRightStyle] = useState(() =>
    getNavRightStyle(buttonCount),
  );

  let hasHistory = true;
  // If no parent <Router> component exists, useHistory throws an error
  try {
    useHistory();
  } catch (err) {
    // If error is thrown, we know not to use <Link> in render
    hasHistory = false;
  }

  useEffect(() => {
    function handleResize() {
      const nextMenuMode = getMenuMode();
      const nextNavRightStyle = getNavRightStyle(buttonCount);
      setMenu(currentMenu =>
        currentMenu === nextMenuMode ? currentMenu : nextMenuMode,
      );
      setNavRightStyle(currentStyle =>
        currentStyle === nextNavRightStyle ? currentStyle : nextNavRightStyle,
      );
    }
    handleResize();
    const resize = debounce(handleResize, 10);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      resize.cancel();
    };
  }, [buttonCount]);

  const renderedTabs = useMemo(
    () =>
      props.tabs?.map(tab => {
        const linkClassName = cx('tab-link', {
          active: tab.name === props.activeChild,
        });
        const commonProps = {
          role: 'tab' as const,
          id: tab.id || tab.name,
          'data-test': tab['data-test'],
          'aria-selected': tab.name === props.activeChild,
          'aria-controls': tab['aria-controls'] || '',
        };
        return (
          <div key={tab.label} className="tab-item">
            {(props.usesRouter || hasHistory) && tab.usesRouter ? (
              <Link
                to={tab.url || ''}
                {...commonProps}
                className={linkClassName}
              >
                {tab.label}
              </Link>
            ) : (
              <Typography.Link
                {...commonProps}
                href={tab.url}
                onClick={tab.onClick}
                className={linkClassName}
              >
                {tab.label}
              </Typography.Link>
            )}
          </div>
        );
      }),
    [hasHistory, props.activeChild, props.tabs, props.usesRouter],
  );
  const dropdownMenus = useMemo(
    () =>
      props.dropDownLinks?.map((link, i) => ({
        key: `submenu-${i}`,
        label: link.label,
        items: link.childs
          ?.map((item, idx) => {
            if (typeof item === 'object' && item !== null) {
              return {
                key: `${i}-${idx}`,
                label: item.disable ? (
                  <Tooltip
                    placement="top"
                    title={t(
                      "Enable 'Allow file uploads to database' in any database's settings",
                    )}
                  >
                    {item.label}
                  </Tooltip>
                ) : (
                  <Typography.Link href={item.url} onClick={item.onClick}>
                    {item.label}
                  </Typography.Link>
                ),
                disabled: item.disable,
              };
            }
            return null;
          })
          .filter((item): item is NonNullable<typeof item> => item !== null),
      })),
    [props.dropDownLinks],
  );

  return (
    <StyledHeader backgroundColor={props.backgroundColor}>
      <Row className="menu" role="navigation">
        {props.name && <div className="header">{props.name}</div>}
        {props.tabs?.length ? (
          <div
            role="tablist"
            className={cx('tab-list', {
              'tab-list-inline': showMenu === 'inline',
            })}
          >
            {renderedTabs}
          </div>
        ) : null}
        {hasActions ? (
          <div className={navRightStyle}>
            {hasDropdownLinks
              ? dropdownMenus?.map(menu => (
                  <Dropdown
                    key={menu.key}
                    trigger={['click']}
                    menu={{ items: menu.items }}
                    classNames={{ root: "dropdown-menu-links" }}
                  >
                    <Button buttonStyle="link">
                      <span className="dropdown-trigger">
                        {menu.label}
                        <Icons.CaretDownOutlined iconSize="xs" />
                      </span>
                    </Button>
                  </Dropdown>
                ))
              : null}
            {props.buttons?.map((btn, i) => (
              <Button
                key={i}
                buttonStyle={btn.buttonStyle}
                icon={btn.icon}
                onClick={btn.onClick}
                data-test={btn['data-test']}
                loading={btn.loading ?? false}
              >
                {btn.name}
              </Button>
            ))}
          </div>
        ) : null}
      </Row>
      {props.children}
    </StyledHeader>
  );
};

export default SubMenuComponent;
