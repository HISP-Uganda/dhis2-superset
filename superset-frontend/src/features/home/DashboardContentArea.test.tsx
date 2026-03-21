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
import { SupersetClient } from '@superset-ui/core';
import { render, screen, waitFor } from 'spec/helpers/testing-library';
import DashboardContentArea, {
  clearEmbeddedDashboardUuidCache,
} from './DashboardContentArea';

jest.mock('./EmbeddedDashboard', () => (props: { dashboardId: string }) => (
  <div>Embedded dashboard: {props.dashboardId}</div>
));

jest.mock('./PublicChartRenderer', () => (props: { chartId: number }) => (
  <div>Chart preview: {props.chartId}</div>
));

jest.mock('./EmbeddingManager', () => () => <div>Embedding manager</div>);

const selectedDashboard = {
  id: 7,
  dashboard_title: 'Malaria dashboard',
  slug: 'malaria-dashboard',
  url: '/dashboard/7',
};

afterEach(() => {
  jest.restoreAllMocks();
  clearEmbeddedDashboardUuidCache();
});

test('loads embedded dashboards without fetching chart preview endpoints', async () => {
  const getSpy = jest.spyOn(SupersetClient, 'get').mockImplementation(
    ({ endpoint }) =>
      Promise.resolve({
        json: {
          result:
            endpoint === '/api/v1/dashboard/7/embedded'
              ? { uuid: 'embedded-uuid-7' }
              : {},
        },
        response: new Response(),
      }) as any,
  );

  render(<DashboardContentArea selectedDashboard={selectedDashboard} />);

  expect(
    await screen.findByText('Embedded dashboard: embedded-uuid-7'),
  ).toBeInTheDocument();

  expect(getSpy).toHaveBeenCalledTimes(1);
  expect(getSpy).toHaveBeenCalledWith({
    endpoint: '/api/v1/dashboard/7/embedded',
    signal: expect.any(AbortSignal),
  });
});

test('loads chart previews without requesting embedded configuration in legacy mode', async () => {
  const getSpy = jest
    .spyOn(SupersetClient, 'get')
    .mockImplementation(({ endpoint }) => {
      if (endpoint === '/api/v1/dashboard/7') {
        return Promise.resolve({
          json: {
            result: {
              position_json: {
                ROOT_ID: { id: 'ROOT_ID', type: 'ROOT', children: [] },
              },
            },
          },
          response: new Response(),
        }) as any;
      }

      if (endpoint === '/api/v1/chart/dashboard/7/charts') {
        return Promise.resolve({
          json: {
            result: [
              {
                id: 101,
                slice_name: 'ANC coverage',
                description: '',
                url: '/chart/101',
                viz_type: 'line',
              },
            ],
          },
          response: new Response(),
        }) as any;
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

  render(
    <DashboardContentArea
      selectedDashboard={selectedDashboard}
      useEmbeddedSDK={false}
    />,
  );

  expect(await screen.findByText('Chart preview: 101')).toBeInTheDocument();

  await waitFor(() => {
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  expect(getSpy.mock.calls.map(([request]) => request.endpoint).sort()).toEqual(
    ['/api/v1/chart/dashboard/7/charts', '/api/v1/dashboard/7'],
  );
});

test('reuses cached embedded dashboard uuid on repeat visits', async () => {
  const getSpy = jest.spyOn(SupersetClient, 'get').mockResolvedValue({
    json: {
      result: { uuid: 'embedded-uuid-7' },
    },
    response: new Response(),
  } as any);

  const { rerender } = render(
    <DashboardContentArea selectedDashboard={selectedDashboard} />,
  );

  expect(
    await screen.findByText('Embedded dashboard: embedded-uuid-7'),
  ).toBeInTheDocument();

  rerender(<div>hidden</div>);
  rerender(<DashboardContentArea selectedDashboard={selectedDashboard} />);

  expect(
    await screen.findByText('Embedded dashboard: embedded-uuid-7'),
  ).toBeInTheDocument();

  expect(getSpy).toHaveBeenCalledTimes(1);
});
