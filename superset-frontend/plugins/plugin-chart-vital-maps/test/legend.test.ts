import { buildClassedLegend, buildCategoricalLegend, buildNoDataItem, addNoDataItem } from '../src/utils/legend';

describe('buildClassedLegend', () => {
  it('builds correct number of items', () => {
    const legend = buildClassedLegend([10, 20, 30], ['#red', '#green', '#blue']);
    expect(legend.type).toBe('classed');
    expect(legend.items.length).toBe(3);
  });

  it('assigns colors to items', () => {
    const legend = buildClassedLegend([10, 20], ['#aaa', '#bbb']);
    expect(legend.items[0].color).toBe('#aaa');
    expect(legend.items[1].color).toBe('#bbb');
  });

  it('returns empty items for empty breaks', () => {
    const legend = buildClassedLegend([], []);
    expect(legend.items).toEqual([]);
  });

  it('includes title when provided', () => {
    const legend = buildClassedLegend([10], ['#aaa'], 'My Metric');
    expect(legend.title).toBe('My Metric');
  });
});

describe('buildCategoricalLegend', () => {
  it('builds one item per category', () => {
    const legend = buildCategoricalLegend(['North', 'South', 'East'], ['#a', '#b', '#c']);
    expect(legend.type).toBe('categorical');
    expect(legend.items.length).toBe(3);
    expect(legend.items[0].label).toBe('North');
  });

  it('cycles colors when fewer colors than categories', () => {
    const legend = buildCategoricalLegend(['A', 'B', 'C', 'D'], ['#x', '#y']);
    expect(legend.items[2].color).toBe('#x');
    expect(legend.items[3].color).toBe('#y');
  });
});

describe('buildNoDataItem', () => {
  it('returns isNoData true', () => {
    const item = buildNoDataItem();
    expect(item.isNoData).toBe(true);
    expect(item.label).toBe('No data');
    expect(typeof item.color).toBe('string');
  });
});

describe('addNoDataItem', () => {
  it('appends no-data item without mutating original', () => {
    const legend = buildClassedLegend([10], ['#aaa']);
    const withNoData = addNoDataItem(legend);
    expect(withNoData.items.length).toBe(legend.items.length + 1);
    expect(legend.items.length).toBe(1); // original unchanged
    expect(withNoData.items[withNoData.items.length - 1].isNoData).toBe(true);
  });
});
