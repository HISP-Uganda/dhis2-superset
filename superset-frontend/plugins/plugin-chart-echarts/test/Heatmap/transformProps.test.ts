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
import { ChartProps, supersetTheme } from '@superset-ui/core';
import { GenericDataType } from '@apache-superset/core/api/core';
import transformProps from '../../src/Heatmap/transformProps';
import { HeatmapChartProps } from '../../src/Heatmap/types';

describe('Heatmap transformProps', () => {
  it('uses staged DHIS2 legend definitions when requested', () => {
    const chartProps = new ChartProps({
      width: 800,
      height: 600,
      theme: supersetTheme,
      datasource: {
        columns: [
          {
            column_name: 'c_malaria_total',
            extra: {
              dhis2_legend: {
                items: [
                  {
                    label: 'Low',
                    startValue: 0,
                    endValue: 10,
                    color: '#111111',
                  },
                  {
                    label: 'High',
                    startValue: 11,
                    endValue: 20,
                    color: '#222222',
                  },
                ],
              },
            },
          },
        ],
      },
      formData: {
        datasource: '1__table',
        viz_type: 'heatmap_v2',
        xAxis: 'period',
        groupby: 'region',
        metric: 'SUM(c_malaria_total)',
        normalizeAcross: 'heatmap',
        legendType: 'staged',
        linearColorScheme: 'blue_white_yellow',
        bottomMargin: 'auto',
        leftMargin: 'auto',
        borderColor: { r: 0, g: 0, b: 0, a: 1 },
        borderWidth: 0,
        showLegend: true,
        showPercentage: false,
        showValues: false,
        xscaleInterval: -1,
        yscaleInterval: -1,
        valueBounds: [undefined, undefined],
        xAxisLabelRotation: 0,
      },
      queriesData: [
        {
          data: [
            {
              period: '202401',
              region: 'North',
              'SUM(c_malaria_total)': 15,
            },
          ],
          colnames: ['period', 'region', 'SUM(c_malaria_total)'],
          coltypes: [
            GenericDataType.String,
            GenericDataType.String,
            GenericDataType.Numeric,
          ],
        },
      ],
    });

    const transformed = transformProps(chartProps as HeatmapChartProps);

    expect(transformed.echartOptions.visualMap).toEqual(
      expect.objectContaining({
        type: 'piecewise',
        pieces: [
          {
            label: 'Low',
            color: '#111111',
            min: 0,
            max: 10,
          },
          {
            label: 'High',
            color: '#222222',
            min: 11,
            max: 20,
          },
        ],
      }),
    );
  });
});
