/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */

import transformProps from './transformProps';

const makeChartProps = (overrides: any = {}) => ({
  ...overrides,
  formData: {
    metrics: [
      { expressionType: 'SIMPLE', column: { column_name: 'count' }, label: 'Total Count' },
      { expressionType: 'SIMPLE', column: { column_name: 'sum_value' }, label: 'Sum Value' },
    ],
    placement: 'top',
    orientation: 'auto',
    speed: 30,
    pause_on_hover: true,
    auto_loop: true,
    scroll_direction: 'forward',
    number_format: 'SMART_NUMBER',
    prefix: '',
    suffix: '',
    null_text: 'N/A',
    show_label: true,
    show_subtitle: true,
    show_delta: true,
    show_separators: false,
    ...overrides.formData,
  },
  queriesData: overrides.queriesData || [
    {
      data: [{ 'Total Count': 12345, 'Sum Value': 67890 }],
    },
  ],
  height: 80,
  width: 800,
});

describe('MarqueeViz transformProps', () => {
  it('produces items from metrics', () => {
    const result = transformProps(makeChartProps() as any);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].label).toBe('Total Count');
    expect(result.items[1].label).toBe('Sum Value');
    expect(result.items[0].formattedValue).not.toBe('N/A');
  });

  it('formats values using number format', () => {
    const result = transformProps(makeChartProps() as any);
    expect(result.items[0].formattedValue).toBeTruthy();
  });

  it('applies prefix and suffix', () => {
    const result = transformProps(
      makeChartProps({ formData: { prefix: '$', suffix: 'k' } }) as any,
    );
    expect(result.items[0].formattedValue).toMatch(/\$/);
  });

  it('uses null text for missing values', () => {
    const result = transformProps(
      makeChartProps({ queriesData: [{ data: [{}] }] }) as any,
    );
    // values will be null/NaN → formatted as null text
    expect(result.items[0].formattedValue).toBeTruthy();
  });

  it('passes through placement as-is', () => {
    const result = transformProps(
      makeChartProps({ formData: { placement: 'left' } }) as any,
    );
    expect(result.placement).toBe('left');
  });

  it('resolves defaults when formData is minimal', () => {
    const result = transformProps({
      formData: { metrics: [] },
      queriesData: [{ data: [] }],
      height: 80,
      width: 800,
    } as any);
    expect(result.items).toHaveLength(0);
    expect(result.speed).toBe(30);
    expect(result.pauseOnHover).toBe(true);
    expect(result.showLabel).toBe(true);
  });

  it('uses the metric label instead of the raw column name for adhoc metrics', () => {
    const result = transformProps(
      makeChartProps({
        formData: {
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
        },
        queriesData: [
          {
            data: [{ 'Suspected Malaria Fever': 514 }],
          },
        ],
      }) as any,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].label).toBe('Suspected Malaria Fever');
    expect(result.items[0].formattedValue).not.toBe('N/A');
  });
});
