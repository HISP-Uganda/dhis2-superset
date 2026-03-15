import {
  quantileBreaks,
  equalIntervalBreaks,
  parseManualBreaks,
  validateManualBreaks,
  assignClass,
  extractCategories,
} from '../src/utils/classify';

describe('quantileBreaks', () => {
  it('returns correct breaks for simple dataset', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const breaks = quantileBreaks(values, 5);
    expect(breaks.length).toBe(5);
    expect(breaks[breaks.length - 1]).toBe(10);
  });

  it('handles empty array', () => {
    expect(quantileBreaks([], 5)).toEqual([]);
  });

  it('handles nClasses < 2', () => {
    expect(quantileBreaks([1, 2, 3], 1)).toEqual([]);
  });

  it('filters non-finite values', () => {
    const breaks = quantileBreaks([1, NaN, Infinity, 2, 3, -Infinity, 4], 2);
    expect(breaks.length).toBeGreaterThan(0);
    breaks.forEach(b => expect(Number.isFinite(b)).toBe(true));
  });

  it('handles duplicate values', () => {
    const breaks = quantileBreaks([1, 1, 1, 2, 2, 2], 3);
    expect(breaks.length).toBeGreaterThan(0);
  });
});

describe('equalIntervalBreaks', () => {
  it('produces evenly spaced breaks', () => {
    const breaks = equalIntervalBreaks([0, 10], 5);
    expect(breaks[0]).toBeCloseTo(2);
    expect(breaks[breaks.length - 1]).toBeCloseTo(10);
  });

  it('handles all same values', () => {
    const breaks = equalIntervalBreaks([5, 5, 5], 3);
    expect(breaks).toEqual([5]);
  });

  it('handles empty array', () => {
    expect(equalIntervalBreaks([], 5)).toEqual([]);
  });
});

describe('parseManualBreaks', () => {
  it('parses valid comma-separated string', () => {
    expect(parseManualBreaks('10,20,30')).toEqual([10, 20, 30]);
  });

  it('sorts breaks numerically', () => {
    expect(parseManualBreaks('30,10,20')).toEqual([10, 20, 30]);
  });

  it('returns null for empty string', () => {
    expect(parseManualBreaks('')).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseManualBreaks('a,b,c')).toBeNull();
  });

  it('handles spaces around values', () => {
    expect(parseManualBreaks(' 10 , 20 , 30 ')).toEqual([10, 20, 30]);
  });
});

describe('validateManualBreaks', () => {
  it('returns true for valid breaks', () => {
    expect(validateManualBreaks('10,20,30')).toBe(true);
  });

  it('returns false for invalid breaks', () => {
    expect(validateManualBreaks('foo,bar')).toBe(false);
  });
});

describe('assignClass', () => {
  it('assigns correct class', () => {
    const breaks = [10, 20, 30, 40];
    expect(assignClass(5, breaks)).toBe(0);
    expect(assignClass(10, breaks)).toBe(0);
    expect(assignClass(15, breaks)).toBe(1);
    expect(assignClass(25, breaks)).toBe(2);
    expect(assignClass(50, breaks)).toBe(3);
  });

  it('handles empty breaks', () => {
    expect(assignClass(5, [])).toBe(0);
  });
});

describe('extractCategories', () => {
  const rows = [
    { region: 'North' },
    { region: 'South' },
    { region: 'North' },
    { region: null },
    { region: 'East' },
  ];

  it('extracts unique non-null categories', () => {
    const cats = extractCategories(rows as any, 'region');
    expect(cats).toContain('North');
    expect(cats).toContain('South');
    expect(cats).toContain('East');
    expect(cats).not.toContain(null);
    expect(new Set(cats).size).toBe(cats.length);
  });

  it('returns sorted categories', () => {
    const cats = extractCategories(rows as any, 'region');
    expect(cats).toEqual([...cats].sort());
  });
});
