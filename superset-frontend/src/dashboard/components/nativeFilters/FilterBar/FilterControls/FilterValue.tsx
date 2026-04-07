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
  FC,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ChartDataResponseResult,
  Behavior,
  DataMask,
  isFeatureEnabled,
  FeatureFlag,
  getChartMetadataRegistry,
  JsonObject,
  QueryFormData,
  styled,
  SuperChart,
  t,
  ClientErrorObject,
  getClientErrorObject,
} from '@superset-ui/core';
import { useDispatch, useSelector } from 'react-redux';
import { isEqual, isEqualWith } from 'lodash';
import { getChartDataRequest } from 'src/components/Chart/chartAction';
import { ErrorAlert, ErrorMessageWithStackTrace } from 'src/components';
import { Loading, Constants } from '@superset-ui/core/components';
import { waitForAsyncData } from 'src/middleware/asyncEvent';
import { FilterBarOrientation, RootState } from 'src/dashboard/types';
import {
  onFiltersRefreshSuccess,
  setDirectPathToChild,
} from 'src/dashboard/actions/dashboardState';
import { RESPONSIVE_WIDTH } from 'src/filters/components/common';
import { dispatchHoverAction, dispatchFocusAction } from './utils';
import { FilterControlProps } from './types';
import { getFormData } from '../../utils';
import { useFilterDependencies } from './state';
import { useFilterOutlined } from '../useFilterOutlined';
import { useFilters } from '../state';

const HEIGHT = 32;

// Overrides superset-ui height with min-height
const StyledDiv = styled.div`
  & > div {
    height: auto !important;
    min-height: ${HEIGHT}px;
  }
`;

const queriesDataPlaceholder = [{ data: [{}] }];
const behaviors = [Behavior.NativeFilter];

const useShouldFilterRefresh = () => {
  const isDashboardRefreshing = useSelector<RootState, boolean>(
    state => state.dashboardState.isRefreshing,
  );
  const isFilterRefreshing = useSelector<RootState, boolean>(
    state => state.dashboardState.isFiltersRefreshing,
  );

  // trigger filter requests only after charts requests were triggered
  return !isDashboardRefreshing && isFilterRefreshing;
};

const hasSelectedValue = (value: unknown) =>
  value != null && (!Array.isArray(value) || value.length > 0);

const FilterValue: FC<FilterControlProps> = ({
  dataMaskSelected,
  filter,
  onFilterSelectionChange,
  inView = true,
  showOverflow,
  parentRef,
  setFilterActive,
  orientation = FilterBarOrientation.Vertical,
  overflow = false,
  validateStatus,
  clearAllTrigger,
  onClearAllComplete,
}) => {
  const {
    id,
    targets,
    filterType,
    adhoc_filters,
    time_range,
    cascadeParentId,
  } = filter;
  const metadata = getChartMetadataRegistry().get(filterType);
  const dependencies = useFilterDependencies(id, dataMaskSelected);
  const shouldRefresh = useShouldFilterRefresh();
  const allFilters = useFilters();
  const [state, setState] = useState<ChartDataResponseResult[]>([]);
  const dashboardId = useSelector<RootState, number>(
    state => state.dashboardInfo.id,
  );

  const [error, setError] = useState<ClientErrorObject>();
  const [formData, setFormData] = useState<Partial<QueryFormData>>({
    inView: false,
  });
  const [ownState, setOwnState] = useState<JsonObject>({});
  const [inViewFirstTime, setInViewFirstTime] = useState(inView);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const [target] = targets;
  const {
    datasetId,
    column = {},
  }: Partial<{ datasetId: number; column: { name?: string } }> = target;
  const { name: groupby } = column;
  const hasDataSource = !!datasetId;
  const [isLoading, setIsLoading] = useState<boolean>(hasDataSource);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const dispatch = useDispatch();

  const { outlinedFilterId, lastUpdated } = useFilterOutlined();

  const handleFilterLoadFinish = useCallback(() => {
    setIsRefreshing(false);
    setIsLoading(false);
    if (shouldRefresh) {
      dispatch(onFiltersRefreshSuccess());
    }
  }, [dispatch, shouldRefresh]);

  useEffect(() => {
    if (!inViewFirstTime && inView) {
      setInViewFirstTime(true);
    }
  }, [inView, inViewFirstTime, setInViewFirstTime]);

  const resolvedCascadeParentId = useMemo(() => {
    if (cascadeParentId) {
      return cascadeParentId;
    }

    const parentIds = filter?.cascadeParentIds || [];
    return parentIds.length ? parentIds[parentIds.length - 1] : undefined;
  }, [cascadeParentId, filter?.cascadeParentIds]);

  const getCascadeParentInfo = useCallback(() => {
    if (!resolvedCascadeParentId) {
      return {
        cascade_parent_column: undefined,
        cascade_parent_value: undefined,
      };
    }
    const parentFilter = allFilters?.[resolvedCascadeParentId];
    if (!parentFilter) {
      return {
        cascade_parent_column: undefined,
        cascade_parent_value: undefined,
      };
    }
    const parentTarget = parentFilter.targets?.[0];
    const parentColumn = parentTarget?.column?.name;
    const parentDataMask = dataMaskSelected?.[resolvedCascadeParentId];
    const parentSelectedValue = parentDataMask?.filterState?.value;
    const isEmptyParentValue =
      parentSelectedValue == null ||
      (Array.isArray(parentSelectedValue) && parentSelectedValue.length === 0);
    if (isEmptyParentValue) {
      return {
        cascade_parent_column: undefined,
        cascade_parent_value: undefined,
      };
    }
    return {
      cascade_parent_column: parentColumn,
      cascade_parent_value: parentSelectedValue,
    };
  }, [resolvedCascadeParentId, allFilters, dataMaskSelected]);

  useEffect(() => {
    if (!inViewFirstTime) {
      return;
    }
    const cascadeParentInfo = getCascadeParentInfo();
    const newFormData = getFormData({
      ...filter,
      datasetId,
      dependencies,
      groupby,
      adhoc_filters,
      time_range,
      dashboardId,
      ...cascadeParentInfo,
    });
    const filterOwnState = filter.dataMask?.ownState || {};
    if (resolvedCascadeParentId) {
      const parentValue =
        dataMaskSelected?.[resolvedCascadeParentId]?.filterState?.value;

      if (!hasSelectedValue(parentValue)) {
        return;
      }
    } else if (filter?.cascadeParentIds?.length) {
      const selectedParentFiltersWithValue = filter.cascadeParentIds.filter(
        parentId =>
          hasSelectedValue(dataMaskSelected?.[parentId]?.filterState?.value),
      ).length;
      const depsCount = filter.cascadeParentIds.length;

      if (selectedParentFiltersWithValue !== depsCount) {
        return;
      }
    }

    // TODO: We should try to improve our useEffect hooks to depend more on
    // granular information instead of big objects that require deep comparison.
    const customizer = (
      objValue: Partial<QueryFormData>,
      othValue: Partial<QueryFormData>,
      key: string,
    ) => (key === 'url_params' ? true : undefined);
    if (
      !isRefreshing &&
      (!isEqualWith(formData, newFormData, customizer) ||
        !isEqual(ownState, filterOwnState) ||
        shouldRefresh)
    ) {
      setFormData(newFormData);
      setOwnState(filterOwnState);
      if (!hasDataSource) {
        return;
      }
      setIsRefreshing(true);
      getChartDataRequest({
        formData: newFormData,
        force: shouldRefresh,
        ownState: filterOwnState,
      })
        .then(({ response, json }) => {
          if (!mountedRef.current) return;
          if (isFeatureEnabled(FeatureFlag.GlobalAsyncQueries)) {
            // deal with getChartDataRequest transforming the response data
            const result = 'result' in json ? json.result[0] : json;
            if (response.status === 200) {
              setState([result]);
              handleFilterLoadFinish();
            } else if (response.status === 202) {
              waitForAsyncData(result)
                .then((asyncResult: ChartDataResponseResult[]) => {
                  if (!mountedRef.current) return;
                  setState(asyncResult);
                  handleFilterLoadFinish();
                })
                .catch((error: Response) => {
                  if (!mountedRef.current) return;
                  getClientErrorObject(error).then(clientErrorObject => {
                    if (!mountedRef.current) return;
                    setError(clientErrorObject);
                    handleFilterLoadFinish();
                  });
                });
            } else {
              throw new Error(
                `Received unexpected response status (${response.status}) while fetching chart data`,
              );
            }
          } else {
            setState(json.result);
            setError(undefined);
            handleFilterLoadFinish();
          }
        })
        .catch((error: Response) => {
          if (!mountedRef.current) return;
          getClientErrorObject(error).then(clientErrorObject => {
            if (!mountedRef.current) return;
            setError(clientErrorObject);
            handleFilterLoadFinish();
          });
        });
    }
  }, [
    inViewFirstTime,
    dependencies,
    datasetId,
    groupby,
    handleFilterLoadFinish,
    filter,
    hasDataSource,
    isRefreshing,
    shouldRefresh,
    dataMaskSelected,
    getCascadeParentInfo,
    resolvedCascadeParentId,
  ]);

  useEffect(() => {
    if (outlinedFilterId && outlinedFilterId === filter.id) {
      setTimeout(
        () => {
          inputRef?.current?.focus();
        },
        overflow ? Constants.FAST_DEBOUNCE : 0,
      );
    }
  }, [inputRef, outlinedFilterId, lastUpdated, filter.id, overflow]);

  const setDataMask = useCallback(
    (dataMask: DataMask) => onFilterSelectionChange(filter, dataMask),
    [filter, onFilterSelectionChange],
  );

  const setFocusedFilter = useCallback(() => {
    // don't highlight charts in scope if filter was focused programmatically
    if (outlinedFilterId !== id) {
      dispatchFocusAction(dispatch, id);
    }
  }, [dispatch, id, outlinedFilterId]);

  const unsetFocusedFilter = useCallback(() => {
    dispatchFocusAction(dispatch);
    if (outlinedFilterId === id) {
      dispatch(setDirectPathToChild([]));
    }
  }, [dispatch, id, outlinedFilterId]);

  const setHoveredFilter = useCallback(
    () => dispatchHoverAction(dispatch, id),
    [dispatch, id],
  );
  const unsetHoveredFilter = useCallback(
    () => dispatchHoverAction(dispatch),
    [dispatch],
  );

  const hooks = useMemo(
    () => ({
      setDataMask,
      setHoveredFilter,
      unsetHoveredFilter,
      setFocusedFilter,
      unsetFocusedFilter,
      setFilterActive,
      clearAllTrigger,
      onClearAllComplete,
    }),
    [
      setDataMask,
      setFilterActive,
      setHoveredFilter,
      unsetHoveredFilter,
      setFocusedFilter,
      unsetFocusedFilter,
      clearAllTrigger,
      onClearAllComplete,
    ],
  );

  const filterState = useMemo(
    () => ({
      ...filter.dataMask?.filterState,
      validateStatus,
    }),
    [filter.dataMask?.filterState, validateStatus],
  );

  const displaySettings = useMemo(
    () => ({
      filterBarOrientation: orientation,
      isOverflowingFilterBar: overflow,
    }),
    [orientation, overflow],
  );

  if (error) {
    return (
      <ErrorMessageWithStackTrace
        error={error.errors?.[0]}
        compact
        fallback={
          <ErrorAlert
            errorType={t('Network error')}
            message={t('Network error while attempting to fetch resource')}
            type="error"
            compact
          />
        }
      />
    );
  }

  return (
    <StyledDiv data-test="form-item-value">
      {isLoading ? (
        <Loading position="inline-centered" size="s" muted />
      ) : (
        <SuperChart
          height={HEIGHT}
          width={RESPONSIVE_WIDTH}
          showOverflow={showOverflow}
          formData={formData}
          displaySettings={displaySettings}
          parentRef={parentRef}
          inputRef={inputRef}
          // For charts that don't have datasource we need workaround for empty placeholder
          queriesData={hasDataSource ? state : queriesDataPlaceholder}
          chartType={filterType}
          behaviors={behaviors}
          filterState={filterState}
          ownState={filter.dataMask?.ownState}
          enableNoResults={metadata?.enableNoResults}
          isRefreshing={isRefreshing}
          hooks={hooks}
        />
      )}
    </StyledDiv>
  );
};
export default memo(FilterValue);
