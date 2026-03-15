import { formatMetricValue, buildTooltipPayload } from '../src/utils/tooltip';

describe('formatMetricValue', () => {
  it('formats null as dash', () => {
    expect(formatMetricValue(null)).toBe('—');
    expect(formatMetricValue(undefined)).toBe('—');
  });

  it('formats large numbers with commas', () => {
    expect(formatMetricValue(1234567)).toContain('1');
  });

  it('formats decimals', () => {
    const result = formatMetricValue(3.14159);
    expect(result).toContain('3.14');
  });

  it('formats strings as-is', () => {
    expect(formatMetricValue('healthy')).toBe('healthy');
  });

  it('handles Infinity', () => {
    expect(formatMetricValue(Infinity)).toBe('Infinity');
  });
});

describe('buildTooltipPayload', () => {
  const props = {
    name: 'Kampala',
    value: 1234,
    region: 'Central',
    note: 'important',
  };

  it('extracts title from labelCol', () => {
    const payload = buildTooltipPayload(props, { labelCol: 'name' });
    expect(payload.title).toBe('Kampala');
  });

  it('extracts metric value', () => {
    const payload = buildTooltipPayload(props, { metricCol: 'value', metricLabel: 'Cases' });
    expect(payload.metricLabel).toBe('Cases');
    expect(payload.metricValue).toBeDefined();
  });

  it('extracts category', () => {
    const payload = buildTooltipPayload(props, { categoryCol: 'region' });
    expect(payload.category).toBe('Central');
  });

  it('extracts extra fields', () => {
    const payload = buildTooltipPayload(props, { extraCols: ['note'] });
    expect(payload.fields).toHaveLength(1);
    expect(payload.fields![0].label).toBe('note');
    expect(payload.fields![0].value).toBe('important');
  });

  it('handles null properties gracefully', () => {
    const payload = buildTooltipPayload(null, { metricCol: 'value' });
    expect(payload).toEqual({});
  });

  it('returns empty object when no matching cols', () => {
    const payload = buildTooltipPayload(props, {});
    expect(payload).toEqual({});
  });
});
