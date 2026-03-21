/*
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
import transformProps from './transformProps';

function makeProps(overrides: Record<string, any> = {}) {
  const {
    width = 600,
    height = 400,
    queriesData,
    formData: formDataOverrides = {},
    ...formDataRootOverrides
  } = overrides;

  return {
    width,
    height,
    queriesData: queriesData || [
      {
        data: [{ metric_a: 1000, metric_b: 250 }],
      },
    ],
    formData: {
      metrics: ['metric_a', 'metric_b'],
      datasource: '1__table',
      viz_type: 'slideshow',
      ...formDataRootOverrides,
      ...formDataOverrides,
    },
  } as any;
}

describe('Slideshow transformProps', () => {
  test('extracts slides from metrics', () => {
    const props = transformProps(makeProps());
    expect(props.slides).toHaveLength(2);
    expect(props.slides[0].label).toBe('metric_a');
    expect(props.slides[1].label).toBe('metric_b');
  });

  test('formats values using number formatter', () => {
    const props = transformProps(makeProps({ yAxisFormat: ',.0f' }));
    expect(props.slides[0].value).toBe('1,000');
  });

  test('applies prefix and suffix', () => {
    const props = transformProps(makeProps({ prefix: '$', suffix: 'K' }));
    expect(props.slides[0].value).toContain('$');
    expect(props.slides[0].value).toContain('K');
  });

  test('shows null text for missing values', () => {
    const props = transformProps({
      ...makeProps({ nullText: 'N/A' }),
      queriesData: [{ data: [{ metric_a: null, metric_b: 250 }] }],
    });
    expect(props.slides[0].value).toBe('N/A');
  });

  test('uses the metric label instead of the raw column name for adhoc metrics', () => {
    const props = transformProps(
      makeProps({
        metrics: [
          {
            expressionType: 'SIMPLE',
            aggregate: 'SUM',
            column: {
              column_name: 'c_105_ep01a_suspected_malaria_fever',
            },
            label: 'Suspected Malaria Fever',
          },
        ],
        queriesData: [{ data: [{ 'Suspected Malaria Fever': 514 }] }],
      }),
    );

    expect(props.slides).toHaveLength(1);
    expect(props.slides[0].label).toBe('Suspected Malaria Fever');
    expect(props.slides[0].value).not.toBe('—');
  });

  test('applies defaults for playback config', () => {
    const props = transformProps(makeProps());
    expect(props.autoPlay).toBe(true);
    expect(props.slideIntervalMs).toBe(5000);
    expect(props.loop).toBe(true);
    expect(props.transitionType).toBe('fade');
    expect(props.showArrows).toBe(true);
    expect(props.showDots).toBe(true);
    expect(props.showProgressBar).toBe(true);
  });

  test('parses embeddedChartIds', () => {
    const props = transformProps(makeProps({ embeddedChartIds: '42, 77, 103' }));
    expect(props.embeddedChartIds).toEqual([42, 77, 103]);
  });

  test('ignores invalid embeddedChartIds', () => {
    const props = transformProps(makeProps({ embeddedChartIds: 'abc, , 5' }));
    expect(props.embeddedChartIds).toEqual([5]);
  });

  test('empty embeddedChartIds when not set', () => {
    const props = transformProps(makeProps());
    expect(props.embeddedChartIds).toEqual([]);
  });

  test('passes through border and shadow settings', () => {
    const props = transformProps(
      makeProps({ showBorder: true, showShadow: false, borderRadius: 0 }),
    );
    expect(props.showBorder).toBe(true);
    expect(props.showShadow).toBe(false);
    expect(props.borderRadius).toBe(0);
  });

  test('pauseOnFocus defaults to false', () => {
    const props = transformProps(makeProps());
    expect(props.pauseOnFocus).toBe(false);
  });

  test('pauseOnFocus passes through when set', () => {
    const props = transformProps(makeProps({ pauseOnFocus: true }));
    expect(props.pauseOnFocus).toBe(true);
  });

  test('slideIntervalMs respects explicit value', () => {
    const props = transformProps(makeProps({ slideIntervalMs: 8000 }));
    expect(props.slideIntervalMs).toBe(8000);
  });

  test('startIndex clamps gracefully at zero when not set', () => {
    const props = transformProps(makeProps());
    expect(props.startIndex).toBe(0);
  });

  test('keyboardNavigation defaults to true', () => {
    const props = transformProps(makeProps());
    expect(props.keyboardNavigation).toBe(true);
  });

  test('heightMode defaults to fixed', () => {
    const props = transformProps(makeProps());
    expect(props.heightMode).toBe('fixed');
  });

  test('fixedHeight defaults to 320', () => {
    const props = transformProps(makeProps());
    expect(props.fixedHeight).toBe(320);
  });
});
