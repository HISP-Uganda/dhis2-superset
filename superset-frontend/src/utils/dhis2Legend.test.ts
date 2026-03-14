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
  buildDHIS2LegendPieces,
  getDHIS2LegendColorForValue,
  getDHIS2LegendIndexForValue,
  resolveDHIS2LegendDefinition,
} from './dhis2Legend';

const legendDefinition = {
  items: [
    { label: 'Low', startValue: 0, endValue: 10, color: '#111111' },
    { label: 'High', startValue: 11, endValue: 20, color: '#222222' },
  ],
};

describe('dhis2Legend helpers', () => {
  it('resolves staged legend metadata from aggregated metric references', () => {
    const datasource = {
      columns: [
        {
          column_name: 'c_malaria_total',
          extra: { dhis2_legend: legendDefinition },
        },
      ],
    };

    expect(
      resolveDHIS2LegendDefinition(datasource as any, 'SUM(c_malaria_total)'),
    ).toEqual(legendDefinition);
  });

  it('maps values to the correct DHIS2 legend item index and color', () => {
    expect(getDHIS2LegendIndexForValue(5, legendDefinition)).toBe(1);
    expect(getDHIS2LegendIndexForValue(18, legendDefinition)).toBe(2);
    expect(getDHIS2LegendColorForValue(18, legendDefinition)).toBe('#222222');
  });

  it('builds piecewise legend definitions for chart visual maps', () => {
    expect(buildDHIS2LegendPieces(legendDefinition)).toEqual([
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
    ]);
  });
});
