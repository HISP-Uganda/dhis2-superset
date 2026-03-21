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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isFeatureEnabled,
  FeatureFlag,
  getExtensionsRegistry,
  JsonObject,
  styled,
  t,
} from '@superset-ui/core';
import rison from 'rison';
import { Collapse, ListViewCard } from '@superset-ui/core/components';
import { User } from 'src/types/bootstrapTypes';
import { reject } from 'lodash';
import {
  dangerouslyGetItemDoNotUse,
  dangerouslySetItemDoNotUse,
  getItem,
  LocalStorageKeys,
  setItem,
} from 'src/utils/localStorageHelpers';
import withToasts from 'src/components/MessageToasts/withToasts';
import {
  CardContainer,
  createErrorHandler,
  getRecentActivityObjs,
  getUserOwnedObjects,
  loadingCardCount,
  mq,
} from 'src/views/CRUD/utils';
import { Switch } from '@superset-ui/core/components/Switch';
import getBootstrapData from 'src/utils/getBootstrapData';
import { TableTab } from 'src/views/CRUD/types';
import EmptyState from 'src/features/home/EmptyState';
import SubMenu, { SubMenuProps } from 'src/features/home/SubMenu';
import { userHasPermission } from 'src/dashboard/util/permissionUtils';
import { WelcomePageLastTab, WelcomeTable } from 'src/features/home/types';
import ActivityTable from 'src/features/home/ActivityTable';
import ChartTable from 'src/features/home/ChartTable';
import SavedQueries from 'src/features/home/SavedQueries';
import DashboardTable from 'src/features/home/DashboardTable';

const extensionsRegistry = getExtensionsRegistry();

interface WelcomeProps {
  user?: User;
  addDangerToast: (arg0: string) => void;
}

export interface ActivityData {
  [TableTab.Created]?: JsonObject[];
  [TableTab.Edited]?: JsonObject[];
  [TableTab.Viewed]?: JsonObject[];
  [TableTab.Other]?: JsonObject[];
}

interface LoadingProps {
  cover?: boolean;
}

const DEFAULT_TAB_ARR = ['dashboards', 'charts'];

const WelcomeContainer = styled.div`
  background: ${({ theme }) => theme.colorBgLayout};
  padding-top: ${({ theme }) => theme.sizeUnit * 4}px;
  padding-left: ${({ theme }) => theme.sizeUnit * 6}px;
  padding-right: ${({ theme }) => theme.sizeUnit * 6}px;

  .ant-row.menu {
    margin-top: -15px;

    &:after {
      content: '';
      display: block;
      margin: 0px ${({ theme }) => theme.sizeUnit * 6}px;
      position: relative;
      width: 100%;

      ${mq[1]} {
        margin-top: 5px;
        margin: 0px 2px;
      }
    }

    button {
      padding: 3px 21px;
    }
  }

  .ant-card-meta-description {
    margin-top: ${({ theme }) => theme.sizeUnit}px;
  }

  .ant-card.ant-card-bordered {
    border: 1px solid ${({ theme }) => theme.colorBorder};
  }

  .loading-cards {
    margin-top: ${({ theme }) => theme.sizeUnit * 8}px;

    .ant-card-cover > div {
      height: 168px;
    }
  }
`;

const WelcomeNav = styled.div`
  ${({ theme }) => `
    .switch {
      display: flex;
      flex-direction: row;
      margin: ${theme.sizeUnit * 4}px;
      span {
        display: block;
        margin: ${theme.sizeUnit}px;
        line-height: ${theme.sizeUnit * 3.5}px;
      }
    }
  `}
`;

const bootstrapData = getBootstrapData();

export const LoadingCards = ({ cover }: LoadingProps) => (
  <CardContainer showThumbnails={cover} className="loading-cards">
    {[...new Array(loadingCardCount)].map((_, index) => (
      <ListViewCard
        key={index}
        cover={cover ? false : <></>}
        description=""
        loading
      />
    ))}
  </CardContainer>
);

function Welcome({ user, addDangerToast }: WelcomeProps) {
  const userId = user?.userId;
  const hasPersonalizedHome = userId !== undefined && userId !== null;
  const userIdString = hasPersonalizedHome ? userId.toString() : null;
  const canReadSavedQueries =
    hasPersonalizedHome &&
    userHasPermission(user ?? ({} as User), 'SavedQuery', 'can_read');
  const params = rison.encode({ page_size: 24, distinct: false });
  const recent = `/api/v1/log/recent_activity/?q=${params}`;
  const [activeChild, setActiveChild] = useState('Loading');
  const userKey = userIdString
    ? dangerouslyGetItemDoNotUse(userIdString, null)
    : null;
  let defaultChecked = false;
  const isThumbnailsEnabled = isFeatureEnabled(FeatureFlag.Thumbnails);
  if (isThumbnailsEnabled) {
    defaultChecked =
      userKey?.thumbnails === undefined ? true : userKey?.thumbnails;
  }
  const [checked, setChecked] = useState(defaultChecked);
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
  const [chartData, setChartData] = useState<Array<object> | null>(null);
  const [queryData, setQueryData] = useState<Array<object> | null>(null);
  const [dashboardData, setDashboardData] = useState<Array<object> | null>(
    null,
  );
  const [isFetchingActivityData, setIsFetchingActivityData] = useState(true);

  const initialCollapseState = useMemo(
    () => getItem(LocalStorageKeys.HomepageCollapseState, []),
    [],
  );
  const [activeState, setActiveState] =
    useState<Array<string>>(initialCollapseState);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const handleCollapse = (state: Array<string>) => {
    setActiveState(state);
    setItem(LocalStorageKeys.HomepageCollapseState, state);
  };

  const SubmenuExtension = extensionsRegistry.get('home.submenu');
  const WelcomeMessageExtension = extensionsRegistry.get('welcome.message');
  const WelcomeTopExtension = extensionsRegistry.get('welcome.banner');
  const WelcomeMainExtension = extensionsRegistry.get(
    'welcome.main.replacement',
  );

  const [otherTabTitle, otherTabFilters] = useMemo(() => {
    const lastTab = bootstrapData.common?.conf
      .WELCOME_PAGE_LAST_TAB as WelcomePageLastTab;
    const [customTitle, customFilter] = Array.isArray(lastTab)
      ? lastTab
      : [undefined, undefined];
    if (customTitle && customFilter) {
      return [t(customTitle), customFilter];
    }
    if (lastTab === 'all') {
      return [t('All'), []];
    }
    return [
      t('Examples'),
      [
        {
          col: 'created_by',
          opr: 'rel_o_m',
          value: 0,
        },
      ],
    ];
  }, []);

  useEffect(() => {
    if (!hasPersonalizedHome || WelcomeMainExtension) {
      setIsFetchingActivityData(false);
      setActiveState(
        initialCollapseState.length > 0
          ? initialCollapseState
          : DEFAULT_TAB_ARR,
      );
      setActiveChild(TableTab.Created);
      setActivityData({
        [TableTab.Created]: [],
        [TableTab.Other]: [],
        [TableTab.Viewed]: [],
      });
      setChartData([]);
      setDashboardData([]);
      setQueryData([]);
      return undefined;
    }

    if (!otherTabFilters || WelcomeMainExtension) {
      return undefined;
    }

    const personalizedUserId = userId as number | string;
    const personalizedUserIdString = userIdString as string;
    const controller = new AbortController();
    const activeTab = getItem(LocalStorageKeys.HomepageActivityFilter, null);
    setIsFetchingActivityData(true);
    setActiveState(
      initialCollapseState.length > 0 ? initialCollapseState : DEFAULT_TAB_ARR,
    );
    getRecentActivityObjs(
      personalizedUserId,
      recent,
      addDangerToast,
      otherTabFilters,
      controller.signal,
    )
      .then(res => {
        if (controller.signal.aborted || !isMountedRef.current) {
          return;
        }
        const data: ActivityData | null = {};
        data[TableTab.Other] = res.other;
        if (res.viewed) {
          const filtered = reject(res.viewed, ['item_url', null]).map(r => r);
          data[TableTab.Viewed] = filtered;
          if (!activeTab && data[TableTab.Viewed]) {
            setActiveChild(TableTab.Viewed);
          } else if (!activeTab && !data[TableTab.Viewed]) {
            setActiveChild(TableTab.Created);
          } else setActiveChild(activeTab || TableTab.Created);
        } else if (!activeTab) setActiveChild(TableTab.Created);
        else setActiveChild(activeTab);
        setActivityData(activityData => ({ ...activityData, ...data }));
      })
      .catch(
        createErrorHandler((errMsg: unknown) => {
          if (controller.signal.aborted || !isMountedRef.current) {
            return;
          }
          setActivityData(activityData => ({
            ...activityData,
            [TableTab.Viewed]: [],
          }));
          addDangerToast(
            t('There was an issue fetching your recent activity: %s', errMsg),
          );
        }),
      );

    // Sets other activity data in parallel with recents api call
    const ownSavedQueryFilters = [
      {
        col: 'created_by',
        opr: 'rel_o_m',
        value: personalizedUserIdString,
      },
    ];
    Promise.all([
      getUserOwnedObjects(
        personalizedUserId,
        'dashboard',
        undefined,
        undefined,
        controller.signal,
      )
        .then(r => {
          if (controller.signal.aborted || !isMountedRef.current) {
            return Promise.resolve();
          }
          setDashboardData(r);
          return Promise.resolve();
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || !isMountedRef.current) {
            return Promise.resolve();
          }
          setDashboardData([]);
          addDangerToast(
            t('There was an issue fetching your dashboards: %s', err),
          );
          return Promise.resolve();
        }),
      getUserOwnedObjects(
        personalizedUserId,
        'chart',
        undefined,
        undefined,
        controller.signal,
      )
        .then(r => {
          if (controller.signal.aborted || !isMountedRef.current) {
            return Promise.resolve();
          }
          setChartData(r);
          return Promise.resolve();
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || !isMountedRef.current) {
            return Promise.resolve();
          }
          setChartData([]);
          addDangerToast(t('There was an issue fetching your chart: %s', err));
          return Promise.resolve();
        }),
      canReadSavedQueries
        ? getUserOwnedObjects(
            personalizedUserId,
            'saved_query',
            ownSavedQueryFilters,
            undefined,
            controller.signal,
          )
            .then(r => {
              if (controller.signal.aborted || !isMountedRef.current) {
                return Promise.resolve();
              }
              setQueryData(r);
              return Promise.resolve();
            })
            .catch((err: unknown) => {
              if (controller.signal.aborted || !isMountedRef.current) {
                return Promise.resolve();
              }
              setQueryData([]);
              addDangerToast(
                t('There was an issue fetching your saved queries: %s', err),
              );
              return Promise.resolve();
            })
        : Promise.resolve(),
    ]).then(() => {
      if (controller.signal.aborted || !isMountedRef.current) {
        return;
      }
      setIsFetchingActivityData(false);
    });
    return () => {
      controller.abort();
    };
  }, [
    WelcomeMainExtension,
    addDangerToast,
    canReadSavedQueries,
    hasPersonalizedHome,
    initialCollapseState,
    otherTabFilters,
    recent,
    userId,
    userIdString,
  ]);

  const handleToggle = () => {
    setChecked(!checked);
    if (userIdString) {
      dangerouslySetItemDoNotUse(userIdString, { thumbnails: !checked });
    }
  };

  useEffect(() => {
    if (initialCollapseState.length === 0 && queryData?.length) {
      setActiveState(activeState => [...activeState, '4']);
    }
    setActivityData(activityData => ({
      ...activityData,
      Created: [
        ...(chartData?.slice(0, 3) || []),
        ...(dashboardData?.slice(0, 3) || []),
        ...(queryData?.slice(0, 3) || []),
      ],
    }));
  }, [chartData, dashboardData, initialCollapseState.length, queryData]);

  useEffect(() => {
    if (
      initialCollapseState.length === 0 &&
      activityData?.[TableTab.Viewed]?.length
    ) {
      setActiveState(activeState => ['1', ...activeState]);
    }
  }, [activityData, initialCollapseState.length]);

  const isRecentActivityLoading =
    !activityData?.[TableTab.Other] && !activityData?.[TableTab.Viewed];

  const menuData: SubMenuProps = {
    activeChild: 'Home',
    name: t('Home'),
  };

  if (isThumbnailsEnabled) {
    menuData.buttons = [
      {
        name: (
          <WelcomeNav>
            <div className="switch">
              <Switch checked={checked} onClick={handleToggle} />
              <span>{t('Thumbnails')}</span>
            </div>
          </WelcomeNav>
        ),
        onClick: handleToggle,
        buttonStyle: 'link',
      },
    ];
  }

  return (
    <>
      {SubmenuExtension ? (
        <SubmenuExtension {...menuData} />
      ) : (
        <SubMenu {...menuData} />
      )}
      <WelcomeContainer>
        {WelcomeMessageExtension && <WelcomeMessageExtension />}
        {WelcomeTopExtension && <WelcomeTopExtension />}
        {WelcomeMainExtension && <WelcomeMainExtension />}
        {(!WelcomeTopExtension || !WelcomeMainExtension) && (
          <>
            <Collapse
              activeKey={activeState}
              onChange={handleCollapse}
              ghost
              items={[
                {
                  key: 'recents',
                  label: t('Recents'),
                  children: !hasPersonalizedHome ? (
                    <EmptyState tableName={WelcomeTable.Recents} />
                  ) : activityData &&
                    (activityData[TableTab.Viewed] ||
                      activityData[TableTab.Other] ||
                      activityData[TableTab.Created]) &&
                    activeChild !== 'Loading' ? (
                    <ActivityTable
                      user={{ userId }}
                      activeChild={activeChild}
                      setActiveChild={setActiveChild}
                      activityData={activityData}
                      isFetchingActivityData={isFetchingActivityData}
                    />
                  ) : (
                    <LoadingCards />
                  ),
                },
                {
                  key: 'dashboards',
                  label: t('Dashboards'),
                  children: !hasPersonalizedHome ? (
                    <EmptyState
                      tableName={WelcomeTable.Dashboards}
                      tab={TableTab.Mine}
                    />
                  ) : !dashboardData || isRecentActivityLoading ? (
                    <LoadingCards cover={checked} />
                  ) : (
                    <DashboardTable
                      user={user}
                      mine={dashboardData}
                      showThumbnails={checked}
                      otherTabData={activityData?.[TableTab.Other]}
                      otherTabFilters={otherTabFilters}
                      otherTabTitle={otherTabTitle}
                    />
                  ),
                },
                {
                  key: 'charts',
                  label: t('Charts'),
                  children: !hasPersonalizedHome ? (
                    <EmptyState
                      tableName={WelcomeTable.Charts}
                      tab={TableTab.Mine}
                    />
                  ) : !chartData || isRecentActivityLoading ? (
                    <LoadingCards cover={checked} />
                  ) : (
                    <ChartTable
                      showThumbnails={checked}
                      user={user}
                      mine={chartData}
                      otherTabData={activityData?.[TableTab.Other]}
                      otherTabFilters={otherTabFilters}
                      otherTabTitle={otherTabTitle}
                    />
                  ),
                },
                ...(canReadSavedQueries
                  ? [
                      {
                        key: 'saved-queries',
                        label: t('Saved queries'),
                        children: !queryData ? (
                          <LoadingCards cover={checked} />
                        ) : (
                          <SavedQueries
                            showThumbnails={checked}
                            user={user}
                            mine={queryData}
                            featureFlag={isThumbnailsEnabled}
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </>
        )}
      </WelcomeContainer>
    </>
  );
}

export default withToasts(Welcome);
