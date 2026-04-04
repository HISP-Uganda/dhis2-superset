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
import cx from 'classnames';
import { useCallback, useEffect, useRef, useMemo, useState, memo } from 'react';
import PropTypes from 'prop-types';
import { styled } from '@superset-ui/core';
import { debounce } from 'lodash';
import { bindActionCreators } from 'redux';
import { useDispatch, useSelector } from 'react-redux';

import { exportChart } from 'src/explore/exploreUtils';
import ChartContainer from 'src/components/Chart/ChartContainer';
import {
  LOG_ACTIONS_CHANGE_DASHBOARD_FILTER,
  LOG_ACTIONS_EXPLORE_DASHBOARD_CHART,
  LOG_ACTIONS_EXPORT_CSV_DASHBOARD_CHART,
  LOG_ACTIONS_EXPORT_XLSX_DASHBOARD_CHART,
  LOG_ACTIONS_FORCE_REFRESH_CHART,
} from 'src/logger/LogUtils';
import { enforceSharedLabelsColorsArray } from 'src/utils/colorScheme';
import exportPivotExcel from 'src/utils/downloadAsPivotExcel';

import SliceHeader from '../../SliceHeader';
import MissingChart from '../../MissingChart';
import {
  addDangerToast,
  addSuccessToast,
} from '../../../../components/MessageToasts/actions';
import {
  setFocusedFilterField,
  toggleExpandSlice,
  unsetFocusedFilterField,
} from '../../../actions/dashboardState';
import { changeFilter } from '../../../actions/dashboardFilters';
import { refreshChart } from '../../../../components/Chart/chartAction';
import { logEvent } from '../../../../logger/actions';
import {
  getActiveFilters,
  getAppliedFilterValues,
} from '../../../util/activeDashboardFilters';
import getFormDataWithExtraFilters from '../../../util/charts/getFormDataWithExtraFilters';
import { PLACEHOLDER_DATASOURCE } from '../../../constants';

const propTypes = {
  id: PropTypes.number.isRequired,
  componentId: PropTypes.string.isRequired,
  dashboardId: PropTypes.number.isRequired,
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
  updateSliceName: PropTypes.func.isRequired,
  isComponentVisible: PropTypes.bool,
  handleToggleFullSize: PropTypes.func.isRequired,
  setControlValue: PropTypes.func,
  sliceName: PropTypes.string.isRequired,
  isFullSize: PropTypes.bool,
  extraControls: PropTypes.object,
  isInView: PropTypes.bool,
};

// we use state + shouldComponentUpdate() logic to prevent perf-wrecking
// resizing across all slices on a dashboard on every update
const RESIZE_TIMEOUT = 500;
const DEFAULT_HEADER_HEIGHT = 22;

const ChartWrapper = styled.div`
  overflow: hidden;
  position: relative;
  isolation: isolate;
  z-index: 0;
`;

const ChartOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
`;

const SliceContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const EMPTY_OBJECT = {};

const Chart = props => {
  const dispatch = useDispatch();
  const descriptionRef = useRef(null);
  const headerRef = useRef(null);

  const boundActionCreators = useMemo(
    () =>
      bindActionCreators(
        {
          addSuccessToast,
          addDangerToast,
          toggleExpandSlice,
          changeFilter,
          setFocusedFilterField,
          unsetFocusedFilterField,
          refreshChart,
          logEvent,
        },
        dispatch,
      ),
    [dispatch],
  );

  const chart = useSelector(state => state.charts[props.id] || EMPTY_OBJECT);
  const { queriesResponse, chartUpdateEndTime, chartStatus, annotationQuery } =
    chart;

  const slice = useSelector(
    state => state.sliceEntities.slices[props.id] || EMPTY_OBJECT,
  );
  const editMode = useSelector(state => state.dashboardState.editMode);
  const isExpanded = useSelector(
    state => !!state.dashboardState.expandedSlices[props.id],
  );
  const supersetCanExplore = useSelector(
    state => !!state.dashboardInfo.superset_can_explore,
  );
  const supersetCanShare = useSelector(
    state => !!state.dashboardInfo.superset_can_share,
  );
  const supersetCanCSV = useSelector(
    state => !!state.dashboardInfo.superset_can_csv,
  );
  const timeout = useSelector(
    state => state.dashboardInfo.common.conf.SUPERSET_WEBSERVER_TIMEOUT,
  );
  const emitCrossFilters = useSelector(
    state => !!state.dashboardInfo.crossFiltersEnabled,
  );
  const maxRows = useSelector(
    state => state.dashboardInfo.common.conf.SQL_MAX_ROW,
  );
  const datasource = useSelector(
    state =>
      (chart &&
        chart.form_data &&
        state.datasources[chart.form_data.datasource]) ||
      PLACEHOLDER_DATASOURCE,
  );
  const dashboardInfo = useSelector(state => state.dashboardInfo);

  const isCached = useMemo(
    // eslint-disable-next-line camelcase
    () => queriesResponse?.map(({ is_cached }) => is_cached) || [],
    [queriesResponse],
  );

  const [descriptionHeight, setDescriptionHeight] = useState(0);
  const [height, setHeight] = useState(props.height);
  const [width, setWidth] = useState(props.width);
  const resize = useCallback(
    debounce(() => {
      const { width, height } = props;
      setHeight(height);
      setWidth(width);
    }, RESIZE_TIMEOUT),
    [props.width, props.height],
  );

  const ownColorScheme = chart.form_data?.color_scheme;

  const addFilter = useCallback(
    (newSelectedValues = {}) => {
      boundActionCreators.logEvent(LOG_ACTIONS_CHANGE_DASHBOARD_FILTER, {
        id: chart.id,
        columns: Object.keys(newSelectedValues).filter(
          key => newSelectedValues[key] !== null,
        ),
      });
      boundActionCreators.changeFilter(chart.id, newSelectedValues);
    },
    [boundActionCreators.logEvent, boundActionCreators.changeFilter, chart.id],
  );

  useEffect(() => {
    if (isExpanded) {
      const descriptionHeight =
        isExpanded && descriptionRef.current
          ? descriptionRef.current?.offsetHeight
          : 0;
      setDescriptionHeight(descriptionHeight);
    } else {
      setDescriptionHeight(0);
    }
  }, [isExpanded]);

  useEffect(
    () => () => {
      resize.cancel();
    },
    [resize],
  );

  useEffect(() => {
    resize();
  }, [resize, props.isFullSize]);

  const getHeaderHeight = useCallback(() => {
    if (headerRef.current) {
      const computedMarginBottom = getComputedStyle(
        headerRef.current,
      ).getPropertyValue('margin-bottom');
      const marginBottom = parseInt(computedMarginBottom, 10) || 0;
      const computedHeight = getComputedStyle(
        headerRef.current,
      ).getPropertyValue('height');
      const height = parseInt(computedHeight, 10) || DEFAULT_HEADER_HEIGHT;
      return height + marginBottom;
    }
    return DEFAULT_HEADER_HEIGHT;
  }, [headerRef]);

  const getChartHeight = useCallback(() => {
    const headerHeight = getHeaderHeight();
    return Math.max(height - headerHeight - descriptionHeight, 20);
  }, [getHeaderHeight, height, descriptionHeight]);

  const handleFilterMenuOpen = useCallback(
    (chartId, column) => {
      boundActionCreators.setFocusedFilterField(chartId, column);
    },
    [boundActionCreators.setFocusedFilterField],
  );

  const handleFilterMenuClose = useCallback(
    (chartId, column) => {
      boundActionCreators.unsetFocusedFilterField(chartId, column);
    },
    [boundActionCreators.unsetFocusedFilterField],
  );

  const logExploreChart = useCallback(() => {
    boundActionCreators.logEvent(LOG_ACTIONS_EXPLORE_DASHBOARD_CHART, {
      slice_id: slice.slice_id,
      is_cached: isCached,
    });
  }, [boundActionCreators.logEvent, slice.slice_id, isCached]);

  const chartConfiguration = useSelector(
    state => state.dashboardInfo.metadata?.chart_configuration,
  );
  const chartCustomizationItems = useSelector(
    state => state.dashboardInfo.metadata?.chart_customization_config || [],
  );
  const colorScheme = useSelector(state => state.dashboardState.colorScheme);
  const colorNamespace = useSelector(
    state => state.dashboardState.colorNamespace,
  );
  const datasetsStatus = useSelector(
    state => state.dashboardState.datasetsStatus,
  );
  const allSliceIds = useSelector(state => state.dashboardState.sliceIds);
  const nativeFilters = useSelector(state => state.nativeFilters?.filters);
  const dataMask = useSelector(state => state.dataMask);
  const labelsColor = useSelector(
    state => state.dashboardInfo?.metadata?.label_colors || EMPTY_OBJECT,
  );
  const labelsColorMap = useSelector(
    state => state.dashboardInfo?.metadata?.map_label_colors || EMPTY_OBJECT,
  );
  const sharedLabelsColors = useSelector(state =>
    enforceSharedLabelsColorsArray(
      state.dashboardInfo?.metadata?.shared_label_colors,
    ),
  );

  const formData = useMemo(
    () =>
      getFormDataWithExtraFilters({
        chart,
        chartConfiguration,
        chartCustomizationItems,
        filters: getAppliedFilterValues(props.id),
        colorScheme,
        colorNamespace,
        sliceId: props.id,
        nativeFilters,
        allSliceIds,
        dataMask,
        extraControls: props.extraControls,
        labelsColor,
        labelsColorMap,
        sharedLabelsColors,
        ownColorScheme,
      }),
    [
      chart,
      chartConfiguration,
      chartCustomizationItems,
      props.id,
      props.extraControls,
      colorScheme,
      colorNamespace,
      nativeFilters,
      allSliceIds,
      dataMask,
      labelsColor,
      labelsColorMap,
      sharedLabelsColors,
      ownColorScheme,
    ],
  );

  formData.dashboardId = dashboardInfo.id;

  const exportTable = useCallback(
    (format, isFullCSV, isPivot = false) => {
      const logAction =
        format === 'csv'
          ? LOG_ACTIONS_EXPORT_CSV_DASHBOARD_CHART
          : LOG_ACTIONS_EXPORT_XLSX_DASHBOARD_CHART;
      boundActionCreators.logEvent(logAction, {
        slice_id: slice.slice_id,
        is_cached: isCached,
      });
      exportChart({
        formData: isFullCSV ? { ...formData, row_limit: maxRows } : formData,
        resultType: isPivot ? 'post_processed' : 'full',
        resultFormat: format,
        force: true,
        ownState: dataMask[props.id]?.ownState,
      });
    },
    [
      slice.slice_id,
      isCached,
      formData,
      props.maxRows,
      dataMask[props.id]?.ownState,
      boundActionCreators.logEvent,
    ],
  );

  const exportCSV = useCallback(() => {
    exportTable('csv', false);
  }, [exportTable]);

  const exportFullCSV = useCallback(() => {
    exportTable('csv', true);
  }, [exportTable]);

  const exportPivotCSV = useCallback(() => {
    exportTable('csv', false, true);
  }, [exportTable]);

  const exportXLSX = useCallback(() => {
    exportTable('xlsx', false);
  }, [exportTable]);

  const exportFullXLSX = useCallback(() => {
    exportTable('xlsx', true);
  }, [exportTable]);

  const forceRefresh = useCallback(() => {
    boundActionCreators.logEvent(LOG_ACTIONS_FORCE_REFRESH_CHART, {
      slice_id: slice.slice_id,
      is_cached: isCached,
    });
    return boundActionCreators.refreshChart(chart.id, true, props.dashboardId);
  }, [
    boundActionCreators.refreshChart,
    chart.id,
    props.dashboardId,
    slice.slice_id,
    isCached,
    boundActionCreators.logEvent,
  ]);

  // If chart/slice data isn't in Redux yet, try refreshing before showing error.
  // This handles cases where layout references a chart that hasn't loaded yet.
  const chartMissing = chart === EMPTY_OBJECT;
  const sliceMissing = slice === EMPTY_OBJECT;

  useEffect(() => {
    if ((chartMissing || sliceMissing) && props.id) {
      // Trigger a refresh to load the chart data
      try {
        boundActionCreators.refreshChart(props.id, false, props.dashboardId);
      } catch {
        // ignore — chart may truly be deleted
      }
    }
  }, [chartMissing, sliceMissing, props.id, props.dashboardId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (chartMissing || sliceMissing) {
    return <MissingChart height={getChartHeight()} />;
  }

  const isLoading = chartStatus === 'loading';
  const cachedDttm =
    // eslint-disable-next-line camelcase
    queriesResponse?.map(({ cached_dttm }) => cached_dttm) || [];

  return (
    <SliceContainer
      className="chart-slice"
      data-test="chart-grid-component"
      data-test-chart-id={props.id}
      data-test-viz-type={slice.viz_type}
      data-test-chart-name={slice.slice_name}
    >
      <SliceHeader
        ref={headerRef}
        slice={slice}
        isExpanded={isExpanded}
        isCached={isCached}
        cachedDttm={cachedDttm}
        updatedDttm={chartUpdateEndTime}
        toggleExpandSlice={boundActionCreators.toggleExpandSlice}
        forceRefresh={forceRefresh}
        editMode={editMode}
        annotationQuery={annotationQuery}
        logExploreChart={logExploreChart}
        logEvent={boundActionCreators.logEvent}
        exportCSV={exportCSV}
        exportPivotCSV={exportPivotCSV}
        exportXLSX={exportXLSX}
        exportFullCSV={exportFullCSV}
        exportFullXLSX={exportFullXLSX}
        updateSliceName={props.updateSliceName}
        sliceName={props.sliceName}
        supersetCanExplore={supersetCanExplore}
        supersetCanShare={supersetCanShare}
        supersetCanCSV={supersetCanCSV}
        componentId={props.componentId}
        dashboardId={props.dashboardId}
        filters={getActiveFilters() || EMPTY_OBJECT}
        addSuccessToast={boundActionCreators.addSuccessToast}
        addDangerToast={boundActionCreators.addDangerToast}
        handleToggleFullSize={props.handleToggleFullSize}
        isFullSize={props.isFullSize}
        chartStatus={chartStatus}
        formData={formData}
        width={width}
        height={getHeaderHeight()}
        exportPivotExcel={exportPivotExcel}
      />

      {/*
          This usage of dangerouslySetInnerHTML is safe since it is being used to render
          markdown that is sanitized with nh3. See:
             https://github.com/apache/superset/pull/4390
          and
             https://github.com/apache/superset/pull/23862
        */}
      {isExpanded && slice.description_markeddown && (
        <div
          className="slice_description bs-callout bs-callout-default"
          ref={descriptionRef}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: slice.description_markeddown }}
          role="complementary"
        />
      )}

      <ChartWrapper
        className={cx('dashboard-chart')}
        aria-label={slice.description}
      >
        {isLoading && (
          <ChartOverlay
            style={{
              width,
              height: getChartHeight(),
            }}
          />
        )}

        <ChartContainer
          width={width}
          height={getChartHeight()}
          addFilter={addFilter}
          onFilterMenuOpen={handleFilterMenuOpen}
          onFilterMenuClose={handleFilterMenuClose}
          annotationData={chart.annotationData}
          chartAlert={chart.chartAlert}
          chartId={props.id}
          chartStatus={chartStatus}
          datasource={datasource}
          dashboardId={props.dashboardId}
          initialValues={EMPTY_OBJECT}
          formData={formData}
          labelsColor={labelsColor}
          labelsColorMap={labelsColorMap}
          ownState={dataMask[props.id]?.ownState}
          filterState={dataMask[props.id]?.filterState}
          queriesResponse={chart.queriesResponse}
          timeout={timeout}
          triggerQuery={chart.triggerQuery}
          vizType={slice.viz_type}
          setControlValue={props.setControlValue}
          datasetsStatus={datasetsStatus}
          isInView={props.isInView}
          emitCrossFilters={emitCrossFilters}
        />
      </ChartWrapper>
    </SliceContainer>
  );
};

Chart.propTypes = propTypes;

export default memo(Chart, (prevProps, nextProps) => {
  if (prevProps.cacheBusterProp !== nextProps.cacheBusterProp) {
    return false;
  }
  return (
    !nextProps.isComponentVisible ||
    (prevProps.isInView === nextProps.isInView &&
      prevProps.componentId === nextProps.componentId &&
      prevProps.id === nextProps.id &&
      prevProps.dashboardId === nextProps.dashboardId &&
      prevProps.extraControls === nextProps.extraControls &&
      prevProps.handleToggleFullSize === nextProps.handleToggleFullSize &&
      prevProps.isFullSize === nextProps.isFullSize &&
      prevProps.setControlValue === nextProps.setControlValue &&
      prevProps.sliceName === nextProps.sliceName &&
      prevProps.updateSliceName === nextProps.updateSliceName &&
      prevProps.width === nextProps.width &&
      prevProps.height === nextProps.height)
  );
});
