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
  forwardRef,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  css,
  getExtensionsRegistry,
  QueryData,
  styled,
  t,
  useTheme,
} from '@superset-ui/core';
import { useUiConfig } from 'src/components/UiConfigContext';
import { isEmbedded } from 'src/dashboard/util/isEmbedded';
import { Tooltip, EditableTitle, Icons } from '@superset-ui/core/components';
import { useSelector } from 'react-redux';
import SliceHeaderControls from 'src/dashboard/components/SliceHeaderControls';
import { SliceHeaderControlsProps } from 'src/dashboard/components/SliceHeaderControls/types';
import FiltersBadge from 'src/dashboard/components/FiltersBadge';
import GroupByBadge from 'src/dashboard/components/GroupByBadge';
import { RootState } from 'src/dashboard/types';
import RowCountLabel from 'src/components/RowCountLabel';
import { URL_PARAMS } from 'src/constants';
import { DashboardPageIdContext } from 'src/dashboard/containers/DashboardPage';
import { ensureIsArray } from '@superset-ui/core';

const extensionsRegistry = getExtensionsRegistry();

type SliceHeaderProps = SliceHeaderControlsProps & {
  updateSliceName?: (arg0: string) => void;
  editMode?: boolean;
  annotationQuery?: object;
  annotationError?: object;
  sliceName?: string;
  filters: object;
  handleToggleFullSize: () => void;
  formData: object;
  width: number;
  height: number;
  exportPivotExcel?: (arg0: string) => void;
};

const annotationsLoading = t('Annotation layers are still loading.');
const annotationsError = t('One or more annotation layers failed loading.');
const CrossFilterIcon = styled(Icons.ApartmentOutlined)`
  ${({ theme }) => `
    cursor: default;
    color: ${theme.colorPrimary};
    line-height: 1.8;
  `}
`;

const ChartHeaderStyles = styled.div`
  ${({ theme }) => css`
    font-size: var(--pro-density-chart-title, ${(theme as any).fontSizeBase || theme.fontSize}px);
    font-weight: 600;
    margin-bottom: 0;
    display: flex;
    max-width: 100%;
    align-items: center;
    min-height: 32px;
    padding: 6px var(--pro-density-header-h, 10px);
    border-bottom: 2px solid var(--pro-blue, ${theme.colorPrimary});
    background: linear-gradient(
      180deg,
      ${theme.colorBgContainer} 0%,
      ${theme.colorFillAlter || theme.colorBgLayout} 100%
    );

    & > .header-title {
      overflow: visible;
      white-space: normal;
      word-break: break-word;
      max-width: calc(100% - ${theme.sizeUnit * 6}px);
      flex: 1 1 0%;
      display: flex;
      flex-direction: column;
      color: var(--pro-navy, ${theme.colorText});
      letter-spacing: -0.01em;

      & > span.ant-tooltip-open {
        display: inline;
      }
    }

    & > .header-controls {
      display: flex;
      align-items: center;
      height: 24px;
      flex-shrink: 0;
      gap: 2px;
    }

    .chart-filter-context {
      font-size: 11px;
      font-weight: 400;
      color: var(--pro-text-secondary, ${theme.colorTextDescription});
      margin-top: 1px;
      line-height: 1.3;
      opacity: 0.85;
    }

    @media (max-width: 767px) {
      padding: 2px 8px;
      font-size: 13px;

      & > .header-title {
        max-width: calc(100% - ${theme.sizeUnit * 4}px);
      }
    }

    .dropdown.btn-group {
      pointer-events: none;
      vertical-align: top;
      & > * {
        pointer-events: auto;
      }
    }

    .dropdown-toggle.btn.btn-default {
      background: none;
      border: none;
      box-shadow: none;
    }

    .dropdown-menu.dropdown-menu-right {
      top: ${theme.sizeUnit * 5}px;
    }

    .divider {
      margin: ${theme.sizeUnit}px 0;
    }

    .refresh-tooltip {
      display: block;
      height: ${theme.sizeUnit * 4}px;
      margin: ${theme.sizeUnit}px 0;
      color: ${theme.colorTextLabel};
    }
  `}
`;

const SliceHeader = forwardRef<HTMLDivElement, SliceHeaderProps>(
  (
    {
      forceRefresh = () => ({}),
      updateSliceName = () => ({}),
      toggleExpandSlice = () => ({}),
      logExploreChart = () => ({}),
      logEvent,
      exportCSV = () => ({}),
      exportXLSX = () => ({}),
      editMode = false,
      annotationQuery = {},
      annotationError = {},
      cachedDttm = null,
      updatedDttm = null,
      isCached = [],
      isExpanded = false,
      sliceName = '',
      supersetCanExplore = false,
      supersetCanShare = false,
      supersetCanCSV = false,
      exportPivotCSV,
      exportFullCSV,
      exportFullXLSX,
      slice,
      componentId,
      dashboardId,
      addSuccessToast,
      addDangerToast,
      handleToggleFullSize,
      isFullSize,
      chartStatus,
      formData,
      width,
      height,
      exportPivotExcel = () => ({}),
    },
    ref,
  ) => {
    const SliceHeaderExtension = extensionsRegistry.get(
      'dashboard.slice.header',
    );
    const uiConfig = useUiConfig();
    const shouldShowRowLimitWarning =
      !isEmbedded() || uiConfig.showRowLimitWarning;
    const [headerTooltip, setHeaderTooltip] = useState<ReactNode | null>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    // TODO: change to indicator field after it will be implemented
    const crossFilterValue = useSelector<RootState, any>(
      state => state.dataMask[slice?.slice_id]?.filterState?.value,
    );
    const isCrossFiltersEnabled = useSelector<RootState, boolean>(
      ({ dashboardInfo }) => dashboardInfo.crossFiltersEnabled,
    );

    const firstQueryResponse = useSelector<RootState, QueryData | undefined>(
      state => state.charts[slice.slice_id].queriesResponse?.[0],
    );

    const theme = useTheme();
    const dashboardPageId = useContext(DashboardPageIdContext);

    // Extract applied OU / Period filter context for display under the title
    const nativeFilters = useSelector<RootState, any>(
      state => state.nativeFilters?.filters,
    );
    const dataMask = useSelector<RootState, any>(state => state.dataMask);

    const filterContextLine = useMemo(() => {
      if (!nativeFilters || !dataMask) return null;

      const ouKeywords = [
        'national', 'region', 'district', 'county', 'province',
        'org_unit', 'orgunit', 'ou_', 'facility',
      ];
      const periodKeywords = [
        'period', 'quarter', 'month', 'year',
      ];

      let ouLabel: string | null = null;
      let periodLabel: string | null = null;

      const chartId = slice?.slice_id;
      const allFilters = Object.values(nativeFilters) as any[];

      for (const filter of allFilters) {
        if (filter.type !== 'NATIVE_FILTER') continue;
        // Only include filters that scope to this chart
        if (
          chartId &&
          Array.isArray(filter.chartsInScope) &&
          !filter.chartsInScope.includes(chartId)
        ) {
          continue;
        }

        const filterState = dataMask[filter.id]?.filterState;
        if (!filterState) continue;

        const label =
          filterState.label && !String(filterState.label).includes('undefined')
            ? String(filterState.label)
            : filterState.value
              ? ensureIsArray(filterState.value).join(', ')
              : null;
        if (!label) continue;

        const colName = (
          filter.targets?.[0]?.column?.name || filter.name || ''
        ).toLowerCase();

        if (!ouLabel && ouKeywords.some(k => colName.includes(k))) {
          ouLabel = label;
        }
        if (!periodLabel && periodKeywords.some(k => colName.includes(k))) {
          periodLabel = label;
        }
        if (ouLabel && periodLabel) break;
      }

      if (!ouLabel && !periodLabel) return null;
      return { ou: ouLabel, period: periodLabel };
    }, [nativeFilters, dataMask, slice?.slice_id]);

    const rowLimit = Number(formData.row_limit || -1);
    const sqlRowCount = Number(firstQueryResponse?.sql_rowcount || 0);

    useEffect(() => {
      const headerElement = headerRef.current;
      if (
        headerElement &&
        (headerElement.scrollWidth > headerElement.offsetWidth ||
          headerElement.scrollHeight > headerElement.offsetHeight)
      ) {
        setHeaderTooltip(sliceName ?? null);
      } else {
        setHeaderTooltip(null);
      }
    }, [sliceName, width, height]);

    const exploreParams = new URLSearchParams({
      [URL_PARAMS.sliceId.name]: String(slice.slice_id),
    });
    if (dashboardPageId) {
      exploreParams.set(URL_PARAMS.dashboardPageId.name, dashboardPageId);
    }
    const exploreUrl = `/explore/?${exploreParams.toString()}`;

    return (
      <ChartHeaderStyles data-test="slice-header" ref={ref}>
        <div className="header-title" ref={headerRef}>
          <Tooltip title={headerTooltip}>
            {/* this div ensures the hover event triggers correctly and prevents flickering */}
            <div>
              <EditableTitle
                title={
                  sliceName ||
                  (editMode
                    ? '---' // this makes an empty title clickable
                    : '')
                }
                canEdit={editMode}
                onSaveTitle={updateSliceName}
                showTooltip={false}
              />
            </div>
          </Tooltip>
          {filterContextLine && !editMode && (
            <div className="chart-filter-context">
              {filterContextLine.ou && (
                <span>{filterContextLine.ou}</span>
              )}
              {filterContextLine.ou && filterContextLine.period && (
                <span className="context-separator">·</span>
              )}
              {filterContextLine.period && (
                <span>{filterContextLine.period}</span>
              )}
            </div>
          )}
          {!!Object.values(annotationQuery).length && (
            <Tooltip
              id="annotations-loading-tooltip"
              placement="top"
              title={annotationsLoading}
            >
              <Icons.ReloadOutlined
                className="warning"
                aria-label={annotationsLoading}
              />
            </Tooltip>
          )}
          {!!Object.values(annotationError).length && (
            <Tooltip
              id="annotation-errors-tooltip"
              placement="top"
              title={annotationsError}
            >
              <Icons.ExclamationCircleOutlined
                className="danger"
                aria-label={annotationsError}
              />
            </Tooltip>
          )}
        </div>
        <div className="header-controls">
          {!editMode && (
            <>
              {SliceHeaderExtension && (
                <SliceHeaderExtension
                  sliceId={slice.slice_id}
                  dashboardId={dashboardId}
                />
              )}
              {crossFilterValue && (
                <Tooltip
                  placement="top"
                  title={t(
                    'This chart applies cross-filters to charts whose datasets contain columns with the same name.',
                  )}
                >
                  <CrossFilterIcon iconSize="m" />
                </Tooltip>
              )}
              {!uiConfig.hideChartControls && (
                <GroupByBadge chartId={slice.slice_id} />
              )}

              {!uiConfig.hideChartControls && (
                <FiltersBadge chartId={slice.slice_id} />
              )}

              {shouldShowRowLimitWarning && sqlRowCount === rowLimit && (
                <RowCountLabel
                  rowcount={sqlRowCount}
                  limit={rowLimit}
                  label={
                    <Icons.WarningOutlined
                      iconSize="l"
                      iconColor={theme.colorWarning}
                      css={theme => css`
                        padding: ${theme.sizeUnit}px;
                      `}
                    />
                  }
                />
              )}
              {!uiConfig.hideChartControls && (
                <SliceHeaderControls
                  slice={slice}
                  isCached={isCached}
                  isExpanded={isExpanded}
                  cachedDttm={cachedDttm}
                  updatedDttm={updatedDttm}
                  toggleExpandSlice={toggleExpandSlice}
                  forceRefresh={forceRefresh}
                  logExploreChart={logExploreChart}
                  logEvent={logEvent}
                  exportCSV={exportCSV}
                  exportPivotCSV={exportPivotCSV}
                  exportFullCSV={exportFullCSV}
                  exportXLSX={exportXLSX}
                  exportFullXLSX={exportFullXLSX}
                  supersetCanExplore={supersetCanExplore}
                  supersetCanShare={supersetCanShare}
                  supersetCanCSV={supersetCanCSV}
                  componentId={componentId}
                  dashboardId={dashboardId}
                  addSuccessToast={addSuccessToast}
                  addDangerToast={addDangerToast}
                  handleToggleFullSize={handleToggleFullSize}
                  isFullSize={isFullSize}
                  isDescriptionExpanded={isExpanded}
                  chartStatus={chartStatus}
                  formData={formData}
                  exploreUrl={exploreUrl}
                  crossFiltersEnabled={isCrossFiltersEnabled}
                  exportPivotExcel={exportPivotExcel}
                />
              )}
            </>
          )}
        </div>
      </ChartHeaderStyles>
    );
  },
);

export default SliceHeader;
