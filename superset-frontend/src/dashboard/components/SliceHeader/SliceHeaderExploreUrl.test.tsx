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
import { DashboardPageIdContext } from 'src/dashboard/containers/DashboardPage';
import { VizType } from '@superset-ui/core';
import { render, screen } from 'spec/helpers/testing-library';
import SliceHeader from '.';

jest.mock('src/dashboard/components/SliceHeaderControls', () => ({
  __esModule: true,
  default: (props: any) => (
    <div data-test="SliceHeaderControls" data-explore-url={props.exploreUrl} />
  ),
}));

jest.mock('src/dashboard/components/FiltersBadge', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('src/dashboard/components/GroupByBadge', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('src/dashboard/util/isEmbedded', () => ({
  isEmbedded: jest.fn().mockReturnValue(false),
}));

jest.mock('src/components/UiConfigContext', () => ({
  useUiConfig: jest.fn().mockReturnValue({
    hideTitle: false,
    hideTab: false,
    hideNav: false,
    hideChartControls: false,
    emitDataMasks: false,
    showRowLimitWarning: false,
  }),
}));

const CHART_ID = 312;

const props = {
  filters: {},
  editMode: false,
  annotationQuery: {},
  annotationError: {},
  cachedDttm: [] as string[],
  updatedDttm: 1617207718004,
  isCached: [false],
  isExpanded: false,
  sliceName: 'Vaccine Candidates per Phase',
  supersetCanExplore: true,
  supersetCanCSV: true,
  slice: {
    slice_id: CHART_ID,
    slice_url: `/explore/?form_data=%7B%22slice_id%22%3A%20${CHART_ID}%7D`,
    slice_name: 'Vaccine Candidates per Phase',
    form_data: {
      datasource: '58__table',
      groupby: ['clinical_stage'],
      metrics: ['count'],
      row_limit: 10000,
      time_range: 'No filter',
      viz_type: VizType.Bar,
      slice_id: CHART_ID,
    },
    viz_type: VizType.Bar,
    datasource: '58__table',
    description: '',
    description_markeddown: '',
    owners: [],
    modified: '<span class="no-wrap">20 hours ago</span>',
    changed_on: 1617143411366,
    slice_description: '',
  },
  componentId: 'CHART-aGfmWtliqA',
  dashboardId: 26,
  isFullSize: false,
  chartStatus: 'rendered',
  addSuccessToast: jest.fn(),
  addDangerToast: jest.fn(),
  handleToggleFullSize: jest.fn(),
  updateSliceName: jest.fn(),
  toggleExpandSlice: jest.fn(),
  forceRefresh: jest.fn(),
  logExploreChart: jest.fn(),
  logEvent: jest.fn(),
  exportCSV: jest.fn(),
  formData: { slice_id: CHART_ID, datasource: '58__table', row_limit: 10000 },
  width: 100,
  height: 100,
};

test('uses the dashboard context route when opening Explore from a dashboard chart', () => {
  render(
    <DashboardPageIdContext.Provider value="dashboard-page-1">
      <SliceHeader {...props} />
    </DashboardPageIdContext.Provider>,
    {
    useRedux: true,
    useRouter: true,
    initialState: {
      charts: {
        [CHART_ID]: {
          id: CHART_ID,
          chartStatus: 'rendered',
          queriesResponse: [{ sql_rowcount: 0 }],
        },
      },
      dashboardInfo: {
        crossFiltersEnabled: false,
      },
      dataMask: {},
    },
  },
  );

  expect(screen.getByTestId('SliceHeaderControls')).toHaveAttribute(
    'data-explore-url',
    `/explore/?slice_id=${CHART_ID}&dashboard_page_id=dashboard-page-1`,
  );
});
