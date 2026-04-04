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
/* eslint-env browser */
import { css } from '@emotion/react';
import cx from 'classnames';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  JsonObject,
  styled,
  t,
  useTheme,
  useElementOnScreen,
} from '@superset-ui/core';

const addAlpha = (color: string, opacity: number): string => {
  if (opacity > 1 || opacity < 0) {
    return color;
  }
  if (!color || !color.startsWith('#')) {
    return color;
  }
  const alpha = `0${Math.round(opacity * 255)
    .toString(16)
    .toUpperCase()}`.slice(-2);
  return `${color}${alpha}`;
};
import { useDispatch, useSelector } from 'react-redux';
import { EmptyState, Loading } from '@superset-ui/core/components';
import { ErrorBoundary, BasicErrorAlert } from 'src/components';
import BuilderComponentPane from 'src/dashboard/components/BuilderComponentPane';
import DashboardHeader from 'src/dashboard/components/Header';
import { Icons } from '@superset-ui/core/components/Icons';
import IconButton from 'src/dashboard/components/IconButton';
import { Droppable } from 'src/dashboard/components/dnd/DragDroppable';
import DashboardComponent from 'src/dashboard/containers/DashboardComponent';
import WithPopoverMenu from 'src/dashboard/components/menu/WithPopoverMenu';
import getDirectPathToTabIndex from 'src/dashboard/util/getDirectPathToTabIndex';
import { URL_PARAMS } from 'src/constants';
import { getUrlParam } from 'src/utils/urlUtils';
import {
  DashboardLayout,
  FilterBarOrientation,
  RootState,
} from 'src/dashboard/types';
import {
  setDirectPathToChild,
  setEditMode,
} from 'src/dashboard/actions/dashboardState';
import {
  deleteTopLevelTabs,
  handleComponentDrop,
  clearDashboardHistory,
} from 'src/dashboard/actions/dashboardLayout';
import {
  DASHBOARD_GRID_ID,
  DASHBOARD_ROOT_DEPTH,
  DASHBOARD_ROOT_ID,
  DashboardStandaloneMode,
} from 'src/dashboard/util/constants';
import FilterBar from 'src/dashboard/components/nativeFilters/FilterBar';
import { useUiConfig } from 'src/components/UiConfigContext';
import ResizableSidebar from 'src/components/ResizableSidebar';
import {
  BUILDER_SIDEPANEL_WIDTH,
  CLOSED_FILTER_BAR_WIDTH,
  FILTER_BAR_HEADER_HEIGHT,
  MAIN_HEADER_HEIGHT,
  OPEN_FILTER_BAR_MAX_WIDTH,
  OPEN_FILTER_BAR_WIDTH,
  EMPTY_CONTAINER_Z_INDEX,
} from 'src/dashboard/constants';
import { getRootLevelTabsComponent, shouldFocusTabs } from './utils';
import DashboardContainer from './DashboardContainer';
import { useNativeFilters } from './state';
import DashboardWrapper from './DashboardWrapper';

// @z-index-above-dashboard-charts + 1 = 11
const FiltersPanel = styled.div<{ width: number; hidden: boolean }>`
  background-color: ${({ theme }) => theme.colorBgContainer};
  grid-column: 1;
  grid-row: 1 / span 2;
  z-index: 11;
  width: ${({ width }) => width}px;
  ${({ hidden }) => hidden && `display: none;`}

  @media (max-width: 767px) {
    display: none;
  }
`;

const StickyPanel = styled.div<{ width: number }>`
  position: sticky;
  top: 0;
  width: ${({ width }) => width}px;
  flex: 0 0 ${({ width }) => width}px;
  z-index: 10;
`;

// @z-index-above-dashboard-popovers (99) + 1 = 100
const StyledHeader = styled('div', {
  shouldForwardProp: prop => prop !== 'isPublicView',
})<{ isPublicView?: boolean }>`
  ${({ theme, isPublicView }) => css`
    grid-column: 2;
    grid-row: 1;
    z-index: 99;
    max-width: 100vw;
    background: ${theme.colorBgBase};
    margin-top: 0;
    padding: 0;

    ${isPublicView
      ? css`
          /* Public view: no sticky — page body scrolls and the portal nav is
             already position: fixed.  Using sticky here with
             top: var(--portal-header-height) causes a visual offset equal to
             the portal header height because the DashboardWrapper's
             overflow-y: visible means there is no scroll container for the
             sticky algorithm, so the browser falls back to relative
             positioning and pushes the header down by the top value. */
          position: static;
          & > .dashboard-header-container {
            margin: 0;
            padding: 0;
          }
          & .dragdroppable {
            margin: 0 !important;
            padding: 0 !important;
          }
        `
      : css`
          position: sticky;
          top: 0;
        `}

    @media (max-width: 767px) {
      grid-column: 1;
    }

    .empty-droptarget:before {
      position: absolute;
      content: '';
      display: none;
      width: calc(100% - ${theme.sizeUnit * 2}px);
      height: calc(100% - ${theme.sizeUnit * 2}px);
      left: ${theme.sizeUnit}px;
      top: ${theme.sizeUnit}px;
      border: 1px dashed transparent;
      border-radius: ${theme.borderRadius}px;
      opacity: 0.5;
    }
  `}
`;

const StyledContent = styled.div<{
  fullSizeChartId: number | null;
}>`
  grid-column: 2;
  grid-row: 2;
  position: relative;
  z-index: ${({ fullSizeChartId }) => (fullSizeChartId ? 101 : 1)};
  isolation: isolate;

  @media (max-width: 767px) {
    grid-column: 1;
  }
`;

const DashboardContentWrapper = styled.div`
  ${({ theme }) => css`
    &.dashboard {
      position: relative;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      height: 100%;

      /* flat border for top-level tabs */
      & .dashboard-component-tabs {
        box-shadow: none;
        border-bottom: 1px solid ${addAlpha(theme.colorBorderSecondary, 0.22)};
        padding-left: ${theme.sizeUnit *
        2}px; /* note this is added to tab-level padding, to match header */
      }

      .dropdown-toggle.btn.btn-primary .caret {
        color: ${theme.colorText};
      }

      .background--transparent {
        background-color: transparent;
      }

      .background--white {
        background-color: ${theme.colorBgContainer};
      }
    }
    &.dashboard--editing {
      .grid-row:after,
      .dashboard-component-tabs > .hover-menu:hover + div:after {
        border: 1px dashed transparent;
        content: '';
        position: absolute;
        width: 100%;
        height: 100%;
        top: 0;
        left: 0;
        z-index: 1;
        pointer-events: none;
        border-radius: ${theme.borderRadiusLG}px;
        transition: border-color ${theme.motionDurationFast} ease;
      }

      .grid-row.grid-row--hovered:after,
      .dashboard-component-tabs > .grid-row--hovered:after {
        border: 2px dashed ${theme.colorPrimary};
      }

      .resizable-container {
        & .dashboard-component-chart-holder {
          .dashboard-chart {
            .chart-container {
              cursor: move;
              opacity: 0.3;
              transition: opacity ${theme.motionDurationMid} ease;
            }

            .slice_container {
              /* disable chart interactions in edit mode */
              pointer-events: none;
            }
          }

          &:hover .dashboard-chart .chart-container {
            opacity: 0.8;
          }
        }

        &:hover,
        &.resizable-container--resizing:hover {
          & > .dashboard-component-chart-holder:after {
            border: 1px dashed ${theme.colorPrimary};
            border-radius: ${theme.borderRadiusLG}px;
          }
        }
      }

      .resizable-container--resizing:hover > .grid-row:after,
      .hover-menu:hover + .grid-row:after,
      .dashboard-component-tabs > .hover-menu:hover + div:after {
        border: 1px dashed ${theme.colorPrimary};
        z-index: 2;
      }

      .grid-row:after,
      .dashboard-component-tabs > .hover-menu + div:after {
        border: 1px dashed ${theme.colorBorder};
      }

      /* provide hit area in case row contents is edge to edge */
      .dashboard-component-tabs-content {
        > .dragdroppable-row {
          padding-top: ${theme.sizeUnit * 4}px;
        }
      }

      .dashboard-component-chart-holder {
        &:after {
          content: '';
          position: absolute;
          width: 100%;
          height: 100%;
          top: 0;
          left: 0;
          z-index: 1;
          pointer-events: none;
          border: 1px solid transparent;
          border-radius: ${theme.borderRadiusLG}px;
          transition: border-color ${theme.motionDurationFast} ease,
            box-shadow ${theme.motionDurationFast} ease;
        }

        &:hover:after {
          border: 1px dashed ${theme.colorPrimary};
          box-shadow: 0 0 0 3px ${addAlpha(theme.colorPrimary, 0.08)};
          z-index: 2;
        }
      }

      .contract-trigger:before {
        display: none;
      }

      /* Smooth layout reflow transitions in edit mode */
      .dragdroppable-row {
        transition: margin 0.15s ease, padding 0.15s ease;
      }

      .resizable-container {
        transition: width 0.15s ease;
      }
    }

    & .dashboard-component-tabs-content {
      & > div:not(:last-child):not(.empty-droptarget) {
        margin-bottom: ${theme.sizeUnit * 4}px;
      }

      & > .empty-droptarget {
        z-index: ${EMPTY_CONTAINER_Z_INDEX};
        position: absolute;
        width: 100%;
      }

      & > .empty-droptarget:first-of-type:not(.empty-droptarget--full) {
        height: ${theme.sizeUnit * 4}px;
        top: 0;
      }

      & > .empty-droptarget:last-child {
        height: ${theme.sizeUnit * 4}px;
        bottom: ${-theme.sizeUnit * 4}px;
      }
    }
  `}
`;

const StyledDashboardContent = styled.div<{
  editMode: boolean;
  marginLeft: number;
}>`
  ${({ theme, editMode, marginLeft }) => css`
    background-color: ${theme.colorBgLayout};
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    height: auto;
    flex: 1;

    .grid-container .dashboard-component-tabs {
      box-shadow: none;
      padding-left: 0;
    }

    .grid-container {
      /* without this, the grid will not get smaller upon toggling the builder panel on */
      width: 0;
      flex: 1;
      position: relative;
      margin: ${theme.sizeUnit * 4}px;
      margin-left: ${marginLeft}px;
      transition: margin ${theme.motionDurationMid} ease;

      ${editMode &&
      `
      max-width: calc(100% - ${
        BUILDER_SIDEPANEL_WIDTH + theme.sizeUnit * 16
      }px);
    `}

      /* this is the ParentSize wrapper */
    & > div:first-of-type {
        height: inherit !important;
      }
    }

    .dashboard-builder-sidepane {
      width: ${BUILDER_SIDEPANEL_WIDTH}px;
      z-index: 1;
    }

    .resizable-container {
      max-width: 100% !important;
      transition: width ${theme.motionDurationMid} ease,
        height ${theme.motionDurationMid} ease;
    }

    /* Smooth layout transitions for rows and columns */
    .dragdroppable-row {
      transition: margin ${theme.motionDurationFast} ease;
    }

    .grid-row {
      position: relative;
      border-radius: ${theme.borderRadiusLG}px;
    }

    /* ── Responsive grid ── */
    @media (max-width: 1024px) {
      .grid-container {
        margin: ${theme.sizeUnit * 2}px;
        margin-left: ${theme.sizeUnit * 2}px;
      }
    }

    @media (max-width: 767px) {
      flex-direction: column;

      .grid-container {
        margin: ${theme.sizeUnit}px;
        margin-left: ${theme.sizeUnit}px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        ${editMode ? `max-width: 100%;` : ''}
      }

      .dashboard-builder-sidepane {
        width: 100%;
        position: fixed;
        bottom: 0;
        left: 0;
        z-index: 100;
        max-height: 50vh;
        overflow-y: auto;
      }
    }

    .dashboard-component-chart-holder {
      width: 100%;
      height: 100%;
      background-color: ${theme.colorBgContainer};
      border-radius: ${theme.borderRadiusLG}px;
      border: 1px solid ${addAlpha(theme.colorBorderSecondary, 0.22)};
      position: relative;
      padding: ${theme.sizeUnit * 4}px;
      overflow: hidden;
      box-shadow: none;

      // transitionable traits to show filter relevance
      transition:
        opacity ${theme.motionDurationMid} ease-in-out,
        border-color ${theme.motionDurationMid} ease-in-out,
        box-shadow ${theme.motionDurationMid} ease-in-out,
        transform ${theme.motionDurationFast} ease-out;

      &:hover {
        border-color: ${addAlpha(theme.colorBorderSecondary, 0.4)};
        box-shadow: none;
      }

      &.fade-in {
        border-radius: ${theme.borderRadiusLG}px;
        border-color: ${theme.colorPrimary};
        box-shadow: 0 0 0 2px ${addAlpha(theme.colorPrimary, 0.1)};
      }

      &.fade-out {
        border-radius: ${theme.borderRadiusLG}px;
        border-color: ${addAlpha(theme.colorBorderSecondary, 0.22)};
        box-shadow: none;
      }

      & .missing-chart-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        overflow-y: auto;
        justify-content: center;

        .missing-chart-body {
          font-size: ${theme.fontSizeSM}px;
          position: relative;
          display: flex;
        }
      }
    }
  `}
`;

const ELEMENT_ON_SCREEN_OPTIONS = {
  threshold: [1],
};

interface DashboardBuilderProps {
  isPublicView?: boolean;
  onBack?: () => void;
  backLabel?: string;
  badge?: string;
  subtitle?: string;
}

const DashboardBuilder: React.FC<DashboardBuilderProps> = ({
  isPublicView,
  onBack,
  backLabel,
  badge,
  subtitle,
}) => {
  const dispatch = useDispatch();
  const uiConfig = useUiConfig();
  const theme = useTheme();

  const dashboardId = useSelector<RootState, string>(
    ({ dashboardInfo }) => `${dashboardInfo.id}`,
  );
  const dashboardLayout = useSelector<RootState, DashboardLayout>(
    state => state.dashboardLayout.present,
  );
  const editMode = useSelector<RootState, boolean>(
    state => state.dashboardState.editMode,
  );
  const canEdit = useSelector<RootState, boolean>(
    ({ dashboardInfo }) => dashboardInfo.dash_edit_perm,
  );
  const dashboardIsSaving = useSelector<RootState, boolean>(
    ({ dashboardState }) => dashboardState.dashboardIsSaving,
  );
  const fullSizeChartId = useSelector<RootState, number | null>(
    state => state.dashboardState.fullSizeChartId,
  );
  const filterBarOrientation = useSelector<RootState, FilterBarOrientation>(
    ({ dashboardInfo }) => dashboardInfo.filterBarOrientation,
  );

  const handleChangeTab = useCallback(
    ({ pathToTabIndex }: { pathToTabIndex: string[] }) => {
      dispatch(setDirectPathToChild(pathToTabIndex));
      window.scrollTo(0, 0);
    },
    [dispatch],
  );

  const handleDeleteTopLevelTabs = useCallback(() => {
    dispatch(deleteTopLevelTabs());

    const firstTab = getDirectPathToTabIndex(
      getRootLevelTabsComponent(dashboardLayout),
      0,
    );
    dispatch(setDirectPathToChild(firstTab));
  }, [dashboardLayout, dispatch]);

  const handleDrop = useCallback(
    dropResult => dispatch(handleComponentDrop(dropResult)),
    [dispatch],
  );

  const headerRef = useRef<HTMLDivElement>(null);
  const dashboardRoot = dashboardLayout[DASHBOARD_ROOT_ID];
  const rootChildId = dashboardRoot?.children[0];
  const topLevelTabs =
    rootChildId !== DASHBOARD_GRID_ID
      ? dashboardLayout[rootChildId]
      : undefined;
  const standaloneMode = getUrlParam(URL_PARAMS.standalone);
  const isReport = standaloneMode === DashboardStandaloneMode.Report;
  const hideDashboardHeader =
    uiConfig.hideTitle ||
    standaloneMode === DashboardStandaloneMode.HideNavAndTitle ||
    isReport;

  const [barTopOffset, setBarTopOffset] = useState(0);

  useEffect(() => {
    setBarTopOffset(headerRef.current?.getBoundingClientRect()?.height || 0);

    let observer: ResizeObserver;
    if (global.hasOwnProperty('ResizeObserver') && headerRef.current) {
      observer = new ResizeObserver(entries => {
        setBarTopOffset(
          current => entries?.[0]?.contentRect?.height || current,
        );
      });

      observer.observe(headerRef.current);
    }

    return () => {
      observer?.disconnect();
    };
  }, []);

  const {
    showDashboard,
    missingInitialFilters,
    dashboardFiltersOpen,
    toggleDashboardFiltersOpen,
    nativeFiltersEnabled,
  } = useNativeFilters();

  const [containerRef, isSticky] = useElementOnScreen<HTMLDivElement>(
    ELEMENT_ON_SCREEN_OPTIONS,
  );

  // In public view, hide the inline filter bars — filters are accessed via
  // a drawer button in the header instead.
  const showFilterBar = !editMode && nativeFiltersEnabled && !isPublicView;

  const offset =
    FILTER_BAR_HEADER_HEIGHT +
    (isSticky || standaloneMode ? 0 : MAIN_HEADER_HEIGHT);

  const filterBarHeight = `calc(100vh - ${offset}px)`;
  const filterBarOffset = dashboardFiltersOpen ? 0 : barTopOffset + 20;

  const draggableStyle = useMemo(
    () => ({
      marginLeft:
        isPublicView ||
        dashboardFiltersOpen ||
        editMode ||
        !nativeFiltersEnabled ||
        filterBarOrientation === FilterBarOrientation.Horizontal
          ? 0
          : -32,
    }),
    [
      isPublicView,
      dashboardFiltersOpen,
      editMode,
      filterBarOrientation,
      nativeFiltersEnabled,
    ],
  );

  // If a new tab was added, update the directPathToChild to reflect it
  const currentTopLevelTabs = useRef(topLevelTabs);
  useEffect(() => {
    const currentTabsLength = currentTopLevelTabs.current?.children?.length;
    const newTabsLength = topLevelTabs?.children?.length;

    if (
      currentTabsLength !== undefined &&
      newTabsLength !== undefined &&
      newTabsLength > currentTabsLength
    ) {
      const lastTab = getDirectPathToTabIndex(
        getRootLevelTabsComponent(dashboardLayout),
        newTabsLength - 1,
      );
      dispatch(setDirectPathToChild(lastTab));
    }

    currentTopLevelTabs.current = topLevelTabs;
  }, [topLevelTabs]);

  const renderDraggableContent = useCallback(
    ({ dropIndicatorProps }: { dropIndicatorProps: JsonObject }) => (
      <div>
        {!hideDashboardHeader && (
          <DashboardHeader
            isPublicView={isPublicView}
            onBack={onBack}
            backLabel={backLabel}
            badge={badge}
            subtitle={subtitle}
          />
        )}
        {showFilterBar &&
          filterBarOrientation === FilterBarOrientation.Horizontal && (
            <FilterBar
              orientation={FilterBarOrientation.Horizontal}
              hidden={isReport}
            />
          )}
        {dropIndicatorProps && <div {...dropIndicatorProps} />}
        {!isReport && topLevelTabs && !uiConfig.hideNav && (
          <WithPopoverMenu
            shouldFocus={shouldFocusTabs}
            menuItems={[
              <IconButton
                icon={<Icons.FallOutlined iconSize="xl" />}
                label={t('Collapse tab content')}
                onClick={handleDeleteTopLevelTabs}
              />,
            ]}
            editMode={editMode}
          >
            {/* @ts-ignore */}
            <DashboardComponent
              id={topLevelTabs?.id}
              parentId={DASHBOARD_ROOT_ID}
              depth={DASHBOARD_ROOT_DEPTH + 1}
              index={0}
              renderTabContent={false}
              renderHoverMenu={false}
              onChangeTab={handleChangeTab}
            />
          </WithPopoverMenu>
        )}
      </div>
    ),
    [
      nativeFiltersEnabled,
      filterBarOrientation,
      editMode,
      handleChangeTab,
      handleDeleteTopLevelTabs,
      hideDashboardHeader,
      isReport,
      topLevelTabs,
      uiConfig.hideNav,
      isPublicView,
      onBack,
      backLabel,
      badge,
      subtitle,
    ],
  );

  const dashboardContentMarginLeft = isPublicView
    ? theme.sizeUnit * 4
    : !editMode
      ? theme.sizeUnit * 4
      : theme.sizeUnit * 8;

  const renderChild = useCallback(
    adjustedWidth => {
      const filterBarWidth = dashboardFiltersOpen
        ? adjustedWidth
        : CLOSED_FILTER_BAR_WIDTH;
      return (
        <FiltersPanel
          width={filterBarWidth}
          hidden={isReport}
          data-test="dashboard-filters-panel"
        >
          <StickyPanel ref={containerRef} width={filterBarWidth}>
            <ErrorBoundary>
              <FilterBar
                orientation={FilterBarOrientation.Vertical}
                verticalConfig={{
                  filtersOpen: dashboardFiltersOpen,
                  toggleFiltersBar: toggleDashboardFiltersOpen,
                  width: filterBarWidth,
                  height: filterBarHeight,
                  offset: filterBarOffset,
                }}
              />
            </ErrorBoundary>
          </StickyPanel>
        </FiltersPanel>
      );
    },
    [
      dashboardFiltersOpen,
      toggleDashboardFiltersOpen,
      filterBarHeight,
      filterBarOffset,
      isReport,
    ],
  );

  return (
    <DashboardWrapper isPublicView={isPublicView}>
      {showFilterBar &&
        filterBarOrientation === FilterBarOrientation.Vertical && (
          <>
            <ResizableSidebar
              id={`dashboard:${dashboardId}`}
              enable={dashboardFiltersOpen}
              minWidth={OPEN_FILTER_BAR_WIDTH}
              maxWidth={OPEN_FILTER_BAR_MAX_WIDTH}
              initialWidth={OPEN_FILTER_BAR_WIDTH}
            >
              {renderChild}
            </ResizableSidebar>
          </>
        )}
      <StyledHeader ref={headerRef} isPublicView={isPublicView}>
        {isPublicView ? (
          /* Public view: render header directly without drag/drop wrappers
             to eliminate unnecessary nesting (Droppable > dragdroppable divs) */
          <>
            {!hideDashboardHeader && (
              <DashboardHeader
                isPublicView={isPublicView}
                onBack={onBack}
                backLabel={backLabel}
                badge={badge}
                subtitle={subtitle}
              />
            )}
            {!isReport && topLevelTabs && !uiConfig.hideNav && (
              <DashboardComponent
                id={topLevelTabs?.id}
                parentId={DASHBOARD_ROOT_ID}
                depth={DASHBOARD_ROOT_DEPTH + 1}
                index={0}
                renderTabContent={false}
                renderHoverMenu={false}
                onChangeTab={handleChangeTab}
              />
            )}
          </>
        ) : (
          /* Edit / authenticated view: keep full drag/drop support */
          /* @ts-ignore */
          <Droppable
            data-test="top-level-tabs"
            className={cx(!topLevelTabs && editMode && 'empty-droptarget')}
            component={dashboardRoot}
            parentComponent={null}
            depth={DASHBOARD_ROOT_DEPTH}
            index={0}
            orientation="column"
            onDrop={handleDrop}
            editMode={editMode}
            // you cannot drop on/displace tabs if they already exist
            disableDragDrop={!!topLevelTabs}
            style={draggableStyle}
          >
            {renderDraggableContent}
          </Droppable>
        )}
      </StyledHeader>
      <StyledContent fullSizeChartId={fullSizeChartId}>
        {!editMode &&
          !topLevelTabs &&
          dashboardLayout[DASHBOARD_GRID_ID]?.children?.length === 0 && (
            <EmptyState
              title={t('There are no charts added to this dashboard')}
              size="large"
              description={
                canEdit &&
                t(
                  'Go to the edit mode to configure the dashboard and add charts',
                )
              }
              buttonText={canEdit && t('Edit the dashboard')}
              buttonAction={() => {
                dispatch(setEditMode(true));
                dispatch(clearDashboardHistory());
              }}
              image="dashboard.svg"
            />
          )}
        <DashboardContentWrapper
          data-test="dashboard-content-wrapper"
          className={cx('dashboard', editMode && 'dashboard--editing')}
        >
          <StyledDashboardContent
            className="dashboard-content"
            editMode={editMode}
            marginLeft={dashboardContentMarginLeft}
          >
            {showDashboard ? (
              missingInitialFilters.length > 0 ? (
                <div
                  css={css`
                    display: flex;
                    flex-direction: row;
                    align-items: center;
                    justify-content: center;
                    flex: 1;
                    & div {
                      width: 500px;
                    }
                  `}
                >
                  <BasicErrorAlert
                    title={t('Unable to load dashboard')}
                    body={t(
                      `The following filters have the 'Select first filter value by default'
                    option checked and could not be loaded, which is preventing the dashboard
                    from rendering: %s`,
                      missingInitialFilters.join(', '),
                    )}
                  />
                </div>
              ) : (
                <DashboardContainer topLevelTabs={topLevelTabs} />
              )
            ) : (
              <Loading />
            )}
            {editMode && <BuilderComponentPane topOffset={barTopOffset} />}
          </StyledDashboardContent>
        </DashboardContentWrapper>
      </StyledContent>
      {dashboardIsSaving && (
        <Loading
          css={css`
            && {
              position: fixed;
            }
          `}
        />
      )}
    </DashboardWrapper>
  );
};

export default memo(DashboardBuilder);
